/**
 * rest.js — Fetcher ArcGIS REST genérico con caché en IndexedDB y reintentos
 *
 * Interfaz idéntica a wfs.js — window.REST.fetch(typename, options) → GeoJSON
 *
 * Diferencias respecto a WFS:
 *  - URL: {restBase}/{typename}/query?where=1=1&outFields=*&f=geojson
 *  - Paginación: resultOffset / resultRecordCount (no startIndex / count)
 *  - Filtros: where clause SQL (no CQL)
 *  - Sin versión de protocolo
 *
 * El campo `typename` en las capas MOP tiene formato:
 *   "CARPETA/SERVICIO/MapServer/N"  →  endpoint: {restBase}/CARPETA/SERVICIO/MapServer/N/query
 *
 * Comparte el mismo IndexedDB (sm_wfs_cache) que wfs.js — misma TTL y lógica de caché.
 */

window.REST = (() => {

  const CACHE_TTL   = 24 * 60 * 60 * 1000;
  const DB_NAME     = 'sm_wfs_cache';
  const DB_VERSION  = 1;
  const STORE_NAME  = 'layers';
  const MAX_RETRIES = 3;
  const TIMEOUT_MS  = 120000; // 120s — el servidor MOP puede tardar hasta 80s por página
  const PAGE_SIZE   = 10000; // ArcGIS REST soporta hasta 10.000 por página
  const MAX_PAGES   = 55;   // límite de seguridad: 55.000 features máx por request

  // ── IndexedDB (mismo store que wfs.js) ───────────────────────

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

  // ── Hash djb2 (mismo que wfs.js) ─────────────────────────────

  function hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
      h = h >>> 0;
    }
    return h.toString(36);
  }

  function cacheKey(restBase, typename, whereClause) {
    const serverHash = hashStr(restBase);
    const filterPart = whereClause && whereClause !== '1=1' ? '_' + hashStr(whereClause) : '';
    return `rest_${serverHash}_${typename.replace(/\//g, '_')}${filterPart}`;
  }

  // ── Constructor de URL ArcGIS REST ───────────────────────────

  function buildUrl(restBase, typename, params) {
    const url = `${restBase}/${typename}/query`;
    const qs  = new URLSearchParams(params);
    return `${url}?${qs.toString()}`;
  }

  // ── Conversión Esri JSON → GeoJSON ───────────────────────────
  // Necesaria para ArcGIS Server < 10.3 que no soporta f=geojson.

  function esriGeomToGeoJSON(esriGeom, geomType) {
    if (!esriGeom) return null;
    if (geomType === 'esriGeometryPoint') {
      return { type: 'Point', coordinates: [esriGeom.x, esriGeom.y] };
    }
    if (geomType === 'esriGeometryMultipoint') {
      return { type: 'MultiPoint', coordinates: esriGeom.points };
    }
    if (geomType === 'esriGeometryPolyline') {
      const paths = esriGeom.paths || [];
      return paths.length === 1
        ? { type: 'LineString',      coordinates: paths[0] }
        : { type: 'MultiLineString', coordinates: paths };
    }
    if (geomType === 'esriGeometryPolygon') {
      const rings = esriGeom.rings || [];
      return rings.length === 1
        ? { type: 'Polygon',      coordinates: rings }
        : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) };
    }
    return null;
  }

  function esriResponseToGeoJSON(json) {
    const geomType = json.geometryType;
    const features = (json.features || []).map(f => ({
      type:       'Feature',
      geometry:   esriGeomToGeoJSON(f.geometry, geomType),
      properties: f.attributes || {},
    }));
    return {
      type:                 'FeatureCollection',
      features,
      exceededTransferLimit: json.exceededTransferLimit || false,
    };
  }

  // Caché por restBase: true = soporta geojson, false = solo json (ArcGIS < 10.3)
  const _geojsonSupport = new Map();

  // ── Fetch de una página ───────────────────────────────────────

  async function fetchPage(restBase, typename, where, offset, recordCount = PAGE_SIZE) {
    const baseParams = {
      where:             where || '1=1',
      outFields:         '*',
      outSR:             '4326',
      resultOffset:      offset,
      resultRecordCount: recordCount,
    };

    // Intentar geojson si no sabemos que el servidor no lo soporta
    const supportsGeoJSON = _geojsonSupport.get(restBase);

    if (supportsGeoJSON !== false) {
      const url  = buildUrl(restBase, typename, { ...baseParams, f: 'geojson' });
      const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

      if (resp.status === 503 || resp.status === 502 || resp.status === 504)
        throw new Error(`HTTP ${resp.status}`);

      // 400 con geojson → servidor antiguo (< 10.3), marcar y reintentar con f=json
      if (resp.status === 400) {
        console.warn(`[REST] ${restBase} no soporta f=geojson, reintentando con f=json`);
        _geojsonSupport.set(restBase, false);
      } else {
        if (!resp.ok)
          throw new Error(`HTTP ${resp.status} (sin reintentos)`);

        const text = await resp.text();
        let json;
        try { json = JSON.parse(text); } catch {
          throw new Error('Respuesta ArcGIS REST inválida (JSON parse error)');
        }
        if (json.error)
          throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message} (sin reintentos)`);
        if (!Array.isArray(json.features))
          throw new Error('Respuesta ArcGIS REST sin features');

        _geojsonSupport.set(restBase, true);
        return json;
      }
    }

    // Fallback: f=json (Esri JSON) → convertir a GeoJSON
    const url  = buildUrl(restBase, typename, { ...baseParams, f: 'json' });
    const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (resp.status === 503 || resp.status === 502 || resp.status === 504)
      throw new Error(`HTTP ${resp.status}`);
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status} (sin reintentos)`);

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error('Respuesta ArcGIS REST inválida (JSON parse error)');
    }
    if (json.error)
      throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message} (sin reintentos)`);
    if (!Array.isArray(json.features))
      throw new Error('Respuesta ArcGIS REST sin features');

    return esriResponseToGeoJSON(json);
  }

  // ── Fetch completo con paginación paralela ────────────────────
  //
  // Estrategia:
  //   1. Consultar el count total con returnCountOnly=true
  //   2. Calcular cuántas páginas se necesitan
  //   3. Lanzar todas las páginas en paralelo con Promise.all
  //
  // Si el count falla (servidor no lo soporta), fallback a paginación secuencial.
  // El servidor del MOP tarda ~30s por página — en paralelo, N páginas tardan
  // lo mismo que 1 en lugar de N×30s.

  // Cache del maxRecordCount por servidor — se consulta una vez y se reutiliza
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
    // Fallback conservador si no podemos leer los metadatos
    _maxRecordCount.set(restBase, 1000);
    return 1000;
  }

  async function fetchConReintentos(restBase, typename, where, intento = 1) {

    // ── Intentar paralelo ──────────────────────────────────────
    // Primero obtener el pageSize real del servidor (puede ser < PAGE_SIZE)
    // y el total de features, luego lanzar todas las páginas en paralelo.
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
        const pages = Math.ceil(total / pageSize);
        if (pages > MAX_PAGES) {
          console.warn(`[REST] ${typename}: ${total} features superan el límite (${MAX_PAGES} páginas × ${pageSize}). Usá un filtro.`);
        }
        const pageCount = Math.min(pages, MAX_PAGES);
        console.log(`[REST] ${typename}: ${total} features → ${pageCount} páginas × ${pageSize} en paralelo`);

        // Calcular cuántos features pedir en cada página.
        // El servidor MOP siempre devuelve exceededTransferLimit=true (bug del servidor),
        // así que no podemos confiar en ese flag. Usamos el count para saber
        // exactamente cuántos features hay en cada página, evitando duplicados.
        const offsets = Array.from({ length: pageCount }, (_, i) => {
          const off   = i * pageSize;
          const count = Math.min(pageSize, total - off);  // última página puede ser menor
          return { off, count };
        });

        const results  = await Promise.all(
          offsets.map(({ off, count }) => fetchPage(restBase, typename, where || '1=1', off, count))
        );
        // Truncar cada página al count esperado — algunos servidores ignoran resultRecordCount
        // y devuelven más features de los pedidos (bug del servidor MOP).
        const features = results.flatMap((r, i) => r.features.slice(0, offsets[i].count));
        console.log(`[REST] OK: ${typename} → ${features.length} features (esperados: ${total})`);
        return { type: 'FeatureCollection', features };
      }
    } catch (parallelErr) {
      console.warn(`[REST] ${typename}: paginación paralela falló (${parallelErr?.message}), usando secuencial`);
    }

    // ── Fallback: paginación secuencial ───────────────────────
    // Intenta obtener el count para saber cuándo parar (no confiar en exceededTransferLimit
    // que en el servidor MOP es siempre true).
    let seqTotal = null;
    try {
      const cd = await fetch(buildUrl(restBase, typename, { where: where || '1=1', returnCountOnly: 'true', f: 'json' }),
        { signal: AbortSignal.timeout(15000) }).then(r => r.json());
      if (typeof cd?.count === 'number') seqTotal = cd.count;
    } catch {}

    const allFeatures = [];
    let offset    = 0;
    let hasMore   = true;
    let pageCount = 0;

    while (hasMore) {
      if (pageCount >= MAX_PAGES) {
        console.warn(`[REST] ${typename}: límite de ${MAX_PAGES} páginas alcanzado (${allFeatures.length} features). Usá un filtro para acotar la consulta.`);
        break;
      }
      // Si tenemos el total exacto, parar cuando ya lo alcanzamos
      if (seqTotal !== null && allFeatures.length >= seqTotal) {
        break;
      }
      try {
        const page = await fetchPage(restBase, typename, where, offset);
        pageCount++;
        allFeatures.push(...page.features);

        if (page.features.length === 0) {
          hasMore = false;
        } else if (seqTotal !== null) {
          // Confiar en el count, no en exceededTransferLimit
          hasMore = allFeatures.length < seqTotal;
        } else {
          // Sin count: usar exceededTransferLimit como señal
          hasMore = page.exceededTransferLimit === true;
        }
        offset += page.features.length;

      } catch (err) {
        if (err.message.includes('sin reintentos')) throw err;
        if (intento < MAX_RETRIES) {
          const espera = Math.pow(2, intento) * 1000;
          console.warn(`[REST] Intento ${intento} falló (${err.message}). Reintentando en ${espera/1000}s...`);
          await new Promise(r => setTimeout(r, espera));
          return fetchConReintentos(restBase, typename, where, intento + 1);
        }
        throw err;
      }
    }

    console.log(`[REST] OK (secuencial): ${typename} → ${allFeatures.length} features`);
    return { type: 'FeatureCollection', features: allFeatures };
  }

  // ── Deduplicación de requests en vuelo ───────────────────────

  const _inFlight = new Map();

  // ── Fetch principal (interfaz idéntica a wfs.js) ──────────────

  async function fetchLayer(typename, options = {}) {
    const {
      restBase,
      whereClause,   // equivalente a cqlFilter — SQL WHERE sin la palabra WHERE
      maxFeatures,
      forceRefresh,
    } = options;

    if (!restBase) throw new Error(`[REST] restBase requerido para "${typename}". Verificá que la fuente tenga "restBase" en window.SOURCES.`);

    // Sanitizar whereClause: corregir IN (['a','b']) → IN ('a','b')
    // El LLM a veces genera corchetes en lugar de paréntesis, lo que causa error 400/500 en ArcGIS.
    const sanitizedWhere = (whereClause || '').replace(/IN\s*\(\[([^\]]*)\]\)/gi, 'IN ($1)');
    const where = sanitizedWhere || '1=1';
    const key   = cacheKey(restBase, typename, where);

    // 1. Caché fresca
    if (!forceRefresh) {
      const cached = await cacheGet(key);
      if (cached && !cached.stale) {
        console.log(`[REST] Caché fresca: ${typename}`);
        return cached.data;
      }
    }

    // 2. Deduplicación
    if (_inFlight.has(key)) {
      console.log(`[REST] Reutilizando fetch en vuelo: ${typename}`);
      return _inFlight.get(key);
    }

    console.log(`[REST] Fetching: ${typename}${where !== '1=1' ? ' | ' + where : ''} (${restBase})`);

    const fetchPromise = fetchConReintentos(restBase, typename, where)
      .then(async geojson => {
        // Respetar maxFeatures si se especifica
        if (maxFeatures && geojson.features.length > maxFeatures) {
          geojson.features = geojson.features.slice(0, maxFeatures);
        }
        await cacheSet(key, geojson);
        console.log(`[REST] OK: ${typename} → ${geojson.features.length} features`);
        return geojson;
      })
      .catch(async err => {
        console.warn(`[REST] Todos los intentos fallaron para ${typename}: ${err.message}`);
        const stale = await cacheGet(key);
        if (stale) {
          console.warn(`[REST] Usando caché vencida para ${typename}`);
          window.TOAST?.warning(t('toast_cache_warning'));
          return stale.data;
        }

        const isServerError =
          /HTTP 5\d\d/.test(err.message) ||
          err.name === 'TimeoutError' ||
          err.message.toLowerCase().includes('network') ||
          err.message.toLowerCase().includes('cors');

        let orgLabel = restBase;
        try {
          const host = new URL(restBase).hostname;
          const src  = Object.values(window.SOURCES || {}).find(s => s.restBase?.includes(host));
          if (src?.label) orgLabel = src.label;
        } catch {}

        const msg = isServerError
          ? t('toast_server_unavailable', { org: orgLabel })
          : t('toast_layer_fetch_error', { typename, msg: err.message });

        const error = new Error(msg);
        error.isExternalServerError = isServerError;
        throw error;
      })
      .finally(() => {
        _inFlight.delete(key);
      });

    _inFlight.set(key, fetchPromise);
    return fetchPromise;
  }

  // ── Helpers de filtro (equivalentes a los de wfs.js) ─────────

  // SQL WHERE — ArcGIS no soporta CQL
  function filterEqual(campo, valor) {
    // Strings → comillas simples; números → sin comillas
    const esNumero = !isNaN(valor) && valor !== '';
    return esNumero
      ? `${campo} = ${valor}`
      : `${campo} = '${String(valor).replace(/'/g, "''")}'`;
  }

  function filterIn(campo, valores) {
    if (!valores.length) return '1=0';
    const lista = valores.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
    return `${campo} IN (${lista})`;
  }

  // ── API pública ───────────────────────────────────────────────

  return {
    fetch:       fetchLayer,
    filterEqual,
    filterIn,
    clearCache: async () => {
      // Limpia todo el store compartido con wfs.js
      window.WFS?.clearCache?.();
    },
  };

})();
