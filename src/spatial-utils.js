/**
 * src/spatial-utils.js — Utilidades compartidas del sistema espacial
 *
 * Extraído de src/spatial-clip.js, donde vivía por razones históricas.
 * Consumido por spatial-clip.js, spatial-intersect.js y spatial-buffer.js.
 *
 * Debe cargarse ANTES que los otros módulos espaciales en el HTML.
 *
 * Expone: window._SPATIAL_UTILS
 */

window._SPATIAL_UTILS = (() => {

  // ── calcularBbox ──────────────────────────────────────────────
  //
  // Calcula el bounding box de un feature Polygon o MultiPolygon.
  // Devuelve { minX, minY, maxX, maxY }.

  function calcularBbox(feature) {
    const coords = [];
    function extraer(anillo) { anillo.forEach(c => coords.push(c)); }

    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      geom.coordinates.forEach(extraer);
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(poligono => poligono.forEach(extraer));
    }

    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    return {
      minX: Math.min(...lons),
      minY: Math.min(...lats),
      maxX: Math.max(...lons),
      maxY: Math.max(...lats),
    };
  }

  // ── normalizar ────────────────────────────────────────────────
  //
  // Delegado a window.UTILS.normalizar (src/utils.js) — fuente única de verdad.
  // Convierte texto a minúsculas, elimina tildes, normaliza espacios.

  function normalizar(texto) {
    return window.UTILS.normalizar(texto);
  }

  // ── unionFeatures ─────────────────────────────────────────────
  //
  // Une múltiples features polígono en uno solo usando el clip-worker.
  // Usado para normalizar máscaras MultiPolygon antes de operar.

  function unionFeatures(features) {
    return new Promise((resolve) => {
      try {
        const worker = new Worker('/src/workers/clip-worker.js');
        worker.onmessage = (e) => {
          worker.terminate();
          resolve(e.data.error ? features[0] : e.data.result);
        };
        worker.onerror = () => { worker.terminate(); resolve(unionFeaturesSync(features)); };
        worker.postMessage({ op: 'union', features });
      } catch {
        resolve(unionFeaturesSync(features));
      }
    });
  }

  function unionFeaturesSync(features) {
    if (typeof turf === 'undefined') return features[0];

    if (features.length === 1) {
      const feat = features[0];
      if (feat.geometry?.type !== 'MultiPolygon') return feat;
      const subpoligonos = feat.geometry.coordinates.map(coords => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: coords },
        properties: feat.properties || {},
      }));
      if (subpoligonos.length === 1) return subpoligonos[0];
      try {
        return subpoligonos.reduce((acc, p) => turf.union(acc, p));
      } catch {
        return subpoligonos[0];
      }
    }

    try {
      return features.reduce((acc, feat) => turf.union(acc, feat));
    } catch {
      return features[0];
    }
  }

  // ── _clipPuntosDirecto ────────────────────────────────────────
  //
  // Ray-casting para capas de puntos — sin Worker ni Turf.
  // Más robusto que booleanPointInPolygon en geometrías costeras complejas.
  // exclude=false → devuelve puntos dentro del polígono.
  // exclude=true  → devuelve puntos fuera del polígono.

  function _clipPuntosDirecto(features, maskFeature, exclude = false) {
    const geom = maskFeature.geometry;
    if (!geom) return [];

    let exteriores;
    if (geom.type === 'Polygon') {
      exteriores = [geom.coordinates[0]];
    } else if (geom.type === 'MultiPolygon') {
      exteriores = geom.coordinates.map(poligono => poligono[0]);
    } else {
      return [];
    }

    function puntoDentro(lon, lat) {
      let inside = false;
      for (const ring of exteriores) {
        let j = ring.length - 1;
        for (let i = 0; i < ring.length; i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (((yi > lat) !== (yj > lat)) &&
              (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
            inside = !inside;
          }
          j = i;
        }
      }
      return inside;
    }

    const result = [];
    for (const feat of features) {
      try {
        const g = feat.geometry;
        if (!g) continue;
        const coords = g.type === 'Point'
          ? [g.coordinates]
          : g.coordinates; // MultiPoint
        const inside = coords.some(([lon, lat]) => puntoDentro(lon, lat));
        if (exclude ? !inside : inside) result.push(feat);
      } catch { /* feature rota — ignorar */ }
    }

    const op = exclude ? 'exclude' : 'include';
    console.log(`[SPATIAL:utils] _clipPuntosDirecto (${op}): ${features.length} → ${result.length}`);
    return result;
  }

  // ── deberiaUsarEdgeFunction ───────────────────────────────────
  //
  // Decide si el procesamiento va al servidor (edge function) o al cliente.
  //
  // Casos en que siempre procesa en cliente:
  //   - ArcGIS REST: la edge function solo soporta WFS
  //   - Operaciones _exclude: necesitan TODOS los features, el bbox las rompe
  //   - Capas pequeñas (≤ EDGE_FN_UMBRAL): overhead del roundtrip supera al ahorro
  //
  // En cualquier otro caso, la edge function ahorra ancho de banda: fetchea
  // en el servidor con bbox pre-filtro y manda solo el resultado al cliente.

  const EDGE_FN_UMBRAL = 500;

  function deberiaUsarEdgeFunction(layerDef, op, isArcgis) {
    if (isArcgis)                    return false;
    if (op === 'clip_exclude')       return false;
    if (op === 'intersect_exclude')  return false;
    if (op === 'buffer_exclude')     return false;
    // dissolve siempre va al servidor — necesita union de Turf
    // dissolve_exclude también (necesita todos los features + unión)
    if (op === 'dissolve')               return true;
    if (op === 'dissolve_exclude')       return true;
    // within_layer siempre va al servidor — buffer + filtrado más eficiente allá
    // within_layer_exclude también (necesita todos los features)
    if (op === 'within_layer')           return true;
    if (op === 'within_layer_exclude')   return true;
    // adjacent siempre va al servidor — booleanTouches requiere Turf server-side
    if (op === 'adjacent')               return true;
    if (op === 'adjacent_exclude')       return true;
    // nearest siempre va al servidor — necesita todos los features para ordenar
    if (op === 'nearest')                return true;
    if (op === 'nearest_exclude')        return true;
    const fc = layerDef?.featureCount;
    if (fc !== undefined && fc <= EDGE_FN_UMBRAL) return false;
    return true;
  }

  // ── toastFallbackOnce ─────────────────────────────────────────
  //
  // Muestra un toast "Procesando en el dispositivo…" como máximo una vez
  // cada 2 segundos, evitando spam cuando hay múltiples capas en un mapa.

  let _lastFallbackToast = 0;

  function toastFallbackOnce() {
    const now = Date.now();
    if (now - _lastFallbackToast > 2000) {
      _lastFallbackToast = now;
      window.TOAST?.info(window.t?.('toast_spatial_fallback') || 'Procesando en el dispositivo…');
    }
  }

  // ── API pública ───────────────────────────────────────────────

  return {
    calcularBbox,
    normalizar,
    unionFeatures,
    unionFeaturesSync,
    _clipPuntosDirecto,
    deberiaUsarEdgeFunction,
    toastFallbackOnce,
  };

})();
