/**
 * api/nearest.js — Serverless Function de Vercel
 *
 * Los N features más cercanos (o más lejanos) a una referencia.
 *
 * Formas de referencia:
 *   { nearestPoint: { lat, lng } }        ← punto explícito
 *   { nearestArea: GeoJSON }              ← centroide del área de referencia
 *
 * Parámetros:
 *   nearestCount: number (default: 1)     ← cuántos features devolver
 *   exclude: false (default)              ← los N más CERCANOS
 *   exclude: true                         ← los N más LEJANOS
 *
 * Distancia calculada al centroide del feature.
 * Aproximación suficiente para cartografía — no es routing.
 *
 * Casos de uso:
 *   nearest:         "los 5 aeropuertos más cercanos a Rosario"
 *   nearest_exclude: "los 3 aeropuertos más lejanos de Buenos Aires"
 */

const { fetchWFS }    = require('./_wfs');
const { fetchREST }   = require('./_rest');
const { checkOrigin } = require('./_cors');
const { distance, centroid } = require('./_turf');

// ── Centroide de un feature ───────────────────────────────────────

function getCentroid(feat) {
  try { return centroid(feat); }
  catch { return null; }
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {

    const {
      layer, typename, wfsBase, wfsVersion, restBase, cqlFilter, whereClause,
      exclude,
      nearestPoint,  // { lat, lng }
      nearestArea,   // GeoJSON feature del área de referencia
      nearestCount = 1,
    } = req.body || {};

    const isExclude = !!exclude;
    const count     = Math.max(1, Math.min(100, parseInt(nearestCount, 10) || 1));

    if (!nearestPoint && !nearestArea) {
      return res.status(400).json({ error: 'Se requiere nearestPoint o nearestArea' });
    }
    if (!layer && !typename) {
      return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });
    }

    // Resolver el punto de referencia
    let refPoint;
    if (nearestPoint) {
      refPoint = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [nearestPoint.lng, nearestPoint.lat] },
        properties: {},
      };
    } else {
      const nearestAreaFeat = nearestArea.features?.[0] || nearestArea;
      refPoint = getCentroid(nearestAreaFeat);
      if (!refPoint) return res.status(400).json({ error: 'No se pudo calcular el centroide del área de referencia' });
    }

    // Fetchear la capa — nearest no puede usar bbox pre-filtro
    // porque necesita calcular distancia a TODOS los features para encontrar los N más cercanos/lejanos
    let layerGeoJSON = layer;
    if (!layerGeoJSON) {
      if (restBase) {
        layerGeoJSON = await fetchREST({ typename, restBase, whereClause });
      } else {
        layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter });
      }
    }

    const features = layerGeoJSON.features || [];
    if (!features.length) {
      return res.status(200).json({ type: 'FeatureCollection', features: [] });
    }

    // Calcular distancia de cada feature al punto de referencia
    const conDistancia = [];
    for (const feat of features) {
      try {
        const c = getCentroid(feat);
        if (!c) continue;
        const dist = distance(refPoint, c, { units: 'kilometers' });
        conDistancia.push({ feat, dist });
      } catch {}
    }

    // Ordenar por distancia
    conDistancia.sort((a, b) => a.dist - b.dist);

    // Devolver los N más cercanos o más lejanos
    const seleccionados = isExclude
      ? conDistancia.slice(-count).reverse()  // los N más lejanos
      : conDistancia.slice(0, count);          // los N más cercanos

    const result = seleccionados.map(({ feat, dist }) => ({
      ...feat,
      properties: { ...feat.properties, _distanciaKm: Math.round(dist * 10) / 10 },
    }));

    console.log(`[api/nearest] ${features.length} features → ${result.length} seleccionados (exclude: ${isExclude})`);
    return res.status(200).json({ type: 'FeatureCollection', features: result });

  } catch (err) {
    console.error('[api/nearest] Error:', err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
