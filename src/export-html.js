/**
 * export-html.js
 * Depende de: export-utils.js, export-canvas.js
 */

window.EXPORT_HTML = (() => {

  const _u = () => window.EXPORT_UTILS;
  const _c = () => window.EXPORT_CANVAS;
  const _getGraticuleInterval = (...a) => _u()._getGraticuleInterval(...a);
  const _graticuleCardinals   = (...a) => _u()._graticuleCardinals(...a);
  const _formatDegLabel  = (...a) => _u()._formatDegLabel(...a);
  const getMapScale      = (...a) => _u().getMapScale(...a);
  const formatScale      = (...a) => _u().formatScale(...a);
  const _getMapMeta      = (...a) => _u()._getMapMeta(...a);
  const escHtml          = (...a) => _u().escHtml(...a);
  const downloadBlob     = (...a) => _u().downloadBlob(...a);
  const sanitizeFilename = (...a) => _u().sanitizeFilename(...a);
  const buildLegendItems = (...a) => _c().buildLegendItems(...a);
  const BASEMAP_BG_COLORS = new Proxy({}, { get: (_, k) => _c().BASEMAP_BG_COLORS[k] });


  function toHTML() {
    const mapInst = window.MAP.getInstance();
    if (!mapInst) { window.TOAST.warning(t('export_no_map')); return; }

    const activeLayers = window.MAP.getActiveLayers();
    if (!Object.keys(activeLayers).length) { window.TOAST.warning(t('export_no_layers')); return; }

    const titulo    = document.getElementById('map-title')?.value || 'Mapa';
    const BASEMAPS  = window.MAP.getBasemaps();
    const curBase   = window.MAP.getCurrentBase?.() || 'gray';

    document.getElementById('html-export-modal')?.remove();
    document.getElementById('html-export-backdrop')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id        = 'html-export-backdrop';
    backdrop.className = 'adv-modal-backdrop';
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id        = 'html-export-modal';
    modal.className = 'adv-modal';

    const layerEntries = Object.entries(activeLayers);  // [[key, layer], ...]

    // Opciones de mapa base
    const basemapDefs = [
      { key: 'gray',    label: t('basemap_gray'),    hint: t('basemap_hint_gray')    },
      { key: 'dark',    label: t('basemap_dark'),    hint: t('basemap_hint_dark')    },
      { key: 'voyager', label: t('basemap_voyager'), hint: t('basemap_hint_voyager') },
    ];

    // ── Límite de complejidad geométrica ──────────────────────
    // Las capas que superan este umbral se deshabilitan en la exportación HTML
    // porque incluir su GeoJSON inline hace el archivo demasiado pesado para el browser.
    // Métrica: vértices totales (coordenadas individuales en toda la capa).
    // Ajustar este valor según feedback real de uso.
    const HTML_EXPORT_MAX_VERTICES = 50_000;

    function countVertices(geojson) {
      return (geojson?.features || []).reduce((sum, f) => {
        // Contar pares de coordenadas: cada "[número," dentro de coordinates es un vértice
        const raw = JSON.stringify(f.geometry?.coordinates || []);
        return sum + (raw.match(/\[[-\d]/g) || []).length;
      }, 0);
    }

    // Pre-calcular complejidad por capa (una sola vez al abrir el modal)
    const layerComplexity = new Map(
      layerEntries.map(([key, l]) => [key, countVertices(l.geojson)])
    );
    const anyTooComplex = layerEntries.some(([key]) => layerComplexity.get(key) > HTML_EXPORT_MAX_VERTICES);

    // Construir HTML del selector de capas (dropdown con checkboxes)
    const layerCheckboxesHTML = layerEntries.map(([key, l]) => {
      const tooComplex = layerComplexity.get(key) > HTML_EXPORT_MAX_VERTICES;
      return `
      <label class="html-csel-chk-row${tooComplex ? ' html-layer-too-complex' : ''}"
             title="${tooComplex ? 'Geometría demasiado compleja para embeber' : ''}">
        <input type="checkbox" class="html-layer-chk" data-key="${escHtml(key)}"
               ${tooComplex ? 'disabled' : ''} />
        <span class="html-csel-chk-label">${escHtml(l.tituloUI || l.titulo || key)}</span>
        ${tooComplex ? '<span class="html-layer-complex-icon material-icons" data-tooltip="Geometría demasiado compleja">block</span>' : ''}
      </label>`;
    }).join('');

    // Construir HTML de los selectores de campos por capa
    const identifySelectorsHTML = layerEntries.map(([key, l]) => {
      // Construir mapa campo→label y conjunto de campos visibles desde el catálogo.
      // l.layerKey es la clave real en LAYERS (ej: vial_nacional_ar)
      // key es el mapKey con sufijo (ej: vial_nacional_ar_0) — no usar directamente
      const _catalogKey = l.layerKey || key.replace(/_\d+$/, '');
      const _layerAttrs = (window.LAYERS?.[_catalogKey]?.attributes || []);

      // Conjunto de campos explícitamente marcados visible:false en el catálogo.
      // Solo se ocultan los que el catálogo declara false — el resto se muestra.
      // Esto corrige el bug anterior donde EXCL_FIELDS hardcodeado excluía campos
      // como 'gna' y 'objeto' que tienen visible:true en el catálogo.
      const _catalogHiddenFields = new Set(
        _layerAttrs.filter(a => a.visible === false).map(a => a.campo)
      );

      // Si el catálogo define atributos, usar sus campos visible:true como fuente
      // canónica y preservar su orden. Si no hay catálogo, caer al geojson filtrando
      // solo campos claramente técnicos (sin label ni visible declarado).
      let geojsonFields;
      if (_layerAttrs.length > 0) {
        // Usar el catálogo como fuente de orden y visibilidad.
        // Incluir además campos del GeoJSON que no estén en el catálogo ni ocultos.
        const catalogVisible = _layerAttrs
          .filter(a => a.visible !== false)
          .map(a => a.campo);
        const catalogSet = new Set(_layerAttrs.map(a => a.campo));
        const geojsonExtra = [...new Set(
          (l.geojson?.features || []).flatMap(f =>
            Object.keys(f.properties || {}).filter(k =>
              !catalogSet.has(k) && !_catalogHiddenFields.has(k) && !k.endsWith('Type')
            )
          )
        )];
        geojsonFields = [...catalogVisible, ...geojsonExtra];
      } else {
        // Sin catálogo: mostrar todos los campos del GeoJSON salvo los que el
        // catálogo marca explícitamente como ocultos o terminan en 'Type' (técnico).
        geojsonFields = [...new Set(
          (l.geojson?.features || []).flatMap(f =>
            Object.keys(f.properties || {}).filter(k =>
              !_catalogHiddenFields.has(k) && !k.endsWith('Type')
            )
          )
        )];
      }

      // label presente → traducción real (sans), label ausente → técnico (mono)
      const _fieldLabelMap = Object.fromEntries(
        _layerAttrs.map(a => [a.campo, a.label || null])
      );
      const optionsHTML = geojsonFields.map(f => {
        const lbl = _fieldLabelMap[f];
        const labelHTML = lbl
          ? `<span class="html-csel-chk-label">${escHtml(lbl)}</span>`
          : `<span class="html-csel-chk-label html-csel-chk-label--mono">${escHtml(f)}</span>`;
        return `
        <label class="html-csel-chk-row html-field-chk-row">
          <input type="checkbox" class="html-field-chk" data-key="${escHtml(key)}" data-field="${escHtml(f)}" />
          ${labelHTML}
        </label>`;
      }).join('');

      return `
        <div class="html-identify-row" data-key="${escHtml(key)}">
          <div class="adv-ramp-csel adv-field-csel html-identify-csel html-identify-disabled" id="html-id-csel-${escHtml(key)}">
            <div class="adv-ramp-trigger adv-field-trigger html-identify-trigger">
              <span class="adv-field-selected html-id-label">${escHtml(l.tituloUI || l.titulo || key)}</span>
              <span class="adv-ramp-arrow">▾</span>
            </div>
            <div class="adv-ramp-dropdown hidden html-identify-dd">
              ${optionsHTML || '<span style="padding:8px 12px;font-size:12px;color:var(--cream2);display:block">Sin campos disponibles</span>'}
            </div>
          </div>
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="adv-modal-header">
        <span class="adv-modal-title">${t('html_modal_title')}</span>
        <button class="popup-close-btn" id="html-modal-close"><span class="material-icons">close</span></button>
      </div>
      <div class="adv-modal-body" style="gap:0">

        <!-- Mapa base -->
        <div class="adv-body-row">
          <span class="adv-body-label">${t('html_basemap')}</span>
          <div class="adv-ramp-csel adv-field-csel" id="html-basemap-csel">
            <div class="adv-ramp-trigger adv-field-trigger" id="html-basemap-trigger">
              <span class="adv-field-selected" id="html-basemap-val">${basemapDefs.find(b=>b.key===curBase)?.label||basemapDefs[0].label}</span>
              <span class="adv-ramp-arrow">▾</span>
            </div>
            <div class="adv-ramp-dropdown hidden" id="html-basemap-dd">
              ${basemapDefs.map(b=>`<div class="adv-ramp-option adv-field-option${b.key===curBase?' selected':''}" data-key="${b.key}"><span class="adv-ramp-option-label">${b.label}</span>${b.hint?`<span class="adv-ramp-option-label--mono">${b.hint}</span>`:''}</div>`).join('')}
            </div>
          </div>
        </div>

        <!-- Capas — selector con checkboxes internos -->
        <div class="adv-body-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
            <span class="adv-body-label">${t('html_layers')}</span>
          </div>
          <div class="adv-ramp-csel adv-field-csel html-layers-csel" id="html-layers-csel" style="width:100%">
            <div class="adv-ramp-trigger adv-field-trigger" id="html-layers-trigger">
              <span class="adv-field-selected" id="html-layers-summary">${t('html_layers_none')}</span>
              <span class="adv-ramp-arrow">▾</span>
            </div>
            <div class="adv-ramp-dropdown hidden" id="html-layers-dd">
              ${layerCheckboxesHTML}
            </div>
          </div>
          ${anyTooComplex ? `<span class="html-complex-hint"><span class="material-icons" style="font-size:13px;vertical-align:-2px">block</span> ${t('html_complex_hint')}</span>` : ''}
        </div>

        <!-- Consulta de elementos — un selector de campos por capa -->
        <div class="adv-body-row" style="flex-direction:column;align-items:flex-start;gap:6px">
          <span class="adv-body-label" style="margin-bottom:2px">${t('html_identify')}</span>
          <div style="display:flex;flex-direction:column;gap:6px;width:100%" id="html-identify-wrap">
            ${identifySelectorsHTML}
          </div>
        </div>

        <!-- Interfaz -->
        <div class="adv-body-row" style="gap:8px">
          <span class="adv-body-label">Interfaz</span>
          <label class="pfc-row" style="padding:5px 0">
            <input type="checkbox" id="html-legend" checked />
            <span class="pfc-label" style="font-family:var(--font-sans);font-size:13px;color:var(--cream)">${t('html_show_legend')}</span>
          </label>
          <label class="pfc-row" style="padding:5px 0">
            <input type="checkbox" id="html-zoom" checked />
            <span class="pfc-label" style="font-family:var(--font-sans);font-size:13px;color:var(--cream)">${t('html_allow_zoom')}</span>
          </label>
        </div>

        <!-- Código generado -->
        <div class="adv-body-row">
          <span class="adv-body-label">${t('html_code')}</span>
          <div id="html-code-wrapper" style="width:100%;background:#0d0d0d;border:0.5px solid rgba(226,221,212,0.18);border-radius:6px;overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;min-height:36px;background:#1a1a1a;border-bottom:0.5px solid #2a2a2a;">
              <span style="font-family:var(--font-mono);font-size:11px;color:#666">html</span>
              <div id="html-copy-area" style="display:flex;align-items:center;gap:6px;">
                <button id="html-copy-btn"  style="background:none;border:none;cursor:pointer;padding:2px;color:#888;display:flex;align-items:center;transition:color .15s;"><span class="material-icons" style="font-size:16px;pointer-events:none">content_copy</span></button>
              </div>
            </div>
            <pre id="html-code-pre" style="margin:0;padding:12px 14px;font-family:var(--font-mono);font-size:11.5px;line-height:1.65;color:#e2ddd4;overflow-x:auto;max-height:220px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;scrollbar-width:thin;scrollbar-color:#333 transparent;"><span style="color:#546e7a;font-style:italic">${t('html_code_placeholder')}</span></pre>
          </div>
        </div>

      </div>
      <div class="adv-modal-footer" style="justify-content:flex-end;gap:8px">
        <button class="adv-footer-btn adv-accept" id="html-download-btn">${t('html_download')}</button>
      </div>`;

    document.body.appendChild(modal);

    function closeModal() { modal.remove(); backdrop.remove(); document.removeEventListener('keydown', _onKeyDown); }
    function _onKeyDown(e) { if (e.key === 'Escape') closeModal(); }
    document.addEventListener('keydown', _onKeyDown);
    modal.querySelector('#html-modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);

    // ── Wire selector de mapa base ────────────────────────────

    let _selectedBase = curBase;
    const bTrigger = modal.querySelector('#html-basemap-trigger');
    const bDd      = modal.querySelector('#html-basemap-dd');
    const bArrow   = bTrigger?.querySelector('.adv-ramp-arrow');
    const bVal     = modal.querySelector('#html-basemap-val');
    bTrigger?.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !bDd.classList.contains('hidden');
      bDd.classList.toggle('hidden', isOpen);
      bArrow?.classList.toggle('open', !isOpen);
      // Cerrar otros dropdowns
      modal.querySelectorAll('.adv-ramp-dropdown:not(#html-basemap-dd)').forEach(d => {
        d.classList.add('hidden');
        d.previousElementSibling?.querySelector('.adv-ramp-arrow')?.classList.remove('open');
      });
    });
    bDd?.querySelectorAll('.adv-field-option').forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation();
        bDd.querySelectorAll('.adv-field-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        _selectedBase = opt.dataset.key;
        if (bVal) bVal.textContent = opt.querySelector('.adv-ramp-option-label').textContent;
        bDd.classList.add('hidden');
        bArrow?.classList.remove('open');
        buildAndShow();
      });
    });

    // ── Wire selector de capas ────────────────────────────────

    const layersTrigger = modal.querySelector('#html-layers-trigger');
    const layersDd      = modal.querySelector('#html-layers-dd');
    const layersArrow   = layersTrigger?.querySelector('.adv-ramp-arrow');
    const layersSummary = modal.querySelector('#html-layers-summary');

    function updateLayersSummary() {
      const checked = modal.querySelectorAll('.html-layer-chk:checked');
      layersSummary.textContent = checked.length === 0
        ? t('html_layers_none')
        : checked.length === layerEntries.length
          ? 'Todas las capas'
          : t('html_layers_selected', { n: checked.length, s: checked.length > 1 ? 's' : '' });
    }

    layersTrigger?.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !layersDd.classList.contains('hidden');
      layersDd.classList.toggle('hidden', isOpen);
      layersArrow?.classList.toggle('open', !isOpen);
      // Cerrar otros dropdowns
      modal.querySelectorAll('.adv-ramp-dropdown:not(#html-layers-dd)').forEach(d => {
        d.classList.add('hidden');
        d.previousElementSibling?.querySelector('.adv-ramp-arrow')?.classList.remove('open');
      });
    });

    // Al marcar/desmarcar una capa: habilitar/deshabilitar su selector de campos
    modal.querySelectorAll('.html-layer-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const key    = chk.dataset.key;
        const csel   = modal.querySelector(`#html-id-csel-${CSS.escape(key)}`);
        const isOn   = chk.checked;
        csel?.classList.toggle('html-identify-disabled', !isOn);
        // Habilitar/deshabilitar los checkboxes de campos de esta capa
        csel?.querySelectorAll('.html-field-chk').forEach(fc => { fc.disabled = !isOn; });
        updateLayersSummary();
        buildAndShow();
      });
    });

    // ── Wire selectores de campos por capa ───────────────────

    modal.querySelectorAll('.html-identify-csel').forEach(csel => {
      const trigger = csel.querySelector('.html-identify-trigger');
      const dd      = csel.querySelector('.html-identify-dd');
      const arrow   = trigger?.querySelector('.adv-ramp-arrow');

      trigger?.addEventListener('click', e => {
        e.stopPropagation();
        if (csel.classList.contains('html-identify-disabled')) return;
        const isOpen = !dd.classList.contains('hidden');
        // Cerrar el dropdown de capas si está abierto
        layersDd?.classList.add('hidden');
        layersArrow?.classList.remove('open');
        // Cerrar todos los otros identify dropdowns
        modal.querySelectorAll('.html-identify-dd').forEach(d => {
          if (d !== dd) {
            d.classList.add('hidden');
            d.previousElementSibling?.querySelector('.adv-ramp-arrow')?.classList.remove('open');
          }
        });
        dd.classList.toggle('hidden', isOpen);
        arrow?.classList.toggle('open', !isOpen);
      });

      // Al cambiar un campo: regenerar código
      dd?.querySelectorAll('.html-field-chk').forEach(fc => {
        fc.addEventListener('change', buildAndShow);
      });
    });

    // ── Wire leyenda y zoom ───────────────────────────────────

    modal.querySelector('#html-legend').addEventListener('change', buildAndShow);
    modal.querySelector('#html-zoom').addEventListener('change', buildAndShow);

    // ── Cerrar dropdowns al hacer click afuera ────────────────

    setTimeout(() => {
      document.addEventListener('click', function outsideHandler(e) {
        if (!modal.contains(e.target)) return;
        // No cerrar si el click fue dentro de un dropdown o en un trigger
        const insideDropdown = e.target.closest('.adv-ramp-dropdown') ||
                               e.target.closest('.html-identify-dd');
        const insideTrigger  = e.target.closest('.adv-ramp-trigger') ||
                               e.target.closest('.adv-field-trigger') ||
                               e.target.closest('.html-identify-trigger');
        if (insideDropdown || insideTrigger) return;
        modal.querySelectorAll('.adv-ramp-dropdown, .html-identify-dd').forEach(d => {
          d.classList.add('hidden');
          d.previousElementSibling?.querySelector('.adv-ramp-arrow')?.classList.remove('open');
        });
      }, { passive: true });
    }, 0);

    // ── Copy button ───────────────────────────────────────────

    function wireCopyBtn() {
      const btn = modal.querySelector('#html-copy-btn');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const raw = modal.querySelector('#html-code-wrapper')?.dataset.raw || '';
        if (!raw) return;
        navigator.clipboard?.writeText(raw).catch(() => {});
        const area = modal.querySelector('#html-copy-area');
        area.innerHTML = `
          <span class="material-icons" style="font-size:14px;color:#9abf9a;pointer-events:none">check_circle</span>
          <span style="font-family:var(--font-sans);font-size:11px;color:#9abf9a">${t('html_copied')}</span>`;
        setTimeout(() => {
          area.innerHTML = `<button id="html-copy-btn"  style="background:none;border:none;cursor:pointer;padding:2px;color:#888;display:flex;align-items:center;transition:color .15s;"><span class="material-icons" style="font-size:16px;pointer-events:none">content_copy</span></button>`;
          wireCopyBtn();
        }, 2000);
      });
    }
    wireCopyBtn();

    // ── Render del bloque de código ───────────────────────────

    function renderCodeBox(code) {
      const wrapper = modal.querySelector('#html-code-wrapper');
      wrapper.dataset.raw = code;
      // Mostrar como texto plano — el código generado contiene GeoJSON y JS
      // que rompería cualquier regex de syntax highlighting simple.
      const pre = modal.querySelector('#html-code-pre');
      pre.textContent = code;
    }

    // ── Generar código ────────────────────────────────────────

    async function buildAndShow() {
      // Capas seleccionadas
      const selectedKeys = [...modal.querySelectorAll('.html-layer-chk:checked')].map(i => i.dataset.key);

      // Campos seleccionados por capa.
      // Formato: { [layerKey]: [field1, field2, ...] }
      // Solo se incluye la capa si tiene al menos un campo marcado.
      // Si no se marcó ningún campo para una capa habilitada, esa capa no tiene consulta.
      const identifyFieldsByLayer = {};
      selectedKeys.forEach(key => {
        const csel      = modal.querySelector(`#html-id-csel-${CSS.escape(key)}`);
        const isDisabled = csel?.classList.contains('html-identify-disabled');
        if (isDisabled) return;
        const checked = [...(csel?.querySelectorAll('.html-field-chk:checked') || [])].map(c => c.dataset.field);
        if (checked.length > 0) identifyFieldsByLayer[key] = checked;
      });

      const hasIdentify = selectedKeys.some(k => !modal.querySelector(`#html-id-csel-${CSS.escape(k)}`)?.classList.contains('html-identify-disabled'));
      const allowIdentify = Object.keys(identifyFieldsByLayer).length > 0;

      const baseKey    = _selectedBase;
      const showLegend = modal.querySelector('#html-legend').checked;
      const allowZoom  = modal.querySelector('#html-zoom').checked;

      const layers = selectedKeys
        .map(k => activeLayers[k])
        .filter(Boolean)
        .map(l => ({
          key:            Object.keys(activeLayers).find(k => activeLayers[k] === l),
          titulo:         l.tituloUI || l.titulo || '',
          geomType:       l.geomType || 'polygon',
          geojson:        l.geojson,
          style:          l.style || {},
          classification: l.classification || null
        }));

      if (!layers.length) {
        const pre = modal.querySelector('#html-code-pre');
        if (pre) pre.innerHTML = `<span style="color:#546e7a;font-style:italic">${t('html_code_placeholder')}</span>`;
        const wrapper = modal.querySelector('#html-code-wrapper');
        if (wrapper) wrapper.dataset.raw = '';
        return;
      }

      try {
        const code = await buildHTMLString(titulo, layers, baseKey, showLegend, allowZoom, allowIdentify, identifyFieldsByLayer, mapInst, activeLayers);
        renderCodeBox(code);
      } catch (err) {
        console.error('[EXPORT] Error generando HTML:', err);
        const area = modal.querySelector('#html-copy-area');
        if (area) area.innerHTML = `<span style="display:flex;align-items:center;gap:4px;font-family:var(--font-sans);font-size:11px;color:#e57373"><span class="material-icons" style="font-size:14px;pointer-events:none">error_outline</span>${t('export_error_html')}</span>`;
      }
    }

    updateLayersSummary();
    setTimeout(buildAndShow, 0);

    // Descargar
    modal.querySelector('#html-download-btn').addEventListener('click', () => {
      const code = modal.querySelector('#html-code-wrapper')?.dataset.raw || '';
      if (!code) return;
      const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
      downloadBlob(blob, sanitizeFilename(titulo) + '.html');
      window.TOAST.success(t('export_done_html'));
    });
  }



  async function buildHTMLString(titulo, layers, baseKey, showLegend, allowZoom, allowIdentify, identifyFieldsByLayer, mapInst, activeLayers) {
    // Prefetchear SVGs de íconos Maki para embeber inline
    const MAKI_CDN = '/api/maki?icon=';
    const iconKeys = [...new Set(layers.map(l => l.style?.icon).filter(Boolean))];
    await Promise.allSettled(iconKeys.map(async key => {
      if (!window._makiSvgCache?.[key]?.svgRaw) {
        try {
          const res = await fetch(MAKI_CDN + key);
          if (res.ok) {
            const raw = await res.text();
            window._makiSvgCache = window._makiSvgCache || {};
            window._makiSvgCache[key] = { svgRaw: raw, byColor: {} };
          }
        } catch {}
      }
    }));

    // Construir mapa de SVGs inline coloreados para el HTML generado
    // formato: { iconKey: { color: svgString } }
    function _inlineSvg(iconKey, color, size) {
      const raw = window._makiSvgCache?.[iconKey]?.svgRaw;
      if (!raw) return `<svg width="${size}" height="${size}" viewBox="0 0 15 15" xmlns="http://www.w3.org/2000/svg"><circle cx="7.5" cy="7.5" r="4" fill="${color}" opacity="0.5"/></svg>`;
      return raw
        .replace(/\bwidth="[^"]*"/, `width="${size}"`)
        .replace(/\bheight="[^"]*"/, `height="${size}"`)
        .replace(/\bfill="[^"]*"/g, `fill="${color}"`)
        .replace('<svg', `<svg fill="${color}"`);
    }

    // Centro y zoom calculados a partir del bounding box de las capas seleccionadas,
    // no de la vista actual del usuario — así el embebido siempre muestra las capas completas.
    let center, zoom;
    try {
      let minLat =  90, maxLat = -90, minLng =  180, maxLng = -180;
      let hasCoords = false;
      for (const l of layers) {
        for (const f of (l.geojson?.features || [])) {
          const coords = JSON.stringify(f.geometry?.coordinates || []);
          const pairs  = coords.match(/-?\d+\.?\d*,-?\d+\.?\d*/g) || [];
          for (const pair of pairs) {
            const [lng, lat] = pair.split(',').map(Number);
            if (isFinite(lat) && isFinite(lng)) {
              minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
              minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
              hasCoords = true;
            }
          }
        }
      }
      if (hasCoords) {
        center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
        // Estimar zoom a partir del tamaño del bbox
        const latSpan = maxLat - minLat;
        const lngSpan = maxLng - minLng;
        const span    = Math.max(latSpan, lngSpan);
        zoom = span > 20 ? 4 : span > 10 ? 5 : span > 5 ? 6 : span > 2 ? 7 : span > 1 ? 8 : span > 0.5 ? 9 : 10;
      } else {
        // Fallback a la vista actual si no hay coordenadas
        center = mapInst.getCenter();
        zoom   = mapInst.getZoom();
      }
    } catch {
      center = mapInst.getCenter();
      zoom   = mapInst.getZoom();
    }

    const BASEMAP_URLS = {
      gray:    'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      dark:    'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
      voyager: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
      none:    null
    };
    const tileUrl = BASEMAP_URLS[baseKey] || null;

    const layersJSON    = JSON.stringify(layers);
    const legendDisplay = showLegend ? '' : 'display:none';
    const zoomOpts      = allowZoom  ? 'true' : 'false';
    const dragOpts      = allowZoom  ? '' : 'dragging.disable();map.scrollWheelZoom.disable();map.doubleClickZoom.disable();map.touchZoom.disable();';
    const tileBlock     = tileUrl
      ? `L.tileLayer('${tileUrl}',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',subdomains:'abcd',maxZoom:19}).addTo(map);`
      : '';

    // Construir mapa de SVGs inline para íconos Maki — autónomo sin CDN
    // { iconKey: svgStringColoreado }
    const makiInlineMap = {};
    layers.forEach(l => {
      const icon = l.style?.icon;
      if (!icon) return;
      const color = l.style?.iconColor || '#ffffff';
      const raw   = window._makiSvgCache?.[icon]?.svgRaw;
      if (raw) {
        makiInlineMap[icon] = raw
          .replace(/\bwidth="[^"]*"/, 'width="100%"')
          .replace(/\bheight="[^"]*"/, 'height="100%"')
          .replace(/\bfill="[^"]*"/g, `fill="${color}"`)
          .replace('<svg', `<svg fill="${color}" style="display:block"`);
      }
    });
    const makiInlineJSON = JSON.stringify(makiInlineMap);

    // identifyFieldsByLayer: { layerKey: [field1, field2] }  — array vacío = todos los campos
    // Se serializa al HTML para que el popup de cada capa filtre sus propios campos
    const identifyFieldsJSON = JSON.stringify(identifyFieldsByLayer || {});

    const identifyBtnHTML = allowIdentify
      ? `<button id="btn-identify" title="Consultar elementos"><span class="material-icons">question_mark</span></button>`
      : '';
    const identifyBtnCSS  = allowIdentify
      ? `#btn-identify{position:absolute;top:128px;left:12px;z-index:1000;width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.96);border:0.5px solid rgba(0,0,0,0.12);color:#5a5650;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.12);transition:background .15s,color .15s;font-size:0}
    #btn-identify:hover{background:#fff;color:#1a1814}
    #btn-identify.active{background:#444;color:#e2ddd4;border-color:#555}
    #btn-identify .material-icons{font-size:18px}`
      : '';
    // Colores del popup según el basemap seleccionado — mismo criterio que la leyenda.
    // dark → fondo oscuro con texto claro; gray/voyager → fondo blanco con texto oscuro.
    const _popupDark = baseKey === 'dark';
    const identifyPopupCSS = allowIdentify ? `
    .sm-popup .leaflet-popup-content-wrapper{background:${_popupDark ? 'rgba(42,40,38,0.97)' : 'rgba(255,255,255,0.97)'};border:0.5px solid ${_popupDark ? 'rgba(226,221,212,0.18)' : 'rgba(0,0,0,0.12)'};border-radius:6px;box-shadow:0 4px 16px ${_popupDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)'};padding:0}
    .sm-popup .leaflet-popup-tip-container{display:none}
    .sm-popup .leaflet-popup-content{margin:0}
    .map-popup{width:224px}
    .popup-header{display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 16px;border-bottom:0.5px solid ${_popupDark ? 'rgba(226,221,212,0.1)' : 'rgba(0,0,0,0.08)'};min-height:40px}
    .popup-name{font-size:13px;font-weight:600;color:${_popupDark ? '#e2ddd4' : '#1a1814'};padding:10px 0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .popup-close-btn{width:26px;height:26px;flex-shrink:0;background:transparent;border:none;cursor:pointer;color:${_popupDark ? 'rgba(226,221,212,0.55)' : 'rgba(0,0,0,0.4)'};border-radius:4px;display:flex;align-items:center;justify-content:center}
    .popup-close-btn:hover{background:${_popupDark ? 'rgba(226,221,212,0.08)' : 'rgba(0,0,0,0.06)'};color:${_popupDark ? '#e2ddd4' : '#1a1814'}}
    .popup-close-btn .material-icons{font-size:16px;pointer-events:none}
    .popup-table{width:100%;border-collapse:collapse}
    .popup-key{font-family:monospace;font-size:11px;color:${_popupDark ? 'rgba(226,221,212,0.55)' : 'rgba(0,0,0,0.45)'};padding:5px 8px 5px 16px;white-space:nowrap;vertical-align:top;width:40%}
    .popup-val{font-size:13px;color:${_popupDark ? '#e2ddd4' : '#1a1814'};padding:5px 16px 5px 0;word-break:break-word}` : '';
    const identifyJS = allowIdentify ? `
    const IDENTIFY_FIELDS_MAP=${identifyFieldsJSON};
    let identifyMode=false,hlLayer=null,currentPopup=null;
    function clearHL(){if(hlLayer){hlLayer.remove();hlLayer=null;}}
    function buildPopup(feat,titulo,layerKey){
      const props=feat.properties||{};
      const layerFields=IDENTIFY_FIELDS_MAP[layerKey]||[];
      const fields=layerFields.length
        ?layerFields.filter(k=>props[k]!=null&&props[k]!==''&&props[k]!=='None')
        :Object.keys(props).filter(k=>props[k]!=null&&props[k]!==''&&props[k]!=='None');
      const name=props.fna||props.nom_pfi||props.nam||props.rtn||titulo||'';
      const rows=fields.map(k=>'<tr><td class="popup-key">'+k+'</td><td class="popup-val">'+props[k]+'</td></tr>').join('');
      const el=document.createElement('div');
      el.className='map-popup';
      el.innerHTML='<div class="popup-header">'+(name?'<span class="popup-name">'+name+'</span>':'<span></span>')+'<button class="popup-close-btn"><span class="material-icons">close</span></button></div><table class="popup-table">'+(rows||'<tr><td class="popup-key" colspan="2" style="opacity:.5">Sin datos</td></tr>')+'</table>';
      el.querySelector('.popup-close-btn').addEventListener('click',()=>map.closePopup());
      return el;
    }
    function bindIdentify(feat,layer,layerTitulo,layerKey){
      const geom=feat.geometry?.type?.toLowerCase()||'';
      layer.on('click',e=>{
        if(!identifyMode)return;
        L.DomEvent.stopPropagation(e);
        clearHL();
        let hl;
        if(geom.includes('point')){hl=L.circleMarker(e.latlng,{radius:14,color:'#f5c518',weight:3,fillColor:'#f5c518',fillOpacity:0.2,opacity:0.9}).addTo(map);}
        else if(geom.includes('line')){hl=L.geoJSON(feat,{style:{color:'#f5c518',weight:12,opacity:0.75}}).addTo(map);}
        else{hl=L.geoJSON(feat,{style:{color:'#f5c518',weight:3,fillColor:'#f5c518',fillOpacity:0.2,opacity:0.9}}).addTo(map);}
        hlLayer=hl;
        currentPopup=L.popup({className:'sm-popup',offset:L.point(0,6),autoPan:true,closeButton:false}).setLatLng(e.latlng).setContent(buildPopup(feat,layerTitulo,layerKey)).openOn(map);
      });
    }
    map.on('popupclose',()=>{clearHL();currentPopup=null;});
    map.on('click',()=>{if(identifyMode&&!currentPopup)setIdentify(false);});
    function setIdentify(on){
      identifyMode=on;
      const btn=document.getElementById('btn-identify');
      if(btn){btn.classList.toggle('active',on);btn.title=on?'Desactivar consulta':'Consultar elementos';}
      if(!on){map.closePopup();clearHL();}
    }
    document.getElementById('btn-identify')?.addEventListener('click',()=>setIdentify(!identifyMode));` : '';
    const onEachFeature = allowIdentify
      ? `onEachFeature:(f,layer)=>bindIdentify(f,layer,l.titulo,l.key),`
      : '';

    // Footer: proyección y fuente — leídas dinámicamente de LAYERS y SOURCES
    const _meta      = _getMapMeta(activeLayers);
    // Footer: solo la fuente, sin EPSG
    const footerText  = _meta.attributionText || '';
    const footerLabel = (() => {
      const lang = window.I18N?.getLang?.() || 'es';
      return { es: 'Fuente', en: 'Source', pt: 'Fonte' }[lang] || 'Fuente';
    })();
    const footerAttribs = _meta.attributions || (footerText ? [footerText] : []);

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(titulo)}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=DM+Mono&family=Fraunces:opsz,wght@9..144,500&display=swap" rel="stylesheet"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    #map{width:100%;height:100%;background:#e8e4de}
    /* ── Leyenda ── */
    #legend-panel{position:absolute;top:12px;right:12px;z-index:1000;border-radius:8px;min-width:180px;max-width:260px;overflow:hidden;${legendDisplay}}
    #legend-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer;user-select:none}
    #legend-toggle{width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;transition:transform 0.2s}
    #legend-panel.collapsed #legend-toggle{transform:rotate(180deg)}
    #legend-body{padding:8px 12px 10px;display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto}
    #legend-panel.collapsed #legend-body{display:none}
    .legend-item{display:flex;align-items:center;gap:8px}
    #legend-footer{padding:0}
    .legend-source-title{font-size:10px;font-weight:600;padding:6px 12px 2px;display:block}
    .legend-source-item{font-size:10px;padding:0 12px 4px;display:block;line-height:1.4}
    .legend-divider{border:none;margin:4px 0}
    .legend-brand{font-size:20px;padding:10px 12px 12px;display:block;text-align:center}
    /* Modo oscuro (basemap dark) */
    body.legend-dark #legend-panel{background:rgba(42,40,38,0.95);border:0.5px solid rgba(255,255,255,0.12);box-shadow:0 2px 12px rgba(0,0,0,0.4)}
    body.legend-dark #legend-header{border-bottom:0.5px solid rgba(255,255,255,0.10)}
    #legend-title{font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600}
    .legend-label{font-family:'DM Sans',sans-serif;font-size:13px}
    .legend-class{font-family:'DM Sans',sans-serif;font-size:11px}
    .legend-layer-name{font-family:'DM Sans',sans-serif;font-size:13px;width:100%}
    .legend-source-title{font-family:'DM Mono',monospace}
    .legend-source-item{font-family:'DM Mono',monospace}
    .legend-brand{font-family:'Fraunces',serif;font-weight:500}
    body.legend-dark #legend-title{color:#ffffff}
    body.legend-dark #legend-toggle{color:rgba(255,255,255,0.5)}
    body.legend-dark .legend-label{color:rgba(255,255,255,0.85)}
    body.legend-dark .legend-class{color:rgba(255,255,255,0.55)}
    body.legend-dark .legend-layer-name{color:rgba(255,255,255,0.85)}
    body.legend-dark .legend-source-title{color:rgba(255,255,255,0.5)}
    body.legend-dark .legend-source-item{color:rgba(255,255,255,0.4)}
    body.legend-dark .legend-divider{border-top:0.5px solid rgba(255,255,255,0.10)}
    body.legend-dark .legend-brand{color:#7a8fc4}
    /* Modo claro (basemaps gray y voyager) */
    body.legend-light #legend-panel{background:rgba(255,255,255,0.96);border:0.5px solid rgba(0,0,0,0.12);box-shadow:0 2px 12px rgba(0,0,0,0.15)}
    body.legend-light #legend-header{border-bottom:0.5px solid rgba(0,0,0,0.08)}
    body.legend-light #legend-title{color:#1a1814}
    body.legend-light #legend-toggle{color:#888}
    body.legend-light .legend-label{color:#333}
    body.legend-light .legend-class{color:#888}
    body.legend-light .legend-layer-name{color:#333}
    body.legend-light .legend-source-title{color:rgba(0,0,0,0.45)}
    body.legend-light .legend-source-item{color:rgba(0,0,0,0.35)}
    body.legend-light .legend-divider{border-top:0.5px solid rgba(0,0,0,0.08)}
    body.legend-light .legend-brand{color:#3d52a0}
    /* Controles de zoom — arriba a la derecha, debajo de la leyenda */
    #zoom-controls{position:absolute;top:12px;left:12px;z-index:1000;display:flex;flex-direction:column;gap:4px}
    .z-btn{width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.96);border:0.5px solid rgba(0,0,0,0.12);color:#5a5650;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.12);transition:background .15s,color .15s;font-size:0}
    .z-btn:hover{background:#fff;color:#1a1814}
    .z-btn .material-icons{font-size:18px}
    ${identifyBtnCSS}${identifyPopupCSS}
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="zoom-controls">
    <button class="z-btn" id="zin" title="Zoom +"><span class="material-icons">add</span></button>
    <button class="z-btn" id="zreset" title="Vista original"><span class="material-icons">undo</span></button>
    <button class="z-btn" id="zout" title="Zoom -"><span class="material-icons">remove</span></button>
  </div>
  ${identifyBtnHTML}
  <div id="legend-panel">
    <div id="legend-header" onclick="toggleLegend()">
      <span id="legend-title">${escHtml(titulo)}</span>
      <span id="legend-toggle">▴</span>
    </div>
    <div id="legend-body"></div>
    <div id="legend-footer">
      ${footerAttribs.length ? `
        <span class="legend-source-title">${escHtml(footerLabel)}</span>
        ${footerAttribs.map(a => `<span class="legend-source-item">${escHtml(a)}</span>`).join('')}
      ` : ''}
      <hr class="legend-divider"/>
      <span class="legend-brand">Casux</span>
    </div>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <script>
    const D=${layersJSON};
    const initCenter=[${center.lat.toFixed(6)},${center.lng.toFixed(6)}];
    const initZoom=${zoom};
    const MAKI_INLINE=${makiInlineJSON};
    const map=L.map('map',{center:initCenter,zoom:initZoom,zoomControl:false});
    ${dragOpts}
    ${tileBlock}
    // Aplicar tema de leyenda según basemap
    document.body.classList.add('${baseKey === 'dark' ? 'legend-dark' : 'legend-light'}');
    // Ajustar vista con margen generoso y guardar esos bounds para el botón reset
    let _initBounds=null;
    setTimeout(()=>{
      try{
        const allLayers=[];
        map.eachLayer(l=>{if(l.getBounds)allLayers.push(l);});
        if(allLayers.length){
          const bounds=allLayers.reduce((b,l)=>b.extend(l.getBounds()),allLayers[0].getBounds());
          _initBounds=bounds;
          map.fitBounds(bounds,{padding:[48,48]});
        }
      }catch(e){}
    },300);

    // Estilos
    function ps(s){return{fillColor:s.fillColor||'#c8622a',fillOpacity:s.fillOpacity??0.5,color:s.color||s.fillColor||'#c8622a',weight:s.weight??1.5,opacity:s.opacity??1}}
    function ls(s){const t={color:s.color||'#c8622a',weight:s.weight??2,opacity:s.opacity??1};if(s.dashArray)t.dashArray=s.dashArray;return t}
    function pts(s){return{radius:s.radius??5,fillColor:s.fillColor||'#c8622a',fillOpacity:s.fillOpacity??0.85,color:s.color||'#fff',weight:s.weight??1.5,opacity:s.opacity??1}}
    function fs(g,b,cl,p){if(!cl?.colorMap)return g==='point'?pts(b):g==='line'?ls(b):ps(b);const c=cl.colorMap[p?.[cl.field]];if(!c)return{opacity:0,fillOpacity:0,weight:0,radius:0};const m={...b,...(cl.styleMap?.[p?.[cl.field]]||{}),fillColor:c,color:c};return g==='point'?pts(m):g==='line'?ls(m):ps(m)}

    // Leyenda
    const lb=document.getElementById('legend-body');
    function mkSVG(g,fill,stroke,fo,w,op,da,shape){
      w=Math.min(w??1.5,3);
      if(g==='line'){const d=da?'stroke-dasharray="'+da+'"':'';return '<svg viewBox="0 0 14 14" width="14" height="14" style="flex-shrink:0"><line x1="1" y1="7" x2="13" y2="7" stroke="'+stroke+'" stroke-width="'+(w*1.5)+'" stroke-opacity="'+op+'" stroke-linecap="round" '+d+'/></svg>';}
      if(g==='point'){
        if(shape==='square')return '<svg viewBox="0 0 14 14" width="14" height="14" style="flex-shrink:0"><rect x="1" y="1" width="12" height="12" fill="'+fill+'" fill-opacity="'+fo+'" stroke="'+stroke+'" stroke-width="'+w+'" stroke-opacity="'+op+'"/></svg>';
        return '<svg viewBox="0 0 14 14" width="14" height="14" style="flex-shrink:0"><circle cx="7" cy="7" r="5" fill="'+fill+'" fill-opacity="'+fo+'" stroke="'+stroke+'" stroke-width="'+w+'" stroke-opacity="'+op+'"/></svg>';
      }
      return '<svg viewBox="0 0 14 14" width="14" height="14" style="flex-shrink:0"><rect x="1" y="1" width="12" height="12" rx="2" fill="'+fill+'" fill-opacity="'+fo+'" stroke="'+stroke+'" stroke-width="'+w+'" stroke-opacity="'+op+'"/></svg>';
    }
    function ai(svg,label){const i=document.createElement('div');i.className='legend-item';i.innerHTML=svg+'<span class="legend-label">'+label+'</span>';lb.appendChild(i)}
    function aic(svg,label){const i=document.createElement('div');i.className='legend-item';i.innerHTML=svg+'<span class="legend-class">'+label+'</span>';lb.appendChild(i)}

    ${identifyJS}

    function darken(hex,a){a=a??0.22;const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h,s,l=(mx+mn)/2;if(mx===mn){h=s=0;}else{const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);switch(mx){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;default:h=((r-g)/d+4)/6;}}l=Math.max(0,l-a);const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;function h2r(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}function t2h(n){return Math.round(n*255).toString(16).padStart(2,'0');}return'#'+t2h(h2r(p,q,h+1/3))+t2h(h2r(p,q,h))+t2h(h2r(p,q,h-1/3));}

    D.forEach(l=>{
      const g=l.geomType||'polygon';
      const s=l.style||{};
      if(!l.classification?.colorMap){
        const fill=s.fillColor||s.color||'#888';
        const stroke=g==='line'?fill:(s.color||darken(fill));
        const fo=s.fillOpacity??(g==='polygon'?0.5:0.85),w=s.weight??1.5,op=s.opacity??1,da=s.dashArray||null;
        ai(mkSVG(g,fill,stroke,fo,w,op,da,s.shape||null),l.titulo);
      } else {
        const h=document.createElement('div');h.style.cssText='padding:2px 0 1px;width:100%';h.innerHTML='<span class="legend-layer-name">'+l.titulo+'</span>';lb.appendChild(h);
        Object.entries(l.classification.colorMap).forEach(([v,c])=>{
          const vs=l.classification.styleMap?.[v]||{};
          const fill=vs.fillColor||c;
          const stroke=g==='line'?(vs.color||fill):(vs.color||darken(fill));
          const fo=vs.fillOpacity??s.fillOpacity??(g==='polygon'?0.5:0.85),w=vs.weight??s.weight??1.5,op=vs.opacity??s.opacity??1;
          aic(mkSVG(g,fill,stroke,fo,w,op,null,s.shape||null),v);
        });
      }
      L.geoJSON(l.geojson,{
        style:f=>fs(l.geomType,l.style,l.classification,f.properties),
        pointToLayer:(f,ll)=>{
          const ps=fs('point',l.style,l.classification,f.properties);
          const icon=l.style?.icon;
          const shape=l.style?.shape||'circle';
          const sz=(ps.radius??6)*2;
          const fill=ps.fillColor||'#c8622a';
          const border=ps.color||'transparent';
          const bw=ps.weight??0;
          const fo=ps.fillOpacity??0.85;
          const ic=l.style?.iconColor||'#ffffff';
          if(icon){
            const br=shape==='circle'?'50%':shape==='square'?'3px':'50%';
            const iSz=(sz*.55|0);
            const svgContent=MAKI_INLINE[icon]||'<img src="https://cdn.jsdelivr.net/npm/@mapbox/maki@8/icons/'+icon+'.svg" width="'+iSz+'" height="'+iSz+'" style="display:block"/>';
            const html='<div style="width:'+sz+'px;height:'+sz+'px;border-radius:'+br+';background:'+fill+';opacity:'+fo+';border:'+bw+'px solid '+border+';display:flex;align-items:center;justify-content:center;box-sizing:border-box;overflow:hidden"><div style="width:'+iSz+'px;height:'+iSz+'px;flex-shrink:0">'+svgContent+'</div></div>';
            return L.marker(ll,{icon:L.divIcon({html,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],popupAnchor:[0,-sz/2]})});
          }
          if(shape==='square'){
            let inner;
            inner='<div style="width:'+sz+'px;height:'+sz+'px;background:'+fill+';opacity:'+fo+';border:'+bw+'px solid '+border+';box-sizing:border-box"></div>';
            return L.marker(ll,{icon:L.divIcon({html:inner,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],popupAnchor:[0,-sz/2]})});
          }
          return L.circleMarker(ll,ps);
        },
        ${onEachFeature}
      }).addTo(map);
    });

    // Controles de zoom
    document.getElementById('zin').addEventListener('click',()=>map.zoomIn());
    document.getElementById('zout').addEventListener('click',()=>map.zoomOut());
    document.getElementById('zreset').addEventListener('click',()=>{if(_initBounds)map.fitBounds(_initBounds,{padding:[48,48]});else map.setView(initCenter,initZoom);});


    function toggleLegend(){document.getElementById('legend-panel').classList.toggle('collapsed')}
  <\/script>
</body>
</html>`;
  }

  return { toHTML };

})();
