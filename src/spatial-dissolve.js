/**
 * src/spatial-dissolve.js — Dissolve espacial (dissolve / dissolve_exclude)
 *
 * Maneja ambas operaciones:
 *   - op 'dissolve':         une features de la capa en un único polígono
 *   - op 'dissolve_exclude': une los features que quedan FUERA de un área geográfica
 *
 * Utilidades compartidas viven en spatial-utils.js (window._SPATIAL_UTILS).
 * Consumido exclusivamente por src/spatial.js.
 *
 * Diferencia con clip/intersect:
 *   - No necesita máscara para dissolve simple — opera sobre la capa misma
 *   - dissolve_exclude sí necesita un área para saber qué excluir
 *   - El resultado siempre es UN solo feature (el polígono unido)
 *
 * TODO (Camino A — maskInstructions):
 *   Ver comentario en spatial-clip.js — misma deuda técnica aplica acá
 *   para dissolve_exclude cuando la máscara viene como GeoJSON inline.
 */

window._SPATIAL_DISSOLVE = (() => {

  const EDGE_FN_URL = '/api/dissolve';

  const U = () => window._SPATIAL_UTILS;

  // ── Edge Function ─────────────────────────────────────────────

  async function dissolveViaEdgeFunction(layerDef, wfsOpts, cql, maskFeature, instruccion) {
    const isExclude   = instruccion.op === 'dissolve_exclude';
    const dissolveArea = instruccion?.dissolveArea;

    // Construir maskPayload solo para dissolve_exclude
    let maskPayload = {};
    if (isExclude && maskFeature) {
      // Intentar mandar maskInstructions en lugar del GeoJSON completo
      // (ver TODO en spatial-clip.js sobre la deuda técnica del Camino B)
      if (dissolveArea?.layerKey && dissolveArea?.field && dissolveArea?.value) {
        const maskDef    = window.LAYERS?.[dissolveArea.layerKey];
        const maskSource = maskDef && window.SOURCES?.[maskDef.source];
        if (maskDef && maskSource?.wfsBase) {
          const values    = Array.isArray(dissolveArea.value) ? dissolveArea.value : [dissolveArea.value];
          const cqlFilter = values.length === 1
            ? `${dissolveArea.field}='${values[0]}'`
            : `${dissolveArea.field} IN (${values.map(v => `'${v}'`).join(',')})`;
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

      // TODO: Migrar máscara al Camino A (maskInstructions) — ver spatial-clip.js
      if (!maskPayload.maskInstructions) {
        maskPayload = { mask: { type: 'FeatureCollection', features: [maskFeature] } };
      }
    }

    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        exclude:    isExclude,
        typename:   layerDef.typename,
        wfsBase:    wfsOpts.wfsBase    || undefined,
        wfsVersion: wfsOpts.wfsVersion || undefined,
        restBase:   wfsOpts.restBase   || undefined,
        cqlFilter:  !wfsOpts.restBase ? (cql || undefined) : undefined,
        whereClause: wfsOpts.restBase  ? (cql || undefined) : undefined,
        ...maskPayload,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Fallback Web Worker ───────────────────────────────────────

  function dissolveWithWorker(layerGeoJSON, maskFeature, op) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/src/workers/dissolve-worker.js');
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
        worker.postMessage({
          op,
          layerFeatures: layerGeoJSON.features,
          maskFeature:   maskFeature || null,
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const isArcgis  = !!wfsOpts.restBase;
    const op        = instruccion.op;
    const isExclude = op === 'dissolve_exclude';

    // dissolve siempre va al servidor — necesita union de Turf y puede ser costoso
    // (especialmente dissolve_exclude que necesita todos los features)
    // No hay umbral de featureCount — siempre edge function primero
    if (U().deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await dissolveViaEdgeFunction(layerDef, wfsOpts, cql, maskFeature, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:dissolve] Edge Function falló, usando Worker:', edgeErr.message);
        U().toastFallbackOnce();
      }
    } else {
      console.log(`[SPATIAL:dissolve] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente.`);
      U().toastFallbackOnce();
    }

    // ── Fallback cliente ─────────────────────────────────────
    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const fetchOpts     = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter:   cql || undefined };

    const layerGeoJSON = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      window.TOAST?.warning(t('toast_dissolve_empty'));
      return { type: 'FeatureCollection', features: [] };
    }

    try {
      return await dissolveWithWorker(layerGeoJSON, maskFeature || null, op);
    } catch (workerErr) {
      console.error('[SPATIAL:dissolve] Worker falló:', workerErr.message);
      throw new Error('La operación de dissolve es demasiado pesada para este dispositivo. Intentá con menos features.');
    }
  }

  return { ejecutar };

})();
