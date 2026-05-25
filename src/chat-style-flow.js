/**
 * chat-style-flow.js — Árbol de personalización de estilo desde el chat
 *
 * Extiende window.UI (creado por chat-ui-messages.js) con Object.assign.
 * Depende de: window.UI (chat-ui-messages.js + chat-ui-widgets.js),
 *             window.MAP, window.CHAT, window.APP, window.LP_STYLE,
 *             window.LP_MODAL, window.LP_UTILS, window.INTENT_VALIDAR,
 *             window.MAKI_ICONS, window.MAP_CONTROLS
 * Debe cargarse DESPUÉS de chat-ui-widgets.js y ANTES de chat.js
 *
 * Contiene: showStyleFlow, showStyleFlowForLayer,
 *           _applyStyle, _applyColorChange,
 *           _showColorPicker, _showSlider, _showOpacitySlider,
 *           _showIconPicker, _showGeomPicker,
 *           _showParamButtons, _showParamControl, _showLayerButtons,
 *           _makeConfirmMsg, _makeConfirmBtn,
 *           _openLayerStyleEditor, _openLayerAdvancedModal, _validateParam
 */

(function () {

  // Paleta de colores sugeridos (12 opciones bien distribuidas)
  const STYLE_PALETTE = [
    '#e63946','#f4a261','#f7d24a','#2a9d8f',
    '#457b9d','#6a4c93','#588157','#e76f51',
    '#023e8a','#80b918','#c77dff','#ff6b6b',
  ];

  // amount: fracción 0–1 (ej: 0.12 → oscurece 12%). Consistente con export-utils._darkenHex.
  function _darkenHex(hex, amount = 0.12) {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.max(0, Math.round(((n >> 16)       ) * (1 - amount)));
    const g = Math.max(0, Math.round(((n >>  8) & 0xff) * (1 - amount)));
    const b = Math.max(0, Math.round(((n      ) & 0xff) * (1 - amount)));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  }

  function _suggestColors(currentFill) {
    const cur = (currentFill || '').toLowerCase();
    const pool = STYLE_PALETTE.filter(c => c !== cur);
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
  }

  function _suggestIcons(chatTitulo) {
    const validKeys = new Set((window.MAKI_ICONS || []).map(i => i.key));
    const filterValid = (icons) => icons.filter(i => validKeys.has(i)).slice(0, 3);
    const fallback = filterValid(['marker', 'star', 'information', 'attraction', 'monument']);

    const ICON_HINTS = [
      { keys: ['aeropuerto','airport','vuelo','avion','aerodromo'],    icons: ['airport','helipad','ferry'] },
      { keys: ['puerto','port','muelle','embarcadero'],                icons: ['harbor','ferry','bridge'] },
      { keys: ['ruta','vial','camino','highway','autopista'],          icons: ['car','barrier','bus'] },
      { keys: ['hospital','salud','health','clinic','medico'],         icons: ['hospital','doctor','defibrillator'] },
      { keys: ['escuela','educacion','school','college','universidad'], icons: ['college','library','school'] },
      { keys: ['parque','reserva','verde','park','naturaleza'],        icons: ['park','tree','campsite'] },
      { keys: ['ciudad','localidad','pueblo','municipio','barrio'],    icons: ['city','town','town-hall'] },
      { keys: ['rio','lago','agua','water','hidro','arroyo'],          icons: ['waterfall','drinking-water','wetland'] },
      { keys: ['mina','industria','mineria','fabrica','planta'],       icons: ['industry','warehouse','dam'] },
      { keys: ['iglesia','templo','capilla','catedral','religioso'],   icons: ['place-of-worship','religious-christian','mosque'] },
      { keys: ['museo','cultura','arte','galeria','patrimonio'],       icons: ['museum','art-gallery','attraction'] },
      { keys: ['hotel','alojamiento','hospedaje','turismo'],           icons: ['lodging','shelter','campsite'] },
      { keys: ['restaurante','gastronomia','comida','mercado'],        icons: ['restaurant','fast-food','cafe'] },
      { keys: ['policia','seguridad','comisaria','bombero'],           icons: ['police','fire-station','prison'] },
      { keys: ['deporte','estadio','cancha','gimnasio'],               icons: ['soccer','basketball','baseball'] },
      { keys: ['banco','financiero','cajero','credito'],               icons: ['bank','commercial','embassy'] },
      { keys: ['farmacia','drogueria','salud'],                        icons: ['pharmacy','hospital','doctor'] },
    ];
    const norm = (chatTitulo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    for (const hint of ICON_HINTS) {
      const valid = filterValid(hint.icons);
      if (valid.length >= 1 && hint.keys.some(k => norm.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g,'')))) {
        return valid.length >= 3 ? valid : [...valid, ...fallback].slice(0, 3);
      }
    }
    return fallback;
  }

  function _makiSvgUrl(key) {
    return `https://cdn.jsdelivr.net/npm/@mapbox/maki@8/icons/${key}.svg`;
  }

  // ── Aplicar estilos ───────────────────────────────────────────

  function _applyStyle(mapKey, styleChanges) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entry = activeLayers[mapKey];
    if (!entry) return;
    const newStyle = { ...entry.style, ...styleChanges };
    window.MAP?.updateLayerStyle?.(mapKey, newStyle);

    // Re-aplicar clasificación si existe
    if (entry.classification?.field) {
      const cl = entry.classification;
      const paletteColors = cl.paletteColors || window.PALETTES?.[cl.palette] || window.PALETTES?.qualitative;
      window.MAP?.applyClassification?.(mapKey, { ...cl, paletteColors });
    }

    window.MAP?.updateLegend?.();
    window.ANALYTICS?.styleChanged?.('chat');

    // Persistir
    const planActual = window.APP?.getCurrentPlan?.();
    if (planActual?.instrucciones) {
      const inst = planActual.instrucciones.find(i => i.mapKey === mapKey);
      if (inst) inst.style = { ...(window.MAP?.getActiveLayers?.()[mapKey]?.style || {}) };
    }
    const user   = window.AUTH?.currentUser?.();
    const chatId = window.CHAT?.getChatId?.();
    if (user && chatId && planActual) {
      window.FB?.updateChat?.(user.uid, chatId, { lastMap: planActual }).catch(() => {});
    }

    if (window.MAP_CONTROLS?.isMobile?.()) {
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel?.style.display === 'none') {
        window.UI.showViewMapBtn();
      }
    }
  }

  function _applyColorChange(mapKey, layer, hex) {
    const geom = layer.geomType || 'polygon';
    const newStyle = { color: _darkenHex(hex, 0.12) };
    if (geom === 'point' || geom === 'polygon') {
      newStyle.fillColor = hex;
    } else {
      newStyle.color = hex;
    }
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const mapKey1 = Object.keys(activeLayers).find(k => activeLayers[k].layerKey === layer.layerKey);
    if (mapKey1) _applyStyle(mapKey1, newStyle);
  }

  // ── Paso C: controles según parámetro ────────────────────────

  function _showColorPicker(container, mapKey, layer, containerRef) {
    // Verificar clasificación activa — el selector de color puede llegar acá
    // sin haber pasado por el chequeo de clasificación de send() cuando el
    // usuario llega desde el selector de capa (showLayerSelectorForAction).
    const activeLayersCheck = window.MAP?.getActiveLayers?.() || {};
    const entryCheck = activeLayersCheck[mapKey];
    if (entryCheck?.classification?.field) {
      const warnEl = window.UI.addMessage('assistant', t('style_classified_warning'));
      window.UI.showClassifiedStyleChoice(warnEl, mapKey,
        () => {
          // Mantener clasificación → no tocar el color
          window.UI.addMessage('assistant', t('style_keep_classification'));
          containerRef?.remove();
          window.UI.scrollBottom();
        },
        () => {
          // Reemplazar → limpiar clasificación y mostrar el picker
          window.MAP?.clearClassification?.(mapKey);
          window.LP_PANEL?.persistClassification?.(mapKey, null);
          const layerFresh = window.MAP?.getActiveLayers?.()[mapKey] || layer;
          containerRef.innerHTML = '';
          _showColorPicker(containerRef, mapKey, layerFresh, containerRef);
          window.UI.scrollBottom();
        }
      );
      return;
    }

    const currentFill = layer.style?.fillColor || layer.style?.color || '#888888';
    const colors = _suggestColors(currentFill);
    const wrap = document.createElement('div');
    wrap.className = 'style-grid';

    colors.forEach(hex => {
      const btn = document.createElement('button');
      btn.className = 'style-grid-btn';
      btn.innerHTML = `
        <div class="style-grid-swatch" style="background:${hex}"></div>
        <span class="style-grid-label">${hex.toUpperCase()}</span>`;
      btn.addEventListener('click', () => {
        _applyColorChange(mapKey, layer, hex);
        window.UI.addMessage('assistant', t('style_applied'));
        containerRef?.remove();
        window.UI.scrollBottom();
      });
      wrap.appendChild(btn);
    });

    const otroBtn = document.createElement('button');
    otroBtn.className = 'style-grid-btn';
    otroBtn.innerHTML = `
      <span class="material-icons" style="font-size:20px;color:var(--cream2)">palette</span>
      <span class="style-grid-label">${t('style_other')}</span>`;

    const nativePick = document.createElement('input');
    nativePick.type  = 'color';
    nativePick.value = currentFill.slice(0, 7);
    nativePick.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
    otroBtn.appendChild(nativePick);

    nativePick.addEventListener('input', () => {
      _applyColorChange(mapKey, layer, nativePick.value);
    });
    nativePick.addEventListener('change', () => {
      _applyColorChange(mapKey, layer, nativePick.value);
      window.UI.addMessage('assistant', t('style_applied'));
      containerRef?.remove();
      window.UI.scrollBottom();
    });
    otroBtn.addEventListener('click', () => nativePick.click());
    wrap.appendChild(otroBtn);

    container.appendChild(wrap);
    window.UI.scrollBottom();
  }

  function _showSlider(container, mapKey, layer, prop, containerRef) {
    const isRadius = prop === 'radius';
    const cur = layer.style?.[prop] ?? (isRadius ? 5 : 2);
    const min = 0.5, max = isRadius ? 25 : 10, step = 0.5;

    const wrap = document.createElement('div');
    wrap.className = 'style-slider-wrap';
    wrap.innerHTML = `
      <div class="style-slider-row">
        <input class="lea-range-input" type="range"
          min="${min}" max="${max}" step="${step}" value="${cur}" />
        <span class="style-slider-val">${cur}</span>
      </div>`;

    const inp = wrap.querySelector('input');
    const val = wrap.querySelector('.style-slider-val');

    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      val.textContent = v;
      window.MAP?.updateLayerStyle?.(mapKey, { [prop]: v }); // preview
    });

    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      _applyStyle(mapKey, { [prop]: v });
      window.UI.addMessage('assistant', t('style_applied'));
      containerRef?.remove();
      window.UI.scrollBottom();
    });

    window.LP_UTILS?.wireSliderTouch?.(inp);
    container.appendChild(wrap);
    window.UI.scrollBottom();
  }

  function _showOpacitySlider(container, mapKey, layer, containerRef) {
    const geom = layer.geomType || 'polygon';
    const isLine = geom === 'line';
    const cur = isLine
      ? (layer.style?.opacity ?? 1)
      : (layer.style?.fillOpacity ?? 0.8);

    const wrap = document.createElement('div');
    wrap.className = 'style-slider-wrap';
    wrap.innerHTML = `
      <div class="style-slider-row">
        <input class="lea-range-input" type="range"
          min="0" max="1" step="0.05" value="${cur}" />
        <span class="style-slider-val">${Math.round(cur * 100)}%</span>
      </div>`;

    const inp = wrap.querySelector('input');
    const val = wrap.querySelector('.style-slider-val');

    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      val.textContent = Math.round(v * 100) + '%';
      const preview = isLine ? { opacity: v } : { fillOpacity: v, opacity: v };
      window.MAP?.updateLayerStyle?.(mapKey, preview);
    });

    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      const changes = isLine ? { opacity: v } : { fillOpacity: v, opacity: v };
      _applyStyle(mapKey, changes);
      window.UI.addMessage('assistant', t('style_applied'));
      containerRef?.remove();
      window.UI.scrollBottom();
    });

    window.LP_UTILS?.wireSliderTouch?.(inp);
    container.appendChild(wrap);
    window.UI.scrollBottom();
  }

  function _showIconPicker(container, mapKey, layer, chatTitulo, containerRef) {
    const isMobile = window.MAP_CONTROLS?.isMobile?.();
    const icons = _suggestIcons(chatTitulo);
    const wrap = document.createElement('div');
    wrap.className = 'style-grid';

    icons.forEach(key => {
      const btn = document.createElement('button');
      btn.className = 'style-grid-btn';
      btn.innerHTML = `
        <div class="style-grid-icon">
          <img src="${_makiSvgUrl(key)}" width="20" height="20" style="filter:brightness(0) invert(1)" onerror="this.style.display='none'"/>
        </div>
        <span class="style-grid-label">${key}</span>`;
      btn.addEventListener('click', () => {
        window.MAP?.precacheMakiIcon?.(key);
        _applyStyle(mapKey, { icon: key });
        window.UI.addMessage('assistant', t('style_applied'));
        containerRef?.remove();
        window.UI.scrollBottom();
      });
      wrap.appendChild(btn);
    });

    const otroBtn = document.createElement('button');
    otroBtn.className = 'style-grid-btn';
    if (isMobile) {
      otroBtn.disabled = true;
      otroBtn.innerHTML = `
        <span class="material-icons" style="font-size:20px;color:var(--cream2);opacity:0.4">search</span>
        <span class="style-grid-label" style="opacity:0.4">${t('style_other')}</span>`;
    } else {
      otroBtn.innerHTML = `
        <span class="material-icons" style="font-size:20px;color:var(--cream2)">search</span>
        <span class="style-grid-label">${t('style_other')}</span>`;
      otroBtn.addEventListener('click', () => {
        wrap.replaceWith(_makeConfirmMsg(t('style_opening_editor')));
        _openLayerAdvancedModal(mapKey);
        window.UI.scrollBottom();
      });
    }
    wrap.appendChild(otroBtn);
    container.appendChild(wrap);
    window.UI.scrollBottom();
  }

  // ── Geometría (puntos) ───────────────────────────────────────

  function _showGeomPicker(container, mapKey, layer, containerRef) {
    const wrap = document.createElement('div');
    wrap.className = 'style-grid';

    const shapes = [
      { key: 'circle', label: t('shape_circle'), icon: 'radio_button_unchecked' },
      { key: 'square', label: t('shape_square'), icon: 'crop_square' },
    ];

    shapes.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'style-grid-btn';
      btn.innerHTML = `
        <span class="material-icons" style="font-size:24px">${s.icon}</span>
        <span class="style-grid-label">${s.label}</span>`;
      btn.addEventListener('click', () => {
        _applyStyle(mapKey, { shape: s.key });
        window.UI.addMessage('assistant', t('style_applied'));
        containerRef?.remove();
        window.UI.scrollBottom();
      });
      wrap.appendChild(btn);
    });

    container.appendChild(wrap);
    window.UI.scrollBottom();
  }

  // ── Paso B: elegir parámetro ──────────────────────────────────

  function _showParamButtons(container, mapKey, layer, chatTitulo, containerRef, opts = {}) {
    const geom = layer.geomType || 'polygon';
    const validProps = window.INTENT_VALIDAR?.getPropsValidasParaGeom?.(geom) || ['color', 'opacity'];

    const PROP_LABELS = {
      color:   () => t('style_color'),
      radius:  () => t('style_size'),
      weight:  () => t('style_weight'),
      icon:    () => t('adv_svg_title'),
      geom:    () => t('style_geometry'),
      opacity: () => t('style_opacity'),
    };

    const params = validProps
      .filter(p => !(opts.excludeColor && p === 'color'))
      .filter(p => PROP_LABELS[p])
      .map(p => ({ key: p, label: PROP_LABELS[p]() }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

    const card = document.createElement('div');
    card.className = 'msg-export-choice';
    card.innerHTML = params.map(p => `
      <button class="export-choice-btn" data-param="${p.key}">
        <span class="export-choice-label">${p.label}</span>
      </button>`).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const param = btn.dataset.param;
        card.innerHTML = '';
        _showParamControl(card, mapKey, layer, param, chatTitulo, containerRef);
      });
    });

    container.appendChild(card);
    window.UI.scrollBottom();
  }

  function _showParamControl(container, mapKey, layer, param, chatTitulo, containerRef) {
    const geom = layer.geomType || 'polygon';
    const allowed = window.INTENT_VALIDAR?.getPropsValidasParaGeom?.(geom) || ['color', 'opacity'];
    if (!allowed.includes(param)) {
      const geomKey  = geom === 'point' ? 'geom_point' : geom === 'line' ? 'geom_line' : 'geom_polygon';
      const paramKey = param === 'radius' ? 'style_size' : param === 'weight' ? 'style_weight' : 'style_' + param;
      const msgEl = document.createElement('div');
      msgEl.className = 'msg-export-confirm';
      msgEl.textContent = t('style_param_not_valid', { param: t(paramKey), geom: t(geomKey) });
      container.appendChild(msgEl);
      _showParamButtons(container, mapKey, layer, chatTitulo, containerRef);
      return;
    }
    if (param === 'color')   _showColorPicker(container, mapKey, layer, containerRef);
    if (param === 'radius')  _showSlider(container, mapKey, layer, 'radius', containerRef);
    if (param === 'weight')  _showSlider(container, mapKey, layer, 'weight', containerRef);
    if (param === 'opacity') _showOpacitySlider(container, mapKey, layer, containerRef);
    if (param === 'icon')    _showIconPicker(container, mapKey, layer, chatTitulo, containerRef);
    if (param === 'geom')    _showGeomPicker(container, mapKey, layer, containerRef);
  }

  // ── Paso A: elegir capa ───────────────────────────────────────

  function _showLayerButtons(container, layers, param, chatTitulo, containerRef) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    const validLayers = param
      ? Object.fromEntries(Object.entries(layers).filter(([, l]) => _validateParam(param, l.geomType)))
      : layers;

    const validEntries = Object.entries(validLayers);

    if (param && validEntries.length === 1) {
      const [mapKey, layer] = validEntries[0];
      const _geom    = layer.geomType || 'polygon';
      const _geomKey = _geom === 'point' ? 'geom_point' : _geom === 'line' ? 'geom_line' : 'geom_polygon';
      const _tit     = layer.tituloUI || layer.titulo || mapKey;
      const _autoMsg = document.createElement('div');
      _autoMsg.className = 'msg-export-confirm';
      // radius/icon/geom son exclusivos de puntos — el mensaje puede decir "solo aplica a puntos".
      // weight aplica a líneas y polígonos — el mensaje evita mencionar geometría exclusiva.
      const _exclusivoGeom = ['radius', 'icon', 'geom'].includes(param);
      _autoMsg.textContent = _exclusivoGeom
        ? t('style_auto_layer', { geom: t(_geomKey), titulo: _tit })
        : t('style_auto_layer_only', { titulo: _tit });
      container.appendChild(_autoMsg);
      _showParamControl(container, mapKey, layer, param, chatTitulo, containerRef);
      window.UI.scrollBottom();
      return;
    }

    card.innerHTML = validEntries
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
        const layer  = validLayers[mapKey];
        card.innerHTML = '';
        if (param) {
          _showParamControl(card, mapKey, layer, param, chatTitulo, containerRef);
        } else {
          _showParamButtons(card, mapKey, layer, chatTitulo, containerRef);
        }
      });
    });

    container.appendChild(card);
    window.UI.scrollBottom();
  }

  // ── Utilidades ────────────────────────────────────────────────

  function _makeConfirmMsg(text) {
    const el = document.createElement('div');
    el.className = 'msg-export-confirm';
    el.textContent = text;
    return el;
  }

  function _makeConfirmBtn(onConfirm) {
    const btn = document.createElement('button');
    btn.className = 'export-choice-btn style-confirm-btn';
    btn.innerHTML = `<span class="material-icons" style="font-size:15px">check</span><span class="export-choice-label">${t('style_confirm')}</span>`;
    btn.addEventListener('click', onConfirm);
    return btn;
  }

  function _openLayerStyleEditor(mapKey) {
    const existing = document.getElementById('layers-dropdown');
    if (!existing) window.LAYERS_PANEL?.toggle?.();
    setTimeout(() => {
      const sec = document.querySelector('.layers-data-section');
      const btn = document.querySelector(`.layer-edit-btn[data-key="${mapKey}"], .layers-data-row[data-key="${mapKey}"] .layer-edit-btn`);
      if (btn && sec) window.LP_STYLE?.toggleEditAccordion?.(mapKey, btn, sec);
    }, 80);
  }

  function _openLayerAdvancedModal(mapKey) {
    const sec = document.querySelector('.layers-data-section');
    window.LP_MODAL?.openAdvancedModal?.(mapKey, sec);
  }

  function _validateParam(param, geom) {
    if (param === 'radius' && geom !== 'point') return null;
    if (param === 'icon'   && geom !== 'point') return null;
    if (param === 'geom'   && geom !== 'point') return null;
    if (param === 'weight' && geom === 'point') return null;
    return param;
  }

  // ── Punto de entrada: showStyleFlow ──────────────────────────

  function showStyleFlow(intencion) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const layerEntries = Object.entries(activeLayers);
    if (!layerEntries.length) return;

    const chatTitulo = window.APP?.getCurrentPlan?.()?.titulo || '';
    const param = intencion?.parametros?.param || null;

    const paramQuestions = {
      color:  t('style_ask_color'),
      radius: t('style_ask_size'),
      weight: t('style_ask_weight'),
      icon:   t('style_ask_icon'),
      geom:   t('style_ask_geom'),
    };
    const question = (param && paramQuestions[param]) || t('style_what_to_change');
    const msgEl = window.UI.addMessage('assistant', question);
    const container = document.createElement('div');
    container.style.cssText = 'width:100%';
    container.className = 'style-flow-container';
    msgEl.after(container);

    const _excludeColor = intencion?.parametros?._excludeColor === true;

    if (layerEntries.length === 1) {
      const [mapKey, layer] = layerEntries[0];
      const validParam = param ? _validateParam(param, layer.geomType) : null;
      if (validParam && !(validParam === 'color' && _excludeColor)) {
        _showParamControl(container, mapKey, layer, validParam, chatTitulo, container);
      } else {
        _showParamButtons(container, mapKey, layer, chatTitulo, container, { excludeColor: _excludeColor });
      }
    } else {
      if (param) {
        const geomMap = { radius: 'point', icon: 'point', geom: 'point' };
        const targetGeom = geomMap[param];
        if (targetGeom) {
          const matching = layerEntries.filter(([, l]) => l.geomType === targetGeom);
          if (matching.length === 1) {
            const [mapKey, layer] = matching[0];
            const _geomKey  = targetGeom === 'point' ? 'geom_point' : targetGeom === 'line' ? 'geom_line' : 'geom_polygon';
            const _layerTit = layer.tituloUI || layer.titulo || mapKey;
            const _autoMsg  = document.createElement('div');
            _autoMsg.className = 'msg-export-confirm';
            _autoMsg.textContent = t('style_auto_layer', { geom: t(_geomKey), titulo: _layerTit });
            container.appendChild(_autoMsg);
            _showParamControl(container, mapKey, layer, param, chatTitulo, container);
          } else {
            const filtered = Object.fromEntries(matching);
            _showLayerButtons(container, filtered, param, chatTitulo, container);
          }
        } else {
          _showLayerButtons(container, activeLayers, param, chatTitulo, container);
        }
      } else {
        _showLayerButtons(container, activeLayers, null, chatTitulo, container);
      }
    }

    window.UI.scrollBottom();
    return msgEl;
  }

  // Igual que showStyleFlow pero opera sobre una capa ya elegida.
  function showStyleFlowForLayer(intencion, mapKey) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const layer = activeLayers[mapKey];
    if (!layer) return;

    const chatTitulo = window.APP?.getCurrentPlan?.()?.titulo || '';
    const param = intencion?.parametros?.param || null;

    const _PARAM_QUESTIONS = {
      color:   'style_ask_color',
      radius:  'style_ask_size',
      weight:  'style_ask_weight',
      icon:    'style_ask_icon',
      geom:    'style_ask_geom',
      opacity: 'style_ask_opacity',
    };
    const msgEl = window.UI.addMessage('assistant',
      param ? t(_PARAM_QUESTIONS[param] || 'style_what_to_change') : t('style_what_to_change')
    );

    const container = document.createElement('div');
    container.style.cssText = 'width:100%';
    container.className = 'style-flow-container';
    msgEl.after(container);

    const _excColor = intencion?.parametros?._excludeColor === true;
    if (param && !(param === 'color' && _excColor)) {
      _showParamControl(container, mapKey, layer, param, chatTitulo, container);
    } else {
      _showParamButtons(container, mapKey, layer, chatTitulo, container, { excludeColor: _excColor });
    }
    window.UI.scrollBottom();
  }

  // ── Extender window.UI ────────────────────────────────────────
  Object.assign(window.UI, {
    showStyleFlow,
    showStyleFlowForLayer,
  });

})();
