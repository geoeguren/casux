/**
 * app.js — Orquestación principal
 *
 * Depende de: window.MAP, window.CHAT, window.UI, window.SIDEBAR,
 *             window.AUTH, window.FB, window.SPATIAL, window.TOAST,
 *             window.THEME, window.SETTINGS, window.SEARCH,
 *             window.LAYERS_PANEL, window.MAP_CONTROLS, window.CHAT_HEADER
 */

// ── Toast ─────────────────────────────────────────────────────────

window.TOAST = (() => {
  let timer        = null;

  // Duraciones por tipo (ms). 0 = sin auto-cierre.
  const DURATIONS = {
    success: 3000,
    info:    4000,
    warning: 5000,
    error:   0,
    loading: 0
  };

  // Tipos que muestran botón X
  const HAS_CLOSE = new Set(['warning', 'error']);

  // Clases semánticas válidas
  const TYPES = new Set(['success', 'info', 'warning', 'error', 'loading']);

  function _getTopOffset() {
    // Si el mapa está visible, anclar al topbar del mapa.
    // Si no, anclar al topbar del chat.
    const mapPanel = document.getElementById('map-panel');
    const mapVisible = mapPanel && mapPanel.style.display !== 'none';
    if (mapVisible) {
      const topbar = document.getElementById('map-topbar');
      if (topbar) return topbar.getBoundingClientRect().bottom + 12;
    }
    const chatHeader = document.getElementById('chat-header-bar');
    if (chatHeader && chatHeader.style.display !== 'none') {
      return chatHeader.getBoundingClientRect().bottom + 12;
    }
    return 64; // fallback
  }

  function hide() {
    const el = document.getElementById('toast');
    if (!el) return;
    clearTimeout(timer);
    timer = null;
    el.classList.remove('show');
  }

  /**
   * show(msg, type, duration)
   *   msg      — texto del toast
   *   type     — 'success' | 'info' | 'warning' | 'error' | 'loading'
   *   duration — ms de override (0 = sin auto-cierre). Si omitido, usa el default del tipo.
   */
  function show(msg, type = 'info', duration) {
    const el = document.getElementById('toast');
    if (!el) return;

    // Normalizar tipo
    if (!TYPES.has(type)) type = 'info';

    // Limpiar clases anteriores
    TYPES.forEach(t => el.classList.remove('toast--' + t));
    el.classList.add('toast--' + type);

    // Posición dinámica
    el.style.top = _getTopOffset() + 'px';

    // Contenido
    const ICONS = {
      success: 'check_circle',
      info:    'info',
      warning: 'warning',
      error:   'error',
      loading: 'hourglass_top'
    };
    const closeBtn = HAS_CLOSE.has(type)
      ? `<button class="toast-close" aria-label="Cerrar">✕</button>`
      : '';
    el.innerHTML = `<span class="material-icons toast-icon">${ICONS[type]}</span><span class="toast-msg">${msg}</span>${closeBtn}`;

    // Botón de cierre
    el.querySelector('.toast-close')?.addEventListener('click', hide);

    // La animación del ícono loading se hace con CSS (toast-spin en modals.css)

    // Mostrar
    clearTimeout(timer);
    el.classList.add('show');

    const ms = duration !== undefined ? duration : DURATIONS[type];
    if (ms > 0) {
      timer = setTimeout(hide, ms);
    }
  }

  // Shorthand helpers
  function success(msg, duration) { show(msg, 'success', duration); }
  function info(msg, duration)    { show(msg, 'info',    duration); }
  function warning(msg, duration) { show(msg, 'warning', duration); }
  function error(msg, duration)   { show(msg, 'error',   duration); }
  function loading(msg)           { show(msg, 'loading'); }

  return { show, hide, success, info, warning, error, loading };
})();

// ── Tema ──────────────────────────────────────────────────────────

window.THEME = (() => {
  const KEY = 'sm_theme';
  function isDayHour() { const h = new Date().getHours(); return h >= 7 && h < 20; }
  function apply(mode) {
    document.body.classList.toggle('day', mode === 'day');
    document.documentElement.classList.toggle('day', mode === 'day');
    const icon = mode === 'day' ? 'mode_night' : 'light_mode';
    document.querySelectorAll('[id^="theme-icon"]').forEach(el => el.textContent = icon);
    localStorage.setItem(KEY, mode);
  }
  function toggle() { apply(document.body.classList.contains('day') ? 'night' : 'day'); }
  function init() {
    const saved = localStorage.getItem(KEY);
    apply(saved || (isDayHour() ? 'day' : 'night'));
  }
  function applyWithBasemap(mode) {
    apply(mode);
    const curBase = window.MAP?.getCurrentBase?.();
    if (curBase === 'gray' || curBase === 'dark') {
      window.MAP?.setBasemap?.(mode === 'day' ? 'gray' : 'dark');
    }
  }
  return { init, toggle, apply, applyWithBasemap };
})();

// ── APP ───────────────────────────────────────────────────────────

