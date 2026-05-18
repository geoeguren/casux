/**
 * api/db.js — Operaciones de Firestore con Firebase Admin SDK
 *
 * Seguridad: verifica firma HMAC-SHA256 del token antes de confiar en el uid.
 * Un usuario no puede leer ni modificar datos de otro.
 */

const crypto = require('crypto');
const { checkOrigin } = require('./_cors');
const { getDb, FieldValue } = require('./_firebase');

// ── Verificar sesión con firma HMAC ───────────────────────────────

function verifySession(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token  = authHeader.slice(7);
  const secret = process.env.TOKEN_SECRET;

  // TOKEN_SECRET es obligatorio. Si no está configurado, rechazar toda autenticación.
  if (!secret) {
    console.error('[db] TOKEN_SECRET no configurado — autenticación deshabilitada');
    return null;
  }

  // Verificar firma: formato "base64payload.base64sig"
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const data        = token.slice(0, dotIndex);
  const receivedSig = token.slice(dotIndex + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64');

  // Comparación en tiempo constante para evitar timing attacks
  try {
    const a = Buffer.from(receivedSig, 'base64');
    const b = Buffer.from(expectedSig, 'base64');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch { return null; }

  try {
    const session = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    if (!session.uid || !session.exp) return null;
    if (Date.now() > session.exp) return null;

    // Verificar versión mínima del token.
    // Si TOKEN_MIN_VERSION está definido y el token tiene v < ese valor,
    // se considera revocado. Para invalidar todos los tokens activos:
    //   1. Subir TOKEN_MIN_VERSION en las variables de entorno de Vercel
    //   2. Los tokens anteriores quedan inválidos de inmediato
    const minVersion = parseInt(process.env.TOKEN_MIN_VERSION || '0', 10);
    const tokenVersion = session.v || 0;
    if (tokenVersion < minVersion) return null;

    return session;
  } catch { return null; }
}

// Campos que el cliente puede actualizar en un chat existente.
// Cualquier campo fuera de esta lista es silenciosamente ignorado,
// lo que impide sobreescribir campos de sistema como shortId o createdAt.
const ALLOWED_UPDATE_FIELDS = ['titulo', 'messages', 'lastMap', 'popupPrefs'];

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = verifySession(req);
  if (!session) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  const { op, userId, chatId, titulo, data, max } = req.body || {};

  if (!op || !userId) {
    return res.status(400).json({ error: 'Se requiere op y userId' });
  }

  if (session.uid !== userId) {
    console.warn(`[db] Acceso denegado: session.uid=${session.uid} != userId=${userId}`);
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  try {
    const db = getDb();

    if (op === 'createChat') {
      // Generar shortId de 12 dígitos usando CSPRNG para evitar colisiones predecibles
      const shortId = String(crypto.randomInt(1e11, 1e12));
      const ref = await db
        .collection('users').doc(userId)
        .collection('chats').add({
          titulo:    titulo || 'Nuevo mapa',
          shortId:   shortId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          messages:  []
        });
      return res.status(200).json({ id: ref.id, shortId });
    }

    if (op === 'updateChat') {
      if (!chatId) return res.status(400).json({ error: 'Se requiere chatId' });
      // Filtrar solo los campos permitidos para evitar sobreescribir
      // campos de sistema como shortId, createdAt o cualquier campo futuro.
      const safeData = Object.fromEntries(
        Object.entries(data || {}).filter(([k]) => ALLOWED_UPDATE_FIELDS.includes(k))
      );
      await db
        .collection('users').doc(userId)
        .collection('chats').doc(chatId)
        .update({ ...safeData, updatedAt: FieldValue.serverTimestamp() });
      return res.status(200).json({ ok: true });
    }

    if (op === 'getUserChats') {
      const snap = await db
        .collection('users').doc(userId)
        .collection('chats')
        .orderBy('updatedAt', 'desc')
        .limit(max || 30)
        .get();
      const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ chats });
    }

    // getUserChatsMeta: devuelve solo los campos necesarios para renderizar el sidebar
    // (titulo, shortId, updatedAt). No incluye messages ni lastMap.
    //
    // Paginación con cursor:
    //   - Sin startAfter: devuelve los primeros `max` chats
    //   - Con startAfter (ISO string de updatedAt del último chat visible):
    //     devuelve los siguientes `max` chats a partir de ese punto
    //
    // El cliente envía startAfter solo al presionar "Cargar más".
    if (op === 'getUserChatsMeta') {
      const { startAfter } = req.body;
      let query = db
        .collection('users').doc(userId)
        .collection('chats')
        .orderBy('updatedAt', 'desc')
        .select('titulo', 'shortId', 'updatedAt');

      // Cursor de paginación: buscar el documento del cursor para usar startAfter
      if (startAfter) {
        // startAfter es el ID del último doc visible — buscarlo para obtener el snapshot
        const cursorDoc = await db
          .collection('users').doc(userId)
          .collection('chats').doc(startAfter)
          .get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snap = await query.limit(max || 30).get();
      const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // hasMore indica al cliente si hay más chats disponibles
      const hasMore = snap.docs.length === (max || 30);
      return res.status(200).json({ chats, hasMore });
    }

    if (op === 'deleteChat') {
      if (!chatId) return res.status(400).json({ error: 'Se requiere chatId' });
      await db
        .collection('users').doc(userId)
        .collection('chats').doc(chatId)
        .delete();
      return res.status(200).json({ ok: true });
    }

    if (op === 'getChat') {
      if (!chatId) return res.status(400).json({ error: 'Se requiere chatId' });
      const doc = await db
        .collection('users').doc(userId)
        .collection('chats').doc(chatId)
        .get();
      if (!doc.exists) return res.status(404).json({ error: 'Chat no encontrado' });
      return res.status(200).json({ chat: { id: doc.id, ...doc.data() } });
    }

    if (op === 'getChatByShortId') {
      const { shortId } = req.body;
      if (!shortId) return res.status(400).json({ error: 'Se requiere shortId' });
      const snap = await db
        .collection('users').doc(userId)
        .collection('chats')
        .where('shortId', '==', shortId)
        .limit(1)
        .get();
      if (snap.empty) return res.status(404).json({ error: 'Chat no encontrado' });
      const doc = snap.docs[0];
      return res.status(200).json({ chat: { id: doc.id, ...doc.data() } });
    }

    // migrateChats: mueve los chats de anonUid al userId autenticado.
    // Solo puede hacerlo el propio usuario autenticado (session.uid === userId).
    // anonUid debe empezar con "anon_" para evitar migraciones entre cuentas reales.
    if (op === 'migrateChats') {
      const { anonUid } = req.body;
      if (!anonUid || !anonUid.startsWith('anon_')) {
        return res.status(400).json({ error: 'anonUid inválido' });
      }
      const anonChats = await db
        .collection('users').doc(anonUid)
        .collection('chats')
        .orderBy('updatedAt', 'asc')
        .get();

      if (anonChats.empty) return res.status(200).json({ migrated: 0 });

      const batch = db.batch();
      anonChats.docs.forEach(doc => {
        const destRef = db
          .collection('users').doc(userId)
          .collection('chats').doc(doc.id);
        batch.set(destRef, doc.data());
        batch.delete(doc.ref);
      });
      await batch.commit();

      // Eliminar el documento raíz del usuario anónimo
      await db.collection('users').doc(anonUid).delete().catch(() => {});

      return res.status(200).json({ migrated: anonChats.size });
    }

    return res.status(400).json({ error: `Operación desconocida: ${op}` });

  } catch (err) {
    console.error('[db]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
