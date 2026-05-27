/**
 * layers-panel.js — Orquestador del panel de capas
 *
 * Expone: window.LAYERS_PANEL, window.LP_PANEL
 * Depende de (en orden de carga):
 *   layers-panel-utils.js   → window.LP_UTILS
 *   layers-panel-style.js   → window.LP_STYLE
 *   layers-panel-modal.js   → window.LP_MODAL
 *
 * Responsabilidades:
 *   - persistStyle / persistClassification (accedidos por LP_STYLE y LP_MODAL)
 *   - buildLayerRow, renderLayerRows, wireCheckboxes, wireDrag
 *   - toggle / close del dropdown principal
 *
 * API pública: window.LAYERS_PANEL = { toggle, close, geomSVG }
 */

window.LP_PANEL = (() => {

  function persistStyle(mapKey, style) {
    const plan   = window.APP?.getCurrentPlan?.();
    const user   = window.AUTH?.currentUser();
    const chatId = window.CHAT?.getChatId?.();
    if (plan?.instrucciones) {
      const inst = plan.instrucciones.find(c => c.mapKey === mapKey);
      if (inst) inst.style = { ...style };
    }
    if (user && chatId && plan) {
      window.FB.updateChat(user.uid, chatId, { lastMap: plan })
        .catch(e => console.warn('[LAYERS] Error persistiendo estilo:', e));
      window.SIDEBAR?.updateCachedChat(chatId, { lastMap: plan });
    }
  }

  function persistClassification(mapKey, classification) {
    const plan   = window.APP?.getCurrentPlan?.();
    const user   = window.AUTH?.currentUser();
    const chatId = window.CHAT?.getChatId?.();
    if (plan?.instrucciones) {
      const inst = plan.instrucciones.find(c => c.mapKey === mapKey);
      if (inst) inst.classification = classification ? { ...classification } : null;
    }
    if (user && chatId && plan) {
      window.FB.updateChat(user.uid, chatId, { lastMap: plan })
        .catch(e => console.warn('[LAYERS] Error persistiendo clasificación:', e));
      window.SIDEBAR?.updateCachedChat(chatId, { lastMap: plan });
    }
  }

  return { persistStyle, persistClassification };

})();


