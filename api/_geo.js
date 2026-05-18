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

module.exports = { normalizarMascara };
