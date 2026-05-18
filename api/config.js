/**
 * api/config.js — Expone configuración pública al cliente
 *
 * analyticsKey: no es secreta — solo evita spam externo.
 * redirectUri:  la redirect_uri de OAuth Google. No es secreta (el browser
 *               la ve en la URL de redirección), pero sacarla del código
 *               permite desplegar en dominios distintos sin tocar fuentes.
 */
const { checkOrigin } = require('./_cors');

module.exports = function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    analyticsKey: process.env.ANALYTICS_KEY  || '',
    redirectUri:  process.env.REDIRECT_URI   || '',
    appOrigin:    process.env.APP_ORIGIN      || 'https://casux.vercel.app',
  });
};
