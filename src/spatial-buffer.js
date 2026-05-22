/**
 * src/spatial-buffer.js — Área de influencia (buffer / buffer_exclude)
 *
 * Maneja ambas operaciones:
 *   - op 'buffer':         features DENTRO del área de influencia
 *   - op 'buffer_exclude': features FUERA del área de influencia
 *
 * Utilidades compartidas (deberiaUsarEdgeFunction, toastFallbackOnce)
 * viven en spatial-utils.js y se acceden vía window._SPATIAL_UTILS.
 *
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_BUFFER = (() => {

  const EDGE_FN_URL = '/api/buffer';

  // ── Alias local de utilidades compartidas ─────────────────────

  const U = () => window._SPATIAL_UTILS;

  // ── Generación del buffer ─────────────────────────────────────

  function generarBuffer(feature, distanceKm) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible para generar buffer');
    const buffered = turf.buffer(feature, distanceKm, { units: 'kilometers' });
    if (!buffered) throw new Error(`[SPATIAL:buffer] turf.buffer devolvió null (distancia: ${distanceKm}km)`);
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

  async function bufferViaEdgeFunction(layerDef, wfsOpts, cql, areaFeature, distanceKm, isExclude) {
    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        typename:      layerDef.typename,
        wfsBase:       wfsOpts.wfsBase,
        wfsVersion:    wfsOpts.wfsVersion,
        cqlFilter:     cql || undefined,
        bufferFeature: areaFeature,
        distanceKm,
        exclude:       isExclude || undefined,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Fallback Web Worker ───────────────────────────────────────

  function bufferWithWorker(layerGeoJSON, bufferFeature, op = 'buffer') {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/src/workers/buffer-worker.js');
        worker.onmessage = (e) => {
          worker.terminate();
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result);
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message || 'Worker error'));
        };
        worker.postMessage({
          op,
          layerFeatures: layerGeoJSON.features,
          bufferFeature,
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Fallback Turf síncrono ────────────────────────────────────

  function bufferWithTurf(layerGeoJSON, bufferFeature, exclude = false) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible');
    const result = [];

    layerGeoJSON.features.forEach(feat => {
      try {
        const geomType = feat.geometry?.type;
        if (!geomType) return;

        let dentro = false;

        if (geomType === 'Point') {
          dentro = turf.booleanPointInPolygon(feat, bufferFeature);

        } else if (geomType === 'MultiPoint') {
          dentro = feat.geometry.coordinates.some(coord =>
            turf.booleanPointInPolygon(
              { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
              bufferFeature
            )
          );

        } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
          const coordsList = geomType === 'LineString'
            ? feat.geometry.coordinates
            : feat.geometry.coordinates.flat();
          dentro = coordsList.some(coord =>
            turf.booleanPointInPolygon(
              { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
              bufferFeature
            )
          );

        } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          const inter = turf.intersect(feat, bufferFeature);
          dentro = inter !== null && inter !== undefined;
        }

        if (exclude ? !dentro : dentro) result.push(feat);

      } catch { /* feature individual rota — ignorar */ }
    });

    return { type: 'FeatureCollection', features: result };
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature) {
    const distanceKm = instruccion.bufferArea?.distanceKm;
    if (!distanceKm || distanceKm <= 0) {
      throw new Error(`[SPATIAL:buffer] distanceKm inválido: ${distanceKm}`);
    }

    const isArcgis  = !!wfsOpts.restBase;
    const op        = instruccion.op || 'buffer';
    const isExclude = op === 'buffer_exclude';

    // ── Camino principal: edge function ───────────────────────
    if (U().deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await bufferViaEdgeFunction(layerDef, wfsOpts, cql, areaFeature, distanceKm, isExclude);
      } catch (edgeErr) {
        console.warn('[SPATIAL:buffer] Edge Function falló, usando Worker:', edgeErr.message);
        U().toastFallbackOnce();
      }
    } else {
      if (isArcgis) {
        console.log('[SPATIAL:buffer] Fuente ArcGIS REST — procesando en cliente directamente.');
      } else if (isExclude) {
        console.log(`[SPATIAL:buffer] buffer_exclude — fetch directo sin bbox (${layerDef.featureCount ?? '?'} features esperados).`);
      } else {
        console.log(`[SPATIAL:buffer] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente directamente.`);
      }
      U().toastFallbackOnce();
    }

    // ── Fallback cliente ─────────────────────────────────────
    const bufferFeature = generarBuffer(areaFeature, distanceKm);

    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : {
          ...wfsOpts,
          cqlFilter: cql || undefined,
          ...(isExclude ? {} : { bbox: calcularBboxBuffer(bufferFeature) }),
        };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const layerGeoJSON  = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    try {
      return await bufferWithWorker(layerGeoJSON, bufferFeature, op);
    } catch (workerErr) {
      // Para operaciones _exclude no caer al Turf síncrono:
      // necesitan procesar toda la capa y bloquearían el hilo principal.
      // TODO (largo plazo): simplificar el polígono del buffer (ya es círculo,
      // pero si es muy grande y la capa tiene geometrías complejas, considerar
      // reducir la resolución del buffer con steps menores en turf.buffer).
      if (isExclude) {
        console.error('[SPATIAL:buffer] Worker falló en buffer_exclude:', workerErr.message);
        throw new Error('La operación es demasiado pesada para procesar en este dispositivo. Intentá con un radio menor.');
      }
      console.warn('[SPATIAL:buffer] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return bufferWithTurf(layerGeoJSON, bufferFeature, isExclude);
    }
  }

  return { ejecutar };

})();
