/**
 * api/within_layer.js — Serverless Function de Vercel
 *
 * Features de una capa que están a ≤ distancia X de una referencia.
 * Absorbe y reemplaza api/buffer.js.
 *
 * Formas de referencia:
 *
 *   1. Punto explícito (ex buffer con punto):
 *      { withinPoint: { lat, lng }, withinDistance: 100 }
 *      → genera un círculo y filtra lo que cae dentro
 *
 *   2. Área/división administrativa:
 *      { withinArea: GeoJSON, withinDistance: 50 }
 *      → genera un buffer alrededor del área y filtra
 *
 *   3. Otra capa del catálogo (within_layer real):
 *      { refLayer: GeoJSON, withinDistance: 50 }
 *      → calcula distancia mínima de cada feature al feature más cercano
 *         de la capa de referencia, filtra por umbral
 *
 * exclude: false (default) → features a ≤ distancia (within_layer)
 * exclude: true            → features a > distancia (within_layer_exclude)
 *
 * Diferencia con los casos 1 y 2 vs caso 3:
 *   Casos 1 y 2: se genera un polígono buffer y se filtra con booleanPointInPolygon.
 *               Más rápido, igual de preciso para referencias simples.
 *   Caso 3:     se calcula distancia mínima a N features — más costoso pero necesario
 *               cuando la referencia es una capa distribuida en el espacio.
 */

const { fetchWFS }    = require('./_wfs');
const { fetchREST }   = require('./_rest');
const { checkOrigin } = require('./_cors');
const {
  booleanPointInPolygon,
  intersect,
  union,
  turfBuffer,
  bbox: turfBbox,
  distance,
  centroid,
} = require('./_turf');

// ── Normalizar buffer MultiPolygon → Polygon ──────────────────────

function normalizarBuffer(feat) {
  if (feat.geometry?.type !== 'MultiPolygon') return feat;
  try {
    const polys = feat.geometry.coordinates.map(coords => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: {},
    }));
    return polys.reduce((acc, f) => union(acc, f));
  } catch { return feat; }
}

// ── Centroide de un feature ───────────────────────────────────────

function getCentroid(feat) {
  try { return centroid(feat); }
  catch { return null; }
}

// ── Distancia mínima de un feature a una colección ───────────────
// Para el caso 3 (within_layer real): calcula la distancia del centroide
// del feature al centroide del feature de referencia más cercano.
// Aproximación suficiente para cartografía.

function distanciaMinima(feat, refFeatures) {
  const c = getCentroid(feat);
  if (!c) return Infinity;
  let min = Infinity;
  for (const ref of refFeatures) {
    const rc = getCentroid(ref);
    if (!rc) continue;
    try {
      const d = distance(c, rc, { units: 'kilometers' });
      if (d < min) min = d;
    } catch {}
  }
  return min;
}

// ── Filtrar features por buffer ───────────────────────────────────
// Casos 1 y 2: referencia es un polígono buffer generado con turf.buffer

function filtrarPorBuffer(features, bufferPoly, isExclude) {
  const bufNorm = normalizarBuffer(bufferPoly.features?.[0] || bufferPoly);
  const result  = [];
  for (const feat of features) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;
      let dentro = false;
      if (geomType === 'Point') {
        dentro = booleanPointInPolygon(feat, bufNorm);
      } else if (geomType === 'MultiPoint') {
        dentro = feat.geometry.coordinates.some(c =>
          booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
            bufNorm
          )
        );
      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        const coords = geomType === 'LineString'
          ? feat.geometry.coordinates
          : feat.geometry.coordinates.flat();
        dentro = coords.some(c =>
          booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
            bufNorm
          )
        );
      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        dentro = !!(intersect(feat, bufNorm));
      }
      if (isExclude ? !dentro : dentro) result.push(feat);
    } catch {}
  }
  return result;
}

// ── Filtrar features por distancia a capa de referencia ──────────
// Caso 3: referencia es una colección de features

