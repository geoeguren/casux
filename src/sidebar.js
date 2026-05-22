/**
 * sidebar.js — Menú lateral
 */

window.SIDEBAR = (() => {

  const PAGE_SIZE    = 30;  // chats por página (alineado con db.js getUserChatsMeta)
  const PAGE_LOAD    = 30;  // cuantos se cargan al presionar 'Cargar más'

  const EXPANDED_KEY = 'sm_sidebar_expanded';
  let expanded       = localStorage.getItem(EXPANDED_KEY) === 'true';
  let currentUser    = null;
  let currentChatId  = null;
  let chats          = [];       // chats cargados del servidor (página actual acumulada)
  let _hasMore       = false;    // si el servidor tiene más chats disponibles
  let _lastChatId    = null;     // id del último chat cargado (cursor de paginación)
  let _pendingChatId = null;

  function render() {
    const html = buildHTML();
    ['sidebar', 'sidebar-home'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = html;
        el.classList.toggle('expanded', expanded);
      }
    });
    document.getElementById('screen-home')?.classList.toggle('sidebar-expanded', expanded);
    if (!document._sbWiredV2) wireEvents();
  }

  function buildHTML() {
    return `
      <div class="sidebar-top">
        <div class="sb-header-row">
          <a href="/chat" class="sb-logo">Casux</a>
          <button class="sb-ib sb-action" data-action="toggle" >
            <span class="material-icons">menu</span>
          </button>
        </div>
        <button class="sb-rb sb-action" data-action="new">
          <span class="material-icons">add</span>
          <span class="sb-rb-label">${t('sidebar_new_map')}</span>
        </button>
        <button class="sb-rb sb-action" data-action="search">
          <span class="material-icons">search</span>
          <span class="sb-rb-label">${t('sidebar_search')}</span>
        </button>
      </div>

      <div class="sidebar-mid">
        ${currentUser && chats.length ? '<div class="sb-forum-icon"><span class="material-icons">forum</span></div>' : ''}
        ${currentUser ? '<span class="sb-section-title">' + t('sidebar_recent') + '</span>' : ''}
        ${buildChatsList()}
      </div>

      <div class="sidebar-bottom">
        ${currentUser && !window.AUTH?.isAnon?.() ? buildUserArea() : (currentUser ? buildAnonArea() : buildAnonArea())}
      </div>
    `;
  }

  function buildChatsList() {
    if (!currentUser) return '<button class="sb-chat-item" style="pointer-events:none;opacity:0">—</button>';
    if (!chats.length) return `<span class="sb-section-title" style="text-transform:none;font-size:13px">${t('sidebar_no_chats')}</span>`;

    // Todos los chats cargados hasta ahora son visibles.
    // La paginación ocurre en el servidor — loadMore() trae la siguiente página.
    const items = chats.map(chat => `
      <div class="sb-chat-row ${chat.id === currentChatId ? 'active' : ''}" data-chatid="${chat.id}">
        <button class="sb-chat-item sb-action"
                data-action="loadchat" data-id="${chat.id}">
          ${esc(chat.titulo || t('sidebar_untitled'))}
        </button>
        <input class="sb-chat-rename-input" type="text"
               value="${esc(chat.titulo || t('sidebar_untitled'))}"
               data-id="${chat.id}" data-original="${esc(chat.titulo || t('sidebar_untitled'))}"
               autocomplete="off" />
        <button class="sb-chat-delete sb-action" data-action="deletechat"
                data-id="${chat.id}" data-titulo="${esc(chat.titulo || t('sidebar_untitled'))}" data-tooltip="${t('chat_delete')}">
          <span class="material-icons">delete</span>
        </button>
      </div>
    `).join('');

    const loadMoreBtn = _hasMore
      ? `<button class="sb-load-more sb-action" data-action="loadmore">
           ${t('sidebar_load_more', {n: ''})}
         </button>`
      : '';

    return items + loadMoreBtn;
  }

  function buildUserArea() {
    const name  = currentUser.name || currentUser.email || '';
    const photo = currentUser.photo;
    const avatar = photo
      ? '<img src="' + photo + '" class="sb-avatar" />'
      : '<span class="material-icons sb-avatar-icon">account_circle</span>';
    return `
      <button class="sb-user-row sb-action" data-action="userconfig" id="sb-user-row-btn">
        ${avatar}
        <span class="sb-username">${esc(name)}</span>
      </button>
    `;
  }

  function buildAnonArea() {
    return `
      <button class="sb-user-row sb-action" data-action="login">
        <svg width="22" height="22" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
          <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg>
        <span class="sb-username">${t('sidebar_anon_sync')}</span>
      </button>
    `;
  }

  // ── Eventos ───────────────────────────────────────────────────

  function wireEvents() {
    if (document._sbWiredV2) return;
    document._sbWiredV2 = true;
    document.addEventListener('click', e => {
      const btn = e.target.closest('.sb-action');
      if (!btn) return;
      const action = btn.dataset.action;
      if (!action) return;
      switch (action) {
        case 'toggle':     toggleExpanded(); break;
        case 'new':
          if (window.innerWidth <= 1024 && expanded) {
            expanded = false;
            document.querySelectorAll('.sidebar').forEach(el => el.classList.remove('expanded'));
            document.getElementById('screen-home') && document.getElementById('screen-home').classList.remove('sidebar-expanded');
          }
          window.APP && window.APP.newMap();
          break;
        case 'search':     SEARCH.open(); break;
        case 'login':      handleLogin(); break;
        case 'userconfig': e.stopPropagation(); SETTINGS.openFromBtn(btn); break;
        case 'loadchat':   loadChat(btn.dataset.id); break;
        case 'renamechat': renameChatInline(btn.dataset.id, btn.dataset.titulo); break;
        case 'deletechat': confirmDeleteModal(btn.dataset.id, btn.dataset.titulo); break;
        case 'loadmore':   loadMore(); break;
      }
    });

    // Click en el logo → en móvil colapsar sidebar antes de navegar
    document.addEventListener('click', e => {
      const logo = e.target.closest('.sb-logo');
      if (!logo) return;
      if (window.innerWidth <= 1024 && expanded) {
        expanded = false;
        localStorage.setItem(EXPANDED_KEY, 'false');
        document.querySelectorAll('.sidebar').forEach(el => el.classList.remove('expanded'));
        document.getElementById('screen-home')?.classList.remove('sidebar-expanded');
      }
    });

    // Doble click en el label del chat → activar input inline
    document.addEventListener('dblclick', e => {
      const item = e.target.closest('.sb-chat-item');
      if (!item) return;
      const row = item.closest('.sb-chat-row');
      if (!row) return;
      activateSidebarRename(row);
    });
  }

  function activateSidebarRename(row) {
    const item  = row.querySelector('.sb-chat-item');
    const input = row.querySelector('.sb-chat-rename-input');
    if (!input || !item) return;
    item.style.display  = 'none';
    input.style.display = 'block';
    input.focus();
    input.select();

    function commitRename() {
      const newTitulo = window.CHAT?.toTitleCase?.(input.value.trim()) || input.value.trim();
      const original  = input.dataset.original || '';
      item.style.display  = '';
      input.style.display = 'none';
      if (!newTitulo || newTitulo === original) { input.value = original; return; }
      input.value = newTitulo;
      renameChatInline(input.dataset.id, original, newTitulo);
    }

    input.onblur = commitRename;
    input.onkeydown = e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = input.dataset.original || ''; input.blur(); }
    };
  }

  function toggleExpanded() {
    expanded = !expanded;
    localStorage.setItem(EXPANDED_KEY, expanded);
    document.querySelectorAll('.sidebar').forEach(el => el.classList.toggle('expanded', expanded));
    document.getElementById('screen-home') && document.getElementById('screen-home').classList.toggle('sidebar-expanded', expanded);
  }

  // En mobile el sidebar solo se abre y cierra con el botón toggle
  // No hay click outside — evita conflictos con eventos touch

  // ── Auth ──────────────────────────────────────────────────────

  function handleLogin() {
    window.AUTH.loginWithGoogle()
      .then(function() {
        // La migración ya ocurrió en el servidor (callback.js vía state=anonUid).
        // Recargar para reflejar la sesión real — app.js hace reload() al completar.
      })
      .catch(function(err) {
        if (err.message === 'popup_closed') return;
        TOAST.error(t('toast_auth_login_error'));
        console.error('[SIDEBAR] Login error:', err.message);
      });
  }

  // ── Chats ─────────────────────────────────────────────────────

  async function loadUserChats(user) {
    try {
      // Cargamos solo metadatos (titulo, shortId, updatedAt) — sin historial ni lastMap.
      // El sidebar solo necesita esos campos para renderizar la lista.
      // Cuando el usuario hace click en un chat, loadChat() trae el documento completo.
      const result = await window.FB.getUserChatsMeta(user.uid, PAGE_SIZE);
      const newChats = result?.chats || [];
      const hasMore  = result?.hasMore || false;
      chats        = newChats;
      _hasMore     = hasMore;
      _lastChatId  = newChats.length ? newChats[newChats.length - 1].id : null;
      render();
      if (_pendingChatId) {
        const pending = _pendingChatId;
        _pendingChatId = null;
        loadChat(pending);
      }
    } catch (err) {
      console.error('[SIDEBAR] Error cargando chats:', err);
      TOAST.error(t('toast_chats_load_error'));
    }
  }

  async function loadMore() {
    if (!currentUser || !_hasMore) return;
    try {
      const moreResult = await window.FB.getUserChatsMeta(
        currentUser.uid, PAGE_LOAD, _lastChatId
      );
      const { chats: moreChats, hasMore } = moreResult || { chats: [], hasMore: false };
      chats       = chats.concat(moreChats);
      _hasMore    = hasMore;
      _lastChatId = moreChats.length ? moreChats[moreChats.length - 1].id : _lastChatId;

      // Actualizar solo el contenido de .sidebar-mid sin destruir el nodo.
      // Si llamáramos a render() completo, se recrearía el elemento y el browser
      // resetearía scrollTop a 0 — perdiendo la posición del usuario.
      const newMidContent = `
        ${currentUser && chats.length ? '<div class="sb-forum-icon"><span class="material-icons">forum</span></div>' : ''}
        ${currentUser ? '<span class="sb-section-title">' + t('sidebar_recent') + '</span>' : ''}
        ${buildChatsList()}
      `;
      document.querySelectorAll('.sidebar-mid').forEach(el => {
        el.innerHTML = newMidContent;
      });
    } catch (err) {
      console.error('[SIDEBAR] Error cargando más chats:', err);
    }
  }

  async function loadChat(chatId) {
    // En mobile: colapsar el sidebar al abrir un chat
    if (window.innerWidth <= 1024 && expanded) {
      expanded = false;
      document.querySelectorAll('.sidebar').forEach(el => el.classList.remove('expanded'));
      document.getElementById('screen-home') && document.getElementById('screen-home').classList.remove('sidebar-expanded');
    }
    try {
      const user = window.AUTH?.currentUser();
      if (!user) return;
      const chat = await window.FB.getChat(user.uid, chatId);
      if (!chat) return;
      // Actualizar cache
      const idx = chats.findIndex(c => c.id === chatId);
      if (idx >= 0) chats[idx] = chat;
      currentChatId = chatId;
      // Actualizar URL con shortId si está disponible
      if (chat.shortId) {
        window.history.pushState(null, '', `/chat/${chat.shortId}`);
      }
      render();
      window.APP && window.APP.restoreChat(chat);
    } catch (e) {
      console.error('[SIDEBAR] Error cargando chat:', e);
      TOAST.error(t('toast_chat_load_error'));
    }
  }

  async function renameChatInline(chatId, currentTitulo, newTitulo) {
    if (newTitulo === undefined) {
      // Fallback: prompt (legacy, no se usa más)
      newTitulo = prompt('Renombrar chat:', currentTitulo);
    }
    if (!newTitulo || newTitulo.trim() === currentTitulo) return;
    try {
      const user = window.AUTH?.currentUser();
      if (!user) return;
      const tituloNorm = window.CHAT?.toTitleCase?.(newTitulo.trim()) || newTitulo.trim();
      await window.FB.updateChat(user.uid, chatId, { titulo: tituloNorm });
      const chat = chats.find(c => c.id === chatId);
      if (chat) chat.titulo = tituloNorm;
      render();
      if (chatId === currentChatId) window.APP && window.APP.setChatHeader(newTitulo.trim());
    } catch (e) {
      TOAST.error(t('toast_chat_rename_error'));
    }
  }

  async function confirmDeleteModal(chatId, titulo) {
    if (window.CHAT_HEADER && window.CHAT_HEADER.showDeleteConfirm) {
      window.CHAT_HEADER.showDeleteConfirm(titulo, () => deleteChat(chatId));
    } else {
      if (confirm('¿Eliminar "' + titulo + '"?')) await deleteChat(chatId);
    }
  }

  async function deleteChat(chatId) {
    try {
      const user = window.AUTH?.currentUser();
      if (!user) return;
      await window.FB.deleteChat(user.uid, chatId);
      chats = chats.filter(c => c.id !== chatId);
      if (chatId === currentChatId) {
        currentChatId = null;
        window.APP && window.APP.newMap();
      }
      render();
      TOAST.success(t('toast_chat_deleted'));
    } catch (e) {
      TOAST.error(t('toast_chat_delete_error'));
    }
  }

  function refreshChats() { if (currentUser) loadUserChats(currentUser); }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setUser(user) {
    currentUser = user;
    if (user) loadUserChats(user);
    else { chats = []; render(); }
  }

  function setChatId(id) {
    currentChatId = id;
    render();
  }

  function loadChatById(id) {
    if (chats.length) loadChat(id);
    else _pendingChatId = id;
  }

  function updateCachedChat(chatId, data) {
    const chat = chats.find(c => c.id === chatId);
    if (chat) Object.assign(chat, data);
  }

  function getChats() { return chats; }

  function collapseIfMobile() {
    if (window.innerWidth > 1024) return;
    if (!expanded) return;
    expanded = false;
    localStorage.setItem(EXPANDED_KEY, 'false');
    document.querySelectorAll('.sidebar').forEach(el => el.classList.remove('expanded'));
    document.getElementById('screen-home')?.classList.remove('sidebar-expanded');
  }

  return { render, setUser, setChatId, refreshChats, loadChatById, updateCachedChat, getChats, collapseIfMobile };

})();
