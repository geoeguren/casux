/**
 * api/health.js — Health check real de geoservicios
 *
 * Hace el request server-side (sin restricciones CORS) a cada fuente
 * y devuelve el status HTTP real.
 *
 * Las URLs se leen de layers/_sources-data.js — la misma fuente de verdad
 * que layers/sources.js. Al agregar una fuente nueva en _sources-data.js,
 * el health check la detecta automáticamente sin tocar este archivo.
 *
 * GET /api/health?source=ign_ar   → chequea una fuente específica
 * GET /api/health                 → chequea todas las fuentes en paralelo
 */

const { checkOrigin }  = require('./_cors');
const { SOURCES_DATA } = require('../layers/sources');

const TIMEOUT_MS = 10000;

// Derivar URL de health check desde la definición de la fuente
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

  res.setHeader('Cache-Control', 'no-store');

  const { source } = req.query;

  if (source) {
    // Chequeo individual
    if (!SOURCES_DATA[source]) {
      return res.status(400).json({
        error:     'Unknown source',
        available: Object.keys(SOURCES_DATA),
      });
    }
    const result = await checkOne(source);
    return res.status(200).json(result);
  }

  // Chequeo de todas las fuentes en paralelo
  const results = await Promise.all(Object.keys(SOURCES_DATA).map(checkOne));
  return res.status(200).json(results);
};
