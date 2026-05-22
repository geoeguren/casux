/**
 * api/db.js — Operaciones de base de datos con Turso/SQLite
 *
 * Reemplaza la versión anterior que usaba Firestore (Firebase Admin SDK).
 * La lógica de autenticación HMAC-SHA256 es idéntica — no cambia nada
 * en el frontend ni en los demás endpoints.
 */

const crypto    = require('crypto');
const { checkOrigin } = require('./_cors');
const { getDb }       = require('./_turso');

// ── Verificar sesión con firma HMAC ───────────────────────────────
// Idéntico a la versión anterior — no se tocó nada.

function verifySession(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token  = authHeader.slice(7);
  const secret = process.env.TOKEN_SECRET;

  if (!secret) {
    console.error('[db] TOKEN_SECRET no configurado — autenticación deshabilitada');
    return null;
  }

  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const data        = token.slice(0, dotIndex);
  const receivedSig = token.slice(dotIndex + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64');

  try {
    const a = Buffer.from(receivedSig, 'base64');
    const b = Buffer.from(expectedSig, 'base64');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch { return null; }

  try {
    const session = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    if (!session.uid || !session.exp) return null;
    if (Date.now() > session.exp) return null;

    const minVersion   = parseInt(process.env.TOKEN_MIN_VERSION || '0', 10);
    const tokenVersion = session.v || 0;
    if (tokenVersion < minVersion) return null;

    return session;
  } catch { return null; }
}

const ALLOWED_UPDATE_FIELDS = ['titulo', 'messages', 'lastMap', 'popupPrefs'];

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = verifySession(req);
  if (!session) return res.status(401).json({ error: 'No autenticado' });

  const { op, userId, chatId, titulo, data, max } = req.body || {};

  if (!op || !userId) return res.status(400).json({ error: 'Se requiere op y userId' });

  if (session.uid !== userId) {
    console.warn(`[db] Acceso denegado: session.uid=${session.uid} != userId=${userId}`);
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  try {
    const db = getDb();

    // ── createChat ────────────────────────────────────────────────
    if (op === 'createChat') {
      const id      = crypto.randomUUID();
      const shortId = String(crypto.randomInt(1e11, 1e12));
      await db.execute({
        sql: `INSERT INTO chats (id, user_id, titulo, short_id, messages, created_at, updated_at)
              VALUES (?, ?, ?, ?, '[]', datetime('now'), datetime('now'))`,
        args: [id, userId, titulo || 'Nuevo mapa', shortId],
      });
      return res.status(200).json({ id, shortId });
    }

    // ── updateChat ────────────────────────────────────────────────
    if (op === 'updateChat') {
      if (!chatId) return res.status(400).json({ error: 'Se requiere chatId' });

      // Filtrar solo campos permitidos
      const safeData = Object.fromEntries(
        Object.entries(data || {}).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k))
      );

      // Mapear camelCase → snake_case para la DB
      const colMap = { titulo: 'titulo', messages: 'messages', lastMap: 'last_map', popupPrefs: 'popup_prefs' };

      const sets = [];
      const args = [];
      for (const [key, val] of Object.entries(safeData)) {
        sets.push(`${colMap[key]} = ?`);
        args.push(typeof val === 'string' ? val : JSON.stringify(val));
      }
      if (!sets.length) return res.status(200).json({ ok: true });

      sets.push(`updated_at = datetime('now')`);
      args.push(chatId, userId);

      await db.execute({
        sql: `UPDATE chats SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
        args,
      });
      return res.status(200).json({ ok: true });
    }

    // ── getUserChats ──────────────────────────────────────────────
    if (op === 'getUserChats') {
      const limit = max || 30;
      const result = await db.execute({
        sql:  `SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
        args: [userId, limit],
      });
      const chats = result.rows.map(rowToChat);
      return res.status(200).json({ chats });
    }

    // ── getUserChatsMeta ──────────────────────────────────────────
    if (op === 'getUserChatsMeta') {
      const { startAfter } = req.body;
      const limit = max || 30;

      let cursor = null;
      if (startAfter) {
        const cur = await db.execute({
          sql:  `SELECT updated_at FROM chats WHERE id = ? AND user_id = ?`,
          args: [startAfter, userId],
        });
        if (cur.rows.length) cursor = cur.rows[0].updated_at;
      }

      const result = await db.execute({
        sql: cursor
          ? `SELECT id, titulo, short_id, updated_at FROM chats
             WHERE user_id = ? AND updated_at < ?
             ORDER BY updated_at DESC LIMIT ?`
          : `SELECT id, titulo, short_id, updated_at FROM chats
             WHERE user_id = ?
             ORDER BY updated_at DESC LIMIT ?`,
        args: cursor ? [userId, cursor, limit] : [userId, limit],
      });

      const chats   = result.rows.map(r => ({
        id:        r.id,
        titulo:    r.titulo,
        shortId:   r.short_id,
        updatedAt: r.updated_at,
      }));
      const hasMore = chats.length === limit;
      return res.status(200).json({ chats, hasMore });
    }

    // ── deleteChat ────────────────────────────────────────────────
    if (op === 'deleteChat') {
      if (!chatId) return res.status(400).json({ error: 'Se requiere chatId' });
      await db.execute({
        sql:  `DELETE FROM chats WHERE id = ? AND user_id = ?`,
        args: [chatId, userId],
      });
      return res.status(200).json({ ok: true });
    }

    // ── getChat ───────────────────────────────────────────────────
    if (op === 'getChat') {
      if (!chatId) return res.status(400).json({ error: 'Se requiere chatId' });
      const result = await db.execute({
        sql:  `SELECT * FROM chats WHERE id = ? AND user_id = ?`,
        args: [chatId, userId],
      });
      if (!result.rows.length) return res.status(404).json({ error: 'Chat no encontrado' });
      return res.status(200).json({ chat: rowToChat(result.rows[0]) });
    }

    // ── getChatByShortId ──────────────────────────────────────────
    if (op === 'getChatByShortId') {
      const { shortId } = req.body;
      if (!shortId) return res.status(400).json({ error: 'Se requiere shortId' });
      const result = await db.execute({
        sql:  `SELECT * FROM chats WHERE short_id = ? AND user_id = ? LIMIT 1`,
        args: [shortId, userId],
      });
      if (!result.rows.length) return res.status(404).json({ error: 'Chat no encontrado' });
      return res.status(200).json({ chat: rowToChat(result.rows[0]) });
    }

    // ── migrateChats ──────────────────────────────────────────────
    if (op === 'migrateChats') {
      const { anonUid } = req.body;
      if (!anonUid || !anonUid.startsWith('anon_')) {
        return res.status(400).json({ error: 'anonUid inválido' });
      }
      const result = await db.execute({
        sql:  `SELECT COUNT(*) as count FROM chats WHERE user_id = ?`,
        args: [anonUid],
      });
      const count = result.rows[0].count;
      if (!count) return res.status(200).json({ migrated: 0 });

      await db.execute({
        sql:  `UPDATE chats SET user_id = ? WHERE user_id = ?`,
        args: [userId, anonUid],
      });
      return res.status(200).json({ migrated: count });
    }

    return res.status(400).json({ error: `Operación desconocida: ${op}` });

  } catch (err) {
    console.error('[db]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── Helpers ───────────────────────────────────────────────────────

// Convierte una fila de SQLite al formato que espera el frontend.
// Los campos JSON se parsean, los nombres van a camelCase.
function rowToChat(row) {
  return {
    id:         row.id,
    titulo:     row.titulo,
    shortId:    row.short_id,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
    messages:   safeJson(row.messages, []),
    lastMap:    safeJson(row.last_map,    null),
    popupPrefs: safeJson(row.popup_prefs, null),
  };
}

function safeJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