window.APP = (() => {

  // Delega en la implementación multiidioma de CHAT (es la fuente de verdad).
  // CHAT se carga antes que APP en index.html.
  function toTitleCase(texto) {
    return window.CHAT?.toTitleCase?.(texto) ?? (texto ? texto.trim().charAt(0).toUpperCase() + texto.trim().slice(1) : texto);
  }



  // ── Helpers de color ─────────────────────────────────────────
  function _hexToRgb(hex) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return null;
    return {
      r: parseInt(h.slice(0,2), 16),
      g: parseInt(h.slice(2,4), 16),
      b: parseInt(h.slice(4,6), 16),
    };
  }
  // amount: fracción 0–1 (ej: 0.30 → oscurece 30%). Consistente con export-utils._darkenHex.
  function _darkenHex(hex, amount) {
    const rgb = _hexToRgb(hex);
    if (!rgb) return hex;
    const f = 1 - amount;
    const r = Math.round(rgb.r * f).toString(16).padStart(2,'0');
    const g = Math.round(rgb.g * f).toString(16).padStart(2,'0');
    const b = Math.round(rgb.b * f).toString(16).padStart(2,'0');
    return `#${r}${g}${b}`;
  }

  let currentPlan = null;

  function init() {
    wireHomeEvents();
    wireWorkEvents();
    wireTextareas();

    // Mostrar prompts sugeridos en la home — esperar a que LAYERS esté disponible
    const _tryShowHome = () => window.SUGGESTED_PROMPTS?.showInHome?.();
    if (window.LAYERS && Object.keys(window.LAYERS).length) {
      setTimeout(_tryShowHome, 100);
    } else {
      let _att = 0;
      const _poll = setInterval(() => {
        if (window.LAYERS && Object.keys(window.LAYERS).length) {
          clearInterval(_poll); _tryShowHome();
        } else if (++_att > 30) clearInterval(_poll);
      }, 100);
    }
  }

  // ── Home ──────────────────────────────────────────────────────

  function wireHomeEvents() {
    document.getElementById('btn-send-initial')
      ?.addEventListener('click', sendInitialPrompt);

  }

  function sendInitialPrompt() {
    const ta  = document.getElementById('initial-prompt');
    const txt = ta.value.trim();
    if (!txt) return;
    goToWork(txt);
  }

  // ── Persistencia de plan ──────────────────────────────────────
  // Definida en el scope del módulo (no dentro de wireWorkEvents)
  // para que renderMap, applyStylePlan y applyClassifyPlan puedan usarla.

  let _persistTimer = null;
  function _persistPlan(toastMsg) {
    const user   = window.AUTH?.currentUser();
    const chatId = window.CHAT?.getChatId?.();
    if (!user || !chatId || !currentPlan) return;

    // Actualizar caché local inmediatamente (sin esperar al debounce)
    window.SIDEBAR.updateCachedChat(chatId, { lastMap: currentPlan });

    if (toastMsg) {
      // Acción explícita — persistir de inmediato y mostrar confirmación
      clearTimeout(_persistTimer);
      _persistTimer = null;
      window.FB.updateChat(user.uid, chatId, { lastMap: currentPlan })
        .then(() => window.TOAST.success(toastMsg))
        .catch(e => {
          console.warn('[APP] Error al persistir:', e);
          window.TOAST.warning(t('toast_save_error'));
        });
      return;
    }

    // Cambio automático — debounce 1.5s
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      window.FB.updateChat(user.uid, chatId, { lastMap: currentPlan })
        .catch(e => console.warn('[APP] Error al persistir:', e));
    }, 1500);
  }

  // ── Work screen ───────────────────────────────────────────────

  function goToWork(initialPrompt) {
    window.ANALYTICS?.sessionStart?.();
    window.SIDEBAR?.collapseIfMobile?.();
    document.getElementById('screen-home').classList.remove('active');
    document.getElementById('screen-work').classList.add('active');
    window.MAP_CONTROLS.setMapVisible(false);
    if (initialPrompt) {
      window.CHAT.reset();
      document.getElementById('chat-messages').innerHTML = '';
      window.CHAT.send(initialPrompt);
    } else {
      // Mostrar prompts sugeridos — esperar a que window.LAYERS esté disponible
      // (se carga como módulo ES, puede llegar después del script principal)
      const _showChips = () => window.SUGGESTED_PROMPTS?.show(p => window.CHAT.send(p));
      if (window.LAYERS && Object.keys(window.LAYERS).length) {
        setTimeout(_showChips, 100);
      } else {
        // Polling hasta que LAYERS esté listo (máx 3s)
        let _attempts = 0;
        const _poll = setInterval(() => {
          _attempts++;
          if (window.LAYERS && Object.keys(window.LAYERS).length) {
            clearInterval(_poll);
            _showChips();
          } else if (_attempts > 30) {
            clearInterval(_poll);
          }
        }, 100);
      }
    }
    if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      setTimeout(() => document.getElementById('chat-input')?.focus(), 200);
    }
  }

  // ── Work events ───────────────────────────────────────────────

  function wireWorkEvents() {
    document.getElementById('btn-send-chat')
      ?.addEventListener('click', sendChatMessage);

    document.getElementById('btn-stop-chat')
      ?.addEventListener('click', () => window.CHAT?.abort?.());

    document.getElementById('btn-close-map')
      ?.addEventListener('click', () => window.MAP_CONTROLS.setMapVisible(false));

    document.getElementById('btn-refresh-map')
      ?.addEventListener('click', () => {
        if (currentPlan) renderMap(currentPlan);
      });

    document.getElementById('btn-map-layers')
      ?.addEventListener('click', e => {
        e.stopPropagation();
        window.LAYERS_PANEL.toggle();
      });

    document.getElementById('btn-identify')
      ?.addEventListener('click', () => {
        const btn    = document.getElementById('btn-identify');
        const active = !window.MAP.getIdentifyMode();
        window.MAP.setIdentifyMode(active);
        btn.classList.toggle('active', active);
        btn.setAttribute('data-tooltip', active ? t('identify_off') : t('identify_on'));
      });

    document.getElementById('btn-zoom-in')
      ?.addEventListener('click', () => window.MAP.getInstance()?.zoomIn());
    document.getElementById('btn-zoom-out')
      ?.addEventListener('click', () => window.MAP.getInstance()?.zoomOut());
    document.getElementById('btn-zoom-reset')
      ?.addEventListener('click', () => window.MAP.fitBounds());

    // Scroll to bottom
    const scrollBtn = document.getElementById('btn-scroll-bottom');
    const chatMsgs  = document.getElementById('chat-messages');
    if (chatMsgs && scrollBtn) {
      chatMsgs.addEventListener('scroll', () => {
        const dist = chatMsgs.scrollHeight - chatMsgs.scrollTop - chatMsgs.clientHeight;
        scrollBtn.classList.toggle('visible', dist > 120);
      });
      scrollBtn.addEventListener('click', () => {
        chatMsgs.scrollTo({ top: chatMsgs.scrollHeight, behavior: 'smooth' });
      });
    }

    // Renombrar capas desde la leyenda
    window.MAP.onLayerRename((key, newName) => {
      const panelInput = document.querySelector(`.layers-data-row[data-key="${key}"] .layer-name-input`);
      if (panelInput && panelInput !== document.activeElement) panelInput.value = newName;
      if (currentPlan?.instrucciones) {
        const inst = currentPlan.instrucciones.find(c => c.mapKey === key);
        if (inst) inst.descripcion = newName;
      }
      const user   = window.AUTH?.currentUser();
      const chatId = window.CHAT?.getChatId?.();
      if (user && chatId && currentPlan) {
        window.FB.updateChat(user.uid, chatId, { lastMap: currentPlan })
          .catch(() => window.TOAST.error(t('toast_name_error')));
        window.SIDEBAR.updateCachedChat(chatId, { lastMap: currentPlan });
      }
    });

    // _persistPlan está definida en el scope del módulo (ver arriba de wireWorkEvents)

    // Persistir preferencias del popup en Turso
    window.MAP.onPopupPrefsSave((prefs) => {
      const user   = window.AUTH?.currentUser();
      const chatId = window.CHAT?.getChatId?.();
      if (!user || !chatId) return;
      window.FB.updateChat(user.uid, chatId, { popupPrefs: prefs })
        .catch(e => console.warn('[APP] Error al persistir popup prefs:', e));
      window.SIDEBAR.updateCachedChat(chatId, { popupPrefs: prefs });
    });

    // Persistir visibilidad cuando se toggle desde el panel de capas
    window.MAP.onLayerVisibilityChange((key, visible) => {
      if (currentPlan?.instrucciones) {
        const inst = currentPlan.instrucciones.find(c => c.mapKey === key);
        if (inst) inst.visible = visible;
      }
      _persistPlan();
    });

    // Persistir orden cuando se arrastra una capa
    window.MAP.onLayerOrderChange(() => {
      if (!currentPlan?.instrucciones) return;
      const activeKeys = Object.keys(window.MAP.getActiveLayers());
      currentPlan.instrucciones.sort((a, b) =>
        activeKeys.indexOf(a.mapKey) - activeKeys.indexOf(b.mapKey)
      );
      _persistPlan();
    });

    // Actualizar SVG en la fila del panel cuando cambia el estilo
    // (cubre cambios desde el chat, modal avanzado, y applyStylePlan)
    window.MAP.onStyleChange((key, style) => {
      const { geomSVG } = window.LP_UTILS;
      const layer = window.MAP.getActiveLayers()[key];
      if (!layer || !geomSVG) return;

      const _updateRowSvg = () => {
        const rowEl = document.querySelector(`.layers-data-row[data-key="${key}"]`);
        const svg   = rowEl?.querySelector('.layer-geom-svg');
        if (!svg) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = geomSVG(layer);
        const newSvg = tmp.firstChild;
        if (newSvg) svg.replaceWith(newSvg);
      };

      if (style.icon && !window._makiSvgCache?.[style.icon]?.svgRaw) {
        // Ícono no cacheado: disparar fetch en paralelo y actualizar el SVG cuando llegue.
        // Sin await — no bloquear el callback mientras el proxy responde.
        window.MAP.precacheMakiIcon?.(style.icon)?.then?.(() => _updateRowSvg());
      } else {
        _updateRowSvg();
      }
    });

    // Título del mapa
    const mapTitleInput = document.getElementById('map-title');
    if (mapTitleInput) {
      mapTitleInput.addEventListener('blur', () => {
        const newTitulo = mapTitleInput.value.trim();
        if (!newTitulo || !currentPlan) return;
        currentPlan.titulo = newTitulo;
        const card = document.querySelector('.msg-map-card');
        if (card) {
          const titleEl = card.querySelector('.map-card-title');
          if (titleEl) titleEl.textContent = newTitulo;
          const btn = card.querySelector('.map-card-btn');
          if (btn) {
            try {
              const plan = JSON.parse(btn.dataset.plan.replace(/&#39;/g, "'"));
              plan.titulo = newTitulo;
              btn.dataset.plan = JSON.stringify(plan).replace(/'/g, '&#39;');
            } catch (e) {}
          }
        }
        const user   = window.AUTH?.currentUser();
        const chatId = window.CHAT?.getChatId?.();
        if (user && chatId) {
          window.FB.updateChat(user.uid, chatId, { lastMap: currentPlan })
            .catch(() => window.TOAST.error(t('toast_name_error')));
          window.SIDEBAR.updateCachedChat(chatId, { lastMap: currentPlan });
        }
      });
      mapTitleInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') mapTitleInput.blur();
        if (e.key === 'Escape') mapTitleInput.blur();
      });
    }

    // Export
    document.getElementById('btn-export')
      ?.addEventListener('click', () => {
        const btn = document.getElementById('btn-export');
        const dd  = document.getElementById('export-dropdown');
        const isOpen = dd.classList.toggle('open');
        btn.classList.toggle('open', isOpen);
        if (isOpen) {
          const rect = btn.getBoundingClientRect();
          dd.style.top  = (rect.bottom + 6) + 'px';
          dd.style.left = '0px'; // temporal para que tenga tamaño
          // Medir después de que sea visible
          requestAnimationFrame(() => {
            dd.style.left = (rect.right - dd.offsetWidth) + 'px';
          });
        }
      });
    // En móvil, salida gráfica está disponible. GeoJSON y HTML se muestran
    // pero no funcionan (deshabilitados visualmente desde CSS).
    const _graphicBtn = document.getElementById('export-graphic');
    if (_graphicBtn) {
      _graphicBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('export-dropdown').classList.remove('open');
        document.getElementById('btn-export').classList.remove('open');
        window.EXPORT_GRAPHIC.open();
      });
    }
    const _isMobileExport = window.EXPORT.isMobile || window.MAP_CONTROLS?.isMobile?.();
    const _geojsonBtn = document.getElementById('export-geojson');
    const _htmlBtn    = document.getElementById('export-html');
    if (_isMobileExport) {
      if (_geojsonBtn) _geojsonBtn.disabled = true;
      if (_htmlBtn)    _htmlBtn.disabled = true;
    } else {
      _geojsonBtn?.addEventListener('click', () => {
        document.getElementById('export-dropdown').classList.remove('open');
        document.getElementById('btn-export').classList.remove('open');
        window.EXPORT.toGeoJSON();
      });
      _htmlBtn?.addEventListener('click', () => {
        document.getElementById('export-dropdown').classList.remove('open');
        document.getElementById('btn-export').classList.remove('open');
        window.EXPORT.toHTML();
      });
    }
    document.addEventListener('click', e => {
      if (!e.target.closest('.export-wrapper')) {
        document.getElementById('export-dropdown')?.classList.remove('open');
        document.getElementById('btn-export')?.classList.remove('open');
      }
    });

    // Chat header events
    window.CHAT_HEADER.wireEvents();
  }

  // ── Textareas ─────────────────────────────────────────────────

  function wireTextareas() {
    const map = {
      'initial-prompt': sendInitialPrompt,
      'chat-input':     sendChatMessage
    };
    Object.entries(map).forEach(([id, fn]) => {
      const ta = document.getElementById(id);
      if (!ta) return;
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fn(); }
      });
      ta.addEventListener('input', () => autoResize(ta));
    });

  }

  function autoResize(ta) {
    const box = ta.closest('.prompt-box');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    if (box) box.classList.toggle('multiline', ta.scrollHeight > 44);
  }

  function sendChatMessage() {
    const ta  = document.getElementById('chat-input');
    const txt = ta.value.trim();
    if (!txt) return;
    ta.value = '';
    ta.style.height = 'auto';
    const box = ta.closest('.prompt-box');
    if (box) box.classList.remove('multiline');
    window.CHAT.send(txt);
  }

  // ── renderMap ─────────────────────────────────────────────────

  let _isRendering = false;

  async function renderMap(plan) {
    // Evitar renders concurrentes — si ya hay uno en curso, ignorar
    if (_isRendering) {
      console.warn('[APP] renderMap ignorado — ya hay un render en curso');
      return;
    }
    _isRendering = true;

    try {
    if (!plan?.instrucciones?.length) {
      if (plan && Array.isArray(plan.instrucciones)) {
        window.MAP.clearAll();
        currentPlan = plan;
        window.MAP.updateLegend();
        _persistPlan();
      } else {
        window.TOAST.error(t('toast_map_no_layers'));
      }
      return;
    }

    currentPlan = plan;

    const titleInput = document.getElementById('map-title');
    if (plan.titulo) titleInput.value = plan.titulo;

    // En mobile/tablet: no abrir el mapa automáticamente — el usuario lo abre desde el chat
    if (!window.MAP_CONTROLS?.isMobile?.()) {
      window.MAP_CONTROLS.setMapVisible(true);
    } else {
      // Inicializar el mapa en background sin mostrarlo
      window.MAP.init();
    }

    // Capturar estilos editados por el usuario ANTES del clearAll.
    // activeLayers tiene el estilo vivo del mapa — es la fuente más fiable
    // independientemente de si el cambio vino del panel de estilo o del LLM.
    // Indexado por layerKey para matchear con las instrucciones del nuevo plan.
    const prevStyleByLayerKey = {};
    const prevActiveLayers = window.MAP?.getActiveLayers?.() || {};
    Object.values(prevActiveLayers).forEach(entry => {
      if (entry.layerKey && entry.style) {
        prevStyleByLayerKey[entry.layerKey] = {
          style:          { ...entry.style },
          classification: entry.classification ? { ...entry.classification } : null,
        };
      }
    });

    window.MAP.clearAll();

    const refreshBtn = document.getElementById('btn-refresh-map');
    refreshBtn?.classList.add('spinning');

    // ── Barra de progreso ─────────────────────────────────────
    const progressEl = document.getElementById('map-progress');
    const progressBar = document.getElementById('map-progress-bar');
    const instrucciones = plan.instrucciones.filter(i => !i._failed);
    const total = instrucciones.length;
    let cargadas = 0;

    function _setProgress(pct) {
      if (!progressBar) return;
      progressBar.style.width = pct + '%';
    }
    function _startProgress() {
      if (!progressEl) return;
      progressEl.classList.remove('done');
      progressEl.classList.add('active');
      _setProgress(0);
    }
    function _stepProgress() {
      cargadas++;
      _setProgress(total > 0 ? Math.round((cargadas / total) * 100) : 100);
    }
    function _endProgress() {
      _setProgress(100);
      // Esperar a que la transición de width termine, luego fade out
      setTimeout(() => progressEl?.classList.add('done'), 400);
      setTimeout(() => {
        progressEl?.classList.remove('active', 'done');
        _setProgress(0);
      }, 750);
    }

    _startProgress();

    const emptyEl = document.getElementById('map-empty');
    emptyEl?.classList.remove('hidden');
    if (emptyEl) emptyEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" opacity="0.3" style="animation:spin 1.2s linear infinite">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
      <p style="color:var(--cream2);font-size:13px">Cargando capas…</p>
    `;

    if (!document.getElementById('spin-style')) {
      const st = document.createElement('style');
      st.id = 'spin-style';
      st.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }

    const errors = [];

    for (let i = 0; i < plan.instrucciones.length; i++) {
      const inst = plan.instrucciones[i];

      // Saltear capas que ya fallaron en un intento anterior.
      // _failed se persiste en Turso para que no se reintenten al restaurar el chat.
      // El usuario puede volver a pedirlas explícitamente en el chat.
      if (inst._failed) {
        console.log(`[APP] Saltando capa fallida: ${inst.layerKey}`);
        continue;
      }

      try {
        // Sanear layerKey: en versiones anteriores podía persistirse con el sufijo
        // del mapKey (ej: "pasos_frontera_1" en lugar de "pasos_frontera").
        // Si la clave no existe en LAYERS pero sí existe sin el sufijo _N, corregirla.
        if (!window.LAYERS[inst.layerKey]) {
          const clean = inst.layerKey.replace(/_\d+$/, '');
          if (window.LAYERS[clean]) {
            console.warn(`[APP] layerKey "${inst.layerKey}" corregido a "${clean}"`);
            inst.layerKey = clean;
          }
        }

        const layerDef = window.LAYERS[inst.layerKey];
        if (!layerDef) throw new Error(`Capa desconocida: ${inst.layerKey}`);

        if (!window.SPATIAL) {
          const faltan = ['_SPATIAL_CLIP','_SPATIAL_INTERSECT','_SPATIAL_WITHIN_LAYER','_SPATIAL_DISSOLVE','_SPATIAL_ADJACENT','_SPATIAL_NEAREST','SPATIAL']
            .filter(m => !window[m]).join(', ');
          throw new Error(`Módulo SPATIAL no disponible. Faltan: ${faltan || 'desconocido'}. Recargá la página.`);
        }

        const geojson = await window.SPATIAL.ejecutar(inst);
        if (!geojson.features?.length) {
          // Si fue bloqueada por umbral de display, el toast ya se mostró en spatial.js
          // — no agregar un segundo mensaje de error redundante.
          if (!geojson._blockedByThreshold) {
            errors.push(`${inst.descripcion || layerDef.titulo} no devolvió datos`);
          }
          _stepProgress();
          continue;
        }
        const mapKey = `${inst.layerKey}_${i}`;
        inst.mapKey  = mapKey;

        // Estilo: usa el que mandó el LLM, o un fallback neutro por geometría.
        // El LLM siempre debería mandar estilo — el fallback es red de seguridad.
        const geomType = layerDef.geomType || 'polygon';

        // Estilo: prioridad decreciente:
        // 1. Estilo que el usuario tenía en el mapa justo antes del re-render (ediciones manuales)
        // 2. Estilo que trae la instrucción (del LLM o de persistencia)
        // 3. Fallback neutro por geometría
        const STYLE_FALLBACK = {
          polygon: { fillColor: '#3d52a0', fillOpacity: 0.2,  color: '#3d52a0', weight: 1.5, opacity: 1 },
          line:    { color: '#3d52a0',     weight: 2,          opacity: 1 },
          point:   { fillColor: '#3d52a0', fillOpacity: 0.85,  color: '#fff',   radius: 5,   weight: 1.5, opacity: 1 },
        };
        const style = prevStyleByLayerKey[inst.layerKey]
          ? { ...prevStyleByLayerKey[inst.layerKey].style }
          : inst.style
            ? { ...inst.style }
            : { ...STYLE_FALLBACK[geomType] };

        // Normalizar borde de polígonos: si el color del borde difiere mucho
        // del relleno, forzarlo a una versión más oscura del fillColor.
        if (geomType === 'polygon' && style.fillColor && style.color) {
          const fillRgb  = _hexToRgb(style.fillColor);
          const borderRgb = _hexToRgb(style.color);
          if (fillRgb && borderRgb) {
            // Distancia euclidiana en espacio RGB
            const dist = Math.sqrt(
              Math.pow(fillRgb.r - borderRgb.r, 2) +
              Math.pow(fillRgb.g - borderRgb.g, 2) +
              Math.pow(fillRgb.b - borderRgb.b, 2)
            );
            // Si el borde es muy diferente al relleno (dist > 100), corregirlo
            if (dist > 100) {
              style.color = _darkenHex(style.fillColor, 0.30);
            }
          }
        }

        const _lang    = window.I18N?.getLang?.() || 'es';
        const _suf     = _lang === 'en' ? 'En' : _lang === 'pt' ? 'Pt' : 'Es';
        const _tituloLayer = toTitleCase(
          inst.tituloUI || inst.titulo || inst.descripcion ||
          layerDef[`tituloUI${_suf}`] || layerDef.tituloUI || layerDef.titulo
        );
        window.MAP.addLayer(mapKey, inst.layerKey, geojson, style, _tituloLayer);
        // Restaurar visibilidad si fue ocultada
        if (inst.visible === false) window.MAP.restoreLayerVisible(mapKey, false);
        // Restaurar clasificación: prioridad al snapshot previo (editado por el usuario),
        // luego a lo que traiga la instrucción
        const prevCl = prevStyleByLayerKey[inst.layerKey]?.classification;
        const clSource = prevCl || (inst.classification?.field && inst.classification?.type ? inst.classification : null);
        if (clSource?.field && clSource?.type) {
          // Usar la paleta ya guardada en clSource (fue asignada en applyClassifyPlan con rotación).
          // Solo recalcular si no hay paletteColors (clasificación restaurada de BD sin colores).
          let paletteColors = clSource.paletteColors;
          if (!paletteColors?.length) {
            if (clSource.type === 'graduated') {
              paletteColors = window.PALETTES[clSource.palette] || window.PALETTES.seq_blues;
            } else {
              const picked = _pickClassifyPalette(clSource);
              paletteColors = picked.colors;
            }
          }
          // Bug D fix: applyClassification es async — awaitar para que la leyenda
          // se actualice DESPUÉS de que el colorMap/breaks estén listos.
          await window.MAP.applyClassification(mapKey, { ...clSource, paletteColors });
        }
        _stepProgress();
      } catch (err) {
        const layerDef = window.LAYERS[inst.layerKey];
        const titulo   = toTitleCase(inst.titulo || inst.descripcion || layerDef?.titulo || inst.layerKey);

        // Marcar como fallida para no reintentar automáticamente
        inst._failed = true;

        // Persistir el flag en Turso
        const plan2  = window.APP?.getCurrentPlan?.() || plan;
        const user   = window.AUTH?.currentUser();
        const chatId = window.CHAT?.getChatId?.();
        if (user && chatId && plan2) {
          window.FB.updateChat(user.uid, chatId, { lastMap: plan2 })
            .catch(e => console.warn('[APP] Error persistiendo _failed:', e));
        }

        // Toast: aviso inmediato — diferenciado por tipo de error
        if (err.isTimeout) {
          window.TOAST?.warning(t('toast_timeout_area'));
        } else if (err.isTruncated) {
          window.TOAST?.warning(err.message);
        } else if (err.isExternalServerError) {
          window.TOAST?.warning(t('toast_layer_error', {titulo}));
        } else {
          window.TOAST?.error(t('toast_layer_error', {titulo}));
        }

        // Tarjeta de error en chat
        const externalMsg = (err.isExternalServerError || err.isTruncated) ? err.message : null;
        window.UI?.showErrorCard?.(titulo, inst.layerKey, externalMsg);

        errors.push(err.message);
        console.error(`[APP] Error cargando capa ${inst.layerKey}:`, err);
        _stepProgress();
      }
    }

    _endProgress();

    const activeLayers = window.MAP.getActiveLayers();
    if (Object.keys(activeLayers).length > 0) {
      emptyEl?.classList.add('hidden');
      window.MAP.updateLegend();
      // Registrar mapa generado exitosamente
      window.ANALYTICS?.mapGenerated?.(plan);
      setTimeout(() => {
        window.MAP.getInstance()?.invalidateSize();
        if (!window.MAP_CONTROLS?.isMobile?.()) {
          // Desktop: el panel ya tiene dimensiones, hacer zoom directo.
          setTimeout(() => window.MAP.fitBounds(), 150);
        } else {
          // Móvil: si el panel ya está visible (usuario ya tocó VER antes de que
          // terminara de cargar), hacer zoom ahora. Si no, marcar para que
          // setMapVisible lo ejecute cuando el usuario toque VER.
          const mapPanel = document.getElementById('map-panel');
          if (mapPanel?.style.display !== 'none') {
            setTimeout(() => window.MAP.fitBounds(), 150);
          } else {
            window._pendingFitBounds = true;
          }
        }
      }, 200);
    } else if (emptyEl) {
      emptyEl.classList.add('has-error');
      emptyEl.innerHTML = `
        <p style="color:var(--cream2);font-size:13px">No se pudieron cargar las capas.</p>
        <button onclick="window.APP.newMap()" style="
          margin-top:8px; padding:8px 20px; border-radius:30px;
          background:transparent; border:0.5px solid var(--border-md);
          color:var(--cream2); font-family:var(--font-sans); font-size:13px;
          cursor:pointer; pointer-events:auto;
        ">Volver al inicio</button>
      `;
    }

    if (errors.length) {
      if (errors.length === 1) {
        window.TOAST.warning(errors[0] + '.');
      } else {
        const _nKeys = [null, null, 'toast_n_2', 'toast_n_3', 'toast_n_4', 'toast_n_5'];
        const nText = errors.length <= 5 ? t(_nKeys[errors.length]) : t('toast_n_many');
        window.TOAST.warning(t('toast_layers_error', {n: nText}));
      }
    }

    refreshBtn?.classList.remove('spinning');

    } finally {
      _isRendering = false;
    }
  }

  // ── Aplicar estilos desde chat ────────────────────────────────

  function applyStylePlan(stylePlan) {
    const activeLayers = window.MAP.getActiveLayers();
    let changed = false;

    for (const s of stylePlan) {
      // Buscar la capa por layerKey
      const entry = Object.entries(activeLayers)
        .find(([, v]) => v.layerKey === s.layerKey);
      if (!entry) continue;

      const [mapKey, layer] = entry;
      const { layerKey: _lk, ...styleChanges } = s;
      const newStyle = { ...layer.style, ...styleChanges };

      window.MAP.updateLayerStyle(mapKey, newStyle);
      layer.style = newStyle;

      // Persistir en el plan
      if (currentPlan?.instrucciones) {
        const inst = currentPlan.instrucciones.find(i => i.mapKey === mapKey);
        if (inst) inst.style = { ...newStyle };
      }
      changed = true;
    }

    if (!changed) return;

    window.MAP.updateLegend();
    _persistPlan();
    window.ANALYTICS?.styleChanged?.("chat");

    // En móvil: mostrar botón "Ver mapa" si el panel está oculto
    if (window.MAP_CONTROLS?.isMobile?.()) {
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel?.style.display === 'none') {
        window.UI?.showViewMapBtn?.();
      }
    }
  }

  // ── Aplicar clasificación desde chat ─────────────────────────

  // Paletas cualitativas en rotación — una por capa clasificada para evitar
  // que dos capas muestren los mismos colores en la leyenda.
  const _CAT_PALETTE_ROTATION = ['cat_tableau', 'cat_bold', 'cat_earth', 'cat_vivid', 'cat_dark', 'cat_pastel'];

  function _pickClassifyPalette(cEntry) {
    // Si el LLM o el usuario pidieron una paleta específica (distinta a la default), respetarla.
    if (cEntry.palette && cEntry.palette !== 'qualitative' && window.PALETTES[cEntry.palette]) {
      return { key: cEntry.palette, colors: window.PALETTES[cEntry.palette] };
    }
    // Contar cuántas capas activas ya tienen clasificación categorized → rotar paleta
    const layers = window.MAP.getActiveLayers();
    const classifiedCount = Object.values(layers)
      .filter(e => e.classification?.type === 'categorized')
      .length;
    const paletteKey = _CAT_PALETTE_ROTATION[classifiedCount % _CAT_PALETTE_ROTATION.length];
    return { key: paletteKey, colors: window.PALETTES[paletteKey] || window.PALETTES.qualitative };
  }

  async function applyClassifyPlan(classifyPlan) {
    const activeLayers = window.MAP.getActiveLayers();
    let changed = false;
    for (let c of classifyPlan) {
      const entry = Object.entries(activeLayers).find(([, v]) => v.layerKey === c.layerKey);
      if (!entry) continue;
      const [mapKey] = entry;
      let colors;
      if (c.type === 'graduated') {
        // Graduated: usar la paleta secuencial pedida
        colors = window.PALETTES[c.palette] || window.PALETTES.seq_blues;
      } else {
        // Categorized: rotar paletas para que cada capa use una distinta
        const picked = _pickClassifyPalette(c);
        c = { ...c, palette: picked.key };
        colors = picked.colors;
      }
      // Bug B fix: applyClassification es async (usa worker), hay que awaitarla
      // para que la leyenda se actualice DESPUÉS de que el colorMap esté listo.
      await window.MAP.applyClassification(mapKey, { ...c, paletteColors: colors });
      if (currentPlan?.instrucciones) {
        const inst = currentPlan.instrucciones.find(i => i.mapKey === mapKey);
        if (inst) inst.classification = { ...c, paletteColors: colors };
      }
      changed = true;
    }
    if (!changed) return;

    // Persistir directamente con _persistPlan (ahora en scope del módulo)
    const _user   = window.AUTH?.currentUser?.();
    const _chatId = window.CHAT?.getChatId?.();
    if (_user && _chatId && currentPlan) {
      window.SIDEBAR?.updateCachedChat?.(_chatId, { lastMap: currentPlan });
      window.FB?.updateChat?.(_user.uid, _chatId, { lastMap: currentPlan })
        .catch(e => console.warn('[APP] Error persistiendo clasificación:', e));
    }

    if (window.MAP_CONTROLS?.isMobile?.()) {
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel?.style.display === 'none') {
        window.UI?.showViewMapBtn?.();
      }
    }
  }

  let _restoreChatToken = 0;

  async function restoreChat(chat) {
    // Cada llamada genera un token único. Si durante la ejecución
    // llega una nueva llamada, el token cambia y la anterior se cancela.
    const token = ++_restoreChatToken;

    document.getElementById('screen-home')?.classList.remove('active');
    document.getElementById('screen-work')?.classList.add('active');
    window.MAP_CONTROLS.setMapVisible(false);

    window.MAP.clearAll();
    window.MAP.resetView();
    window.MAP.updateLegend();
    currentPlan = null;

    window.CHAT.restore(chat);

    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.innerHTML = '';

    for (const m of (chat.messages || [])) {
      const meta = m.time ? { time: new Date(m.time), model: m.model || null } : null;
      if (m.role === 'user') {
        window.UI.addMessage('user', m.content, meta);
      } else {
        // Mensajes de intent — no renderizar texto, solo el card del mapa
        if (m.content?.startsWith('[intent]')) continue;
        // sanitizeForDisplay es la fuente de verdad — definida en chat.js
        const displayText = window.CHAT?.sanitizeForDisplay?.(m.content) ?? m.content;
        window.UI.addMessage('assistant', displayText, meta);
      }
    }

    if (chat.lastMap) {
      if (chat.popupPrefs) window.MAP.setPopupPrefs(chat.popupPrefs);
      window.UI.showMapReady(chat.lastMap);
      if (token !== _restoreChatToken) {
        console.warn('[APP] restoreChat cancelado — llegó una llamada más reciente');
        return;
      }
      // En mobile/tablet: no abrir el mapa automáticamente — el usuario lo abre desde el chat
      if (!window.MAP_CONTROLS?.isMobile?.()) {
        await renderMap(chat.lastMap);
      }
    }

    // Verificar token al final también
    if (token !== _restoreChatToken) return;

    window.SIDEBAR.setChatId(chat.id);
    window.CHAT_HEADER.setChatHeader(chat.titulo);
    if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      setTimeout(() => document.getElementById('chat-input')?.focus(), 200);
    }
  }

  // ── Nuevo mapa ────────────────────────────────────────────────

  function newMap() {
    window.MAP.clearAll();
    window.MAP.resetView();
    window.MAP.updateLegend();
    window.SUGGESTED_PROMPTS?.hide();
    window.CHAT.reset();
    window.SIDEBAR?.collapseIfMobile?.();
    window.MAP_CONTROLS.setMapVisible(false);
    window.MAP_CONTROLS.resetDivider();
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('screen-work')?.classList.remove('active');
    document.getElementById('screen-home')?.classList.add('active');
    document.getElementById('initial-prompt').value = '';
    currentPlan = null;
    window.history.replaceState(null, '', '/chat');
    window.CHAT_HEADER.setChatHeader(null);
    setTimeout(() => window.SUGGESTED_PROMPTS?.showInHome?.(), 100);
  }

  // ── Saludos dinámicos ─────────────────────────────────────────

  function buildGreeting(nombre) {
    const h = new Date().getHours();
    const n = nombre;
    const manana = h >= 6  && h < 12;
    const tarde  = h >= 12 && h < 20;
    const opciones = manana ? [
      n ? t('greeting_morning_n',{n})    : t('greeting_morning_1'),
      n ? t('greeting_hello_well_n',{n}) : t('greeting_morning_2'),
      n ? t('greeting_hello_n',{n})      : t('greeting_morning_3'),
      n ? t('greeting_explore_n',{n})    : t('greeting_morning_4'),
      n ? t('greeting_morning_n',{n})    : t('greeting_morning_5'),
    ] : tarde ? [
      n ? t('greeting_afternoon_n',{n})  : t('greeting_afternoon_1'),
      n ? t('greeting_hello_well_n',{n}) : t('greeting_afternoon_2'),
      n ? t('greeting_hello_n',{n})      : t('greeting_afternoon_3'),
      n ? t('greeting_explore_n',{n})    : t('greeting_afternoon_4'),
      n ? t('greeting_afternoon_n',{n})  : t('greeting_afternoon_1'),
    ] : [
      n ? t('greeting_night_n',{n})      : t('greeting_night_1'),
      n ? t('greeting_hello_well_n',{n}) : t('greeting_night_2'),
      n ? t('greeting_night_owl_n',{n})  : t('greeting_night_3'),
      n ? t('greeting_explore_n',{n})    : t('greeting_night_4'),
      n ? t('greeting_hello_n',{n})      : t('greeting_night_1'),
    ];
    return opciones[Math.floor(Math.random() * opciones.length)];
  }

  function buildGreetingAnon() {
    const h = new Date().getHours();
    const manana = h >= 6  && h < 12;
    const tarde  = h >= 12 && h < 20;
    const opciones = manana ? [
      t('greeting_morning_4'),
      t('greeting_nologin_1'),
      t('greeting_morning_4'),
      t('greeting_morning_5'),
    ] : tarde ? [
      t('greeting_afternoon_4'),
      t('greeting_nologin_1'),
      t('greeting_afternoon_1'),
      t('greeting_nologin_2'),
    ] : [
      t('greeting_night_4'),
      t('greeting_nologin_3'),
      'Buenas. Todo listo cuando quieras.',
      t('greeting_nologin_4'),
    ];
    return opciones[Math.floor(Math.random() * opciones.length)];
  }

  // ── Auth + routing ────────────────────────────────────────────

  async function initAuth() {
    if (!window.AUTH) {
      console.error('[APP] window.AUTH no disponible — auth.js no se cargó correctamente');
      return;
    }
    const authError = window.AUTH.handleAuthError();
    if (authError) window.TOAST.error(t('toast_auth_error', {msg: authError}));

    const newSession = window.AUTH.handleCallback();
    const pendingMessage = localStorage.getItem('casux_pending_message');
    if (pendingMessage) localStorage.removeItem('casux_pending_message');

    if (newSession) console.log('[APP] Login OK:', newSession.email);

    let user = window.AUTH.currentUser();

    // Si no hay sesión, crear una anónima automáticamente
    if (!user) {
      try {
        user = await window.AUTH.loginAnon();
        console.log('[APP] Sesión anónima creada:', user.uid);
      } catch (err) {
        console.warn('[APP] No se pudo crear sesión anónima:', err.message);
      }
    }

    window.SIDEBAR.render();
    window.SIDEBAR.setUser(user);

    const greeting = document.getElementById('home-greeting');
    if (greeting) {
      greeting.textContent = user && !window.AUTH.isAnon()
        ? buildGreeting(user.name?.split(' ')[0] || null)
        : buildGreetingAnon();
    }

    await handleURLRouting();

    // Reenviar mensaje pendiente al final, cuando todo está inicializado
    if (pendingMessage) {
      setTimeout(() => goToWork(pendingMessage), 300);
    }
  }

  async function handleURLRouting() {
    const path = window.location.pathname;
    // Soporta /chat/shortId (nuevo) y /#chat=id (legacy)
    const shortIdMatch = path.match(/^\/chat\/(\d{12})$/);
    const legacyHash   = window.location.hash;
    if (!shortIdMatch && !legacyHash.startsWith('#chat=')) return;

    const user = window.AUTH?.currentUser();
    if (!user) return;
    try {
      let chat = null;
      if (shortIdMatch) {
        const shortId = shortIdMatch[1];
        chat = await window.FB.getChatByShortId(user.uid, shortId);
      } else {
        const chatId = legacyHash.slice('#chat='.length);
        chat = await window.FB.getChat(user.uid, chatId);
      }
      if (chat) await restoreChat(chat);
    } catch (err) {
      console.warn('[APP] No se pudo cargar el chat desde URL:', err.message);
    }
  }

  // Esperar a que window.LAYERS esté disponible antes de inicializar.
  // Es necesario porque layers/index.js se carga como ES module (asíncrono)
  // y puede no haber terminado cuando DOMContentLoaded dispara.
  function waitForLayers(callback, intentos = 0) {
    if (window.LAYERS && Object.keys(window.LAYERS).length > 0) {
      callback();
    } else if (intentos < 50) {
      setTimeout(() => waitForLayers(callback, intentos + 1), 100);
    } else {
      console.error('[APP] window.LAYERS no disponible después de 5s — verificá layers/index.js');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.SETTINGS.init();
    waitForLayers(() => {
      init();
      initAuth();
    });
  });

  return {
    renderMap,
    goToWork,
    newMap,
    restoreChat,
    applyStylePlan,
    applyClassifyPlan,
    setChatHeader: (t) => window.CHAT_HEADER.setChatHeader(t),
    getCurrentPlan: () => currentPlan
  };

})();
