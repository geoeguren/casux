/**
 * src/workers/buffer-worker.js — Web Worker para filtro de área de influencia
 *
 * Corre en un hilo separado para no bloquear la UI.
 * Actúa como fallback de api/buffer.js.
 *
 * Operación: buffer
 *   El polígono de buffer ya viene generado desde src/spatial-buffer.js.
 *   Este worker solo filtra las features que caen dentro de él,
 *   devolviendo cada feature completa (sin recortar).
 *
 * Recibe: { op: 'buffer', layerFeatures, bufferFeature }
 * Envía:  { result } o { error }
 */

// NOTA: turf.min.js debe descargarse manualmente y colocarse en esta carpeta.
// Ver src/workers/README.md para instrucciones.
// URL origen: https://unpkg.com/@turf/turf@6.5.0/turf.min.js
importScripts('/src/workers/turf.min.js');

function filterByBuffer(layerFeatures, bufferFeature) {
  const result = [];

  for (const feat of layerFeatures) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;

      if (geomType === 'Point') {
        if (turf.booleanPointInPolygon(feat, bufferFeature)) result.push(feat);

      } else if (geomType === 'MultiPoint') {
        const tocaAlguno = feat.geometry.coordinates.some(coord =>
          turf.booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
            bufferFeature
          )
        );
        if (tocaAlguno) result.push(feat);

      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        // Al menos un punto de la línea dentro del buffer
        const coordsList = geomType === 'LineString'
          ? feat.geometry.coordinates
          : feat.geometry.coordinates.flat();
        const tocaAlguno = coordsList.some(coord =>
          turf.booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
            bufferFeature
          )
        );
        if (tocaAlguno) result.push(feat);

      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        const inter = turf.intersect(feat, bufferFeature);
        if (inter) result.push(feat); // feat completo, no recortado
      }
    } catch { /* feature individual rota — omitir */ }
  }

  return { type: 'FeatureCollection', features: result };
}

onmessage = function(e) {
  try {
    const { op } = e.data;

    if (op === 'buffer') {
      const result = filterByBuffer(e.data.layerFeatures, e.data.bufferFeature);
      postMessage({ result });

    } else {
      postMessage({ error: `Operación desconocida: ${op}` });
    }

  } catch (err) {
    postMessage({ error: err.message });
  }
};
