/**
 * src/spatial-buffer.js — Área de influencia (buffer)
 *
 * Genera un buffer alrededor de un feature y devuelve las features
 * de la capa pedida que caen dentro de ese área de influencia.
 *
 * Ejemplo: "localidades a menos de 50km de Rosario"
 *   1. Busca el feature de Rosario (bufferArea.layerKey/field/value)
 *   2. Genera buffer de 50km con turf.buffer (CDN)
 *   3. Fetch WFS de localidades con bbox del buffer como pre-filtro
 *   4. Filtra las que caen dentro via api/buffer.js
 *
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_BUFFER = (() => {

  const EDGE_FN_URL = '/api/buffer';

  // ── Generación del buffer ─────────────────────────────────────

  /**
   * Genera el polígono de buffer usando Turf.js del CDN (window.turf).
   * Devuelve un Feature<Polygon>.
   */
  function generarBuffer(feature, distanceKm) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible para generar buffer');
    const buffered = turf.buffer(feature, distanceKm, { units: 'kilometers' });
    if (!buffered) throw new Error(`[SPATIAL:buffer] turf.buffer devolvió null (distancia: ${distanceKm}km)`);
    return buffered;
  }

  /**
   * Calcula el bbox de cualquier feature GeoJSON (polígono o punto).
   * Usa turf.bbox del CDN — más robusto para tipos arbitrarios.
   */
  function calcularBboxBuffer(bufferFeature) {
    if (typeof turf !== 'undefined') {
      const [minX, minY, maxX, maxY] = turf.bbox(bufferFeature);
      return { minX, minY, maxX, maxY };
    }
    // Fallback manual si turf no está disponible (no debería ocurrir)
    return window._SPATIAL_CLIP.calcularBbox(bufferFeature);
  }

  // ── Edge Function ─────────────────────────────────────────────

  async function bufferViaEdgeFunction(layerDef, wfsOpts, cql, areaFeature, distanceKm) {
    const resp = await fetch(EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        // Instrucciones WFS — el servidor busca los datos directamente al IGN/IGM
        typename:      layerDef.typename,
        wfsBase:       wfsOpts.wfsBase,
        wfsVersion:    wfsOpts.wfsVersion,
        cqlFilter:     cql || undefined,
        // Feature central del buffer (ej: punto de Rosario) — el servidor genera el círculo
        bufferFeature: areaFeature,
        distanceKm,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Fallback Web Worker ───────────────────────────────────────

  function bufferWithWorker(layerGeoJSON, bufferFeature) {
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
          op:            'buffer',
          layerFeatures: layerGeoJSON.features,
          bufferFeature,
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Fallback Turf síncrono ────────────────────────────────────

  function bufferWithTurf(layerGeoJSON, bufferFeature) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible');
    const result = [];

    layerGeoJSON.features.forEach(feat => {
      try {
        const geomType = feat.geometry?.type;
        if (!geomType) return;

        if (geomType === 'Point') {
          if (turf.booleanPointInPolygon(feat, bufferFeature)) result.push(feat);

        } else if (geomType === 'MultiPoint') {
          const tocaAlguno = feat.geometry.coordinates.some(coord =>
            turf.booleanPointInPolygon(
              { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
              bufferFeature
            )
          );
          if (tocaAlguno) result.push(feat);

        } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
          const coordsList = geomType === 'LineString'
            ? feat.geometry.coordinates
            : feat.geometry.coordinates.flat();
          const tocaAlguno = coordsList.some(coord =>
            turf.booleanPointInPolygon(
              { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
              bufferFeature
            )
          );
          if (tocaAlguno) result.push(feat);

        } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          const inter = turf.intersect(feat, bufferFeature);
          if (inter) result.push(feat); // feature completo, no recortado
        }
      } catch { /* feature individual rota — ignorar */ }
    });

    return { type: 'FeatureCollection', features: result };
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  /**
   * ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature)
   *
   * areaFeature: el feature central del buffer (ej: el punto/polígono de Rosario),
   * ya resuelto por spatial.js desde bufferArea.
   * distanceKm: viene de instruccion.bufferArea.distanceKm.
   *
   * Para capas ArcGIS REST (Chile/MOP): el edge function solo entiende WFS,
   * así que se salta y se va directo al fallback cliente con REST.fetch().
   *
   * Si el servidor falla, el cliente genera el círculo localmente con Turf,
   * hace el fetch y procesa con Worker o Turf síncrono.
   */
  async function ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature) {
    const distanceKm = instruccion.bufferArea?.distanceKm;
    if (!distanceKm || distanceKm <= 0) {
      throw new Error(`[SPATIAL:buffer] distanceKm inválido: ${distanceKm}`);
    }

    const isArcgis = !!wfsOpts.restBase;
    const op       = instruccion.op || 'buffer';

    // ── Camino principal: edge function (capas grandes WFS) ───
    if (window._SPATIAL_CLIP.deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await bufferViaEdgeFunction(layerDef, wfsOpts, cql, areaFeature, distanceKm);
      } catch (edgeErr) {
        console.warn('[SPATIAL:buffer] Edge Function falló, usando Worker:', edgeErr.message);
        window._SPATIAL_CLIP.toastFallbackOnce();
      }
    } else {
      if (isArcgis) {
        console.log('[SPATIAL:buffer] Fuente ArcGIS REST — procesando en cliente directamente.');
      } else {
        console.log(`[SPATIAL:buffer] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente directamente.`);
      }
      window._SPATIAL_CLIP.toastFallbackOnce();
    }

    // ── Fallback cliente (WFS y ArcGIS REST) ─────────────────
    const bufferFeature = generarBuffer(areaFeature, distanceKm);
    const bbox          = calcularBboxBuffer(bufferFeature);

    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined, bbox };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const layerGeoJSON  = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    try {
      return await bufferWithWorker(layerGeoJSON, bufferFeature);
    } catch (workerErr) {
      console.warn('[SPATIAL:buffer] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return bufferWithTurf(layerGeoJSON, bufferFeature);
    }
  }

  return { ejecutar };

})();
