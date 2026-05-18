/**
 * api/maki.js — Proxy serverless para íconos Maki
 *
 * Recibe:  GET /api/maki?icon=airport
 * Devuelve: SVG del ícono con cache de 1 año
 *
 * Por qué existe:
 *   El browser no puede hacer fetch() a cdn.jsdelivr.net porque el CSP
 *   no incluye ese dominio en connect-src. Este endpoint actúa como proxy:
 *   el browser llama a 'self' (/api/maki) y el servidor fetchea jsdelivr
 *   donde el CSP no aplica.
 *
 *   Vercel cachea la respuesta en el edge (Cache-Control: max-age=31536000),
 *   así que jsdelivr solo se consulta una vez por ícono por región edge.
 *
 *   Si Maki actualiza sus íconos, se reflejan automáticamente sin cambiar nada.
 *   Si se quiere cambiar de CDN o versión, solo hay que tocar MAKI_BASE acá.
 */

const MAKI_BASE = 'https://cdn.jsdelivr.net/npm/@mapbox/maki@8/icons/';
const { checkOrigin } = require('./_cors');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  const icon = (req.query.icon || '').replace(/[^a-z0-9\-]/g, '');

  if (!icon) {
    return res.status(400).json({ error: 'Falta parámetro icon' });
  }

  const url = `${MAKI_BASE}${icon}.svg`;

  try {
    const upstream = await fetch(url);

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Ícono no encontrado: ${icon}` });
    }

    const svg = await upstream.text();

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(svg);

  } catch (err) {
    console.error('[maki] Error fetching icon:', icon, err.message);
    return res.status(502).json({ error: 'No se pudo obtener el ícono' });
  }
};
