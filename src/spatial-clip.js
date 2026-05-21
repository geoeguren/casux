/**
 * src/spatial-clip.js — Recorte geométrico (clip / clip_exclude)
 *
 * Maneja ambas operaciones en un único módulo:
 *   - op 'clip':         conserva features DENTRO del área
 *   - op 'clip_exclude': conserva features FUERA del área
 *
 * Para clip: intenta via edge function /api/clip (capas grandes WFS).
 * Para clip_exclude: siempre procesa en cliente (necesita todos los features).
 *
 * Flujo:
 *   1. Edge function /api/clip (con exclude: true/false en el body)
 *   2. Fallback: Worker (clip-worker.js con op 'clip' o 'clip_exclude')
 *   3. Fallback: Turf síncrono
 *
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_CLIP = (() => {

  const EDGE_FN_URL = '/api/clip';

  // ── Helpers ───────────────────────────────────────────────────

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

  const normalizar = (texto) => window.UTILS.normalizar(texto);

  // ── Unión de múltiples features (máscara con varios polígonos) ─

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

  // ── Edge Function ─────────────────────────────────────────────

  async function clipViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion) {
    const isExclude = instruccion.op === 'clip_exclude';

    let maskPayload;
    const clipArea = instruccion?.clipArea;
    if (clipArea?.layerKey && clipArea?.field && clipArea?.value) {
      const maskDef    = window.LAYERS?.[clipArea.layerKey];
      const maskSource = maskDef && window.SOURCES?.[maskDef.source];
      if (maskDef && maskSource?.wfsBase) {
        const values    = Array.isArray(clipArea.value) ? clipArea.value : [clipArea.value];
        const cqlFilter = values.length === 1
          ? `${clipArea.field}='${values[0]}'`
          : `${clipArea.field} IN (${values.map(v => `'${v}'`).join(',')})`;
        maskPayload = {
          maskInstructions: {
            typename:   maskDef.typename,
            wfsBase:    maskSource.wfsBase,
            wfsVersion: maskSource.wfsVersion || '1.1.0',
            cqlFilter,
          }
        };
      }
    }
    if (!maskPayload) {
      maskPayload = { mask: { type: 'FeatureCollection', features: [maskFeature] } };
    }

    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        exclude:    isExclude,
        typename:   layerDef.typename,
        wfsBase:    wfsOpts.wfsBase,
        wfsVersion: wfsOpts.wfsVersion,
        cqlFilter:  cql || undefined,
        // clip_exclude necesita todos los features — no mandar bbox
        bbox:       isExclude ? undefined : bbox,
        ...maskPayload,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Fallback Web Worker ───────────────────────────────────────

  function clipWithWorker(layerGeoJSON, maskFeature, op = 'clip') {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/src/workers/clip-worker.js');
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error('Worker timeout (30s)'));
        }, 30000);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(e.message || 'Worker error'));
        };
        worker.postMessage({
          op,
          layerFeatures: layerGeoJSON.features,
          maskFeature,
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Ray-casting directo para capas de puntos (sin Worker ni Turf).
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
      } catch { /* ignorar feature rota */ }
    }
    const op = exclude ? 'clip_exclude' : 'clip';
    console.log(`[SPATIAL:clip] _clipPuntosDirecto (${op}): ${features.length} → ${result.length}`);
    return result;
  }

  // ── Fallback Turf síncrono ────────────────────────────────────

  function limpiarFragmentos(feat) {
    if (feat.geometry?.type !== 'MultiPolygon') return feat;
    const partes = feat.geometry.coordinates;
    if (partes.length <= 1) return feat;
    const areas = partes.map(coords => turf.area({ type: 'Feature', geometry: { type: 'Polygon', coordinates: coords } }));
    const maxArea = Math.max(...areas);
    const filtradas = partes.filter((_, i) => areas[i] >= maxArea * 0.10);
    if (filtradas.length === 0) return feat;
    if (filtradas.length === 1) return { ...feat, geometry: { type: 'Polygon', coordinates: filtradas[0] } };
    return { ...feat, geometry: { type: 'MultiPolygon', coordinates: filtradas } };
  }

  function clipWithTurf(layerGeoJSON, maskFeature, exclude = false) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible');
    const OVERLAP_MIN = 0.05;
    const result = [];

    layerGeoJSON.features.forEach(feat => {
      try {
        const geom = feat.geometry?.type;
        if (!geom) return;

        if (geom === 'Point' || geom === 'MultiPoint') {
          const inside = turf.booleanPointInPolygon(feat, maskFeature);
          if (exclude ? !inside : inside) result.push(feat);

        } else if (geom === 'LineString' || geom === 'MultiLineString') {
          const lines = geom === 'LineString'
            ? [feat.geometry.coordinates]
            : feat.geometry.coordinates;
          for (const coords of lines) {
            const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties };
            try {
              const split = turf.lineSplit(line, maskFeature);
              if (!split.features?.length) {
                const midCoord = coords[Math.floor(coords.length / 2)];
                const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
                const inside = turf.booleanPointInPolygon(midPt, maskFeature);
                if (exclude ? !inside : inside) result.push({ ...line, properties: feat.properties });
              } else {
                for (const seg of split.features) {
                  const sc = seg.geometry.coordinates;
                  const mid = [
                    (sc[0][0] + sc[sc.length - 1][0]) / 2,
                    (sc[0][1] + sc[sc.length - 1][1]) / 2,
                  ];
                  const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
                  const inside = turf.booleanPointInPolygon(midPt, maskFeature);
                  if (exclude ? !inside : inside) result.push({ ...seg, properties: feat.properties });
                }
              }
            } catch {
              const midIdx = Math.floor(coords.length / 2);
              const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: coords[midIdx] }, properties: {} };
              const inside = turf.booleanPointInPolygon(midPt, maskFeature);
              if (exclude ? !inside : inside) result.push(feat);
            }
          }

        } else if (geom === 'Polygon' || geom === 'MultiPolygon') {
          const inter = turf.intersect(feat, maskFeature);
          if (exclude) {
            if (!inter) {
              result.push(feat);
            } else {
              const ratio = turf.area(feat) > 0 ? turf.area(inter) / turf.area(feat) : 1;
              if (ratio < OVERLAP_MIN) result.push(feat);
            }
          } else {
            if (inter) {
              const ratio = turf.area(feat) > 0 ? turf.area(inter) / turf.area(feat) : 1;
              if (ratio >= OVERLAP_MIN) {
                inter.properties = feat.properties;
                result.push(limpiarFragmentos(inter));
              }
            }
          }
        }
      } catch { /* feature individual rota — ignorar */ }
    });

    return { type: 'FeatureCollection', features: result };
  }

  // ── Decisión: edge function vs cliente directo ────────────────
  //
  // clip_exclude siempre procesa en cliente: necesita todos los features.
  // ArcGIS REST: edge function solo soporta WFS.
  // Capas pequeñas: el overhead del roundtrip supera al ahorro.

  const EDGE_FN_UMBRAL = 500;

  function deberiaUsarEdgeFunction(layerDef, op, isArcgis) {
    if (isArcgis)                   return false;
    if (op === 'clip_exclude')      return false;
    if (op === 'buffer_exclude')    return false;
    const fc = layerDef?.featureCount;
    if (fc !== undefined && fc <= EDGE_FN_UMBRAL) return false;
    return true;
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const bbox      = calcularBbox(maskFeature);
    const isArcgis  = !!wfsOpts.restBase;
    const op        = instruccion.op || 'clip';
    const isExclude = op === 'clip_exclude';

    // ── Camino principal: edge function (clip inclusivo, WFS grande) ───
    if (deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await clipViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:clip] Edge Function falló, usando Worker:', edgeErr.message);
        toastFallbackOnce();
      }
    } else {
      if (isArcgis) {
        console.log('[SPATIAL:clip] Fuente ArcGIS REST — procesando en cliente directamente.');
      } else if (isExclude) {
        console.log(`[SPATIAL:clip] clip_exclude — fetch directo sin bbox (${layerDef.featureCount ?? '?'} features esperados).`);
      } else {
        console.log(`[SPATIAL:clip] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente directamente.`);
      }
      toastFallbackOnce();
    }

    // ── Fallback cliente ─────────────────────────────────────────

    // Normalizar máscara MultiPolygon para el Worker/Turf
    let maskParaFallback = maskFeature;
    if (maskFeature.geometry?.type === 'MultiPolygon') {
      const polys = maskFeature.geometry.coordinates;
      if (polys.length > 1 || isExclude) {
        maskParaFallback = await unionFeatures([maskFeature]);
      }
    }

    // clip_exclude necesita todos los features — sin bbox
    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined, ...(isExclude ? {} : { bbox }) };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const layerGeoJSON  = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    // Para ArcGIS clip inclusivo: pre-filtrar por bbox
    const featuresParaProcesar = (isArcgis && !isExclude)
      ? layerGeoJSON.features.filter(f => _intersectaBbox(f, bbox))
      : layerGeoJSON.features;

    const geoParaClip = { type: 'FeatureCollection', features: featuresParaProcesar };

    // Puntos: ray-casting directo
    const solosPuntos = featuresParaProcesar.every(f => {
      const t = f.geometry?.type;
      return t === 'Point' || t === 'MultiPoint';
    });
    if (solosPuntos) {
      const clipped = _clipPuntosDirecto(featuresParaProcesar, maskParaFallback, isExclude);
      return { type: 'FeatureCollection', features: clipped };
    }

    try {
      return await clipWithWorker(geoParaClip, maskParaFallback, op);
    } catch (workerErr) {
      console.warn('[SPATIAL:clip] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return clipWithTurf(geoParaClip, maskParaFallback, isExclude);
    }
  }

  // Filtro rápido bbox para pre-seleccionar features ArcGIS
  function _intersectaBbox(feature, bbox) {
    try {
      const coords = [];
      const geom   = feature.geometry;
      if (!geom) return false;
      JSON.stringify(geom, (_, v) => {
        if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') coords.push(v);
        return v;
      });
      return coords.some(([lon, lat]) =>
        lon >= bbox.minX && lon <= bbox.maxX && lat >= bbox.minY && lat <= bbox.maxY
      );
    } catch { return true; }
  }

  // ── Toast de fallback — una sola vez por renderizado ─────────
  let _lastFallbackToast = 0;
  function toastFallbackOnce() {
    const now = Date.now();
    if (now - _lastFallbackToast > 2000) {
      _lastFallbackToast = now;
      window.TOAST?.info(window.t?.('toast_spatial_fallback') || 'Procesando en el dispositivo…');
    }
  }

  return { ejecutar, unionFeatures, calcularBbox, normalizar, toastFallbackOnce, _clipPuntosDirecto, deberiaUsarEdgeFunction };

})();
