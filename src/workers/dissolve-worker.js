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

/**
 * dissolverFeatures(features) → FeatureCollection
 *
 * Une todos los features en uno solo según su tipo de geometría:
 *
 *   Polígono / MultiPolígono
 *     → turf.union iterado → un único Polygon o MultiPolygon
 *       (comportamiento original)
 *
 *   LineString / MultiLineString
 *     → MultiLineString con todos los segmentos recopilados.
 *       Cada LineString aporta su array de coordenadas.
 *       Cada MultiLineString aporta todos sus sub-arrays.
 *       Útil para: "dissolve los tramos de la Ruta 40" → una sola
 *       MultiLineString con todos los tramos como un único feature.
 *
 *   Point / MultiPoint
 *     → MultiPoint con todas las coordenadas recopiladas.
 *
 * Si solo hay un feature, lo devuelve directamente.
 * Si la colección es vacía, devuelve FeatureCollection vacía.
 */
function dissolverFeatures(features) {
  if (!features.length) return { type: 'FeatureCollection', features: [] };

  // Clasificar por tipo base
  const poligonos = [];
  const lineas    = [];
  const puntos    = [];

  for (const f of features) {
    const t = f.geometry?.type;
    if (!t) continue;
    if (t === 'Polygon'     || t === 'MultiPolygon')    poligonos.push(f);
    else if (t === 'LineString'  || t === 'MultiLineString') lineas.push(f);
    else if (t === 'Point'       || t === 'MultiPoint')      puntos.push(f);
  }

  // Polígonos → turf.union iterado
  if (poligonos.length) {
    if (poligonos.length === 1) return { type: 'FeatureCollection', features: [poligonos[0]] };
    const resultado = poligonos.reduce((acc, feat) => {
      try { return turf.union(acc, feat); }
      catch { return acc; }
    });
    if (!resultado.properties || !Object.keys(resultado.properties).length) {
      resultado.properties = poligonos[0]?.properties || {};
    }
    return { type: 'FeatureCollection', features: [resultado] };
  }

  // Líneas → MultiLineString
  if (lineas.length) {
    if (lineas.length === 1) return { type: 'FeatureCollection', features: [lineas[0]] };
    const coords = [];
    for (const f of lineas) {
      if (f.geometry.type === 'LineString') {
        coords.push(f.geometry.coordinates);
      } else {
        for (const sub of f.geometry.coordinates) coords.push(sub);
      }
    }
    return {
      type: 'FeatureCollection',
      features: [{
        type:       'Feature',
        geometry:   { type: 'MultiLineString', coordinates: coords },
        properties: lineas[0]?.properties || {},
      }],
    };
  }

  // Puntos → MultiPoint
  if (puntos.length) {
    if (puntos.length === 1) return { type: 'FeatureCollection', features: [puntos[0]] };
    const coords = [];
    for (const f of puntos) {
      if (f.geometry.type === 'Point') {
        coords.push(f.geometry.coordinates);
      } else {
        for (const coord of f.geometry.coordinates) coords.push(coord);
      }
    }
    return {
      type: 'FeatureCollection',
      features: [{
        type:       'Feature',
        geometry:   { type: 'MultiPoint', coordinates: coords },
        properties: puntos[0]?.properties || {},
      }],
    };
  }

  // Sin geometrías reconocidas — devolver tal cual
  return { type: 'FeatureCollection', features };
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
