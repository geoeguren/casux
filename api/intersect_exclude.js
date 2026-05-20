/**
 * api/intersect_exclude.js — Serverless Function de Vercel: intersect inverso
 *
 * Mismo protocolo que api/intersect.js, pero devuelve las features que
 * NO tocan el área — el complemento de intersect.
 *
 * Casos de uso:
 *   - "rutas que NO pasan por Catamarca"
 *   - "ríos que no atraviesan el Chaco"
 *   - "departamentos que no tocan el río Paraná"
 *
 * Umbrales de exclusión (simétricos a los de inclusión en intersect.js):
 *   - Líneas:    excluir si ≥ 10% de la longitud toca el área
 *   - Polígonos: excluir si ≥ 5%  del área se solapa
 *   - Puntos:    excluir si está dentro
 *
 * Request: { typename, wfsBase, wfsVersion?, cqlFilter?, bbox?,
 *            mask?: GeoJSON, maskInstructions?: { typename, wfsBase, wfsVersion, cqlFilter } }
 * Response: GeoJSON FeatureCollection con features que NO tocan el área
 */

const { fetchWFS }                              = require('./_wfs');
const { checkOrigin }                           = require('./_cors');
const { normalizarMascara, areaGeometria }      = require('./_geo');
const { booleanPointInPolygon, intersect }      = require('./_turf');

const OVERLAP_LINE_MIN    = 0.10;
const OVERLAP_POLYGON_MIN = 0.05;

function haversine([lng1, lat1], [lng2, lat2]) {
  const R    = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlam = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function longitudRing(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

function fraccionLineaDentro(coords, mask) {
  if (coords.length < 2) return 0;
  let total = 0, dentro = 0;
  for (let i = 1; i < coords.length; i++) {
    const segLen = haversine(coords[i - 1], coords[i]);
    total += segLen;
    const mid   = [(coords[i-1][0] + coords[i][0]) / 2, (coords[i-1][1] + coords[i][1]) / 2];
    const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
    if (booleanPointInPolygon(midPt, mask)) dentro += segLen;
  }
  return total > 0 ? dentro / total : 0;
}

function fraccionPoligonoDentro(feat, mask) {
  try {
    const resultado = intersect(feat, mask);
    if (!resultado) return 0;
    return areaGeometria(feat.geometry) > 0
      ? areaGeometria(resultado.geometry) / areaGeometria(feat.geometry)
      : 0;
  } catch { return 0; }
}

// Devuelve true si el feature toca la máscara (excluir del resultado).
function tocaMascara(feat, mask) {
  const t = feat.geometry?.type;
  if (!t) return false;
  try {
    if (t === 'Point')      return booleanPointInPolygon(feat, mask);
    if (t === 'MultiPoint') return feat.geometry.coordinates.some(c =>
      booleanPointInPolygon({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }, mask)
    );
    if (t === 'LineString')      return fraccionLineaDentro(feat.geometry.coordinates, mask) >= OVERLAP_LINE_MIN;
    if (t === 'MultiLineString') {
      let totalLen = 0, dentroLen = 0;
      for (const ring of feat.geometry.coordinates) {
        const len = longitudRing(ring);
        totalLen  += len;
        dentroLen += fraccionLineaDentro(ring, mask) * len;
      }
      return totalLen > 0 && (dentroLen / totalLen) >= OVERLAP_LINE_MIN;
    }
    if (t === 'Polygon' || t === 'MultiPolygon') return fraccionPoligonoDentro(feat, mask) >= OVERLAP_POLYGON_MIN;
  } catch { /* feature rota */ }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { layer, mask, maskInstructions, typename, wfsBase, wfsVersion, cqlFilter, bbox: bboxParam } = req.body || {};

    if (!mask && !maskInstructions) return res.status(400).json({ error: 'Se requiere "mask" o "maskInstructions"' });
    if (!layer && !typename) return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });

    let layerGeoJSON = layer;
    if (!layerGeoJSON) {
      layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: bboxParam });
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
    const result = [];

    for (const feat of layerGeoJSON.features || []) {
      try {
        if (!tocaMascara(feat, maskNormalizada)) result.push(feat);
      } catch { /* feature rota — omitir */ }
    }

    return res.status(200).json({ type: 'FeatureCollection', features: result });

  } catch (err) {
    console.error('[api/intersect_exclude] Error:', err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