window.LAYERS_PANEL = (() => {

  const { esc, geomSVG, wireTouchDrag } = window.LP_UTILS;
  const { closeEditAccordion,
          toggleEditAccordion } = window.LP_STYLE;

  let _layersOnOutside = null;

  // ── Fila de capa ──────────────────────────────────────────────

  function buildLayerRow(k, l) {
    const on = l.visible !== false;
    const r  = document.createElement('div');
    r.className   = 'layers-data-row';
    r.draggable   = true;
    r.dataset.key = k;
    r.innerHTML = `
      <span class="layer-drag-handle material-icons">drag_indicator</span>
      ${geomSVG(l)}
      <input class="layer-name-input" data-key="${esc(k)}"
             value="${esc(l.tituloUI || l.titulo || k)}"
              />
      <button class="layer-zoom-btn" data-key="${esc(k)}" data-tooltip="${t('layers_center')}">
        <span class="material-icons">filter_center_focus</span>
      </button>
      <button class="layer-edit-btn" data-key="${esc(k)}" data-tooltip="${t('layers_edit')}">
        <span class="material-icons">tune</span>
      </button>
      <div class="layer-checkbox ${on ? 'on' : ''}" data-key="${esc(k)}"></div>`;

    const input = r.querySelector('.layer-name-input');
    input.addEventListener('focus', () => {
      input.dataset.original = input.value;
      input.closest('.layers-data-row').draggable = false;
    });
    input.addEventListener('blur', () => {
      input.closest('.layers-data-row').draggable = true;
      const newName  = input.value.trim();
      const original = input.dataset.original || '';
      if (!newName) { input.value = original; return; }
      if (newName === original) return;
      const layers = window.MAP.getActiveLayers();
      if (layers[k]) layers[k].tituloUI = newName;
      window.MAP.renameLayer(k, newName);
      const legendInput = document.querySelector(`.legend-label-input[data-key="${k}"]`);
      if (legendInput) legendInput.value = newName;
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = input.dataset.original || input.value; input.blur(); }
    });

    r.querySelector('.layer-zoom-btn').addEventListener('click', ev => {
      ev.stopPropagation();
      window.MAP.fitToLayer(k);
    });

    r.querySelector('.layer-edit-btn').addEventListener('click', ev => {
      ev.stopPropagation();
      const sec = ev.currentTarget.closest('.layers-data-section');
      toggleEditAccordion(k, ev.currentTarget, sec);
    });

    return r;
  }

  // ── Render de filas ───────────────────────────────────────────

  function renderLayerRows(sec) {
    closeEditAccordion(sec);
    sec.innerHTML = `<p class="sd-section-label" style="text-transform:none">${t('layers_panel_layers')}</p>`;
    const nl = window.MAP.getActiveLayers();
    Object.entries(nl).reverse().forEach(([k, l]) => sec.appendChild(buildLayerRow(k, l)));
    wireCheckboxes(sec);
    wireDrag(sec);
    window.MAP.updateLegend();
  }

  function wireCheckboxes(sec) {
    if (!sec) return;
    sec.querySelectorAll('.layer-checkbox').forEach(b => {
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        window.MAP.toggleLayerVisibility(b.dataset.key);
        b.classList.toggle('on');
      });
    });
  }

  function wireDrag(sec) {
    if (!sec) return;
    sec.addEventListener('dragover', e => e.preventDefault());
    sec.querySelectorAll('.layers-data-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', row.dataset.key);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => row.classList.add('dragging'), 0);
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        sec.querySelectorAll('.layers-data-row').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragenter', e => {
        e.preventDefault();
        const fromKey = e.dataTransfer.getData('text/plain') || '';
        if (row.dataset.key === fromKey) return;
        sec.querySelectorAll('.layers-data-row').forEach(r => r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const fromKey   = e.dataTransfer.getData('text/plain');
        const targetKey = row.dataset.key;
        if (!fromKey || fromKey === targetKey) return;
        sec.querySelectorAll('.layers-data-row').forEach(r => r.classList.remove('drag-over'));
        const keys      = Object.keys(window.MAP.getActiveLayers());
        const targetIdx = keys.indexOf(targetKey);
        window.MAP.moveLayer(fromKey, targetIdx);
        renderLayerRows(sec);
      });
    });

    // Soporte táctil (móvil): la HTML5 Drag & Drop API no funciona en touch.
    wireTouchDrag(
      sec,
      '.layers-data-row',
      '.layer-drag-handle',
      () => {
        // Sincronizar el orden lógico con el nuevo orden visual del DOM
        const keys = [...sec.querySelectorAll('.layers-data-row')].map(r => r.dataset.key);
        keys.forEach((key, idx) => {
          window.MAP.moveLayer(key, idx);
        });
        window.MAP.updateLegend?.();
      }
    );
  }

  // ── Toggle del dropdown principal ─────────────────────────────

  function toggle() {
    const btn      = document.getElementById('btn-map-layers');
    const existing = document.getElementById('layers-dropdown');
    if (existing) {
      existing.remove();
      btn?.classList.remove('active');
      if (_layersOnOutside) {
        document.removeEventListener('mousedown', _layersOnOutside, true);
        _layersOnOutside = null;
      }
      return;
    }

    const layers   = window.MAP.getActiveLayers();
    const basemaps = window.MAP.getBasemaps();
    const curBase  = window.MAP.getCurrentBase();

    const dd = document.createElement('div');
    dd.id        = 'layers-dropdown';
    dd.className = 'settings-dropdown layers-dropdown';

    // Íconos de basemap
    const BASE_ICONS = { gray: 'light_mode', dark: 'dark_mode', voyager: 'map' };

    // Construir opciones como sd-acc-option (mismo patrón que settings.js)
    const baseOptions = Object.entries(basemaps).map(([key, def]) => {
      const active = curBase === key ? ' active' : '';
      const icon   = def.icon || BASE_ICONS[key] || 'map';
      const hintEl = def.hint ? `<span class="sd-acc-option-hint">${def.hint}</span>` : '';
      return `<div class="sd-acc-option${active}" data-base="${key}">
        <span class="material-icons sd-acc-icon">${icon}</span>
        <span>${esc(def.label)}</span>${hintEl}
      </div>`;
    }).join('');

    // Etiqueta del basemap actual para el header
    const curBaseDef   = basemaps[curBase];
    const curBaseIcon  = curBaseDef?.icon || BASE_ICONS[curBase] || 'map';
    const curBaseLabel = curBaseDef?.label || curBase;

    const baseHTML = `
      <div class="sd-acc-wrap" style="border-bottom:0.5px solid var(--border)">
        <div class="sd-acc-section" data-key="basemap">
          <div class="sd-acc-header">
            <span class="sd-acc-label">${t('layers_basemap')}</span>
            <span class="sd-acc-arrow material-icons">expand_more</span>
          </div>
          <div class="sd-acc-body hidden">
            ${baseOptions}
          </div>
        </div>
      </div>`;

    let layersHTML = '';
    if (Object.keys(layers).length) {
      layersHTML = `<div class="sd-section layers-data-section"><p class="sd-section-label" style="text-transform:none">${t('layers_panel_layers')}</p>`;
      Object.entries(layers).reverse().forEach(([key, layer]) => {
        const checked = layer.visible !== false;
        layersHTML += `
          <div class="layers-data-row" draggable="true" data-key="${esc(key)}">
            <span class="layer-drag-handle material-icons">drag_indicator</span>
            ${geomSVG(layer)}
            <span class="layer-row-name">${esc(layer.tituloUI || layer.titulo || key)}</span>
            <div class="layer-checkbox ${checked ? 'on' : ''}" data-key="${esc(key)}"></div>
          </div>`;
      });
      layersHTML += '</div>';
    }

    dd.innerHTML = `<div class="sd-user-header"><span class="sd-user-name">${t('layers_panel_title')}</span></div>` + baseHTML + layersHTML;
    document.body.appendChild(dd);

    const btnRect = btn.getBoundingClientRect();
    const ddW     = dd.offsetWidth;
    let left      = btnRect.right - ddW;
    left = Math.max(8, left);
    dd.style.top  = (btnRect.bottom + 6) + 'px';
    dd.style.left = left + 'px';

    btn?.classList.add('active');

    // ── Wire acordeón de mapa base ────────────────────────────
    const baseSection = dd.querySelector('.sd-acc-section[data-key="basemap"]');
    if (baseSection) {
      const header = baseSection.querySelector('.sd-acc-header');
      const body   = baseSection.querySelector('.sd-acc-body');
      const arrow  = baseSection.querySelector('.sd-acc-arrow');
      const iconEl = header.querySelector('.sd-acc-icon');
      const labelEl = header.querySelector('.sd-acc-label');

      header.addEventListener('click', () => {
        const isOpen = !body.classList.contains('hidden');
        body.classList.toggle('hidden', isOpen);
        arrow.classList.toggle('open', !isOpen);
        header.classList.toggle('active', !isOpen);
        // Recalcular posición si el dropdown crece
        const r = btn.getBoundingClientRect();
        dd.style.top = (r.bottom + 6) + 'px';
      });

      body.querySelectorAll('.sd-acc-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const key = opt.dataset.base;
          window.MAP.setBasemap(key);
          body.querySelectorAll('.sd-acc-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
          // No cerrar el acordeón — el usuario puede seguir eligiendo
        });
      });
    }

    const sec = dd.querySelector('.layers-data-section');
    if (sec) renderLayerRows(sec);

    // Re-renderizar la lista cuando cambien las capas (agregar/quitar)
    // mientras el dropdown está abierto.
    window.MAP.onLayersChange(() => {
      const liveSec = dd.querySelector('.layers-data-section');
      if (liveSec) {
        renderLayerRows(liveSec);
      } else if (dd.isConnected) {
        // La sección no existe aún (panel vacío) — reconstruir el innerHTML del dd
        // no es viable, pero sí podemos insertar la sección
        const newSec = document.createElement('div');
        newSec.className = 'sd-section layers-data-section';
        dd.appendChild(newSec);
        renderLayerRows(newSec);
      }
    });

    let _isDragging = false;
    dd.addEventListener('dragstart', () => { _isDragging = true; });
    dd.addEventListener('dragend',   () => { _isDragging = false; });

    // Usar capture:true para recibir el evento antes de cualquier stopPropagation,
    // incluyendo clicks en el chat, botón EXPORTAR u otros elementos fuera del mapa.
    _layersOnOutside = function(e) {
      if (_isDragging) return;
      if (!dd.contains(e.target) && !btn.contains(e.target)) {
        const activeInput = dd.querySelector('input:focus');
        if (activeInput) activeInput.blur();
        dd.remove();
        btn?.classList.remove('active');
        document.removeEventListener('mousedown', _layersOnOutside, true);
        _layersOnOutside = null;
      }
    };
    setTimeout(() => document.addEventListener('mousedown', _layersOnOutside, true), 0);
  }

  function close() {
    const dd = document.getElementById('layers-dropdown');
    if (dd) dd.remove();
    document.getElementById('btn-map-layers')?.classList.remove('active');
    if (_layersOnOutside) {
      document.removeEventListener('mousedown', _layersOnOutside, true);
      _layersOnOutside = null;
    }
  }

  return { toggle, close, geomSVG };

})();
