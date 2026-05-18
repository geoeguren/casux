/**
 * api/auth/anon.js — Emite un token anónimo firmado con HMAC-SHA256
 *
 * El cliente llama a este endpoint cuando no hay sesión activa.
 * El token anónimo es indistinguible del de Google para db.js —
 * la diferencia está en el uid (prefijo "anon_") y en la ausencia de email/name/photo.
 *
 * Al hacer login con Google, callback.js migra los chats del uid anónimo al uid real.
 */

const crypto = require('crypto');
const { checkOrigin } = require('../_cors');
const { signToken }   = require('./_token');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    console.error('[auth/anon] TOKEN_SECRET no configurado');
    return res.status(500).json({ error: 'server_config_error' });
  }

  const TOKEN_VERSION = 1;
  const uid = 'anon_' + crypto.randomBytes(16).toString('hex');

  const session = {
    uid,
    anon: true,
    exp: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 días
    v:   TOKEN_VERSION,
  };

  const signedToken = signToken(session, tokenSecret);
  return res.status(200).json({ token: signedToken });
};
