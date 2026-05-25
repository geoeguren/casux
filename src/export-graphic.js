/**
 * export-graphic.js — Modal de salida gráfica unificada (JPEG / PDF)
 *
 * Expone: window.EXPORT_GRAPHIC.open()
 * Depende de: export-utils.js, export-canvas.js, export-jpeg.js, export-pdf.js
 *
 * Secciones del modal (orden):
 *   1. Formato (dropdown)
 *   2. Mapa base (dropdown)
 *   3. Interfaz (checkboxes)
 *   4. Posición de la leyenda (miniatura + 6 botones: 4 esquinas + 2 mid)
 *   5. Footer: botón Descargar
 */

window.EXPORT_GRAPHIC = (() => {

  const _c = () => window.EXPORT_CANVAS;
  const _t = (k, fb) => window.I18N?.t?.(k) || fb || k;

  const MODAL_ID         = 'graphic-export-modal';
  const BACKDROP_ID      = 'graphic-export-backdrop';
  const MAX_FEATURES_PDF = 5000;  // sincronizado con export-pdf.js

  // Dimensiones internas del canvas de miniatura (proporción A4)
  const PREVIEW_W = 210;
  const PREVIEW_H = 297;

  // 6 posiciones reales: 4 esquinas + 2 centros verticales (mid)
  // Coinciden exactamente con las que usan export-canvas y export-pdf
  const POSICIONES = [
    { id: 'top-left',     label: () => _t('graphic_pos_tl', 'Arriba a la izquierda') },
    { id: 'top-right',    label: () => _t('graphic_pos_tr', 'Arriba a la derecha')   },
    { id: 'mid-left',     label: () => _t('graphic_pos_ml', 'Centro a la izquierda') },
    { id: 'mid-right',    label: () => _t('graphic_pos_mr', 'Centro a la derecha')   },
    { id: 'bottom-left',  label: () => _t('graphic_pos_bl', 'Abajo a la izquierda')  },
    { id: 'bottom-right', label: () => _t('graphic_pos_br', 'Abajo a la derecha')    },
  ];

  // formatoInicial: 'jpeg' | 'pdf' — si se pasa, preselecciona ese formato
  function open(formatoInicial) {
    const mapInst = window.MAP?.getInstance();
    if (!mapInst) { window.TOAST?.warning(_t('export_no_map')); return; }

    const activeLayers = window.MAP.getActiveLayers();
    if (!Object.keys(activeLayers).length) {
      window.TOAST?.warning(_t('export_no_layers'));
      return;
    }

    document.getElementById(MODAL_ID)?.remove();
    document.getElementById(BACKDROP_ID)?.remove();

    const curBase = window.MAP.getCurrentBase?.() || 'gray';

    let _selectedBase = curBase;
    let _leyenda      = true;
    let _leyendaPos   = 'auto';
    let _formato      = (formatoInicial === 'pdf') ? 'pdf' : 'jpeg';

    // Opciones de formato — misma estructura que basemap (label + hint)
    const formatoDefs = [
      { key: 'jpeg', label: _t('export_opt_jpeg', 'Imagen'),           hint: 'jpeg' },
      { key: 'pdf',  label: _t('export_opt_pdf',  'Archivo portable'), hint: 'pdf'  },
    ];

    const basemapDefs = [
      { key: 'gray',    label: _t('basemap_gray',    'Positron'),    hint: _t('basemap_hint_gray',    'light') },
      { key: 'dark',    label: _t('basemap_dark',    'Dark Matter'), hint: _t('basemap_hint_dark',    'dark')  },
      { key: 'voyager', label: _t('basemap_voyager', 'Voyager'),     hint: _t('basemap_hint_voyager', 'color') },
    ];

    // HTML de dropdown genérico — mismo patrón que export-html.js
    function _dropdownHTML(idPrefix, defs, selectedKey) {
      return `
        <div class="adv-ramp-csel adv-field-csel" id="${idPrefix}-csel">
          <div class="adv-ramp-trigger adv-field-trigger" id="${idPrefix}-trigger">
            <span class="adv-field-selected" id="${idPrefix}-val">
              ${defs.find(d => d.key === selectedKey)?.label || defs[0].label}
            </span>
            <span class="adv-ramp-arrow">▾</span>
          </div>
          <div class="adv-ramp-dropdown hidden" id="${idPrefix}-dd">
            ${defs.map(d => `
              <div class="adv-ramp-option adv-field-option${d.key === selectedKey ? ' selected' : ''}"
                   data-key="${d.key}">
                <span class="adv-ramp-option-label">${d.label}</span>
                ${d.hint ? `<span class="adv-ramp-option-label--mono">${d.hint}</span>` : ''}
              </div>`).join('')}
          </div>
        </div>`;
    }

    // Botones de posición — uno por posición real, posicionados via CSS
    const posSquaresHTML = POSICIONES.map(p => `
      <button class="graphic-pos-btn"
              data-pos="${p.id}"
              data-tooltip="${p.label()}"
              aria-label="${p.label()}">
      </button>`).join('');

    const backdrop = document.createElement('div');
    backdrop.id        = BACKDROP_ID;
    backdrop.className = 'adv-modal-backdrop';
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id        = MODAL_ID;
    modal.className = 'adv-modal';

    modal.innerHTML = `
      <div class="adv-modal-header">
        <span class="adv-modal-title">${_t('graphic_modal_title', 'Salida gráfica')}</span>
        <button class="popup-close-btn" id="graphic-modal-close">
          <span class="material-icons">close</span>
        </button>
      </div>
      <div class="adv-modal-body" style="gap:0">

        <!-- Formato — primero -->
        <div class="adv-body-row">
          <span class="adv-body-label">${_t('graphic_formato', 'Formato')}</span>
          ${_dropdownHTML('graphic-formato', formatoDefs, _formato)}
        </div>

        <!-- Mapa base -->
        <div class="adv-body-row">
          <span class="adv-body-label">${_t('graphic_basemap', 'Mapa base')}</span>
          ${_dropdownHTML('graphic-basemap', basemapDefs, curBase)}
        </div>

        <!-- Leyenda -->
        <div class="adv-body-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <label class="pfc-row" style="padding:5px 0;cursor:pointer">
            <input type="checkbox" id="graphic-leyenda" checked />
            <span class="pfc-label" style="font-family:var(--font-sans);font-size:13px;color:var(--cream)">
              ${_t('graphic_leyenda', 'Leyenda')}
            </span>
          </label>
          <!-- Posición de la leyenda — se deshabilita si el checkbox está desactivado -->
          <div class="adv-body-row" id="graphic-legend-pos-row" style="padding:0;margin-top:2px">
            <span class="adv-body-label">${_t('graphic_legend_pos', 'Posición de la leyenda')}</span>
            <div class="graphic-preview-wrap">
              <canvas id="graphic-preview-canvas"
                      width="${PREVIEW_W}"
                      height="${PREVIEW_H}">
              </canvas>
              ${posSquaresHTML}
            </div>
          </div>
        </div>

      </div>
      <div class="adv-modal-footer" style="flex-direction:column;align-items:stretch;gap:6px;border-top:0.5px solid var(--border)">
        <span class="graphic-export-warn hidden" id="graphic-export-warn">
          <span class="material-icons" style="font-size:13px;vertical-align:-2px;margin-right:4px">block</span>
          <span id="graphic-export-warn-text"></span>
        </span>
        <div style="display:flex;justify-content:flex-end">
          <button class="adv-footer-btn adv-accept" id="graphic-download-btn">
            ${_t('graphic_download', 'Descargar')}
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    function closeModal() {
      modal.remove();
      backdrop.remove();
      document.removeEventListener('keydown', _onKeyDown);
      mapInst.off('moveend', _redrawPreview);
    }
    function _onKeyDown(e) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', _onKeyDown);
    modal.querySelector('#graphic-modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);

    // Wire dropdown genérico
    function _wireDropdown(idPrefix, onChange) {
      const trigger = modal.querySelector(`#${idPrefix}-trigger`);
      const dd      = modal.querySelector(`#${idPrefix}-dd`);
      const arrow   = trigger?.querySelector('.adv-ramp-arrow');
      const val     = modal.querySelector(`#${idPrefix}-val`);

      trigger?.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = !dd.classList.contains('hidden');
        // Cerrar todos primero
        modal.querySelectorAll('.adv-ramp-dropdown').forEach(d => {
          d.classList.add('hidden');
          d.previousElementSibling?.querySelector('.adv-ramp-arrow')?.classList.remove('open');
        });
        if (!isOpen) {
          dd.classList.remove('hidden');
          arrow?.classList.add('open');
        }
      });

      dd?.querySelectorAll('.adv-field-option').forEach(opt => {
        opt.addEventListener('click', e => {
          e.stopPropagation();
          dd.querySelectorAll('.adv-field-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          const key = opt.dataset.key;
          if (val) val.textContent = opt.querySelector('.adv-ramp-option-label').textContent;
          dd.classList.add('hidden');
          arrow?.classList.remove('open');
          onChange(key);
        });
      });
    }

    // Cerrar dropdowns al hacer click fuera
    modal.addEventListener('click', e => {
      if (!e.target.closest('.adv-ramp-csel')) {
        modal.querySelectorAll('.adv-ramp-dropdown').forEach(d => {
          d.classList.add('hidden');
          d.previousElementSibling?.querySelector('.adv-ramp-arrow')?.classList.remove('open');
        });
      }
    });

    _wireDropdown('graphic-formato', key => { _formato = key; _checkWarnings(); });
    _wireDropdown('graphic-basemap', key => {
      _selectedBase = key;
      _updatePreviewContrast(key);
      _redrawPreview();
    });

    modal.querySelector('#graphic-leyenda')?.addEventListener('change', e => {
      _leyenda = e.target.checked;
      const posRow = modal.querySelector('#graphic-legend-pos-row');
      const wrap   = modal.querySelector('.graphic-preview-wrap');
      if (!_leyenda) {
        // Desactivar: vaciar posición elegida, desmarcar botón, deshabilitar preview
        _leyendaPos = 'auto';
        modal.querySelectorAll('.graphic-pos-btn').forEach(b => b.classList.remove('selected'));
        if (posRow) posRow.style.opacity = '0.38';
        if (posRow) posRow.style.pointerEvents = 'none';
        if (wrap)   wrap.style.filter = 'grayscale(1)';
      } else {
        // Reactivar: habilitar preview y redibujar
        if (posRow) posRow.style.opacity = '';
        if (posRow) posRow.style.pointerEvents = '';
        if (wrap)   wrap.style.filter = '';
        _redrawPreview();
      }
    });


    modal.querySelectorAll('.graphic-pos-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        modal.querySelectorAll('.graphic-pos-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _leyendaPos = btn.dataset.pos;
      });
    });

    modal.querySelector('#graphic-download-btn')?.addEventListener('click', () => {
      const opciones = {
        leyenda:    _leyenda,
        leyendaPos: _leyendaPos,
        basemap:    _selectedBase,
      };
      closeModal();
      if (_formato === 'jpeg') {
        window.EXPORT.toJPEG(opciones);
      } else {
        window.EXPORT.toPDF(opciones);
      }
    });

    // Ajustar contraste inicial de los botones según el basemap actual
    _updatePreviewContrast(curBase);
    _checkWarnings();

    // requestAnimationFrame garantiza que el browser pintó el DOM
    // antes de intentar dibujar en el canvas
    requestAnimationFrame(() => _redrawPreview());

    // Sincronizar previa con el visor: si el mapa se mueve mientras el modal
    // está abierto (p.ej. botón "Centrar en feature" del popup), redibujar.
    mapInst.on('moveend', _redrawPreview);

    // Actualiza la clase del preview-wrap según la luminosidad del basemap
    // para que los botones de posición contrasten correctamente.
    // dark → botones claros; gray/voyager → botones oscuros.
    function _updatePreviewContrast(base) {
      const wrap = modal.querySelector('.graphic-preview-wrap');
      if (!wrap) return;
      wrap.classList.toggle('graphic-preview--dark', base === 'dark');
    }

    // Evalúa si el estado actual permite la exportación.
    // Muestra el aviso inline y deshabilita el botón si no.
    function _checkWarnings() {
      const warnEl   = modal.querySelector('#graphic-export-warn');
      const warnText = modal.querySelector('#graphic-export-warn-text');
      const btn      = modal.querySelector('#graphic-download-btn');
      if (!warnEl || !btn) return;

      const mapInst = window.MAP?.getInstance();
      let msg = null;

      if (mapInst) {
        const b    = mapInst.getBounds();
        const dLng = b.getEast()  - b.getWest();
        const dLat = b.getNorth() - b.getSouth();
        if (dLng > 120 || dLat > 100) {
          msg = _t('export_area_too_large', 'El área es demasiado grande. Hacé zoom e intentalo nuevamente.');
        }

        if (!msg && _formato === 'pdf') {
          const activeLayers  = window.MAP.getActiveLayers?.() || {};
          const totalFeatures = Object.values(activeLayers)
            .reduce((sum, l) => sum + (l.geojson?.features?.length || 0), 0);
          if (totalFeatures > MAX_FEATURES_PDF) {
            const raw = _t('export_pdf_too_many_features', '');
            msg = raw.replace('{n}', totalFeatures).replace('{max}', MAX_FEATURES_PDF);
          }
        }
      }

      const hasWarn = !!msg;
      warnEl.classList.toggle('hidden', !hasWarn);
      if (warnText && msg) warnText.textContent = msg;
      btn.disabled = hasWarn;
      btn.style.opacity = hasWarn ? '0.4' : '';
    }

    // Redibuja la miniatura — async porque descarga tiles reales.
    // Evita redraws simultáneos con un flag.
    let _previewBusy = false;
    let _previewPending = false;

    async function _redrawPreview() {
      if (_previewBusy) { _previewPending = true; return; }
      _previewBusy = true;
      const wrap   = modal.querySelector('.graphic-preview-wrap');
      const canvas = modal.querySelector('#graphic-preview-canvas');
      if (!canvas) { _previewBusy = false; return; }
      // Spinner: reducir opacidad del canvas mientras carga
      if (wrap) wrap.style.opacity = '0.5';
      try {
        await _c().drawMiniPreview(canvas, activeLayers, _selectedBase);
      } catch (e) {
        console.warn('[EXPORT_GRAPHIC] drawMiniPreview error:', e.message);
      } finally {
        if (wrap) wrap.style.opacity = '1';
        _previewBusy = false;
        if (_previewPending) {
          _previewPending = false;
          _redrawPreview();
        }
      }
    }
  }

  return { open };

})();
