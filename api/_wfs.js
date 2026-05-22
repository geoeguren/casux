/**
 * api/_wfs.js — Helper compartido: fetch WFS desde el servidor
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/intersect.js y api/buffer.js.
 *
 * Estrategia de fallback (en orden):
 *   1. WFS externo (timeout 50s)
 *      - 502/503/504 → 1 reintento (2s espera)
 *      - Timeout / error de red → snapshot R2
 *      - Otros errores HTTP → snapshot R2
 *   2. Snapshot R2 (timeout 3s)
 *      - Sin bbox ni cqlFilter → devuelve directo
 *      - Con bbox pero sin cqlFilter → filtra en memoria por bbox
 *      - Con cqlFilter → no aplica (el snapshot tiene la capa completa sin filtrar)
 *   3. Error al caller
 *
 * El snapshot se genera por scripts/generate-snapshots.js (cron mensual).
 * La key en R2 es: {source}/{typename}.geojson
 * Ej: ign_ar/ign:provincia.geojson
 *
 * HOST_META también actúa como whitelist SSRF — hosts no listados son rechazados.
 */

const FETCH_TIMEOUT_MS = 50000; // 50s — cubre descargas de capas pesadas
const R2_TIMEOUT_MS    = 3000;  // 3s máximo para el snapshot

// Mapa host → fuente R2 y campo de geometría.
// También actúa como whitelist SSRF — hosts no listados son rechazados.
const HOST_META = {
  'wms.ign.gob.ar':               { source: 'ign_ar',  geomField: 'the_geom' },
  'sig.igm.gub.uy':               { source: 'igm_uy',  geomField: 'the_geom' },
  'geoservicios.mtop.gub.uy':     { source: 'mtop_uy', geomField: 'the_geom' },
  'mapa.educacion.gob.ar':        { source: 'se_ar',   geomField: 'the_geom' },
  'geo.ambiente.gob.ar':          { source: 'ssa_ar',  geomField: 'the_geom' },
};

function _metaForUrl(wfsBase) {
  try {
    const host = new URL(wfsBase).hostname;
    return HOST_META[host] || null;
  } catch {
    return null;
  }
}

// ── Snapshot R2 ───────────────────────────────────────────────────

const R2_PUBLIC_URL = process.env.B2_PUBLIC_URL; // variable de entorno — apunta al bucket R2

function r2Key(source, typename) {
  // Solo reemplazar / y \ — los : son válidos en nombres de archivo en R2
  const safe = typename.replace(/[\/\\]/g, '__');
  return `${source}/${safe}.geojson`;
}

async function fetchFromR2(source, typename) {
  if (!R2_PUBLIC_URL) return null;

  const key = r2Key(source, typename);
  const url = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), R2_TIMEOUT_MS);
    const resp  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const geojson = await resp.json();
    if (!geojson?.features) return null;

    console.log(`[_wfs] Snapshot R2: ${key} (${geojson.features.length} features)`);
    return geojson;
  } catch {
    return null; // timeout o error — caer al error sin ruido
  }
}

// ── Filtro bbox en memoria ────────────────────────────────────────
// Cuando el snapshot está disponible pero hay bbox, filtramos en memoria
// en lugar de ir al WFS externo. El resultado es idéntico — el WFS con bbox
// devuelve los mismos features que el snapshot filtrado por el rectángulo.

function _featureTouchesBbox(feature, bbox) {
  const geom = feature?.geometry;
  if (!geom) return false;

  // Obtener todas las coordenadas del feature aplanadas
  function allCoords(g) {
    if (g.type === 'Point')           return [g.coordinates];
    if (g.type === 'MultiPoint')      return g.coordinates;
    if (g.type === 'LineString')      return g.coordinates;
    if (g.type === 'MultiLineString') return g.coordinates.flat();
    if (g.type === 'Polygon')         return g.coordinates.flat();
    if (g.type === 'MultiPolygon')    return g.coordinates.flat(2);
    return [];
  }

  const coords = allCoords(geom);
  if (!coords.length) return false;

  // Un feature toca el bbox si al menos una coordenada está dentro
  return coords.some(([lng, lat]) =>
    lng >= bbox.minX && lng <= bbox.maxX &&
    lat >= bbox.minY && lat <= bbox.maxY
  );
}

function filterByBbox(geojson, bbox) {
  const features = (geojson.features || []).filter(f => _featureTouchesBbox(f, bbox));
  return { type: 'FeatureCollection', features };
}

