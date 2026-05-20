/**
 * api/config.js — Configuración pública + health check de geoservicios
 *
 * GET /api/config                  → configuración pública de la app
 * GET /api/config?health=ign_ar    → health check de una fuente específica
 * GET /api/config?health=all       → health check de todas las fuentes
 *
 * El health check se fusiona acá para no superar el límite de 12 funciones
 * serverless del plan Hobby de Vercel.
 */

const { checkOrigin }  = require('./_cors');
const { SOURCES_DATA } = require('../layers/sources');

const TIMEOUT_MS = 10000;

function getCheckUrl(src) {
  if (src.wfsBase)  return `${src.wfsBase}?service=WFS&request=GetCapabilities&version=1.1.0`;
  if (src.restBase) return `${src.restBase}?f=json`;
  return null;
}

async function checkOne(sourceKey) {
  const src = SOURCES_DATA[sourceKey];
  if (!src) return { source: sourceKey, status: 'error', httpStatus: null, reason: 'unknown_source' };

  const url = getCheckUrl(src);
  if (!url) return { source: sourceKey, status: 'error', httpStatus: null, reason: 'no_url' };

  const start = Date.now();
  try {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      method:  'HEAD',
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'Casux-HealthCheck/1.0' },
    });

    clearTimeout(timeout);

    const latencyMs  = Date.now() - start;
    const httpStatus = response.status;
    const ok         = httpStatus >= 200 && httpStatus < 400;

    return { source: sourceKey, status: ok ? 'ok' : 'error', httpStatus, latencyMs };

  } catch (err) {
    return {
      source:     sourceKey,
      status:     'error',
      httpStatus: null,
      latencyMs:  Date.now() - start,
      reason:     err.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  const { health } = req.query;

  // ── Health check ──────────────────────────────────────────────────
  if (health) {
    res.setHeader('Cache-Control', 'no-store');

    if (health === 'all') {
      const results = await Promise.all(Object.keys(SOURCES_DATA).map(checkOne));
      return res.status(200).json(results);
    }

    if (!SOURCES_DATA[health]) {
      return res.status(400).json({
        error:     'Unknown source',
        available: Object.keys(SOURCES_DATA),
      });
    }

    const result = await checkOne(health);
    return res.status(200).json(result);
  }

  // ── Configuración pública ─────────────────────────────────────────
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    analyticsKey: process.env.ANALYTICS_KEY || '',
    redirectUri:  process.env.REDIRECT_URI  || '',
    appOrigin:    process.env.APP_ORIGIN    || 'https://casux.vercel.app',
  });
};
