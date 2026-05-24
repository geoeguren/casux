/**
 * src/intent/intent-resolver.js — Orquestador del motor de intenciones v2
 *
 * Reemplaza la cadena de detectores paralelos por el modelo (Verbo × Objeto):
 *
 *   1. Detectar grupo verbal  (intent-verbos.js)
 *   2. Clasificar objeto      (intent-objeto.js)
 *   3. Consultar tabla        (intent-tabla.js)  → acción
 *   4. Resolver parámetros    (este archivo)
 *   5. Validar                (intent-validar.js)
 *   6. Devolver resultado     → chat.js ejecuta
 *
 * El resultado es el mismo formato que antes:
 *   { tipo, subtipo?, parametros? } | null
 *
 * null → derivar al LLM (con historial completo)
 *
 * Dependencias (carga antes que este archivo):
 *   intent-utils.js, intent-scorer.js, intent-capa.js,
 *   intent-verbos.js, intent-objeto.js, intent-tabla.js, intent-validar.js
 */

window.INTENT_RESOLVER = (() => {

  const { normalizarSimple, normalizar, tokenizar } = window.INTENT_UTILS;

  // ── Colores predefinidos (ES / EN / PT) ───────────────────────
  const COLOR_MAP = {
    // ES
    rojo: '#e63946', roja: '#e63946', azul: '#457b9d', verde: '#52b788',
    amarillo: '#f7d24a', amarilla: '#f7d24a', naranja: '#f4a261',
    violeta: '#6a4c93', lila: '#c77dff', rosa: '#ff6b6b', rosado: '#ff6b6b', rosada: '#ff6b6b',
    negro: '#222222', negra: '#222222', blanco: '#f8f9fa', blanca: '#f8f9fa',
    gris: '#888888', grises: '#888888', celeste: '#90e0ef',
    marron: '#a47856', cafe: '#a47856', turquesa: '#2a9d8f',
    cian: '#00b4d8', magenta: '#e040fb', fucsia: '#ff006e', indigo: '#3d52a0',
    // EN
    red: '#e63946', blue: '#457b9d', green: '#52b788', yellow: '#f7d24a',
    orange: '#f4a261', purple: '#6a4c93', pink: '#ff6b6b',
    black: '#222222', white: '#f8f9fa', gray: '#888888', grey: '#888888',
    brown: '#a47856', cyan: '#00b4d8', teal: '#2a9d8f',
    // PT
    vermelho: '#e63946', vermelha: '#e63946', amarelo: '#f7d24a', amarela: '#f7d24a',
    laranja: '#f4a261', roxo: '#6a4c93', roxa: '#6a4c93',
    preto: '#222222', preta: '#222222', branco: '#f8f9fa', branca: '#f8f9fa',
    cinza: '#888888', marrom: '#a47856', anil: '#3d52a0',
  };

  // ── Extractor de nombre para renombrar ────────────────────────
  function _extraerNombreRenombrar(texto) {
    const patrones = [
      // "renombrá el mapa como X" / "renombra el mapa como X" (con y sin tilde)
      /(?:renombr[aáeé][a-záéíóúñ]*\s+(?:el\s+|este\s+|ese\s+)?(?:mapa|chat)\s+como\s+)["']?([^"'\n]{2,40})["']?/i,
      // "llamalo X" / "renombralo como X" / "el nombre es X"
      /(?:llamalo?|renombralo?\s+(?:como\s+)?|titulalo?\s*|el\s+nombre\s+(?:es|ser[aá]|va\s+a\s+ser)\s+|llam[aá]\s+(?:al\s+)?(?:mapa|chat)\s+)["']?([^"'\n]{2,40})["']?/i,
      // "como 'Nombre'" — solo con comillas para evitar falsos positivos
      /(?:como\s+)["']([^"'\n]{2,40})["']/i,
      // EN: "call it X" / "rename to X" / "name it X"
      /(?:call\s+(?:it|the\s+map)\s+|rename\s+(?:it\s+)?(?:to\s+)?|name\s+it\s+|the\s+name\s+is\s+)["']?([^"'\n]{2,40})["']?/i,
      // PT: "chama o mapa de X" / "renomeia para X"
      /(?:chama(?:r)?\s+(?:o\s+mapa\s+)?(?:de\s+)?|renomeia(?:r)?\s+(?:para\s+)?|o\s+nome\s+(?:[eé]|vai\s+ser)\s+)["']?([^"'\n]{2,40})["']?/i,
    ];
    for (const p of patrones) {
      const m = texto.match(p);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return null;
  }

  // ── Resolvedor de valor de estilo ────────────────────────────
  function _resolverValorEstilo(norm, prop, mapKey, activeLayers) {
    const HEX = /#([0-9a-fA-F]{3,6})\b/;
    const NUM = /\b(\d+(?:[.,]\d+)?)\s*(?:px|pt|puntos?)?\b/;
    const PCT = /(\d+(?:[.,]\d+)?)\s*%/;

    if (prop === 'color') {
      const hexM = norm.match(HEX);
      if (hexM) return '#' + hexM[1].padEnd(6, hexM[1]);
      const normL = norm.toLowerCase();
      const sorted = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);
      for (const nombre of sorted) {
        if (normL.includes(nombre)) return COLOR_MAP[nombre];
      }
      return null;
    }

    if (prop === 'opacity') {
      const pctM = norm.match(PCT);
      if (pctM) return parseFloat(pctM[1].replace(',', '.')) / 100;
      const cur = mapKey ? (activeLayers[mapKey]?.style?.fillOpacity ?? 0.5) : 0.5;
      if (/\b(mas\s+transparente|more\s+transparent|mais\s+transparente|menos\s+opaco|less\s+opaque)\b/.test(norm))
        return Math.max(0.05, +(cur - 0.2).toFixed(2));
      if (/\b(mas\s+opaco|more\s+opaque|mais\s+opaco|menos\s+transparente|less\s+transparent)\b/.test(norm))
        return Math.min(1, +(cur + 0.2).toFixed(2));
      return null;
    }

    if (prop === 'radius' || prop === 'weight') {
      const numM = norm.match(NUM);
      if (numM) {
        const v = parseFloat(numM[1].replace(',', '.'));
        if (v >= 0.5 && v <= 50) return v;
      }
      const cur = mapKey
        ? (prop === 'radius'
            ? (activeLayers[mapKey]?.style?.radius ?? 5)
            : (activeLayers[mapKey]?.style?.weight ?? 2))
        : (prop === 'radius' ? 5 : 2);
      if (/\b(mas\s+grande|bigger|larger|mais\s+grande|maior|aumentar?)\b/.test(norm))
        return Math.min(prop === 'radius' ? 25 : 10, +(cur + 2).toFixed(1));
      if (/\b(mas\s+chico|mas\s+pequ|smaller|menor|mais\s+pequen|reduzir?)\b/.test(norm))
        return Math.max(0.5, +(cur - 2).toFixed(1));
      if (/\b(mas\s+grueso|thicker|mais\s+gross|mais\s+espess)\b/.test(norm))
        return Math.min(10, +(cur + 1.5).toFixed(1));
      if (/\b(mas\s+fino|thinner|mais\s+fin|mais\s+delgad)\b/.test(norm))
        return Math.max(0.5, +(cur - 1.5).toFixed(1));
      return null;
    }

    return null;
  }

  // ── Resolución de parámetros por acción ──────────────────────

  function _resolverParams(accion, grupoVerbal, objeto, textoUsuario, historial) {
    const norm         = normalizarSimple(textoUsuario);
    const activeLayers = window.MAP?.getActiveLayers?.() || {};

    switch (accion) {

      case 'limpiar':
        return {};

      case 'quitar':
        return { mapKey: objeto.ref };

      case 'toggle_vis_off':
        return { mapKey: objeto.ref, visible: false };

      case 'toggle_vis_on':
        return { mapKey: objeto.ref, visible: true };

      case 'clasificar': {
        const mapKey   = objeto.ref;
        const entry    = activeLayers[mapKey];
        const layerDef = window.LAYERS?.[entry?.layerKey];

        // Intentar identificar el campo mencionado en el texto
        const textoSinVerbo = textoUsuario.replace(window.INTENT_VERBOS.GRUPOS.CLASIFICAR, '').trim();
        const normSinVerbo  = normalizar(textoSinVerbo);
        let field = null, label = null, type = null;

        if (layerDef?.attributes?.length && normSinVerbo) {
          const attrs = layerDef.attributes.filter(a => a.visible === true);
          let mejorScore = 0;
          for (const attr of attrs) {
            const labelNorm = normalizar(attr.label || '');
            const campoNorm = normalizar(attr.campo || '');
            const matchL = labelNorm.length > 0 && normSinVerbo.includes(labelNorm);
            const matchC = campoNorm.length > 0 && normSinVerbo.includes(campoNorm);
            const score  = (matchL ? 4 : 0) + (matchC ? 2 : 0) + (attr.classifiable ? 1 : 0);
            if (score > mejorScore) {
              mejorScore = score;
              field = attr.campo;
              const _lang  = window.I18N?.getLang?.() || 'es';
              const lblI18n = _lang === 'en' ? (attr.labelEn || attr.label) : (attr.label || attr.labelEn);
              label = (lblI18n && lblI18n.trim()) ? lblI18n : attr.campo;
              type  = /num|area|longitud|pobla|cant|total|valor|porc|dens|super/i.test(attr.campo)
                ? 'graduated' : 'categorized';
            }
          }
        }

        const palette = (type === 'graduated') ? 'seq_blues' : 'qualitative';
        return {
          mapKey,
          layerKey: entry?.layerKey,
          field,        // null → chat.js mostrará selector de campo
          label,
          type,
          palette,
        };
      }

      case 'limpiar_clasificacion':
        return { mapKey: objeto.ref };

      case 'limpiar_estilo':
        return { mapKey: objeto.ref };

      case 'limpiar_filtro':
        return { mapKey: objeto.ref };

      case 'estilo_vago': {
        const mapKey = objeto.ref;
        const prop   = objeto.propEstilo;
        return { mapKey, prop };
      }

      case 'estilo_resuelto': {
        const mapKey = objeto.ref;
        const prop   = objeto.propEstilo;
        if (!prop) return null;
        const value = _resolverValorEstilo(norm, prop, mapKey, activeLayers);
        if (value === null) return null;
        return { mapKey, prop, value };
      }

      case 'basemap':
        return { subtipo: window.INTENT_OBJETO.resolverSubtipoBasemap(norm) };

      case 'export':
        return { subtipo: window.INTENT_OBJETO.resolverSubtipoExport(norm) };

      case 'renombrar': {
        const nombre = _extraerNombreRenombrar(textoUsuario);
        return {
          subtipo: nombre ? 'especifico' : 'vago',
          nombre:  nombre || null,
        };
      }

      case 'filtrar': {
        // La lógica de filtrado queda en intent-capa.js / construirInstruccion
        // Aquí solo marcamos que es un filtro sobre la capa activa
        return { mapKey: objeto.ref };
      }

      case 'capa':
      case 'agregar': {
        // El scorer ya resolvió la capa en la detección de objeto
        // Reutilizar el resultado de detectarCapa / detectarCapaDirecta
        return null; // señal para que el orquestador use el path de capa
      }

      case 'selector_capa':
        return { accionPendiente: accion };

      default:
        return null;
    }
  }

  // ── Punto de entrada principal ────────────────────────────────

  /**
   * detectar(textoUsuario, historial) → { tipo, subtipo?, parametros? } | null
   *
   * Interfaz pública equivalente al anterior detectarIntencion().
   */
  function detectar(textoUsuario, historial = []) {
    const norm = normalizarSimple(textoUsuario);

    // ── Paso 1: detectar grupo verbal ─────────────────────────────
    const grupo = window.INTENT_VERBOS.detectarGrupo(norm);

    if (!grupo) {
      // Sin verbo reconocido → puede ser un pedido de capa puro ("aeropuertos de Córdoba")
      // o algo para el LLM
      return _intentarCapa(textoUsuario, historial);
    }

    // ── Paso 2: intentar resolver la capa si el grupo lo necesita ─
    // Para CARGAR, AGREGAR, MOSTRAR_VIS puede que el objeto sea una nueva capa.
    // Ejecutamos el scorer solo si el grupo puede necesitarlo.
    let scorerResult = null;
    if (['CARGAR', 'AGREGAR', 'MOSTRAR_VIS', 'FILTRAR'].includes(grupo)) {
      scorerResult = _tryScorer(textoUsuario, historial, grupo === 'AGREGAR');
      // Marcar si es grupo aditivo para que detectarObjeto priorice NUEVA_CAPA
      if (scorerResult && (grupo === 'AGREGAR' || grupo === 'CARGAR')) {
        scorerResult._grupoAditivo = true;
      }
    }

    // ── Paso 3: clasificar el objeto ──────────────────────────────
    const objeto = window.INTENT_OBJETO.detectarObjeto(textoUsuario, scorerResult);

    // ── Paso 4: consultar la tabla ────────────────────────────────
    let accion = window.INTENT_TABLA.resolver(grupo, objeto.tipo);

    // Refinamiento: estilo_vago → estilo_resuelto si hay valor concreto
    if (accion === 'estilo_vago' && objeto.propEstilo) {
      const norm2 = normalizarSimple(textoUsuario);
      const activeLayers = window.MAP?.getActiveLayers?.() || {};
      const value = _resolverValorEstilo(norm2, objeto.propEstilo, objeto.ref, activeLayers);
      if (value !== null) accion = 'estilo_resuelto';
    }

    if (accion === 'LLM') {
      console.log(`[RESOLVER] → LLM | grupo=${grupo} objeto=${objeto.tipo} | "${textoUsuario.slice(0,60)}"`);
      return null;
    }

    if (accion === null) {
      console.log(`[RESOLVER] → null (acción no aplica) | grupo=${grupo} objeto=${objeto.tipo}`);
      return null;
    }

    // Si la acción es 'capa' o 'agregar' → usar el path de capa original
    if (accion === 'capa') {
      return _intentarCapa(textoUsuario, historial);
    }
    if (accion === 'agregar') {
      // scorerResult ya fue intentado en paso 2; si no hay resultado → LLM
      if (scorerResult?.parametros) {
        return { tipo: 'agregar', parametros: scorerResult.parametros };
      }
      // Reintento con texto completo por si el verbo de agregar confundió al scorer
      const reintento = window.INTENT_CAPA?.detectarCapaDirecta?.(textoUsuario);
      if (reintento?.parametros) return { tipo: 'agregar', parametros: reintento.parametros };
      return null; // → LLM
    }

    // ── Paso 5: resolver parámetros ───────────────────────────────
    const params = _resolverParams(accion, grupo, objeto, textoUsuario, historial);

    // Para selector_capa: guardar el grupo verbal origen para que chat.js
    // sepa qué acción ejecutar después de que el usuario elige la capa.
    // Ej: CLASIFICAR + AMBIGUO → selector_capa con _accionOrigen = 'clasificar'
    if (accion === 'selector_capa') {
      const origenPorGrupo = {
        'CLASIFICAR':   'clasificar',
        'BORRAR':       'quitar',
        'OCULTAR':      'toggle_vis_off',
        'MOSTRAR_VIS':  'toggle_vis_on',
        'ESTILO':       'estilo',
        'LIMPIAR_PROP': 'limpiar_clasificacion',
        'RENOMBRAR':    'renombrar',
        'FILTRAR':      'filtrar',
      };
      params._accionOrigen = origenPorGrupo[grupo] || null;
    }

    // ── Paso 6: validar ───────────────────────────────────────────
    const ctx = {
      activeLayers: window.MAP?.getActiveLayers?.() || {},
      LAYERS:       window.LAYERS || {},
    };

    // Construir params completos para la validación
    const paramsValidacion = {
      mapKey:     objeto.ref,
      layerKey:   window.MAP?.getActiveLayers?.()?.[objeto.ref]?.layerKey,
      propEstilo: objeto.propEstilo,
      ...params,
    };

    const validacion = window.INTENT_VALIDAR.validar(accion, paramsValidacion, ctx);

    if (!validacion.valido && validacion.bloquea) {
      // Acción inválida y bloqueante → devolver error para que chat.js lo muestre
      console.log(`[RESOLVER] ✗ ${accion} bloqueado: ${validacion.error}`);
      return {
        tipo:       '_validacion_error',
        parametros: {
          accion,
          error:       validacion.error,
          errorParams: validacion.errorParams || {},
        },
      };
    }

    if (!validacion.valido && !validacion.bloquea) {
      // Advertencia no bloqueante — continuar pero marcar para que chat.js avise
      console.log(`[RESOLVER] ⚠ ${accion} advertencia: ${validacion.error}`);
      params._advertencia = validacion.error;
      params._advertenciaParams = validacion.errorParams || {};
    }

    // ── Resultado ─────────────────────────────────────────────────
    console.log(`[RESOLVER] ✓ ${accion} | grupo=${grupo} objeto=${objeto.tipo}${objeto.ref ? ' ref='+objeto.ref : ''} | "${textoUsuario.slice(0,60)}"`);

    // Normalizar al formato { tipo, subtipo?, parametros? }
    return _formatearResultado(accion, params, objeto);
  }

  // ── Helpers de integración ────────────────────────────────────

  /**
   * _intentarCapa — delega en el detector de capas original
   */
  function _intentarCapa(textoUsuario, historial) {
    return window.INTENT_CAPA?.detectarCapa?.(textoUsuario, historial) || null;
  }

  /**
   * _tryScorer — intenta resolver una capa con el scorer
   */
  function _tryScorer(textoUsuario, historial, esAgregar) {
    let resultado = null;
    if (esAgregar) {
      // Para agregar, quitar el verbo aditivo antes de scorear
      const norm = normalizarSimple(textoUsuario);
      const sinVerbo = norm.replace(window.INTENT_VERBOS.GRUPOS.AGREGAR, '').trim();
      if (!sinVerbo) return null;
      resultado = window.INTENT_CAPA?.detectarCapaDirecta?.(sinVerbo);
      if (!resultado) resultado = window.INTENT_CAPA?.detectarCapaDirecta?.(textoUsuario);
    } else {
      resultado = window.INTENT_CAPA?.detectarCapaDirecta?.(textoUsuario);
    }
    if (!resultado) return null;
    // Exponer layerKey a nivel superior para que detectarObjeto lo use
    const instruccion = resultado.parametros?.instruccion;
    return instruccion ? { ...resultado, layerKey: instruccion.layerKey } : resultado;
  }

  /**
   * _formatearResultado — convierte la acción y params al formato esperado por chat.js
   */
  function _formatearResultado(accion, params, objeto) {
    // Mapeo de acciones internas al formato { tipo, subtipo? } de chat.js
    const mapping = {
      'limpiar':                { tipo: 'limpiar' },
      'quitar':                 { tipo: 'quitar' },
      'toggle_vis_off':         { tipo: 'toggle_visibilidad' },
      'toggle_vis_on':          { tipo: 'toggle_visibilidad' },
      'clasificar':             { tipo: 'clasificar' },
      'limpiar_clasificacion':  { tipo: 'limpiar_clasificacion' },
      'limpiar_estilo':         { tipo: 'limpiar_estilo' },
      'limpiar_filtro':         { tipo: 'limpiar_filtro' },
      'estilo_vago':            { tipo: 'estilo', subtipo: 'vago' },
      'estilo_resuelto':        { tipo: 'estilo', subtipo: 'resuelto' },
      'basemap':                { tipo: 'basemap' },
      'export':                 { tipo: 'export' },
      'renombrar':              { tipo: 'renombrar' },
      'filtrar':                { tipo: 'filtrar' },
      'selector_capa':          { tipo: 'selector_capa' },  // accionOrigen se añade abajo
      '_validacion_error':      { tipo: '_validacion_error' },
    };

    const base = mapping[accion] || { tipo: accion };

    // Parámetros especiales por acción
    if (accion === 'toggle_vis_off') params = { ...params, visible: false };
    if (accion === 'toggle_vis_on')  params = { ...params, visible: true };
    if (accion === 'basemap' && params.subtipo) base.subtipo = params.subtipo;
    if (accion === 'export'  && params.subtipo) base.subtipo = params.subtipo;
    if (accion === 'renombrar') base.subtipo = params.subtipo;
    if (accion === 'estilo_vago') {
      params = { param: objeto.propEstilo, ...params };
    }

    // Para selector_capa: guardar la acción que lo originó para que
    // chat.js sepa qué hacer después de que el usuario elige la capa.
    if (accion === 'selector_capa') {
      params = { ...params, accionOrigen: params._accionOrigen || null };
    }

    return { ...base, parametros: params };
  }

  return { detectar };

})();
