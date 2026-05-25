/**
 * chat-ui-messages.js — UI base: mensajes, thinking, error cards, map ready card
 *
 * Crea window.UI con las funciones base de mensajería.
 * Los módulos chat-ui-widgets.js y chat-style-flow.js extienden window.UI
 * con Object.assign() — no crean objetos separados.
 *
 * Depende de: window.I18N (t()), window.APP, window.MAP_CONTROLS
 * Debe cargarse ANTES de chat-ui-widgets.js y chat-style-flow.js
 */

window.UI = (() => {

  const $msgs = () => document.getElementById('chat-messages');
  let thinkingEl = null;

  function formatTime(date) {
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) +
           ' ' + date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }

  function scrollBottom() {
    const msgs  = document.getElementById('chat-messages');
    const panel = document.getElementById('chat-panel');
    if (msgs)  msgs.scrollTop  = msgs.scrollHeight;
    if (panel) panel.scrollTop = panel.scrollHeight;
    const scrollBtn = document.getElementById('btn-scroll-bottom');
    if (scrollBtn && msgs) {
      const dist = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
      scrollBtn.classList.toggle('visible', dist > 120);
    }
  }

  // ── Markdown ──────────────────────────────────────────────────
  function renderMarkdown(text) {
    if (typeof marked === 'undefined') {
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }
    marked.setOptions({ breaks: true, gfm: true, mangle: false, headerIds: false });
    return marked.parse(text);
  }

  // ── Mensajes ──────────────────────────────────────────────────

  function addMessage(role, text, meta) {
    if (role === 'user') {
      const wrap = document.createElement('div');
      wrap.className = 'msg-user-wrap';

      const el = document.createElement('div');
      el.className = 'msg user';
      if (text) setMessageText(el, text, true);
      wrap.appendChild(el);
      if (meta?.time) {
        const m = document.createElement('div');
        m.className = 'msg-meta msg-meta-user';
        m.textContent = formatTime(meta.time);
        wrap.appendChild(m);
      }
      $msgs().appendChild(wrap);
      scrollBottom();
      return wrap;
    }

    const el = document.createElement('div');
    el.className = `msg ${role}`;
    if (text) setMessageText(el, text);
    if (meta?.time) {
      const m = document.createElement('div');
      m.className = 'msg-meta';
      const modelNames = { cerebras: 'qwen-3-235b', groq: 'llama-3.3-70b-versatile', 'groq-oss': 'gpt-oss-120b', mistral: 'mistral-small-latest', gemini: 'gemini-2.5-flash', pim: 'pim' };
      const parts = [formatTime(meta.time)];
      if (meta.model) parts.push(modelNames[meta.model] || meta.model);
      m.textContent = parts.join(' · ');
      el.appendChild(m);
    }
    $msgs().appendChild(el);
    scrollBottom();
    return el;
  }

  function setMessageText(el, text, collapse) {
    const isUser = el.classList.contains('user') ||
                   el.closest?.('.msg-user-wrap') !== null;

    const escape = s => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const fullHTML = isUser ? escape(text) : renderMarkdown(text);

    if (!collapse) {
      el.innerHTML = fullHTML;
      scrollBottom();
      return;
    }

    const CHARS_PER_LINE = 28;
    const MAX_LINES      = 9;
    const lines = text.split('\n');
    let totalLines = 0;
    for (const line of lines) {
      totalLines += Math.max(1, Math.ceil((line.length || 1) / CHARS_PER_LINE));
      if (totalLines > MAX_LINES) break;
    }
    const needsCollapse = totalLines > MAX_LINES;

    el.innerHTML = fullHTML;

    if (!needsCollapse) {
      scrollBottom();
      return;
    }

    let previewLines = [];
    let count = 0;
    for (const line of lines) {
      const visual = Math.max(1, Math.ceil((line.length || 1) / CHARS_PER_LINE));
      if (count + visual > MAX_LINES) {
        const remaining = MAX_LINES - count;
        const chars = remaining * CHARS_PER_LINE;
        previewLines.push(line.slice(0, chars) + (line.length > chars ? '…' : ''));
        break;
      }
      previewLines.push(line);
      count += visual;
      if (count >= MAX_LINES) break;
    }
    const previewHTML = escape(previewLines.join('\n'));

    function renderCollapsed() {
      el.innerHTML = '';
      el.style.position = '';
      el.style.maxHeight = '';
      el.style.overflow  = '';

      const wrap = document.createElement('div');
      wrap.className = 'msg-collapse-wrap';

      const content = document.createElement('div');
      content.className = 'msg-collapse-content';
      content.innerHTML = previewHTML;

      const fade = document.createElement('div');
      fade.className = 'msg-collapse-fade';

      const btn = document.createElement('button');
      btn.className = 'msg-expand-btn msg-expand-collapsed';
      btn.textContent = t('chat_show_more');
      btn.addEventListener('click', renderExpanded);

      wrap.appendChild(content);
      wrap.appendChild(fade);
      wrap.appendChild(btn);
      el.appendChild(wrap);
    }

    function renderExpanded() {
      el.innerHTML = '';
      el.style.position = '';
      const content = document.createElement('span');
      content.innerHTML = fullHTML;
      const btn = document.createElement('button');
      btn.className = 'msg-expand-btn msg-expand-expanded';
      btn.textContent = t('chat_show_less');
      btn.addEventListener('click', renderCollapsed);
      el.appendChild(content);
      el.appendChild(btn);
    }

    renderCollapsed();
    scrollBottom();
  }

  function setSendEnabled(enabled) {
    document.querySelectorAll('.prompt-send').forEach(b => { b.disabled = !enabled; });
    document.getElementById('btn-stop-chat')?.classList.toggle('hidden', enabled);
    document.getElementById('btn-send-chat')?.classList.toggle('hidden', !enabled);
  }

  function setMessageMeta(el, meta) {
    const container = el;
    let m = container.querySelector('.msg-meta');
    if (!m) {
      m = document.createElement('div');
      m.className = container.classList.contains('msg-user-wrap')
        ? 'msg-meta msg-meta-user'
        : 'msg-meta';
      container.appendChild(m);
    }
    const modelNames = {
      cerebras:   'qwen-3-235b',
      groq:       'llama-3.3-70b-versatile',
      'groq-oss': 'gpt-oss-120b',
      mistral:    'mistral-small-latest',
      gemini:     'gemini-2.5-flash',
      pim:        'pim',
    };
    const parts = [formatTime(meta.time)];
    if (meta.model) parts.push(modelNames[meta.model] || meta.model);
    m.textContent = parts.join(' · ');
  }

  function showThinking() {
    hideThinking();
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'msg thinking';
    thinkingEl.textContent = t('map_drawing');
    $msgs()?.appendChild(thinkingEl);
    scrollBottom();
  }

  function hideThinking() {
    thinkingEl?.remove();
    thinkingEl = null;
  }

  function showErrorCard(titulo, layerKey, externalMsg) {
    const el = document.createElement('div');
    el.className = 'msg-error-card';
    const desc = externalMsg
      ? `<span class="error-card-desc error-card-external">${externalMsg}</span>`
      : `<span class="error-card-desc">${t('error_no_response')}</span>`;
    el.innerHTML = `
      <div class="error-card-left">
        <span class="material-icons error-card-icon">${externalMsg ? 'cloud_off' : 'error_outline'}</span>
        <div class="error-card-info">
          <span class="error-card-title">${titulo}</span>
          ${desc}
        </div>
      </div>
      <button class="error-card-btn" data-layer="${layerKey || ''}">
        ${t('error_retry')}
      </button>
    `;
    el.querySelector('.error-card-btn').addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = t('error_layer_retry', { titulo });
        input.focus();
        input.dispatchEvent(new Event('input'));
      }
    });
    $msgs()?.appendChild(el);
    scrollBottom();
  }

  // Resuelve el nombre visible de una instrucción para mostrarlo en el card del mapa.
  function _tituloInstruccion(inst) {
    if (!inst) return '';
    if (inst.tituloUI) return inst.tituloUI;
    const _lang = window.I18N?.getLang?.() || 'es';
    const _suf  = _lang === 'en' ? 'En' : _lang === 'pt' ? 'Pt' : 'Es';
    const capa  = window.LAYERS?.[inst.layerKey];
    if (capa) return capa[`tituloUI${_suf}`] || capa.tituloUI || capa.titulo || inst.descripcion || inst.layerKey;
    return inst.descripcion || inst.layerKey || '';
  }

  function showMapReady(plan) {
    // Inhabilitar todos los map cards anteriores que aún estén activos
    $msgs()?.querySelectorAll('.msg-map-card:not(.map-card-stale)').forEach(prev => {
      prev.classList.add('map-card-stale');
      const btn = prev.querySelector('.map-card-btn');
      if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      }
    });

    const capas = (plan.instrucciones || [])
      .map(i => {
        const titulo = _tituloInstruccion(i);
        if (!titulo) return null;
        const capa = window.LAYERS?.[i.layerKey];
        const geom = capa?.geomType || null;
        return geom
          ? `${titulo}<span class="map-card-source">${geom}</span>`
          : titulo;
      })
      .filter(Boolean)
      .join('\n');

    const el = document.createElement('div');
    el.className = 'msg-map-card';
    el.innerHTML = `
      <div class="map-card-left">
        <span class="material-icons map-card-icon">map</span>
        <div class="map-card-info">
          <span class="map-card-title">${plan.titulo || t('map_card_default_title')}</span>
          <span class="map-card-layers">${capas}</span>
        </div>
      </div>
      <button class="map-card-btn" data-plan='${JSON.stringify(plan).replace(/'/g, "&#39;")}'>
        ${t('map_card_btn_ver')}
      </button>
    `;
    el.querySelector('.map-card-btn').addEventListener('click', e => {
      const p = JSON.parse(e.currentTarget.dataset.plan.replace(/&#39;/g, "'"));
      window.APP.renderMap(p).then(() => {
        if (window.MAP_CONTROLS?.isMobile?.()) {
          window.MAP_CONTROLS.setMapVisible(true);
        }
      });
    });
    $msgs()?.appendChild(el);
    scrollBottom();
  }

  // Muestra un botón liviano "Ver mapa" en el chat — solo en mobile.
  function showViewMapBtn() {
    if ($msgs()?.querySelector('.msg-map-card.style-update')) return;
    const plan = window.APP?.getCurrentPlan?.() || {};
    const capas = (plan.instrucciones || [])
      .map(i => _tituloInstruccion(i))
      .filter(Boolean)
      .join('\n');

    const el = document.createElement('div');
    el.className = 'msg-map-card style-update';
    el.innerHTML = `
      <div class="map-card-left">
        <span class="material-icons map-card-icon">map</span>
        <div class="map-card-info">
          <span class="map-card-title">${plan.titulo || t('map_card_default_title')}</span>
          <span class="map-card-layers">${capas}</span>
        </div>
      </div>
      <button class="map-card-btn">${t('map_card_btn_ver')}</button>
    `;
    el.querySelector('.map-card-btn').addEventListener('click', () => {
      window.MAP_CONTROLS?.setMapVisible(true);
      el.remove();
    });
    $msgs()?.appendChild(el);
    scrollBottom();
  }

  return {
    addMessage,
    setMessageText,
    setMessageMeta,
    setSendEnabled,
    scrollBottom,
    showThinking,
    hideThinking,
    showErrorCard,
    showMapReady,
    showViewMapBtn,
    renderMarkdown,
  };

})();
