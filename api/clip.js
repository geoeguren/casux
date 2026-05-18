/**
 * api/clip.js — Serverless Function de Vercel
 *
 * Acepta dos formas de request:
 *
 *   Forma nueva (camino principal — el servidor busca los datos):
 *     { typename, wfsBase, wfsVersion?, cqlFilter?, bbox?, mask: GeoJSON }
 *
 *   Forma vieja (fallback — el cliente manda los datos inline):
 *     { layer: GeoJSON, mask: GeoJSON }
 *
 * En la forma nueva, el servidor hace el fetch WFS directamente al IGN/IGM
 * con el bbox de la máscara como pre-filtro. El cliente solo manda ~50 KB
 * de instrucciones en vez de los 6 MB de la capa completa.
 *
 * Devuelve: GeoJSON recortado
 *
 * Usa módulos individuales de Turf en lugar de @turf/turf completo
 * para evitar la dependencia de concaveman (ESM-only, incompatible con
 * el runtime CommonJS de Vercel).
 *
 * Para MultiPolygon complejos (ej: Santa Cruz con 37 subpolígonos),
 * unimos los subpolígonos con @turf/union antes de intersecar.
 *
 * Para líneas usamos lineal de intersección punto a punto en lugar de
 * bboxClip — más robusto con MultiLineString en módulos individuales.
 */

const { fetchWFS }        = require('./_wfs');
const { checkOrigin }     = require('./_cors');
const { normalizarMascara } = require('./_geo');

const { booleanPointInPolygon, bbox, intersect, lineSplit } = require('./_turf');

// Umbral mínimo de overlap para polígonos:
// la intersección debe representar al menos este porcentaje del área original.
// Evita incluir polígonos de provincias limítrofes que apenas rozan el límite.
const OVERLAP_POLYGON_MIN = 0.05;

/**
 * Área aproximada de un anillo de coordenadas [lng, lat] en m²,
 * usando la fórmula de Gauss en proyección esférica (shoelace).
 * Suficientemente precisa para comparación relativa de overlap.
 */
function areaRing(coords) {
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    area += (lng2 - lng1) * Math.PI / 180 * R * R *
            Math.sin((lat1 + lat2) / 2 * Math.PI / 180);
  }
  return Math.abs(area);
}

/**
 * Área total de un Feature Polygon o MultiPolygon en m².
 * Solo usa el anillo exterior de cada parte (suficiente para overlap relativo).
 */
function areaFeature(feat) {
  const geom = feat.geometry;
  if (!geom) return 0;
  if (geom.type === 'Polygon') {
    return areaRing(geom.coordinates[0]);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((sum, part) => sum + areaRing(part[0]), 0);
  }
  return 0;
}

// Umbral para descartar fragmentos satelitales en un MultiPolygon resultado:
// sub-polígonos menores a este porcentaje del sub-polígono más grande se eliminan.
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

  const areas = partes.map(coords => areaRing(coords[0]));
  const maxArea = Math.max(...areas);

  const filtradas = partes.filter((_, i) => areas[i] >= maxArea * FRAGMENT_MIN_RATIO);

  if (filtradas.length === 0) return feat; // salvaguarda: no descartar todo

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
 * Clip geométrico real de líneas usando intersect con el polígono máscara.
 * Devuelve un array de features (puede generar múltiples segmentos).
 *
 * Nota: maskPolygon siempre llega como Polygon (normalizarMascara lo garantiza),
 * así que no hace falta manejar MultiPolygon aquí.
 */
function clipLineas(feat, maskPolygon) {
  // Usamos lineSplit para cortar la línea con el borde del polígono,
  // luego filtramos los segmentos que están dentro
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
          // lineSplit devuelve 0 segmentos cuando la línea no cruza el borde
          // del polígono — esto incluye el caso "completamente adentro".
          // Verificar con un punto de la línea.
          const midCoord = coords[Math.floor(coords.length / 2)];
          const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
          if (booleanPointInPolygon(midPt, maskPolygon)) {
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
            if (booleanPointInPolygon(midPt, maskPolygon)) {
              resultFeatures.push({ ...seg, properties: feat.properties });
            }
          }
        }
      } catch {
        // Si lineSplit falla, filtrar puntos que están dentro del polígono
        const inside = coords.filter(([x, y]) => {
          const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: {} };
          return booleanPointInPolygon(pt, maskPolygon);
        });
        if (inside.length >= 2) {
          resultFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: inside }, properties: feat.properties });
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

  const { layer, mask, maskInstructions, typename, wfsBase, wfsVersion, cqlFilter, bbox: bboxParam } = req.body || {};

  // Validar que llegue la máscara en alguna de las formas posibles
  if (!mask && !maskInstructions) return res.status(400).json({ error: 'Se requiere "mask" o "maskInstructions"' });

  // Validar que lleguen los datos de la capa: o bien inline (layer) o bien instrucciones WFS
  if (!layer && !typename) return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });

  // Forma nueva: el servidor hace el fetch WFS de la capa
  let layerGeoJSON = layer;
  if (!layerGeoJSON) {
    layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: bboxParam });
  }

  // Máscara: puede venir como GeoJSON inline o como instrucciones WFS para fetchear
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
  const clipped         = [];

  for (const feat of layerGeoJSON.features || []) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;

      if (geomType === 'Point' || geomType === 'MultiPoint') {
        if (booleanPointInPolygon(feat, maskNormalizada)) {
          clipped.push(feat);
        }

      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        const segs = clipLineas(feat, maskNormalizada);
        for (const seg of segs) clipped.push(seg);

      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        const inter = intersect(feat, maskNormalizada);
        if (inter) {
          // Filtrar polígonos que apenas rozan el límite:
          // la intersección debe ser al menos OVERLAP_POLYGON_MIN del área original.
          const areaOrig  = areaFeature(feat);
          const areaInter = areaFeature(inter);
          const ratio     = areaOrig > 0 ? areaInter / areaOrig : 1;
          if (ratio >= OVERLAP_POLYGON_MIN) {
            inter.properties = feat.properties;
            clipped.push(limpiarFragmentos(inter));
          }
        }
      }
    } catch { /* feature individual rota — omitir */ }
  }

  return res.status(200).json({
    type:     'FeatureCollection',
    features: clipped,
  });

  } catch (err) {
    // Error no manejado — fetchWFS timeout, IGN caído, etc.
    // Devolver JSON con error en lugar de dejar que Vercel retorne un 500 vacío.
    console.error(`[api/clip] Error:`, err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
