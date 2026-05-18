/**
 * src/workers/intersect-worker.js — Web Worker para intersección espacial
 *
 * Corre en un hilo separado para no bloquear la UI.
 * Actúa como fallback de api/intersect.js.
 *
 * Operación: intersect
 *   Devuelve features COMPLETAS que superan el umbral de overlap con la máscara.
 *   Mismos criterios que api/intersect.js:
 *     - Líneas:    ≥ 10% de la longitud dentro de la máscara.
 *     - Polígonos: ≥ 5%  del área solapada con la máscara.
 *     - Puntos:    sin umbral (adentro o afuera).
 *
 * Recibe: { op: 'intersect', layerFeatures, maskFeature }
 * Envía:  { result } o { error }
 */

// NOTA: turf.min.js debe descargarse manualmente y colocarse en esta carpeta.
// Ver src/workers/README.md para instrucciones.
// URL origen: https://unpkg.com/@turf/turf@6.5.0/turf.min.js
importScripts('/src/workers/turf.min.js');

// Umbrales de overlap mínimo — idénticos a api/intersect.js
const OVERLAP_LINE_MIN    = 0.10;
const OVERLAP_POLYGON_MIN = 0.05;

// ── Helpers geométricos ──────────────────────────────────────────

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

function areaRing(coords) {
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    area += (lng2 - lng1) * Math.PI / 180 * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs(area) * R * R / 2;
}

function areaGeometria(geom) {
  if (!geom) return 0;
  if (geom.type === 'Polygon')      return areaRing(geom.coordinates[0] || []);
  if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((s, p) => s + areaRing(p[0] || []), 0);
  return 0;
}

function fraccionLineaDentro(coords, maskFeature) {
  if (coords.length < 2) return 0;
  let total  = 0;
  let dentro = 0;
  for (let i = 1; i < coords.length; i++) {
    const segLen = haversine(coords[i - 1], coords[i]);
    total += segLen;
    const mid   = [(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2];
    const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
    if (turf.booleanPointInPolygon(midPt, maskFeature)) dentro += segLen;
  }
  return total > 0 ? dentro / total : 0;
}

function fraccionPoligonoDentro(feat, maskFeature) {
  try {
    const resultado = turf.intersect(feat, maskFeature);
    if (!resultado) return 0;
    const areaInterseccion = areaGeometria(resultado.geometry);
    const areaTotal        = areaGeometria(feat.geometry);
    return areaTotal > 0 ? areaInterseccion / areaTotal : 0;
  } catch {
    return 0;
  }
}

function tocaMascara(feat, maskFeature) {
  const geomType = feat.geometry?.type;
  if (!geomType) return false;
  try {
    if (geomType === 'Point') {
      return turf.booleanPointInPolygon(feat, maskFeature);
    }
    if (geomType === 'MultiPoint') {
      return feat.geometry.coordinates.some(coord =>
        turf.booleanPointInPolygon(
          { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
          maskFeature
        )
      );
    }
    if (geomType === 'LineString') {
      return fraccionLineaDentro(feat.geometry.coordinates, maskFeature) >= OVERLAP_LINE_MIN;
    }
    if (geomType === 'MultiLineString') {
      let totalLen  = 0;
      let dentroLen = 0;
      for (const ring of feat.geometry.coordinates) {
        const len  = longitudRing(ring);
        totalLen  += len;
        dentroLen += fraccionLineaDentro(ring, maskFeature) * len;
      }
      return totalLen > 0 && (dentroLen / totalLen) >= OVERLAP_LINE_MIN;
    }
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      return fraccionPoligonoDentro(feat, maskFeature) >= OVERLAP_POLYGON_MIN;
    }
  } catch { /* feature rota — omitir */ }
  return false;
}

function intersectFeatures(layerFeatures, maskFeature) {
  const result = [];
  for (const feat of layerFeatures) {
    try {
      if (tocaMascara(feat, maskFeature)) result.push(feat);
    } catch { /* omitir */ }
  }
  return { type: 'FeatureCollection', features: result };
}

// Intersect inverso: excluye features que TOCAN la máscara.
// Devuelve features que NO tienen overlap con el área dada.
function intersectExcludeFeatures(layerFeatures, maskFeature) {
  const result = [];
  for (const feat of layerFeatures) {
    try {
      if (!tocaMascara(feat, maskFeature)) result.push(feat);
    } catch { /* omitir */ }
  }
  return { type: 'FeatureCollection', features: result };
}

onmessage = function(e) {
  try {
    const { op } = e.data;
    if (op === 'intersect') {
      postMessage({ result: intersectFeatures(e.data.layerFeatures, e.data.maskFeature) });
    } else if (op === 'intersect_exclude') {
      postMessage({ result: intersectExcludeFeatures(e.data.layerFeatures, e.data.maskFeature) });
    } else {
      postMessage({ error: `Operación desconocida: ${op}` });
    }
  } catch (err) {
    postMessage({ error: err.message });
  }
};
