/**
 * layers-panel-style.js — Acordeón de estilo simple y controles clasificados
 *
 * Expone: window.LP_STYLE
 * Depende de: window.LP_UTILS (layers-panel-utils.js)
 * Debe cargarse ANTES de layers-panel.js
 *
 * Contiene: styleControlsHTML, toggleEditAccordion, closeEditAccordion,
 *           wireStyleControls, applySimpleStyle,
 *           buildCatItems, wireClassifiedControls
 */

window.LP_STYLE = (() => {

  const { esc, leaRow, toHex, colorPickerHTML, buildDashSelect, wireCsel, getCselValue, wireSliderTouch, geomSVG } = window.LP_UTILS;

  // ── Estado del acordeón ───────────────────────────────────────

  let _activeEditKey = null;

  function closeEditAccordion(sec) {
    const open = sec?.querySelector('.layer-edit-accordion');
    if (open) open.remove();
    const btn = sec?.querySelector(`.layer-edit-btn[data-key="${_activeEditKey}"]`);
    if (btn) btn.classList.remove('active');
    _activeEditKey = null;
  }

  // ── Constructores de HTML de controles ───────────────────────

  function _buildShapeCsel(shape, id) {
    const opts = [
      { val: 'circle',   label: t('shape_circle'),   prefix: '<span class="material-icons" style="font-size:13px;vertical-align:-2px;pointer-events:none">circle</span>' },
      { val: 'square',   label: t('shape_square'),  prefix: '<span class="material-icons" style="font-size:13px;vertical-align:-2px;pointer-events:none">square</span>' },
    ];
    const cur = opts.find(o => o.val === shape) || opts[0];
    return `
      <div class="adv-ramp-csel adv-field-csel lea-shape-csel" id="${id}" style="width:100%">
        <div class="adv-ramp-trigger adv-field-trigger lea-shape-trigger" style="cursor:pointer">
          <span class="adv-field-selected lea-shape-val" style="display:flex;align-items:center;gap:5px">
            ${cur.prefix} ${cur.label}
          </span>
          <span class="adv-ramp-arrow">▾</span>
        </div>
        <div class="adv-ramp-dropdown hidden lea-shape-dd">
          ${opts.map(o => `
            <div class="adv-ramp-option adv-field-option lea-shape-opt${o.val === shape ? ' selected' : ''}" data-shape="${o.val}" style="display:flex;align-items:center;gap:6px">
              ${o.prefix}
              <span class="adv-ramp-option-label">${o.label}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function wireShapeCsel(container, onChange) {
    const csel = container.querySelector('.lea-shape-csel');
    if (!csel) return;
    const trigger = csel.querySelector('.lea-shape-trigger');
    const dd      = csel.querySelector('.lea-shape-dd');
    const valEl   = csel.querySelector('.lea-shape-val');
    const opts = [
      { val: 'circle',   label: t('shape_circle'),   prefix: '<span class="material-icons" style="font-size:13px;vertical-align:-2px;pointer-events:none">circle</span>' },
      { val: 'square',   label: t('shape_square'),  prefix: '<span class="material-icons" style="font-size:13px;vertical-align:-2px;pointer-events:none">square</span>' },
    ];
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const open = !dd.classList.contains('hidden');
      document.querySelectorAll('.lea-shape-dd').forEach(d => d.classList.add('hidden'));
      document.querySelectorAll('.lea-shape-trigger .adv-ramp-arrow').forEach(a => a.classList.remove('open'));
      if (!open) {
        dd.classList.remove('hidden');
        trigger.querySelector('.adv-ramp-arrow').classList.add('open');
      }
    });
    csel.querySelectorAll('.lea-shape-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const shape = opt.dataset.shape;
        const found = opts.find(o => o.val === shape);
        if (found) valEl.innerHTML = `${found.prefix} ${found.label}`;
        csel.querySelectorAll('.lea-shape-opt').forEach(o => o.classList.toggle('selected', o.dataset.shape === shape));
        dd.classList.add('hidden');
        trigger.querySelector('.adv-ramp-arrow').classList.remove('open');
        onChange(shape);
      });
    });
    document.addEventListener('click', () => {
      dd.classList.add('hidden');
      trigger.querySelector('.adv-ramp-arrow')?.classList.remove('open');
    });
  }

  function styleControlsHTML(geom, s, mapKey, prefix = '', noColors = false) {
    let rows = '';
    const p = prefix ? `data-prefix="${prefix}"` : '';
    if (geom === 'point') {
      const shape = s.shape || 'circle';
      rows += leaRow(t('style_geometry'), _buildShapeCsel(shape, `lea-shape-csel-${mapKey || 'x'}`));
      const radius = s.radius ?? 5;
      rows += leaRow(t('style_size'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="radius" ${p} type="range" min="1" max="25" step="0.5" value="${radius}" /><span class="lea-val">${radius}</span></div>`);
    }
    if (geom === 'line') {
      const w    = s.weight ?? 2;
      const dash = s.dashArray || 'none';
      rows += leaRow(t('style_weight'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" ${p} type="range" min="0" max="10" step="0.5" value="${w}" /><span class="lea-val">${w}</span></div>`);
      if (!noColors) rows += leaRow(t('style_color'), colorPickerHTML('color', toHex(s.color), p));
      rows += leaRow(t('style_opacity'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="opacity" ${p} type="range" min="0" max="1" step="0.05" value="${s.opacity ?? 1}" /><span class="lea-val">${Math.round((s.opacity ?? 1) * 100)}%</span></div>`);
      if (mapKey) rows += leaRow(t('style_dash'), buildDashSelect(dash, `lea-dash-${mapKey}`));
    }
    if (geom === 'point' || geom === 'polygon') {
      const w  = s.weight ?? 1.5;
      const fo = s.fillOpacity ?? 0.5;
      rows += leaRow(t('style_border_weight'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" ${p} type="range" min="0" max="10" step="0.5" value="${w}" /><span class="lea-val">${w}</span></div>`);
      if (!noColors) rows += leaRow(t('style_border_color'), colorPickerHTML('color',     toHex(s.color), p));
      if (!noColors) rows += leaRow(t('style_fill_color'),   colorPickerHTML('fillColor', toHex(s.fillColor || s.color), p));
      const foVal = Math.round(fo * 100);
      rows += leaRow(t('style_opacity'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="fillOpacity" ${p} type="range" min="0" max="1" step="0.05" value="${fo}" /><span class="lea-val">${foVal}%</span></div>`);
    }
    return rows;
  }

  // ── Acordeón ──────────────────────────────────────────────────

  function toggleEditAccordion(k, btnEl, sec) {
    if (_activeEditKey === k) { closeEditAccordion(sec); return; }
    closeEditAccordion(sec);
    _activeEditKey = k;
    btnEl.classList.add('active');

    const l = window.MAP.getActiveLayers()[k];
    if (!l) return;
    const geom = l.geomType || 'polygon';
    const s    = l.style || {};

    const acc = document.createElement('div');
    acc.className  = 'layer-edit-accordion';
    acc.dataset.key = k;

    acc.innerHTML =
      `<div class="lea-mode-content" id="lea-content-${k}"></div>` +
      `<button class="lea-advanced-btn" data-key="${k}" style="border-top:0.5px solid var(--border-md)"><span class="material-icons">biotech</span>${t('layers_advanced')}</button>` +
      `<button class="lea-delete-btn" data-key="${k}" style="border-top:0.5px solid var(--border-md)"><span class="material-icons">delete</span>${t('layers_delete_layer')}</button>`;

    const row = sec.querySelector(`.layers-data-row[data-key="${k}"]`);
    row?.insertAdjacentElement('afterend', acc);

    const contentEl = acc.querySelector(`#lea-content-${k}`);

    if (l.classification?.field) {
      // Capa clasificada: mostrar controles simples SIN colores + banner informativo.
      // Los colores se editan clase por clase en el modal avanzado.
      // Los parámetros no-color (tamaño, grosor, opacidad, geometría, etc.) se
      // pueden cambiar globalmente y se propagan a las clases que no los tengan
      // personalizados en su styleMap.
      const banner = document.createElement('div');
      banner.className = 'lea-classified-banner';
      banner.innerHTML = `
        <span class="material-icons" style="font-size:14px;flex-shrink:0;opacity:0.6">palette</span>
        <span>${t('simple_classified_color_hint')}</span>
        <button class="lea-classified-adv-btn" data-key="${k}">${t('layers_advanced')}</button>`;
      contentEl.appendChild(banner);
      banner.querySelector('.lea-classified-adv-btn')?.addEventListener('click', () => {
        window.LP_MODAL.openAdvancedModal(k, sec);
      });

      // Controles sin colores
      const controls = document.createElement('div');
      controls.innerHTML = styleControlsHTML(geom, s, k, '', true);
      contentEl.appendChild(controls);
      _wireStyleControls(controls, k, geom, sec);
      if (geom === 'line') wireCsel(controls, `lea-dash-${k}`, () => _applySimpleStyle(k, controls, sec));
    } else {
      // Render modo simple directamente
      contentEl.innerHTML = styleControlsHTML(geom, s, k);
      _wireStyleControls(contentEl, k, geom, sec);
      if (geom === 'line') wireCsel(contentEl, `lea-dash-${k}`, () => _applySimpleStyle(k, contentEl, sec));
    }

    // Botón edición avanzada → modal
    // Botón edición avanzada
    const advBtn = acc.querySelector('.lea-advanced-btn');
    if (window.MAP_CONTROLS?.isMobile?.()) {
      advBtn.disabled = true;
      advBtn.style.opacity = '0.45';
      advBtn.style.cursor  = 'not-allowed';
      // Mensaje inline bajo el botón
      const hint = document.createElement('p');
      hint.style.cssText = 'font-size:11px;color:var(--cream2);padding:2px 16px 6px;margin:0';
      hint.textContent = t('layers_advanced_mobile');
      advBtn.insertAdjacentElement('afterend', hint);
    } else {
      advBtn.addEventListener('click', () => {
        window.LP_MODAL.openAdvancedModal(k, sec);
      });
    }

    // Botón eliminar capa
    acc.querySelector('.lea-delete-btn')?.addEventListener('click', () => {
      window.MAP.removeLayer(k);
      window.MAP.updateLegend();
      closeEditAccordion(sec);
      const rowEl = sec.querySelector(`.layers-data-row[data-key="${k}"]`);
      rowEl?.remove();
      window.TOAST?.success(t('layers_delete_success'));
      const plan   = window.APP?.getCurrentPlan?.();
      const user   = window.AUTH?.currentUser();
      const chatId = window.CHAT?.getChatId?.();
      if (plan?.instrucciones) {
        plan.instrucciones = plan.instrucciones.filter(i => i.mapKey !== k);
      }
      if (user && chatId && plan) {
        window.FB.updateChat(user.uid, chatId, { lastMap: plan })
          .catch(e => console.warn('[LAYERS] Error al persistir eliminación:', e));
        window.SIDEBAR?.updateCachedChat(chatId, { lastMap: plan });
      }
    });
  }

  // ── Wire de controles simples (internos al acordeón) ─────────

  function _wireStyleControls(container, mapKey, geom, sec) {
    // Selector custom de geometría (solo puntos)
    if (geom === 'point') {
      wireShapeCsel(container, shape => {
        _applySimpleStyle(mapKey, container, sec);
      });
    }

    container.querySelectorAll('.lea-range-input').forEach(inp => {
      wireSliderTouch(inp);
      inp.addEventListener('input', e => {
        const val   = parseFloat(e.target.value);
        const prop  = e.target.dataset.prop;
        const valEl = e.target.closest('.lea-slider-wrap')?.querySelector('.lea-val');
        if (valEl) valEl.textContent = prop === 'fillOpacity' ? Math.round(val * 100) + '%' : val;
        _applySimpleStyle(mapKey, container, sec);
      });
    });
    container.querySelectorAll('.lea-color-pick').forEach(pick => {
      pick.addEventListener('input', e => {
        const val  = e.target.value;
        const prop = e.target.dataset.prop;
        e.target.closest('label').style.background = val;
        const hex = container.querySelector(`.lea-hex-input[data-prop="${prop}"]`);
        if (hex) hex.value = val.toUpperCase();
        _applySimpleStyle(mapKey, container, sec);
      });
    });
    container.querySelectorAll('.lea-hex-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const val = e.target.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          const prop   = e.target.dataset.prop;
          const swatch = container.querySelector(`.lea-color-pick[data-prop="${prop}"]`)?.closest('label');
          const pick   = container.querySelector(`.lea-color-pick[data-prop="${prop}"]`);
          if (swatch) swatch.style.background = val;
          if (pick)   pick.value = val;
          _applySimpleStyle(mapKey, container, sec);
        }
      });
      inp.addEventListener('change', e => {
        let val = e.target.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        val = val.slice(0, 7).toUpperCase();
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          e.target.value = val;
          const prop   = e.target.dataset.prop;
          const swatch = container.querySelector(`.lea-color-pick[data-prop="${prop}"]`)?.closest('label');
          const pick   = container.querySelector(`.lea-color-pick[data-prop="${prop}"]`);
          if (swatch) swatch.style.background = val;
          if (pick)   pick.value = val;
          _applySimpleStyle(mapKey, container, sec);
        }
      });
    });
  }

  async function _applySimpleStyle(mapKey, container, sec) {
    const nl = window.MAP.getActiveLayers()[mapKey];
    if (!nl) return;
    const ns = { ...nl.style };
    container.querySelectorAll('.lea-range-input').forEach(inp => {
      if (inp.dataset.prop) ns[inp.dataset.prop] = parseFloat(inp.value);
    });
    container.querySelectorAll('.lea-hex-input').forEach(inp => {
      const val = inp.value.trim();
      if (inp.dataset.prop && /^#[0-9a-fA-F]{6}$/.test(val)) ns[inp.dataset.prop] = val;
    });
    const dashCsel = getCselValue(container, `lea-dash-${mapKey}`);
    if (dashCsel) ns.dashArray = dashCsel === 'none' ? null : dashCsel;
    // Leer shape del selector custom (puntos)
    const activeShapeOpt = container.querySelector('.lea-shape-opt.selected');
    if (activeShapeOpt) ns.shape = activeShapeOpt.dataset.shape;

    if (ns.icon) window.MAP.precacheMakiIcon?.(ns.icon);

    window.MAP.updateLayerStyle(mapKey, ns);
    nl.style = ns;
    // Si hay clasificación activa, forzar un rebuild para que los nuevos valores
    // base (tamaño, grosor, opacidad) se propaguen correctamente a cada clase.
    if (nl.classification?.field) {
      window.MAP.applyClassificationFromData(mapKey, nl.classification);
      window.LP_PANEL.persistClassification(mapKey, nl.classification);

      // Detectar si alguna clase tiene overrides del parámetro que se acaba de
      // cambiar en su styleMap. Si los hay, mostrar un hint sutil para que el
      // usuario entienda por qué esas clases no reflejan el cambio global.
      const changedProps = container.querySelectorAll('.lea-range-input[data-prop]');
      const styleMap = nl.classification.styleMap || {};
      const overriddenProps = new Set();
      changedProps.forEach(inp => {
        const prop = inp.dataset.prop;
        if (!prop) return;
        Object.values(styleMap).forEach(vs => {
          if (vs[prop] !== undefined) overriddenProps.add(prop);
        });
      });
      if (activeShapeOpt) {
        Object.values(styleMap).forEach(vs => { if (vs.shape !== undefined) overriddenProps.add('shape'); });
      }

      if (overriddenProps.size > 0) {
        // Mostrar hint inline solo si no hay uno ya visible
        let hint = container.querySelector('.lea-override-hint');
        if (!hint) {
          hint = document.createElement('p');
          hint.className = 'lea-override-hint';
          container.appendChild(hint);
        }
        hint.textContent = t('simple_classified_override_hint');
      } else {
        container.querySelector('.lea-override-hint')?.remove();
      }
    }
    window.LP_PANEL.persistStyle(mapKey, ns);

    // Actualizar SVG en la fila del panel
    const rowEl = sec.querySelector(`.layers-data-row[data-key="${mapKey}"]`);
    const svg   = rowEl?.querySelector('.layer-geom-svg');
    if (svg) {
      const tmp = document.createElement('div');
      tmp.innerHTML = geomSVG({ ...nl, style: ns });
      const newSvg = tmp.firstChild;
      if (newSvg) svg.replaceWith(newSvg);
    }
    window.MAP.updateLegend();
  }

  // ── Items clasificados (categorías editables en el acordeón) ──

  function buildCatItems(container, mapKey, geom, mode) {
    const nl             = window.MAP.getActiveLayers()[mapKey];
    const classification = nl?.classification;
    if (!classification?.colorMap) return;

    const itemsEl = container.querySelector('.lea-cat-items, .lea-grad-items');
    if (!itemsEl) return;
    itemsEl.innerHTML = '';

    Object.entries(classification.colorMap).forEach(([val, color]) => {
      const baseStyle = nl.style || {};
      const valStyle  = classification.styleMap?.[val] || {};
      const s         = { ...baseStyle, ...valStyle, color, fillColor: color };

      const item = document.createElement('div');
      item.className   = 'lea-cat-item';
      item.dataset.val = val;

      let extraControls = '';
      if (geom === 'point') {
        const radius = s.radius ?? 5;
        const fo     = s.fillOpacity ?? 0.85;
        extraControls += `
          <div class="lea-cat-controls">
            <div class="lea-cat-ctrl-row">${leaRow(t('style_size'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="radius" type="range" min="1" max="25" step="0.5" value="${radius}" /><span class="lea-val">${radius}</span></div>`)}</div>
            <div class="lea-cat-ctrl-row">${leaRow(t('style_border_color'), colorPickerHTML('color', toHex(s.color)))}</div>
            <div class="lea-cat-ctrl-row">${leaRow(t('style_border_weight'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" type="range" min="0" max="10" step="0.5" value="${s.weight ?? 1.5}" /><span class="lea-val">${s.weight ?? 1.5}</span></div>`)}</div>
            <div class="lea-cat-ctrl-row">${leaRow(t('style_opacity'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="fillOpacity" type="range" min="0" max="1" step="0.05" value="${fo}" /><span class="lea-val">${Math.round(fo * 100)}%</span></div>`)}</div>
          </div>`;
      } else if (geom === 'polygon') {
        const fo = s.fillOpacity ?? 0.5;
        extraControls += `
          <div class="lea-cat-controls">
            <div class="lea-cat-ctrl-row">${leaRow(t('style_border_color'), colorPickerHTML('color', toHex(s.color)))}</div>
            <div class="lea-cat-ctrl-row">${leaRow(t('style_border_weight'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" type="range" min="0" max="10" step="0.5" value="${s.weight ?? 1.5}" /><span class="lea-val">${s.weight ?? 1.5}</span></div>`)}</div>
            <div class="lea-cat-ctrl-row">${leaRow(t('style_opacity'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="fillOpacity" type="range" min="0" max="1" step="0.05" value="${fo}" /><span class="lea-val">${Math.round(fo * 100)}%</span></div>`)}</div>
          </div>`;
      } else if (geom === 'line') {
        const fo     = s.opacity ?? 1;
        const dash   = s.dashArray || 'none';
        const dashId = `lea-dash-${mapKey}-${val}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        extraControls += `
          <div class="lea-cat-controls">
            <div class="lea-cat-ctrl-row">${leaRow(t('style_weight'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" type="range" min="0" max="10" step="0.5" value="${s.weight ?? 2}" /><span class="lea-val">${s.weight ?? 2}</span></div>`)}</div>
            <div class="lea-cat-ctrl-row">${leaRow(t('style_opacity'), `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="opacity" type="range" min="0" max="1" step="0.05" value="${fo}" /><span class="lea-val">${Math.round(fo * 100)}%</span></div>`)}</div>
            <div class="lea-cat-ctrl-row">${leaRow(t('style_dash'), buildDashSelect(dash, dashId))}</div>
          </div>`;
      }

      item.innerHTML = `
        <div class="lea-cat-item-header">
          <label class="lea-color-swatch lea-cat-swatch" style="background:${color}">
            <input class="lea-color-pick lea-cat-pick" type="color" value="${color}" data-val="${val}" />
          </label>
          <span class="lea-cat-label">${val}</span>
          <button class="lea-cat-remove" data-val="${val}" >✕</button>
          <button class="lea-cat-toggle" data-val="${val}" data-tooltip="${t('tooltip_edit_style')}"><span class="material-icons" style="font-size:14px;pointer-events:none">tune</span></button>
        </div>
        <div class="lea-cat-detail hidden">${extraControls}</div>`;

      itemsEl.appendChild(item);

      // Toggle detalle — solo uno abierto a la vez
      item.querySelector('.lea-cat-toggle').addEventListener('click', () => {
        const detail    = item.querySelector('.lea-cat-detail');
        const wasHidden = detail.classList.contains('hidden');
        itemsEl.querySelectorAll('.lea-cat-detail').forEach(d => d.classList.add('hidden'));
        itemsEl.querySelectorAll('.lea-cat-toggle').forEach(b => b.classList.remove('open'));
        if (wasHidden) {
          detail.classList.remove('hidden');
          item.querySelector('.lea-cat-toggle').classList.add('open');
          _wireItemControls(item, val);
        }
      });

      // Color del swatch (relleno) — siempre visible
      item.querySelector('.lea-cat-pick').addEventListener('input', e => {
        const newColor = e.target.value;
        e.target.closest('label').style.background = newColor;
        _updateValStyle(nl, mapKey, val, { fillColor: newColor, color: newColor });
      });

      // Eliminar valor
      item.querySelector('.lea-cat-remove').addEventListener('click', () => {
        if (nl.classification?.colorMap) {
          delete nl.classification.colorMap[val];
          if (nl.classification.styleMap) delete nl.classification.styleMap[val];
          window.MAP.applyClassificationFromData(mapKey, nl.classification);
          window.LP_PANEL.persistClassification(mapKey, nl.classification);
          buildCatItems(container, mapKey, geom, mode);
        }
      });
    });
  }

  function _wireItemControls(item, val) {
    if (item.dataset.wired) return;
    item.dataset.wired = '1';

    const mapKey = item.closest('[data-key]')?.dataset.key || '';
    const nl     = window.MAP.getActiveLayers()[mapKey];

    // Wire dash selector si existe (líneas)
    const dashId = `lea-dash-${mapKey}-${val}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    wireCsel(item, dashId, (dashVal) => {
      _updateValStyle(nl, mapKey, val, { dashArray: dashVal === 'none' ? null : dashVal });
    });

    item.querySelectorAll('.lea-range-input').forEach(inp => {
      wireSliderTouch(inp);
      inp.addEventListener('input', e => {
        const prop  = e.target.dataset.prop;
        const v     = parseFloat(e.target.value);
        const valEl = e.target.closest('.lea-slider-wrap')?.querySelector('.lea-val');
        if (valEl) valEl.textContent = (prop === 'fillOpacity' || prop === 'opacity') ? Math.round(v * 100) + '%' : v;
        _updateValStyle(nl, mapKey, val, { [prop]: v });
      });
    });
    item.querySelectorAll('.lea-color-pick:not(.lea-cat-pick)').forEach(pick => {
      pick.addEventListener('input', e => {
        const prop = e.target.dataset.prop;
        e.target.closest('label').style.background = e.target.value;
        const hex = item.querySelector(`.lea-hex-input[data-prop="${prop}"]`);
        if (hex) hex.value = e.target.value.toUpperCase();
        _updateValStyle(nl, mapKey, val, { [prop]: e.target.value });
      });
    });
    item.querySelectorAll('.lea-hex-input').forEach(inp => {
      inp.addEventListener('change', e => {
        let v = e.target.value.trim();
        if (!v.startsWith('#')) v = '#' + v;
        v = v.slice(0, 7).toUpperCase();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
          e.target.value = v;
          const prop   = e.target.dataset.prop;
          const swatch = item.querySelector(`.lea-color-pick[data-prop="${prop}"]`)?.closest('label');
          const pick   = item.querySelector(`.lea-color-pick[data-prop="${prop}"]`);
          if (swatch) swatch.style.background = v;
          if (pick)   pick.value = v;
          _updateValStyle(nl, mapKey, val, { [prop]: v });
        }
      });
    });
  }

  function _updateValStyle(nl, mapKey, v, changes) {
    if (!nl.classification) return;
    if (!nl.classification.styleMap) nl.classification.styleMap = {};
    nl.classification.styleMap[v] = { ...(nl.classification.styleMap[v] || nl.style || {}), ...changes };
    if (changes.fillColor) nl.classification.colorMap[v] = changes.fillColor;
    window.MAP.applyClassificationFromData(mapKey, nl.classification);
    window.LP_PANEL.persistClassification(mapKey, nl.classification);
  }

  // ── Wire de controles clasificados ────────────────────────────

  function wireClassifiedControls(container, mapKey, geom, sec, mode, palId) {
    function applyClassification() {
      const field   = container.querySelector('.lea-field-select')?.value;
      const palette = getCselValue(container, palId) || 'qualitative';
      const method  = container.querySelector('.lea-method-select')?.value || 'jenks';
      const classes = parseInt(container.querySelector('.lea-classes-input')?.value || 5);
      if (!field) return;
      window.MAP.applyClassification(mapKey, { type: mode, field, palette, method, classes,
        paletteColors: window.PALETTES[palette] });
      const nl = window.MAP.getActiveLayers()[mapKey];
      window.LP_PANEL.persistClassification(mapKey, nl?.classification);
      buildCatItems(container, mapKey, geom, mode);
    }

    container.querySelector('.lea-field-select')?.addEventListener('change', applyClassification);
    container.querySelector('.lea-method-select')?.addEventListener('change', applyClassification);
    container.querySelector('.lea-classes-input')?.addEventListener('input', e => {
      const valEl = e.target.closest('.lea-slider-wrap')?.querySelector('.lea-val');
      if (valEl) valEl.textContent = e.target.value;
      applyClassification();
    });

    if (container.querySelector('.lea-field-select')?.value) applyClassification();
  }

  return {
    closeEditAccordion,
    toggleEditAccordion,
    styleControlsHTML,
    buildCatItems,
    wireClassifiedControls
  };

})();
