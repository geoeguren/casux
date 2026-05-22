/**
 * src/workers/within_layer-worker.js — Web Worker para within_layer
 *
 * Reemplaza buffer-worker.js como fallback del cliente.
 *
 * Operaciones:
 *   'within_layer':         features a ≤ withinDistance km de la referencia
 *   'within_layer_exclude': features a > withinDistance km
 *
 * Tipos de referencia (uno de los tres):
 *   bufferFeature: GeoJSON polígono ya generado (punto/área de referencia)
 *   refFeatures:   array de features de la capa de referencia (caso 3)
 *
 * Recibe: { op, layerFeatures, withinDistance, bufferFeature?, refFeatures? }
 * Envía:  { result } o { error }
 */

importScripts('/src/workers/turf.min.js');

// ── Filtrar por buffer ─────────────────────────────────────────────

function filtrarPorBuffer(layerFeatures, bufferFeature, isExclude) {
  const bufFeat = bufferFeature.features?.[0] || bufferFeature;
  // Normalizar MultiPolygon → Polygon
  let bufNorm = bufFeat;
  if (bufFeat.geometry?.type === 'MultiPolygon') {
    try {
      const polys = bufFeat.geometry.coordinates.map(coords => ({
        type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: {},
      }));
      bufNorm = polys.reduce((acc, f) => turf.union(acc, f));
    } catch {}
  }

  const result = [];
  for (const feat of layerFeatures) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;
      let dentro = false;

      if (geomType === 'Point') {
        dentro = turf.booleanPointInPolygon(feat, bufNorm);
      } else if (geomType === 'MultiPoint') {
        dentro = feat.geometry.coordinates.some(c =>
          turf.booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
            bufNorm
          )
        );
      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        const coords = geomType === 'LineString'
          ? feat.geometry.coordinates
          : feat.geometry.coordinates.flat();
        dentro = coords.some(c =>
          turf.booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
            bufNorm
          )
        );
      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        dentro = !!(turf.intersect(feat, bufNorm));
      }

      if (isExclude ? !dentro : dentro) result.push(feat);
    } catch {}
  }
  return result;
}

// ── Filtrar por distancia a capa de referencia ─────────────────────

function getCentroid(feat) {
  try { return turf.centroid(feat); }
  catch { return null; }
}

function distanciaMinima(feat, refFeatures) {
  const c = getCentroid(feat);
  if (!c) return Infinity;
  let min = Infinity;
  for (const ref of refFeatures) {
    const rc = getCentroid(ref);
    if (!rc) continue;
    try {
      const d = turf.distance(c, rc, { units: 'kilometers' });
      if (d < min) min = d;
    } catch {}
  }
  return min;
}

function filtrarPorDistancia(layerFeatures, refFeatures, withinDistance, isExclude) {
  const result = [];
  for (const feat of layerFeatures) {
    try {
      const dist  = distanciaMinima(feat, refFeatures);
      const cerca = dist <= withinDistance;
      if (isExclude ? !cerca : cerca) result.push(feat);
    } catch {}
  }
  return result;
}

// ── Handler ────────────────────────────────────────────────────────

onmessage = function(e) {
  try {
    const { op, layerFeatures, withinDistance, bufferFeature, refFeatures } = e.data;
    const isExclude = op === 'within_layer_exclude';

    let result;
    if (refFeatures) {
      result = filtrarPorDistancia(layerFeatures, refFeatures, withinDistance, isExclude);
    } else if (bufferFeature) {
      result = filtrarPorBuffer(layerFeatures, bufferFeature, isExclude);
    } else {
      postMessage({ error: 'Se requiere bufferFeature o refFeatures' });
      return;
    }

    postMessage({ result: { type: 'FeatureCollection', features: result } });
  } catch (err) {
    postMessage({ error: err.message });
  }
};
