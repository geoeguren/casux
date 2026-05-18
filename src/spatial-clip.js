/**
 * src/spatial-clip.js — Recorte geométrico (clip)
 *
 * Extraído de src/clip.js. Contiene toda la lógica de recorte espacial:
 * fetch de la máscara, unión de features, bbox pre-filtro, llamada a la
 * edge function con fallback a Worker y Turf síncrono.
 *
 * Consumido exclusivamente por src/spatial.js.
 * No se expone como global — es un módulo interno del sistema espacial.
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

  // Delegado a window.UTILS.normalizar (src/utils.js) — fuente única de verdad.
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

    // Si hay un unico feature MultiPolygon, descomponerlo antes de union
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
    // Construir instrucciones WFS para la máscara si están disponibles.
    // En lugar de mandar el polígono completo en el body (puede superar 4.5MB en
    // provincias grandes como Buenos Aires), le decimos al servidor cómo buscarlo.
    let maskPayload;
    const clipArea = instruccion?.clipArea;
    if (clipArea?.layerKey && clipArea?.field && clipArea?.value) {
      const maskDef    = window.LAYERS?.[clipArea.layerKey];
      const maskSource = maskDef && window.SOURCES?.[maskDef.source];
      if (maskDef && maskSource?.wfsBase) {
        // Si value es array, usar IN(...) en lugar de ='valor'
        const values   = Array.isArray(clipArea.value) ? clipArea.value : [clipArea.value];
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
    // Fallback: mandar el GeoJSON directamente (compatibilidad con casos sin clipArea)
    if (!maskPayload) {
      maskPayload = { mask: { type: 'FeatureCollection', features: [maskFeature] } };
    }

    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        op:         instruccion.op || 'clip',
        typename:   layerDef.typename,
        wfsBase:    wfsOpts.wfsBase,
        wfsVersion: wfsOpts.wfsVersion,
        cqlFilter:  cql || undefined,
        bbox,
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

  // Clip rápido para capas de puntos — sin Worker ni Turf.
  // booleanPointInPolygon sobre una geometría compleja (ej: costa de Aisén)
  // puede tardar o colgarse en el Worker. Para puntos, un ray-casting manual
  // sobre el Polygon/MultiPolygon normalizado es O(n×v) y termina siempre.
  function _clipPuntosDirecto(features, maskFeature) {
    const geom = maskFeature.geometry;
    if (!geom) return [];

    // Extraer solo los rings exteriores (index 0 de cada polígono).
    // Los rings interiores (agujeros) invertirían el resultado del ray-casting.
    // MultiPolygon: [ [ [exteriorRing, ...holeRings] ], [ [exteriorRing] ] ]
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

    const clipped = [];
    for (const feat of features) {
      try {
        const g = feat.geometry;
        if (!g) continue;
        const coords = g.type === 'Point'
          ? [g.coordinates]
          : g.coordinates;  // MultiPoint
        if (coords.some(([lon, lat]) => puntoDentro(lon, lat))) {
          clipped.push(feat);
        }
      } catch { /* ignorar feature rota */ }
    }
    console.log(`[SPATIAL:clip] _clipPuntosDirecto: ${features.length} → ${clipped.length} puntos dentro de ${geom.type}`);
    return clipped;
  }

  // ── Fallback Turf síncrono ────────────────────────────────────

  // Descarta sub-polígonos satelitales del resultado del clip.
  // Mismo criterio que api/clip.js: sub-polígonos < 10% del mayor se eliminan.
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

  function clipWithTurf(layerGeoJSON, maskFeature) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible');
    const clipped = [];

    layerGeoJSON.features.forEach(feat => {
      try {
        const geom = feat.geometry?.type;
        if (!geom) return;

        if (geom === 'Point' || geom === 'MultiPoint') {
          if (turf.booleanPointInPolygon(feat, maskFeature)) clipped.push(feat);

        } else if (geom === 'LineString' || geom === 'MultiLineString') {
          // bboxClip recortaba por el rectángulo envolvente — reemplazado por
          // lineSplit + booleanPointInPolygon para recorte real contra el polígono.
          const lines = geom === 'LineString'
            ? [feat.geometry.coordinates]
            : feat.geometry.coordinates;
          for (const coords of lines) {
            const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties };
            try {
              const split = turf.lineSplit(line, maskFeature);
              if (!split.features?.length) {
                // 0 segmentos = no cruza el borde = puede estar completamente adentro
                const midCoord = coords[Math.floor(coords.length / 2)];
                const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
                if (turf.booleanPointInPolygon(midPt, maskFeature)) {
                  clipped.push({ ...line, properties: feat.properties });
                }
              } else {
                for (const seg of split.features) {
                  const sc = seg.geometry.coordinates;
                  const mid = [
                    (sc[0][0] + sc[sc.length - 1][0]) / 2,
                    (sc[0][1] + sc[sc.length - 1][1]) / 2,
                  ];
                  const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
                  if (turf.booleanPointInPolygon(midPt, maskFeature)) {
                    clipped.push({ ...seg, properties: feat.properties });
                  }
                }
              }
            } catch {
              const midIdx = Math.floor(coords.length / 2);
              const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: coords[midIdx] }, properties: {} };
              if (turf.booleanPointInPolygon(midPt, maskFeature)) clipped.push(feat);
            }
          }

        } else if (geom === 'Polygon' || geom === 'MultiPolygon') {
          const inter = turf.intersect(feat, maskFeature);
          if (inter) {
            // Descartar si el overlap es < 5% del área original
            const areaOrig  = turf.area(feat);
            const areaInter = turf.area(inter);
            const ratio     = areaOrig > 0 ? areaInter / areaOrig : 1;
            if (ratio >= 0.05) {
              inter.properties = feat.properties;
              clipped.push(limpiarFragmentos(inter));
            }
          }
        }
      } catch { /* feature individual rota — ignorar */ }
    });

    return { type: 'FeatureCollection', features: clipped };
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  // ── Decisión: edge function vs cliente directo ────────────────
  //
  // La edge function vale cuando puede devolver MENOS datos que la capa completa:
  // fetchea + recorta en el servidor y manda solo el resultado al cliente.
  // No vale cuando el cliente va a bajar la capa completa de todas formas:
  //   - Exclusiones (clip_exclude, intersect_exclude): necesitan todos los features
  //   - Capas pequeñas (featureCount <= UMBRAL): el overhead del roundtrip supera al ahorro
  //   - ArcGIS REST: el edge function no lo soporta (solo WFS)
  //
  // Umbral empírico: 500 features. Una capa de 500 puntos viaja en ~100KB,
  // el Worker la procesa en <1s. Por encima, el recorte servidor empieza a ahorrar.
  const EDGE_FN_UMBRAL = 500;

  function deberiaUsarEdgeFunction(layerDef, op, isArcgis) {
    if (isArcgis)                  return false; // edge function solo soporta WFS
    if (op?.includes('exclude'))   return false; // exclusiones necesitan todos los features
    const fc = layerDef?.featureCount;
    if (fc !== undefined && fc <= EDGE_FN_UMBRAL) return false; // capa pequeña
    return true; // capa grande WFS → vale la pena el edge function
  }

  /**
   * ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature)
   *
   * Recibe el feature de máscara ya resuelto desde spatial.js.
   * Decide si usar edge function o cliente directo según featureCount y op.
   */
  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const bbox     = calcularBbox(maskFeature);
    const isArcgis = !!wfsOpts.restBase;
    const op       = instruccion.op || 'clip';

    // ── Camino principal: edge function (capas grandes WFS) ───
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
      } else {
        console.log(`[SPATIAL:clip] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente directamente.`);
      }
      toastFallbackOnce();
    }

    // ── Fallback cliente (WFS y ArcGIS REST) ─────────────────
    let maskParaFallback = maskFeature;
    if (maskFeature.geometry?.type === 'MultiPolygon') {
      maskParaFallback = await unionFeatures([maskFeature]);
    }

    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined, bbox };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const layerGeoJSON  = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    // Para ArcGIS: filtrar por bbox manualmente (REST no soporta bbox espacial directo)
    const featuresEnArea = isArcgis
      ? layerGeoJSON.features.filter(f => _intersectaBbox(f, bbox))
      : layerGeoJSON.features;

    const geoParaClip = { type: 'FeatureCollection', features: featuresEnArea };

    // Puntos: path rápido directo en hilo principal — evita Worker y Turf CDN.
    // booleanPointInPolygon sobre geometrías costeras complejas (ej: Aisén)
    // puede colgarse en el Worker; el ray-casting manual termina siempre.
    const solosPuntos = featuresEnArea.every(f => {
      const t = f.geometry?.type;
      return t === 'Point' || t === 'MultiPoint';
    });
    if (solosPuntos) {
      const clipped = _clipPuntosDirecto(featuresEnArea, maskParaFallback);
      return { type: 'FeatureCollection', features: clipped };
    }

    try {
      return await clipWithWorker(geoParaClip, maskParaFallback, instruccion.op || 'clip');
    } catch (workerErr) {
      console.warn('[SPATIAL:clip] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return clipWithTurf(geoParaClip, maskParaFallback);
    }
  }

  // Filtro rápido bbox para pre-seleccionar features ArcGIS antes del clip geométrico.
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
    } catch { return true; } // en caso de error, incluir
  }

  // ── Toast de fallback — una sola vez por renderizado ─────────
  // Si hay múltiples capas en un mapa y todas caen al fallback cliente,
  // el toast se mostraría N veces seguidas. Este guard lo dispara solo
  // si pasaron más de 2 segundos desde la última vez.
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
