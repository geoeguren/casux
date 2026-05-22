/**
 * wfs.js — Fetcher WFS genérico con caché en IndexedDB y reintentos
 *
 * Soporta múltiples servidores WFS — la URL base se pasa como parámetro
 * en cada llamada, leída de window.SOURCES según la fuente de cada capa.
 *
 * Caché en IndexedDB (no localStorage) — sin límite de tamaño práctico,
 * permite cachear capas pesadas como ign:provincia (106MB).
 *
 * Estrategia de caché y fallback (en orden):
 *   1. IndexedDB fresca (< 24h) → devuelve directo
 *   2. WFS externo (timeout 50s)
 *      - 502/503/504 → 1 reintento (2s espera)
 *      - Timeout / network / CORS → snapshot R2 sin reintentar
 *      - 4xx / XML / JSON truncado → snapshot R2 sin reintentar
 *   3. Snapshot R2 (timeout 3s)
 *   4. IndexedDB vencida (safety net, con toast)
 *   5. Error al usuario
 *
 * Deduplicación: dos requests simultáneos a la misma capa comparten la Promise.
 */

window.WFS = (() => {

  const CACHE_TTL    = 24 * 60 * 60 * 1000;
  const DB_NAME      = 'sm_wfs_cache';
  const DB_VERSION   = 1;
  const STORE_NAME   = 'layers';
  const TIMEOUT_MS   = 50000; // 50s — cubre descargas de capas pesadas (~100MB)
  const R2_TIMEOUT_MS = 3000; // 3s máximo para el snapshot de R2

  // ── IndexedDB ─────────────────────────────────────────────────

  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function cacheGet(key) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx  = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = e => {
          const record = e.target.result;
          if (!record) return resolve(null);
          if (Date.now() - record.ts > CACHE_TTL) return resolve({ stale: true, data: record.data });
          resolve({ stale: false, data: record.data });
        };
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  async function cacheSet(key, data) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx  = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put({ key, ts: Date.now(), data });
        req.onsuccess = () => resolve(true);
        req.onerror   = () => resolve(false);
      });
    } catch { return false; }
  }

  async function clearAllCache() {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx  = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror    = () => resolve(false);
      });
    } catch { return false; }
  }

  // ── Hash djb2 ─────────────────────────────────────────────────

  function hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
      h = h >>> 0;
    }
    return h.toString(36);
  }

  function cacheKey(wfsBase, typename, cqlFilter) {
    const serverHash = hashStr(wfsBase);
    const filterPart = cqlFilter ? '_' + hashStr(cqlFilter) : '';
    return `${serverHash}_${typename.replace(':', '_')}${filterPart}`;
  }

  // ── Constructor de URL WFS ────────────────────────────────────

  function buildUrl(wfsBase, typename, wfsVersion, cqlFilter, maxFeatures, bbox) {
    const params = new URLSearchParams({
      service:      'WFS',
      version:      wfsVersion || '1.1.0',
      request:      'GetFeature',
      typename,
      outputFormat: 'application/json',
      srsName:      'EPSG:4326'
    });
    if (maxFeatures) params.set('maxFeatures', maxFeatures);

    if (bbox) {
      // GeoServer IGN/IGM no acepta CQL_FILTER y bbox como parámetros simultáneos
      // ("bbox and cql_filter both specified but are mutually exclusive").
      // Cuando hay filtro de atributos, embebemos el bbox dentro del CQL con BBOX().
      // El campo de geometría se lee de SOURCES[fuente].geomField (por defecto "the_geom").
      const geomField = _getGeomField(wfsBase);
      const bboxCql   = `BBOX(${geomField},${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},'EPSG:4326')`;
      if (cqlFilter) {
        params.set('CQL_FILTER', `(${cqlFilter}) AND ${bboxCql}`);
      } else {
        // Sin filtro de atributos: usar bbox como parámetro nativo WFS (más eficiente)
        params.set('bbox', `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},EPSG:4326`);
      }
    } else if (cqlFilter) {
      params.set('CQL_FILTER', cqlFilter);
    }

    return `${wfsBase}?${params.toString()}`;
  }

  // Resuelve el campo de geometría para una URL WFS dada.
  // Lee de SOURCES por coincidencia de host; por defecto "the_geom" (estándar GeoServer).
  function _getGeomField(wfsBase) {
    try {
      const host = new URL(wfsBase).hostname;
      const src  = Object.values(window.SOURCES || {}).find(s => s.wfsBase?.includes(host));
      return src?.geomField || 'the_geom';
    } catch {
      return 'the_geom';
    }
  }

  // ── Snapshot R2 ───────────────────────────────────────────────
  // Fallback cuando el WFS falla. Lee el snapshot pre-generado mensualmente
  // desde Cloudflare R2. Timeout de 3s — si no responde, no vale la pena esperar.

  function _r2SnapshotUrl(wfsBase, typename) {
    const base = window.CASUX_CONFIG?.b2PublicUrl || '';
    if (!base) return null;
    // Resolver la fuente desde el host del WFS
    try {
      const host   = new URL(wfsBase).hostname;
      const src    = Object.values(window.SOURCES || {}).find(s => s.wfsBase?.includes(host));
      const source = src ? Object.keys(window.SOURCES).find(k => window.SOURCES[k] === src) : null;
      if (!source) return null;
      const safe = typename.replace(/[\/\\:]/g, '__');
      return `${base.replace(/\/$/, '')}/${source}/${safe}.geojson`;
    } catch { return null; }
  }

  async function _fetchFromR2(wfsBase, typename) {
    const url = _r2SnapshotUrl(wfsBase, typename);
    if (!url) return null;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(R2_TIMEOUT_MS) });
      if (!resp.ok) return null;
      const geojson = await resp.json();
      if (!geojson?.features) return null;
      console.log(`[WFS] Snapshot R2: ${typename} (${geojson.features.length} features)`);
      return geojson;
    } catch {
      return null; // timeout o error — no hacer ruido
    }
  }

  // ── Fetch con reintentos diferenciados por tipo de error ──────
  //
  // Árbol de decisiones:
  //   - 502/503/504 → 1 reintento (2s espera). Si falla de nuevo → lanza para que
  //                   el caller intente R2.
  //   - Timeout (50s) → lanza inmediatamente, sin reintentar.
  //   - Network / CORS → lanza inmediatamente, sin reintentar.
  //   - 4xx / XML / JSON truncado → lanza inmediatamente, sin reintentar (marcado
  //                                  "sin reintentos" para que el caller no reintente).

  async function fetchConReintentos(url, intento = 1) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

      // Errores transitorios del servidor → reintentar una vez
      if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
        throw new Error(`HTTP ${resp.status}`);
      }

      // Otros errores HTTP (4xx, etc.) → no reintentar
      if (!resp.ok) throw new Error(`HTTP ${resp.status} (sin reintentos)`);

      const text = await resp.text();

      // GeoServer devuelve XML cuando el CQL tiene campo inválido o sintaxis incorrecta
      if (text.trimStart().startsWith('<')) {
        const msgMatch = text.match(/<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/i)
                      || text.match(/<ServiceException>([\s\S]*?)<\/ServiceException>/i);
        const detalle = msgMatch ? msgMatch[1].trim().split('\n')[0] : 'Respuesta XML inesperada del servidor WFS';
        throw new Error(`WFS error: ${detalle} (sin reintentos)`);
      }

      const geojson = JSON.parse(text);
      if (!geojson.features) throw new Error('Respuesta WFS inválida (sin reintentos)');
      return geojson;

    } catch (err) {
      // Errores que no deben reintentarse nunca
      if (err.message.includes('sin reintentos')) throw err;

      // Timeout → no reintentar, ir directo al snapshot R2
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw err;

      // 502/503/504 → 1 solo reintento
      if (intento === 1) {
        console.warn(`[WFS] Intento ${intento} falló (${err.message}). Reintentando en 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        return fetchConReintentos(url, 2);
      }

      // Segundo intento también falló → lanzar para que el caller intente R2
      throw err;
    }
  }

  // ── Deduplicación de requests en vuelo ───────────────────────
  const _inFlight = new Map();

  // ── Fetch principal ───────────────────────────────────────────

  async function fetchLayer(typename, options = {}) {
    const {
      wfsBase,
      wfsVersion   = '1.1.0',
      cqlFilter,
      maxFeatures,
      bbox,
      forceRefresh,
      tituloUI,
    } = options;

    if (!wfsBase) throw new Error(`[WFS] wfsBase requerido para "${typename}". Verificá que la capa tenga "source" y que esté definido en window.SOURCES.`);

    const bboxStr = bbox ? `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}` : '';
    const key = cacheKey(wfsBase, typename, (cqlFilter || '') + bboxStr);

    // 1. Caché fresca en IndexedDB
    if (!forceRefresh) {
      const cached = await cacheGet(key);
      if (cached && !cached.stale) {
        console.log(`[WFS] Caché fresca: ${typename}`);
        return cached.data;
      }
    }

    // 2. Deduplicación de requests en vuelo
    if (_inFlight.has(key)) {
      console.log(`[WFS] Reutilizando fetch en vuelo: ${typename}`);
      return _inFlight.get(key);
    }

    // 3. WFS externo → snapshot R2 → caché vencida → error
    const url = buildUrl(wfsBase, typename, wfsVersion, cqlFilter, maxFeatures, bbox);
    console.log(`[WFS] Fetching: ${typename}${cqlFilter ? ' | ' + cqlFilter : ''}${bbox ? ' | bbox' : ''} (${wfsBase})`);

    const fetchPromise = fetchConReintentos(url)
      .then(async geojson => {
        await cacheSet(key, geojson);
        console.log(`[WFS] OK: ${typename} → ${geojson.features.length} features`);
        return geojson;
      })
      .catch(async err => {
        console.warn(`[WFS] WFS falló para ${typename}: ${err.message}. Intentando snapshot R2...`);

        // 4. Snapshot R2
        const snapshot = await _fetchFromR2(wfsBase, typename);
        if (snapshot) {
          await cacheSet(key, snapshot);
          console.log(`[WFS] Snapshot R2 usado como fallback: ${typename}`);
          window.TOAST?.warning(t('toast_cache_warning'));
          return snapshot;
        }

        // 5. Caché vencida (safety net)
        const stale = await cacheGet(key);
        if (stale) {
          console.warn(`[WFS] Usando caché vencida para ${typename}`);
          window.TOAST?.warning(t('toast_cache_warning'));
          return stale.data;
        }

        // 6. Error al usuario
        const isTruncated =
          err.message.includes('JSON.parse') ||
          err.message.includes('Unexpected end') ||
          err.message.includes('Unexpected token');

        const isServerError =
          /HTTP 5\d\d/.test(err.message) ||
          err.name === 'TimeoutError'    ||
          err.name === 'AbortError'      ||
          err.message.toLowerCase().includes('network') ||
          err.message.toLowerCase().includes('cors');

        let orgLabel = wfsBase;
        try {
          const host = new URL(wfsBase).hostname;
          const src  = Object.values(window.SOURCES || {}).find(s => s.wfsBase?.includes(host));
          if (src?.label) orgLabel = src.label;
        } catch {}

        const msg = isTruncated
          ? t('toast_layer_truncated', { titulo: tituloUI || typename })
          : isServerError
            ? t('toast_server_unavailable', { org: orgLabel })
            : t('toast_layer_fetch_error', { typename, msg: err.message });

        const error = new Error(msg);
        error.isTruncated = isTruncated;
        error.isExternalServerError = !isTruncated && isServerError;
        throw error;
      })
      .finally(() => {
        _inFlight.delete(key);
      });

    _inFlight.set(key, fetchPromise);
    return fetchPromise;
  }

  // ── API pública ───────────────────────────────────────────────

  return {
    fetch: fetchLayer,
    filterEqual: (campo, valor) => `${campo}='${valor.replace(/'/g, "''")}'`,
    clearCache: async () => {
      await clearAllCache();
      console.log('[WFS] Caché IndexedDB limpiada');
    }
  };

})();
