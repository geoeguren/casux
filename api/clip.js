/**
 * api/clip.js — Serverless Function de Vercel
 *
 * Acepta dos formas de request:
 *
 *   Forma nueva (camino principal — el servidor busca los datos):
 *     { typename, wfsBase, wfsVersion?, cqlFilter?, bbox?, mask: GeoJSON, exclude?: boolean }
 *
 *   Forma vieja (fallback — el cliente manda los datos inline):
 *     { layer: GeoJSON, mask: GeoJSON, exclude?: boolean }
 *
 * exclude: false (default) → devuelve features recortadas DENTRO de la máscara (clip)
 * exclude: true            → devuelve features que quedan FUERA de la máscara (clip_exclude)
 *
 * En la forma nueva, el servidor hace el fetch WFS directamente al IGN/IGM
 * con el bbox de la máscara como pre-filtro (solo para exclude:false — en exclude:true
 * se necesitan todos los features para poder excluir los que están dentro).
 *
 * Usa módulos individuales de Turf en lugar de @turf/turf completo
 * para evitar la dependencia de concaveman (ESM-only, incompatible con
 * el runtime CommonJS de Vercel).
 */

const { fetchWFS }                                 = require('./_wfs');
const { checkOrigin }                              = require('./_cors');
const { normalizarMascara, areaRing, areaFeature } = require('./_geo');
const { booleanPointInPolygon, bbox, intersect, lineSplit } = require('./_turf');

// Umbral mínimo de overlap para polígonos (clip inclusivo):
// la intersección debe representar al menos este porcentaje del área original.
const OVERLAP_POLYGON_MIN = 0.05;

// Umbral para descartar fragmentos satelitales en un MultiPolygon resultado.
const FRAGMENT_MIN_RATIO = 0.10;

/**
 * Si el resultado del clip es un MultiPolygon, descarta los sub-polígonos
 * que sean fragmentos satelitales (uñas por diferencias de escala entre capas).
 * Si queda un solo sub-polígono, lo convierte a Polygon.
 */
function limpiarFragmentos(feat) {
  if (feat.geometry?.type !== 'MultiPolygon') return feat;
  const partes = feat.geometry.coordinates;
  if (partes.length <= 1) return feat;

  const areas   = partes.map(coords => areaRing(coords[0]));
  const maxArea = Math.max(...areas);

  const filtradas = partes.filter((_, i) => areas[i] >= maxArea * FRAGMENT_MIN_RATIO);

  if (filtradas.length === 0) return feat;

  if (filtradas.length === 1) {
    return {
      ...feat,
      geometry: { type: 'Polygon', coordinates: filtradas[0] },
    };
  }
  return {
    ...feat,
    geometry: { type: 'MultiPolygon', coordinates: filtradas },
  };
}

/**
 * Clip geométrico de líneas contra el polígono máscara.
 * exclude=false → conserva segmentos DENTRO.
 * exclude=true  → conserva segmentos FUERA.
 */
function clipLineas(feat, maskPolygon, exclude) {
  try {
    const geom = feat.geometry;
    const lines = geom.type === 'LineString'
      ? [geom.coordinates]
      : geom.coordinates;

    const resultFeatures = [];
    for (const coords of lines) {
      const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties };
      try {
        const split = lineSplit(line, maskPolygon);
        if (!split.features?.length) {
          const midCoord = coords[Math.floor(coords.length / 2)];
          const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
          const inside = booleanPointInPolygon(midPt, maskPolygon);
          if (exclude ? !inside : inside) {
            resultFeatures.push({ ...line, properties: feat.properties });
          }
        } else {
          for (const seg of split.features) {
            const sc = seg.geometry.coordinates;
            const mid = [
              (sc[0][0] + sc[sc.length - 1][0]) / 2,
              (sc[0][1] + sc[sc.length - 1][1]) / 2,
            ];
            const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
            const inside = booleanPointInPolygon(midPt, maskPolygon);
            if (exclude ? !inside : inside) {
              resultFeatures.push({ ...seg, properties: feat.properties });
            }
          }
        }
      } catch {
        const filtered = coords.filter(([x, y]) => {
          const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: {} };
          const inside = booleanPointInPolygon(pt, maskPolygon);
          return exclude ? !inside : inside;
        });
        if (filtered.length >= 2) {
          resultFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: filtered }, properties: feat.properties });
        }
      }
    }
    return resultFeatures;
  } catch {
    return [];
  }
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

  // En exclude:true se necesitan TODOS los features — el bbox de la máscara filtраría
  // exactamente lo que queremos conservar, así que no lo usamos como pre-filtro.
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
  const result = [];

  for (const feat of layerGeoJSON.features || []) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;

      if (geomType === 'Point' || geomType === 'MultiPoint') {
        const inside = booleanPointInPolygon(feat, maskNormalizada);
        if (isExclude ? !inside : inside) result.push(feat);

      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        const segs = clipLineas(feat, maskNormalizada, isExclude);
        for (const seg of segs) result.push(seg);

      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        const inter = intersect(feat, maskNormalizada);

        if (isExclude) {
          if (!inter) {
            result.push(feat);
          } else {
            const areaOrig  = areaFeature(feat);
            const areaInter = areaFeature(inter);
            const ratio     = areaOrig > 0 ? areaInter / areaOrig : 1;
            if (ratio < OVERLAP_POLYGON_MIN) result.push(feat);
          }
        } else {
          if (inter) {
            const areaOrig  = areaFeature(feat);
            const areaInter = areaFeature(inter);
            const ratio     = areaOrig > 0 ? areaInter / areaOrig : 1;
            if (ratio >= OVERLAP_POLYGON_MIN) {
              inter.properties = feat.properties;
              result.push(limpiarFragmentos(inter));
            }
          }
        }
      }
    } catch { /* feature individual rota — omitir */ }
  }

  return res.status(200).json({
    type:     'FeatureCollection',
    features: result,
  });

  } catch (err) {
    console.error(`[api/clip] Error:`, err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
