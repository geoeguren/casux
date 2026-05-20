/**
 * api/clip_exclude.js — Serverless Function de Vercel: clip inverso
 *
 * Mismo protocolo que api/clip.js, pero devuelve las features que quedan
 * FUERA del área de recorte en lugar de las que quedan adentro.
 *
 * Casos de uso:
 *   - "puertos fuera de Santa Cruz"
 *   - "rutas que no pasan por Catamarca"
 *   - "todos los aeropuertos menos los de Buenos Aires"
 *
 * Request: { typename, wfsBase, wfsVersion?, cqlFilter?, bbox?,
 *            mask?: GeoJSON, maskInstructions?: { typename, wfsBase, wfsVersion, cqlFilter } }
 * Response: GeoJSON FeatureCollection con features fuera del área
 */

const { fetchWFS }                                 = require('./_wfs');
const { checkOrigin }                              = require('./_cors');
const { normalizarMascara, areaFeature }           = require('./_geo');
const { booleanPointInPolygon, intersect, lineSplit } = require('./_turf');

const OVERLAP_POLYGON_MIN = 0.05;

// Conserva segmentos FUERA del polígono máscara.
function clipLineasExclude(feat, maskPolygon) {
  try {
    const geom  = feat.geometry;
    const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
    const result = [];

    for (const coords of lines) {
      const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties };
      try {
        const split = lineSplit(line, maskPolygon);
        if (!split.features?.length) {
          const midCoord = coords[Math.floor(coords.length / 2)];
          const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
          if (!booleanPointInPolygon(midPt, maskPolygon)) {
            result.push({ ...line, properties: feat.properties });
          }
        } else {
          for (const seg of split.features) {
            const sc  = seg.geometry.coordinates;
            const mid = [(sc[0][0] + sc[sc.length - 1][0]) / 2, (sc[0][1] + sc[sc.length - 1][1]) / 2];
            const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
            if (!booleanPointInPolygon(midPt, maskPolygon)) {
              result.push({ ...seg, properties: feat.properties });
            }
          }
        }
      } catch {
        const outside = coords.filter(([x, y]) => {
          const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: {} };
          return !booleanPointInPolygon(pt, maskPolygon);
        });
        if (outside.length >= 2) {
          result.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: outside }, properties: feat.properties });
        }
      }
    }
    return result;
  } catch {
    return [];
  }
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
        const geomType = feat.geometry?.type;
        if (!geomType) continue;

        if (geomType === 'Point' || geomType === 'MultiPoint') {
          if (!booleanPointInPolygon(feat, maskNormalizada)) result.push(feat);

        } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
          const segs = clipLineasExclude(feat, maskNormalizada);
          for (const seg of segs) result.push(seg);

        } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          const inter = intersect(feat, maskNormalizada);
          if (!inter) {
            result.push(feat);
          } else {
            const areaOrig  = areaFeature(feat);
            const areaInter = areaFeature(inter);
            const ratio     = areaOrig > 0 ? areaInter / areaOrig : 1;
            if (ratio < OVERLAP_POLYGON_MIN) result.push(feat);
          }
        }
      } catch { /* feature rota — omitir */ }
    }

    return res.status(200).json({ type: 'FeatureCollection', features: result });

  } catch (err) {
    console.error('[api/clip_exclude] Error:', err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
