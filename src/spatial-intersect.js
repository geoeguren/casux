/**
 * src/spatial-intersect.js — Intersección espacial
 *
 * Devuelve features COMPLETAS que tocan un área, sin recortarlas.
 * Ejemplo: "rutas que pasan por Salta" → rutas completas, no recortadas al límite.
 *
 * Flujo:
 *   1. Recibe maskFeature ya resuelto desde spatial.js
 *   2. Calcula bbox de la máscara → fetch WFS pre-filtrado
 *   3. Llama a api/intersect.js para el filtro geométrico real
 *   4. Fallback: Worker → Turf síncrono
 *
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_INTERSECT = (() => {

  const EDGE_FN_URL = '/api/intersect';

  // ── Edge Function ─────────────────────────────────────────────

  async function intersectViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion) {
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
        op:         instruccion.op || 'intersect',
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

  function intersectWithWorker(layerGeoJSON, maskFeature, op = 'intersect') {
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
  // Mismos umbrales que api/intersect.js para resultados consistentes
  // sin importar qué ruta de ejecución se use.

  const OVERLAP_LINE_MIN    = 0.10;
  const OVERLAP_POLYGON_MIN = 0.05;

  function _haversine([lng1, lat1], [lng2, lat2]) {
    const R = 6371000;
    const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
    const dphi = (lat2 - lat1) * Math.PI / 180, dlam = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function _longitudRing(coords) {
    let t = 0;
    for (let i = 1; i < coords.length; i++) t += _haversine(coords[i - 1], coords[i]);
    return t;
  }

  function _areaRing(coords) {
    const R = 6371000; let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i], [lng2, lat2] = coords[i + 1];
      area += (lng2 - lng1) * Math.PI / 180 * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
    }
    return Math.abs(area) * R * R / 2;
  }

  function _areaGeom(geom) {
    if (!geom) return 0;
    if (geom.type === 'Polygon')      return _areaRing(geom.coordinates[0] || []);
    if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((s, p) => s + _areaRing(p[0] || []), 0);
    return 0;
  }

  function _fraccionLinea(coords, maskFeature) {
    if (coords.length < 2) return 0;
    let total = 0, dentro = 0;
    for (let i = 1; i < coords.length; i++) {
      const len = _haversine(coords[i - 1], coords[i]);
      total += len;
      const mid   = [(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2];
      const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
      if (turf.booleanPointInPolygon(midPt, maskFeature)) dentro += len;
    }
    return total > 0 ? dentro / total : 0;
  }

  function _fraccionPoligono(feat, maskFeature) {
    try {
      const res = turf.intersect(feat, maskFeature);
      if (!res) return 0;
      return _areaGeom(feat.geometry) > 0 ? _areaGeom(res.geometry) / _areaGeom(feat.geometry) : 0;
    } catch { return 0; }
  }

  function intersectWithTurf(layerGeoJSON, maskFeature) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible');
    const result = [];

    layerGeoJSON.features.forEach(feat => {
      try {
        const geomType = feat.geometry?.type;
        if (!geomType) return;

        if (geomType === 'Point') {
          if (turf.booleanPointInPolygon(feat, maskFeature)) result.push(feat);

        } else if (geomType === 'MultiPoint') {
          if (feat.geometry.coordinates.some(coord =>
            turf.booleanPointInPolygon(
              { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
              maskFeature
            )
          )) result.push(feat);

        } else if (geomType === 'LineString') {
          if (_fraccionLinea(feat.geometry.coordinates, maskFeature) >= OVERLAP_LINE_MIN) result.push(feat);

        } else if (geomType === 'MultiLineString') {
          let totalLen = 0, dentroLen = 0;
          for (const ring of feat.geometry.coordinates) {
            const len = _longitudRing(ring);
            totalLen  += len;
            dentroLen += _fraccionLinea(ring, maskFeature) * len;
          }
          if (totalLen > 0 && (dentroLen / totalLen) >= OVERLAP_LINE_MIN) result.push(feat);

        } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          if (_fraccionPoligono(feat, maskFeature) >= OVERLAP_POLYGON_MIN) result.push(feat);
        }
      } catch { /* feature individual rota — ignorar */ }
    });

    return { type: 'FeatureCollection', features: result };
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  /**
   * ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature)
   *
   * Recibe el feature de máscara ya resuelto desde spatial.js.
   * Manda las instrucciones al servidor para que haga el fetch WFS
   * y filtre las features completas que tocan el área.
   *
   * Para capas ArcGIS REST (Chile/MOP): el edge function solo entiende WFS,
   * así que se salta y se va directo al fallback cliente con REST.fetch().
   *
   * Si el servidor falla, cae al fallback local con Worker o Turf síncrono.
   */
  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const bbox     = window._SPATIAL_CLIP.calcularBbox(maskFeature);
    const isArcgis = !!wfsOpts.restBase;
    const op       = instruccion.op || 'intersect';

    // ── Camino principal: edge function (capas grandes WFS) ───
    if (window._SPATIAL_CLIP.deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await intersectViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:intersect] Edge Function falló, usando Worker:', edgeErr.message);
        window._SPATIAL_CLIP.toastFallbackOnce();
      }
    } else {
      if (isArcgis) {
        console.log('[SPATIAL:intersect] Fuente ArcGIS REST — procesando en cliente directamente.');
      } else {
        console.log(`[SPATIAL:intersect] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente directamente.`);
      }
      window._SPATIAL_CLIP.toastFallbackOnce();
    }

    // ── Fallback cliente (WFS y ArcGIS REST) ─────────────────
    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined, bbox };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const layerGeoJSON  = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    // Puntos: reutilizar el ray-casting de spatial-clip (sin Worker ni Turf).
    const solosPuntos = layerGeoJSON.features.every(f => {
      const t = f.geometry?.type;
      return t === 'Point' || t === 'MultiPoint';
    });
    if (solosPuntos) {
      const clipped = window._SPATIAL_CLIP._clipPuntosDirecto(layerGeoJSON.features, maskFeature);
      return { type: 'FeatureCollection', features: clipped };
    }

    try {
      return await intersectWithWorker(layerGeoJSON, maskFeature, instruccion.op || 'intersect');
    } catch (workerErr) {
      console.warn('[SPATIAL:intersect] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return intersectWithTurf(layerGeoJSON, maskFeature);
    }
  }

  return { ejecutar };

})();
