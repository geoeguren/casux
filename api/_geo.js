/**
 * api/_geo.js — Helpers geométricos compartidos entre endpoints espaciales
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/clip_exclude.js, api/intersect.js
 * y api/intersect_exclude.js.
 *
 * Para agregar un helper nuevo: agregarlo acá y exportarlo.
 * No agregar lógica específica de un solo endpoint — eso va en el archivo propio.
 */

const { union } = require('./_turf');

/**
 * normalizarMascara(maskFeature) → Feature<Polygon>
 *
 * Si la máscara es MultiPolygon (ej: Santa Cruz con 37 subpolígonos),
 * une todos los subpolígonos en un Polygon único usando @turf/union.
 * Si ya es Polygon, devuelve el feature sin modificarlo.
 *
 * Necesario porque @turf/intersect y @turf/boolean-point-in-polygon
 * funcionan mejor —y más predeciblemente— con un Polygon simple
 * que con un MultiPolygon complejo.
 *
 * En caso de error en la unión (geometría inválida), devuelve el
 * feature original sin modificar para no bloquear la operación.
 */
function normalizarMascara(maskFeature) {
  if (maskFeature.geometry?.type !== 'MultiPolygon') return maskFeature;
  try {
    const poligonos = maskFeature.geometry.coordinates.map(coords => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: coords },
      properties: {},
    }));
    return poligonos.reduce((acc, feat) => union(acc, feat));
  } catch {
    return maskFeature;
  }
}

/**
 * areaRing(coords) → number (m²)
 *
 * Área aproximada de un anillo de coordenadas [lng, lat] en m²,
 * usando la fórmula de Gauss en proyección esférica (shoelace).
 * Suficientemente precisa para comparación relativa de overlap.
 *
 * Fuente canónica: importar desde acá en clip.js, clip_exclude.js,
 * intersect.js e intersect_exclude.js. No duplicar.
 */
function areaRing(coords) {
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    area += (lng2 - lng1) * Math.PI / 180 *
      (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs(area) * R * R / 2;
}

/**
 * areaFeature(feat) → number (m²)
 *
 * Área total de un Feature Polygon o MultiPolygon en m².
 * Solo usa el anillo exterior de cada parte (suficiente para overlap relativo).
 * Usado en clip.js y clip_exclude.js.
 */
function areaFeature(feat) {
  const g = feat.geometry;
  if (!g) return 0;
  if (g.type === 'Polygon')      return areaRing(g.coordinates[0] || []);
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + areaRing(p[0] || []), 0);
  return 0;
}

/**
 * areaGeometria(geom) → number (m²)
 *
 * Igual que areaFeature pero recibe una geometry directa (sin wrapper Feature).
 * Usado en intersect.js e intersect_exclude.js, que trabajan con geometrías
 * extraídas del resultado de turf/intersect.
 */
function areaGeometria(geom) {
  if (!geom) return 0;
  if (geom.type === 'Polygon')      return areaRing(geom.coordinates[0] || []);
  if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((s, p) => s + areaRing(p[0] || []), 0);
  return 0;
}

module.exports = { normalizarMascara, areaRing, areaFeature, areaGeometria };
