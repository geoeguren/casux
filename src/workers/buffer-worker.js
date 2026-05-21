/**
 * src/workers/buffer-worker.js — Web Worker para filtro de área de influencia
 *
 * Operaciones soportadas:
 *   - buffer:         features DENTRO del área de influencia
 *   - buffer_exclude: features FUERA del área de influencia
 *
 * Recibe: { op: 'buffer' | 'buffer_exclude', layerFeatures, bufferFeature }
 * Envía:  { result } o { error }
 */

importScripts('/src/workers/turf.min.js');

function filterByBuffer(layerFeatures, bufferFeature, exclude) {
  const result = [];

  for (const feat of layerFeatures) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;

      let dentro = false;

      if (geomType === 'Point') {
        dentro = turf.booleanPointInPolygon(feat, bufferFeature);

      } else if (geomType === 'MultiPoint') {
        dentro = feat.geometry.coordinates.some(coord =>
          turf.booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
            bufferFeature
          )
        );

      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        const coordsList = geomType === 'LineString'
          ? feat.geometry.coordinates
          : feat.geometry.coordinates.flat();
        dentro = coordsList.some(coord =>
          turf.booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
            bufferFeature
          )
        );

      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        const inter = turf.intersect(feat, bufferFeature);
        dentro = inter !== null && inter !== undefined;
      }

      if (exclude ? !dentro : dentro) result.push(feat);

    } catch { /* feature individual rota — omitir */ }
  }

  return { type: 'FeatureCollection', features: result };
}

onmessage = function(e) {
  try {
    const { op } = e.data;

    if (op === 'buffer' || op === 'buffer_exclude') {
      const result = filterByBuffer(e.data.layerFeatures, e.data.bufferFeature, op === 'buffer_exclude');
      postMessage({ result });

    } else {
      postMessage({ error: `Operación desconocida: ${op}` });
    }

  } catch (err) {
    postMessage({ error: err.message });
  }
};
