/**
 * api/metrics.js — Estadísticas de uso para la página /metrics
 *
 * GET /api/metrics?period=30d   → métricas de los últimos 30 días
 * GET /api/metrics?period=7d    → últimos 7 días
 * GET /api/metrics?period=all   → histórico completo
 *
 * Protegido con la misma ANALYTICS_KEY que api/analytics.js.
 * No expone PII — solo conteos y agregados.
 *
 * Métricas devueltas:
 *   - sessions:      total de sesiones únicas
 *   - users:         usuarios únicos (userId)
 *   - mapsGenerated: mapas generados
 *   - mapsExported:  mapas exportados
 *   - messages:      mensajes enviados
 *   - avgLayersPerMap: promedio de capas por mapa
 *   - avgMsToFirstMap: tiempo promedio hasta primer mapa (ms)
 *   - avgRefinements: promedio de mensajes de refinamiento por sesión
 *   - topLayers:     top 10 capas más usadas (layerKey → count)
 *   - byLanguage:    distribución por idioma
 *   - byMobile:      % mobile vs desktop
 *   - mapsPerDay:    serie temporal de mapas por día (últimos 30d)
 *   - sessionsPerDay: serie temporal de sesiones por día (últimos 30d)
 *   - sessionToMapRate: % de sesiones que generaron al menos un mapa
 *
 * Métricas implementadas en esta versión:
 *   - byQueryType:  distribución por tipo de operación (clip, intersect, buffer...)
 *   - byUserType:   anónimo vs registrado
 *   - bySource:     distribución por país de fuente (ar, uy, cl...)
 */

const { getDb } = require('./_firebase');
const { checkOrigin } = require('./_cors');

// Caché en memoria — evita leer Firestore en cada request de la página
// TTL de 5 minutos: las métricas no necesitan ser en tiempo real
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = {};

