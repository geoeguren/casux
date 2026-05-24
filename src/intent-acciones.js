/**
 * src/intent/intent-acciones.js — Detectores de acciones del mapa
 *
 * Cada función de este módulo detecta un tipo de intención que NO es
 * "cargar una capa": limpiar el mapa, exportar, cambiar basemap, renombrar,
 * cambiar estilo, agregar una capa al mapa activo, o quitar una capa.
 *
 * Diseño general:
 *   - Cada detector recibe el texto del usuario (string) y devuelve
 *     un objeto { tipo, subtipo?, parametros? } o null si no aplica.
 *   - Los detectores son INDEPENDIENTES entre sí y del scorer de capas.
 *   - Usan normalizarSimple (sin UTILS) para evitar dependencias de carga.
 *   - El orden de evaluación lo decide el orquestador (intent/index.js).
 *
 * Dependencias: window.INTENT_UTILS (intent-utils.js)
 */

window.INTENT_ACCIONES = (() => {

  // Alias locales para legibilidad
  const { normalizarSimple, normalizar, tokenizar, buildPaisesMap } = window.INTENT_UTILS;

  // ══════════════════════════════════════════════════════════════
  // 1. LIMPIAR
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de vaciar el mapa: borrar capas, resetear, etc.
  // El patrón cubre expresiones en ES, EN y PT.

    const PATRON_LIMPIAR = /\b(limpi[ae](r|lo|te)?|limpi[ae](r)?\s+el\s+mapa|borr[ae](r|lo|te)?|borr[ae](r)?\s+todo|vaci[ae](r|lo|te)?|vaci[ae](r)?\s+el\s+mapa|elimin[ae](r)?\s+todo|reset[ae](r)?|reinici[ae](r)?|saca(r)?\s+(las?\s+)?capas?|clear(\s+the\s+map|\s+all|\s+everything)?|clean(\s+the\s+map)?|reset(\s+the\s+map)?|wipe(\s+the\s+map)?|erase(\s+the\s+map)?|start\s+over|remove\s+all(\s+layers?)?|limpa(r)?(\s+o\s+mapa)?|apag[ae](r)?(\s+o\s+mapa)?|apague(\s+o\s+mapa)?|reseta(r)?(\s+o\s+mapa)?|limpe(\s+o\s+mapa)?|remove(r)?\s+tudo)\b/i;

  function detectarLimpiar(texto) {
    return PATRON_LIMPIAR.test(normalizarSimple(texto)) ? { tipo: 'limpiar' } : null;
  }

  // ══════════════════════════════════════════════════════════════
  // 2. EXPORTAR
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de descarga/exportación del mapa o sus datos.
  // Primero verifica que haya un verbo de exportación, luego
  // intenta identificar el formato solicitado.
  // Si no se detecta formato → subtipo 'vago' (abre el selector de formato).

    const PATRON_EXPORT = /\b(export[ae](r)?|export[ae]\s|descarg[ae](r)?|descargue|guard[ae](r)?|guard[ae]\s|guarde|baj[ae](r)?|guardar\s+como|descargar\s+como|download|save(\s+as)?|get\s+the\s+map|baixa(r)?|salva(r)?|descarrega(r)?|gravar)\b/i;

  const FORMATOS_EXPORT = [
    { subtipo: 'jpeg',    patron: /\b(jpeg|jpg|imagen|foto|captura|image|picture|imagem)\b/i },
    { subtipo: 'pdf',     patron: /\b(pdf|portable|documento|document)\b/i },
    { subtipo: 'geojson', patron: /\b(geojson|geo\s*json|vectorial|vector|datos?|capa|data|layer|vetorial|camada)\b/i },
    { subtipo: 'html',    patron: /\b(html|embebido|embed|web|codigo|code|interativo|interactivo)\b/i },
  ];

  function detectarExport(texto) {
    const norm = normalizarSimple(texto);
    if (!PATRON_EXPORT.test(norm)) return null;
    for (const { subtipo, patron } of FORMATOS_EXPORT) {
      if (patron.test(norm)) return { tipo: 'export', subtipo };
    }
    return { tipo: 'export', subtipo: 'vago' };
  }

  // ══════════════════════════════════════════════════════════════
  // 3. BASEMAP
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de cambio del mapa base (fondo).
  // REQUIERE una palabra de contexto (mapa base, fondo, basemap, etc.)
  // para evitar falsos positivos con palabras como "oscuro" o "claro"
  // que aparecen en pedidos de estilo de capas.
  //
  // Si no se identifica la variante → subtipo 'vago' (abre el selector).

  const PATRON_BASEMAP_CONTEXTO = /\b(mapa\s+base|mapa\s+de\s+fondo|mapa\s+fondo|fondo|basemap|base\s+map|background\s+map|background|mapa\s+base|mapa\s+de\s+fundo|fundo)\b/i;

  const OPCIONES_BASEMAP = [
    { subtipo: 'dark',    patron: /\b(oscuro|dark|negro|noche|night|dark\s+matter|escuro|noite|preto)\b/i },
    { subtipo: 'gray',    patron: /\b(claro|gris|gray|grey|blanco|positron|neutro|limpio|light|clean|white|cinza|branco|limpo)\b/i },
    { subtipo: 'voyager', patron: /\b(voyager|color(es)?|con\s+color(es)?|colorful|com\s+cor(es)?)\b/i },
  ];

  function detectarBasemap(texto) {
    const norm = normalizarSimple(texto);
    if (!PATRON_BASEMAP_CONTEXTO.test(norm)) return null;
    for (const { subtipo, patron } of OPCIONES_BASEMAP) {
      if (patron.test(norm)) return { tipo: 'basemap', subtipo };
    }
    return { tipo: 'basemap', subtipo: 'vago' };
  }

  // ══════════════════════════════════════════════════════════════
  // 4. RENOMBRAR
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de cambio de nombre del chat o mapa.
  // Si el usuario especifica el nombre en el mismo mensaje → subtipo 'especifico'.
  // Si solo indica que quiere renombrar → subtipo 'vago' (pide el nombre).
  //
  // La extracción del nombre usa regex sobre el texto ORIGINAL (no normalizado)
  // para preservar mayúsculas y tildes en el nombre deseado.

    const PATRON_RENOMBRAR = /\b(renombr[ae](r|lo|se)?|renombré|llam[ae](r|lo|le)?(\s+(al\s+)?(mapa|chat|map))?|cambi[ae](r)?(\s+el\s+)?(nombre|titulo)|nombr[ae]r(lo)?|nombr[ae]\s+(el|al|lo|este|ese|un)\s+(mapa|chat|map)|titul[ae](r|lo)?|el\s+nombre\s+(es|era|sera|va\s+a\s+ser)|rename(\s+(the\s+)?(map|chat))?|call(\s+it|\s+the\s+map)?|name(\s+it|\s+the\s+map)?|title(\s+it)?|the\s+name\s+(is|will\s+be)|renomear|renomeie|cham[ae](r)?(\s+o\s+(mapa|chat))?|nomear|nomeie|o\s+nome\s+(e|era|sera|vai\s+ser))\b/i;

  function detectarRenombrar(texto) {
    const norm = normalizarSimple(texto);
    if (!PATRON_RENOMBRAR.test(norm)) return null;

    // Intentar extraer el nombre deseado del texto original
    const matchNombre =
      texto.match(/(?:llamalo?|renombralo?\s+(?:como\s+)?|titulalo?\s*|el\s+nombre\s+(?:es|sera|va\s+a\s+ser)\s+|llam[aáa]\s+(?:a\s+)?(?:este|ese|el|un|al?)?\s*(?:mapa|chat|este)\s+)["]?([^"'\n]{2,40})["]?/i) ||
      texto.match(/(?:llam[aá]\s+(?:a\s+)?(?:este|ese)\s+(?:mapa|chat)\s*["']?)([^"'\n]{2,40})['"]/i) ||
      texto.match(/(?:como\s+)["]([^"'\n]{2,40})["]/i) ||
      texto.match(/(?:call\s+(?:it|the\s+map)\s+|rename\s+(?:it\s+)?(?:to\s+)?|name\s+it\s+|the\s+name\s+is\s+)["]?([^"'\n]{2,40})["]?/i) ||
      texto.match(/(?:chama(?:r)?\s+(?:o\s+mapa\s+)?(?:de\s+)?|renomeia(?:r)?\s+(?:para\s+)?|o\s+nome\s+(?:e|vai\s+ser)\s+)["]?([^"'\n]{2,40})["]?/i);

    const nombre = matchNombre?.[1]?.trim();
    return {
      tipo:       'renombrar',
      subtipo:    nombre ? 'especifico' : 'vago',
      parametros: nombre ? { nombre } : {},
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 5. ESTILO
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de cambio visual en capas cargadas: color, tamaño,
  // grosor, ícono, geometría de símbolo, opacidad.
  //
  // Dos subtipos:
  //   'especifico' → el usuario ya indicó el cambio concreto (color rojo, más grande, etc.)
  //                  o hizo click en uno de los botones rápidos del panel de estilo.
  //   'vago'       → quiere cambiar algo visual pero no especificó qué.
  //                  Se abre el selector de propiedades.

  const PATRON_ESTILO = /\b(estilo|color(es)?|relleno|borde|grosor|tamano|icono|simbolo|apariencia|aspecto|hacelos?\s+mas|hacelas?\s+mas|ponelo|ponerlo|forma|geometria|style|fill|stroke|outline|thickness|weight|icon|symbol|appearance|make\s+(it|them)|shape|circle|square|size|radius|radio|cor|cores|preenchimento|borda|espessura|ícone|símbolo|aparência|forma|geometria|circulo|quadrado|tamanho|grande|chico|chica|grueso|fino|bigger|smaller|larger|thicker|thinner|maior|menor)\b/i;

  // Valores concretos que confirman que el usuario ya sabe qué quiere cambiar
  const PATRON_ESTILO_ESPECIFICO = /\b(rojo|azul|verde|amarillo|naranja|violeta|rosa|negro|blanco|gris|celeste|marron|mas\s+(grandes?|chicos?|chicas?|gruesas?|gruesos?|finas?|finos?|pequen[ao]s?|oscuro|claro|transparente)|tambien|lo\s+mismo|idem|opacidad|transparencia|red|blue|green|yellow|orange|purple|pink|black|white|gray|grey|cyan|brown|bigger|smaller|larger|thicker|thinner|darker|lighter|transparent|opacity|same|vermelho|azul|verde|amarelo|laranja|violeta|rosa|preto|branco|cinza|ciano|marrom|maior|menor|mais\s+(grosso|fino|escuro|claro|transparente)|transparencia|opacidade|#[0-9a-fA-F]{3,6}|\d+(\.\d+)?\s*(px|pt|puntos?))\b/i;

  // Función auxiliar: obtiene los textos de los botones rápidos de estilo
  // para detectar clicks directos en ellos (llegan como texto exacto al chat)
  function getMensajesBotonesEstilo() {
    try {
      const t = window.I18N?.t || (() => '');
      return new Set([
        t('style_change_size'), t('style_change_color_point'), t('style_change_icon'),
        t('style_change_weight'), t('style_change_color_line'),
        t('style_change_fill'), t('style_change_border'),
      ]);
    } catch { return new Set(); }
  }

  // Patrones para identificar qué propiedad de estilo quiere cambiar el usuario.
  // Usado cuando subtipo='vago' para pre-seleccionar la propiedad en el selector.
  const PATRON_PARAM_COLOR  = /\b(color(es)?|colou?r|relleno|tono|tinte|fill|cor|cores|preenchimento)\b/i;
  const PATRON_PARAM_SIZE   = /\b(tamano|tamaño|radio|size|grande|chico|chica|radius|bigger|smaller|tamanho)\b/i;
  const PATRON_PARAM_WEIGHT = /\b(grosor|grueso|fino|weight|linea|línea|thickness|thicker|thinner|espessura)\b/i;
  const PATRON_PARAM_ICON   = /\b(icono|ícono|simbolo|símbolo|icon|marker)\b/i;
  const PATRON_PARAM_GEOM   = /\b(geometria|geometría|forma|shape|circulo|círculo|cuadrado|square|circle)\b/i;

  function _extractParam(norm) {
    if (PATRON_PARAM_GEOM.test(norm))   return 'geom';
    if (PATRON_PARAM_ICON.test(norm))   return 'icon';
    if (PATRON_PARAM_SIZE.test(norm))   return 'radius';
    if (PATRON_PARAM_WEIGHT.test(norm)) return 'weight';
    if (PATRON_PARAM_COLOR.test(norm))  return 'color';
    return null;
  }

  function detectarEstilo(texto) {
    // Click directo en botón de estilo → siempre específico
    if (getMensajesBotonesEstilo().has(texto)) return { tipo: 'estilo', subtipo: 'especifico' };
    const norm = normalizarSimple(texto);
    if (!PATRON_ESTILO.test(norm)) return null;
    if (PATRON_ESTILO_ESPECIFICO.test(norm)) return { tipo: 'estilo', subtipo: 'especifico' };
    const param = _extractParam(norm);
    return { tipo: 'estilo', subtipo: 'vago', parametros: { param } };
  }

  // ══════════════════════════════════════════════════════════════
  // 6. AGREGAR CAPA
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos del tipo "también mostrá X" o "agregame Y"
  // cuando ya hay capas cargadas en el mapa.
  //
  // A diferencia de detectarCapa, se evalúa SIN guardia de historial —
  // el usuario puede pedir agregar una capa incluso si hubo conversación
  // previa con el LLM.
  //
  // Quita el verbo de adición del texto antes de pasarlo al scorer
  // para que buscarCapa solo vea el nombre de la capa pedida.

  // ES: agregar/añadir/sumar  EN: add/include/also show  PT: adicionar/incluir/também
  // ^ al inicio evita falsos positivos con "quiero agregar algo al informe"
  const PATRON_AGREGAR = /^(agrega[r]?(?:me|le|nos)?|a[nñ]adi[r]?(?:me|le|nos)?|suma[r]?(?:me|le|nos)?|incorpora[r]?(?:me|le|nos)?|carga[r]?(?:me|le|nos)?\s+(?:tambi[eé]n|ademas|adem[aá]s)|ponele\s+(?:tambi[eé]n|ademas|adem[aá]s|encima)?|tambi[eé]n\s+(?:quiero\s+ver|mostra[r]?(?:me)?|carga[r]?(?:me)?|agrega[r]?(?:me)?)|ademas\s+(?:quiero\s+ver|mostra[r]?(?:me)?|carga[r]?(?:me)?)|adem[aá]s\s+(?:quiero\s+ver|mostra[r]?(?:me)?|carga[r]?(?:me)?)|y\s+tambi[eé]n\s+(?:quiero\s+ver|mostr[aá]|mostrame|agrega)|add(?:\s+also)?|include|also\s+show|show\s+also|also\s+add|add\s+also|and\s+also\s+show|on\s+top\s+of\s+that\s+show|additionally\s+show|adiciona[r]?(?:me)?|inclui[r]?(?:me)?|acrescenta[r]?(?:me)?|tamb[eé]m\s+(?:quero\s+ver|mostra[r]?(?:me)?|carrega[r]?(?:me)?|adiciona[r]?(?:me)?)|alem\s+disso\s+mostra[r]?|al[eé]m\s+disso\s+(?:mostra[r]?|adiciona[r]?))\s+/i;

  function detectarAgregar(textoUsuario) {
    const norm = normalizarSimple(textoUsuario);
    if (!PATRON_AGREGAR.test(norm)) return null;

    // Solo aplica si ya hay capas cargadas en el mapa
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    if (!Object.keys(activeLayers).length) return null;

    // Quitar el verbo de adición para dejar solo el nombre de la capa
    const textoSinVerbo = textoUsuario.replace(PATRON_AGREGAR, '').trim();
    if (!textoSinVerbo) return null;

    // Estrategia de scoring en dos pasos:
    // 1. Intentar con el texto sin verbo (caso ideal)
    // 2. Si falla, intentar con el texto completo — el scorer ignora stopwords
    //    y el verbo de adición tiene IDF bajo (no matchea keywords de capas).
    let resultado = window.INTENT_CAPA?.detectarCapaDirecta?.(textoSinVerbo);
    if (!resultado) {
      resultado = window.INTENT_CAPA?.detectarCapaDirecta?.(textoUsuario);
    }
    if (!resultado) return null;

    return { tipo: 'agregar', parametros: resultado.parametros };
  }

  // ══════════════════════════════════════════════════════════════
  // 7. QUITAR CAPA
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de eliminar una capa del mapa activo.
  // Resuelve el nombre pedido contra las capas actualmente visibles.
  //
  // Caso especial: si solo hay una capa activa y el pedido es vago
  // ("sacala", "quitala"), asume esa capa sin necesidad de matching.

  // ES: quitar/sacar/eliminar/borrar  EN: remove/delete/drop  PT: remover/deletar/tirar
  // Reescrito sin me? suelto para evitar el bug de word-boundary (igual que toggle).
  const PATRON_QUITAR = /^(?:sacar?(?:me|le|nos)?|quitar?(?:me|le|nos)?|eliminar?(?:me|le|nos)?|borrar?(?:me|le|nos)?|remueve|tirar?(?:me|le|nos)?|remove|delete|drop|get\s+rid\s+of|take\s+off|remover?(?:me)?|deletar?(?:me)?|apagar?(?:me|le|nos)?)\s+/i;

  // Busca la mejor coincidencia entre el texto pedido y las capas activas.
  // Usa scoring simple (coincidencia de tokens) sobre título y layerKey.
  // Recibe el texto ya normalizado (sin tildes, minúsculas).
  function _matchCapaActiva(queryNorm) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const tokens       = tokenizar(queryNorm);
    if (!tokens.length) return null;

    let mejorKey   = null;
    let mejorScore = 0;

    for (const [mapKey, entry] of Object.entries(activeLayers)) {
      const tituloNorm   = normalizar(entry.titulo || '');
      const layerKeyNorm = normalizar(entry.layerKey || '');
      const texto        = tituloNorm + ' ' + layerKeyNorm;

      let score = 0;
      for (const token of tokens) {
        const sv = [];
        if (token.endsWith('es') && token.length > 4) sv.push(token.slice(0, -2));
        if (token.endsWith('s')  && token.length > 3) sv.push(token.slice(0, -1));
        if (tituloNorm.includes(token) || sv.some(s => tituloNorm.includes(s))) score += 4;
        else if (texto.includes(token) || sv.some(s => texto.includes(s)))      score += 2;
      }
      if (score > mejorScore) { mejorScore = score; mejorKey = mapKey; }
    }

    return mejorScore >= 2 ? mejorKey : null;
  }

  function detectarQuitar(textoUsuario) {
    const norm = normalizarSimple(textoUsuario);
    if (!PATRON_QUITAR.test(norm)) return null;

    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    if (!Object.keys(activeLayers).length) return null;

    // Usar norm para el replace — evita el bug de tildes ("quitá" ≠ "quita[r]?")
    const normSinVerbo = norm.replace(PATRON_QUITAR, '').trim();

    // Limpiar residual genérico: "la", "el", "the", "capa", "layer", etc.
    const _GENERICAS = /^(?:la|el|a|o|the|it|capa|layer|camada|essa|esta|esa|that|this|una|um|uma|los|las|os|as)$/i;
    const residual = normSinVerbo
      .replace(/^(?:la|el|a|o|the|it|capa|layer|camada|essa|esta|esa|that|this|una|um|uma|los|las|os|as)\s+/i, '')
      .replace(/\s+(?:la|el|the|capa|layer|camada)$/i, '')
      .trim()
      .replace(_GENERICAS, '')
      .trim();

    const keys = Object.keys(activeLayers);

    // Una sola capa activa → asumir esa capa
    if (keys.length === 1) return { tipo: 'quitar', parametros: { mapKey: keys[0] } };

    // Varias capas con nombre identificable → resolver directo
    if (residual) {
      const mapKey = _matchCapaActiva(residual);
      if (mapKey) return { tipo: 'quitar', parametros: { mapKey } };
    }

    // Pedido vago con varias capas → selector de capa (no null → LLM)
    return { tipo: 'quitar', parametros: { mapKey: null } };
  }

  // ══════════════════════════════════════════════════════════════
  // 8. TOGGLE VISIBILIDAD
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de mostrar u ocultar una capa del mapa activo.
  // Opera de forma análoga a detectarQuitar pero sin eliminar la capa.
  //
  // Verbos de ocultamiento: ocultar, esconder, apagar, desactivar, hide
  // Verbos de mostrado:     mostrar, ver, activar, encender, show
  //
  // Cuando hay una sola capa activa y el pedido es vago ("ocultala") →
  // asume esa capa sin necesidad de matching.
  // Cuando hay varias → usa _matchCapaActiva para resolver.
  // Si no puede identificar la capa → null (evita falsos positivos).
  //
  // El campo `visible` indica la acción deseada:
  //   false → ocultar   true → mostrar   null → toggle (invertir estado actual)

  // ES: ocultar/esconder/apagar/desactivar  EN: hide/turn off/disable  PT: ocultar/esconder/desativar
  // Nota: usar (?:me)? en lugar de me? evita el bug de \b con cuantificador sobre char word.
  const PATRON_OCULTAR = /\b(?:ocultar?(?:me|le|nos)?|esconder?(?:me|le|nos)?|apagar?(?:me|le|nos)?|desactivar?(?:me|le|nos)?|deshabilitarme?|sacar?(?:me)?\s+de\s+(?:la\s+)?vista|hide|turn\s+off|disable|esconder?\s+a\s+camada|ocultar?\s+a\s+camada|desativar?\s+a\s+camada|desabilitar?\s+a\s+camada|tirar?\s+do\s+mapa)\b/i;

  // ES: mostrar/activar  EN: show/turn on/enable  PT: mostrar/exibir/ativar
  const PATRON_MOSTRAR = /\b(?:mostrar?(?:me|le|nos)?|muestra[r]?(?:me|le|nos)?|volver\s+a\s+(?:ver|mostrar)|activar?(?:me|le|nos)?|encender?(?:me|le|nos)?|habilitar?(?:me|le|nos)?|show|turn\s+on|enable|display|bring\s+back|show\s+again|mostrar?\s+a\s+camada|exibir?\s+a\s+camada|ativar?\s+a\s+camada|habilitar?\s+a\s+camada|mostrar?\s+de\s+novo|voltar\s+a\s+mostrar)\b/i;

  function detectarToggleVisibilidad(textoUsuario) {
    const norm = normalizarSimple(textoUsuario);

    const esOcultar = PATRON_OCULTAR.test(norm);
    const esMostrar = PATRON_MOSTRAR.test(norm);
    // Matchear el patrón primero — sin depender de activeLayers.
    // El check de capas activas se hace después del match para poder dar
    // un mensaje útil al usuario si el mapa está vacío.
    if (!esOcultar && !esMostrar) return null;

    const visible = esMostrar ? true : false;

    // Usar norm (ya sin tildes) para el replace, así los patrones sin tilde
    // como ocult[ae] o ocultar[?] matchean correctamente aunque el usuario
    // escriba con tilde ("ocultá", "mostrá", etc.).
    const normSinVerbo = norm
      .replace(esMostrar ? PATRON_MOSTRAR : PATRON_OCULTAR, '')
      .trim();

    // Quitar artículos, pronombres y palabras genéricas residuales.
    // Primero quitar al inicio, luego al final, luego verificar si
    // el residuo completo ES una palabra genérica (ej: solo "capa").
    const _GENERICAS = /^(la|el|a|o|the|it|capa|layer|camada|essa|esta|esa|that|this|una|um|uma|los|las|os|as)$/i;
    const residual = normSinVerbo
      .replace(/^(la|el|a|o|the|it|capa|layer|camada|essa|esta|esa|that|this|una|um|uma|los|las|os|as)\s+/i, '')
      .replace(/\s+(la|el|the|capa|layer|camada)$/i, '')
      .trim()
      .replace(_GENERICAS, '')  // si quedó solo una palabra genérica, vaciar
      .trim();

    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const keys = Object.keys(activeLayers);

    // Sin capas → devolver igualmente la intención con mapKey null;
    // chat.js mostrará el mensaje apropiado ("no hay capas en el mapa").
    if (!keys.length) {
      return { tipo: 'toggle_visibilidad', parametros: { mapKey: null, visible } };
    }

    // Una sola capa activa → asumir esa capa sin necesidad de matching
    if (keys.length === 1) {
      return { tipo: 'toggle_visibilidad', parametros: { mapKey: keys[0], visible } };
    }

    // Varias capas: intentar resolver por nombre en el residual
    if (!residual) {
      // Pedido vago con varias capas → selector de capa
      return { tipo: 'toggle_visibilidad', parametros: { mapKey: null, visible } };
    }

    const mapKey = _matchCapaActiva(residual);
    if (mapKey) {
      // Capa identificada por nombre → ejecutar directo
      return { tipo: 'toggle_visibilidad', parametros: { mapKey, visible } };
    }

    // No pudo identificar la capa por nombre → selector de capa (no al LLM)
    // El usuario dijo "ocultá la capa" con varias activas y no especificó cuál.
    return { tipo: 'toggle_visibilidad', parametros: { mapKey: null, visible } };
  }

  // ══════════════════════════════════════════════════════════════
  // 9. ESTILO ESPECÍFICO (resolver valor sin LLM)
  // ══════════════════════════════════════════════════════════════
  //
  // Complementa detectarEstilo: cuando el subtipo ya es 'especifico',
  // intenta extraer el valor concreto (color, número, opacidad) para
  // poder ejecutar el cambio sin derivar al LLM.
  //
  // Devuelve { tipo:'estilo', subtipo:'resuelto', parametros:{ prop, value, mapKey? } }
  // si pudo resolver el valor, o null si no puede (el flujo vago sigue al LLM).
  //
  // Cuando hay varias capas activas → mapKey queda en null y el llamador
  // muestra un selector de capa antes de aplicar.

  // Tabla de colores con nombre en ES/EN/PT → hex.
  // Las claves PT usan nombres sin colisión con ES (no repetir 'azul', 'verde', etc.).
  const COLOR_MAP = {
    // ES
    rojo: '#e63946', roja: '#e63946',
    azul: '#457b9d', azules: '#457b9d',
    verde: '#52b788', verdes: '#52b788',
    amarillo: '#f7d24a', amarilla: '#f7d24a',
    naranja: '#f4a261',
    violeta: '#6a4c93', lila: '#c77dff',
    rosa: '#ff6b6b', rosado: '#ff6b6b', rosada: '#ff6b6b',
    negro: '#222222', negra: '#222222',
    blanco: '#f8f9fa', blanca: '#f8f9fa',
    gris: '#888888', grises: '#888888',
    celeste: '#90e0ef',
    marron: '#a47856', cafe: '#a47856',
    turquesa: '#2a9d8f',
    cian: '#00b4d8',
    magenta: '#e040fb', fucsia: '#ff006e',
    indigo: '#3d52a0',
    // EN
    red: '#e63946',
    blue: '#457b9d',
    green: '#52b788',
    yellow: '#f7d24a',
    orange: '#f4a261',
    purple: '#6a4c93',
    pink: '#ff6b6b',
    black: '#222222',
    white: '#f8f9fa',
    gray: '#888888', grey: '#888888',
    brown: '#a47856',
    cyan: '#00b4d8',
    teal: '#2a9d8f',
    // PT — solo formas exclusivas del portugués para evitar colisión con ES
    vermelho: '#e63946', vermelha: '#e63946',
    amarelo: '#f7d24a', amarela: '#f7d24a',
    laranja: '#f4a261',
    roxo: '#6a4c93', roxa: '#6a4c93',
    preto: '#222222', preta: '#222222',
    branco: '#f8f9fa', branca: '#f8f9fa',
    cinza: '#888888',
    marrom: '#a47856',
    anil: '#3d52a0',
  };

  // Regex para capturar opacidad / transparencia numérica
  const PATRON_OPACIDAD_NUM = /(\d+(?:[.,]\d+)?)\s*%/;

  // Regex para color #hex directo
  const PATRON_HEX = /#([0-9a-fA-F]{3,6})\b/;

  // Regex para valores numéricos de tamaño/grosor
  const PATRON_NUM = /\b(\d+(?:[.,]\d+)?)\s*(?:px|pt|puntos?)?\b/;

  function _resolverProp(norm) {
    // Determinar qué propiedad se quiere cambiar (ES / EN / PT)
    if (/\b(opacidad|transparencia|opaco|transparente|opacity|transparent|opaque|opacidade|transparencia|opaco)\b/.test(norm)) return 'opacity';
    if (/\b(tamano|radio|grandes?|chicos?|chicas?|size|radius|bigger|larger|smaller|tamanho|raio|peque[nñ][ao]s?|maior|menor)\b/.test(norm)) return 'radius';
    if (/\b(grosor|gruesas?|gruesos?|finas?|finos?|gordos?|gordas?|delgados?|delgadas?|weight|thick|thin|thicker|thinner|espessura|grossos?|grossas?|grossura)\b/.test(norm)) return 'weight';
    if (/\b(color|relleno|fill|tono|tinte|cor|cores|preenchimento|coloracao|coloração)\b/.test(norm)) return 'color';
    // Último recurso: si menciona un color o hex, es color
    if (PATRON_HEX.test(norm)) return 'color';
    // Si menciona un nombre de color conocido en cualquier idioma
    const normLower = norm.toLowerCase();
    if (Object.keys(COLOR_MAP).some(k => normLower.includes(k))) return 'color';
    return null;
  }

  function _resolverValor(norm, prop, activeLayers, mapKey) {
    if (prop === 'color') {
      // Primero: #hex directo
      const hexMatch = norm.match(PATRON_HEX);
      if (hexMatch) return '#' + hexMatch[1].padEnd(6, hexMatch[1]);

      // Segundo: nombre de color
      const normLower = norm.toLowerCase();
      // Buscar de más largo a más corto para evitar matches parciales
      const sorted = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);
      for (const nombre of sorted) {
        if (normLower.includes(nombre)) return COLOR_MAP[nombre];
      }
      return null;
    }

    if (prop === 'opacity') {
      // Porcentaje numérico explícito
      const pctMatch = norm.match(PATRON_OPACIDAD_NUM);
      if (pctMatch) return parseFloat(pctMatch[1].replace(',', '.')) / 100;

      // Palabras relativas (ES / EN / PT)
      if (/\b(mas\s+transparente|menos\s+opaco|more\s+transparent|less\s+opaque|mais\s+transparente|menos\s+opaco)\b/.test(norm)) {
        const cur = mapKey ? (activeLayers[mapKey]?.style?.fillOpacity ?? 0.5) : 0.5;
        return Math.max(0.05, +(cur - 0.2).toFixed(2));
      }
      if (/\b(mas\s+opaco|menos\s+transparente|more\s+opaque|less\s+transparent|mais\s+opaco|menos\s+transparente)\b/.test(norm)) {
        const cur = mapKey ? (activeLayers[mapKey]?.style?.fillOpacity ?? 0.5) : 0.5;
        return Math.min(1, +(cur + 0.2).toFixed(2));
      }
      return null;
    }

    if (prop === 'radius' || prop === 'weight') {
      // Número explícito
      const numMatch = norm.match(PATRON_NUM);
      if (numMatch) {
        const v = parseFloat(numMatch[1].replace(',', '.'));
        if (v >= 0.5 && v <= 50) return v;
      }
      // Palabras relativas
      const cur = mapKey
        ? (prop === 'radius'
            ? (activeLayers[mapKey]?.style?.radius ?? 5)
            : (activeLayers[mapKey]?.style?.weight ?? 2))
        : (prop === 'radius' ? 5 : 2);
      // ES: más grande/chico/grueso/fino  EN: bigger/smaller/thicker/thinner  PT: maior/menor/mais grosso/mais fino
      if (/\b(mas\s+grandes?|aumenta[r]?|sube[r]?|subir|bigger|larger|increase|more\s+big|maior|aumentar?|mais\s+grande)\b/.test(norm)) {
        return Math.min(prop === 'radius' ? 25 : 10, +(cur + 2).toFixed(1));
      }
      if (/\b(mas\s+chicos?|mas\s+chicas?|mas\s+peque[nñ][ao]s?|achica[r]?|reduce[r]?|reducir|baja[r]?|smaller|decrease|menor|reduzir?|mais\s+pequ)\b/.test(norm)) {
        return Math.max(0.5, +(cur - 2).toFixed(1));
      }
      if (/\b(mas\s+gruesas?|mas\s+gruesos?|mas\s+gordos?|mas\s+gordas?|thicker|mais\s+gross|mais\s+espess|mas\s+espeso)\b/.test(norm)) {
        return Math.min(10, +(cur + 1.5).toFixed(1));
      }
      if (/\b(mas\s+finas?|mas\s+finos?|mas\s+delgados?|mas\s+delgadas?|thinner|mais\s+fin|mais\s+delgad|mais\s+fino)\b/.test(norm)) {
        return Math.max(0.5, +(cur - 1.5).toFixed(1));
      }
      return null;
    }

    return null;
  }

  function detectarEstiloResuelto(textoUsuario) {
    // Solo actúa si el detector base ya confirmó que es estilo específico
    const base = detectarEstilo(textoUsuario);
    if (!base || base.subtipo !== 'especifico') return null;

    const norm = normalizarSimple(textoUsuario);
    const prop = _resolverProp(norm);
    if (!prop) return null;

    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const keys = Object.keys(activeLayers);
    if (!keys.length) return null;

    // Con una sola capa activa → resolver valor ya (necesita el estilo actual)
    // Con varias → no resolver valor aún (no sabemos cuál capa y el estilo puede diferir)
    const mapKey = keys.length === 1 ? keys[0] : null;

    const value = _resolverValor(norm, prop, activeLayers, mapKey);
    if (value === null) return null;

    return {
      tipo:       'estilo',
      subtipo:    'resuelto',
      parametros: { prop, value, mapKey },
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 10. CLASIFICAR
  // ══════════════════════════════════════════════════════════════
  //
  // Detecta pedidos de clasificación cromática de capas activas.
  // Solo actúa cuando hay capas en el mapa.
  //
  // Si puede identificar la capa y el campo → devuelve un plan
  // de clasificación completo para ejecutar sin LLM.
  // Si hay ambigüedad → null → LLM.
  //
  // El campo se busca en los `attributes` de la capa activa
  // comparando el texto del usuario con el label de cada atributo.

  // ES: clasificar/pintar por/colorear por  EN: classify/color by/categorize  PT: classificar/colorir por
  const PATRON_CLASIFICAR = /\b(clasificá|clasific[ae](r)?|clasifique|pinta[r]?\s+por|colorea[r]?\s+por|color[ií]a\s+por|categori[zc]á|categori[zc][ae](r)?|categorice|agrupa[r]?\s+por|diferencia[r]?\s+por|distingui[r]?\s+por|separa[r]?\s+por|divid[eé]\s+por|dividi[r]?\s+por|classify|color\s+by|categorize|group\s+by|show\s+by|classify\s+by|distinguish\s+by|separate\s+by|break\s+down\s+by|split\s+by|classifica[r]?|classificar?\s+por|colorir?\s+por|agrupar?\s+por|diferenciar?\s+por|separar?\s+por|dividir?\s+por)\b/i;

  function detectarClasificar(textoUsuario) {
    if (!PATRON_CLASIFICAR.test(normalizarSimple(textoUsuario))) return null;

    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    if (!Object.keys(activeLayers).length) return null;

    // Texto sin el verbo de clasificación para buscar el campo y la capa
    const textoSinVerbo = textoUsuario.replace(PATRON_CLASIFICAR, '').trim();
    const normSinVerbo  = normalizar(textoSinVerbo);

    // ── Paso 1: identificar la capa objetivo ──────────────────
    //
    // Si hay una sola capa activa → usarla directamente.
    // Si hay varias → intentar identificar cuál menciona el texto.
    // Si no se puede → devolver { mapKey: null } para que chat.js muestre selector.
    const keys = Object.keys(activeLayers);
    let targetMapKey = keys.length === 1 ? keys[0] : null;

    if (!targetMapKey && normSinVerbo) {
      // Intentar match por nombre de capa en el texto residual
      let mejorScore = 0;
      for (const [mapKey, entry] of Object.entries(activeLayers)) {
        const tituloNorm = normalizar(entry.titulo || entry.layerKey || '');
        const layerKeyNorm = normalizar(entry.layerKey || '');
        let score = 0;
        for (const token of normSinVerbo.split(/\s+/).filter(t => t.length > 2)) {
          if (tituloNorm.includes(token)) score += 2;
          else if (layerKeyNorm.includes(token)) score += 1;
        }
        if (score > mejorScore) { mejorScore = score; targetMapKey = mapKey; }
      }
      if (mejorScore === 0) targetMapKey = null;
    }

    // ── Paso 2: buscar campo clasificable en la capa objetivo ─
    //
    // Solo busca en atributos con label no vacío Y que aparezcan en el texto.
    // Si el usuario no especificó campo → candidatos vacíos → selector de campo.
    // Atributos con classifiable:true tienen prioridad sobre los demás.
    const capasABuscar = targetMapKey
      ? [[targetMapKey, activeLayers[targetMapKey]]]
      : Object.entries(activeLayers);

    const candidatos = [];
    for (const [mapKey, entry] of capasABuscar) {
      const layerDef = window.LAYERS?.[entry.layerKey];
      if (!layerDef?.attributes?.length) continue;

      // Atributos clasificables: visible:true (todos los que el usuario puede ver)
      // No filtrar por classifiable:true ni label no vacío — el usuario puede
      // querer clasificar por cualquier campo visible, no solo los predefinidos.
      const attrs = layerDef.attributes.filter(a => a.visible === true);

      for (const attr of attrs) {
        const labelNorm = normalizar(attr.label || '');
        const campoNorm = normalizar(attr.campo || '');

        // Solo matchear si el label/campo tiene contenido real (evita bug de '' siempre true)
        const matchLabel = labelNorm.length > 0 && normSinVerbo.includes(labelNorm);
        const matchCampo = campoNorm.length > 0 && normSinVerbo.includes(campoNorm);
        // Bonus si el atributo está marcado como classifiable
        const esClassifiable = attr.classifiable === true;

        // Si el usuario no especificó campo (normSinVerbo vacío), solo incluir
        // atributos que matcheen por texto — nunca elegir automáticamente por
        // classifiable:true solo. Eso se muestra en el selector de campo.
        if (!normSinVerbo) continue;

        if (!matchLabel && !matchCampo && !esClassifiable) continue;

        const tipoClasif = /num|area|longitud|pobla|cant|total|valor|porc|dens|super/i.test(attr.campo || '')
          ? 'graduated'
          : 'categorized';

        // Resolver el label más legible disponible
        const _lang   = window.I18N?.getLang?.() || 'es';
        const labelI18n = _lang === 'en' ? (attr.labelEn || attr.label) : (attr.label || attr.labelEn);
        const displayLabel = (labelI18n && labelI18n.trim()) ? labelI18n : attr.campo;

        candidatos.push({
          mapKey,
          layerKey:  entry.layerKey,
          field:     attr.campo,
          label:     displayLabel,
          type:      tipoClasif,
          score:     (matchLabel ? 4 : 0) + (matchCampo ? 2 : 0) + (esClassifiable ? 1 : 0),
        });
      }
    }

    // ── Paso 3: resolver ──────────────────────────────────────

    if (!candidatos.length) {
      // No se identificó campo.
      // Si hay una sola capa → selector de campo en chat.js.
      // Si hay varias y targetMapKey es null → selector de capa primero, luego de campo.
      // En ambos casos devolver la intención con field:null para que chat.js maneje.
      return {
        tipo:       'clasificar',
        parametros: {
          mapKey:   targetMapKey,
          layerKey: targetMapKey ? activeLayers[targetMapKey].layerKey : null,
          field: null, label: null, type: null, palette: null,
        },
      };
    }

    // Ambigüedad entre capas distintas → LLM
    const capasCandidatas = new Set(candidatos.map(c => c.mapKey));
    if (capasCandidatas.size > 1) return null;

    const mejor = candidatos.sort((a, b) => b.score - a.score)[0];

    return {
      tipo:       'clasificar',
      parametros: {
        mapKey:   mejor.mapKey,
        layerKey: mejor.layerKey,
        field:    mejor.field,
        label:    mejor.label,
        type:     mejor.type,
        palette:  mejor.type === 'graduated' ? 'seq_blues' : 'qualitative',
      },
    };
  }

  // ── API pública ───────────────────────────────────────────────
  return {
    detectarLimpiar,
    detectarExport,
    detectarBasemap,
    detectarRenombrar,
    detectarEstilo,
    detectarEstiloResuelto,
    detectarAgregar,
    detectarQuitar,
    detectarToggleVisibilidad,
    detectarClasificar,
  };

})();
