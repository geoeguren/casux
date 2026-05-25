/**
 * src/intent/intent-verbos.js — Vocabulario de verbos del motor de intenciones
 *
 * Agrupa verbos por SEMÁNTICA, no por acción resultante.
 * La acción se resuelve en la tabla (Verbo × Objeto) de intent-tabla.js.
 *
 * Diseño:
 *   - Cada grupo cubre ES (Rioplatense + formal + neutro) + EN + PT
 *   - Formas conjugadas: infinitivo, imperativo vos, imperativo formal,
 *     subjuntivo, participio pasado, presente indicativo
 *   - Sin tildes en los patrones: se aplican sobre texto normalizado (normalizarSimple)
 *   - El símbolo ^ solo se usa donde el verbo DEBE ir al inicio del enunciado
 *
 * Grupos semánticos:
 *   CARGAR    → traer algo nuevo al mapa
 *   AGREGAR   → sumar algo a lo que ya hay
 *   BORRAR    → eliminar / limpiar / quitar (objeto lo diferencia)
 *   OCULTAR   → hacer invisible (reversible)
 *   MOSTRAR   → hacer visible / traer de vuelta
 *   ESTILO    → cambiar apariencia visual
 *   CLASIFICAR → colorear por campo / categorizar
 *   LIMPIAR_PROP → resetear una propiedad (clasificación, estilo, nombre)
 *   EXPORTAR  → descargar el mapa o sus datos
 *   BASEMAP   → cambiar mapa de fondo
 *   RENOMBRAR → cambiar el nombre del chat/mapa
 *   FILTRAR   → filtrar objetos de una capa ya cargada
 *
 * Uso:
 *   window.INTENT_VERBOS.detectarGrupo(textoNorm) → string | null
 */

