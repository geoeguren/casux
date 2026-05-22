/**
 * api/_rest.js — Helper compartido: fetch ArcGIS REST desde el servidor
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/intersect.js y api/buffer.js.
 *
 * Equivalente a api/_wfs.js pero para fuentes ArcGIS REST (MOP Chile y similares).
 *
 * Estrategia de fallback (en orden):
 *   1. REST externo con paginación paralela (timeout 120s por página)
 *      - Paralela falla → secuencial
 *      - 502/503/504 en secuencial → 1 reintento (2s espera)
 *      - Timeout / error de red → snapshot R2
 *      - 4xx / ArcGIS error / JSON inválido → snapshot R2
 *   2. Snapshot R2 (timeout 3s)
 *      - Sin whereClause → devuelve directo
 *      - Con bbox pero sin whereClause → filtra en memoria por bbox
 *      - Con whereClause → no aplica (no podemos evaluar SQL en memoria)
 *   3. Error al caller
 *
 * HOST_META también actúa como whitelist SSRF — hosts no listados son rechazados.
 */

const PAGE_SIZE    = 10000;
const MAX_PAGES    = 55;
const TIMEOUT_MS   = 120000; // 120s — el MOP puede tardar hasta 80s por página
const R2_TIMEOUT_MS = 3000;

// Whitelist SSRF — hosts REST autorizados
const REST_HOSTS = new Set([
  'rest-sit.mop.gob.cl',
]);

function _isAuthorizedHost(restBase) {
  try {
    const host = new URL(restBase).hostname;
    return REST_HOSTS.has(host);
  } catch { return false; }
}

// ── Snapshot R2 ───────────────────────────────────────────────────

const R2_PUBLIC_URL = process.env.B2_PUBLIC_URL;

function r2Key(typename) {
  const safe = typename.replace(/[\/\\]/g, '__');
  return `mop_cl/${safe}.geojson`;
}

async function fetchFromR2(typename) {
  if (!R2_PUBLIC_URL) return null;
  const key = r2Key(typename);
  const url = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), R2_TIMEOUT_MS);
    const resp  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const geojson = await resp.json();
    if (!geojson?.features) return null;
    console.log(`[_rest] Snapshot R2: ${key} (${geojson.features.length} features)`);
    return geojson;
  } catch { return null; }
}

// ── Filtro bbox en memoria ────────────────────────────────────────

function _featureTouchesBbox(feature, bbox) {
  const geom = feature?.geometry;
  if (!geom) return false;
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
  return coords.some(([lng, lat]) =>
    lng >= bbox.minX && lng <= bbox.maxX &&
    lat >= bbox.minY && lat <= bbox.maxY
  );
}

function filterByBbox(geojson, bbox) {
  const features = (geojson.features || []).filter(f => _featureTouchesBbox(f, bbox));
  return { type: 'FeatureCollection', features };
}

// ── Helpers de URL ArcGIS REST ────────────────────────────────────

function buildUrl(restBase, typename, params) {
  const url = `${restBase}/${typename}/query`;
  const qs  = new URLSearchParams(params);
  return `${url}?${qs.toString()}`;
}

// Caché del maxRecordCount por servidor
const _maxRecordCount = new Map();

async function _getServerPageSize(restBase, typename) {
  if (_maxRecordCount.has(restBase)) return _maxRecordCount.get(restBase);
  try {
    const metaUrl = buildUrl(restBase, typename, { f: 'json' }).replace('/query?', '?');
    const resp = await fetch(metaUrl, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      const mrc = data?.maxRecordCount;
      if (typeof mrc === 'number' && mrc > 0) {
        _maxRecordCount.set(restBase, mrc);
        return mrc;
      }
    }
  } catch {}
  _maxRecordCount.set(restBase, 1000);
  return 1000;
}

// ── Fetch de una página ───────────────────────────────────────────

async function fetchPage(restBase, typename, where, offset, recordCount = PAGE_SIZE) {
  const baseParams = {
    where:             where || '1=1',
    outFields:         '*',
    outSR:             '4326',
    resultOffset:      offset,
    resultRecordCount: recordCount,
    f:                 'geojson',
  };

  const url  = buildUrl(restBase, typename, baseParams);
  const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

  if (resp.status === 502 || resp.status === 503 || resp.status === 504)
    throw new Error(`HTTP ${resp.status}`);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status} (sin reintentos)`);

  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error('Respuesta ArcGIS REST inválida (sin reintentos)');
  }
  if (json.error)
    throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message} (sin reintentos)`);
  if (!Array.isArray(json.features))
    throw new Error('Respuesta ArcGIS REST sin features (sin reintentos)');

  return json;
}

// ── Fetch con paginación paralela → secuencial ───────────────────

