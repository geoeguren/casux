/**
 * src/workers/nearest-worker.js — Web Worker para nearest
 *
 * Fallback de api/nearest.js.
 *
 * Operaciones:
 *   'nearest':         los N features más cercanos al punto de referencia
 *   'nearest_exclude': los N features más lejanos
 *
 * Recibe: { op, layerFeatures, refPoint, nearestCount }
 * Envía:  { result } o { error }
 *
 * La distancia se calcula al centroide de cada feature.
 * El resultado incluye _distanciaKm en las propiedades de cada feature.
 */

importScripts('/src/workers/turf.min.js');

function getCentroid(feat) {
  try { return turf.centroid(feat); }
  catch { return null; }
}

onmessage = function(e) {
  try {
    const { op, layerFeatures, refPoint, nearestCount = 1 } = e.data;
    const isExclude = op === 'nearest_exclude';
    const count     = Math.max(1, Math.min(100, parseInt(nearestCount, 10) || 1));

    const conDistancia = [];
    for (const feat of layerFeatures) {
      try {
        const c = getCentroid(feat);
        if (!c) continue;
        const dist = turf.distance(refPoint, c, { units: 'kilometers' });
        conDistancia.push({ feat, dist });
      } catch {}
    }

    conDistancia.sort((a, b) => a.dist - b.dist);

    const seleccionados = isExclude
      ? conDistancia.slice(-count).reverse()
      : conDistancia.slice(0, count);

    const features = seleccionados.map(({ feat, dist }) => ({
      ...feat,
      properties: { ...feat.properties, _distanciaKm: Math.round(dist * 10) / 10 },
    }));

    postMessage({ result: { type: 'FeatureCollection', features } });
  } catch (err) {
    postMessage({ error: err.message });
  }
};