window.INTENT_VERBOS = (() => {

  // ── Helpers ───────────────────────────────────────────────────

  // Verbo conjugado en todas las formas relevantes:
  //   radical + terminaciones para verbos -ar (vos, formal, infinitivo, 3p sing)
  // Ej: verb('export') → /\b(export[ae](r|lo|la|se|me|le|nos)?|exported?)\b/i
  // (No se usa directamente — los patrones están escritos explícitamente
  //  para mayor claridad y control exacto de cada verbo.)

  // ── Patrones de grupos verbales ───────────────────────────────

  const GRUPOS = {

    // ─────────────────────────────────────────────────────────────
    // CARGAR — traer algo nuevo al mapa (primera vez, sin acumulación)
    // Verbos: mostrar, ver, traer, cargar, poner, buscar, encontrar, quiero
    // Nota: "mostrar" aparece aquí Y en MOSTRAR_VIS — el objeto desambigua
    // ─────────────────────────────────────────────────────────────
    CARGAR: /\b(?:mostr[ae](r|me|me|le|nos)?|muestra(?:me|le|nos)?|ver?|quiero\s+ver|quer[ae](r|me)?\s+ver|tr[ae](r|me|le|nos)?|trae(?:me|le|nos)?|carg[ae](r|me|le|nos)?|pon[ae](r|me|le|nos)?|pone(?:me|le|nos)?|bus(?:c[ae](r|me)?|que(?:me)?)|encontr[ae](r|me)?|dame|da(?:me)?|display|show(?:\s+me)?|get|fetch|load|bring(?:\s+up)?|mostr[ae](r|me)?|exib[ei](r|me)?|carrega(r|me)?|traze(r|me)?)\b/i,

    // ─────────────────────────────────────────────────────────────
    // AGREGAR — sumar al mapa activo (acumulación explícita)
    // SOLO activa si hay capas cargadas + verbo aditivo al INICIO
    // ─────────────────────────────────────────────────────────────
    AGREGAR: /^(?:agrega(r|me|le|nos)?|a[nñ]adi(r|me|le|nos)?|sum[ae](r|me|le|nos)?|incorpora(r|me|le|nos)?|ponele\s+(?:tambi[eé]n|ademas|adem[aá]s|encima)|tambi[eé]n\s+(?:quiero\s+ver|mostr|carg|agrega)|ademas\s+(?:quiero\s+ver|mostr|carg)|adem[aá]s\s+(?:quiero\s+ver|mostr|carg)|y\s+tambi[eé]n\s+(?:quiero\s+ver|mostr|agrega)|add(?:\s+also)?|include|also\s+show|show\s+also|also\s+add|add\s+also|and\s+also\s+show|additionally\s+show|on\s+top\s+of\s+that\s+show|adiciona(r|me)?|inclui(r|me)?|acrescenta(r|me)?|tamb[eé]m\s+(?:quero\s+ver|mostr|carrega|adiciona)|alem\s+disso\s+mostr|al[eé]m\s+disso\s+(?:mostr|adiciona))\s+/i,

    // ─────────────────────────────────────────────────────────────
    // BORRAR — eliminar / quitar / limpiar
    // El OBJETO define qué se elimina: capa, mapa, clasificación, estilo
    // ─────────────────────────────────────────────────────────────
    BORRAR: /\b(?:borr[ae](r|lo|la|los|las|me|le|nos|te|se)?|elimin[ae](r|lo|la|los|las|me|le|nos)?|quit[ae](r|lo|la|los|las|me|le|nos)?|sac[ae](r|lo|la|los|las|me|le|nos)?|limpi[ae](r|lo|la|los|las|me|le|nos|te)?|vaci[ae](r|lo|la|me|le)?|tir[ae](r|lo|la|los|las|me|le|nos)?|remov[ae](r|lo|la|los|las|me)?|reset[ae](r|lo|la|me)?|reinici[ae](r|lo|la|me)?|drop(?:\s+the)?|delete(?:\s+the)?|remove(?:\s+the)?|clear(?:\s+the)?|erase(?:\s+the)?|wipe(?:\s+the)?|clean(?:\s+the)?|clean\s+up|get\s+rid\s+of|take\s+off|remov[ae](r|me)?|delet[ae](r|me)?|apag[ae](r|lo|la|los|las|me|le)?|descart[ae](r|lo|la|me)?|reset\b|start\s+over\b)\b/i,

    // ─────────────────────────────────────────────────────────────
    // ESTILO — cambiar apariencia visual de una capa
    // ─────────────────────────────────────────────────────────────
    ESTILO: /\b(?:estilo|cambi[ae](r|le)?\s+el\s+(?:estilo|color|tama[nñ]o|grosor|icono|simbolo|forma|opacidad)|pon[ae](r|me|le)?\s+(?:mas\s+)?(?:grande|chico|chica|grueso|fino|rojo|azul|verde|transparente)|hacelo\s+(?:mas|de\s+otro)|color(?:es)?|relleno|borde|grosor|tama[nñ]o|icono|ícono|simbolo|símbolo|apariencia|aspecto|radio|opacidad|transparencia|forma|geometria|geometría|círculo|circulo|cuadrado|style|fill|stroke|outline|thickness|weight|icon|symbol|appearance|shape|size|radius|opacity|cor(?:es)?|relleno|espessura|ícone|símbolo|aparência|opacidade|transparência|tamanho|forma|geometria|círculo|quadrado)\b/i,

    // ─────────────────────────────────────────────────────────────
    // LIMPIAR_PROP — resetear/quitar una PROPIEDAD (no una capa, no el mapa)
    // Objetos válidos: clasificación, estilo, colores, filtros, nombre
    // ─────────────────────────────────────────────────────────────
    LIMPIAR_PROP: /\b(?:borr[ae](r|la|lo|los|las|me)?\s+(?:(?:la|el|los|las)\s+)?(?:clasificaci[oó]n|estilo|colores?|color|filtros?|nombre)|quit[ae](r|la|lo|los|las|me)?\s+(?:(?:la|el|los|las)\s+)?(?:clasificaci[oó]n|estilo|colores?|filtros?)|sac[ae](r|la|lo|los|las|me)?\s+(?:(?:la|el|los|las)\s+)?(?:clasificaci[oó]n|estilo|colores?|filtros?)|elimin[ae](r|la|lo|los|las|me)?\s+(?:(?:la|el|los|las)\s+)?(?:clasificaci[oó]n|estilo|colores?|filtros?)|reset(?:ear?)?\s+(?:el\s+)?(?:estilo|clasificaci[oó]n|colores?)|limpiar?\s+(?:el\s+)?(?:estilo|clasificaci[oó]n|colores?|filtros?)|limpi[ae]\s+(?:el\s+)?(?:estilo|clasificaci[oó]n|colores?|filtros?)|vol(?:ve|ví|vé)\s+al\s+estilo\s+(?:original|por\s+defecto|base)|desclasific[ae](r|la|me)?|sacar?\s+la\s+clasificaci[oó]n|remove\s+(?:the\s+)?(?:classification|style|colors?|filters?)|clear\s+(?:the\s+)?(?:classification|style|colors?|filters?)|reset\s+(?:the\s+)?(?:classification|style|colors?|filters?)|drop\s+(?:the\s+)?(?:classification|style|filters?)|remov[ae](r)?\s+(?:a\s+)?(?:classificac[aã]o|estilo|cores?|filtro)|limpar?\s+(?:a\s+)?(?:classificac[aã]o|estilo|cores?|filtro))\b/i,

    // ─────────────────────────────────────────────────────────────
    // EXPORTAR — descargar el mapa o sus datos
    // ─────────────────────────────────────────────────────────────
    EXPORTAR: /\b(?:export[ae](r|lo|la|me)?|exports?\b|exporte|exportá|descarg[ae](r|lo|la|me)?|descargue|descargá|guard[ae](r|lo|la|me)?\s+(?:como|el\s+mapa|los\s+datos)?|guarde|guardá|guardar\s+como|descargar\s+como|download(?:\s+the)?|save(?:\s+as)?(?:\s+the)?|get\s+the\s+(?:map|data)|baixa(r|me)?|salva(r|me)?|descarrega(r|me)?|gravar?)\b/i,

    // ─────────────────────────────────────────────────────────────
    // BASEMAP — cambiar el mapa de fondo
    // Requiere objeto BASEMAP para activarse
    // ─────────────────────────────────────────────────────────────
    BASEMAP: /\b(?:cambi[ae](r|lo|la|me)?|cambie|cambiá|pon[ae](r|lo|la|me)?|us[ae](r|lo|la|me)?|use|switch(?:\s+to)?|change(?:\s+the)?|set(?:\s+the)?|mud[ae](r|lo|la|me)?|mude|troca(r|me)?|basemap\b|base\s+map\b|mapa\s+(?:base|de\s+fondo|fondo)\b|fondo\b|background(?:\s+map)?\b|dark\s+(?:matter|mode|theme|background)?\b|positron\b|voyager\b)\b/i,

    // ─────────────────────────────────────────────────────────────
    // RENOMBRAR — cambiar el nombre del chat o mapa
    // ─────────────────────────────────────────────────────────────
    RENOMBRAR: /\b(?:renombr[ae](r|lo|la|me|se)?|renombré|renombrá|llam[ae](r|lo|la|me|le)?\s+(?:(?:a\s+)?(?:este|ese|el|al?|este|un)\s+)?(?:mapa|chat|map)|cambi[ae](r)?\s+el\s+(?:nombre|t[ií]tulo)|nombr[ae]r?(?:lo|la)?\s|nombr[ae]\s+(?:el|al|lo|este|ese|un)\s+(?:mapa|chat)|titul[ae](r|lo|la|me)?|el\s+nombre\s+(?:es|era|ser[aá]|va\s+a\s+ser)|rename(?:\s+(?:the\s+)?(?:map|chat))?|call\s+it|call\s+the\s+map|name\s+it|name\s+the\s+map|title\s+it|the\s+name\s+(?:is|will\s+be)|renomear?|renomeie|cham[ae]r?\s+o\s+(?:mapa|chat)|nomear?|nomeie|o\s+nome\s+(?:é|e|era|ser[aá]|vai\s+ser))\b/i,

    // ─────────────────────────────────────────────────────────────
    // FILTRAR — filtrar objetos dentro de una capa ya cargada
    // ─────────────────────────────────────────────────────────────
    FILTRAR: /\b(?:filtr[ae](r|lo|la|los|las|me)?|filtre|filtrá|mostr[ae](r|me)?\s+solo|mostr[ae](r|me)?\s+[uú]nicamente|solo\s+(?:el|la|los|las)|únicamente|que\s+(?:sean?|tengan?|sean?\s+de|correspondan?\s+a)|limit[ae](r|me)?\s+a|limit[ae]\s+los?\s+resultados?|donde\s+(?:el|la)?|filter(?:\s+by)?|filter\s+where|only(?:\s+show)?|show\s+only|just\s+show|restrict(?:\s+to)?|limit\s+to|where\s+(?:the)?|filtrar?\s+(?:por|onde)|mostrar?\s+apenas|somente|apenas\s+(?:os?|as?))\b/i,

  };


  // ── BASEMAP_VERBLESS — frases sin verbo que son unívocamente basemap ─
  // "fondo oscuro", "dark background", "mapa fondo con colores", etc.
  // Se evalúan ANTES de la tabla (Verbo × Objeto) porque no tienen verbo.
  const BASEMAP_VERBLESS = /\b(?:fondo\s+(?:oscuro|claro|con\s+colores?|de\s+colores?|neutro|blanco|negro)?|mapa\s+(?:base|de\s+fondo|fondo)\s+(?:oscuro|claro|con\s+colores?|voyager|positron|dark|gray|grey)?|background\s+(?:map\s+)?(?:dark|light|gray|grey)?|dark\s+matter\b|positron\b|voyager\b|dark\s+background\b|light\s+background\b)\b/i;

  // ── Prioridad de grupos (de más específico a más general) ────
  // Cuando un texto matchea múltiples grupos, se elige el más específico.
  // LIMPIAR_PROP es más específico que BORRAR (incluye el objeto en el patrón).
  // CLASIFICAR es más específico que ESTILO (tiene "por" como discriminador).
  const PRIORIDAD = [
    'LIMPIAR_PROP',   // "borrá la clasificación" → más específico que BORRAR
    'FILTRAR',        // "filtrá los" → más específico que CARGAR
    'RENOMBRAR',      // específico
    'EXPORTAR',       // específico
    'ESTILO',         // antes de BASEMAP: cambiá+color→ESTILO, no BASEMAP
    'BASEMAP',        // específico
    'AGREGAR',        // específico (^ al inicio)
    'CARGAR',         // general
    'BORRAR',         // general
  ];

  /**
   * detectarGrupo(textoNorm) → string | null
   *
   * Evalúa el texto normalizado y devuelve el grupo más específico que matchea.
   * Usa el orden de PRIORIDAD para desambiguar cuando hay múltiples matches.
   */
  function detectarBasemapVerbless(textoNorm) {
    return BASEMAP_VERBLESS.test(textoNorm);
  }

  function detectarGrupo(textoNorm) {
    // Caso especial: frases verbless unívocamente basemap
    if (BASEMAP_VERBLESS.test(textoNorm)) return 'BASEMAP';

    const matches = Object.entries(GRUPOS)
      .filter(([, patron]) => patron.test(textoNorm))
      .map(([nombre]) => nombre);

    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];

    // Elegir según prioridad
    for (const grupo of PRIORIDAD) {
      if (matches.includes(grupo)) return grupo;
    }
    return matches[0];
  }

  /**
   * detectarTodosLosGrupos(textoNorm) → string[]
   *
   * Devuelve TODOS los grupos que matchean.
   * Usado para análisis de conflictos y logging.
   */
  function detectarTodosLosGrupos(textoNorm) {
    return Object.entries(GRUPOS)
      .filter(([, patron]) => patron.test(textoNorm))
      .map(([nombre]) => nombre);
  }

  return { detectarGrupo, detectarTodosLosGrupos, GRUPOS };

})();
