/**
 * src/spatial-clip.js — Recorte geométrico (clip / clip_exclude)
 *
 * Maneja ambas operaciones:
 *   - op 'clip':         conserva features DENTRO del área
 *   - op 'clip_exclude': conserva features FUERA del área
 *
 * Utilidades compartidas (calcularBbox, unionFeatures, deberiaUsarEdgeFunction,
 * toastFallbackOnce, _clipPuntosDirecto, normalizar) viven en spatial-utils.js
 * y se acceden vía window._SPATIAL_UTILS.
 *
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_CLIP = (() => {

  const EDGE_FN_URL = '/api/clip';

  // ── Alias locales de utilidades compartidas ───────────────────

  const U = () => window._SPATIAL_UTILS;

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
        bbox:       isExclude ? undefined : bbox,
        ...maskPayload,
      }),
      signal: AbortSignal.timeout(90000),
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

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const bbox      = U().calcularBbox(maskFeature);
    const isArcgis  = !!wfsOpts.restBase;
    const op        = instruccion.op || 'clip';
    const isExclude = op === 'clip_exclude';

    // ── Camino principal: edge function ───────────────────────
    if (U().deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await clipViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:clip] Edge Function falló, usando Worker:', edgeErr.message);
        U().toastFallbackOnce();
      }
    } else {
      if (isArcgis) {
        console.log('[SPATIAL:clip] Fuente ArcGIS REST — procesando en cliente directamente.');
      } else if (isExclude) {
        console.log(`[SPATIAL:clip] clip_exclude — fetch directo sin bbox (${layerDef.featureCount ?? '?'} features esperados).`);
      } else {
        console.log(`[SPATIAL:clip] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente directamente.`);
      }
      U().toastFallbackOnce();
    }

    // ── Fallback cliente ─────────────────────────────────────

    let maskParaFallback = maskFeature;
    if (maskFeature.geometry?.type === 'MultiPolygon') {
      const polys = maskFeature.geometry.coordinates;
      if (polys.length > 1 || isExclude) {
        maskParaFallback = await U().unionFeatures([maskFeature]);
      }
    }

    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined, ...(isExclude ? {} : { bbox }) };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const layerGeoJSON  = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    const featuresParaProcesar = (isArcgis && !isExclude)
      ? layerGeoJSON.features.filter(f => _intersectaBbox(f, bbox))
      : layerGeoJSON.features;

    const geoParaClip = { type: 'FeatureCollection', features: featuresParaProcesar };

    const solosPuntos = featuresParaProcesar.every(f => {
      const t = f.geometry?.type;
      return t === 'Point' || t === 'MultiPoint';
    });
    if (solosPuntos) {
      const clipped = U()._clipPuntosDirecto(featuresParaProcesar, maskParaFallback, isExclude);
      return { type: 'FeatureCollection', features: clipped };
    }

    try {
      return await clipWithWorker(geoParaClip, maskParaFallback, op);
    } catch (workerErr) {
      // Para operaciones _exclude no caer al Turf síncrono:
      // necesitan procesar toda la capa y bloquearían el hilo principal.
      // TODO (largo plazo): simplificar el polígono máscara (turf.simplify con
      // tolerance ~0.01) antes de mandarlo al Worker para reducir la carga
      // geométrica en capas grandes con máscaras complejas.
      if (isExclude) {
        console.error('[SPATIAL:clip] Worker falló en clip_exclude:', workerErr.message);
        throw new Error('La operación es demasiado pesada para procesar en este dispositivo. Intentá con un área más pequeña.');
      }
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

  return { ejecutar };

})();
