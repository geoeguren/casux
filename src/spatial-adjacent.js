/**
 * src/spatial-adjacent.js — Adyacencia espacial (adjacent / adjacent_exclude)
 *
 * Maneja ambas operaciones:
 *   - op 'adjacent':         features que SON adyacentes al área (tocan el borde)
 *   - op 'adjacent_exclude': features que NO son adyacentes al área
 *
 * Diferencia con intersect:
 *   intersect: features que se solapan con el INTERIOR del área
 *   adjacent:  features que tocan el BORDE del área (comparten frontera)
 *
 * Caso de uso principal: "provincias que limitan con Uruguay",
 *   "departamentos adyacentes al río Paraná"
 *
 * Dependencias: spatial-utils.js (window._SPATIAL_UTILS)
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_ADJACENT = (() => {

  const EDGE_FN_URL = '/api/adjacent';
  const U = () => window._SPATIAL_UTILS;

  // ── Edge Function ─────────────────────────────────────────────

  async function adjacentViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion) {
    const isExclude    = instruccion.op === 'adjacent_exclude';
    const adjacentArea = instruccion?.adjacentArea;

    let maskPayload = {};
    if (adjacentArea?.layerKey && adjacentArea?.field && adjacentArea?.value) {
      const maskDef    = window.LAYERS?.[adjacentArea.layerKey];
      const maskSource = maskDef && window.SOURCES?.[maskDef.source];
      if (maskDef && maskSource?.wfsBase) {
        const values    = Array.isArray(adjacentArea.value) ? adjacentArea.value : [adjacentArea.value];
        const cqlFilter = values.length === 1
          ? `${adjacentArea.field}='${values[0]}'`
          : `${adjacentArea.field} IN (${values.map(v => `'${v}'`).join(',')})`;
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
    // TODO: Migrar máscara al Camino A — ver spatial-clip.js
    if (!maskPayload.maskInstructions) {
      maskPayload = { mask: { type: 'FeatureCollection', features: [maskFeature] } };
    }

    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        exclude:     isExclude,
        typename:    layerDef.typename,
        wfsBase:     wfsOpts.wfsBase    || undefined,
        wfsVersion:  wfsOpts.wfsVersion || undefined,
        restBase:    wfsOpts.restBase   || undefined,
        cqlFilter:   !wfsOpts.restBase ? (cql || undefined) : undefined,
        whereClause: wfsOpts.restBase   ? (cql || undefined) : undefined,
        bbox:        isExclude ? undefined : bbox,
        ...maskPayload,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Fallback Web Worker ───────────────────────────────────────

  function adjacentWithWorker(layerGeoJSON, maskFeature, op) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/src/workers/adjacent-worker.js');
        const timer  = setTimeout(() => {
          worker.terminate();
          reject(new Error('Worker timeout (60s)'));
        }, 60000);
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
        worker.postMessage({ op, layerFeatures: layerGeoJSON.features, maskFeature });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const bbox      = U().calcularBbox(maskFeature);
    const isArcgis  = !!wfsOpts.restBase;
    const op        = instruccion.op;
    const isExclude = op === 'adjacent_exclude';

    if (U().deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await adjacentViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:adjacent] Edge Function falló, usando Worker:', edgeErr.message);
        U().toastFallbackOnce();
      }
    } else {
      console.log(`[SPATIAL:adjacent] Capa pequeña (${layerDef.featureCount ?? '?'} feat) — cliente.`);
      U().toastFallbackOnce();
    }

    // Fallback cliente
    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const fetchOpts     = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined, ...(isExclude ? {} : { bbox }) };

    const layerGeoJSON = await clientFetcher.fetch(layerDef.typename, fetchOpts);
    if (!layerGeoJSON.features?.length) return { type: 'FeatureCollection', features: [] };

    try {
      return await adjacentWithWorker(layerGeoJSON, maskFeature, op);
    } catch (workerErr) {
      console.error('[SPATIAL:adjacent] Worker falló:', workerErr.message);
      throw new Error('La operación de adyacencia es demasiado pesada para este dispositivo.');
    }
  }

  return { ejecutar };

})();
