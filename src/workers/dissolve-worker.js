/**
 * src/workers/dissolve-worker.js — Web Worker para dissolve espacial
 *
 * Corre en un hilo separado para no bloquear la UI.
 * Actúa como fallback de api/dissolve.js.
 *
 * Operaciones:
 *   'dissolve':         Une todos los features en uno solo.
 *   'dissolve_exclude': Excluye features dentro de maskFeature, une el resto.
 *
 * Recibe: { op, layerFeatures, maskFeature? }
 * Envía:  { result } o { error }
 */

importScripts('/src/workers/turf.min.js');

// ── Helpers ───────────────────────────────────────────────────────

function featureDentroMascara(feat, maskFeature) {
  const geom = feat.geometry?.type;
  if (!geom) return false;
  try {
    if (geom === 'Point') {
      return turf.booleanPointInPolygon(feat, maskFeature);
    }
    if (geom === 'MultiPoint') {
      return feat.geometry.coordinates.some(c =>
        turf.booleanPointInPolygon(
          { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
          maskFeature
        )
      );
    }
    // Líneas y polígonos: usar punto medio como aproximación
    const coords = geom === 'Polygon'
      ? feat.geometry.coordinates[0]
      : geom === 'MultiPolygon'
        ? feat.geometry.coordinates[0][0]
        : geom === 'LineString'
          ? feat.geometry.coordinates
          : feat.geometry.coordinates[0];
    if (!coords?.length) return false;
    const mid = coords[Math.floor(coords.length / 2)];
    return turf.booleanPointInPolygon(
      { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} },
      maskFeature
    );
  } catch {
    return false;
  }
}

function dissolverFeatures(features) {
  const poligonos = features.filter(f => {
    const t = f.geometry?.type;
    return t === 'Polygon' || t === 'MultiPolygon';
  });

  if (!poligonos.length) {
    // Sin polígonos — devolver features tal cual
    return { type: 'FeatureCollection', features };
  }

  if (poligonos.length === 1) {
    return { type: 'FeatureCollection', features: [poligonos[0]] };
  }

  const resultado = poligonos.reduce((acc, feat) => {
    try { return turf.union(acc, feat); }
    catch { return acc; }
  });

  // Preservar propiedades del primer feature
  if (!resultado.properties || Object.keys(resultado.properties).length === 0) {
    resultado.properties = poligonos[0]?.properties || {};
  }

  return { type: 'FeatureCollection', features: [resultado] };
}

onmessage = function(e) {
  try {
    const { op, layerFeatures, maskFeature } = e.data;

    if (op === 'dissolve') {
      postMessage({ result: dissolverFeatures(layerFeatures) });

    } else if (op === 'dissolve_exclude') {
      if (!maskFeature) {
        postMessage({ error: 'dissolve_exclude requiere maskFeature' });
        return;
      }
      const filtrados = layerFeatures.filter(f => !featureDentroMascara(f, maskFeature));
      postMessage({ result: dissolverFeatures(filtrados) });

    } else {
      postMessage({ error: `Operación desconocida: ${op}` });
    }

  } catch (err) {
    postMessage({ error: err.message });
  }
};
