/**
 * chat.js — Chat con streaming de tokens y persistencia en Turso
 *
 * Orquestador principal del chat. Contiene solo estado, send(), saveChat,
 * restore, abort y la API pública de window.CHAT.
 *
 * Depende de (en orden de carga):
 *   chat-utils.js        → window.CHAT_UTILS
 *   chat-title.js        → window.CHAT_TITLE
 *   chat-ui-messages.js  → window.UI (base)
 *   chat-ui-widgets.js   → window.UI (extendido)
 *   chat-style-flow.js   → window.UI (extendido)
 *
 * Alias de acceso dentro de send():
 *   CHAT_UTILS.sanitizeHistoryForLLM / stripBloques / extract*
 *   CHAT_TITLE.toTitleCase / tituloDesdePlan / generarTitulo
 *   UI.addMessage / showMapReady / showThinking / etc.
 */

window.CHAT = (() => {

  let history           = [];
  let currentChatId     = null;
  let isStreaming        = false;
  let _abortController  = null;
  let _lastModel        = null;
  let _pendingChatTitle = null;

  // Shortcuts internos — todos via window.X para no romper si se carga en distinto orden
  const CU  = () => window.CHAT_UTILS;
  const CT  = () => window.CHAT_TITLE;

  // ── Helpers privados de intención ────────────────────────────

  // Aplica un cambio de estilo por propiedad y valor ya resueltos
  function _applyStyleProp(mapKey, prop, value) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entry = activeLayers[mapKey];
    if (!entry) return;

    let styleChanges;
    if (prop === 'color') {
      const geom = entry.geomType || 'polygon';
      const darken = (hex, amt = 0.12) => {
        const n = parseInt(hex.replace('#',''), 16);
        const r = Math.max(0, Math.round(((n >> 16)       ) * (1 - amt)));
        const g = Math.max(0, Math.round(((n >>  8) & 0xff) * (1 - amt)));
        const b = Math.max(0, Math.round(((n      ) & 0xff) * (1 - amt)));
        return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
      };
      if (geom === 'line') {
        styleChanges = { color: value };
      } else {
        styleChanges = { fillColor: value, color: darken(value) };
      }
    } else if (prop === 'opacity') {
      const geom = entry.geomType || 'polygon';
      styleChanges = geom === 'line'
        ? { opacity: value }
        : { fillOpacity: value, opacity: value };
    } else {
      styleChanges = { [prop]: value };
    }

    const newStyle = { ...entry.style, ...styleChanges };
    window.MAP?.updateLayerStyle?.(mapKey, newStyle);

    // Re-aplicar clasificación si existe
    const _entryCheck = window.MAP?.getActiveLayers?.()[mapKey];
    if (_entryCheck?.classification?.field) {
      const cl = _entryCheck.classification;
      const paletteColors = cl.paletteColors || window.PALETTES?.[cl.palette] || window.PALETTES?.qualitative;
      window.MAP?.applyClassification?.(mapKey, { ...cl, paletteColors });
    }

    window.MAP?.updateLegend?.();
    window.ANALYTICS?.styleChanged?.('intent');

    const planActual = window.APP?.getCurrentPlan?.();
    if (planActual?.instrucciones) {
      const inst = planActual.instrucciones.find(i => i.mapKey === mapKey);
      if (inst) inst.style = { ...newStyle };
    }
    const user   = window.AUTH?.currentUser?.();
    const chatId = window.CHAT?.getChatId?.();
    if (user && chatId && planActual) {
      window.FB?.updateChat?.(user.uid, chatId, { lastMap: planActual }).catch(() => {});
    }

    if (window.MAP_CONTROLS?.isMobile?.()) {
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel?.style.display === 'none') UI.showViewMapBtn?.();
    }
  }

  function _quitarCapa(mapKey) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    if (!activeLayers[mapKey]) return;
    window.MAP.removeLayer(mapKey);
    window.MAP.updateLegend();
    const planActual = window.APP?.getCurrentPlan?.();
    if (planActual?.instrucciones) {
      planActual.instrucciones = planActual.instrucciones.filter(i => i.mapKey !== mapKey);
    }
    const user   = window.AUTH?.currentUser?.();
    const chatId = window.CHAT?.getChatId?.();
    if (user && chatId && planActual) {
      window.FB?.updateChat?.(user.uid, chatId, { lastMap: planActual }).catch(() => {});
    }
  }

  function _resetEstilo(mapKey) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entry = activeLayers[mapKey];
    if (!entry) return;
    const defaultStyle = entry._defaultStyle || {};
    if (entry.classification) window.MAP?.clearClassification?.(mapKey);
    window.MAP?.updateLayerStyle?.(mapKey, defaultStyle);
    window.MAP?.updateLegend?.();
    const planActual = window.APP?.getCurrentPlan?.();
    if (planActual?.instrucciones) {
      const inst = planActual.instrucciones.find(i => i.mapKey === mapKey);
      if (inst) delete inst.style;
    }
    const _ur = window.AUTH?.currentUser?.();
    const _cr = window.CHAT?.getChatId?.();
    if (_ur && _cr && planActual) {
      window.FB?.updateChat?.(_ur.uid, _cr, { lastMap: planActual }).catch(() => {});
    }
  }

  // ── Enviar mensaje ────────────────────────────────────────────

  async function send(userText) {
    if (isStreaming) return;

    window.SUGGESTED_PROMPTS?.hide();
    history.push({ role: 'user', content: userText, time: new Date().toISOString() });
    UI.addMessage('user', userText, { time: new Date() });
    UI.showThinking();
    isStreaming = true;
    UI.setSendEnabled(false);

    try {
      // ── Intent unificado ──────────────────────────────────────
      const intencion = window.INTENT?.detectarIntencion?.(userText, history);
      const _intentLabel = intencion?.tipo || 'llm';
      window.ANALYTICS?.chatMessageSent?.(_intentLabel);

      if (intencion) {
        UI.hideThinking();

        // LIMPIAR
        if (intencion.tipo === 'limpiar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          if (intencion.parametros?._advertencia === 'validate_map_empty') {
            const msgVacio = UI.addMessage('assistant', t('map_already_empty'));
            UI.setMessageMeta(msgVacio, { time: new Date(), model: 'pim' });
            history.push({ role: 'assistant', content: t('map_already_empty'), time: new Date().toISOString(), model: 'pim' });
            return;
          }
          window.MAP?.clearAll?.();
          window.MAP?.resetView?.();
          window.MAP?.updateLegend?.();
          const _planLimpiar = window.APP?.getCurrentPlan?.();
          if (_planLimpiar) _planLimpiar.instrucciones = [];
          const msgEl = UI.addMessage('assistant', t('map_cleared'));
          UI.setMessageMeta(msgEl, { time: new Date(), model: 'pim' });
          history.push({ role: 'assistant', content: t('map_cleared'), time: new Date().toISOString(), model: 'pim' });
          return;
        }

        // EXPORT VAGO
        if (intencion.tipo === 'export' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const msgEl = UI.addMessage('assistant', t('export_choose_format'));
          UI.setMessageMeta(msgEl, { time: new Date(), model: 'pim' });
          UI.showExportChoice(msgEl);
          history.push({ role: 'assistant', content: t('export_choose_format'), time: new Date().toISOString(), model: 'pim' });
          return;
        }

        // EXPORT ESPECÍFICO
        if (intencion.tipo === 'export') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const fmt = intencion.subtipo;
          if (fmt === 'jpeg' || fmt === 'pdf') {
            window.EXPORT_GRAPHIC?.open?.(fmt);
          } else if (fmt === 'geojson') {
            window.EXPORT?.toGeoJSON?.();
          } else if (fmt === 'html') {
            window.EXPORT?.toHTML?.();
          }
          return;
        }

        // BASEMAP VAGO
        if (intencion.tipo === 'basemap' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const msgEl = UI.addMessage('assistant', t('basemap_choose'));
          UI.setMessageMeta(msgEl, { time: new Date(), model: 'pim' });
          UI.showBasemapButtons(msgEl);
          history.push({ role: 'assistant', content: t('basemap_choose'), time: new Date().toISOString(), model: 'pim' });
          return;
        }

        // BASEMAP ESPECÍFICO
        else if (intencion.tipo === 'basemap') {
          isStreaming = false;
          UI.setSendEnabled(true);
          window.MAP?.setBasemap?.(intencion.subtipo);
          const msgEl = UI.addMessage('assistant', t('basemap_changed'));
          UI.setMessageMeta(msgEl, { time: new Date(), model: 'pim' });
          history.push({ role: 'assistant', content: t('basemap_changed'), time: new Date().toISOString(), model: 'pim' });
          return;
        }

        // RENOMBRAR ESPECÍFICO
        else if (intencion.tipo === 'renombrar' && intencion.subtipo === 'especifico') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const nombreRenombrarRaw = intencion.parametros.nombre || '';
          const nombreRenombrar = nombreRenombrarRaw.charAt(0).toUpperCase() + nombreRenombrarRaw.slice(1);
          window.CHAT_HEADER?.startRename?.(nombreRenombrar);
          const planRenombrar = window.APP?.getCurrentPlan?.();
          if (planRenombrar) planRenombrar.titulo = nombreRenombrar;
          UI.addMessage('assistant', t('chat_renamed', { nombre: nombreRenombrar }));
          history.push({ role: 'assistant', content: t('chat_renamed', { nombre: nombreRenombrar }), time: new Date().toISOString() });
          return;
        }

        // RENOMBRAR VAGO
        else if (intencion.tipo === 'renombrar' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const msgEl = UI.addMessage('assistant', t('rename_ask'));
          UI.showRenameInput(msgEl);
          history.push({ role: 'assistant', content: t('rename_ask'), time: new Date().toISOString() });
          return;
        }

        // ESTILO RESUELTO
        else if (intencion.tipo === 'estilo' && intencion.subtipo === 'resuelto') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { prop, value, mapKey } = intencion.parametros;
          const activeLayers = window.MAP?.getActiveLayers?.() || {};
          if (mapKey) {
            const _curStyle = activeLayers[mapKey]?.style || {};
            const _curValue = prop === 'radius' ? (_curStyle.radius ?? 5)
                            : prop === 'weight' ? (_curStyle.weight ?? 2)
                            : null;
            if (_curValue !== null && Math.abs(value - _curValue) < 0.01) {
              const _limitMsg = value <= 0.5 ? t('style_already_min') : t('style_already_max');
              const msgLim = UI.addMessage('assistant', _limitMsg);
              UI.setMessageMeta(msgLim, { time: new Date(), model: 'pim' });
              history.push({ role: 'assistant', content: _limitMsg, time: new Date().toISOString(), model: 'pim' });
              return;
            }
            if (prop === 'color' && activeLayers[mapKey]?.classification?.field) {
              const warnEl = UI.addMessage('assistant', t('style_classified_warning'));
              UI.showClassifiedStyleChoice(warnEl, mapKey,
                () => {
                  UI.addMessage('assistant', t('style_reset_done'));
                },
                () => {
                  window.MAP?.clearClassification?.(mapKey);
                  _applyStyleProp(mapKey, prop, value);
                  const _entryA = window.MAP?.getActiveLayers?.()[mapKey];
                  const _titA   = _entryA?.tituloUI || _entryA?.titulo || mapKey;
                  UI.addMessage('assistant', t('style_applied_layer', { titulo: _titA }));
                }
              );
              history.push({ role: 'assistant', content: t('style_classified_warning'), time: new Date().toISOString() });
              return;
            }
            _applyStyleProp(mapKey, prop, value);
            const _entryApply = activeLayers[mapKey];
            const _titApply   = _entryApply?.tituloUI || _entryApply?.titulo || mapKey;
            const _appliedMsg = Object.keys(activeLayers).length > 1
              ? t('style_applied_layer', { titulo: _titApply })
              : t('style_applied');
            const msgEl = UI.addMessage('assistant', _appliedMsg);
            UI.setMessageMeta(msgEl, { time: new Date(), model: 'pim' });
            history.push({ role: 'assistant', content: _appliedMsg, time: new Date().toISOString(), model: 'pim' });
          } else {
            const msgEl = UI.addMessage('assistant', t('style_which_layer'));
            UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => {
              _applyStyleProp(selectedMapKey, prop, value);
            }, t('style_applied'));
            history.push({ role: 'assistant', content: t('style_which_layer'), time: new Date().toISOString() });
          }
          return;
        }

        // ESTILO VAGO
        else if (intencion.tipo === 'estilo' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const activeLayers = window.MAP?.getActiveLayers?.() || {};
          const layerEntries = Object.entries(activeLayers);
          const _PARAM_KEY = { color: 'style_ask_color', radius: 'style_ask_size', weight: 'style_ask_weight', icon: 'style_ask_icon', geom: 'style_ask_geom' };

          const _proceedStyleVago = (selectedMapKey) => {
            const entry = window.MAP?.getActiveLayers?.()[selectedMapKey];
            const _paramProceed = intencion?.parametros?.param;
            // Solo advertir sobre la clasificación si el prop es explícitamente 'color'
            // o si es un intent genérico (sin param) — en ese caso el flow de botones
            // excluirá el color automáticamente si hay clasificación, sin preguntar.
            const _isExplicitColor = _paramProceed === 'color';
            if (entry?.classification?.field && _isExplicitColor) {
              const warnEl = UI.addMessage('assistant', t('style_classified_warning'));
              UI.showClassifiedStyleChoice(warnEl, selectedMapKey,
                () => {
                  const int2 = { ...intencion, parametros: { ...intencion.parametros, _mapKey: selectedMapKey, _excludeColor: true } };
                  UI.showStyleFlowForLayer(int2, selectedMapKey);
                },
                () => {
                  window.MAP?.clearClassification?.(selectedMapKey);
                  const int2 = { ...intencion, parametros: { ...intencion.parametros, _mapKey: selectedMapKey } };
                  UI.showStyleFlowForLayer(int2, selectedMapKey);
                }
              );
              history.push({ role: 'assistant', content: t('style_classified_warning'), time: new Date().toISOString() });
            } else {
              // Sin param explícito + clasificación → excluir color del flow automáticamente
              const _excColor = entry?.classification?.field && !_paramProceed;
              const int2 = { ...intencion, parametros: { ...intencion.parametros, _mapKey: selectedMapKey, _excludeColor: _excColor || undefined } };
              UI.showStyleFlowForLayer(int2, selectedMapKey);
            }
          };

          if (layerEntries.length > 1) {
            const _paramVago = intencion?.parametros?.param;
            if (_paramVago) {
              UI.showStyleFlow(intencion);
              history.push({ role: 'assistant', content: t(_PARAM_KEY[_paramVago] || 'style_what_to_change'), time: new Date().toISOString() });
            } else {
              const msgEl = UI.addMessage('assistant', t('style_which_layer'));
              UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => _proceedStyleVago(selectedMapKey));
              history.push({ role: 'assistant', content: t('style_which_layer'), time: new Date().toISOString() });
            }
          } else if (layerEntries.length === 1) {
            const [[singleMapKey, singleEntry]] = layerEntries;
            const _paramSingle = intencion?.parametros?.param;
            const _isExplicitColorSingle = _paramSingle === 'color';
            if (singleEntry?.classification?.field && _isExplicitColorSingle) {
              const warnEl = UI.addMessage('assistant', t('style_classified_warning'));
              UI.showClassifiedStyleChoice(warnEl, singleMapKey,
                () => UI.showStyleFlow({ ...intencion, parametros: { ...intencion.parametros, _excludeColor: true } }),
                () => { window.MAP?.clearClassification?.(singleMapKey); UI.showStyleFlow(intencion); }
              );
              history.push({ role: 'assistant', content: t('style_classified_warning'), time: new Date().toISOString() });
            } else {
              // Sin param explícito + clasificación → excluir color del flow automáticamente
              const _excColor = singleEntry?.classification?.field && !_paramSingle;
              const intFinal = _excColor
                ? { ...intencion, parametros: { ...intencion.parametros, _excludeColor: true } }
                : intencion;
              UI.showStyleFlow(intFinal);
              const histContent = _paramSingle
                ? t(_PARAM_KEY[_paramSingle] || 'style_what_to_change')
                : t('style_what_to_change');
              history.push({ role: 'assistant', content: histContent, time: new Date().toISOString() });
            }
          }
          return;
        }

        // AGREGAR CAPA
        else if (intencion.tipo === 'agregar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const instruccionNueva = intencion.parametros.instruccion;
          const planActual = window.APP?.getCurrentPlan?.();
          const instruccionesExistentes = planActual?.instrucciones || [];

          const yaExiste = instruccionesExistentes.some(i => i.layerKey === instruccionNueva.layerKey);
          if (yaExiste) {
            UI.addMessage('assistant', t('layer_already_on_map'));
            history.push({ role: 'assistant', content: t('layer_already_on_map'), time: new Date().toISOString() });
            return;
          }

          const titulo = planActual?.titulo || CT().tituloDesdePlan([instruccionNueva]) || CT().generarTitulo(userText);
          const planCombinado = {
            titulo,
            instrucciones: [...instruccionesExistentes, instruccionNueva],
          };

          const msgEl = UI.addMessage('assistant', '');
          UI.showMapReady(planCombinado);
          const msgTime = new Date();
          UI.setMessageMeta(msgEl, { time: msgTime, model: 'pim' });
          if (!window.MAP_CONTROLS?.isMobile?.()) window.MAP_CONTROLS?.setMapVisible(true);
          try {
            await window.APP.renderMap(planCombinado);
            const tituloNuevaCapa = CT().tituloDesdePlan([instruccionNueva]) || instruccionNueva.layerKey;
            history.push({ role: 'assistant', content: `[intent] +${tituloNuevaCapa}`, time: msgTime.toISOString(), model: 'pim' });
            await saveChat(userText, planCombinado);
          } catch (e) {
            console.error('[CHAT] agregar intent error:', e);
          }
          return;
        }

        // QUITAR CAPA
        else if (intencion.tipo === 'quitar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { mapKey } = intencion.parametros;
          const activeLayers = window.MAP?.getActiveLayers?.() || {};

          if (!mapKey) {
            const msgEl = UI.addMessage('assistant', t('quitar_which_layer'));
            UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => {
              const _entryQ = activeLayers[selectedMapKey];
              _quitarCapa(selectedMapKey);
              UI.addMessage('assistant', t('layer_removed', { titulo: _entryQ?.titulo || selectedMapKey }));
            });
            history.push({ role: 'assistant', content: t('quitar_which_layer'), time: new Date().toISOString() });
            return;
          }

          const entry = activeLayers[mapKey];
          if (!entry) {
            UI.addMessage('assistant', t('layer_not_found'));
            history.push({ role: 'assistant', content: t('layer_not_found'), time: new Date().toISOString() });
            return;
          }
          _quitarCapa(mapKey);
          const tituloEliminada = entry.titulo || mapKey;
          const msgElQuitar = UI.addMessage('assistant', t('layer_removed', { titulo: tituloEliminada }));
          UI.setMessageMeta(msgElQuitar, { time: new Date(), model: 'pim' });
          history.push({ role: 'assistant', content: `[intent] -${tituloEliminada}`, time: new Date().toISOString(), model: 'pim' });
          return;
        }

        // VALIDACION ERROR
        else if (intencion.tipo === '_validacion_error') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { error, errorParams } = intencion.parametros;
          const msg = t(error, errorParams);
          UI.addMessage('assistant', msg || t('error_generic'));
          history.push({ role: 'assistant', content: msg, time: new Date().toISOString() });
          return;
        }

        // LIMPIAR ESTILO
        else if (intencion.tipo === 'limpiar_estilo') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { mapKey } = intencion.parametros;
          if (!mapKey) {
            const msgEl = UI.addMessage('assistant', t('style_which_layer'));
            UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => {
              const _entryReset = window.MAP?.getActiveLayers?.()[selectedMapKey];
              const _titReset   = _entryReset?.tituloUI || _entryReset?.titulo || selectedMapKey;
              _resetEstilo(selectedMapKey);
              UI.addMessage('assistant', t('style_reset_done_layer', { titulo: _titReset }));
            });
            history.push({ role: 'assistant', content: t('style_which_layer'), time: new Date().toISOString() });
          } else {
            const _entryReset = window.MAP?.getActiveLayers?.()[mapKey];
            const _titReset   = _entryReset?.tituloUI || _entryReset?.titulo || mapKey;
            _resetEstilo(mapKey);
            UI.addMessage('assistant', t('style_reset_done_layer', { titulo: _titReset }));
            history.push({ role: 'assistant', content: '[intent] reset style', time: new Date().toISOString(), model: 'pim' });
          }
          return;
        }

        // FILTRAR → delegar al LLM
        else if (intencion.tipo === 'filtrar') {
          UI.showThinking();
          // cae al LLM path intencionalmente — sin return
        }

        // SELECTOR CAPA
        else if (intencion.tipo === 'selector_capa') {
          isStreaming = false;
          UI.setSendEnabled(true);
          if (Object.keys(window.MAP?.getActiveLayers?.() || {}).length === 0) {
            const msgVacío = UI.addMessage('assistant', t('validate_no_layer'));
            UI.setMessageMeta(msgVacío, { time: new Date(), model: 'pim' });
            history.push({ role: 'assistant', content: t('validate_no_layer'), time: new Date().toISOString(), model: 'pim' });
            return;
          }
          const msgEl = UI.addMessage('assistant', t('selector_capa_msg'));
          UI.setMessageMeta(msgEl, { time: new Date(), model: 'pim' });
          const _textoOriginal = userText;
          UI.showLayerSelectorForAction(msgEl, async (selectedMapKey) => {
            const activeLayers = window.MAP?.getActiveLayers?.() || {};
            const entry = activeLayers[selectedMapKey];
            if (!entry) return;
            const intentCorregido = window.INTENT?.detectarIntencion?.(_textoOriginal + ' ' + (entry.titulo || selectedMapKey), history);
            if (intentCorregido && intentCorregido.tipo !== 'selector_capa') {
              if (intentCorregido.parametros) intentCorregido.parametros.mapKey = selectedMapKey;
              if (intentCorregido.tipo === 'quitar') {
                _quitarCapa(selectedMapKey);
                const tituloQ = entry.titulo || selectedMapKey;
                UI.addMessage('assistant', t('layer_removed', { titulo: tituloQ }));
                history.push({ role: 'assistant', content: `[intent] -${tituloQ}`, time: new Date().toISOString(), model: 'pim' });
              } else if (intentCorregido.tipo === 'estilo') {
                const int2 = { ...intentCorregido, parametros: { ...intentCorregido.parametros, mapKey: selectedMapKey } };
                UI.showStyleFlowForLayer(int2, selectedMapKey);
              } else {
                UI.addMessage('assistant', t('selector_capa_selected'));
              }
            } else {
              UI.addMessage('assistant', t('selector_capa_selected'));
            }
          });
          history.push({ role: 'assistant', content: t('selector_capa_msg'), time: new Date().toISOString() });
          return;
        }

        // LIMPIAR FILTRO → LLM
        else if (intencion.tipo === 'limpiar_filtro') {
          UI.showThinking();
          // cae al LLM path intencionalmente — sin return
        }

        // CAPA PREGUNTAR
        else if (intencion.tipo === 'capa_preguntar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { preguntar, instruccion, layerKey } = intencion.parametros;
          const layerDef = window.LAYERS?.[layerKey];
          const tituloLayer = layerDef?.tituloUI || layerDef?.titulo || layerKey;

          const _ejecutarConInstruccion = async (instruccionFinal) => {
            const plan = {
              titulo:        CT().tituloDesdePlan([instruccionFinal]) || CT().generarTitulo(userText),
              instrucciones: [instruccionFinal],
            };
            const msgEl2 = UI.addMessage('assistant', '');
            UI.showMapReady(plan);
            const msgTime = new Date();
            UI.setMessageMeta(msgEl2, { time: msgTime, model: 'pim' });
            if (!window.MAP_CONTROLS?.isMobile?.()) window.MAP_CONTROLS?.setMapVisible(true);
            try {
              await window.APP.renderMap(plan);
              history.push({ role: 'assistant', content: `[intent] ${plan.titulo}`, time: msgTime.toISOString(), model: 'pim' });
              await saveChat(userText, plan);
            } catch (e) {
              console.error('[CHAT] Error al renderizar:', e);
              UI.showErrorCard(t('error_layer_retry', { titulo: tituloLayer }));
            }
          };

          if (preguntar === 'distancia') {
            const msgEl = UI.addMessage('assistant', t('op_ask_distance', { titulo: tituloLayer }));
            UI.showNumberInput(msgEl, {
              placeholder: t('op_distance_placeholder'),
              unit:        'km',
              onConfirm:   (km) => {
                instruccion.withinDistance = parseFloat(km);
                _ejecutarConInstruccion(instruccion);
              },
            });
            history.push({ role: 'assistant', content: t('op_ask_distance', { titulo: tituloLayer }), time: new Date().toISOString() });

          } else if (preguntar === 'n') {
            const msgEl = UI.addMessage('assistant', t('op_ask_n', { titulo: tituloLayer }));
            UI.showNumberInput(msgEl, {
              placeholder: t('op_n_placeholder'),
              unit:        '',
              onConfirm:   (n) => {
                instruccion.nearestCount = parseInt(n, 10) || 1;
                _ejecutarConInstruccion(instruccion);
              },
            });
            history.push({ role: 'assistant', content: t('op_ask_n', { titulo: tituloLayer }), time: new Date().toISOString() });

          } else if (preguntar === 'area') {
            UI.addMessage('assistant', t('op_ask_area', { titulo: tituloLayer, op: instruccion.op || 'clip' }));
            history.push({ role: 'assistant', content: t('op_ask_area', { titulo: tituloLayer, op: instruccion.op || 'clip' }), time: new Date().toISOString() });

          } else if (preguntar === 'confirmar_dissolve_all') {
            const msgEl = UI.addMessage('assistant', t('op_ask_dissolve_all', { titulo: tituloLayer }));
            UI.showConfirmChoice(msgEl,
              t('op_dissolve_all_yes'),
              t('op_dissolve_all_no'),
              () => { _ejecutarConInstruccion(instruccion); },
              () => { UI.addMessage('assistant', t('op_ask_area', { titulo: tituloLayer, op: 'dissolve' })); }
            );
            history.push({ role: 'assistant', content: t('op_ask_dissolve_all', { titulo: tituloLayer }), time: new Date().toISOString() });
          }
          return;
        }

        else if (intencion.tipo === 'capa') {
          const instruccionDirecta = intencion.parametros.instruccion;
          const titulo = CT().tituloDesdePlan([instruccionDirecta]) || CT().generarTitulo(userText);
          const plan = { titulo, instrucciones: [instruccionDirecta] };
          const msgEl = UI.addMessage('assistant', '');
          UI.showMapReady(plan);
          const msgTime = new Date();
          UI.setMessageMeta(msgEl, { time: msgTime, model: 'pim' });
          if (!window.MAP_CONTROLS?.isMobile?.()) window.MAP_CONTROLS?.setMapVisible(true);
          try {
            await window.APP.renderMap(plan);
            history.push({ role: 'assistant', content: `[intent] ${titulo}`, time: msgTime.toISOString(), model: 'pim' });
            await saveChat(userText, plan);
          } catch (e) {
            console.error('[CHAT] capa intent error:', e);
          }
          return;
        }
      }

      // ── Sin intención detectada o intención que pasa al LLM ──
      const activeLayers = window.MAP?.getActiveLayers?.() || {};
      const activeLayersSummary = Object.entries(activeLayers).map(([, v]) => {
        return `${v.layerKey}: ${v.titulo} (${v.geomType})`;
      }).join(', ');

      _abortController = new AbortController();
      const resp = await fetch('/api/llm', {
        method:  'POST',
        signal:  _abortController.signal,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages: CU().sanitizeHistoryForLLM(history),
          layers:   window.LAYERS,
          sources:  window.SOURCES,
          userLang: window.SETTINGS?.get('lang') || window.I18N?.getLang?.() || navigator.language || null,
          model:    window.SETTINGS?.get('model') || 'auto',
          tone:     window.SETTINGS?.get('tone')  || 'default',
          activeMap: Object.keys(activeLayers).length ? {
            titulo:  window.APP?.getCurrentPlan?.()?.titulo || '',
            capas:   activeLayersSummary
          } : null
        })
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      UI.hideThinking();
      const msgEl = UI.addMessage('assistant', '');

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';
      let fullText  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const json = JSON.parse(data);

            if (json.error) {
              UI.setMessageText(msgEl, json.error);
              throw new Error(json.error);
            }

            if (json.token) {
              fullText += json.token;
              UI.setMessageText(msgEl, CU().stripBloques(fullText, true) || '');
            }

            if (json.done) {
              _lastModel = json.model || null;
              fullText = json.fullText || fullText;
              const mapPlan     = CU().extractMapPlan(fullText);
              const stylePlan   = CU().extractStylePlan(fullText);
              const basemapPlan = CU().extractBasemapPlan(fullText);
              const chatTitle   = CU().extractChatTitle(fullText);
              if (chatTitle) _pendingChatTitle = chatTitle;

              UI.setMessageText(msgEl, CU().stripBloques(fullText, false) || '');
              const msgTime = new Date();
              UI.setMessageMeta(msgEl, { time: msgTime, model: _lastModel });
              history.push({ role: 'assistant', content: fullText, time: msgTime.toISOString(), model: _lastModel, fromLLM: true });

              if (basemapPlan) window.MAP?.setBasemap?.(basemapPlan);

              const exportPlan   = CU().extractExportPlan(fullText);
              const exportChoice = CU().extractExportChoice(fullText);
              if (exportPlan) {
                const fmt = exportPlan.format;
                if      (fmt === 'pdf')     window.EXPORT?.toPDF?.();
                else if (fmt === 'jpeg')    window.EXPORT?.toJPEG?.();
                else if (fmt === 'geojson') window.EXPORT?.toGeoJSON?.();
                else if (fmt === 'html')    window.EXPORT?.toHTML?.();
              } else if (exportChoice) {
                UI.showExportChoice(msgEl);
              }

              if (mapPlan) {
                if (mapPlan[0]?.error) {
                  UI.addMessage('assistant', mapPlan[0].error);
                } else {
                  const tituloExistente = currentChatId
                    ? (window.APP?.getCurrentPlan?.()?.titulo || null)
                    : null;
                  const plan = {
                    titulo:        chatTitle || tituloExistente || CT().tituloDesdePlan(mapPlan) || CT().generarTitulo(userText),
                    instrucciones: mapPlan
                  };

                  if (stylePlan?.length) {
                    plan.instrucciones = plan.instrucciones.map(inst => {
                      const s = stylePlan.find(st => st.layerKey === inst.layerKey);
                      if (s) {
                        const { layerKey: _lk, ...styleChanges } = s;
                        return { ...inst, style: styleChanges };
                      }
                      return inst;
                    });
                  }

                  UI.showMapReady(plan);
                  if (!window.MAP_CONTROLS?.isMobile?.()) window.MAP_CONTROLS?.setMapVisible(true);
                  await window.APP.renderMap(plan);
                  await saveChat(userText, plan);
                  return;
                }
              }

              if (stylePlan?.length) window.APP?.applyStylePlan?.(stylePlan);

              await saveChat(userText, null);

              const modeChosen = localStorage.getItem('sm_mode_chosen');
              const isFirstResponse = history.filter(m => m.role === 'assistant').length === 1;
              const currentTone = window.SETTINGS?.get('tone') || 'default';
              if (!modeChosen && isFirstResponse && currentTone === 'default') {
                UI.showModeSelector();
              }
            }
          } catch (e) {
            if (e.message !== data) console.warn('[CHAT] Parse error:', e.message);
          }
        }
      }

    } catch (err) {
      if (err?.name === 'AbortError') { return; }
      UI.hideThinking();
      UI.addMessage('assistant', 'Algo salió mal. Intentá de nuevo.');
      console.error('[CHAT]', err);
      history.pop();
    } finally {
      isStreaming = false;
      _abortController = null;
      UI.setSendEnabled(true);
    }
  }

  // ── Guardar en Turso ────────────────────────────────────────

  async function saveChat(userText, mapPlan) {
    try {
      const user = window.AUTH?.currentUser();
      if (!user) return;

      const nuevoTitulo    = _pendingChatTitle;
      const tituloFallback = userText.length > 50 ? userText.slice(0, 50) + '\u2026' : userText;
      const titulo = nuevoTitulo || CT().toTitleCase(tituloFallback);
      _pendingChatTitle = null;

      if (!currentChatId) {
        const { id: newId, shortId } = await window.FB.createChat(user.uid, titulo);
        currentChatId = newId;
        SIDEBAR.setChatId(currentChatId);
        window.history.pushState(null, '', `/chat/${shortId}`);
        SIDEBAR.refreshChats();
        if (window.APP?.setChatHeader) window.APP.setChatHeader(titulo);
      } else if (nuevoTitulo) {
        const tituloNorm = CT().toTitleCase(titulo);
        if (window.APP?.setChatHeader) window.APP.setChatHeader(tituloNorm);
        await window.FB.updateChat(user.uid, currentChatId, { titulo: tituloNorm });
        SIDEBAR.updateCachedChat(currentChatId, { titulo: tituloNorm });
        SIDEBAR.refreshChats();
      } else if (mapPlan?.titulo) {
        const tituloActual = document.getElementById('chat-header-title')?.value?.trim() || null;
        const tituloNuevo  = CT().toTitleCase(mapPlan.titulo);
        if (tituloNuevo && tituloNuevo !== tituloActual) {
          if (window.APP?.setChatHeader) window.APP.setChatHeader(tituloNuevo);
          await window.FB.updateChat(user.uid, currentChatId, { titulo: tituloNuevo });
          SIDEBAR.updateCachedChat(currentChatId, { titulo: tituloNuevo });
          SIDEBAR.refreshChats();
        }
      }

      const data = { messages: history };
      const planToSave = mapPlan
        ? (window.APP?.getCurrentPlan?.() || mapPlan)
        : null;
      if (planToSave) data.lastMap = planToSave;

      await window.FB.updateChat(user.uid, currentChatId, data);
    } catch (err) {
      console.warn('[CHAT] No se pudo guardar:', err.message);
    }
  }

  // ── Restaurar chat desde Turso ──────────────────────────────

  function restore(chat) {
    history       = chat.messages || [];
    currentChatId = chat.id;
    if (chat.shortId) {
      window.history.replaceState(null, '', `/chat/${chat.shortId}`);
    }
  }

  function reset() {
    history       = [];
    currentChatId = null;
    window.history.replaceState?.(null, '', '/');
  }

  function getChatId()  { return currentChatId; }
  function getHistory() { return history; }

  // sanitizeForDisplay: alias público de CHAT_UTILS.stripBloques para uso externo (ej: app.js).
  function sanitizeForDisplay(text) {
    return CU().stripBloques(text, false);
  }

  function abort() {
    if (!isStreaming) return;
    _abortController?.abort();
    _abortController = null;
    isStreaming = false;
    UI.hideThinking();
    UI.setSendEnabled(true);
  }

  // toTitleCase expuesto para compatibilidad con código externo que lo usaba desde window.CHAT
  function toTitleCase(texto) {
    return CT().toTitleCase(texto);
  }

  return { send, reset, restore, abort, getChatId, getHistory, toTitleCase, sanitizeForDisplay };

})();
