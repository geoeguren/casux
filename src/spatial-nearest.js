/**
 * src/spatial-nearest.js — Nearest (nearest / nearest_exclude)
 *
 * Maneja ambas operaciones:
 *   - op 'nearest':         los N features más CERCANOS a una referencia
 *   - op 'nearest_exclude': los N features más LEJANOS a una referencia
 *
 * Referencia puede ser:
 *   nearestArea: { layerKey, field, value } — área/división administrativa
 *   nearestPoint: { lat, lng }              — punto explícito
 *
 * nearestCount: cuántos features devolver (default: 1)
 *
 * Casos de uso:
 *   "los 5 aeropuertos más cercanos a Rosario"
 *   "el hospital más cercano a San Juan"
 *   "los 3 municipios más lejanos de Buenos Aires"
 *
 * Dependencias: spatial-utils.js (window._SPATIAL_UTILS)
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_NEAREST = (() => {

  const EDGE_FN_URL = '/api/nearest';
  const U = () => window._SPATIAL_UTILS;

  // ── Edge Function ─────────────────────────────────────────────

  async function nearestViaEdgeFunction(layerDef, wfsOpts, cql, areaFeature, instruccion) {
    const isExclude  = instruccion.op === 'nearest_exclude';
    const nearestCount = instruccion.nearestCount || 1;

    const body = {
      exclude:      isExclude,
      typename:     layerDef.typename,
      wfsBase:      wfsOpts.wfsBase    || undefined,
      wfsVersion:   wfsOpts.wfsVersion || undefined,
      restBase:     wfsOpts.restBase   || undefined,
      cqlFilter:    !wfsOpts.restBase ? (cql || undefined) : undefined,
      whereClause:  wfsOpts.restBase   ? (cql || undefined) : undefined,
      nearestCount,
    };

    if (instruccion.nearestPoint) {
      body.nearestPoint = instruccion.nearestPoint;
    } else if (areaFeature) {
      body.nearestArea = areaFeature;
    }

    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      // 55s: Vercel Hobby corta la función serverless a los 60s.
      // El cliente no debe esperar más que eso — de lo contrario aguarda
      // en silencio 30s extra después de que el servidor ya murió.
      signal:  AbortSignal.timeout(55000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Fallback Web Worker ───────────────────────────────────────

  function nearestWithWorker(layerGeoJSON, refPoint, nearestCount, op) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/src/workers/nearest-worker.js');
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
        worker.postMessage({ op, layerFeatures: layerGeoJSON.features, refPoint, nearestCount });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature) {
    const isArcgis    = !!wfsOpts.restBase;
    const op          = instruccion.op;
    const nearestCount = instruccion.nearestCount || 1;

    // nearest siempre va al servidor — necesita todos los features para encontrar los N más cercanos
    if (U().deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await nearestViaEdgeFunction(layerDef, wfsOpts, cql, areaFeature, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:nearest] Edge Function falló, usando Worker:', edgeErr.message);
        U().toastFallbackOnce();
      }
    } else {
      console.log(`[SPATIAL:nearest] Capa pequeña (${layerDef.featureCount ?? '?'} feat) — cliente.`);
      U().toastFallbackOnce();
    }

    // Fallback cliente — fetchear toda la capa (sin bbox)
    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const fetchOpts     = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter:   cql || undefined };

    const layerGeoJSON = await clientFetcher.fetch(layerDef.typename, fetchOpts);
    if (!layerGeoJSON.features?.length) return { type: 'FeatureCollection', features: [] };

    // Resolver punto de referencia para el Worker
    let refPoint;
    if (instruccion.nearestPoint) {
      refPoint = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [instruccion.nearestPoint.lng, instruccion.nearestPoint.lat] },
        properties: {},
      };
    } else if (areaFeature) {
      // Calcular centroide del área de referencia
      if (typeof turf !== 'undefined') {
        try { refPoint = turf.centroid(areaFeature); } catch {}
      }
      if (!refPoint) {
        // Fallback: usar coordenada central del bbox
        const bbox = U().calcularBbox(areaFeature);
        refPoint = {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2] },
          properties: {},
        };
      }
    }

    if (!refPoint) throw new Error('[SPATIAL:nearest] No se pudo resolver el punto de referencia');

    try {
      return await nearestWithWorker(layerGeoJSON, refPoint, nearestCount, op);
    } catch (workerErr) {
      console.error('[SPATIAL:nearest] Worker falló:', workerErr.message);
      throw new Error('La operación nearest es demasiado pesada para este dispositivo.');
    }
  }

  return { ejecutar };

})();
