/**
 * src/spatial-within_layer.js — Within layer (within_layer / within_layer_exclude)
 *
 * Reemplaza y absorbe src/spatial-buffer.js.
 *
 * Maneja ambas operaciones:
 *   - op 'within_layer':         features a ≤ X km de la referencia
 *   - op 'within_layer_exclude': features a > X km de la referencia
 *
 * Tipos de referencia:
 *   1. Punto explícito  { withinPoint: { lat, lng } }
 *   2. Área/división    { withinArea: GeoJSON feature }
 *   3. Capa del catálogo { refLayerGeoJSON: GeoJSON FeatureCollection }
 *
 * El tipo 1 (punto) es el equivalente directo del buffer anterior.
 * Los tipos 2 y 3 son capacidades nuevas.
 *
 * Compatibilidad con buffer:
 *   src/spatial.js convierte op:'buffer' → op:'within_layer' antes de llegar acá.
 *   bufferArea.distanceKm → withinDistance
 *   areaFeature (punto/polígono) → withinPoint o withinArea según geometría
 *
 * Dependencias: spatial-utils.js (window._SPATIAL_UTILS)
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_WITHIN_LAYER = (() => {

  const EDGE_FN_URL = '/api/within_layer';

  const U = () => window._SPATIAL_UTILS;

  // ── Generación del buffer (para punto/área de referencia) ─────

  function generarBuffer(feature, distanceKm) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible para generar buffer');
    const buffered = turf.buffer(feature, distanceKm, { units: 'kilometers' });
    if (!buffered) throw new Error(`turf.buffer devolvió null (distancia: ${distanceKm}km)`);
    return buffered;
  }

  function calcularBboxBuffer(bufferFeature) {
    if (typeof turf !== 'undefined') {
      const [minX, minY, maxX, maxY] = turf.bbox(bufferFeature);
      return { minX, minY, maxX, maxY };
    }
    return U().calcularBbox(bufferFeature);
  }

  // ── Edge Function ─────────────────────────────────────────────

  async function withinLayerViaEdgeFunction(layerDef, wfsOpts, cql, instruccion) {
    const isExclude    = instruccion.op === 'within_layer_exclude';
    const withinDistance = instruccion.withinDistance;
    const withinPoint  = instruccion.withinPoint   || null;
    const withinArea   = instruccion.withinArea    || null;
    const refLayerGeoJSON = instruccion.refLayerGeoJSON || null;

    const body = {
      exclude:         isExclude,
      typename:        layerDef.typename,
      wfsBase:         wfsOpts.wfsBase    || undefined,
      wfsVersion:      wfsOpts.wfsVersion || undefined,
      restBase:        wfsOpts.restBase   || undefined,
      cqlFilter:       !wfsOpts.restBase ? (cql || undefined) : undefined,
      whereClause:     wfsOpts.restBase   ? (cql || undefined) : undefined,
      withinDistance,
    };

    if (withinPoint)     body.withinPoint  = withinPoint;
    if (withinArea)      body.withinArea   = withinArea;
    if (refLayerGeoJSON) body.refLayer     = refLayerGeoJSON;

    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(90000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Fallback Web Worker ───────────────────────────────────────

  function withinLayerWithWorker(layerGeoJSON, refData, withinDistance, op) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/src/workers/within_layer-worker.js');
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
          withinDistance,
          ...refData, // withinPoint?, bufferFeature?, refFeatures?
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature) {
    const op         = instruccion.op;
    const isExclude  = op === 'within_layer_exclude';
    const isArcgis   = !!wfsOpts.restBase;

    // Resolver withinDistance y tipo de referencia
    // Compatibilidad: buffer antiguo usaba bufferArea.distanceKm + areaFeature
    const withinDistance = instruccion.withinDistance
      || instruccion.bufferArea?.distanceKm
      || instruccion.withinArea?.distanceKm;

    if (!withinDistance || withinDistance <= 0) {
      throw new Error(`[SPATIAL:within_layer] withinDistance inválido: ${withinDistance}`);
    }

    // Normalizar la referencia en instruccion para la edge function
    if (areaFeature && !instruccion.withinPoint && !instruccion.withinArea && !instruccion.refLayerGeoJSON) {
      const geomType = areaFeature.geometry?.type;
      if (geomType === 'Point') {
        instruccion.withinPoint = {
          lat: areaFeature.geometry.coordinates[1],
          lng: areaFeature.geometry.coordinates[0],
        };
      } else {
        instruccion.withinArea = areaFeature;
      }
    }
    instruccion.withinDistance = withinDistance;

    // ── Camino principal: edge function ───────────────────────
    if (U().deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await withinLayerViaEdgeFunction(layerDef, wfsOpts, cql, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:within_layer] Edge Function falló, usando Worker:', edgeErr.message);
        U().toastFallbackOnce();
      }
    } else {
      if (isArcgis) {
        console.log('[SPATIAL:within_layer] Fuente ArcGIS REST — procesando en cliente.');
      } else {
        console.log(`[SPATIAL:within_layer] Capa pequeña (${layerDef.featureCount ?? '?'} feat) — cliente.`);
      }
      U().toastFallbackOnce();
    }

    // ── Fallback cliente ─────────────────────────────────────
    // Generar buffer si la referencia es punto o área
    let bufferFeature = null;
    let refFeatures   = null;

    if (instruccion.refLayerGeoJSON) {
      refFeatures = instruccion.refLayerGeoJSON.features || [];
    } else {
      const refFeat = areaFeature || (instruccion.withinPoint
        ? { type: 'Feature', geometry: { type: 'Point', coordinates: [instruccion.withinPoint.lng, instruccion.withinPoint.lat] }, properties: {} }
        : null);
      if (refFeat) bufferFeature = generarBuffer(refFeat, withinDistance);
    }

    const fetchBbox = (!isExclude && bufferFeature)
      ? calcularBboxBuffer(bufferFeature)
      : undefined;

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const fetchOpts     = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined, ...(fetchBbox ? { bbox: fetchBbox } : {}) }
      : { ...wfsOpts, cqlFilter: cql || undefined, ...(fetchBbox ? { bbox: fetchBbox } : {}) };

    const layerGeoJSON = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    const refData = bufferFeature
      ? { bufferFeature }
      : { refFeatures };

    try {
      return await withinLayerWithWorker(layerGeoJSON, refData, withinDistance, op);
    } catch (workerErr) {
      console.error('[SPATIAL:within_layer] Worker falló:', workerErr.message);
      throw new Error('La operación es demasiado pesada para este dispositivo.');
    }
  }

  return { ejecutar };

})();
