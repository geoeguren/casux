/**
 * chat.js — Chat con streaming de tokens y persistencia en Turso
 */

window.CHAT = (() => {

  let history       = [];
  let currentChatId = null;
  let isStreaming        = false;
  let _abortController  = null;
  let _lastModel         = null;
  let _pendingChatTitle  = null;

  // ── Sanitizar historial para el LLM ──────────────────────────
  //
  // Los mensajes del asistente se guardan con los bloques de código
  // (```map, ```style, etc.) incluidos — necesarios para persistencia y
  // para restaurar el estado. Pero enviárselos al LLM consume tokens
  // innecesarios y puede confundirlo en conversaciones largas.
  // Esta función devuelve una copia del historial con esos bloques
  // eliminados solo de los mensajes del asistente.

  function sanitizeHistoryForLLM(messages) {
    return messages
      // Filtrar mensajes internos del intent parser — no deben llegar al LLM
      // porque el LLM los imita y los reproduce en sus respuestas.
      .filter(m => !(m.role === 'assistant' && m.content?.startsWith('[intent]')))
      .map(m => {
        if (m.role !== 'assistant') return m;
        const clean = m.content
          .replace(/```map[\s\S]*?```/g, '')
          .replace(/```style[\s\S]*?```/g, '')
          .replace(/```classify[\s\S]*?```/g, '')
          .replace(/```chat-title[\s\S]*?```\s*/g, '')
          .replace(/```export-choice[\s\S]*?```/g, '')
          .replace(/```export[\s\S]*?```/g, '')
          .trim();
        return { ...m, content: clean };
      });
  }

  // ── Helpers privados de intención ────────────────────────────

  // Aplica toggle de visibilidad y persiste en el plan
  function _toggleVisibilidad(mapKey, visible) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entry = activeLayers[mapKey];
    if (!entry) return;

    const estadoActual = entry.visible !== false; // true si visible
    const nuevoVisible = (visible === null || visible === undefined) ? !estadoActual : visible;

    if (nuevoVisible === estadoActual) return; // ya está en el estado deseado

    window.MAP?.toggleLayerVisibility?.(mapKey);

    // Persistir en el plan
    const planActual = window.APP?.getCurrentPlan?.();
    if (planActual?.instrucciones) {
      const inst = planActual.instrucciones.find(i => i.mapKey === mapKey);
      if (inst) inst.visible = nuevoVisible;
    }
    const user   = window.AUTH?.currentUser?.();
    const chatId = window.CHAT?.getChatId?.();
    if (user && chatId && planActual) {
      window.FB?.updateChat?.(user.uid, chatId, { lastMap: planActual }).catch(() => {});
    }
  }

  // Aplica un cambio de estilo por propiedad y valor ya resueltos
  function _applyStyleProp(mapKey, prop, value) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entry = activeLayers[mapKey];
    if (!entry) return;

    let styleChanges;
    if (prop === 'color') {
      const geom = entry.geomType || 'polygon';
      // _darkenHex está definido dentro del módulo UI — accedemos desde fuera
      // a través de un helper local equivalente
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
      // radius, weight
      styleChanges = { [prop]: value };
    }

    const newStyle = { ...entry.style, ...styleChanges };
    window.MAP?.updateLayerStyle?.(mapKey, newStyle);
    window.MAP?.updateLegend?.();
    window.ANALYTICS?.styleChanged?.('intent');

    // Persistir
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

    // En móvil: mostrar botón "Ver mapa" si el panel está oculto
    if (window.MAP_CONTROLS?.isMobile?.()) {
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel?.style.display === 'none') UI.showViewMapBtn?.();
    }
  }

  // Quita una capa del mapa y la elimina del plan persistido
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
      // Track antes de procesar — el intent se refinará abajo
      const _intentLabel = intencion?.tipo || 'llm';
      window.ANALYTICS?.chatMessageSent?.(_intentLabel);

      if (intencion) {
        UI.hideThinking();

        // LIMPIAR → solo limpiar capas, no el historial
        if (intencion.tipo === 'limpiar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          window.MAP?.clearAll?.();
          window.MAP?.resetView?.();
          window.MAP?.updateLegend?.();
          const msgEl = UI.addMessage('assistant', t('map_cleared'));
          history.push({ role: 'assistant', content: t('map_cleared'), time: new Date().toISOString() });
          return;
        }

        // EXPORT VAGO → mostrar opciones
        if (intencion.tipo === 'export' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const msgEl = UI.addMessage('assistant', t('export_choose_format'));
          UI.showExportChoice(msgEl);
          history.push({ role: 'assistant', content: t('export_choose_format'), time: new Date().toISOString() });
          return;
        }

        // EXPORT ESPECÍFICO
        if (intencion.tipo === 'export') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const fmt = intencion.subtipo;
          // jpeg y pdf → abrir modal de salida gráfica con el formato preseleccionado
          if (fmt === 'jpeg' || fmt === 'pdf') {
            window.EXPORT_GRAPHIC?.open?.(fmt);
          } else if (fmt === 'geojson') {
            window.EXPORT?.toGeoJSON?.();
          } else if (fmt === 'html') {
            window.EXPORT?.toHTML?.();
          }
          return;
        }

        // BASEMAP VAGO → mostrar botones
        if (intencion.tipo === 'basemap' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const msgEl = UI.addMessage('assistant', t('basemap_choose'));
          UI.showBasemapButtons(msgEl);
          history.push({ role: 'assistant', content: t('basemap_choose'), time: new Date().toISOString() });
          return;
        }

        // BASEMAP ESPECÍFICO → aplicar directo
        else if (intencion.tipo === 'basemap') {
          isStreaming = false;
          UI.setSendEnabled(true);
          window.MAP?.setBasemap?.(intencion.subtipo);
          const msgEl = UI.addMessage('assistant', t('basemap_changed'));
          history.push({ role: 'assistant', content: t('basemap_changed'), time: new Date().toISOString() });
          return;
        }

        // RENOMBRAR ESPECÍFICO → ejecutar directo
        else if (intencion.tipo === 'renombrar' && intencion.subtipo === 'especifico') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const nombreRenombrar = intencion.parametros.nombre;
          window.CHAT_HEADER?.startRename?.(nombreRenombrar);
          // Actualizar también el título del mapa activo
          const planRenombrar = window.APP?.getCurrentPlan?.();
          if (planRenombrar) planRenombrar.titulo = toTitleCase(nombreRenombrar);
          UI.addMessage('assistant', t('chat_renamed', { nombre: nombreRenombrar }));
          history.push({ role: 'assistant', content: t('chat_renamed', { nombre: nombreRenombrar }), time: new Date().toISOString() });
          return;
        }

        // RENOMBRAR VAGO → mostrar input inline sin LLM
        else if (intencion.tipo === 'renombrar' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const msgEl = UI.addMessage('assistant', t('rename_ask'));
          UI.showRenameInput(msgEl);
          history.push({ role: 'assistant', content: t('rename_ask'), time: new Date().toISOString() });
          return;
        }

        // ESTILO RESUELTO → aplicar directamente o mostrar selector de capa
        else if (intencion.tipo === 'estilo' && intencion.subtipo === 'resuelto') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { prop, value, mapKey } = intencion.parametros;
          if (mapKey) {
            // Una sola capa activa → aplicar directo
            _applyStyleProp(mapKey, prop, value);
            const msgEl = UI.addMessage('assistant', t('style_applied'));
            history.push({ role: 'assistant', content: t('style_applied'), time: new Date().toISOString() });
          } else {
            // Varias capas → selector de capa, luego aplicar
            const msgEl = UI.addMessage('assistant', t('style_which_layer'));
            UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => {
              _applyStyleProp(selectedMapKey, prop, value);
            }, t('style_applied'));
            history.push({ role: 'assistant', content: t('style_which_layer'), time: new Date().toISOString() });
          }
          return;
        }

        // ESTILO VAGO → mostrar botones contextuales
        else if (intencion.tipo === 'estilo' && intencion.subtipo === 'vago') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const activeLayers = window.MAP?.getActiveLayers?.() || {};
          const layerEntries = Object.entries(activeLayers);
          if (layerEntries.length > 1) {
            // Varias capas → selector de capa primero, luego flujo de estilo
            const msgEl = UI.addMessage('assistant', t('style_which_layer'));
            UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => {
              const intencionConCapa = { ...intencion, parametros: { ...intencion.parametros, _mapKey: selectedMapKey } };
              UI.showStyleFlowForLayer(intencionConCapa, selectedMapKey);
            });
            history.push({ role: 'assistant', content: t('style_which_layer'), time: new Date().toISOString() });
          } else {
            const msgEl = UI.showStyleFlow(intencion);
            const histContent = intencion?.parametros?.param
              ? t('style_ask_' + intencion.parametros.param) || t('style_what_to_change')
              : t('style_what_to_change');
            history.push({ role: 'assistant', content: histContent, time: new Date().toISOString() });
          }
          return;
        }

        // ESTILO ESPECÍFICO → pasa al LLM con contexto
        // (no retorna, continúa al LLM)

        // AGREGAR CAPA → acumular al plan activo sin limpiar el mapa
        else if (intencion.tipo === 'agregar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const instruccionNueva = intencion.parametros.instruccion;
          const planActual = window.APP?.getCurrentPlan?.();
          const instruccionesExistentes = planActual?.instrucciones || [];

          // Evitar duplicado: si ya hay una capa con el mismo layerKey, no agregar
          const yaExiste = instruccionesExistentes.some(i => i.layerKey === instruccionNueva.layerKey);
          if (yaExiste) {
            const msgEl = UI.addMessage('assistant', t('layer_already_on_map'));
            history.push({ role: 'assistant', content: t('layer_already_on_map'), time: new Date().toISOString() });
            return;
          }

          const titulo = planActual?.titulo || tituloDesdePlan([instruccionNueva]) || generarTitulo(userText);
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
            const tituloNuevaCapa = tituloDesdePlan([instruccionNueva]) || instruccionNueva.layerKey;
            history.push({ role: 'assistant', content: `[intent] +${tituloNuevaCapa}`, time: msgTime.toISOString(), model: 'pim' });
            await saveChat(userText, planCombinado);
          } catch (e) {
            console.error('[CHAT] agregar intent error:', e);
          }
          return;
        }

        // TOGGLE VISIBILIDAD → mostrar/ocultar capa activa
        else if (intencion.tipo === 'toggle_visibilidad') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { mapKey, visible } = intencion.parametros;
          const activeLayers = window.MAP?.getActiveLayers?.() || {};

          // Sin capas en el mapa → mensaje informativo
          if (!Object.keys(activeLayers).length) {
            UI.addMessage('assistant', t('layer_not_found'));
            history.push({ role: 'assistant', content: t('layer_not_found'), time: new Date().toISOString() });
            return;
          }

          if (mapKey) {
            // Capa identificada → ejecutar directo
            _toggleVisibilidad(mapKey, visible);
            const entry = activeLayers[mapKey];
            const tituloToggle = entry?.titulo || mapKey;
            const msg = visible
              ? t('layer_shown',  { titulo: tituloToggle })
              : t('layer_hidden', { titulo: tituloToggle });
            UI.addMessage('assistant', msg);
            history.push({ role: 'assistant', content: `[intent] ${visible ? '+vis' : '-vis'} ${tituloToggle}`, time: new Date().toISOString(), model: 'pim' });
          } else {
            // mapKey null → varias capas, mostrar selector
            const msgEl = UI.addMessage('assistant', t('toggle_which_layer'));
            UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => {
              _toggleVisibilidad(selectedMapKey, visible);
              const entry2 = window.MAP?.getActiveLayers?.()[selectedMapKey];
              const titulo2 = entry2?.titulo || selectedMapKey;
              UI.addMessage('assistant', visible ? t('layer_shown', { titulo: titulo2 }) : t('layer_hidden', { titulo: titulo2 }));
            });
            history.push({ role: 'assistant', content: t('toggle_which_layer'), time: new Date().toISOString() });
          }
          return;
        }

        // QUITAR CAPA → eliminar una capa del mapa activo
        else if (intencion.tipo === 'quitar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { mapKey } = intencion.parametros;
          const activeLayers = window.MAP?.getActiveLayers?.() || {};

          if (!mapKey) {
            // Pedido vago con varias capas → selector de capa
            const msgEl = UI.addMessage('assistant', t('quitar_which_layer'));
            UI.showLayerSelectorForAction(msgEl, (selectedMapKey) => {
              _quitarCapa(selectedMapKey);
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
          UI.addMessage('assistant', t('layer_removed', { titulo: tituloEliminada }));
          history.push({ role: 'assistant', content: `[intent] -${tituloEliminada}`, time: new Date().toISOString(), model: 'pim' });
          return;
        }

        // CLASIFICAR → clasificación cromática de capa activa sin LLM
        else if (intencion.tipo === 'clasificar') {
          isStreaming = false;
          UI.setSendEnabled(true);
          const { mapKey, layerKey, field, label, type, palette } = intencion.parametros;

          if (!field) {
            // Campo no identificado → mostrar selector de campo clasificable
            const msgEl = UI.addMessage('assistant', t('classify_which_field'));
            UI.showFieldSelectorForClassify(msgEl, mapKey, layerKey);
            history.push({ role: 'assistant', content: t('classify_which_field'), time: new Date().toISOString() });
            return;
          }

          const paletteColors = window.PALETTES?.[palette] || window.PALETTES?.qualitative;
          const classifyPlan = [{ layerKey, field, type, palette, paletteColors }];
          window.APP?.applyClassifyPlan?.(classifyPlan);
          const msg = t('classify_done', { label: label || field });
          UI.addMessage('assistant', msg);
          history.push({ role: 'assistant', content: `[intent] classify ${layerKey} by ${field}`, time: new Date().toISOString(), model: 'pim' });

          // En móvil: mostrar botón "Ver mapa" si el panel está oculto
          if (window.MAP_CONTROLS?.isMobile?.()) {
            const mapPanel = document.getElementById('map-panel');
            if (mapPanel?.style.display === 'none') UI.showViewMapBtn?.();
          }
          return;
        }

        // CAPA → resolver sin LLM
        else if (intencion.tipo === 'capa') {
          const instruccionDirecta = intencion.parametros.instruccion;
          const titulo = tituloDesdePlan([instruccionDirecta]) || generarTitulo(userText);
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
            // renderMap y saveChat tienen su propio manejo de errores,
            // pero si lanzan igual, evitamos que el catch externo haga history.pop()
            // sobre el mensaje del usuario (que es válido).
            console.error('[CHAT] capa intent error:', e);
          }
          return;
        }
      }

      // ── Sin intención detectada o intención que pasa al LLM ──
      const activeLayers = window.MAP?.getActiveLayers?.() || {};
      const activeLayersSummary = Object.entries(activeLayers).map(([, v]) => 
        `${v.layerKey}: ${v.titulo} (${v.geomType})`
      ).join(', ');

      _abortController = new AbortController();
      const resp = await fetch('/api/llm', {
        method:  'POST',
        signal:  _abortController.signal,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages: sanitizeHistoryForLLM(history),
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
              UI.setMessageText(msgEl, stripBloques(fullText, true) || '');
            }

            if (json.done) {
              _lastModel = json.model || null;
              fullText = json.fullText || fullText;
              const mapPlan      = extractMapPlan(fullText);
              const stylePlan    = extractStylePlan(fullText);
              const classifyPlan = extractClassifyPlan(fullText);
              const basemapPlan  = extractBasemapPlan(fullText);
              const chatTitle    = extractChatTitle(fullText);
              if (chatTitle) _pendingChatTitle = chatTitle;

              UI.setMessageText(msgEl, stripBloques(fullText, false) || '');
              const msgTime = new Date();
              UI.setMessageMeta(msgEl, { time: msgTime, model: _lastModel });
              history.push({ role: 'assistant', content: fullText, time: msgTime.toISOString(), model: _lastModel, fromLLM: true });

              // classifyPlan se aplica siempre que venga (no depende del mapa)
              if (classifyPlan?.length) window.APP?.applyClassifyPlan?.(classifyPlan);

              // basemapPlan — cambiar mapa base
              if (basemapPlan) window.MAP?.setBasemap?.(basemapPlan);

              const exportPlan  = extractExportPlan(fullText);
              const exportChoice = extractExportChoice(fullText);
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
                  // Si ya hay un chat con mapa previo y el LLM no sugirió título,
                  // preservar el título actual del chat (es un refinamiento, no un mapa nuevo).
                  const tituloExistente = currentChatId
                    ? (window.APP?.getCurrentPlan?.()?.titulo || null)
                    : null;
                  const plan = {
                    titulo:        chatTitle || tituloExistente || tituloDesdePlan(mapPlan) || generarTitulo(userText),
                    instrucciones: mapPlan
                  };

                  // Si viene style junto al map, guardarlo en las instrucciones
                  // para que renderMap lo aplique después de cargar las capas
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

              // stylePlan sin mapPlan = cambio de estilo sobre capas existentes
              if (stylePlan?.length) window.APP?.applyStylePlan?.(stylePlan);

              await saveChat(userText, null);

              // ── Selector de modo en primer chat ──────────────────
              // Si el usuario nunca eligió un modo explícito (tono = 'default'
              // por factory default, no por elección propia) y esta es la
              // primera respuesta del asistente, mostrar la botonera de modo.
              // La clave 'sm_mode_chosen' marca que el usuario ya eligió.
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
      if (err?.name === 'AbortError') { return; } // stop voluntario
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

      // Usar título sugerido por el LLM, o el texto del usuario como fallback
      const nuevoTitulo  = _pendingChatTitle;
      const tituloFallback = userText.length > 50 ? userText.slice(0, 50) + '\u2026' : userText;
      const titulo = nuevoTitulo || toTitleCase(tituloFallback);
      _pendingChatTitle = null;

      if (!currentChatId) {
        const { id: newId, shortId } = await window.FB.createChat(user.uid, titulo);
        currentChatId = newId;
        SIDEBAR.setChatId(currentChatId);
        window.history.pushState(null, '', `/chat/${shortId}`);
        SIDEBAR.refreshChats();
        // Mostrar título en la barra superior
        if (window.APP?.setChatHeader) window.APP.setChatHeader(titulo);
      } else if (nuevoTitulo) {
        // El LLM sugirió un título explícito → actualizar siempre (mapa nuevo o cambio de tema)
        const tituloNorm = toTitleCase(titulo);
        if (window.APP?.setChatHeader) window.APP.setChatHeader(tituloNorm);
        await window.FB.updateChat(user.uid, currentChatId, { titulo: tituloNorm });
        SIDEBAR.updateCachedChat(currentChatId, { titulo: tituloNorm });
        SIDEBAR.refreshChats();
      } else if (mapPlan?.titulo) {
        // El plan trae un título (resuelto por PIM sin pasar por LLM).
        // Comparar con el título visible en el header (no con getCurrentPlan,
        // que ya fue pisado por renderMap antes de llegar acá).
        const tituloActual = document.getElementById('chat-header-title')?.value?.trim() || null;
        const tituloNuevo  = toTitleCase(mapPlan.titulo);
        if (tituloNuevo && tituloNuevo !== tituloActual) {
          if (window.APP?.setChatHeader) window.APP.setChatHeader(tituloNuevo);
          await window.FB.updateChat(user.uid, currentChatId, { titulo: tituloNuevo });
          SIDEBAR.updateCachedChat(currentChatId, { titulo: tituloNuevo });
          SIDEBAR.refreshChats();
        }
      }

      const data = { messages: history };
      // Usar currentPlan de APP si existe (preserva título y nombres editados por el usuario)
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

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * stripBloques(text, streaming)
   *
   * Elimina del texto todos los bloques de código que el LLM emite como
   * instrucciones internas (map, style, classify, basemap, chat-title,
   * export, export-choice). El texto resultante es el único que se
   * muestra al usuario — nunca debe contener código ni backticks de bloque.
   *
   * Estrategia: parsear el texto en segmentos en lugar de aplicar múltiples
   * regex en cadena. Cada ``` abre o cierra un bloque; todo lo que esté
   * dentro de un bloque se descarta. Así el orden de los bloques, su nombre,
   * y si están pegados entre sí no importan.
   *
   * streaming=true  → hay un bloque abierto al final (LLM aún escribe): descartar.
   * streaming=false → texto completo; bloque sin cerrar al final también se descarta.
   */
  function stripBloques(text, streaming) {
    const segments = [];
    // Recorre el texto encontrando secuencias de ```.
    // Grupo 1 captura el nombre de lenguaje si lo hay (apertura de bloque).
    // Sin grupo 1: puede ser cierre de bloque o ``` solo al final del stream.
    const re = /```(\w[-\w]*)?/g;
    let inBlock = false;
    let lastIdx = 0;
    let m;

    while ((m = re.exec(text)) !== null) {
      const hasLang = m[1] !== undefined;

      if (!inBlock) {
        if (hasLang) {
          // Apertura con nombre: texto hasta acá es visible, lo que sigue es bloque
          segments.push(text.slice(lastIdx, m.index));
          inBlock = true;
        } else {
          // ``` sin nombre fuera de bloque: puede ser cierre de inline-code
          // o el inicio de un bloque cuyo nombre aún no llegó (streaming).
          // En ambos casos, ocultar desde este punto para que no aparezcan
          // backticks sueltos en pantalla. El texto visible ya fue empujado.
          segments.push(text.slice(lastIdx, m.index));
          lastIdx = text.length; // ocultar el resto hasta que se resuelva
          break;
        }
      } else {
        if (!hasLang) {
          // Cierre: descartar contenido del bloque, reanudar desde acá
          inBlock = false;
          lastIdx = re.lastIndex;
        }
        // ``` con nombre dentro de bloque: ignorar
      }
    }

    // Texto después del último bloque cerrado — visible
    if (!inBlock && lastIdx <= text.length) {
      segments.push(text.slice(lastIdx));
    }
    // Si inBlock=true: bloque sin cerrar → se descarta silenciosamente.

    const joined = segments.join('').replace(/\n{3,}/g, '\n\n').trim();

    // Sanitización defensiva: eliminar líneas que el LLM pudo haber emitido
    // como texto plano en lugar de dentro de un bloque (ej: "style [...]").
    // Detecta líneas que empiezan con una clave de bloque interno seguida de JSON.
    const bloqueKeys = /^(map|style|classify|basemap|chat-title|export|export-choice)\s*[\[\{`]/;
    const lines = joined.split('\n');
    const filtered = lines.filter(l => !bloqueKeys.test(l.trim()));
    const result = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    // Si el LLM devolvió un JSON array con {error} sin envolverlo en un bloque,
    // descartarlo — el texto técnico nunca debe mostrarse al usuario.
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed) && parsed[0]?.error) return '';
    } catch { /* no es JSON, continuar normal */ }

    return result;
  }

  function extractMapPlan(text) {
    const match = text.match(/```map\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  function extractChatTitle(text) {
    // [^`]*? para no cruzar al ``` de apertura del bloque siguiente
    const match = text.match(/```chat-title[^\n]*\n([^`]*?)```/);
    return match ? toTitleCase(match[1].trim()) : null;
  }

  function extractStylePlan(text) {
    const match = text.match(/```style\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  function extractClassifyPlan(text) {
    const match = text.match(/```classify\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  function extractBasemapPlan(text) {
    const match = text.match(/```basemap\s*([\s\S]*?)```/);
    if (!match) return null;
    const key = match[1].trim().toLowerCase();
    return ['gray', 'dark', 'voyager'].includes(key) ? key : null;
  }

  function extractExportPlan(text) {
    const match = text.match(/```export\s*([\s\S]*?)```/);
    if (!match) return null;
    try { return JSON.parse(match[1].trim()); } catch { return null; }
  }

  function extractExportChoice(text) {
    return /```export-choice[\s\S]*?```/.test(text);
  }

  // ── Utilidades de texto ──────────────────────────────────────
  // ── Capitalización de títulos ─────────────────────────────────
  //
  // Construye un lookup normNombre → valorCanónico desde window.GEO_MAPS
  // y window.SOURCES. Se reconstruye en cada llamada para reflejar
  // automáticamente nuevos países o fuentes agregados al sistema.
  //
  // Estructura GEO_MAPS: { [pais]: { [tipo]: { valores: { normNombre: { value } | [...] } } } }
  // Estructura SOURCES:  { [key]: { countryLabel, country } }

  function _buildGeoLookup() {
    const lookup = {};

    // Nombres de países desde SOURCES
    for (const src of Object.values(window.SOURCES || {})) {
      if (src.countryLabel) {
        const norm = src.countryLabel.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        lookup[norm] = src.countryLabel;
      }
    }

    // Nombres geográficos desde GEO_MAPS (provincias, departamentos, localidades, etc.)
    for (const tipos of Object.values(window.GEO_MAPS || {})) {
      for (const meta of Object.values(tipos)) {
        for (const [norm, entrada] of Object.entries(meta.valores || {})) {
          // Entrada ambigua (array) → tomar el primer valor como referencia
          const canonico = Array.isArray(entrada)
            ? entrada[0]?.value
            : (typeof entrada === 'string' ? entrada : entrada?.value);
          if (canonico && !lookup[norm]) lookup[norm] = canonico;
        }
      }
    }

    return lookup;
  }

  // Stopwords para title case en inglés
  const _EN_STOPWORDS = new Set([
    'a','an','the','and','but','or','nor','for','so','yet',
    'at','by','in','of','on','to','up','as','via','vs',
  ]);

  function toTitleCase(texto) {
    if (!texto) return texto;
    const t = texto.trim();
    if (!t) return t;

    const lang = window.SETTINGS?.get('lang') || window.I18N?.getLang?.() || 'es';

    if (lang === 'en') {
      // Inglés: title case (capitalizar todo salvo stopwords internas)
      return t.split(/\s+/).map((word, i) => {
        const lower = word.toLowerCase();
        if (i > 0 && _EN_STOPWORDS.has(lower)) return lower;
        return word.charAt(0).toUpperCase() + word.slice(1);
      }).join(' ');
    }

    // Español y portugués: primera letra + nombres propios geográficos
    const firstCap = t.charAt(0).toUpperCase() + t.slice(1);

    const lookup = _buildGeoLookup();
    if (!Object.keys(lookup).length) return firstCap;

    // Reemplazar palabras o frases que sean nombres propios conocidos.
    // Se itera de mayor a menor longitud de frase para evitar reemplazos parciales
    // (ej: "Entre Ríos" antes que "Ríos").
    const words    = firstCap.split(/\s+/);
    const replaced = new Array(words.length).fill(false);

    const maxPhrase = Math.min(4, words.length);
    for (let len = maxPhrase; len >= 1; len--) {
      for (let i = 0; i <= words.length - len; i++) {
        if (replaced.slice(i, i + len).some(Boolean)) continue;
        const phrase = words.slice(i, i + len).join(' ');
        const norm   = phrase.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const canonico = lookup[norm];
        if (canonico) {
          // Reemplazar las palabras del fragmento con el valor canónico
          const canonical = canonico.split(/\s+/);
          for (let j = 0; j < len; j++) {
            words[i + j]    = canonical[j] || words[i + j];
            replaced[i + j] = true;
          }
        }
      }
    }

    return words.join(' ');
  }

  /**
   * tituloDesdePlan(instrucciones) → string | null
   *
   * Construye un título de mapa/chat desde las instrucciones del plan.
   * Formato: "nombre_corto_capa — recorte_espacial"
   *
   * Cuando hay recorte → usa titulo (nombre corto sin país) para evitar
   * redundancia: "Red vial nacional — Córdoba", no "Red vial nacional de
   * Argentina — Córdoba".
   * Cuando no hay recorte → usa tituloUI completo: "Red vial nacional de Argentina".
   *
   * Reconoce todos los campos de área que puede emitir construirInstruccion:
   * clipArea, intersectArea, withinArea, adjacentArea, nearestArea, dissolveArea.
   *
   * Con varias capas: construye "A + B — recorte" o "A + B" si son ≤ 3.
   * Devuelve null si no puede resolver al menos el nombre de la primera capa.
   */
  function tituloDesdePlan(instrucciones) {
    if (!instrucciones?.length) return null;

    const _lang = window.I18N?.getLang?.() || 'es';
    const _suf  = _lang === 'en' ? 'En' : _lang === 'pt' ? 'Pt' : 'Es';

    // ── Resolver nombre de una capa ───────────────────────────
    //
    // Sin recorte → tituloUI completo: "Ríos de Argentina"
    // Con recorte → tituloUI sin el sufijo geográfico: "Ríos"
    //   Se quita " de Argentina/Uruguay/Chile/..." y variantes PT/EN.
    //   Fallback: titulo (nombre WFS, singular) si no hay tituloUI.
    function _nombreCapa(inst, conRecorte) {
      const capa = window.LAYERS?.[inst.layerKey];
      if (!capa) return inst.tituloUI || inst.layerKey;
      const tituloUI = capa[`tituloUI${_suf}`] || capa.tituloUI || '';
      if (!conRecorte) return tituloUI || capa.titulo || inst.layerKey;
      // Quitar el sufijo geográfico del tituloUI para obtener nombre corto
      // Patrones: " de X", " of X", " do X", " da X", " del X" al final
      const sinSufijo = tituloUI
        .replace(/\s+(?:de|of|do|da|del|of\s+the)\s+\S.*$/i, '')
        .trim();
      // Si quitando el sufijo quedó algo razonable (≥3 chars), usarlo
      if (sinSufijo && sinSufijo.length >= 3) return sinSufijo;
      // Si no, usar el tituloUI completo (mejor que el titulo singular)
      return tituloUI || capa.titulo || inst.layerKey;
    }

    // ── Extraer recorte espacial de una instrucción ───────────
    //
    // Precedencia: clipArea > intersectArea > withinArea > adjacentArea
    //              > nearestArea > dissolveArea > filtro (dissolve por atributo)
    //
    // Devuelve { valor, op } donde valor es string o array, op es la operación.
    function _extraerRecorte(inst) {
      if (inst.clipArea?.value)      return { valor: inst.clipArea.value,      op: inst.op || 'clip' };
      if (inst.intersectArea?.value) return { valor: inst.intersectArea.value, op: 'intersect' };
      if (inst.withinArea?.value)    return { valor: inst.withinArea.value,     op: 'within' };
      if (inst.adjacentArea?.value)  return { valor: inst.adjacentArea.value,   op: 'adjacent' };
      if (inst.nearestArea?.value)   return { valor: inst.nearestArea.value,    op: 'nearest' };
      if (inst.dissolveArea?.value)  return { valor: inst.dissolveArea.value,   op: 'dissolve' };
      // Paso E: within/nearest referenciado a otra capa (refLayerKey)
      if (inst.refLayerKey && (inst.op === 'within_layer' || inst.op === 'nearest')) {
        const refCapa = window.LAYERS?.[inst.refLayerKey];
        const refNombre = refCapa?.[`tituloUI${_suf}`] || refCapa?.tituloUI || inst.refLayerKey;
        return { valor: refNombre, op: inst.op };
      }
      return null;
    }

    // ── Formatear el fragmento de área según la operación ─────
    function _formatearArea(recorte, nearestCount) {
      if (!recorte) return null;
      const { valor, op } = recorte;
      const valorStr = Array.isArray(valor) ? valor.join(', ') : valor;

      if (_lang === 'en') {
        if (op === 'intersect' || op === 'intersect_exclude') return valorStr;
        if (op === 'within' || op === 'within_layer')  {
          const km = nearestCount || '';
          return km ? `within ${km} km of ${valorStr}` : `near ${valorStr}`;
        }
        if (op === 'adjacent' || op === 'adjacent_exclude') return `bordering ${valorStr}`;
        if (op === 'nearest' || op === 'nearest_exclude') {
          const n = nearestCount > 1 ? `${nearestCount} nearest to` : 'nearest to';
          return `${n} ${valorStr}`;
        }
        return valorStr;
      }

      if (_lang === 'pt') {
        if (op === 'within' || op === 'within_layer') {
          const km = nearestCount || '';
          return km ? `a ${km} km de ${valorStr}` : `perto de ${valorStr}`;
        }
        if (op === 'adjacent' || op === 'adjacent_exclude') return `limítrofes com ${valorStr}`;
        if (op === 'nearest' || op === 'nearest_exclude') {
          const n = nearestCount > 1 ? `os ${nearestCount} mais próximos de` : 'o mais próximo de';
          return `${n} ${valorStr}`;
        }
        return valorStr;
      }

      // ES (default)
      if (op === 'within' || op === 'within_layer') {
        const km = nearestCount || '';
        return km ? `a ${km} km de ${valorStr}` : `cerca de ${valorStr}`;
      }
      if (op === 'adjacent' || op === 'adjacent_exclude') return `limítrofes con ${valorStr}`;
      if (op === 'nearest' || op === 'nearest_exclude') {
        const n = nearestCount > 1 ? `los ${nearestCount} más cercanos a` : 'el más cercano a';
        return `${n} ${valorStr}`;
      }
      // clip, intersect, dissolve: solo el nombre del área
      return valorStr;
    }

    // ── Construir el título ───────────────────────────────────

    // Tomar hasta 3 instrucciones para el título (evitar títulos kilométricos)
    const MAX_CAPAS_TITULO = 3;
    const insts = instrucciones.slice(0, MAX_CAPAS_TITULO);

    // Recorte: usar el de la primera instrucción que tenga uno
    let recorte = null;
    for (const inst of insts) {
      recorte = _extraerRecorte(inst);
      if (recorte) break;
    }

    const conRecorte = !!recorte;

    // Nombres de capas
    const nombres = insts
      .map(inst => _nombreCapa(inst, conRecorte))
      .filter(Boolean);
    if (!nombres.length) return null;

    const nombreCapas = nombres.length === 1
      ? nombres[0]
      : nombres.length === 2
        ? `${nombres[0]} y ${nombres[1]}`
        : `${nombres[0]}, ${nombres[1]} y ${nombres[2]}`;

    // Fragmento de área
    const nearestCount = insts[0]?.nearestCount || null;
    const areaStr = _formatearArea(recorte, nearestCount);

    const titulo = areaStr
      ? `${nombreCapas} — ${areaStr}`
      : nombreCapas;

    return toTitleCase(titulo);
  }

  function generarTitulo(texto) {
    return toTitleCase(texto);
  }

  function reset() {
    history       = [];
    currentChatId = null;
    window.history.replaceState?.(null, '', '/');
  }

  function getChatId()  { return currentChatId; }
  function getHistory() { return history; }

  // sanitizeForDisplay: alias público de stripBloques para uso externo (ej: restoreChat en app.js).
  // Elimina todos los bloques internos (map, style, classify, etc.) del texto guardado
  // y devuelve solo el texto visible que debe mostrarse al usuario.
  function sanitizeForDisplay(text) {
    return stripBloques(text, false);
  }

  function abort() {
    if (!isStreaming) return;
    _abortController?.abort();
    _abortController = null;
    isStreaming = false;
    UI.hideThinking();
    UI.setSendEnabled(true);
  }
  return { send, reset, restore, abort, getChatId, getHistory, toTitleCase, sanitizeForDisplay };

})();

// ── UI ────────────────────────────────────────────────────────────

window.UI = (() => {

  const $msgs = () => document.getElementById('chat-messages');
  let thinkingEl = null;

  function addMessage(role, text, meta) {
    if (role === 'user') {
      // Wrapper for bubble + meta outside
      const wrap = document.createElement('div');
      wrap.className = 'msg-user-wrap';

      const el = document.createElement('div');
      el.className = 'msg user';
      if (text) setMessageText(el, text, true);
      wrap.appendChild(el);
      // meta SOLO afuera del globo, nunca adentro
      if (meta?.time) {
        const m = document.createElement('div');
        m.className = 'msg-meta msg-meta-user';
        m.textContent = formatTime(meta.time);
        wrap.appendChild(m);
      }
      $msgs().appendChild(wrap);
      scrollBottom();
      return wrap; // return wrap so setMessageMeta can append to it
    }

    const el = document.createElement('div');
    el.className = `msg ${role}`;
    if (text) setMessageText(el, text);
    if (meta?.time) {
      const m = document.createElement('div');
      m.className = 'msg-meta';
      const modelNames = { cerebras: 'qwen-3-235b', groq: 'llama-3.3-70b-versatile', 'groq-oss': 'gpt-oss-120b', mistral: 'mistral-small-latest', gemini: 'gemini-2.5-flash', pim: 'pim' };
      const parts = [formatTime(meta.time)];
      if (meta.model) parts.push(modelNames[meta.model] || meta.model);
      m.textContent = parts.join(' · ');
      el.appendChild(m);
    }
    $msgs().appendChild(el);
    scrollBottom();
    return el;
  }

  function setMessageText(el, text, collapse) {
    const isUser = el.classList.contains('user') ||
                   el.closest?.('.msg-user-wrap') !== null;

    const escape = s => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const fullHTML = isUser ? escape(text) : renderMarkdown(text);

    if (!collapse) {
      el.innerHTML = fullHTML;
      scrollBottom();
      return;
    }

    // Estimar líneas: contar saltos explícitos + líneas visuales por longitud
    // Ancho del bubble aprox 400px, font-size 16px → ~28 chars por línea
    const CHARS_PER_LINE = 28;
    const MAX_LINES      = 9;
    const lines = text.split('\n');
    let totalLines = 0;
    for (const line of lines) {
      totalLines += Math.max(1, Math.ceil((line.length || 1) / CHARS_PER_LINE));
      if (totalLines > MAX_LINES) break;
    }
    const needsCollapse = totalLines > MAX_LINES;

    el.innerHTML = fullHTML;

    if (!needsCollapse) {
      scrollBottom();
      return;
    }

    // Calcular previewHTML: primeras MAX_LINES líneas visuales
    let previewLines = [];
    let count = 0;
    for (const line of lines) {
      const visual = Math.max(1, Math.ceil((line.length || 1) / CHARS_PER_LINE));
      if (count + visual > MAX_LINES) {
        // Cortar la línea parcialmente si hace falta
        const remaining = MAX_LINES - count;
        const chars = remaining * CHARS_PER_LINE;
        previewLines.push(line.slice(0, chars) + (line.length > chars ? '…' : ''));
        break;
      }
      previewLines.push(line);
      count += visual;
      if (count >= MAX_LINES) break;
    }
    const previewHTML = escape(previewLines.join('\n'));

    function renderCollapsed() {
      el.innerHTML = '';
      el.style.position = '';
      el.style.maxHeight = '';
      el.style.overflow  = '';

      const wrap = document.createElement('div');
      wrap.className = 'msg-collapse-wrap';

      const content = document.createElement('div');
      content.className = 'msg-collapse-content';
      content.innerHTML = previewHTML;

      const fade = document.createElement('div');
      fade.className = 'msg-collapse-fade';

      const btn = document.createElement('button');
      btn.className = 'msg-expand-btn msg-expand-collapsed';
      btn.textContent = t('chat_show_more');
      btn.addEventListener('click', renderExpanded);

      wrap.appendChild(content);
      wrap.appendChild(fade);
      wrap.appendChild(btn);
      el.appendChild(wrap);
    }

    function renderExpanded() {
      el.innerHTML = '';
      el.style.position = '';
      const content = document.createElement('span');
      content.innerHTML = fullHTML;
      const btn = document.createElement('button');
      btn.className = 'msg-expand-btn msg-expand-expanded';
      btn.textContent = t('chat_show_less');
      btn.addEventListener('click', renderCollapsed);
      el.appendChild(content);
      el.appendChild(btn);
    }

    renderCollapsed();
    scrollBottom();
  }

    function formatTime(date) {
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + 
           ' ' + date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }

  function setSendEnabled(enabled) {
    document.querySelectorAll('.prompt-send').forEach(b => { b.disabled = !enabled; });
    // Cuando se habilita el send → ocultar stop; cuando se deshabilita → mostrar stop
    document.getElementById('btn-stop-chat')?.classList.toggle('hidden', enabled);
    document.getElementById('btn-send-chat')?.classList.toggle('hidden', !enabled);
  }

  function scrollBottom() {
    const msgs  = document.getElementById('chat-messages');
    const panel = document.getElementById('chat-panel');
    if (msgs)  msgs.scrollTop  = msgs.scrollHeight;
    if (panel) panel.scrollTop = panel.scrollHeight;
    // Actualizar botón de scroll: cuando se baja hasta el fondo debe ocultarse
    const scrollBtn = document.getElementById('btn-scroll-bottom');
    if (scrollBtn && msgs) {
      const dist = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
      scrollBtn.classList.toggle('visible', dist > 120);
    }
  }

  function setMessageMeta(el, meta) {
    const container = el;
    let m = container.querySelector('.msg-meta');
    if (!m) {
      m = document.createElement('div');
      m.className = container.classList.contains('msg-user-wrap')
        ? 'msg-meta msg-meta-user'
        : 'msg-meta';
      container.appendChild(m);
    }
    const modelNames = {
      cerebras:  'qwen-3-235b',
      groq:      'llama-3.3-70b-versatile',
      'groq-oss': 'gpt-oss-120b',
      mistral:   'mistral-small-latest',
      gemini:    'gemini-2.5-flash',
      pim:       'pim',
    };
    const parts = [formatTime(meta.time)];
    if (meta.model) parts.push(modelNames[meta.model] || meta.model);
    m.textContent = parts.join(' · ');
  }

  function showThinking() {
    hideThinking();
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'msg thinking';
    thinkingEl.textContent = t('map_drawing');
    $msgs()?.appendChild(thinkingEl);
    scrollBottom();
  }

  function hideThinking() {
    thinkingEl?.remove();
    thinkingEl = null;
  }

  function showErrorCard(titulo, layerKey, externalMsg) {
    const el = document.createElement('div');
    el.className = 'msg-error-card';
    const desc = externalMsg
      ? `<span class="error-card-desc error-card-external"><span class="material-icons" style="font-size:13px;vertical-align:-2px">info</span> ${externalMsg}</span>`
      : `<span class="error-card-desc">${t('error_no_response')}</span>`;
    el.innerHTML = `
      <div class="error-card-left">
        <span class="material-icons error-card-icon">${externalMsg ? 'cloud_off' : 'error_outline'}</span>
        <div class="error-card-info">
          <span class="error-card-title">${titulo}</span>
          ${desc}
        </div>
      </div>
      <button class="error-card-btn" data-layer="${layerKey || ''}">
        ${t('error_retry')}
      </button>
    `;
    el.querySelector('.error-card-btn').addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = t('error_layer_retry', { titulo });
        input.focus();
        input.dispatchEvent(new Event('input'));
      }
    });
    $msgs()?.appendChild(el);
    scrollBottom();
  }


  // Resuelve el nombre visible de una instrucción para mostrarlo en el card del mapa.
  // Misma prioridad que renderMap en app.js: tituloUI de la instrucción (puesto por
  // construirInstruccion desde el catálogo) → tituloUI del catálogo → descripcion.
  function _tituloInstruccion(inst) {
    if (!inst) return '';
    if (inst.tituloUI) return inst.tituloUI;
    const _lang = window.I18N?.getLang?.() || 'es';
    const _suf  = _lang === 'en' ? 'En' : _lang === 'pt' ? 'Pt' : 'Es';
    const capa  = window.LAYERS?.[inst.layerKey];
    if (capa) return capa[`tituloUI${_suf}`] || capa.tituloUI || capa.titulo || inst.descripcion || inst.layerKey;
    return inst.descripcion || inst.layerKey || '';
  }

  function showMapReady(plan) {
    const capas = (plan.instrucciones || [])
      .map(i => _tituloInstruccion(i))
      .filter(Boolean)
      .join('\n');

    const el = document.createElement('div');
    el.className = 'msg-map-card';
    el.innerHTML = `
      <div class="map-card-left">
        <span class="material-icons map-card-icon">map</span>
        <div class="map-card-info">
          <span class="map-card-title">${plan.titulo || t('map_card_default_title')}</span>
          <span class="map-card-layers">${capas}</span>
        </div>
      </div>
      <button class="map-card-btn" data-plan='${JSON.stringify(plan).replace(/'/g, "&#39;")}'>
        ${t('map_card_btn_ver')}
      </button>
    `;
    el.querySelector('.map-card-btn').addEventListener('click', e => {
      const p = JSON.parse(e.currentTarget.dataset.plan.replace(/&#39;/g, "'"));
      window.APP.renderMap(p).then(() => {
        // En mobile/tablet: mostrar el mapa al hacer click en VER
        if (window.MAP_CONTROLS?.isMobile?.()) {
          window.MAP_CONTROLS.setMapVisible(true);
        }
      });
    });
    $msgs()?.appendChild(el);
    scrollBottom();
  }

  // ── Markdown ──────────────────────────────────────────────────
  function renderMarkdown(text) {
    if (typeof marked === 'undefined') {
      // Fallback si marked no cargó: solo escapar y saltos de línea
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }
    marked.setOptions({
      breaks: true,    // \n → <br> dentro de párrafos
      gfm: true,
      mangle: false,
      headerIds: false
    });
    return marked.parse(text);
  }

  // ── Selector de modo de respuesta ────────────────────────────
  // Se muestra una sola vez, al final de la primera respuesta del LLM,
  // cuando el usuario nunca eligió un modo explícito.
  // Permite al usuario elegir cómo quiere que Casux responda en adelante.

  function showModeSelector() {
    const card = document.createElement('div');
    card.className = 'msg-export-choice msg-mode-selector';

    const modes = [
      { val: 'default',   label: t('settings_default'),   sub: t('mode_sub_default')   },
      { val: 'eficiente', label: t('settings_efficient'),  sub: t('mode_sub_eficiente') },
      { val: 'detallista',label: t('settings_detailed'),   sub: t('mode_sub_detallista')},
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

        // Reemplazar la card por confirmación
        const confirm = document.createElement('div');
        confirm.className = 'msg assistant msg-export-confirm';
        confirm.textContent = t('mode_chosen', { mode: modes.find(m => m.val === mode)?.label || mode });
        card.replaceWith(confirm);
        scrollBottom();
      });
    });

    $msgs()?.appendChild(card);
    scrollBottom();
  }

  function showExportChoice(msgEl) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    const labels = {
      geojson: t('export_geojson'),
      jpeg:    t('export_jpeg'),
      pdf:     t('export_pdf'),
      html:    t('export_html'),
    };

    const isMobile = window.MAP_CONTROLS?.isMobile?.();

    // Mismas tres opciones que el dropdown EXPORTAR
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
    scrollBottom();
  }

  // ── Botones contextuales de estilo ───────────────────────────
  // Se muestran cuando el usuario expresa intención de estilo genérica
  // (sin especificar qué cambiar). Adaptan opciones según geometría activa.

  function showStyleButtons(msgEl) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const geomTypes = [...new Set(Object.values(activeLayers).map(v => v.geomType).filter(Boolean))];

    // Armar opciones según geometría
    const options = [];

    if (geomTypes.some(g => /point|punto/i.test(g))) {
      options.push(
        { label: t('style_size'),  msg: t('style_change_size')  },
        { label: t('style_color'), msg: t('style_change_color_point') },
        { label: t('adv_svg_title'), msg: t('style_change_icon') },
      );
    }
    if (geomTypes.some(g => /line|linea|línea/i.test(g))) {
      options.push(
        { label: t('style_weight'), msg: t('style_change_weight') },
        { label: t('style_color'),  msg: t('style_change_color_line') },
      );
    }
    if (geomTypes.some(g => /polygon|polígono|poligono/i.test(g))) {
      options.push(
        { label: t('style_fill_color'),   msg: t('style_change_fill')   },
        { label: t('style_border_color'), msg: t('style_change_border') },
      );
    }

    // Fallback si no hay geometría detectada
    if (!options.length) {
      options.push(
        { label: t('style_color'),  msg: t('style_change_color_line') },
        { label: t('style_weight'), msg: t('style_change_weight') },
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
        // Insertar en el input y enviar
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
    scrollBottom();
  }

  // ════════════════════════════════════════════════════════════════
  // STYLE FLOW — árbol de personalización de estilo desde el chat
  // ════════════════════════════════════════════════════════════════

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
    // Shuffle determinista para que sean distintos cada vez
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
  }

  function _suggestIcons(chatTitulo) {
    // Validar contra el catálogo real de Maki en runtime
    const validKeys = new Set((window.MAKI_ICONS || []).map(i => i.key));
    const filterValid = (icons) => icons.filter(i => validKeys.has(i)).slice(0, 3);
    const fallback = filterValid(['marker', 'star', 'information', 'attraction', 'monument']);

    // Todas las claves aquí están verificadas contra window.MAKI_ICONS
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

  // ── Paso C: controles según parámetro ────────────────────────

  function _showColorPicker(container, mapKey, layer, containerRef) {
    const currentFill = layer.style?.fillColor || layer.style?.color || '#888888';
    const colors = _suggestColors(currentFill);
    const wrap = document.createElement('div');
    wrap.className = 'style-grid';

    // 3 colores sugeridos
    colors.forEach(hex => {
      const btn = document.createElement('button');
      btn.className = 'style-grid-btn';
      btn.innerHTML = `
        <div class="style-grid-swatch" style="background:${hex}"></div>
        <span class="style-grid-label">${hex.toUpperCase()}</span>`;
      btn.addEventListener('click', () => {
        _applyColorChange(mapKey, layer, hex);
        addMessage('assistant', t('style_applied'));
        containerRef?.remove();
        scrollBottom();
      });
      wrap.appendChild(btn);
    });

    // Botón "Otro" → selector nativo de color
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
      addMessage('assistant', t('style_applied'));
      containerRef?.remove();
      scrollBottom();
    });
    otroBtn.addEventListener('click', () => nativePick.click());
    wrap.appendChild(otroBtn);

    container.appendChild(wrap);
    scrollBottom();
  }

  // Aplica un estilo via MAP.updateLayerStyle (evita llamar applyStylePlan que tiene
  // dependencias privadas de app.js). onStyleChange se encarga de persistir.
  function _applyStyle(mapKey, styleChanges) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entry = activeLayers[mapKey];
    if (!entry) return;
    const newStyle = { ...entry.style, ...styleChanges };
    window.MAP?.updateLayerStyle?.(mapKey, newStyle);
    window.MAP?.updateLegend?.();
    window.ANALYTICS?.styleChanged?.('button');

    // En móvil: si el mapa está oculto, mostrar botón "Ver mapa"
    if (window.MAP_CONTROLS?.isMobile?.()) {
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel?.style.display === 'none') {
        showViewMapBtn();
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
    const activeLayers1 = window.MAP?.getActiveLayers?.() || {};
    const mapKey1 = Object.keys(activeLayers1).find(k => activeLayers1[k].layerKey === layer.layerKey);
    if (mapKey1) _applyStyle(mapKey1, newStyle);
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
      addMessage('assistant', t('style_applied'));
      containerRef?.remove();
      scrollBottom();
    });

    window.LP_UTILS?.wireSliderTouch?.(inp);
    container.appendChild(wrap);
    scrollBottom();
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
        // precacheMakiIcon sin await: asegura que el SVG esté en caché para Leaflet
        // cuando se aplique el estilo y los marcadores se re-rendericen.
        window.MAP?.precacheMakiIcon?.(key);
        _applyStyle(mapKey, { icon: key });
        addMessage('assistant', t('style_applied'));
        containerRef?.remove();
        scrollBottom();
      });
      wrap.appendChild(btn);
    });

    // Botón "Otro"
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
        scrollBottom();
      });
    }
    wrap.appendChild(otroBtn);
    container.appendChild(wrap);
    scrollBottom();
  }

  // ── Geometría (puntos) ───────────────────────────────────────

  function _showGeomPicker(container, mapKey, layer, containerRef) {
    const cur = layer.style?.shape || 'circle';
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
        addMessage('assistant', t('style_applied'));
        containerRef?.remove();
        scrollBottom();
      });
      wrap.appendChild(btn);
    });

    container.appendChild(wrap);
    scrollBottom();
  }

  // ── Paso B: elegir parámetro ──────────────────────────────────

  function _showParamButtons(container, mapKey, layer, chatTitulo, containerRef) {
    const geom = layer.geomType || 'polygon';
    const params = [];
    if (geom === 'point')   params.push({ key: 'color',  label: t('style_color')    });
    if (geom === 'point')   params.push({ key: 'radius', label: t('style_size')     });
    if (geom === 'point')   params.push({ key: 'icon',   label: t('adv_svg_title')  });
    if (geom === 'point')   params.push({ key: 'geom',   label: t('style_geometry') });
    if (geom === 'line')    params.push({ key: 'color',  label: t('style_color')   });
    if (geom === 'line')    params.push({ key: 'weight', label: t('style_weight')  });
    if (geom === 'polygon') params.push({ key: 'color',  label: t('style_color')   });

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
    scrollBottom();
  }

  function _showParamControl(container, mapKey, layer, param, chatTitulo, containerRef) {
    if (param === 'color')  _showColorPicker(container, mapKey, layer, containerRef);
    if (param === 'radius') _showSlider(container, mapKey, layer, 'radius', containerRef);
    if (param === 'weight') _showSlider(container, mapKey, layer, 'weight', containerRef);
    if (param === 'icon')   _showIconPicker(container, mapKey, layer, chatTitulo, containerRef);
    if (param === 'geom')   _showGeomPicker(container, mapKey, layer, containerRef);
  }

  // ── Paso A: elegir capa ───────────────────────────────────────

  function _showLayerButtons(container, layers, param, chatTitulo, containerRef) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';
    card.innerHTML = Object.entries(layers).map(([mapKey, layer]) => `
      <button class="export-choice-btn" data-mapkey="${mapKey}">
        <span class="export-choice-label">${layer.titulo || layer.layerKey}</span>
        <span class="export-choice-sub">${layer.geomType || ''}</span>
      </button>`).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mapKey = btn.dataset.mapkey;
        const layer  = layers[mapKey];
        card.innerHTML = '';
        if (param) {
          // Validar que el parámetro aplique para esta geometría
          const validParam = _validateParam(param, layer.geomType);
          if (validParam) {
            _showParamControl(card, mapKey, layer, validParam, chatTitulo, containerRef);
          } else {
            _showParamButtons(card, mapKey, layer, chatTitulo, containerRef);
          }
        } else {
          _showParamButtons(card, mapKey, layer, chatTitulo, containerRef);
        }
      });
    });

    container.appendChild(card);
    scrollBottom();
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
    // Abre el panel de capas y activa el acordeón de edición para esa capa
    const existing = document.getElementById('layers-dropdown');
    if (!existing) window.LAYERS_PANEL?.toggle?.();
    setTimeout(() => {
      const sec  = document.querySelector('.layers-data-section');
      const btn  = document.querySelector(`.layer-edit-btn[data-key="${mapKey}"], .layers-data-row[data-key="${mapKey}"] .layer-edit-btn`);
      if (btn && sec) window.LP_STYLE?.toggleEditAccordion?.(mapKey, btn, sec);
    }, 80);
  }

  function _openLayerAdvancedModal(mapKey) {
    const sec = document.querySelector('.layers-data-section');
    window.LP_MODAL?.openAdvancedModal?.(mapKey, sec);
  }

  // ── Punto de entrada principal ────────────────────────────────

  // Valida si un parámetro tiene sentido para una geometría dada.
  // radius → solo puntos | weight → líneas y polígonos | icon/geom → solo puntos
  // Devuelve el param si es válido, null si no aplica para esa geometría.
  function _validateParam(param, geom) {
    if (param === 'radius' && geom !== 'point')   return null;
    if (param === 'icon'   && geom !== 'point')   return null;
    if (param === 'geom'   && geom !== 'point')   return null;
    if (param === 'weight' && geom === 'point')   return null;
    return param;
  }

  function showStyleFlow(intencion) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const layerEntries = Object.entries(activeLayers);
    if (!layerEntries.length) return;

    const chatTitulo = window.APP?.getCurrentPlan?.()?.titulo || '';

    // Extraer parámetro si el intent lo detectó
    const param = intencion?.parametros?.param || null;

    const paramQuestions = {
      color:  t('style_ask_color'),
      radius: t('style_ask_size'),
      weight: t('style_ask_weight'),
      icon:   t('style_ask_icon'),
      geom:   t('style_ask_geom'),
    };
    const question = (param && paramQuestions[param]) || t('style_what_to_change');
    const msgEl = addMessage('assistant', question);
    // El container se agrega DESPUÉS del msgEl (hermano, no hijo)
    // para escapar del max-width:90% del .msg.assistant
    const container = document.createElement('div');
    container.style.cssText = 'width:100%';
    container.className = 'style-flow-container';
    msgEl.after(container);

    if (layerEntries.length === 1) {
      const [mapKey, layer] = layerEntries[0];
      const validParam = param ? _validateParam(param, layer.geomType) : null;
      if (validParam) {
        // Caso 1b: parámetro conocido y válido para esta geometría
        _showParamControl(container, mapKey, layer, validParam, chatTitulo, container);
      } else {
        // Caso 1a: sin parámetro o parámetro inválido → mostrar parámetros disponibles
        _showParamButtons(container, mapKey, layer, chatTitulo, container);
      }
    } else {
      // Múltiples capas
      if (param) {
        // Caso 2b/2c: intentar resolver capa por geometría
        const geomMap = { radius: 'point', icon: 'point', geom: 'point', weight: 'line' };
        const targetGeom = geomMap[param];
        if (targetGeom) {
          const matching = layerEntries.filter(([, l]) => l.geomType === targetGeom);
          if (matching.length === 1) {
            // Caso 2c-i: única capa con esa geometría
            const [mapKey, layer] = matching[0];
            _showParamControl(container, mapKey, layer, param, chatTitulo, container);
          } else {
            // Caso 2c-ii: múltiples capas con esa geometría → elegir capa
            const filtered = Object.fromEntries(matching);
            _showLayerButtons(container, filtered, param, chatTitulo, container);
          }
        } else {
          // param = color, aplica a cualquier geom → elegir capa
          _showLayerButtons(container, activeLayers, param, chatTitulo, container);
        }
      } else {
        // Caso 2a: genérico, múltiples capas → elegir capa primero
        _showLayerButtons(container, activeLayers, null, chatTitulo, container);
      }
    }

    scrollBottom();
    return msgEl;
  }

  function showBasemapButtons(msgEl) {
    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    const options = [
      { subtipo: 'gray',    icon: 'light_mode',  label: 'Positron',    sub: t('basemap_hint_gray')    },
      { subtipo: 'dark',    icon: 'dark_mode',   label: 'Dark Matter', sub: t('basemap_hint_dark')    },
      { subtipo: 'voyager', icon: 'map',         label: 'Voyager',     sub: t('basemap_hint_voyager') },
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
        history.push({ role: 'assistant', content: t('basemap_changed'), time: new Date().toISOString() });
        scrollBottom();
      });
    });

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    scrollBottom();
  }


  // Muestra un botón liviano "Ver mapa" en el chat — solo en mobile,
  // después de aplicar un cambio de estilo o clasificación.
  function showViewMapBtn() {
    // Evitar duplicados — si ya hay un card visible, no agregar otro
    if ($msgs()?.querySelector('.msg-map-card.style-update')) return;

    // Usar el mismo card visual que showMapReady, pero el botón VER
    // solo abre el mapa sin re-renderizar (el estilo ya está aplicado).
    const plan = window.APP?.getCurrentPlan?.() || {};
    const capas = (plan.instrucciones || [])
      .map(i => _tituloInstruccion(i))
      .filter(Boolean)
      .join('\n');

    const el = document.createElement('div');
    el.className = 'msg-map-card style-update';
    el.innerHTML = `
      <div class="map-card-left">
        <span class="material-icons map-card-icon">map</span>
        <div class="map-card-info">
          <span class="map-card-title">${plan.titulo || t('map_card_default_title')}</span>
          <span class="map-card-layers">${capas}</span>
        </div>
      </div>
      <button class="map-card-btn">${t('map_card_btn_ver')}</button>
    `;
    el.querySelector('.map-card-btn').addEventListener('click', () => {
      window.MAP_CONTROLS?.setMapVisible(true);
      el.remove();
    });
    $msgs()?.appendChild(el);
    scrollBottom();
  }

  // ── Selector de capa para acciones de intent ─────────────────
  //
  // Muestra botones con las capas activas para que el usuario elija
  // a cuál aplicar la acción (estilo, visibilidad, clasificación, etc.)
  // onSelect(mapKey) se llama cuando el usuario elige una capa.
  // confirmMsg: mensaje opcional que se muestra después de la acción.

  function showLayerSelectorForAction(msgEl, onSelect, confirmMsg) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const entries = Object.entries(activeLayers);
    if (!entries.length) return;

    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    card.innerHTML = entries.map(([mapKey, layer]) => `
      <button class="export-choice-btn" data-mapkey="${mapKey}">
        <span class="export-choice-label">${layer.titulo || layer.layerKey}</span>
        <span class="export-choice-sub">${layer.geomType || ''}</span>
      </button>`).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mapKey = btn.dataset.mapkey;
        card.remove();
        onSelect(mapKey);
        if (confirmMsg) {
          addMessage('assistant', confirmMsg);
          scrollBottom();
        }
      });
    });

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    scrollBottom();
  }

  // ── showStyleFlowForLayer ─────────────────────────────────────
  //
  // Igual que showStyleFlow pero opera sobre una capa ya elegida.
  // Usado cuando hay varias capas y el usuario eligió una en el selector.

  function showStyleFlowForLayer(intencion, mapKey) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const layer = activeLayers[mapKey];
    if (!layer) return;

    const chatTitulo = window.APP?.getCurrentPlan?.()?.titulo || '';
    const param = intencion?.parametros?.param || null;
    const containerRef = { remove: () => {} }; // dummy — el card se gestiona solo

    const msgEl = addMessage('assistant',
      param ? t('style_ask_' + param) || t('style_what_to_change') : t('style_what_to_change')
    );

    if (param) {
      _showParamControl(msgEl, mapKey, layer, param, chatTitulo, containerRef);
    } else {
      _showParamButtons(msgEl, mapKey, layer, chatTitulo, containerRef);
    }
    scrollBottom();
  }

  // ── showRenameInput ───────────────────────────────────────────
  //
  // Muestra un input inline para que el usuario escriba el nuevo nombre
  // del chat/mapa, sin necesidad de pasar por el LLM.

  function showRenameInput(msgEl) {
    const wrap = document.createElement('div');
    wrap.className = 'style-slider-wrap';
    wrap.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:6px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('rename_placeholder');
    input.style.cssText = 'flex:1;padding:6px 10px;border-radius:8px;border:1px solid var(--border-md);background:var(--bg2);color:var(--cream1);font-family:var(--font-sans);font-size:13px;outline:none';

    const btn = document.createElement('button');
    btn.className = 'export-choice-btn style-confirm-btn';
    btn.style.cssText = 'flex-shrink:0;padding:6px 14px';
    btn.innerHTML = `<span class="export-choice-label">${t('rename_confirm')}</span>`;

    const apply = () => {
      const nombre = input.value.trim();
      if (!nombre) return;
      wrap.remove();
      window.CHAT_HEADER?.startRename?.(nombre);
      // Actualizar también el título del mapa activo
      const planApply = window.APP?.getCurrentPlan?.();
      if (planApply) planApply.titulo = nombre;
      const mapTitleInput = document.getElementById('map-title');
      if (mapTitleInput) mapTitleInput.value = nombre;
      addMessage('assistant', t('chat_renamed', { nombre }));
      scrollBottom();
    };

    btn.addEventListener('click', apply);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
      if (e.key === 'Escape') wrap.remove();
    });

    wrap.appendChild(input);
    wrap.appendChild(btn);

    if (msgEl) msgEl.after(wrap);
    else $msgs()?.appendChild(wrap);

    setTimeout(() => input.focus(), 80);
    scrollBottom();
  }

  // ── showFieldSelectorForClassify ─────────────────────────────
  //
  // Muestra los campos clasificables de la capa para que el usuario elija.
  // Solo muestra atributos con label no vacío o classifiable:true.

  function showFieldSelectorForClassify(msgEl, mapKey, layerKey) {
    const layerDef = window.LAYERS?.[layerKey];
    if (!layerDef?.attributes?.length) return;

    const attrs = layerDef.attributes.filter(a =>
      (a.label && a.label.trim()) || a.classifiable === true
    );
    if (!attrs.length) return;

    const card = document.createElement('div');
    card.className = 'msg-export-choice';

    card.innerHTML = attrs.map(a => {
      const displayLabel = a.label || a.campo;
      const tipoClasif = /num|area|longitud|pobla|cant|total|valor|porc|dens|super/i.test(a.campo || '')
        ? 'graduated' : 'categorized';
      return `<button class="export-choice-btn"
        data-campo="${a.campo}"
        data-label="${displayLabel}"
        data-type="${tipoClasif}">
        <span class="export-choice-label">${displayLabel}</span>
        <span class="export-choice-sub">${a.tipo || ''}</span>
      </button>`;
    }).join('');

    card.querySelectorAll('.export-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field   = btn.dataset.campo;
        const label   = btn.dataset.label;
        const type    = btn.dataset.type;
        const palette = type === 'graduated' ? 'seq_blues' : 'qualitative';
        const paletteColors = window.PALETTES?.[palette] || window.PALETTES?.qualitative;
        card.remove();
        window.APP?.applyClassifyPlan?.([{ layerKey, field, type, palette, paletteColors }]);
        addMessage('assistant', t('classify_done', { label }));
        scrollBottom();
      });
    });

    if (msgEl) msgEl.after(card);
    else $msgs()?.appendChild(card);
    scrollBottom();
  }

    return { addMessage, setMessageText, setMessageMeta, showThinking, hideThinking, showMapReady, showViewMapBtn, showErrorCard, showModeSelector, showExportChoice, showStyleButtons, showStyleFlow, showStyleFlowForLayer, showBasemapButtons, showLayerSelectorForAction, showRenameInput, showFieldSelectorForClassify, setSendEnabled };

})();
