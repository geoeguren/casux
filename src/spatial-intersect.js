/**
 * src/spatial-intersect.js — Intersección espacial (intersect / intersect_exclude)
 *
 * Maneja ambas operaciones:
 *   - op 'intersect':         features completas que TOCAN el área
 *   - op 'intersect_exclude': features completas que NO tocan el área
 *
 * Utilidades compartidas (calcularBbox, deberiaUsarEdgeFunction, toastFallbackOnce,
 * _clipPuntosDirecto) viven en spatial-utils.js y se acceden vía window._SPATIAL_UTILS.
 *
 * Consumido exclusivamente por src/spatial.js.
 */

window._SPATIAL_INTERSECT = (() => {

  const EDGE_FN_URL = '/api/intersect';

  // ── Alias local de utilidades compartidas ─────────────────────

  const U = () => window._SPATIAL_UTILS;

  // ── Edge Function ─────────────────────────────────────────────

  async function intersectViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion) {
    const isExclude = instruccion.op === 'intersect_exclude';

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
  // ── TODO: Migrar máscara al Camino A (maskInstructions) ────────────────
  //
  // HOY: el cliente resuelve el polígono de la máscara en el browser y lo
  // manda completo como GeoJSON en el body del POST. Para provincias complejas
  // (Buenos Aires, Santa Cruz) este polígono puede pesar varios MB y causar:
  //   - HTTP 413 (body demasiado grande, límite 4.5MB de Vercel)
  //   - Timeouts de procesamiento en el servidor (clip de líneas con 50.000+ vértices)
  //
  // WORKAROUND ACTIVO: el servidor simplifica la máscara en normalizarMascara()
  // (_geo.js) con tolerancia ~1km antes de procesarla. Resuelve los timeouts
  // pero no el 413 para polígonos muy grandes.
  //
  // SOLUCIÓN DEFINITIVA: mandar solo maskInstructions ({ layerKey, field, value })
  // en lugar del GeoJSON completo, y que el servidor resuelva el polígono él mismo.
  // Bloqueantes actuales:
  //   1. El servidor solo soporta un value único — no arrays (múltiples provincias)
  //   2. El servidor no tiene la lógica de búsqueda en cascada (6 intentos con
  //      tildes/sin tildes) que tiene resolverAreaFeature() en spatial.js
  //   3. El intent local resuelve la máscara antes de llamar a ejecutar() y
  //      no pasa clipArea/intersectArea/bufferArea en la instrucción
  //
  // Cuando se resuelvan estos tres bloqueantes, eliminar el workaround de
  // simplificación en _geo.js y este comentario.
  // ──────────────────────────────────────────────────────────────────────────
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
        // intersect_exclude necesita todos los features — no mandar bbox
        bbox:       isExclude ? undefined : bbox,
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

  function intersectWithTurf(layerGeoJSON, maskFeature, exclude = false) {
    if (typeof turf === 'undefined') throw new Error('Turf.js no disponible');
    const result = [];

    layerGeoJSON.features.forEach(feat => {
      try {
        const geomType = feat.geometry?.type;
        if (!geomType) return;

        let supera = false;

        if (geomType === 'Point') {
          supera = turf.booleanPointInPolygon(feat, maskFeature);

        } else if (geomType === 'MultiPoint') {
          supera = feat.geometry.coordinates.some(coord =>
            turf.booleanPointInPolygon(
              { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} },
              maskFeature
            )
          );

        } else if (geomType === 'LineString') {
          supera = _fraccionLinea(feat.geometry.coordinates, maskFeature) >= OVERLAP_LINE_MIN;

        } else if (geomType === 'MultiLineString') {
          let totalLen = 0, dentroLen = 0;
          for (const ring of feat.geometry.coordinates) {
            const len = _longitudRing(ring);
            totalLen  += len;
            dentroLen += _fraccionLinea(ring, maskFeature) * len;
          }
          supera = totalLen > 0 && (dentroLen / totalLen) >= OVERLAP_LINE_MIN;

        } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
          supera = _fraccionPoligono(feat, maskFeature) >= OVERLAP_POLYGON_MIN;
        }

        if (exclude ? !supera : supera) result.push(feat);

      } catch { /* feature individual rota — ignorar */ }
    });

    return { type: 'FeatureCollection', features: result };
  }

  // ── Punto de entrada del módulo ───────────────────────────────

  async function ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature) {
    const bbox      = U().calcularBbox(maskFeature);
    const isArcgis  = !!wfsOpts.restBase;
    const op        = instruccion.op || 'intersect';
    const isExclude = op === 'intersect_exclude';

    // ── Camino principal: edge function ───────────────────────
    if (U().deberiaUsarEdgeFunction(layerDef, op, isArcgis)) {
      try {
        return await intersectViaEdgeFunction(layerDef, wfsOpts, cql, bbox, maskFeature, instruccion);
      } catch (edgeErr) {
        console.warn('[SPATIAL:intersect] Edge Function falló, usando Worker:', edgeErr.message);
        U().toastFallbackOnce();
      }
    } else {
      if (isArcgis) {
        console.log('[SPATIAL:intersect] Fuente ArcGIS REST — procesando en cliente directamente.');
      } else if (isExclude) {
        console.log(`[SPATIAL:intersect] intersect_exclude — fetch directo sin bbox (${layerDef.featureCount ?? '?'} features esperados).`);
      } else {
        console.log(`[SPATIAL:intersect] Capa pequeña (${layerDef.featureCount ?? '?'} features) — procesando en cliente directamente.`);
      }
      U().toastFallbackOnce();
    }

    // ── Fallback cliente ─────────────────────────────────────
    const fetchOpts = isArcgis
      ? { ...wfsOpts, whereClause: cql || undefined }
      : { ...wfsOpts, cqlFilter: cql || undefined, ...(isExclude ? {} : { bbox }) };

    const clientFetcher = isArcgis ? window.REST : window.WFS;
    const layerGeoJSON  = await clientFetcher.fetch(layerDef.typename, fetchOpts);

    if (!layerGeoJSON.features?.length) {
      return { type: 'FeatureCollection', features: [] };
    }

    // Puntos: ray-casting directo (sin Worker ni Turf)
    const solosPuntos = layerGeoJSON.features.every(f => {
      const t = f.geometry?.type;
      return t === 'Point' || t === 'MultiPoint';
    });
    if (solosPuntos) {
      const result = U()._clipPuntosDirecto(layerGeoJSON.features, maskFeature, isExclude);
      return { type: 'FeatureCollection', features: result };
    }

    try {
      return await intersectWithWorker(layerGeoJSON, maskFeature, op);
    } catch (workerErr) {
      // Para operaciones _exclude no caer al Turf síncrono:
      // necesitan procesar toda la capa y bloquearían el hilo principal.
      // TODO (largo plazo): simplificar el polígono máscara (turf.simplify con
      // tolerance ~0.01) antes de mandarlo al Worker para reducir la carga
      // geométrica en capas grandes con máscaras complejas (ej: Santa Cruz MultiPolygon).
      if (isExclude) {
        console.error('[SPATIAL:intersect] Worker falló en intersect_exclude:', workerErr.message);
        throw new Error('La operación es demasiado pesada para procesar en este dispositivo. Intentá con un área más pequeña.');
      }
      console.warn('[SPATIAL:intersect] Worker falló, usando Turf.js síncrono:', workerErr.message);
      return intersectWithTurf(layerGeoJSON, maskFeature, isExclude);
    }
  }

  return { ejecutar };

})();
