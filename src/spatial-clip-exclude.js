/**
 * src/spatial-clip-exclude.js — Clip inverso (cliente)
 *
 * Complemento de spatial-clip.js: conserva las features que quedan
 * FUERA del área de recorte en lugar de las que quedan adentro.
 *
 * Mismo flujo que spatial-clip.js:
 *   1. Intenta via edge function /api/clip_exclude
 *   2. Si falla, fallback al Worker con op 'clip_exclude'
 *   3. Si el Worker falla, fallback a Turf síncrono
 *
 * Expuesto como window._SPATIAL_CLIP_EXCLUDE.
 * Invocado desde spatial.js cuando instruccion.op === 'clip_exclude'.
 */

window._SPATIAL_CLIP_EXCLUDE = (() => {

  const EDGE_FN_URL = '/api/clip_exclude';

  // ── Edge function ─────────────────────────────────────────────

  async function clipExcludeViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion) {
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
        typename:   layerDef.typename,
        wfsBase:    wfsOpts.wfsBase,
        wfsVersion: wfsOpts.wfsVersion,
        cqlFilter:  cql || undefined,
        // Sin bbox: para exclusión necesitamos TODOS los features, no solo los del área.
        // El bbox de la máscara filtraría exactamente lo que queremos conservar.
        ...maskPayload,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) throw new Error(`Edge Function HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Web Worker ────────────────────────────────────────────────

  function clipExcludeWithWorker(layerGeoJSON, maskFeature) {
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
          op:            'clip_exclude',
          layerFeatures: layerGeoJSON.features,
          maskFeature,
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Fallback Turf síncrono ────────────────────────────────────

  function clipExcludeWithTurf(layerGeoJSON, maskFeature) {
    if (!window.turf) throw new Error('Turf no disponible');
    const OVERLAP_MIN = 0.05;
    const result = [];

    for (const feat of layerGeoJSON.features || []) {
      try {
        const geom = feat.geometry?.type;
        if (!geom) continue;

        if (geom === 'Point' || geom === 'MultiPoint') {
          if (!turf.booleanPointInPolygon(feat, maskFeature)) result.push(feat);

        } else if (geom === 'LineString' || geom === 'MultiLineString') {
          const lines = geom === 'LineString' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
          for (const coords of lines) {
            const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties };
            try {
              const split = turf.lineSplit(line, maskFeature);
              if (!split.features?.length) {
                const midCoord = coords[Math.floor(coords.length / 2)];
                const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
                if (!turf.booleanPointInPolygon(midPt, maskFeature)) result.push({ ...line, properties: feat.properties });
              } else {
                for (const seg of split.features) {
                  const sc = seg.geometry.coordinates;
                  const mid = [(sc[0][0] + sc[sc.length-1][0])/2, (sc[0][1] + sc[sc.length-1][1])/2];
                  const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
                  if (!turf.booleanPointInPolygon(midPt, maskFeature)) result.push({ ...seg, properties: feat.properties });
                }
              }
            } catch {
              const midIdx = Math.floor(coords.length / 2);
              const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: coords[midIdx] }, properties: {} };
              if (!turf.booleanPointInPolygon(midPt, maskFeature)) result.push(feat);
            }
          }

        } else if (geom === 'Polygon' || geom === 'MultiPolygon') {
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
  // clip_exclude siempre procesa en cliente: necesita todos los features
  // para excluir los que están dentro, así que el edge function no aporta nada
  // (bajaría la capa igual) y solo agrega latencia y riesgo de timeout.

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const isArcgis = !!wfsOpts.restBase;

    // Normalizar máscara para el Worker/Turf.
    // Si es MultiPolygon y tiene más de un polígono, unir en uno solo.
    // Con un solo feature no hace falta Worker — devolver directo.
    let maskParaFallback = maskFeature;
    if (maskFeature.geometry?.type === 'MultiPolygon') {
      const polys = maskFeature.geometry.coordinates;
      if (polys.length > 1) {
        maskParaFallback = await window._SPATIAL_CLIP.unionFeatures([maskFeature]);
      }
    }

    // Fetch completo de la capa — sin bbox porque necesitamos todo
    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    console.log(`[SPATIAL:clip_exclude] Fetch directo — ${layerDef.featureCount ?? '?'} features esperados`);
    const layerGeoJSON = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) return { type: 'FeatureCollection', features: [] };

    // Puntos: ray-casting inverso directo en hilo principal
    const solosPuntos = layerGeoJSON.features.every(f => {
      const t = f.geometry?.type;
      return t === 'Point' || t === 'MultiPoint';
    });
    if (solosPuntos) {
      const geom = maskParaFallback.geometry;
      const exteriores = geom.type === 'Polygon'
        ? [geom.coordinates[0]]
        : geom.coordinates.map(p => p[0]);
      function puntoDentro(lon, lat) {
        let inside = false;
        for (const ring of exteriores) {
          let j = ring.length - 1;
          for (let i = 0; i < ring.length; i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
            j = i;
          }
        }
        return inside;
      }
      const resultado = layerGeoJSON.features.filter(feat => {
        const g = feat.geometry;
        if (!g) return false;
        const coords = g.type === 'Point' ? [g.coordinates] : g.coordinates;
        return !coords.some(([lon, lat]) => puntoDentro(lon, lat));
      });
      console.log(`[SPATIAL:clip_exclude] ${resultado.length} features fuera del área`);
      return { type: 'FeatureCollection', features: resultado };
    }

    try {
      return await clipExcludeWithWorker(layerGeoJSON, maskParaFallback);
    } catch (workerErr) {
      console.warn('[SPATIAL:clip_exclude] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return clipExcludeWithTurf(layerGeoJSON, maskParaFallback);
    }
  }

  return { ejecutar };

})();