async function _fetchRESTExterno(restBase, typename, where, intento = 1) {

  // ── Intentar paralelo ─────────────────────────────────────────
  try {
    const [serverPageSize, countJson] = await Promise.all([
      _getServerPageSize(restBase, typename),
      fetch(buildUrl(restBase, typename, {
        where:           where || '1=1',
        returnCountOnly: 'true',
        f:               'json',
      }), { signal: AbortSignal.timeout(15000) }).then(r => r.json()),
    ]);

    const total    = countJson?.count;
    const pageSize = Math.min(serverPageSize, PAGE_SIZE);

    if (typeof total === 'number' && total > 0) {
      const pageCount = Math.min(Math.ceil(total / pageSize), MAX_PAGES);
      console.log(`[_rest] ${typename}: ${total} features → ${pageCount} páginas en paralelo`);

      const offsets = Array.from({ length: pageCount }, (_, i) => {
        const off   = i * pageSize;
        const count = Math.min(pageSize, total - off);
        return { off, count };
      });

      const results  = await Promise.all(
        offsets.map(({ off, count }) => fetchPage(restBase, typename, where || '1=1', off, count))
      );
      const features = results.flatMap((r, i) => r.features.slice(0, offsets[i].count));
      console.log(`[_rest] OK paralelo: ${typename} → ${features.length} features`);
      return { type: 'FeatureCollection', features };
    }
  } catch (parallelErr) {
    if (parallelErr?.message?.includes('sin reintentos')) throw parallelErr;
    console.warn(`[_rest] ${typename}: paralelo falló (${parallelErr?.message}), usando secuencial`);
  }

  // ── Fallback secuencial ───────────────────────────────────────
  let seqTotal = null;
  try {
    const cd = await fetch(buildUrl(restBase, typename, {
      where: where || '1=1', returnCountOnly: 'true', f: 'json',
    }), { signal: AbortSignal.timeout(15000) }).then(r => r.json());
    if (typeof cd?.count === 'number') seqTotal = cd.count;
  } catch {}

  const allFeatures = [];
  let offset    = 0;
  let hasMore   = true;
  let pageCount = 0;

  while (hasMore) {
    if (pageCount >= MAX_PAGES) break;
    if (seqTotal !== null && allFeatures.length >= seqTotal) break;

    try {
      const page = await fetchPage(restBase, typename, where, offset);
      pageCount++;
      allFeatures.push(...page.features);
      if (page.features.length === 0) {
        hasMore = false;
      } else if (seqTotal !== null) {
        hasMore = allFeatures.length < seqTotal;
      } else {
        hasMore = page.exceededTransferLimit === true;
      }
      offset += page.features.length;
    } catch (err) {
      if (err.message.includes('sin reintentos')) throw err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw err;
      if (intento === 1) {
        console.warn(`[_rest] Intento 1 falló (${err.message}). Reintentando en 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        return _fetchRESTExterno(restBase, typename, where, 2);
      }
      throw err;
    }
  }

  console.log(`[_rest] OK secuencial: ${typename} → ${allFeatures.length} features`);
  return { type: 'FeatureCollection', features: allFeatures };
}

// ── Función principal ─────────────────────────────────────────────

async function fetchREST({ typename, restBase, whereClause, bbox }) {
  if (!typename)  throw new Error('[_rest] typename requerido');
  if (!restBase)  throw new Error('[_rest] restBase requerido');

  // Validar host (whitelist SSRF)
  if (!_isAuthorizedHost(restBase)) {
    const error = new Error(`Servidor REST no autorizado: ${restBase}`);
    error.isExternalServerError = false;
    throw error;
  }

  const where = (whereClause || '').replace(/IN\s*\(\[([^\]]*)\]\)/gi, 'IN ($1)') || '1=1';

  // 1. REST externo
  try {
    const geojson = await _fetchRESTExterno(restBase, typename, where);
    const result  = bbox ? filterByBbox(geojson, bbox) : geojson;
    console.log(`[_rest] REST OK: ${typename} → ${result.features.length} features`);
    return result;
  } catch (err) {
    console.warn(`[_rest] REST falló para ${typename}: ${err.message}. Intentando snapshot R2...`);

    // 2. Snapshot R2 — solo si no hay whereClause (no podemos evaluar SQL en memoria)
    if (!whereClause || whereClause === '1=1') {
      const snapshot = await fetchFromR2(typename);
      if (snapshot) {
        const result = bbox ? filterByBbox(snapshot, bbox) : snapshot;
        console.log(`[_rest] Snapshot R2 usado como fallback: ${typename} → ${result.features.length} features`);
        return result;
      }
    }

    // 3. Error al caller
    throw err;
  }
}

module.exports = { fetchREST };
