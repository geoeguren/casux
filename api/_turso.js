/**
 * api/_turso.js — Inicialización compartida del cliente Turso/SQLite
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Reemplaza a api/_firebase.js.
 * Importado por api/db.js, api/analytics.js y api/metrics.js.
 */

const { createClient } = require('@libsql/client');

let _client = null;

function getDb() {
  if (!_client) {
    _client = createClient({
      url:       process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

module.exports = { getDb };
