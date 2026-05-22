/**
 * api/analytics.js — Registro de eventos de uso + cron de snapshot de métricas
 *
 * POST /api/analytics  → registra un evento (requiere X-Analytics-Key)
 * GET  /api/analytics  → genera snapshot de métricas (requiere X-Cron-Key,
 *                        llamado por Vercel Cron Jobs cada 24 horas)
 *
 * El snapshot se guarda en la tabla metrics_snapshots: una fila por period.
 * api/metrics.js solo lee esas 4 filas → mínimas lecturas por request.
 *
 * Tabla eventos: events
 * Cada fila tiene: event, user_id, session_id, ts, props (JSON)
 */

const crypto          = require('crypto');
const { checkOrigin } = require('./_cors');
const { getDb }       = require('./_turso');

// ── Eventos permitidos ────────────────────────────────────────────

const ALLOWED_EVENTS = new Set([
  'session_start',
  'map_generated',
  'map_exported',
  'style_changed',
  'chat_message_sent',
  'chat_message_failed',
]);

// ── Lógica de snapshot ────────────────────────────────────────────

function getCutoff(period) {
  const now = Date.now();
  if (period === '7d')  return new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  if (period === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (period === '90d') return new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
  return null; // 'all'
}

function dateKey(ts) {
  return String(ts).slice(0, 10); // YYYY-MM-DD
}

async function computeMetrics(period) {
  const db     = getDb();
  const cutoff = getCutoff(period);

  const result = cutoff
    ? await db.execute({ sql: `SELECT * FROM events WHERE ts >= ?`, args: [cutoff] })
    : await db.execute({ sql: `SELECT * FROM events`, args: [] });

  const docs = result.rows.map(r => ({
    event:     r.event,
    userId:    r.user_id,
    sessionId: r.session_id,
    ts:        r.ts,
    props:     safeJson(r.props, {}),
  }));

  const sessions      = new Set();
  const users         = new Set();
  const sessionDates  = {};
  const sessionHasMap = new Set();

  let mapsGenerated    = 0;
  let mapsExported     = 0;
  let messages         = 0;
  let totalLayers      = 0;
  let mapLayerCount    = 0;
  let totalMsToFirst   = 0;
  let msToFirstCount   = 0;
  let totalRefinements = 0;
  let refinementsCount = 0;

  const layerCounts     = {};
  const langCounts      = {};
  const queryTypeCounts = {};
  const sourceCounts    = {};
  const userTypeCounts  = { anon: 0, registered: 0 };
  let   mobileCount     = 0;
  let   desktopCount    = 0;

  const mapsPerDay     = {};
  const sessionsPerDay = {};

  for (const doc of docs) {
    const { event, userId, sessionId, ts, props } = doc;

    if (sessionId) {
      sessions.add(sessionId);
      const dk = dateKey(ts);
      if (!sessionDates[sessionId]) {
        sessionDates[sessionId] = dk;
        if (!sessionsPerDay[dk]) sessionsPerDay[dk] = new Set();
        sessionsPerDay[dk].add(sessionId);
      }
    }

    if (userId && userId !== 'anonymous' && !userId.startsWith('anon_')) {
      users.add(userId);
    }

    if (props.language) langCounts[props.language] = (langCounts[props.language] || 0) + 1;
    if (props.mobile === true)  mobileCount++;
    if (props.mobile === false) desktopCount++;

    if (event === 'session_start' && props.userType) {
      const ut = props.userType === 'registered' ? 'registered' : 'anon';
      userTypeCounts[ut]++;
    }

    if (event === 'map_generated') {
      mapsGenerated++;
      if (sessionId) sessionHasMap.add(sessionId);

      const dk = dateKey(ts);
      mapsPerDay[dk] = (mapsPerDay[dk] || 0) + 1;

      if (props.layerCount > 0) { totalLayers += props.layerCount; mapLayerCount++; }
      if (props.msToFirstMap != null) { totalMsToFirst += props.msToFirstMap; msToFirstCount++; }

      if (Array.isArray(props.layers)) {
        for (const lk of props.layers) layerCounts[lk] = (layerCounts[lk] || 0) + 1;
      }
      if (Array.isArray(props.queryTypes)) {
        for (const qt of props.queryTypes) queryTypeCounts[qt] = (queryTypeCounts[qt] || 0) + 1;
      }
      if (Array.isArray(props.sources)) {
        for (const src of props.sources) sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      }
    }

    if (event === 'map_exported') mapsExported++;

    if (event === 'chat_message_sent') {
      messages++;
      if (props.refinements > 0) { totalRefinements += props.refinements; refinementsCount++; }
    }
  }

  const sessionCount     = sessions.size;
  const sessionToMapRate = sessionCount > 0
    ? Math.round((sessionHasMap.size / sessionCount) * 100) : 0;
  const avgLayersPerMap  = mapLayerCount > 0
    ? Math.round((totalLayers / mapLayerCount) * 10) / 10 : 0;
  const avgMsToFirstMap  = msToFirstCount > 0
    ? Math.round(totalMsToFirst / msToFirstCount) : null;
  const avgRefinements   = refinementsCount > 0
    ? Math.round((totalRefinements / refinementsCount) * 10) / 10 : 0;

  const topLayers = Object.entries(layerCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  const sessionsPerDaySerialized = Object.fromEntries(
    Object.entries(sessionsPerDay).map(([d, set]) => [d, set.size])
  );

  return {
    period,
    computedAt:     new Date().toISOString(),
    sessions:       sessionCount,
    users:          users.size,
    mapsGenerated,
    mapsExported,
    messages,
    sessionToMapRate,
    avgLayersPerMap,
    avgMsToFirstMap,
    avgRefinements,
    topLayers,
    byLanguage:     langCounts,
    byDevice:       { mobile: mobileCount, desktop: desktopCount },
    byQueryType:    queryTypeCounts,
    bySource:       sourceCounts,
    byUserType:     userTypeCounts,
    mapsPerDay,
    sessionsPerDay: sessionsPerDaySerialized,
  };
}

async function generateSnapshots() {
  const db      = getDb();
  const periods = ['7d', '30d', '90d', 'all'];
  for (const period of periods) {
    const data = await computeMetrics(period);
    await db.execute({
      sql:  `INSERT OR REPLACE INTO metrics_snapshots (period, data, computed_at)
             VALUES (?, ?, datetime('now'))`,
      args: [period, JSON.stringify(data)],
    });
  }
  return periods;
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  // GET → cron de snapshot
  if (req.method === 'GET') {
    const key = req.headers['x-cron-key'];
    if (!key || key !== process.env.CRON_KEY) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const periods = await generateSnapshots();
      console.log('[analytics/cron] snapshots generados:', periods.join(', '));
      return res.status(200).json({ ok: true, periods });
    } catch (err) {
      console.error('[analytics/cron]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST → registro de evento
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = req.headers['x-analytics-key'];
  if (key !== process.env.ANALYTICS_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { event, userId, sessionId, props = {} } = req.body || {};

  if (!event || !ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ error: `Evento no permitido: ${event}` });
  }

  try {
    const db = getDb();
    await db.execute({
      sql:  `INSERT INTO events (id, event, user_id, session_id, ts, props)
             VALUES (?, ?, ?, ?, datetime('now'), ?)`,
      args: [
        crypto.randomUUID(),
        event,
        userId    || 'anonymous',
        sessionId || null,
        JSON.stringify(props),
      ],
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[analytics]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── Helpers ───────────────────────────────────────────────────────

function safeJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
