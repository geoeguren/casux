/**
 * api/analytics.js — Registro de eventos de uso para métricas PMV
 *
 * Colección Firestore: events/{autoId}
 * Cada documento tiene: event, userId, sessionId, ts, props
 *
 * No requiere auth fuerte — solo una clave de API interna para evitar
 * spam. Los datos no son sensibles (no hay PII más allá del userId).
 */

const { getDb, FieldValue } = require('./_firebase');
const { checkOrigin }       = require('./_cors');

// Eventos permitidos — lista blanca para evitar ruido
const ALLOWED_EVENTS = new Set([
  'session_start',
  'map_generated',
  'map_exported',
  'style_changed',
  'chat_message_sent',
  'chat_message_failed',
]);

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Clave interna simple — evita que terceros escriban eventos
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
    await db.collection('events').add({
      event,
      userId:    userId || 'anonymous',
      sessionId: sessionId || null,
      ts:        FieldValue.serverTimestamp(),
      props,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[analytics]', err.message);
    // Fallo silencioso — el tracking nunca debe romper el flujo principal
    return res.status(500).json({ error: err.message });
  }
};
