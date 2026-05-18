/**
 * search.js — Modal de búsqueda en chats
 */

window.SEARCH = (() => {

  let allChats = [];  // metadatos del sidebar — solo titulo, shortId, updatedAt
  let isOpen   = false;

  // ── Abrir modal ───────────────────────────────────────────────

  function open() {
    const user = window.AUTH?.currentUser();
    if (!user) {
      TOAST.info(t('search_login_required'));
      return;
    }

    isOpen = true;
    document.getElementById('search-backdrop')?.classList.add('open');
    document.getElementById('search-modal')?.classList.add('open');

    const input = document.getElementById('search-input');
    if (input) { input.value = ''; input.focus(); }

    showResults('');

    // Usar los metadatos ya cargados en el sidebar — sin fetch adicional.
    // La búsqueda opera sobre título. Para buscar en mensajes el usuario
    // puede abrir el chat directamente.
    allChats = window.SIDEBAR?.getChats?.() || [];
    showResults(input?.value || '');
  }

  // ── Cerrar modal ──────────────────────────────────────────────

  function close() {
    isOpen = false;
    document.getElementById('search-backdrop')?.classList.remove('open');
    document.getElementById('search-modal')?.classList.remove('open');
  }

  // ── Mostrar resultados ────────────────────────────────────────

  function showResults(query) {
    const container = document.getElementById('search-results');
    if (!container) return;

    const q = query.trim().toLowerCase();

    const filtered = q
      ? allChats.filter(chat =>
          (chat.titulo || '').toLowerCase().includes(q)
        )
      : allChats;

    if (!allChats.length) {
      container.innerHTML = '<p class="search-empty">No hay chats todavía</p>';
      return;
    }

    if (!filtered.length) {
      container.innerHTML = `<p class="search-empty">No se encontraron resultados para "<strong>${esc(q)}</strong>"</p>`;
      return;
    }

    container.innerHTML = filtered.map(chat => {
      const titulo = highlight(chat.titulo || 'Sin título', q);
      return `
        <button class="search-result-item" data-id="${chat.id}">
          <span class="search-result-title">${titulo}</span>
        </button>
      `;
    }).join('');

    // Eventos de click
    container.querySelectorAll('.search-result-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const chatId = btn.dataset.id;
        close();
        SIDEBAR.loadChatById(chatId);
      });
    });
  }

  // ── Snippet del mensaje donde se encontró la búsqueda ─────────

  function getSnippet(chat, q) {
    if (!q) return '';
    const msg = (chat.messages || []).find(m =>
      (m.content || '').toLowerCase().includes(q)
    );
    if (!msg) return '';
    const text    = msg.content.replace(/```map[\s\S]*?```/g, '').trim();
    const idx     = text.toLowerCase().indexOf(q);
    const start   = Math.max(0, idx - 40);
    const end     = Math.min(text.length, idx + q.length + 60);
    const snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    return highlight(snippet, q);
  }

  // ── Highlight ─────────────────────────────────────────────────

  function highlight(text, q) {
    if (!q) return esc(text);
    const escaped = esc(text);
    const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(escapedQ, 'gi'), m => `<mark>${m}</mark>`);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Eventos globales ──────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('search-close')
      ?.addEventListener('click', close);

    document.getElementById('search-backdrop')
      ?.addEventListener('click', close);

    document.getElementById('search-input')
      ?.addEventListener('input', e => showResults(e.target.value));

    // Cerrar con Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) close();
    });

    // Abrir con Cmd/Ctrl+K
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen ? close() : open();
      }
    });
  });

  return { open, close };

})();
