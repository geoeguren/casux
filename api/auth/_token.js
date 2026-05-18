/**
 * api/auth/_token.js — Firma de tokens HMAC-SHA256
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/auth/anon.js y api/auth/callback.js.
 *
 * Formato del token: base64(payload) + "." + base64(hmac)
 * La verificación de firma ocurre en api/db.js (verifySession).
 *
 * Centralizado aquí para que cualquier cambio en el algoritmo
 * (ej: agregar iat, cambiar encoding) se aplique en un solo lugar.
 */

const crypto = require('crypto');

/**
 * signToken(payload, secret) → string
 *
 * Serializa el payload como JSON, lo codifica en base64,
 * calcula un HMAC-SHA256 sobre ese string y devuelve ambos
 * concatenados con un punto.
 */
function signToken(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig   = crypto.createHmac('sha256', secret).update(data).digest('base64');
  return data + '.' + sig;
}

module.exports = { signToken };
