/**
 * db-client.js — Cliente de base de datos via Edge Function /api/db
 *
 * Usa el token firmado que entrega AUTH.getSignedToken().
 * La verificación de firma ocurre en el servidor (api/db.js).
 */

window.FB = (() => {

  async function call(op, params) {
    const token = window.AUTH?.getSignedToken?.();
    if (!token) throw new Error('No autenticado');

    const resp = await fetch('/api/db', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ op, ...params })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async function getChatByShortId(userId, shortId) {
    const { chat } = await call('getChatByShortId', { userId, shortId });
    return chat;
  }

  async function createChat(userId, titulo) {
    const { id, shortId } = await call('createChat', { userId, titulo });
    return { id, shortId };
  }

  async function updateChat(userId, chatId, data) {
    await call('updateChat', { userId, chatId, data });
  }

  async function getUserChats(userId, max = 30) {
    const { chats } = await call('getUserChats', { userId, max });
    return chats;
  }

  // getUserChatsMeta: trae solo titulo, shortId y updatedAt — sin historial ni lastMap.
  // Usar para el sidebar y la búsqueda por título. Cuando se necesite el chat completo
  // (al hacer click, al restaurar desde URL) usar getChat.
  //
  // Paginación: pasar startAfter = id del último chat visible para cargar la siguiente página.
  // Devuelve { chats, hasMore }.
  async function getUserChatsMeta(userId, max = 30, startAfter = null) {
    const params = { userId, max };
    if (startAfter) params.startAfter = startAfter;
    const res = await call('getUserChatsMeta', params);
    return { chats: res?.chats || [], hasMore: !!res?.hasMore };
  }

  async function deleteChat(userId, chatId) {
    await call('deleteChat', { userId, chatId });
  }

  async function getChat(userId, chatId) {
    const res = await call('getChat', { userId, chatId });
    return res.chat || null;
  }

  async function migrateChats(userId, anonUid) {
    return call('migrateChats', { userId, anonUid });
  }

  return { createChat, updateChat, getUserChats, getUserChatsMeta, getChat, getChatByShortId, deleteChat, migrateChats };

})();
