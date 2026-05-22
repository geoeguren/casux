/**
 * api/intersect.js — Serverless Function de Vercel
 *
 * Acepta dos formas de request:
 *
 *   Forma nueva (camino principal — el servidor busca los datos):
 *     { typename, wfsBase, wfsVersion?, cqlFilter?, bbox?, mask: GeoJSON, exclude?: boolean }
 *
 *   Forma vieja (fallback — el cliente manda los datos inline):
 *     { layer: GeoJSON, mask: GeoJSON, exclude?: boolean }
 *
 * exclude: false (default) → features completas que TOCAN el área (intersect)
 * exclude: true            → features completas que NO tocan el área (intersect_exclude)
 *
 * A diferencia de clip.js, no recorta la geometría — devuelve cada
 * feature íntegra si supera el umbral de overlap.
 *
 * En exclude:true no se usa bbox como pre-filtro porque se necesitan
 * todos los features para poder excluir los que tocan el área.
 *
 * Umbrales de overlap:
 *   - Puntos:    sin umbral (un punto está adentro o no)
 *   - Líneas:    ≥ 10% de la longitud total debe caer dentro de la máscara
 *   - Polígonos: ≥ 5%  del área total debe solaparse con la máscara
 */

const { fetchWFS }                              = require('./_wfs');
const { fetchREST }                             = require('./_rest');
const { checkOrigin }                           = require('./_cors');
const { normalizarMascara, areaGeometria }      = require('./_geo');
const { booleanPointInPolygon, bbox, intersect } = require('./_turf');

const OVERLAP_LINE_MIN    = 0.10;
const OVERLAP_POLYGON_MIN = 0.05;

// ── Helpers geométricos ───────────────────────────────────────────

function haversine([lng1, lat1], [lng2, lat2]) {
  const R  = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlam = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function longitudRing(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/**
 * Fracción de la longitud de una línea que cae dentro de la máscara.
 * El punto medio de cada segmento determina si el segmento está "dentro".
 */
function fraccionLineaDentro(coords, maskNormalizada) {
  if (coords.length < 2) return 0;
  let total  = 0;
  let dentro = 0;

  for (let i = 1; i < coords.length; i++) {
    const segLen = haversine(coords[i - 1], coords[i]);
    total += segLen;

    const mid = [
      (coords[i - 1][0] + coords[i][0]) / 2,
      (coords[i - 1][1] + coords[i][1]) / 2,
    ];
    const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
    if (booleanPointInPolygon(midPt, maskNormalizada)) {
      dentro += segLen;
    }
  }

  return total > 0 ? dentro / total : 0;
}

/**
 * Fracción del área de un polígono que se solapa con la máscara.
 */
function fraccionPoligonoDentro(feat, maskNormalizada) {
  try {
    const resultado = intersect(feat, maskNormalizada);
    if (!resultado) return 0;
    const areaInterseccion = areaGeometria(resultado.geometry);
    const areaTotal        = areaGeometria(feat.geometry);
    return areaTotal > 0 ? areaInterseccion / areaTotal : 0;
  } catch {
    return 0;
  }
}

/**
 * Calcula la fracción de overlap del feature con la máscara.
 * Devuelve un número entre 0 y 1.
 */
function fraccionOverlap(feat, maskNormalizada) {
  const geomType = feat.geometry?.type;
  if (!geomType) return 0;

  try {
    if (geomType === 'Point') {
      return booleanPointInPolygon(feat, maskNormalizada) ? 1 : 0;
    }

    if (geomType === 'MultiPoint') {
      const alguno = feat.geometry.coordinates.some(coord => {
        const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} };
        return booleanPointInPolygon(pt, maskNormalizada);
      });
      return alguno ? 1 : 0;
    }

    if (geomType === 'LineString') {
      return fraccionLineaDentro(feat.geometry.coordinates, maskNormalizada);
    }

    if (geomType === 'MultiLineString') {
      let totalLen  = 0;
      let dentroLen = 0;
      for (const ring of feat.geometry.coordinates) {
        const len = longitudRing(ring);
        totalLen  += len;
        dentroLen += fraccionLineaDentro(ring, maskNormalizada) * len;
      }
      return totalLen > 0 ? dentroLen / totalLen : 0;
    }

    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      return fraccionPoligonoDentro(feat, maskNormalizada);
    }
  } catch {
    // Feature rota o geometría inválida
  }

  return 0;
}

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {

  const { layer, mask, maskInstructions, typename, wfsBase, wfsVersion, restBase, whereClause, cqlFilter, bbox: bboxParam, exclude } = req.body || {};
  const isExclude = !!exclude;

  if (!mask && !maskInstructions) return res.status(400).json({ error: 'Se requiere "mask" o "maskInstructions"' });
  if (!layer && !typename) return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });

  // En exclude:true no usar bbox — se necesitan TODOS los features.
  let layerGeoJSON = layer;
  if (!layerGeoJSON) {
    if (restBase) {
      layerGeoJSON = await fetchREST({ typename, restBase, whereClause, bbox: isExclude ? undefined : bboxParam });
    } else {
      layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: isExclude ? undefined : bboxParam });
    }
  }

  let maskFeatureRaw;
  if (maskInstructions) {
    const maskGeoJSON = await fetchWFS({
      typename:   maskInstructions.typename,
      wfsBase:    maskInstructions.wfsBase,
      wfsVersion: maskInstructions.wfsVersion,
      cqlFilter:  maskInstructions.cqlFilter,
    });
    maskFeatureRaw = maskGeoJSON.features?.[0];
    if (!maskFeatureRaw) return res.status(400).json({ error: 'La máscara no devolvió features' });
  } else {
    maskFeatureRaw = mask.features?.[0] || mask;
  }

  const maskNormalizada = normalizarMascara(maskFeatureRaw);
  const result          = [];

  for (const feat of layerGeoJSON.features || []) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;

      // Puntos: sin umbral fraccionario
      if (geomType === 'Point' || geomType === 'MultiPoint') {
        const fraccion = fraccionOverlap(feat, maskNormalizada);
        const toca = fraccion > 0;
        if (isExclude ? !toca : toca) result.push(feat);
        continue;
      }

      // Líneas y polígonos: comparar fracción contra umbral
      const fraccion = fraccionOverlap(feat, maskNormalizada);
      const umbral = (geomType === 'LineString' || geomType === 'MultiLineString')
        ? OVERLAP_LINE_MIN
        : OVERLAP_POLYGON_MIN;

      const supera = fraccion >= umbral;
      if (isExclude ? !supera : supera) result.push(feat);

    } catch { /* feature individual rota — omitir */ }
  }

  return res.status(200).json({
    type:     'FeatureCollection',
    features: result,
  });

  } catch (err) {
    console.error(`[api/intersect] Error:`, err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
