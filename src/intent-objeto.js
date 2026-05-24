/**
 * src/intent/intent-objeto.js — Clasificador de objeto del motor de intenciones
 *
 * El objeto es lo que el verbo afecta. El mismo verbo ("borrá", "mostrá")
 * tiene resultados completamente diferentes según el objeto:
 *
 *   borrá + MAPA          → limpiar todo
 *   borrá + CAPA_ACTIVA   → quitar esa capa
 *   borrá + CLASIFICACION → limpiar clasificación
 *   borrá + ESTILO_PROP   → resetear el estilo
 *
 *   mostrá + NUEVA_CAPA   → cargar la capa
 *   mostrá + CAPA_ACTIVA  → toggle visibilidad (mostrar)
 *
 * Categorías de objeto (en orden de especificidad):
 *
 *   CLASIFICACION  → la clasificación/categorización/colores de una capa
 *   ESTILO_PROP    → una propiedad visual (color, tamaño, grosor, ícono, opacidad)
 *   BASEMAP        → el mapa de fondo / mapa base
 *   NOMBRE         → el nombre/título del mapa o chat
 *   FILTRO         → un filtro aplicado a la capa
 *   MAPA           → el mapa completo / todas las capas
 *   CAPA_ACTIVA    → una capa ya cargada (identificada por nombre o vaga)
 *   NUEVA_CAPA     → una capa del catálogo (el scorer la identifica)
 *   AMBIGUO        → no se puede determinar con certeza
 *
 * Dependencias: window.INTENT_UTILS, window.MAP (activeLayers)
 */