// ── Fetch WFS externo ─────────────────────────────────────────────

async function _fetchWFSExterno({ typename, wfsBase, wfsVersion, cqlFilter, bbox, geomField, meta, intento = 1 }) {
  const resolvedGeomField = geomField || meta.geomField || 'the_geom';

  const params = new URLSearchParams({
    service:      'WFS',
    version:      wfsVersion || '1.1.0',
    request:      'GetFeature',
    typename,
    outputFormat: 'application/json',
    srsName:      'EPSG:4326',
  });

  if (bbox) {
    const bboxCql = `BBOX(${resolvedGeomField},${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},'EPSG:4326')`;
    if (cqlFilter) {
      params.set('CQL_FILTER', `(${cqlFilter}) AND ${bboxCql}`);
    } else {
      params.set('bbox', `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},EPSG:4326`);
    }
  } else if (cqlFilter) {
    params.set('CQL_FILTER', cqlFilter);
  }

  const url        = `${wfsBase}?${params.toString()}`;
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';

    // Timeout → no reintentar
    if (isTimeout) {
      const error = new Error('El servidor de datos tardó demasiado en responder.');
      error.isExternalServerError = true;
      error.isTimeout = true;
      throw error;
    }

    // Error de red → 1 reintento
    if (intento === 1) {
      console.warn(`[_wfs] Intento 1 falló (${err.message}). Reintentando en 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      return _fetchWFSExterno({ typename, wfsBase, wfsVersion, cqlFilter, bbox, geomField, meta, intento: 2 });
    }

    const error = new Error('No se pudo conectar con el servidor de datos.');
    error.isExternalServerError = true;
    throw error;
  }
  clearTimeout(timer);

  // 502/503/504 → 1 reintento
  if ((resp.status === 502 || resp.status === 503 || resp.status === 504) && intento === 1) {
    console.warn(`[_wfs] HTTP ${resp.status}. Reintentando en 2s...`);
    await new Promise(r => setTimeout(r, 2000));
    return _fetchWFSExterno({ typename, wfsBase, wfsVersion, cqlFilter, bbox, geomField, meta, intento: 2 });
  }

  if (!resp.ok) {
    const error = new Error('El servidor de datos devolvió un error. Intentá de nuevo más tarde.');
    error.isExternalServerError = true;
    throw error;
  }

  let geojson;
  try {
    geojson = await resp.json();
  } catch {
    const error = new Error('La respuesta del servidor de datos no es válida.');
    error.isExternalServerError = true;
    throw error;
  }

  if (!geojson.features) {
    const error = new Error('El servidor no devolvió datos para esta capa.');
    error.isExternalServerError = true;
    throw error;
  }

  return geojson;
}

// ── Función principal ─────────────────────────────────────────────

async function fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox, geomField }) {
  if (!typename) throw new Error('[_wfs] typename requerido');
  if (!wfsBase)  throw new Error('[_wfs] wfsBase requerido');

  // Validar host (whitelist SSRF)
  const meta = _metaForUrl(wfsBase);
  if (!meta) {
    const error = new Error(`Servidor WFS no autorizado: ${wfsBase}`);
    error.isExternalServerError = false;
    throw error;
  }

  // 1. WFS externo
  try {
    const geojson = await _fetchWFSExterno({ typename, wfsBase, wfsVersion, cqlFilter, bbox, geomField, meta });
    console.log(`[_wfs] WFS OK: ${typename} → ${geojson.features.length} features`);
    return geojson;
  } catch (err) {
    console.warn(`[_wfs] WFS falló para ${typename}: ${err.message}. Intentando snapshot R2...`);

    // 2. Snapshot R2
    // Con cqlFilter no podemos evaluar el filtro en memoria → solo si no hay cqlFilter
    if (!cqlFilter) {
      const snapshot = await fetchFromR2(meta.source, typename);
      if (snapshot) {
        // Si había bbox, filtrar en memoria — mismo resultado que el WFS con bbox
        const result = bbox ? filterByBbox(snapshot, bbox) : snapshot;
        console.log(`[_wfs] Snapshot R2 usado como fallback: ${typename} → ${result.features.length} features`);
        return result;
      }
    }

    // 3. Sin snapshot disponible → propagar el error al caller
    throw err;
  }
}

module.exports = { fetchWFS };
