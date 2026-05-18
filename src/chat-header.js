/**
 * chat-header.js — Barra de título del chat, renombrar y eliminar
 *
 * Depende de: window.AUTH, window.FB, window.CHAT, window.SIDEBAR,
 *             window.TOAST, window.APP (newMap)
 */

window.CHAT_HEADER = (() => {

  function setChatHeader(titulo) {
    const bar   = document.getElementById('chat-header-bar');
    const title = document.getElementById('chat-header-title');
    if (!bar || !title) return;
    title.value = titulo || '';
    title.dataset.original = titulo || '';
    bar.style.display = titulo ? 'flex' : 'none';
    document.title = titulo ? `${titulo} — Casux` : 'Casux';
  }

  function startRename(newName) {
    const user   = window.AUTH?.currentUser();
    const chatId = window.CHAT?.getChatId();
    if (!user || !chatId) return;
    const nombre = window.CHAT?.toTitleCase?.(newName) || newName;
    document.title = nombre ? `${nombre} — Casux` : 'Casux';
    window.FB.updateChat(user.uid, chatId, { titulo: nombre })
      .then(() => {
        const title = document.getElementById('chat-header-title');
        if (title) { title.value = nombre; title.dataset.original = nombre; }
        window.SIDEBAR.refreshChats();
      })
      .catch(() => {
        const title = document.getElementById('chat-header-title');
        if (title) title.value = title.dataset.original || '';
        window.TOAST.error(t('toast_chat_rename_error'));
      });
  }

  function deleteCurrentChat() {
    const user   = window.AUTH?.currentUser();
    const chatId = window.CHAT?.getChatId();
    if (!user || !chatId) return;
    const titulo = document.getElementById('chat-header-title')?.value || 'este chat';
    showDeleteConfirm(titulo, async () => {
      try {
        await window.FB.deleteChat(user.uid, chatId);
        window.SIDEBAR.refreshChats();
        window.APP.newMap();
        window.TOAST.success(t('toast_chat_deleted'));
      } catch { window.TOAST.error(t('toast_chat_delete_error')); }
    });
  }

  function showDeleteConfirm(titulo, onConfirm) {
    document.getElementById('delete-confirm-modal')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'delete-confirm-modal';
    backdrop.className = 'search-modal-backdrop open';
    backdrop.style.zIndex = '400';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-box';
    modal.innerHTML = `
      <p class="delete-confirm-title">${t('chat_delete_confirm_title')}</p>
      <div class="delete-confirm-divider"></div>
      <p class="delete-confirm-body">${t('chat_delete_confirm_body')}</p>
      <div class="delete-confirm-btns">
        <button class="delete-confirm-cancel">${t('chat_delete_confirm_cancel')}</button>
        <button class="delete-confirm-ok">${t('chat_delete_confirm_ok')}</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    modal.querySelector('.delete-confirm-cancel').addEventListener('click', () => { backdrop.remove(); document.removeEventListener('keydown', _onKey); });
    backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.remove(); document.removeEventListener('keydown', _onKey); } });
    modal.querySelector('.delete-confirm-ok').addEventListener('click', () => {
      backdrop.remove();
      document.removeEventListener('keydown', _onKey);
      onConfirm();
    });
    function _onKey(e) { if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', _onKey); } }
    document.addEventListener('keydown', _onKey);
  }

  function wireEvents() {
    // Doble click en el título para editar
    document.getElementById('chat-header-title')
      ?.addEventListener('dblclick', () => startRename());

    const titleInput = document.getElementById('chat-header-title');
    if (titleInput) {
      titleInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); titleInput.blur(); }
        if (e.key === 'Escape') { titleInput.value = titleInput.dataset.original || ''; titleInput.blur(); }
      });
      titleInput.addEventListener('focus', () => {
        titleInput.dataset.original = titleInput.value;
      });
      titleInput.addEventListener('blur', () => {
        const newName  = titleInput.value.trim();
        const original = titleInput.dataset.original || '';
        if (!newName) { titleInput.value = original; return; }
        if (newName === original) return;
        startRename(newName);
      });
    }

    // Botón eliminar en el header
    document.getElementById('chat-header-delete-btn')
      ?.addEventListener('click', () => deleteCurrentChat());
  }

  return { setChatHeader, startRename, deleteCurrentChat, showDeleteConfirm, wireEvents };

})();
