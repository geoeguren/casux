/**
 * src/spatial-intersect-exclude.js — Intersect inverso (cliente)
 *
 * Complemento de spatial-intersect.js: devuelve features que NO tocan
 * el área dada, usando los mismos umbrales de overlap.
 *
 * Mismo flujo que spatial-intersect.js:
 *   1. Intenta via edge function /api/intersect_exclude
 *   2. Si falla, fallback al Worker con op 'intersect_exclude'
 *   3. Si el Worker falla, fallback a Turf síncrono
 *
 * Expuesto como window._SPATIAL_INTERSECT_EXCLUDE.
 * Invocado desde spatial.js cuando instruccion.op === 'intersect_exclude'.
 */

window._SPATIAL_INTERSECT_EXCLUDE = (() => {

  const EDGE_FN_URL     = '/api/intersect_exclude';
  const OVERLAP_LINE_MIN = 0.10;

  // ── Edge function ─────────────────────────────────────────────

  async function intersectExcludeViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion) {
    let maskPayload;
    const intersectArea = instruccion?.intersectArea;
    if (intersectArea?.layerKey && intersectArea?.field && intersectArea?.value) {
      const maskDef    = window.LAYERS?.[intersectArea.layerKey];
      const maskSource = maskDef && window.SOURCES?.[maskDef.source];
      if (maskDef && maskSource?.wfsBase) {
        const values    = Array.isArray(intersectArea.value) ? intersectArea.value : [intersectArea.value];
        const cqlFilter = values.length === 1
          ? `${intersectArea.field}='${values[0]}'`
          : `${intersectArea.field} IN (${values.map(v => `'${v}'`).join(',')})`;
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
        typename:   layerDef.typename,
        wfsBase:    wfsOpts.wfsBase,
        wfsVersion: wfsOpts.wfsVersion,
        cqlFilter:  cql || undefined,
        // Sin bbox: para exclusión necesitamos TODOS los features.
        ...maskPayload,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Web Worker ────────────────────────────────────────────────

  function intersectExcludeWithWorker(layerGeoJSON, maskFeature) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('/src/workers/intersect-worker.js');
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
          op:            'intersect_exclude',
          layerFeatures: layerGeoJSON.features,
          maskFeature,
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Fallback Turf síncrono ────────────────────────────────────

  function haversine([lng1, lat1], [lng2, lat2]) {
    const R = 6371000, phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
    const dphi = (lat2 - lat1) * Math.PI / 180, dlam = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dphi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dlam/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function fraccionLineaDentro(coords, mask) {
    if (coords.length < 2) return 0;
    let total = 0, dentro = 0;
    for (let i = 1; i < coords.length; i++) {
      const segLen = haversine(coords[i-1], coords[i]);
      total += segLen;
      const mid   = [(coords[i-1][0]+coords[i][0])/2, (coords[i-1][1]+coords[i][1])/2];
      const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
      if (turf.booleanPointInPolygon(midPt, mask)) dentro += segLen;
    }
    return total > 0 ? dentro / total : 0;
  }

  function intersectExcludeWithTurf(layerGeoJSON, maskFeature) {
    if (!window.turf) throw new Error('Turf no disponible');
    const OVERLAP_MIN = 0.05;
    const result = [];

    for (const feat of layerGeoJSON.features || []) {
      try {
        const t = feat.geometry?.type;
        if (!t) continue;

        if (t === 'Point') {
          if (!turf.booleanPointInPolygon(feat, maskFeature)) result.push(feat);

        } else if (t === 'MultiPoint') {
          const alguno = feat.geometry.coordinates.some(c =>
            turf.booleanPointInPolygon({ type:'Feature', geometry:{type:'Point',coordinates:c}, properties:{} }, maskFeature)
          );
          if (!alguno) result.push(feat);

        } else if (t === 'LineString') {
          if (fraccionLineaDentro(feat.geometry.coordinates, maskFeature) < OVERLAP_LINE_MIN) result.push(feat);

        } else if (t === 'MultiLineString') {
          let totalLen = 0, dentroLen = 0;
          for (const ring of feat.geometry.coordinates) {
            const len = ring.reduce((s,_,i) => i ? s + haversine(ring[i-1], ring[i]) : s, 0);
            totalLen  += len;
            dentroLen += fraccionLineaDentro(ring, maskFeature) * len;
          }
          if (totalLen === 0 || (dentroLen / totalLen) < OVERLAP_LINE_MIN) result.push(feat);

        } else if (t === 'Polygon' || t === 'MultiPolygon') {
          const inter = turf.intersect(feat, maskFeature);
          if (!inter) {
            result.push(feat);
          } else {
            const ratio = turf.area(feat) > 0 ? turf.area(inter) / turf.area(feat) : 1;
            if (ratio < OVERLAP_MIN) result.push(feat);
          }
        }
      } catch { /* feature rota — omitir */ }
    }
    return { type: 'FeatureCollection', features: result };
  }

  // ── Punto de entrada ──────────────────────────────────────────
  //
  // intersect_exclude siempre procesa en cliente: misma razón que clip_exclude,
  // necesita todos los features para poder excluir los que tocan el área.

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const isArcgis = !!wfsOpts.restBase;

    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    console.log(`[SPATIAL:intersect_exclude] Fetch directo — ${layerDef.featureCount ?? '?'} features esperados`);
    const layerGeoJSON = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) return { type: 'FeatureCollection', features: [] };

    try {
      return await intersectExcludeWithWorker(layerGeoJSON, maskFeature);
    } catch (workerErr) {
      console.warn('[SPATIAL:intersect_exclude] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return intersectExcludeWithTurf(layerGeoJSON, maskFeature);
    }
  }

  return { ejecutar };

})();
