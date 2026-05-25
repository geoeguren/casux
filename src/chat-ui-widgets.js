/**
 * chat-ui-widgets.js — Widgets de UI del chat
 *
 * Extiende window.UI (creado por chat-ui-messages.js) con Object.assign.
 * Depende de: window.UI (chat-ui-messages.js), window.I18N (t()),
 *             window.MAP, window.CHAT, window.EXPORT, window.EXPORT_GRAPHIC,
 *             window.SETTINGS, window.MAP_CONTROLS, window.CHAT_HEADER, window.APP
 * Debe cargarse DESPUÉS de chat-ui-messages.js y ANTES de chat-style-flow.js
 *
 * Contiene: showModeSelector, showExportChoice, showStyleButtons,
 *           showBasemapButtons, showLayerSelectorForAction,
 *           showRenameInput, showClassifiedStyleChoice,
 *           showNumberInput, showConfirmChoice
 */

(function () {

  const $msgs = () => document.getElementById('chat-messages');

  // ── Selector de modo de respuesta ────────────────────────────
  // Se muestra una sola vez, al final de la primera respuesta del LLM,
  // cuando el usuario nunca eligió un modo explícito.

  function showModeSelector() {
    const card = document.createElement('div');
    card.className = 'msg-export-choice msg-mode-selector';

    const modes = [
      { val: 'default',    label: t('settings_default'),   sub: t('mode_sub_default')    },
      { val: 'eficiente',  label: t('settings_efficient'),  sub: t('mode_sub_eficiente')  },
      { val: 'detallista', label: t('settings_detailed'),   sub: t('mode_sub_detallista') },
      { val: 'creativo',   label: t('settings_creative'),   sub: t('mode_sub_creativo')   },
    ];

    card.innerHTML = `
      <p class="mode-selector-label">${t('mode_selector_prompt')}</p>
      ${modes.map(m => `
        <button class="export-choice-btn" data-mode="${m.val}">
          <span class="export-choice-label">${m.label}</span>
          <span class="export-choice-sub">${m.sub || ''}</span>
        </button>`).join('')}`;

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        window.SETTINGS?.set('tone', mode);
        localStorage.setItem('sm_mode_chosen', '1');

        const confirm = document.createElement('div');
        confirm.className = 'msg assistant msg-export-confirm';
        confirm.textContent = t('mode_chosen', { mode: modes.find(m => m.val === mode)?.label || mode });
        card.replaceWith(confirm);
        window.UI.scrollBottom();
      });
    });

    $msgs()?.appendChild(card);
    window.UI.scrollBottom();
  }

  function showExportChoice(msgEl) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    const isMobile = window.MAP_CONTROLS?.isMobile?.();

    const allExports = [
      { key: 'graphic', label: t('export_opt_graphic', 'Salida gráfica'), sub: 'jpeg · pdf', mobileHidden: false },
      { key: 'html',    label: t('export_opt_html',    'Embebido'),        sub: 'html',       mobileHidden: true  },
      { key: 'geojson', label: t('export_opt_geojson', 'Capa vectorial'),  sub: 'geojson',    mobileHidden: true  },
    ];

    const exports = allExports.filter(e => !(isMobile && e.mobileHidden));

    card.innerHTML = exports.map(e => `
      <button class="export-choice-btn" data-fmt="${e.key}">
        <span class="export-choice-label">${e.label}</span>
        <span class="export-choice-sub">${e.sub}</span>
      </button>`).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fmt = btn.dataset.fmt;
        card.remove();
        if      (fmt === 'graphic') window.EXPORT_GRAPHIC?.open?.();
        else if (fmt === 'html')    window.EXPORT?.toHTML?.();
        else if (fmt === 'geojson') window.EXPORT?.toGeoJSON?.();
      });
    });

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    window.UI.scrollBottom();
  }

  // ── Botones contextuales de estilo ───────────────────────────

  function showStyleButtons(msgEl) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const geomTypes = [...new Set(Object.values(activeLayers).map(v => v.geomType).filter(Boolean))];

    const options = [];

    if (geomTypes.some(g => /point|punto/i.test(g))) {
      options.push(
        { label: t('style_size'),      msg: t('style_change_size')        },
        { label: t('style_color'),     msg: t('style_change_color_point') },
        { label: t('adv_svg_title'),   msg: t('style_change_icon')        },
      );
    }
    if (geomTypes.some(g => /line|linea|línea/i.test(g))) {
      options.push(
        { label: t('style_weight'), msg: t('style_change_weight')    },
        { label: t('style_color'),  msg: t('style_change_color_line') },
      );
    }
    if (geomTypes.some(g => /polygon|polígono|poligono/i.test(g))) {
      options.push(
        { label: t('style_fill_color'),    msg: t('style_change_fill')          },
        { label: t('style_border_color'),  msg: t('style_change_border')        },
        { label: t('style_border_weight'), msg: t('style_change_border_weight') },
      );
    }

    if (!options.length) {
      options.push(
        { label: t('style_color'),  msg: t('style_change_color_line') },
        { label: t('style_weight'), msg: t('style_change_weight')     },
      );
    }

    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    card.innerHTML = options.map(o => `
      <button class="export-choice-btn" data-msg="${o.msg.replace(/"/g, '&quot;')}">
        <span class="export-choice-label">${o.label}</span>
      </button>`).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = btn.dataset.msg;
        card.remove();
        const input = document.getElementById('chat-input');
        if (input) {
          input.value = msg;
          input.dispatchEvent(new Event('input'));
        }
        window.CHAT?.send?.(msg);
      });
    });

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    window.UI.scrollBottom();
  }

  function showBasemapButtons(msgEl) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    const options = [
      { subtipo: 'gray',    icon: 'light_mode', label: 'Positron',    sub: t('basemap_hint_gray')    },
      { subtipo: 'dark',    icon: 'dark_mode',  label: 'Dark Matter', sub: t('basemap_hint_dark')    },
      { subtipo: 'voyager', icon: 'map',        label: 'Voyager',     sub: t('basemap_hint_voyager') },
    ];

    card.innerHTML = options.map(o => `
      <button class="export-choice-btn" data-basemap="${o.subtipo}">
        <span class="material-icons" style="font-size:16px;margin-bottom:2px">${o.icon}</span>
        <span class="export-choice-label">${o.label} <span class="export-choice-sub" style="display:inline;margin-left:4px">${o.sub}</span></span>
      </button>`).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const subtipo = btn.dataset.basemap;
        window.MAP?.setBasemap?.(subtipo);
        const confirm = document.createElement('div');
        confirm.className = 'msg assistant msg-export-confirm';
        confirm.textContent = t('basemap_changed');
        card.replaceWith(confirm);
        window.CHAT?.getHistory?.()?.push({ role: 'assistant', content: t('basemap_changed'), time: new Date().toISOString() });
        window.UI.scrollBottom();
      });
    });

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    window.UI.scrollBottom();
  }

  // ── Selector de capa para acciones de intent ─────────────────

  function showLayerSelectorForAction(msgEl, onSelect, confirmMsg) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entries = Object.entries(activeLayers);
    if (!entries.length) return;

    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    card.innerHTML = entries
      .sort(([, a], [, b]) => (a.titulo || a.layerKey).localeCompare(b.titulo || b.layerKey, undefined, { sensitivity: 'base' }))
      .map(([mapKey, layer]) => {
        const _g  = layer.geomType || '';
        const _gl = _g === 'point' ? t('geom_point') : _g === 'line' ? t('geom_line') : _g === 'polygon' ? t('geom_polygon') : _g;
        return `
        <button class="export-choice-btn" data-mapkey="${mapKey}">
          <span class="export-choice-label">${layer.titulo || layer.layerKey}</span>
          <span class="export-choice-sub">${_gl}</span>
        </button>`;
      }).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mapKey = btn.dataset.mapkey;
        card.remove();
        onSelect(mapKey);
        if (confirmMsg) {
          window.UI.addMessage('assistant', confirmMsg);
          window.UI.scrollBottom();
        }
      });
    });

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    window.UI.scrollBottom();
  }

  // ── showRenameInput ───────────────────────────────────────────

  function showRenameInput(msgEl) {
    const card = document.createElement('div');
    card.className = 'msg-rename-card';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-card-input';
    input.placeholder = t('rename_placeholder');

    const btn = document.createElement('button');
    btn.className = 'map-card-btn';
    btn.textContent = t('rename_confirm');

    const apply = () => {
      const nombreRaw = input.value.trim();
      if (!nombreRaw) return;
      const nombre = nombreRaw.charAt(0).toUpperCase() + nombreRaw.slice(1);
      card.remove();
      window.CHAT_HEADER?.startRename?.(nombre);
      const planApply = window.APP?.getCurrentPlan?.();
      if (planApply) planApply.titulo = nombre;
      const mapTitleInput = document.getElementById('map-title');
      if (mapTitleInput) mapTitleInput.value = nombre;
      window.UI.addMessage('assistant', t('chat_renamed', { nombre }));
      window.UI.scrollBottom();
    };

    btn.addEventListener('click', apply);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); apply(); }
      if (e.key === 'Escape') card.remove();
    });

    card.appendChild(input);
    card.appendChild(btn);

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);

    setTimeout(() => input.focus(), 80);
    window.UI.scrollBottom();
  }

  function showClassifiedStyleChoice(msgEl, mapKey, onKeep, onReplace) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';
    card.innerHTML = `
      <button class="export-choice-btn" data-action="keep">
        <span class="export-choice-label">${t('style_keep_classification')}</span>
        <span class="export-choice-sub">${t('style_keep_classification_sub')}</span>
      </button>
      <button class="export-choice-btn" data-action="replace">
        <span class="export-choice-label">${t('style_replace_classification')}</span>
        <span class="export-choice-sub">${t('style_replace_classification_sub')}</span>
      </button>`;
    card.querySelector('[data-action="keep"]').addEventListener('click',    () => { card.remove(); onKeep();    });
    card.querySelector('[data-action="replace"]').addEventListener('click', () => { card.remove(); onReplace(); });
    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    window.UI.scrollBottom();
  }

  // ── showNumberInput ───────────────────────────────────────────

  function showNumberInput(msgEl, opts) {
    const card = document.createElement('div');
    card.className = 'msg-rename-card';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = opts.unit === 'km' ? '1' : '1';
    input.className = 'rename-card-input';
    input.placeholder = opts.placeholder || '';
    input.style.maxWidth = '120px';

    const unitSpan = document.createElement('span');
    unitSpan.textContent = opts.unit || '';
    unitSpan.style.cssText = 'color:var(--cream2);font-size:13px;flex-shrink:0';

    const btn = document.createElement('button');
    btn.className = 'map-card-btn';
    btn.textContent = t('confirm_btn');

    const apply = () => {
      const val = input.value.trim();
      if (!val || isNaN(parseFloat(val))) return;
      card.remove();
      opts.onConfirm(parseFloat(val));
    };
    btn.addEventListener('click', apply);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });

    card.appendChild(input);
    if (opts.unit) card.appendChild(unitSpan);
    card.appendChild(btn);

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    setTimeout(() => input.focus(), 80);
    window.UI.scrollBottom();
  }

  // ── showConfirmChoice ─────────────────────────────────────────

  function showConfirmChoice(msgEl, labelYes, labelNo, onYes, onNo) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    const btnYes = document.createElement('button');
    btnYes.className = 'export-choice-btn';
    btnYes.innerHTML = `<span class="export-choice-label">${labelYes}</span>`;
    btnYes.addEventListener('click', () => { card.remove(); onYes(); });

    const btnNo = document.createElement('button');
    btnNo.className = 'export-choice-btn';
    btnNo.innerHTML = `<span class="export-choice-label">${labelNo}</span>`;
    btnNo.addEventListener('click', () => { card.remove(); onNo(); });

    card.appendChild(btnYes);
    card.appendChild(btnNo);

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    window.UI.scrollBottom();
  }

  // ── Extender window.UI ────────────────────────────────────────
  Object.assign(window.UI, {
    showModeSelector,
    showExportChoice,
    showStyleButtons,
    showBasemapButtons,
    showLayerSelectorForAction,
    showRenameInput,
    showClassifiedStyleChoice,
    showNumberInput,
    showConfirmChoice,
  });

})();
