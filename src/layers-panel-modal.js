/**
 * layers-panel-modal.js — Modal de edición avanzada (clasificación categorizada / graduada)
 *
 * Expone: window.LP_MODAL
 * Depende de: window.LP_UTILS (layers-panel-utils.js)
 * Debe cargarse ANTES de layers-panel.js
 *
 * Contiene: openAdvancedModal y toda su lógica interna
 */

window.LP_MODAL = (() => {

  const {
    leaRow, toHex, colorPickerHTML, buildDashSelect,
    wireCsel, wireSliderTouch
  } = window.LP_UTILS;

  // Devuelve SVG inline usando caché de map.js — evita <img src="CDN"> bloqueado por CSP.
  window._makiSvgCache = window._makiSvgCache || {};

  function _makiImgHtml(iconKey, size, color) {
    const cached = window._makiSvgCache[iconKey]?.svgRaw;
    if (cached) {
      let svg = cached
        .replace(/\bwidth="[^"]*"/, `width="${size}"`)
        .replace(/\bheight="[^"]*"/, `height="${size}"`);
      if (svg.includes('fill=')) {
        svg = svg.replace(/\bfill="[^"]*"/g, `fill="${color}"`);
      } else {
        svg = svg.replace('<svg', `<svg fill="${color}"`);
      }
      return svg;
    }
    // Placeholder — usar precacheMakiIcon de map.js para centralizar todos los
    // fetches en un único sistema con deduplicación. Evita requests duplicados
    // al proxy cuando map.js y el modal piden el mismo ícono en paralelo.
    const ph = `<svg data-maki="${iconKey}" data-maki-size="${size}" data-maki-color="${color}" width="${size}" height="${size}" viewBox="0 0 15 15" xmlns="http://www.w3.org/2000/svg"><circle cx="7.5" cy="7.5" r="4" fill="${color}" opacity="0.35"/></svg>`;
    window.MAP?.precacheMakiIcon?.(iconKey)?.then?.(raw => {
      if (!raw) return;
      window._makiSvgCache[iconKey] = { svgRaw: raw, byColor: {} };
      document.querySelectorAll(`[data-maki="${iconKey}"]`).forEach(el => {
        const s = el.dataset.makiSize || size;
        const c = el.dataset.makiColor || color;
        const div = document.createElement('div');
        let svg = raw
          .replace(/\bwidth="[^"]*"/, `width="${s}"`)
          .replace(/\bheight="[^"]*"/, `height="${s}"`);
        if (svg.includes('fill=')) {
          svg = svg.replace(/\bfill="[^"]*"/g, `fill="${c}"`);
        } else {
          svg = svg.replace('<svg', `<svg fill="${c}"`);
        }
        svg = svg.replace('<svg', `<svg data-maki="${iconKey}" data-maki-size="${s}" data-maki-color="${c}"`);
        div.innerHTML = svg;
        if (div.firstChild) el.replaceWith(div.firstChild);
      });
    });
    return ph;
  }

  function openAdvancedModal(k, sec) {
    document.getElementById('adv-modal-backdrop')?.remove();
    document.getElementById('adv-modal')?.remove();

    const l = window.MAP.getActiveLayers()[k];
    if (!l) return;
    const geom          = l.geomType || 'polygon';
    const layerDef      = window.LAYERS[l.layerKey] || {};
    const attrs         = layerDef.attributes || [];
    const allFields     = attrs.filter(a => a.campo && a.visible !== false);
    const numericFields = attrs.filter(a => a.numeric);

    const initMode               = l.classification?.type || 'single';
    const initField              = l.classification?.field || (allFields[0]?.campo || '');
    const initPalette            = l.classification?.palette || null;
    const initMethod             = l.classification?.method || 'jenks';
    const initClasses            = l.classification?.classes || 5;
    let _savedClassification   = l.classification ? JSON.parse(JSON.stringify(l.classification)) : null;

    // ── Backdrop ──────────────────────────────────────────────────
    const backdrop = document.createElement('div');
    backdrop.id        = 'adv-modal-backdrop';
    backdrop.className = 'adv-modal-backdrop';
    document.body.appendChild(backdrop);

    // ── Modal shell ───────────────────────────────────────────────
    const modal = document.createElement('div');
    modal.id        = 'adv-modal';
    modal.className = 'adv-modal';

    const modes = [
      { mode: 'single',      label: t('adv_single') },
      { mode: 'categorized', label: t('adv_categorized') },
      { mode: 'graduated',   label: t('adv_graduated') },
      // TODO(heatmap): Modo heatmap — pendiente de implementación.
      // Requiere Leaflet.heat o similar. Deshabilitado hasta que se defina la estrategia
      // de pesos/intensidad por atributo y se elija la librería.
      { mode: 'heatmap',     label: t('adv_heatmap'), disabled: true },
    ];
    const pills = modes.map(b =>
      `<button class="adv-pill ${b.mode === initMode ? 'active' : ''}" data-mode="${b.mode}"
               ${b.disabled ? `disabled data-tooltip="${t('adv_coming_soon')}"` : ''}>${b.label}</button>`
    ).join('');

    modal.innerHTML = `
      <div class="adv-modal-header">
        <span class="adv-modal-title">${t('adv_modal_title')}</span>
        <button class="popup-close-btn" id="adv-close-btn"><span class="material-icons">close</span></button>
      </div>
      <div class="adv-modal-pills">${pills}</div>
      <div class="adv-modal-body" id="adv-modal-body"></div>
      <div class="adv-modal-footer">
        <button class="adv-footer-btn adv-clear" id="adv-clear-btn"
          style="${_savedClassification ? '' : 'visibility:hidden'}">${t('adv_clear')}</button>
        <div style="flex:1"></div>
        <button class="adv-footer-btn adv-cancel" id="adv-cancel-btn">${t('adv_cancel')}</button>
        <button class="adv-footer-btn adv-accept" id="adv-accept-btn">${t('adv_accept')}</button>
      </div>`;
    document.body.appendChild(modal);

    const bodyEl     = modal.querySelector('#adv-modal-body');
    let   curMode         = initMode;
    let   selPalette      = initPalette;
    let   paletteReversed = false;

    // ── Selector de rampa de color ────────────────────────────────

    // Crea el botón de invertir rampa (sync_alt)
    // onToggle: callback que se llama después de cambiar paletteReversed
    function _buildInvertBtn(onToggle) {
      const btn = document.createElement('button');
      btn.className = 'adv-ramp-invert-btn';
      btn.setAttribute('data-tooltip', t('adv_ramp_invert'));
      btn.innerHTML = '<span class="material-icons">sync_alt</span>';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        paletteReversed = !paletteReversed;
        btn.classList.toggle('active', paletteReversed);
        onToggle?.();
      });
      return btn;
    }

    function buildRampCsel(palKeys, currentPalette, onChange) {
      const wrap = document.createElement('div');
      wrap.className = 'adv-ramp-csel';

      const makeRamp = (pk) => {
        const colors = window.PALETTES[pk] || [];
        if (!colors.length) return '';
        if (pk.startsWith('seq_') || pk === 'blues' || pk === 'greens' || pk === 'oranges' || pk === 'purples' || pk === 'redblue' || pk === 'browngreen') {
          const stops = colors.join(', ');
          return `<span class="adv-ramp-bar" style="background:linear-gradient(to right,${stops})"></span>`;
        }
        const w = (100 / colors.length).toFixed(3);
        const segs = colors.map(c => `<span class="adv-ramp-seg" style="background:${c};width:${w}%"></span>`).join('');
        return `<span class="adv-ramp-bar adv-ramp-bar--cat">${segs}</span>`;
      };

      const cur = currentPalette || palKeys[0];
      wrap.innerHTML = `
        <div class="adv-ramp-trigger" id="adv-ramp-trigger-${k}">
          <div class="adv-ramp-preview">${makeRamp(cur)}</div>
          <span class="adv-ramp-arrow">▾</span>
        </div>
        <div class="adv-ramp-dropdown hidden" id="adv-ramp-dd-${k}">
          ${palKeys.map(pk => `
            <div class="adv-ramp-option ${pk === cur ? 'selected' : ''}" data-pal="${pk}">
              <div class="adv-ramp-option-ramp">${makeRamp(pk)}</div>
              <span class="adv-ramp-option-label adv-ramp-palette-label">${window.PALETTE_LABELS[pk] || pk}</span>
            </div>`).join('')}
        </div>`;

      const trigger  = wrap.querySelector(`#adv-ramp-trigger-${k}`);
      const dropdown = wrap.querySelector(`#adv-ramp-dd-${k}`);
      const arrow    = wrap.querySelector('.adv-ramp-arrow');
      const preview  = wrap.querySelector('.adv-ramp-preview');

      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = !dropdown.classList.contains('hidden');
        dropdown.classList.toggle('hidden', isOpen);
        arrow.classList.toggle('open', !isOpen);
      });

      wrap.querySelectorAll('.adv-ramp-option').forEach(opt => {
        opt.addEventListener('click', e => {
          e.stopPropagation();
          const pk = opt.dataset.pal;
          wrap.querySelectorAll('.adv-ramp-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          dropdown.classList.add('hidden');
          arrow.classList.remove('open');
          preview.innerHTML = makeRamp(pk);
          selPalette = pk;
          onChange(pk);
        });
      });

      setTimeout(() => {
        document.addEventListener('click', function handler(e) {
          if (!wrap.contains(e.target)) {
            dropdown.classList.add('hidden');
            arrow.classList.remove('open');
          }
        }, { passive: true });
      }, 0);

      return wrap;
    }

    // ── Selector de campo genérico ────────────────────────────────

    function buildFieldCsel(options, currentValue, onChange) {
      const wrap = document.createElement('div');
      wrap.className = 'adv-ramp-csel adv-field-csel';

      const noneOpt  = { value: '', label: t('adv_none_selected'), isNone: true };
      const allOpts  = [noneOpt, ...options];
      const curOpt   = currentValue ? (options.find(o => o.value === currentValue) || noneOpt) : noneOpt;
      const curLabel = curOpt?.label || curOpt?.value || t('adv_none_selected');
      const curIsTechnical = curOpt?.isTechnical ?? false;

      wrap.innerHTML = `
        <div class="adv-ramp-trigger adv-field-trigger">
          <span class="adv-field-selected${curIsTechnical ? ' adv-field-selected--mono' : ''}">${curLabel}</span>
          <span class="adv-ramp-arrow">▾</span>
        </div>
        <div class="adv-ramp-dropdown hidden adv-field-dropdown">
          <div class="adv-ramp-option adv-field-option adv-field-none ${!currentValue ? 'selected' : ''}" data-value="">
            <span class="adv-ramp-option-label" style="opacity:0.6">${t('adv_none_selected')}</span>
          </div>
          ${options.map(o => `
            <div class="adv-ramp-option adv-field-option ${o.value === currentValue ? 'selected' : ''} ${o.disabled ? 'adv-field-disabled' : ''}"
                 data-value="${o.value}">
              <span class="${o.isTechnical ? 'adv-ramp-option-label adv-ramp-option-label--mono' : 'adv-ramp-option-label'}">${o.label}</span>
              ${o.disabled ? '<span class="adv-field-badge">+12</span>' : ''}
            </div>`).join('')}
        </div>`;

      const trigger  = wrap.querySelector('.adv-field-trigger');
      const dropdown = wrap.querySelector('.adv-field-dropdown');
      const arrow    = wrap.querySelector('.adv-ramp-arrow');
      const selected = wrap.querySelector('.adv-field-selected');

      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = !dropdown.classList.contains('hidden');
        document.querySelectorAll('.adv-field-dropdown:not(.hidden), .adv-ramp-dropdown:not(.hidden)')
          .forEach(d => { d.classList.add('hidden'); d.previousElementSibling?.querySelector('.adv-ramp-arrow')?.classList.remove('open'); });
        dropdown.classList.toggle('hidden', isOpen);
        arrow.classList.toggle('open', !isOpen);
      });

      wrap.querySelectorAll('.adv-field-option:not(.adv-field-disabled)').forEach(opt => {
        opt.addEventListener('click', e => {
          e.stopPropagation();
          wrap.querySelectorAll('.adv-field-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          selected.textContent = opt.querySelector('.adv-ramp-option-label').textContent;
          dropdown.classList.add('hidden');
          arrow.classList.remove('open');
          onChange(opt.dataset.value);
        });
      });

      setTimeout(() => {
        document.addEventListener('click', function handler(e) {
          if (!wrap.contains(e.target)) {
            dropdown.classList.add('hidden');
            arrow.classList.remove('open');
          }
        }, { passive: true });
      }, 0);

      wrap.getValue = () => wrap.querySelector('.adv-field-option.selected')?.dataset.value || currentValue;
      return wrap;
    }

    function deselectRamp() {
      selPalette = null;
      modal.querySelectorAll('.adv-ramp-option').forEach(o => o.classList.remove('selected'));
      const preview = modal.querySelector('.adv-ramp-preview');
      if (preview) preview.innerHTML = '<span style="font-size:11px;color:var(--cream2);font-family:var(--font-sans)">Personalizada</span>';
    }

    // ── Preview en mapa ───────────────────────────────────────────

    async function applyPreview() {
      if (curMode === 'single') { window.MAP.clearClassification(k); return; }
      const fieldEl  = bodyEl.querySelector('.adv-field');
      const field    = fieldEl?.getValue ? fieldEl.getValue() : (fieldEl?.value || '');
      const palette  = selPalette || (curMode === 'graduated' ? 'seq_blues' : 'cat_tableau');
      const methodEl = bodyEl.querySelector('.adv-method');
      const method   = methodEl?.getValue ? methodEl.getValue() : (methodEl?.value || 'jenks');
      const classes  = parseInt(bodyEl.querySelector('.adv-classes')?.value || 5);
      if (!field) return;
      await window.MAP.applyClassification(k, {
        type: curMode, field, palette, method, classes,
        paletteColors: paletteReversed
          ? (window.PALETTES[palette] || []).slice().reverse()
          : (window.PALETTES[palette] || [])
      });
      buildCatItemsAdv();
    }

    // ── Controles globales (aplican a todas las categorías) ───────

    function updateGlobalStyle(changes) {
      const nl = window.MAP.getActiveLayers()[k];
      if (!nl) return;
      nl.style = { ...(nl.style || {}), ...changes };
      if (nl.classification?.styleMap) {
        Object.keys(nl.classification.styleMap).forEach(val => {
          nl.classification.styleMap[val] = { ...nl.classification.styleMap[val], ...changes };
        });
      }
      window.MAP.applyClassificationFromData(k, nl.classification);
      window.LP_PANEL.persistStyle(k, nl.style);
      window.LP_PANEL.persistClassification(k, nl.classification);
    }

    // ── Controles globales — eliminados: tamaño, grosor, opacidad
    // ahora se editan por clase individual en el detalle de cada categoría/intervalo.
    // Esta función queda como stub para no romper las llamadas existentes.
    function buildGlobalControls(container, geom) {
      // Sin controles globales de estilo — ver detalle de cada clase.
    }

    // ── Items editables del modal ─────────────────────────────────

    function buildCatItemsAdv() {
      const nl      = window.MAP.getActiveLayers()[k];
      const cl      = nl?.classification;
      const itemsEl = bodyEl.querySelector('.adv-cat-items, .adv-grad-items');
      if (!itemsEl || !cl?.colorMap) return;
      const isGraduated = itemsEl.classList.contains('adv-grad-items');
      itemsEl.innerHTML = '';

      Object.entries(cl.colorMap).forEach(([val, color]) => {
        const item = document.createElement('div');
        item.className   = 'adv-cat-item';
        item.dataset.val = val;

        const header = document.createElement('div');
        header.className = 'adv-cat-header';

        if (!isGraduated) {
          item.draggable = true;
          const handle = document.createElement('span');
          handle.className  = 'adv-cat-drag material-icons';
          handle.textContent = 'drag_indicator';
          handle.setAttribute('data-tooltip', t('adv_drag_reorder'));
          header.appendChild(handle);
        }

        const swatch = document.createElement('label');
        swatch.className      = 'adv-cat-swatch';
        swatch.style.background = color;
        const pick = document.createElement('input');
        pick.type  = 'color';
        pick.value = color;
        pick.addEventListener('input', e => {
          const c = e.target.value;
          swatch.style.background = c;
          deselectRamp();
          updateCatColor(val, c);
        });
        swatch.appendChild(pick);

        const nameInput = document.createElement('input');
        nameInput.type             = 'text';
        nameInput.className        = 'adv-cat-name';
        nameInput.value            = val;
        nameInput.dataset.original = val;
        nameInput.addEventListener('focus', () => { nameInput.dataset.original = nameInput.value; });
        nameInput.addEventListener('blur', () => {
          const newName = nameInput.value.trim();
          const orig    = nameInput.dataset.original;
          if (!newName) { nameInput.value = orig; return; }
          if (newName === orig) return;
          renameCatValue(orig, newName);
        });
        nameInput.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { e.preventDefault(); nameInput.blur(); }
          if (e.key === 'Escape') { nameInput.value = nameInput.dataset.original; nameInput.blur(); }
        });

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'adv-cat-toggle';
        toggleBtn.setAttribute('data-tooltip', t('adv_edit_style'));
        toggleBtn.innerHTML = '<span class="material-icons">tune</span>';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'adv-cat-toggle adv-cat-delete';
        deleteBtn.setAttribute('data-tooltip', t('adv_delete_category'));
        deleteBtn.innerHTML = '<span class="material-icons">close</span>';
        deleteBtn.addEventListener('click', () => {
          const nl2 = window.MAP.getActiveLayers()[k];
          if (!nl2?.classification?.colorMap) return;
          delete nl2.classification.colorMap[val];
          if (nl2.classification.styleMap) delete nl2.classification.styleMap[val];
          window.MAP.applyClassificationFromData(k, nl2.classification);
          window.LP_PANEL.persistClassification(k, nl2.classification);
          buildCatItemsAdv();
        });

        header.appendChild(swatch);
        header.appendChild(nameInput);
        header.appendChild(toggleBtn);
        header.appendChild(deleteBtn);
        item.appendChild(header);

        const detail = document.createElement('div');
        detail.className = 'adv-cat-detail hidden';
        const baseStyle = nl.style || {};
        const valStyle  = cl.styleMap?.[val] || {};
        const fill      = valStyle.fillColor || color;
        const border    = valStyle.color || (geom !== 'line' ? (window.MAP.darkenHex?.(fill) || fill) : fill);
        const s         = { ...baseStyle, ...valStyle, color: border, fillColor: fill };
        detail.innerHTML = buildDetailHTML(geom, s, val);
        item.appendChild(detail);
        itemsEl.appendChild(item);

        toggleBtn.addEventListener('click', () => {
          const wasHidden = detail.classList.contains('hidden');
          itemsEl.querySelectorAll('.adv-cat-detail').forEach(d => d.classList.add('hidden'));
          itemsEl.querySelectorAll('.adv-cat-toggle').forEach(b => b.classList.remove('open'));
          if (wasHidden) {
            detail.classList.remove('hidden');
            toggleBtn.classList.add('open');
            wireDetailControls(detail, val, s);
          }
        });
      });

      // Drag-to-reorder (solo categorizado)
      if (!isGraduated) {
        let _dragSrc = null;
        itemsEl.querySelectorAll('.adv-cat-item').forEach(item => {
          item.addEventListener('dragstart', e => {
            _dragSrc = item;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => item.classList.add('adv-cat-dragging'), 0);
          });
          item.addEventListener('dragend', () => {
            item.classList.remove('adv-cat-dragging');
            itemsEl.querySelectorAll('.adv-cat-item').forEach(i => i.classList.remove('adv-cat-drag-over'));
          });
          item.addEventListener('dragover', e => {
            e.preventDefault();
            if (item === _dragSrc) return;
            itemsEl.querySelectorAll('.adv-cat-item').forEach(i => i.classList.remove('adv-cat-drag-over'));
            item.classList.add('adv-cat-drag-over');
          });
          item.addEventListener('drop', e => {
            e.preventDefault();
            if (!_dragSrc || _dragSrc === item) return;
            item.classList.remove('adv-cat-drag-over');
            const allItems = [...itemsEl.querySelectorAll('.adv-cat-item')];
            const fromIdx  = allItems.indexOf(_dragSrc);
            const toIdx    = allItems.indexOf(item);
            if (fromIdx < toIdx) itemsEl.insertBefore(_dragSrc, item.nextSibling);
            else                 itemsEl.insertBefore(_dragSrc, item);
            const nl2 = window.MAP.getActiveLayers()[k];
            if (!nl2?.classification?.colorMap) return;
            const newOrder = [...itemsEl.querySelectorAll('.adv-cat-item')].map(i => i.dataset.val);
            const oldMap   = nl2.classification.colorMap;
            const oldStyle = nl2.classification.styleMap || {};
            const newMap   = {};
            const newStyle = {};
            newOrder.forEach(v => {
              if (oldMap[v] !== undefined) newMap[v] = oldMap[v];
              if (oldStyle[v] !== undefined) newStyle[v] = oldStyle[v];
            });
            nl2.classification.colorMap  = newMap;
            nl2.classification.styleMap  = newStyle;
            window.MAP.applyClassificationFromData(k, nl2.classification);
          });
        });
      }
    }

    function renameCatValue(oldVal, newVal) {
      const nl = window.MAP.getActiveLayers()[k];
      const cl = nl?.classification;
      if (!cl?.colorMap) return;
      if (cl.colorMap.hasOwnProperty(newVal)) return;
      const color = cl.colorMap[oldVal];
      const style = cl.styleMap?.[oldVal];
      delete cl.colorMap[oldVal];
      cl.colorMap[newVal] = color;
      if (style) {
        if (!cl.styleMap) cl.styleMap = {};
        delete cl.styleMap[oldVal];
        cl.styleMap[newVal] = style;
      }
      if (cl.field && nl.geojson) {
        nl.geojson.features.forEach(f => {
          if (f.properties?.[cl.field] === oldVal) f.properties[cl.field] = newVal;
        });
      }
      window.MAP.applyClassificationFromData(k, cl);
      buildCatItemsAdv();
    }

    function buildDetailHTML(geom, s, val) {
      let rows = '';
      if (geom === 'point') {
        const r  = s.radius ?? 5;
        const w  = s.weight ?? 1.5;
        const fo = s.fillOpacity ?? 0.85;
        rows += leaRow(t('adv_fill_color'),    colorPickerHTML('fillColor', toHex(s.fillColor || s.color)));
        rows += leaRow(t('adv_border_color'),  colorPickerHTML('color',     toHex(s.color)));
        rows += leaRow(t('style_size'),
          `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="radius" type="range" min="1" max="25" step="0.5" value="${r}" /><span class="lea-val">${r}</span></div>`);
        rows += leaRow(t('style_border_weight'),
          `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" type="range" min="0" max="10" step="0.5" value="${w}" /><span class="lea-val">${w}</span></div>`);
        rows += leaRow(t('adv_opacity'),
          `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="fillOpacity" type="range" min="0" max="1" step="0.05" value="${fo}" /><span class="lea-val">${Math.round(fo * 100)}%</span></div>`);
      } else if (geom === 'polygon') {
        const w  = s.weight ?? 1.5;
        const fo = s.fillOpacity ?? 0.5;
        rows += leaRow(t('adv_fill_color'),   colorPickerHTML('fillColor', toHex(s.fillColor || s.color)));
        rows += leaRow(t('adv_border_color'), colorPickerHTML('color',     toHex(s.color)));
        rows += leaRow(t('style_border_weight'),
          `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" type="range" min="0" max="10" step="0.5" value="${w}" /><span class="lea-val">${w}</span></div>`);
        rows += leaRow(t('adv_opacity'),
          `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="fillOpacity" type="range" min="0" max="1" step="0.05" value="${fo}" /><span class="lea-val">${Math.round(fo * 100)}%</span></div>`);
      } else {
        // line
        const w    = s.weight ?? 2;
        const op   = s.opacity ?? 1;
        const dashId = `adv-detail-dash-${val}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        rows += leaRow(t('adv_color'), colorPickerHTML('color', toHex(s.color)));
        rows += leaRow(t('adv_weight'),
          `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="weight" type="range" min="0" max="10" step="0.5" value="${w}" /><span class="lea-val">${w}</span></div>`);
        rows += leaRow(t('adv_opacity'),
          `<div class="lea-slider-wrap"><input class="lea-range-input" data-prop="opacity" type="range" min="0" max="1" step="0.05" value="${op}" /><span class="lea-val">${Math.round(op * 100)}%</span></div>`);
        rows += leaRow(t('adv_line_pattern'), buildDashSelect(s.dashArray || 'none', dashId));
      }
      return rows;
    }

    function wireDetailControls(detail, val, initStyle) {
      if (detail.dataset.wired) return;
      detail.dataset.wired = '1';

      detail.querySelectorAll('.lea-color-pick').forEach(pick => {
        pick.addEventListener('input', e => {
          const prop = e.target.dataset.prop;
          e.target.closest('label').style.background = e.target.value;
          const hex = detail.querySelector(`.lea-hex-input[data-prop="${prop}"]`);
          if (hex) hex.value = e.target.value.toUpperCase();
          deselectRamp();
          updateCatValStyle(val, { [prop]: e.target.value });
        });
      });
      detail.querySelectorAll('.lea-hex-input').forEach(inp => {
        inp.addEventListener('change', e => {
          let v = e.target.value.trim();
          if (!v.startsWith('#')) v = '#' + v;
          v = v.slice(0, 7).toUpperCase();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) {
            e.target.value = v;
            const prop = e.target.dataset.prop;
            const pick = detail.querySelector(`.lea-color-pick[data-prop="${prop}"]`);
            if (pick) { pick.value = v; pick.closest('label').style.background = v; }
            deselectRamp();
            updateCatValStyle(val, { [prop]: v });
          }
        });
      });

      detail.querySelectorAll('.lea-range-input').forEach(inp => {
        wireSliderTouch(inp);
        inp.addEventListener('input', e => {
          const prop  = e.target.dataset.prop;
          const v     = parseFloat(e.target.value);
          const valEl = e.target.closest('.lea-slider-wrap')?.querySelector('.lea-val');
          if (valEl) valEl.textContent = (prop === 'fillOpacity' || prop === 'opacity') ? Math.round(v * 100) + '%' : v;
          updateCatValStyle(val, { [prop]: v });
        });
      });

      const dashId = `adv-detail-dash-${val}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      wireCsel(detail, dashId, dashVal => {
        updateCatValStyle(val, { dashArray: dashVal === 'none' ? null : dashVal });
      });
    }

    function updateCatColor(val, color) {
      const nl = window.MAP.getActiveLayers()[k];
      if (!nl?.classification) return;
      nl.classification.colorMap[val] = color;
      if (!nl.classification.styleMap) nl.classification.styleMap = {};
      nl.classification.styleMap[val] = { ...(nl.classification.styleMap[val] || nl.style || {}), fillColor: color, color };
      window.MAP.applyClassificationFromData(k, nl.classification);
      window.LP_PANEL.persistClassification(k, nl.classification);
    }

    function updateCatValStyle(val, changes) {
      const nl = window.MAP.getActiveLayers()[k];
      if (!nl?.classification) return;
      if (!nl.classification.styleMap) nl.classification.styleMap = {};
      nl.classification.styleMap[val] = { ...(nl.classification.styleMap[val] || nl.style || {}), ...changes };
      if (changes.fillColor) nl.classification.colorMap[val] = changes.fillColor;
      if (changes.color && !changes.fillColor) nl.classification.colorMap[val] = changes.color;
      window.MAP.applyClassificationFromData(k, nl.classification);
      window.LP_PANEL.persistClassification(k, nl.classification);
    }

    // ── Render de modos ───────────────────────────────────────────

    function renderAdvMode(mode) {
      curMode = mode;
      bodyEl.innerHTML = '';

      if (mode === 'single') {
        // Para capas de puntos: selector Símbolo + buscador Maki
        if (geom === 'point') {
          _buildSymbolSection(bodyEl, l, k);
        } else {
          const note = document.createElement('p');
          note.className   = 'adv-body-note';
          note.textContent = t('adv_simple_note');
          bodyEl.appendChild(note);
        }
        return;
      }

      if (mode === 'categorized') {
        if (!allFields.length) {
          const note = document.createElement('p');
          note.className   = 'adv-body-note';
          note.textContent = t('adv_no_fields');
          bodyEl.appendChild(note);
          return;
        }
        const MAX_UNIQUE = window.CLASSIFY_THRESHOLDS?.maxUnique ?? 12;

        const fieldRow   = document.createElement('div');
        fieldRow.className = 'adv-body-row';
        const fieldLabel = document.createElement('span');
        fieldLabel.className   = 'adv-body-label';
        fieldLabel.textContent = t('adv_field');
        const fieldOpts = allFields.map(a => {
          const vals = [...new Set(
            (l.geojson?.features || []).map(f => f.properties?.[a.campo]).filter(v => v != null)
          )];
          return { value: a.campo, label: a.label || a.campo, isTechnical: !a.label, disabled: vals.length > MAX_UNIQUE };
        });

        // Arrancar con el campo previo si existe, si no: ninguno seleccionado
        const initFieldEnabled = initField && fieldOpts.find(o => o.value === initField && !o.disabled);
        let curField = initFieldEnabled ? initField : '';

        const allDisabled = fieldOpts.every(o => o.disabled);

        const fieldCsel = buildFieldCsel(fieldOpts, curField, val => {
          curField = val;
          if (val) applyPreview(); // solo previsualizar si hay campo elegido
        });
        fieldCsel.classList.add('adv-field');
        fieldRow.appendChild(fieldLabel);
        fieldRow.appendChild(fieldCsel);
        bodyEl.appendChild(fieldRow);

        if (allDisabled) {
          const hint = document.createElement('p');
          hint.className = 'adv-body-note adv-all-disabled-hint';
          hint.innerHTML = `<span class="material-icons" style="font-size:13px;vertical-align:-2px;margin-right:4px">block</span>${t('adv_all_disabled', {n: MAX_UNIQUE})}`;
          bodyEl.appendChild(hint);
        }

        buildGlobalControls(bodyEl, geom);

        const rampRow   = document.createElement('div');
        rampRow.className = 'adv-body-row adv-ramp-row';
        const rampLabel = document.createElement('span');
        rampLabel.className   = 'adv-body-label';
        rampLabel.textContent = t('adv_ramp');
        const catPalKeys = Object.keys(window.CAT_PALETTES);
        const rampCsel   = buildRampCsel(catPalKeys, selPalette, () => { if (curField) applyPreview(); });
        const invertBtn  = _buildInvertBtn(() => { if (curField) applyPreview(); });
        rampRow.appendChild(rampLabel);
        const rampRowInner = document.createElement('div');
        rampRowInner.className = 'adv-ramp-row-inner';
        rampRowInner.appendChild(rampCsel);
        rampRowInner.appendChild(invertBtn);
        rampRow.appendChild(rampRowInner);
        bodyEl.appendChild(rampRow);

        const itemsWrap = document.createElement('div');
        itemsWrap.className = 'adv-cat-items';
        bodyEl.appendChild(itemsWrap);

        // Si hay clasificación previa con campo válido, mostrar categorías sin reaplicar al mapa
        if (initFieldEnabled && _savedClassification) {
          buildCatItemsAdv();
        }
        // NO llamar applyPreview() aquí — esperar que el usuario elija campo
      }

      if (mode === 'graduated') {
        if (!numericFields.length) {
          const note = document.createElement('p');
          note.className   = 'adv-body-note';
          note.textContent = t('adv_no_numeric_fields');
          bodyEl.appendChild(note);
          return;
        }

        const fieldRow   = document.createElement('div');
        fieldRow.className = 'adv-body-row';
        const fieldLabel = document.createElement('span');
        fieldLabel.className   = 'adv-body-label';
        fieldLabel.textContent = t('adv_field');
        const fieldOpts  = numericFields.map(a => ({ value: a.campo, label: a.label || a.campo, isTechnical: !a.label }));
        let curField     = initField || '';
        const fieldCsel  = buildFieldCsel(fieldOpts, curField, val => {
          curField = val;
          if (val) applyPreview();
        });
        fieldCsel.classList.add('adv-field');
        fieldRow.appendChild(fieldLabel);
        fieldRow.appendChild(fieldCsel);
        bodyEl.appendChild(fieldRow);

        const methodRow   = document.createElement('div');
        methodRow.className = 'adv-body-row';
        const methodLabel = document.createElement('span');
        methodLabel.className   = 'adv-body-label';
        methodLabel.textContent = 'Método';
        const methodOpts  = [{ v: 'jenks', l: 'Natural Breaks' }, { v: 'equal', l: 'Intervalos iguales' }, { v: 'quantile', l: 'Cuantiles' }];
        const methodDesc  = {
          jenks:    'Agrupa elementos con valores parecidos entre sí.',
          equal:    'Divide los valores en rangos del mismo tamaño.',
          quantile: 'Pone la misma cantidad de elementos en cada grupo.',
        };
        let curMethod     = initMethod;
        const methodCsel  = buildFieldCsel(
          methodOpts.map(m => ({ value: m.v, label: m.l })),
          curMethod, val => { curMethod = val; updateMethodHint(); applyPreview(); }
        );
        methodCsel.classList.add('adv-method');

        const methodHint = document.createElement('span');
        methodHint.style.cssText = 'font-size:11px;color:var(--cream2);opacity:0.7;flex:1;';

        const updateMethodHint = () => { methodHint.textContent = methodDesc[curMethod] || ''; };
        updateMethodHint();

        methodRow.appendChild(methodLabel);
        methodRow.appendChild(methodCsel);
        methodRow.appendChild(methodHint);
        bodyEl.appendChild(methodRow);

        const classesRow = document.createElement('div');
        classesRow.className = 'adv-body-row';
        classesRow.innerHTML = `<span class="adv-body-label">${t('adv_classes')}</span>
          <div class="lea-slider-wrap"><input class="lea-range-input adv-classes" type="range" min="3" max="8" step="1" value="${initClasses}" /><span class="lea-val">${initClasses}</span></div>`;
        bodyEl.appendChild(classesRow);

        buildGlobalControls(bodyEl, geom);

        const rampRow   = document.createElement('div');
        rampRow.className = 'adv-body-row adv-ramp-row';
        const rampLabel = document.createElement('span');
        rampLabel.className   = 'adv-body-label';
        rampLabel.textContent = t('adv_ramp');
        const seqPalKeys = Object.keys(window.SEQ_PALETTES);
        const rampCsel   = buildRampCsel(seqPalKeys, selPalette, () => { if (curField) applyPreview(); });
        const invertBtn  = _buildInvertBtn(() => { if (curField) applyPreview(); });
        rampRow.appendChild(rampLabel);
        const rampRowInner = document.createElement('div');
        rampRowInner.className = 'adv-ramp-row-inner';
        rampRowInner.appendChild(rampCsel);
        rampRowInner.appendChild(invertBtn);
        rampRow.appendChild(rampRowInner);
        bodyEl.appendChild(rampRow);

        const itemsWrap = document.createElement('div');
        itemsWrap.className = 'adv-grad-items';
        bodyEl.appendChild(itemsWrap);

        const classesInp = bodyEl.querySelector('.adv-classes');
        if (classesInp) wireSliderTouch(classesInp);
        bodyEl.querySelector('.adv-classes')?.addEventListener('input', e => {
          const valEl = e.target.closest('.lea-slider-wrap')?.querySelector('.lea-val');
          if (valEl) valEl.textContent = e.target.value;
          if (curField) applyPreview();
        });
        // Si hay clasificación previa con campo válido, mostrar intervalos sin reaplicar al mapa
        if (initField && _savedClassification) {
          buildCatItemsAdv();
        }
        // NO llamar applyPreview() aquí — esperar que el usuario elija campo
      }
    }

    // ── Pills (selector de modo) ──────────────────────────────────

    modal.querySelectorAll('.adv-pill:not([disabled])').forEach(pill => {
      pill.addEventListener('click', () => {
        modal.querySelectorAll('.adv-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        selPalette = initPalette;
        renderAdvMode(pill.dataset.mode);
      });
    });

    // ── Footer: cancelar / aceptar / limpiar ──────────────────────

    function closeModal() { backdrop.remove(); modal.remove(); document.removeEventListener('keydown', _onKeyModal); }
    function _onKeyModal(e) { if (e.key === 'Escape') cancelModal(); }
    document.addEventListener('keydown', _onKeyModal);

    function cancelModal() {
      if (_savedClassification) {
        window.MAP.applyClassificationFromData(k, _savedClassification);
        window.LP_PANEL.persistClassification(k, _savedClassification);
      } else {
        window.MAP.clearClassification(k);
        window.LP_PANEL.persistClassification(k, null);
      }
      closeModal();
    }

    function acceptModal() {
      // Solo regenerar la clasificación si aún no hay una aplicada.
      // Si ya existe nl.classification, el usuario puede haber editado colores
      // manualmente — llamar applyPreview() los pisaría recalculando desde la paleta.
      const nl = window.MAP.getActiveLayers()[k];
      if ((curMode === 'categorized' || curMode === 'graduated') && !nl?.classification) {
        // No hay clasificación todavía: aplicar preview y persistir de forma asíncrona
        applyPreview().then(() => {
          const nl2 = window.MAP.getActiveLayers()[k];
          window.LP_PANEL.persistClassification(k, nl2?.classification || null);
          closeModal();
        });
        return;
      }
      window.LP_PANEL.persistClassification(k, nl?.classification || null);
      closeModal();
    }

    modal.querySelector('#adv-close-btn').addEventListener('click', cancelModal);
    modal.querySelector('#adv-cancel-btn').addEventListener('click', cancelModal);
    modal.querySelector('#adv-accept-btn').addEventListener('click', acceptModal);
    modal.querySelector('#adv-clear-btn')?.addEventListener('click', () => {
      window.MAP.clearClassification(k);
      window.LP_PANEL.persistClassification(k, null);
      _savedClassification = null;
      // Volver a modo single sin cerrar el modal
      modal.querySelector('#adv-clear-btn').style.visibility = 'hidden';
      modal.querySelectorAll('.adv-pill').forEach(p => p.classList.toggle('active', p.dataset.mode === 'single'));
      renderAdvMode('single');
    });
    backdrop.addEventListener('click', cancelModal);

    renderAdvMode(initMode);
  }

  // ── Sección de símbolo SVG (modal avanzado, capas de puntos) ─

  function _buildSymbolSection(container, layer, mapKey) {
    const s       = layer.style || {};
    const lang    = window.SETTINGS?.get('lang') || 'es-419';
    const langKey = lang.startsWith('en') ? 'en' : lang.startsWith('pt') ? 'pt' : 'es';
    _buildMakiSearch(container, layer, mapKey, langKey);
  }

  function _buildMakiSearch(container, layer, mapKey, langKey) {
    const s = layer.style || {};
    const { toHex, leaRow, wireSliderTouch } = window.LP_UTILS;

    // Título
    const titleRow = document.createElement('div');
    titleRow.className = 'adv-body-row';
    titleRow.innerHTML = `<span class="adv-body-label">${t('adv_svg_title')}</span>`;
    container.appendChild(titleRow);

    const isChosen = !!s.icon;

    // Buscador — solo visible si no hay ícono elegido
    if (!isChosen) {
      const searchRow = document.createElement('div');
      searchRow.id = 'adv-maki-search-row';
      searchRow.className = 'adv-body-row';
      searchRow.innerHTML = `
        <div style="position:relative">
          <span class="material-icons" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--cream2);pointer-events:none">search</span>
          <input id="adv-maki-search" type="text"
            placeholder="${t('adv_svg_placeholder')}"
            style="width:100%;padding:6px 10px 6px 28px;background:var(--bg2);border:0.5px solid var(--border-md);border-radius:5px;color:var(--cream);font-family:var(--font-sans);font-size:13px;box-sizing:border-box" autocomplete="off"/>
        </div>
        <div id="adv-maki-results" style="display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto;padding:2px 0;margin-top:10px"></div>`;
      container.appendChild(searchRow);

      const searchInput = searchRow.querySelector('#adv-maki-search');
      const resultsEl   = searchRow.querySelector('#adv-maki-results');

      function doSearch(q) {
        resultsEl.innerHTML = '';
        if (!q || q.length < 2) return;
        const qNorm  = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const icons  = window.MAKI_ICONS || [];
        const matches = icons.filter(ic => {
          const terms = (ic[langKey] || ic.en || []).concat([ic.key]);
          return terms.some(t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(qNorm));
        }).slice(0, 40);

        matches.forEach(ic => {
          const btn = document.createElement('button');
          
          btn.style.cssText = `background:transparent;border:0.5px solid var(--border-md);border-radius:6px;padding:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;width:56px;box-sizing:border-box`;
          btn.innerHTML = `
            <div style="width:26px;height:26px;border-radius:50%;background:${s.fillColor||'#c8622a'};display:flex;align-items:center;justify-content:center">
              ${_makiImgHtml(ic.key, 14, "#ffffff")}
            </div>
            <span style="font-size:9px;color:var(--cream2);font-family:var(--font-mono);text-align:center;word-break:break-all;line-height:1.2">${ic.key}</span>`;
          btn.addEventListener('click', () => {
            window.MAP.precacheMakiIcon?.(ic.key);
            const ns = { ...layer.style, icon: ic.key };
            window.MAP.updateLayerStyle(mapKey, ns);
            layer.style = ns;
            window.LP_PANEL?.persistStyle?.(mapKey, ns);
            // Quitar buscador y mostrar controles
            searchRow.remove();
            _buildIconControls(container, layer, mapKey, langKey);
          });
          resultsEl.appendChild(btn);
        });

        if (!matches.length) {
          resultsEl.innerHTML = `<span style="font-size:12px;color:var(--cream2);padding:4px 0">${t('adv_svg_no_results', {q})}</span>`;
        }
      }

      searchInput.addEventListener('input', e => doSearch(e.target.value.trim()));
    }

    // Si ya hay ícono elegido, mostrar controles directamente (sin buscador)
    if (isChosen) {
      _buildIconControls(container, layer, mapKey, langKey);
    }
  }

  // Helper: color picker con data-icon-prop como atributo primario
  function _iconColorPicker(propName, hexVal) {
    return `<div class="lea-color-row">
      <label class="lea-color-swatch" style="background:${hexVal}">
        <input class="lea-color-pick lea-icon-pick" data-icon-prop="${propName}" type="color" value="${hexVal}"/>
      </label>
      <input class="lea-hex-input lea-icon-hex" data-icon-prop="${propName}" type="text" maxlength="7" value="${hexVal}"/>
    </div>`;
  }

  function _buildIconControls(container, layer, mapKey, langKey) {
    container.querySelector('#adv-icon-controls-wrap')?.remove();
    const s = layer.style || {};
    const { toHex, leaRow } = window.LP_UTILS;

    const wrap = document.createElement('div');
    wrap.id = 'adv-icon-controls-wrap';

    // ── Preview — refleja shape, borde y color del ícono ─────────
    const shape       = s.shape || 'circle';
    const fillColor   = s.fillColor   || '#c8622a';
    const borderColor = s.color       || 'transparent';
    const borderWidth = s.weight      ?? 0;
    const fillOpacity = s.fillOpacity ?? 0.85;
    const iconColor   = toHex(s.iconColor || '#ffffff');

    const borderRadius = shape === 'circle' ? '50%' : shape === 'square' ? '3px' : '50%';

    function _previewSvgHtml(color) {
      const cached = window._makiSvgCache?.[s.icon]?.svgRaw;
      if (!cached) return _makiImgHtml(s.icon, 16, color);
      const colored = cached
        .replace(/\bwidth="[^"]*"/, 'width="16"')
        .replace(/\bheight="[^"]*"/, 'height="16"')
        .replace(/\bfill="[^"]*"/g, `fill="${color}"`)
        .replace('<svg', `<svg fill="${color}"`);
      return colored;
    }

    const previewRow = document.createElement('div');
    previewRow.className = 'adv-body-row';
    previewRow.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <div id="adv-icon-preview-bg" style="width:30px;height:30px;border-radius:${borderRadius};background:${fillColor};opacity:${fillOpacity};border:${borderWidth}px solid ${borderColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;box-sizing:border-box">
          <div id="adv-icon-preview-svg" style="width:16px;height:16px;display:flex;align-items:center;justify-content:center">${_previewSvgHtml(iconColor)}</div>
        </div>
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--cream2);flex:1">${s.icon}</span>
        <button id="adv-maki-clear" style="background:none;border:0.5px solid var(--border-md);cursor:pointer;color:var(--cream2);font-size:11px;padding:2px 8px;border-radius:3px;font-family:var(--font-sans)">${t('adv_svg_remove')}</button>
      </div>`;
    wrap.appendChild(previewRow);

    // ── Separador — igual que entre Campo y parámetros en Categorizado ──
    const sep = document.createElement('div');
    sep.className = 'adv-global-wrap';
    sep.style.cssText = 'padding:0;margin:0';
    wrap.appendChild(sep);

    // ── Solo color del ícono ──────────────────────────────────────
    const ctrlRows = document.createElement('div');
    ctrlRows.innerHTML = leaRow(t('adv_svg_icon_color'), _iconColorPicker('iconColor', iconColor));
    wrap.appendChild(ctrlRows);
    container.appendChild(wrap);

    function applyIconStyle() {
      const ns = { ...layer.style };
      wrap.querySelectorAll('.lea-icon-pick').forEach(inp => {
        if (inp.dataset.iconProp) ns[inp.dataset.iconProp] = inp.value;
      });
      wrap.querySelectorAll('.lea-icon-hex').forEach(inp => {
        const val = inp.value.trim();
        if (inp.dataset.iconProp && /^#[0-9a-fA-F]{6}$/.test(val)) ns[inp.dataset.iconProp] = val;
      });
      window.MAP.updateLayerStyle(mapKey, ns);
      layer.style = ns;
      window.LP_PANEL?.persistStyle?.(mapKey, ns);
    }

    function updatePreviewColor(color) {
      const previewSvg = wrap.querySelector('#adv-icon-preview-svg');
      if (previewSvg) previewSvg.innerHTML = _previewSvgHtml(color);
    }

    wrap.querySelectorAll('.lea-icon-pick').forEach(inp => {
      inp.addEventListener('input', e => {
        const hex    = e.target.value;
        const row    = e.target.closest('.lea-color-row');
        const swatch = row?.querySelector('.lea-color-swatch');
        const hexInp = row?.querySelector('.lea-icon-hex');
        if (swatch) swatch.style.background = hex;
        if (hexInp) hexInp.value = hex.toUpperCase();
        if (e.target.dataset.iconProp === 'iconColor') updatePreviewColor(hex);
        applyIconStyle();
      });
    });
    wrap.querySelectorAll('.lea-icon-hex').forEach(inp => {
      inp.addEventListener('input', e => {
        const val = e.target.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          const row    = e.target.closest('.lea-color-row');
          const swatch = row?.querySelector('.lea-color-swatch');
          const pick   = row?.querySelector('.lea-icon-pick');
          if (swatch) swatch.style.background = val;
          if (pick)   pick.value = val;
          if (e.target.dataset.iconProp === 'iconColor') updatePreviewColor(val);
          applyIconStyle();
        }
      });
    });

    wrap.querySelector('#adv-maki-clear')?.addEventListener('click', () => {
      const ns = { ...layer.style, icon: null };
      window.MAP.updateLayerStyle(mapKey, ns);
      delete ns.icon;
      layer.style = ns;
      window.LP_PANEL?.persistStyle?.(mapKey, ns);
      wrap.remove();
      _buildMakiSearch._appendSearch(container, layer, mapKey, langKey);
    });
  }

  // Función auxiliar para agregar el buscador después de quitar un ícono
  _buildMakiSearch._appendSearch = function(container, layer, mapKey, langKey) {
    const s = layer.style || {};
    const { wireSliderTouch } = window.LP_UTILS;

    const searchRow = document.createElement('div');
    searchRow.id = 'adv-maki-search-row';
    searchRow.className = 'adv-body-row';
    searchRow.innerHTML = `
      <div style="position:relative">
        <span class="material-icons" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--cream2);pointer-events:none">search</span>
        <input id="adv-maki-search" type="text"
          placeholder="${t('adv_svg_placeholder')}"
          style="width:100%;padding:6px 10px 6px 28px;background:var(--bg2);border:0.5px solid var(--border-md);border-radius:5px;color:var(--cream);font-family:var(--font-sans);font-size:13px;box-sizing:border-box" autocomplete="off"/>
      </div>
      <div id="adv-maki-results" style="display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto;padding:2px 0;margin-top:10px"></div>`;
    // Insertar después del título
    const titleRow = container.querySelector('.adv-body-row');
    titleRow ? titleRow.insertAdjacentElement('afterend', searchRow) : container.appendChild(searchRow);

    const searchInput = searchRow.querySelector('#adv-maki-search');
    const resultsEl   = searchRow.querySelector('#adv-maki-results');

    function doSearch(q) {
      resultsEl.innerHTML = '';
      if (!q || q.length < 2) return;
      const qNorm = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const icons = window.MAKI_ICONS || [];
      const matches = icons.filter(ic => {
        const terms = (ic[langKey] || ic.en || []).concat([ic.key]);
        return terms.some(t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(qNorm));
      }).slice(0, 40);

      matches.forEach(ic => {
        const btn = document.createElement('button');
        
        btn.style.cssText = `background:transparent;border:0.5px solid var(--border-md);border-radius:6px;padding:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;width:56px;box-sizing:border-box`;
        btn.innerHTML = `
          <div style="width:26px;height:26px;border-radius:50%;background:${s.fillColor||'#c8622a'};display:flex;align-items:center;justify-content:center">
            ${_makiImgHtml(ic.key, 14, "#ffffff")}
          </div>
          <span style="font-size:9px;color:var(--cream2);font-family:var(--font-mono);text-align:center;word-break:break-all;line-height:1.2">${ic.key}</span>`;
        btn.addEventListener('click', () => {
          window.MAP.precacheMakiIcon?.(ic.key);
          const ns = { ...layer.style, icon: ic.key };
          window.MAP.updateLayerStyle(mapKey, ns);
          layer.style = ns;
          window.LP_PANEL?.persistStyle?.(mapKey, ns);
          searchRow.remove();
          _buildIconControls(container, layer, mapKey, langKey);
        });
        resultsEl.appendChild(btn);
      });

      if (!matches.length) {
        resultsEl.innerHTML = `<span style="font-size:12px;color:var(--cream2);padding:4px 0">${t('adv_svg_no_results', {q})}</span>`;
      }
    }

    searchInput.addEventListener('input', e => doSearch(e.target.value.trim()));
    searchInput.focus();
  };

  return { openAdvancedModal };

})();
