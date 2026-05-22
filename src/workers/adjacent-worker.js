/**
 * src/workers/adjacent-worker.js — Web Worker para adyacencia espacial
 *
 * Fallback de api/adjacent.js.
 *
 * Operaciones:
 *   'adjacent':         features que SON adyacentes al área
 *   'adjacent_exclude': features que NO son adyacentes
 *
 * Recibe: { op, layerFeatures, maskFeature }
 * Envía:  { result } o { error }
 */

importScripts('/src/workers/turf.min.js');

function esAdyacente(feat, maskFeature) {
  const geomType = feat.geometry?.type;
  if (!geomType) return false;
  try {
    if (geomType === 'Point') {
      return turf.booleanPointInPolygon(feat, maskFeature, { ignoreBoundary: false });
    }
    if (geomType === 'MultiPoint') {
      return feat.geometry.coordinates.some(c =>
        turf.booleanPointInPolygon(
          { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
          maskFeature, { ignoreBoundary: false }
        )
      );
    }
    if (geomType === 'LineString' || geomType === 'MultiLineString') {
      const coords = geomType === 'LineString'
        ? feat.geometry.coordinates
        : feat.geometry.coordinates.flat();
      return coords.some(c =>
        turf.booleanPointInPolygon(
          { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
          maskFeature, { ignoreBoundary: false }
        )
      );
    }
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      try { if (turf.booleanTouches(feat, maskFeature)) return true; } catch {}
      try { return !!(turf.intersect(feat, maskFeature)); } catch {}
    }
  } catch {}
  return false;
}

onmessage = function(e) {
  try {
    const { op, layerFeatures, maskFeature } = e.data;
    const isExclude = op === 'adjacent_exclude';
    const result    = [];
    for (const feat of layerFeatures) {
      try {
        const adj = esAdyacente(feat, maskFeature);
        if (isExclude ? !adj : adj) result.push(feat);
      } catch {}
    }
    postMessage({ result: { type: 'FeatureCollection', features: result } });
  } catch (err) {
    postMessage({ error: err.message });
  }
};
