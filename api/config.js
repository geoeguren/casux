/**
 * api/config.js — Configuración pública de la app
 *
 * GET /api/config → devuelve configuración pública (cacheable 1 hora)
 *
 * Los health checks de geoservicios fueron movidos a api/status.js,
 * donde también se consolidarán las estadísticas de uso.
 */

const { checkOrigin } = require('./_cors');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    analyticsKey: process.env.ANALYTICS_KEY || '',
    redirectUri:  process.env.REDIRECT_URI  || '',
    appOrigin:    process.env.APP_ORIGIN    || 'https://casux.vercel.app',
    b2PublicUrl:  process.env.B2_PUBLIC_URL || '',
  });
};
