/**
 * api/_wfs.js — Helper compartido: fetch WFS desde el servidor
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/intersect.js y api/buffer.js.
 *
 * Flujo con cache B2:
 *   1. Si existe snapshot en Backblaze B2 → devolverlo directamente
 *   2. Si no → fetchear el WFS externo como siempre
 *
 * El snapshot se genera por scripts/generate-snapshots.js (cron mensual).
 * La key en B2 es: {source}/{typename}.geojson
 * Ej: ign_ar/ign:provincia.geojson
 *
 * Si B2 no está configurado (variables de entorno ausentes), el cache
 * se omite silenciosamente y el fetch WFS funciona como antes.
 *
 * Timeout WFS: 7 segundos (3s de margen para procesamiento posterior).
 */

const FETCH_TIMEOUT_MS = 7000;

// Mapa host → fuente B2 y campo de geometría.
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

// ── Cache B2 ──────────────────────────────────────────────────────

const B2_PUBLIC_URL = process.env.B2_PUBLIC_URL; // ej: https://pub-xxx.r2.dev o URL pública B2

function b2Key(source, typename) {
  const safe = typename.replace(/[\/\\]/g, '__');
  return `${source}/${safe}.geojson`;
}

async function fetchFromB2(source, typename) {
  if (!B2_PUBLIC_URL) return null; // B2 no configurado

  const key = b2Key(source, typename);
  const url = `${B2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000); // 3s máximo para el cache
    const resp  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!resp.ok) return null; // snapshot no existe todavía
    const geojson = await resp.json();
    if (!geojson.features) return null;

    console.log(`[_wfs] Cache B2 hit: ${key} (${geojson.features.length} features)`);
    return geojson;
  } catch {
    // Timeout o error de red — caer al WFS sin ruido
    return null;
  }
}

// ── Fetch WFS externo ─────────────────────────────────────────────

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

  // ── Intentar cache B2 primero ─────────────────────────────────
  // Solo cuando no hay filtros dinámicos (cqlFilter o bbox) que
  // acotan los resultados — el snapshot tiene la capa completa.
  // Con bbox o cqlFilter, el snapshot no sirve porque habría que
  // filtrarlo aquí, y eso lo hace mejor la edge function con el WFS.
  // Excepción: si viene cqlFilter de filterField/filterValues (filtro
  // estructural fijo de la capa), el snapshot ya lo incorpora.
  const canUseCache = !bbox && !cqlFilter;

  if (canUseCache) {
    const cached = await fetchFromB2(meta.source, typename);
    if (cached) return cached;
  }

  // ── Fetch WFS externo ─────────────────────────────────────────
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

  const url = `${wfsBase}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    const error = new Error(
      isTimeout
        ? 'El servidor de datos tardó demasiado en responder.'
        : 'No se pudo conectar con el servidor de datos.'
    );
    error.isExternalServerError = true;
    error.isTimeout = isTimeout;
    throw error;
  }
  clearTimeout(timer);

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

module.exports = { fetchWFS };