window.INTENT_OBJETO = (() => {

  const { normalizar, normalizarSimple, tokenizar } = window.INTENT_UTILS;

  // ── Vocabulario de objetos ────────────────────────────────────

  // ES / EN / PT — sin tildes (se aplica sobre texto normalizado)

  const VOCAB = {

    CLASIFICACION: /\b(?:clasificaci[oó]n|clasificaciones|categorias?|categorizaci[oó]n|colores?\s+(?:de\s+la\s+capa|del\s+mapa|por\s+campo)|gradiente|paleta|simbologia|simbología|classification|categorization|color\s+scheme|symbology|classificac[aã]o|categorias?|esquema\s+de\s+cores?)\b/i,

    ESTILO_PROP: /\b(?:estilo|color(?:es)?|relleno|borde|grosor|tama[nñ]o|icono|ícono|simbolo|símbolo|apariencia|aspecto|radio|opacidad|transparencia|forma|geometria|geometría|círculo|circulo|cuadrado|tamano|style|fill|stroke|outline|thickness|weight|icon|symbol|appearance|shape|size|radius|opacity|cor(?:es)?|espessura|ícone|símbolo|aparência|tamanho|opacidade|transparência|forma|geometria|quadrado)\b/i,

    BASEMAP: /\b(?:mapa\s+(?:base|de\s+fondo|fondo)|fondo|basemap|base\s+map|mapa\s+de\s+fundo|fundo|background(?:\s+map)?|carto|positron|voyager|dark\s+matter|fondo\s+(?:oscuro|claro|con\s+colores)|mapa\s+base\s+(?:oscuro|claro|con\s+colores))\b/i,

    NOMBRE: /\b(?:nombre|título|titulo|t[ií]tulo\s+del\s+(?:mapa|chat)|name(?:\s+of\s+the\s+(?:map|chat))?|title(?:\s+of\s+the\s+(?:map|chat))?|nome(?:\s+do\s+(?:mapa|chat))?)\b/i,

    FILTRO: /\b(?:filtro(?:s)?|filtrado|criterio(?:s)?|condici[oó]n|filter(?:s)?|criteria?|condition(?:s)?|filtro(?:s)?|crit[eé]rio(?:s)?|condi[cç][aã]o)\b/i,

    MAPA: /\b(?:(?:todo\s+el\s+)?mapa|todo|todas?\s+las?\s+capas?|todo\s+lo\s+que\s+hay|todo\s+esto|todo\s+eso|the\s+(?:whole\s+)?map|everything|all\s+(?:the\s+)?layers?|o\s+(?:todo\s+o\s+)?mapa|tudo|todas?\s+as?\s+camadas?)\b/i,

    CAPA_ACTIVA: null,  // resuelto dinámicamente vs activeLayers
    NUEVA_CAPA:  null,  // resuelto por el scorer de capas

  };

  // ── Clasificador principal ────────────────────────────────────

  /**
   * detectarObjeto(textoUsuario, opcionesScorer?)
   *
   * @param textoUsuario  {string}  Texto original del usuario
   * @param opcionesScorer {object} Resultado del scorer si ya se ejecutó
   *
   * @returns {
   *   tipo: 'CLASIFICACION' | 'ESTILO_PROP' | 'BASEMAP' | 'NOMBRE' |
   *          'FILTRO' | 'MAPA' | 'CAPA_ACTIVA' | 'NUEVA_CAPA' | 'AMBIGUO',
   *   ref: string | null,   // mapKey si CAPA_ACTIVA, layerKey si NUEVA_CAPA
   *   propEstilo: string | null,  // 'color'|'radius'|'weight'|'icon'|'geom'|'opacity' si ESTILO_PROP
   * }
   */
  function detectarObjeto(textoUsuario, opcionesScorer) {
    const norm = normalizarSimple(textoUsuario);
    const activeLayers = window.MAP?.getActiveLayers?.() || {};

    // Evaluamos de más específico a más general para evitar falsos positivos.
    // Ej: "la clasificación" debe dar CLASIFICACION, no CAPA_ACTIVA.

    // ── 1. CLASIFICACION ─────────────────────────────────────────
    if (VOCAB.CLASIFICACION.test(norm)) {
      return { tipo: 'CLASIFICACION', ref: _resolverCapaActiva(norm, activeLayers), propEstilo: null };
    }

    // ── 2. ESTILO_PROP ───────────────────────────────────────────
    if (VOCAB.ESTILO_PROP.test(norm)) {
      const prop = _resolverPropEstilo(norm);
      let ref  = _resolverCapaActiva(norm, activeLayers);
      // Si no se identificó capa por nombre, usar la única capa activa (si hay una sola)
      if (!ref) {
        const keys = Object.keys(activeLayers);
        if (keys.length === 1) ref = keys[0];
      }
      return { tipo: 'ESTILO_PROP', ref, propEstilo: prop };
    }

    // ── 3. BASEMAP ───────────────────────────────────────────────
    if (VOCAB.BASEMAP.test(norm)) {
      return { tipo: 'BASEMAP', ref: null, propEstilo: null };
    }

    // ── 4. NOMBRE ────────────────────────────────────────────────
    if (VOCAB.NOMBRE.test(norm)) {
      return { tipo: 'NOMBRE', ref: null, propEstilo: null };
    }

    // ── 5. FILTRO ────────────────────────────────────────────────
    if (VOCAB.FILTRO.test(norm)) {
      return { tipo: 'FILTRO', ref: _resolverCapaActiva(norm, activeLayers), propEstilo: null };
    }

    // ── 6. MAPA (objeto genérico = todo el mapa) ─────────────────
    if (VOCAB.MAPA.test(norm)) {
      return { tipo: 'MAPA', ref: null, propEstilo: null };
    }

    // ── 7. CAPA_ACTIVA (por nombre en el texto) ──────────────────
    const refActiva = _resolverCapaActiva(norm, activeLayers);
    if (refActiva) {
      return { tipo: 'CAPA_ACTIVA', ref: refActiva, propEstilo: null };
    }

    // ── 8. Si solo hay UNA capa activa y el pedido es vago,
    //       asumir esa capa como objeto (sin nombre explícito)
    const keys = Object.keys(activeLayers);
    if (keys.length === 1 && _esVago(norm)) {
      return { tipo: 'CAPA_ACTIVA', ref: keys[0], propEstilo: null };
    }

    // ── 9. NUEVA_CAPA — si el scorer ya encontró algo ────────────
    if (opcionesScorer?.layerKey) {
      return { tipo: 'NUEVA_CAPA', ref: opcionesScorer.layerKey, propEstilo: null };
    }

    // ── 10. Varias capas, objeto vago → AMBIGUO ──────────────────
    if (keys.length > 0 && _esVago(norm)) {
      return { tipo: 'AMBIGUO', ref: null, propEstilo: null };
    }

    return { tipo: 'AMBIGUO', ref: null, propEstilo: null };
  }

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * _resolverCapaActiva(norm, activeLayers) → mapKey | null
   *
   * Busca en el texto si menciona el nombre de alguna capa activa.
   * Usa scoring de tokens igual que _matchCapaActiva del sistema anterior.
   */
  function _resolverCapaActiva(norm, activeLayers) {
    const tokens = tokenizar(norm);
    if (!tokens.length) return null;

    let mejorKey   = null;
    let mejorScore = 0;

    for (const [mapKey, entry] of Object.entries(activeLayers)) {
      const tituloNorm   = normalizar(entry.titulo || '');
      const layerKeyNorm = normalizar(entry.layerKey || '');
      const tituloUINorm = normalizar(entry.tituloUI || '');
      const corpus       = tituloNorm + ' ' + layerKeyNorm + ' ' + tituloUINorm;

      let score = 0;
      for (const token of tokens) {
        if (token.length < 3) continue;
        const sv = [];
        if (token.endsWith('es') && token.length > 4) sv.push(token.slice(0, -2));
        if (token.endsWith('s')  && token.length > 3) sv.push(token.slice(0, -1));
        if (tituloNorm.includes(token) || sv.some(s => tituloNorm.includes(s))) score += 4;
        else if (corpus.includes(token) || sv.some(s => corpus.includes(s)))    score += 2;
      }
      if (score > mejorScore) { mejorScore = score; mejorKey = mapKey; }
    }

    return mejorScore >= 2 ? mejorKey : null;
  }

  /**
   * _resolverPropEstilo(norm) → 'color'|'radius'|'weight'|'icon'|'geom'|'opacity'|null
   */
  function _resolverPropEstilo(norm) {
    if (/\b(opacidad|transparencia|opaco|transparente|opacity|opacidade|transparencia)\b/.test(norm)) return 'opacity';
    if (/\b(tamano|radio|grande|chico|chica|size|radius|bigger|smaller|tamanho|raio|maior|menor)\b/.test(norm)) return 'radius';
    if (/\b(grosor|grueso|fino|gordo|delgado|weight|thick|thin|espessura|grosso)\b/.test(norm)) return 'weight';
    if (/\b(icono|ícono|simbolo|símbolo|icon|marker|ícone)\b/.test(norm)) return 'icon';
    if (/\b(geometria|geometría|forma|shape|circulo|círculo|cuadrado|square|circle)\b/.test(norm)) return 'geom';
    if (/\b(color|colores|relleno|fill|tono|tinte|cor|cores|preenchimento)\b/.test(norm)) return 'color';
    return null;
  }

  /**
   * _esVago(norm) → boolean
   *
   * El texto no menciona ningún objeto específico (ni nombre de capa,
   * ni propiedad, ni área). Solo contiene el verbo y artículos/pronombres.
   */
  function _esVago(norm) {
    const PALABRAS_VAGAS = /^(?:la|el|a|o|the|it|capa|layer|camada|essa|esta|esa|that|this|una|um|uma|los|las|os|as|\s)*$/i;
    // Quitar el verbo del norm y ver si queda algo significativo
    const sinVerbos = norm
      .replace(/\b(?:mostra|ocult|escond|quita|borra|elimin|saca|limpie|borre|remueve|remove|delete|drop|hide|show|clear|reset)\w*\b/gi, '')
      .replace(/\b(?:la|el|los|las|the|it|a|o|me|le|te|se|nos)\b/gi, '')
      .trim();
    return sinVerbos.length < 3;
  }

  /**
   * resolverSubtipoBasemap(norm) → 'dark'|'gray'|'voyager'|'vago'
   */
  function resolverSubtipoBasemap(norm) {
    if (/\b(oscuro|dark|negro|noche|night|dark\s*matter|escuro|noite|preto)\b/i.test(norm)) return 'dark';
    if (/\b(claro|gris|gray|grey|blanco|positron|neutro|limpio|light|clean|white|cinza|branco|limpo)\b/i.test(norm)) return 'gray';
    if (/\b(voyager|color(es)?|con\s+color(es)?|colorful|com\s+cor(es)?)\b/i.test(norm)) return 'voyager';
    return 'vago';
  }

  /**
   * resolverSubtipoExport(norm) → 'jpeg'|'pdf'|'geojson'|'html'|'vago'
   */
  function resolverSubtipoExport(norm) {
    if (/\b(jpeg|jpg|imagen|foto|captura|image|picture|imagem)\b/i.test(norm))       return 'jpeg';
    if (/\b(pdf|portable|documento|document)\b/i.test(norm))                          return 'pdf';
    if (/\b(geojson|geo\s*json|vectorial|vector|datos?|data|layer|vetorial|camada)\b/i.test(norm)) return 'geojson';
    if (/\b(html|embebido|embed|web|codigo|code|interativo|interactivo)\b/i.test(norm)) return 'html';
    return 'vago';
  }

  return {
    detectarObjeto,
    resolverSubtipoBasemap,
    resolverSubtipoExport,
    VOCAB,
    _resolverCapaActiva,
    _resolverPropEstilo,
  };

})();