function filtrarPorDistancia(features, refFeatures, withinDistance, isExclude) {
  const result = [];
  for (const feat of features) {
    try {
      const dist = distanciaMinima(feat, refFeatures);
      const cerca = dist <= withinDistance;
      if (isExclude ? !cerca : cerca) result.push(feat);
    } catch {}
  }
  return result;
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {

    const {
      layer,          // capa A inline (fallback)
      typename,       // capa A por typename
      wfsBase,
      wfsVersion,
      restBase,
      whereClause,
      cqlFilter,
      exclude,
      withinDistance, // km
      // Referencia: uno de los tres:
      withinPoint,    // { lat, lng } — punto explícito
      withinArea,     // GeoJSON del área de referencia
      refLayer,       // GeoJSON de la capa de referencia (caso 3)
    } = req.body || {};

    const isExclude = !!exclude;

    if (!withinDistance || withinDistance <= 0) {
      return res.status(400).json({ error: 'Se requiere withinDistance > 0' });
    }
    if (!withinPoint && !withinArea && !refLayer) {
      return res.status(400).json({ error: 'Se requiere withinPoint, withinArea o refLayer' });
    }
    if (!layer && !typename) {
      return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });
    }

    // ── Caso 3: referencia es una capa distribuida ────────────────
    // Calcular distancia mínima — sin bbox pre-filtro para within_layer_exclude
    // Para within_layer usamos bbox expandido por withinDistance como optimización
    if (refLayer) {
      const refFeatures = refLayer.features || [];
      if (!refFeatures.length) {
        return res.status(200).json({ type: 'FeatureCollection', features: [] });
      }

      let layerGeoJSON = layer;
      if (!layerGeoJSON) {
        // Para within_layer: calcular bbox de la capa de referencia + buffer
        let fetchBbox;
        if (!isExclude && refFeatures.length) {
          try {
            const refBbox = turfBbox({ type: 'FeatureCollection', features: refFeatures });
            fetchBbox = {
              minX: refBbox[0] - withinDistance / 111,
              minY: refBbox[1] - withinDistance / 111,
              maxX: refBbox[2] + withinDistance / 111,
              maxY: refBbox[3] + withinDistance / 111,
            };
          } catch {}
        }
        if (restBase) {
          layerGeoJSON = await fetchREST({ typename, restBase, whereClause, bbox: fetchBbox });
        } else {
          layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: fetchBbox });
        }
      }

      const result = filtrarPorDistancia(layerGeoJSON.features || [], refFeatures, withinDistance, isExclude);
      console.log(`[api/within_layer] capa ref: ${layerGeoJSON.features?.length} → ${result.length} features (exclude: ${isExclude})`);
      return res.status(200).json({ type: 'FeatureCollection', features: result });
    }

    // ── Casos 1 y 2: referencia es un punto o área ────────────────
    // Generar buffer y filtrar con booleanPointInPolygon

    let refFeature;
    if (withinPoint) {
      refFeature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [withinPoint.lng, withinPoint.lat] },
        properties: {},
      };
    } else {
      refFeature = withinArea.features?.[0] || withinArea;
    }

    let bufferPoly;
    try {
      bufferPoly = turfBuffer(refFeature, withinDistance, { units: 'kilometers' });
      if (!bufferPoly) throw new Error('turfBuffer devolvió null');
    } catch (err) {
      return res.status(400).json({ error: `No se pudo generar el área de influencia: ${err.message}` });
    }

    // Pre-filtro bbox para within_layer (no exclude)
    let fetchBbox;
    if (!isExclude) {
      const [minX, minY, maxX, maxY] = turfBbox(bufferPoly);
      fetchBbox = { minX, minY, maxX, maxY };
    }

    let layerGeoJSON = layer;
    if (!layerGeoJSON) {
      if (restBase) {
        layerGeoJSON = await fetchREST({ typename, restBase, whereClause, bbox: fetchBbox });
      } else {
        layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: fetchBbox });
      }
    }

    const result = filtrarPorBuffer(layerGeoJSON.features || [], bufferPoly, isExclude);
    console.log(`[api/within_layer] punto/área: ${layerGeoJSON.features?.length} → ${result.length} features (exclude: ${isExclude})`);
    return res.status(200).json({ type: 'FeatureCollection', features: result });

  } catch (err) {
    console.error('[api/within_layer] Error:', err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