function getCutoff(period) {
  const now = Date.now();
  if (period === '7d')  return new Date(now - 7  * 24 * 60 * 60 * 1000);
  if (period === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  if (period === '90d') return new Date(now - 90 * 24 * 60 * 60 * 1000);
  return null; // 'all'
}

function dateKey(ts) {
  // YYYY-MM-DD en UTC
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}

async function computeMetrics(period) {
  const db     = getDb();
  const cutoff = getCutoff(period);

  let query = db.collection('events');
  if (cutoff) {
    const { Timestamp } = require('firebase-admin/firestore');
    query = query.where('ts', '>=', Timestamp.fromDate(cutoff));
  }

  const snap = await query.get();
  const docs  = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // ── Acumuladores ───────────────────────────────────────────────

  const sessions      = new Set();
  const users         = new Set();
  const sessionDates  = {}; // sessionId → fecha del primer evento
  const sessionHasMap = new Set(); // sessionIds que generaron mapa

  let mapsGenerated  = 0;
  let mapsExported   = 0;
  let messages       = 0;
  let totalLayers    = 0;
  let mapLayerCount  = 0; // cuántos maps aportaron layerCount
  let totalMsToFirst = 0;
  let msToFirstCount = 0;
  let totalRefinements    = 0;
  let refinementsCount    = 0;

  const layerCounts   = {}; // layerKey → count
  const langCounts    = {}; // language → count
  const queryTypeCounts = {}; // op → count
  const sourceCounts  = {}; // country → count
  const userTypeCounts = { anon: 0, registered: 0 };
  let   mobileCount   = 0;
  let   desktopCount  = 0;

  const mapsPerDay     = {}; // YYYY-MM-DD → count
  const sessionsPerDay = {}; // YYYY-MM-DD → Set de sessionIds

  // ── Procesar eventos ───────────────────────────────────────────

  for (const doc of docs) {
    const { event, userId, sessionId, ts, props = {} } = doc;

    if (sessionId) {
      sessions.add(sessionId);
      // Primer día de la sesión
      const dk = dateKey(ts);
      if (!sessionDates[sessionId]) {
        sessionDates[sessionId] = dk;
        if (!sessionsPerDay[dk]) sessionsPerDay[dk] = new Set();
        sessionsPerDay[dk].add(sessionId);
      }
    }

    // Usuarios registrados: excluir anónimos ('anonymous' o uid con prefijo 'anon_')
    if (userId && userId !== 'anonymous' && !userId.startsWith('anon_')) {
      users.add(userId);
    }

    // Idioma y mobile — desde cualquier evento
    if (props.language) langCounts[props.language] = (langCounts[props.language] || 0) + 1;
    if (props.mobile === true)  mobileCount++;
    if (props.mobile === false) desktopCount++;

    if (event === 'session_start') {
      if (props.userType) {
        const ut = props.userType === 'registered' ? 'registered' : 'anon';
        userTypeCounts[ut]++;
      }
    }

    if (event === 'map_generated') {
      mapsGenerated++;
      if (sessionId) sessionHasMap.add(sessionId);

      const dk = dateKey(ts);
      mapsPerDay[dk] = (mapsPerDay[dk] || 0) + 1;

      if (props.layerCount > 0) {
        totalLayers  += props.layerCount;
        mapLayerCount++;
      }

      if (props.msToFirstMap != null) {
        totalMsToFirst += props.msToFirstMap;
        msToFirstCount++;
      }

      if (Array.isArray(props.layers)) {
        for (const lk of props.layers) {
          layerCounts[lk] = (layerCounts[lk] || 0) + 1;
        }
      }

      if (Array.isArray(props.queryTypes)) {
        for (const qt of props.queryTypes) {
          queryTypeCounts[qt] = (queryTypeCounts[qt] || 0) + 1;
        }
      }

      if (Array.isArray(props.sources)) {
        for (const src of props.sources) {
          sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        }
      }
    }

    if (event === 'map_exported') {
      mapsExported++;
    }

    if (event === 'chat_message_sent') {
      messages++;
      if (props.refinements > 0) {
        totalRefinements += props.refinements;
        refinementsCount++;
      }
    }
  }

  // ── Derivar métricas ───────────────────────────────────────────

  const sessionCount      = sessions.size;
  const sessionToMapRate  = sessionCount > 0
    ? Math.round((sessionHasMap.size / sessionCount) * 100)
    : 0;

  const avgLayersPerMap   = mapLayerCount > 0
    ? Math.round((totalLayers / mapLayerCount) * 10) / 10
    : 0;

  const avgMsToFirstMap   = msToFirstCount > 0
    ? Math.round(totalMsToFirst / msToFirstCount)
    : null;

  const avgRefinements    = refinementsCount > 0
    ? Math.round((totalRefinements / refinementsCount) * 10) / 10
    : 0;

  // Top 10 capas
  const topLayers = Object.entries(layerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  // Serializar sessionsPerDay para JSON
  const sessionsPerDaySerialized = Object.fromEntries(
    Object.entries(sessionsPerDay).map(([d, set]) => [d, set.size])
  );

  return {
    period,
    computedAt:      new Date().toISOString(),
    sessions:        sessionCount,
    users:           users.size,
    mapsGenerated,
    mapsExported,
    messages,
    sessionToMapRate,
    avgLayersPerMap,
    avgMsToFirstMap,
    avgRefinements,
    topLayers,
    byLanguage:      langCounts,
    byDevice:        { mobile: mobileCount, desktop: desktopCount },
    byQueryType:     queryTypeCounts,
    bySource:        sourceCounts,
    byUserType:      userTypeCounts,
    mapsPerDay,
    sessionsPerDay:  sessionsPerDaySerialized,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  // Solo GET
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth — misma clave que analytics
  const key = req.headers['x-analytics-key'];
  if (key !== process.env.ANALYTICS_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const period = ['7d', '30d', '90d', 'all'].includes(req.query.period)
    ? req.query.period
    : '30d';

  // Caché en memoria
  const cacheKey = period;
  const cached   = _cache[cacheKey];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  try {
    const data = await computeMetrics(period);
    _cache[cacheKey] = { ts: Date.now(), data };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[api/metrics]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
