/**
 * layers-panel-utils.js — Helpers compartidos del panel de capas
 *
 * Expone: window.LP_UTILS
 * Debe cargarse ANTES de layers-panel-style.js, layers-panel-modal.js y layers-panel.js
 *
 * Contiene: esc, geomSVG, leaRow, toHex, wireSliderTouch,
 *           colorPickerHTML, buildPaletteSelect, buildDashSelect,
 *           wireCsel, getCselValue
 */

window.LP_UTILS = (() => {

  // ── Seguridad ─────────────────────────────────────────────────

  // Escapar HTML para prevenir XSS en templates con innerHTML
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── SVG de geometría (usado en leyenda y filas de capa) ───────

  function geomSVG(l) {
    const geom        = l.geomType || 'polygon';
    const s           = l.style || {};
    const fill        = s.fillColor  || s.color   || '#888';
    const fillOpacity = s.fillOpacity ?? (geom === 'polygon' ? 0.5 : 0.85);
    const stroke      = s.color      || fill;
    const weight      = Math.min(s.weight ?? 1.5, 3);
    const opacity     = s.opacity    ?? 1;

    if (geom === 'line') {
      const dash = s.dashArray ? `stroke-dasharray="${s.dashArray}"` : '';
      return `<svg class="layer-geom-svg" viewBox="0 0 14 14" width="14" height="14">
        <line x1="1" y1="7" x2="13" y2="7"
          stroke="${stroke}" stroke-width="${weight * 1.5}"
          stroke-opacity="${opacity}" stroke-linecap="round" ${dash}/>
      </svg>`;
    }
    if (geom === 'point') {
      const shape = s.shape || 'circle';
      if (s.icon) {
        const cached    = window._makiSvgCache?.[s.icon]?.svgRaw;
        const iconColor = s.iconColor || '#ffffff';
        const uid       = `geom-svg-icon-${s.icon}-${Math.random().toString(36).slice(2,7)}`;
        let iconSvg;
        if (cached) {
          iconSvg = cached
            .replace(/\bwidth="[^"]*"/, 'width="10"')
            .replace(/\bheight="[^"]*"/, 'height="10"')
            .replace(/\bfill="[^"]*"/g, `fill="${iconColor}"`)
            .replace('<svg', `<svg fill="${iconColor}"`);
        } else {
          iconSvg = `<circle cx="5" cy="5" r="3" fill="${iconColor}" opacity="0.35"/>`;
          window.MAP?.precacheMakiIcon?.(s.icon)?.then?.(raw => {
            if (!raw) return;
            document.querySelectorAll(`[data-geom-uid="${uid}"]`).forEach(el => {
              const colored = raw
                .replace(/\bwidth="[^"]*"/, 'width="10"')
                .replace(/\bheight="[^"]*"/, 'height="10"')
                .replace(/\bfill="[^"]*"/g, `fill="${iconColor}"`)
                .replace('<svg', `<svg fill="${iconColor}"`);
              const g = el.querySelector('g');
              if (g) g.innerHTML = colored;
            });
          });
        }
        const bgShape = shape === 'square'
          ? `<rect x="1" y="1" width="12" height="12" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${weight}" stroke-opacity="${opacity}"/>`
          : `<circle cx="7" cy="7" r="6" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${weight}" stroke-opacity="${opacity}"/>`;
        return `<svg class="layer-geom-svg" viewBox="0 0 14 14" width="14" height="14" data-geom-uid="${uid}">
          ${bgShape}
          <g transform="translate(2,2)">${iconSvg}</g>
        </svg>`;
      }
      if (shape === 'square') {
        return `<svg class="layer-geom-svg" viewBox="0 0 14 14" width="14" height="14">
          <rect x="1" y="1" width="12" height="12"
            fill="${fill}" fill-opacity="${fillOpacity}"
            stroke="${stroke}" stroke-width="${weight}" stroke-opacity="${opacity}"/>
        </svg>`;
      }
      // círculo (default)
      return `<svg class="layer-geom-svg" viewBox="0 0 14 14" width="14" height="14">
        <circle cx="7" cy="7" r="5"
          fill="${fill}" fill-opacity="${fillOpacity}"
          stroke="${stroke}" stroke-width="${weight}"
          stroke-opacity="${opacity}"/>
      </svg>`;
    }
    // polígono
    return `<svg class="layer-geom-svg" viewBox="0 0 14 14" width="14" height="14">
      <rect x="1" y="1" width="12" height="12" rx="2"
        fill="${fill}" fill-opacity="${fillOpacity}"
        stroke="${stroke}" stroke-width="${weight}"
        stroke-opacity="${opacity}"/>
    </svg>`;
  }

  // ── Constructores de HTML ─────────────────────────────────────

  function leaRow(label, control, extraClass = '') {
    return `<div class="lea-row ${extraClass}"><span class="lea-label">${label}</span><div class="lea-control">${control}</div></div>`;
  }

  function toHex(c) {
    if (!c) return '#888888';
    if (c.startsWith('#')) {
      const h = c.slice(1);
      // Expandir hex corto: #rgb → #rrggbb, #rgba → #rrggbb (descarta alpha)
      if (h.length === 3 || h.length === 4) {
        return '#' + h[0]+h[0] + h[1]+h[1] + h[2]+h[2];
      }
      return '#' + h.slice(0, 6);
    }
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#888888';
    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }

  function colorPickerHTML(prop, hexVal, extraAttrs = '') {
    return `<div class="lea-color-row"><label class="lea-color-swatch" style="background:${hexVal}"><input class="lea-color-pick" data-prop="${prop}" ${extraAttrs} type="color" value="${hexVal}" /></label><input class="lea-hex-input" data-prop="${prop}" ${extraAttrs} type="text" maxlength="7" value="${hexVal}" /></div>`;
  }

  // ── Selector de paleta custom (dots) ──────────────────────────

  function buildPaletteSelect(keys, curPalette, id) {
    const dots = (name) => window.PALETTES[name].slice(0, 8).map(c =>
      `<span class="lea-pal-dot" style="background:${c}"></span>`
    ).join('');

    const options = keys.map(p => `
      <div class="lea-csel-option ${p === curPalette ? 'selected' : ''}" data-value="${p}">
        <div class="lea-csel-dots">${dots(p)}</div>
      </div>`).join('');

    return `<div class="lea-csel" id="${id}" data-value="${curPalette}">
      <div class="lea-csel-trigger">
        <div class="lea-csel-dots" id="${id}-preview">${dots(curPalette)}</div>
        <span class="lea-csel-arrow">▾</span>
      </div>
      <div class="lea-csel-dropdown hidden">${options}</div>
    </div>`;
  }

  // ── Selector de patrón de línea ───────────────────────────────

  function buildDashSelect(curDash, id) {
    const DASH_DEFS = [
      { v: 'none',    dasharray: '' },
      { v: '8,4',     dasharray: '8,4' },
      { v: '2,4',     dasharray: '2,4' },
      { v: '8,4,2,4', dasharray: '8,4,2,4' },
    ];

    const svgLine = (da) => `<svg viewBox="0 0 60 14" width="60" height="14" style="display:block">
      <line x1="0" y1="7" x2="60" y2="7" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" ${da ? `stroke-dasharray="${da}"` : ''}/>
    </svg>`;

    const options = DASH_DEFS.map(d => `
      <div class="lea-csel-option ${d.v === curDash ? 'selected' : ''}" data-value="${d.v}">
        <div class="lea-csel-dash-preview">${svgLine(d.dasharray)}</div>
      </div>`).join('');

    const cur = DASH_DEFS.find(d => d.v === curDash) || DASH_DEFS[0];

    return `<div class="lea-csel lea-dash-csel" id="${id}" data-value="${curDash}">
      <div class="lea-csel-trigger">
        <div class="lea-csel-dash-preview">${svgLine(cur.dasharray)}</div>
        <span class="lea-csel-arrow">▾</span>
      </div>
      <div class="lea-csel-dropdown hidden">${options}</div>
    </div>`;
  }

  // ── Wire de selectores custom (paleta / dash) ─────────────────

  function wireCsel(container, id, onChange) {
    const el = container.querySelector ? container.querySelector(`#${id}`) : document.getElementById(id);
    if (!el) return;
    const trigger  = el.querySelector('.lea-csel-trigger');
    const dropdown = el.querySelector('.lea-csel-dropdown');

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !dropdown.classList.contains('hidden');
      // Cerrar todos los dropdowns abiertos en el contenedor más cercano
      const scope = el.closest('.layer-edit-accordion') || el.closest('.adv-modal-body') || el.closest('.adv-global-wrap') || document;
      scope.querySelectorAll('.lea-csel-dropdown').forEach(d => {
        if (d !== dropdown) {
          d.classList.add('hidden');
          d.closest('.lea-csel')?.querySelector('.lea-csel-arrow')?.classList.remove('open');
        }
      });
      if (isOpen) {
        dropdown.classList.add('hidden');
        el.querySelector('.lea-csel-arrow')?.classList.remove('open');
      } else {
        dropdown.classList.remove('hidden');
        el.querySelector('.lea-csel-arrow').classList.add('open');
      }
    });

    dropdown.querySelectorAll('.lea-csel-option').forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation();
        const val = opt.dataset.value;
        el.dataset.value = val;
        dropdown.querySelectorAll('.lea-csel-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        dropdown.classList.add('hidden');
        el.querySelector('.lea-csel-arrow').classList.remove('open');

        // Actualizar preview del trigger
        const isPalette = !el.classList.contains('lea-dash-csel');
        if (isPalette) {
          const preview = el.querySelector('#' + id + '-preview');
          if (preview) preview.innerHTML = window.PALETTES[val].slice(0, 8)
            .map(c => `<span class="lea-pal-dot" style="background:${c}"></span>`).join('');
        } else {
          const preview = el.querySelector('.lea-csel-trigger .lea-csel-dash-preview');
          if (preview) preview.innerHTML = opt.querySelector('.lea-csel-dash-preview').innerHTML;
        }
        onChange(val);
      });
    });

    // Cerrar al click afuera
    document.addEventListener('click', function handler(e) {
      if (!el.contains(e.target)) {
        dropdown.classList.add('hidden');
        el.querySelector('.lea-csel-arrow')?.classList.remove('open');
      }
    }, { passive: true });
  }

  function getCselValue(container, id) {
    const el = container.querySelector ? container.querySelector(`#${id}`) : document.getElementById(id);
    return el?.dataset.value || '';
  }

  // ── Touch en sliders (móvil) ──────────────────────────────────
  //
  // Permite deslizar un <input type="range"> en móvil sin que el touch
  // propague y arrastre el acordeón que lo contiene.
  // CSS ya pone touch-action:none en .lea-range-input; aquí manejamos
  // el movimiento manualmente para actualizar el valor y disparar 'input'.

  function wireSliderTouch(inp) {
    inp.addEventListener('touchstart', e => {
      e.stopPropagation();
    }, { passive: true });

    inp.addEventListener('touchmove', e => {
      e.stopPropagation();
      const touch = e.touches[0];
      const rect  = inp.getBoundingClientRect();
      const min   = parseFloat(inp.min)  || 0;
      const max   = parseFloat(inp.max)  || 1;
      const step  = parseFloat(inp.step) || 0.01;
      const ratio = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      let val = min + ratio * (max - min);
      val = Math.round(val / step) * step;
      val = Math.max(min, Math.min(max, parseFloat(val.toFixed(10))));
      inp.value = val;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, { passive: true });
  }

  /**
   * fieldLabel(layerKey, campo)
   * Devuelve { label, isTechnical } para un campo dado.
   * isTechnical=true si no hay traducción real (label ausente o igual al campo).
   */
  /**
   * fieldLabel(layerKey, campo)
   * label presente → { label, isTechnical: false } (mostrar en sans)
   * label ausente  → { label: campo, isTechnical: true } (mostrar en mono)
   */
  function fieldLabel(layerKey, campo) {
    const attrs = window.LAYERS?.[layerKey]?.attributes || [];
    const attr  = attrs.find(a => a.campo === campo);
    const lbl   = attr?.label || '';
    return lbl
      ? { label: lbl,   isTechnical: false }
      : { label: campo, isTechnical: true  };
  }

  return {
    esc,
    geomSVG,
    leaRow,
    toHex,
    colorPickerHTML,
    buildPaletteSelect,
    buildDashSelect,
    wireCsel,
    getCselValue,
    wireSliderTouch,
    fieldLabel
  };

})();
