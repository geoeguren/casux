/**
 * intent.js — Motor unificado de detección de intenciones
 *
 * Punto de entrada: detectarIntencion(texto, historial)
 * Devuelve: { tipo, subtipo, parametros } | null
 *
 * Tipos:
 *   'capa'     → pedido de capa simple resuelto sin LLM
 *                parametros: { instruccion }
 *   'estilo'   → pedido de cambio de estilo
 *                subtipo: 'vago' | 'especifico'
 *   'export'   → pedido de exportación
 *                subtipo: 'vago' | 'jpeg' | 'pdf' | 'geojson' | 'html'
 *   'limpiar'  → limpiar/vaciar el mapa
 *   'basemap'  → cambio de mapa base
 *                subtipo: 'vago' | 'gray' | 'dark' | 'voyager'
 *   'renombrar'→ renombrar el chat/mapa
 *                subtipo: 'especifico' | 'vago'
 *                parametros: { nombre } (si especifico)
 *
 *   null → no detectado, pasa al LLM
 */

window.INTENT = (() => {

  function _dbg(msg) {
    console.log(msg);
  }

  // ── Configuración de scoring de capas ────────────────────────
  const MIN_SCORE    = 4;
  const EMPATE_RATIO = 0.90;

  const STOPWORDS = new Set([
    'de','del','los','las','una','con','por','que','para','entre',
    'en','el','la','al','quiero','ver','mapa','mostrar','dame','muéstrame',
    'mostrame','poneme','cargame','carga','muestra','necesito','quiero',
    'todos','todas','el','la','un','una','los','las',
  ]);

  // ── Normalización ─────────────────────────────────────────────

  // Delegado a window.UTILS.normalizar (src/utils.js) — fuente única de verdad.
  // El alias local preserva todas las llamadas internas sin cambios.
  const normalizar = (texto) => window.UTILS.normalizar(texto);

  function tokenizar(textoNorm) {
    return textoNorm.split(/\s+/).filter(p => p.length > 2 && !STOPWORDS.has(p));
  }

  // ════════════════════════════════════════════════════════════════
  // DETECCIÓN DE INTENCIONES
  // ════════════════════════════════════════════════════════════════

  // ── 1. LIMPIAR ────────────────────────────────────────────────

  const PATRON_LIMPIAR = /\b(borra(r|lo)?|limpia(r|lo)?|limpia(r)?\s+el\s+mapa|vacia(r|lo)?|vacia\s+el\s+mapa|saca(r)?\s+(las?\s+)?capas?|borra(r)?\s+todo|elimina(r)?\s+todo|resetea(r)?|reinicia(r)?|clear(\s+the\s+map|\s+all|\s+everything)?|clean(\s+the\s+map)?|reset(\s+the\s+map)?|wipe(\s+the\s+map)?|erase(\s+the\s+map)?|start\s+over|remove\s+all(\s+layers?)?|limpa(r)?(\s+o\s+mapa)?|apaga(r)?(\s+o\s+mapa)?|apague(\s+o\s+mapa)?|reseta(r)?(\s+o\s+mapa)?|limpe(\s+o\s+mapa)?|remove(r)?\s+tudo)\b/i;

  function detectarLimpiar(texto) {
    return PATRON_LIMPIAR.test(normalizarSimple(texto)) ? { tipo: 'limpiar' } : null;
  }

  // ── 2. EXPORTAR ───────────────────────────────────────────────

  // Normalizar antes de aplicar patrones de export/basemap
  function normalizarSimple(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  const PATRON_EXPORT = /\b(export(a|ar)?|descarg(a|ar)?|guard(a|ar)?|baj(a|ar)?|guardar\s+como|descargar\s+como|download|save(\s+as)?|get\s+the\s+map|baixa(r)?|salva(r)?|descarrega(r)?|exporta(r)?|gravar|guardar)\b/i;

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

  // ── 3. BASEMAP ────────────────────────────────────────────────

  // Solo matchea si hay palabras de contexto de mapa base
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

  // ── 4. RENOMBRAR ──────────────────────────────────────────────

  const PATRON_RENOMBRAR = /\b(renombra(r|lo)?|llama(r|lo|le)?(\s+(al\s+)?(mapa|chat))?|cambia(\s+el\s+)?(nombre|titulo)|nombra(r|lo)?|titula(r|lo)?|el\s+nombre\s+(es|sera|va\s+a\s+ser)|rename(\s+(the\s+)?(map|chat))?|call(\s+it|\s+the\s+map)?|name(\s+it|\s+the\s+map)?|title(\s+it)?|the\s+name\s+(is|will\s+be)|renomear|renomeie|chama(r)?(\s+o\s+(mapa|chat))?|nomear|nomeie|o\s+nome\s+(é|sera|vai\s+ser))\b/i;

  function detectarRenombrar(texto) {
    const norm = normalizarSimple(texto);
    if (!PATRON_RENOMBRAR.test(norm)) return null;
    // Extraer nombre del texto original (para preservar mayúsculas)
    const matchNombre =
      // ES
      texto.match(/(?:llamalo?|renombralo?\s+(?:como\s+)?|titulalo?\s*|el\s+nombre\s+(?:es|sera|va\s+a\s+ser)\s+|llam[aa]\s+(?:al\s+)?(?:mapa|chat)\s+)["]?([^"'\n]{2,40})["]?/i) ||
      texto.match(/(?:como\s+)["]([^"'\n]{2,40})["]/i) ||
      // EN
      texto.match(/(?:call\s+(?:it|the\s+map)\s+|rename\s+(?:it\s+)?(?:to\s+)?|name\s+it\s+|the\s+name\s+is\s+)["]?([^"'\n]{2,40})["]?/i) ||
      // PT
      texto.match(/(?:chama(?:r)?\s+(?:o\s+mapa\s+)?(?:de\s+)?|renomeia(?:r)?\s+(?:para\s+)?|o\s+nome\s+(?:e|vai\s+ser)\s+)["]?([^"'\n]{2,40})["]?/i);
    const nombre = matchNombre?.[1]?.trim();
    return {
      tipo:      'renombrar',
      subtipo:   nombre ? 'especifico' : 'vago',
      parametros: nombre ? { nombre } : {},
    };
  }

  // ── 5. ESTILO ─────────────────────────────────────────────────

  const PATRON_ESTILO = /\b(estilo|color(es)?|relleno|borde|grosor|tamano|icono|simbolo|apariencia|aspecto|hacelo\s+mas|ponelo|ponerlo|forma|geometria|style|fill|stroke|border|thickness|weight|icon|symbol|appearance|make\s+it|shape|circle|square|size|radius|cor|cores|preenchimento|borda|espessura|ícone|símbolo|aparência|forma|geometria|circulo|quadrado|tamanho)\b/i;

  // Valores concretos, propiedades ya nombradas, o referencias contextuales
  const PATRON_ESTILO_ESPECIFICO = /\b(rojo|azul|verde|amarillo|naranja|violeta|rosa|negro|blanco|gris|celeste|marron|mas\s+(grande|chico|grueso|fino|oscuro|claro|transparente)|tambien|lo\s+mismo|idem|opacidad|transparencia|red|blue|green|yellow|orange|purple|pink|black|white|gray|grey|cyan|brown|bigger|smaller|larger|thicker|thinner|darker|lighter|transparent|opacity|same|vermelho|azul|verde|amarelo|laranja|violeta|rosa|preto|branco|cinza|ciano|marrom|maior|menor|mais\s+(grosso|fino|escuro|claro|transparente)|transparencia|opacidade|#[0-9a-fA-F]{3,6}|\d+(\.\d+)?\s*(px|pt|puntos?)?)\b/i;

  function getMensajesBotonesEstilo() {
    try {
      return new Set([
        t('style_change_size'), t('style_change_color_point'), t('style_change_icon'),
        t('style_change_weight'), t('style_change_color_line'),
        t('style_change_fill'), t('style_change_border'),
      ]);
    } catch { return new Set(); }
  }

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
    if (getMensajesBotonesEstilo().has(texto)) return { tipo: 'estilo', subtipo: 'especifico' };
    const norm = normalizarSimple(texto);
    if (!PATRON_ESTILO.test(norm)) return null;
    if (PATRON_ESTILO_ESPECIFICO.test(norm)) return { tipo: 'estilo', subtipo: 'especifico' };
    const param = _extractParam(norm);
    return { tipo: 'estilo', subtipo: 'vago', parametros: { param } };
  }

  // ── 6. CAPA (lógica existente) ────────────────────────────────

  const PATRON_NO_CAPA = /\b(export|exporta|descarga|qué es|qué son|cuánto|cuántos|explicame|explicá|contame|ayuda|borrá|limpiar|vaciar|cambiar|cambio|color|estilo|clasificá|clasificar|download|what\s+is|what\s+are|how\s+many|explain|help|clear|clean|style|classify|baixar|o\s+que\s+é|quantos?|explique|ajuda|limpar|apagar|cor|estilo|classificar)\b/i;
  const PATRON_MULTIPLE = /\b(y|mas|tambien|junto|ademas|and|also|plus|as\s+well|additionally|e|tambem|alem|mais)\b/i;

  // Nombres de países conocidos (norm) → código de país
  // Se construye dinámicamente desde SOURCES para no hardcodear
  function buildPaisesMap() {
    const map = {};
    for (const [, src] of Object.entries(window.SOURCES || {})) {
      if (src.country && src.countryLabel) {
        map[normalizar(src.countryLabel)] = src.country;
      }
    }
    // Variantes comunes (garantizan detección aunque SOURCES no esté cargado)
    map['argentina'] = 'ar';
    map['uruguay']   = 'uy';
    map['chile']     = 'cl';
    return map;
  }

  const CONTEXTO_ADMIN = /\b(departamento|depto|partido|provincia|prov|municipio|municipios|distrito)\b/;

  // Palabras clave que sugieren explícitamente un tipo administrativo concreto.
  // Permiten que detectarArea priorice el tipo correcto cuando un nombre existe
  // en varios niveles (ej: "Salta" es tanto provincia como localidad).
  const TIPO_HINTS = {
    provincia:    /\b(provincia|provincial)\b/,
    departamento: /\b(departamento|depto|partido)\b/,
    municipio:    /\b(municipio|municipalidad|municipal)\b/,
    localidad:    /\b(localidad|ciudad|pueblo|poblado)\b/,
    region:       /\b(region|regional)\b/,
    canton:       /\b(canton|cantonal)\b/,
  };

  function detectarArea(textoNorm) {
    const geoMaps  = window.GEO_MAPS || {};
    const paises   = buildPaisesMap();
    const palabras = textoNorm.split(/\s+/);

    // Hint explícito de tipo en el texto (ej: "provincia de Salta")
    let tipoHint = null;
    for (const [tipo, patron] of Object.entries(TIPO_HINTS)) {
      if (patron.test(textoNorm)) { tipoHint = tipo; break; }
    }

    // Colectar todos los candidatos (puede haber el mismo nombre en distintos niveles)
    const candidatos = [];

    for (let largo = 3; largo >= 1; largo--) {
      for (let i = 0; i <= palabras.length - largo; i++) {
        const frase = palabras.slice(i, i + largo).join(' ');

        // Ignorar frases de una sola letra — demasiado ambiguas
        // (ej: municipio 'A' en UY no debe matchear la preposición 'a')
        if (frase.length <= 1) continue;

        // Si la frase es el nombre de un país, skipear SALVO que
        // haya una palabra de contexto administrativo justo antes
        if (paises[frase]) {
          const contextoAntes = palabras.slice(Math.max(0, i - 2), i).join(' ');
          if (!CONTEXTO_ADMIN.test(contextoAntes)) continue;
        }

        for (const [pais, tipos] of Object.entries(geoMaps)) {
          for (const [, mapaMeta] of Object.entries(tipos)) {
            const entrada = mapaMeta.valores?.[frase];
            if (!entrada) continue;

            if (Array.isArray(entrada)) {
              // Entrada ambigua — múltiples departamentos/municipios con el mismo nombre
              candidatos.push({
                tipo:      mapaMeta.tipo,
                nivel:     mapaMeta.nivel ?? 99,
                pais,
                valorNorm: frase,
                ambiguo:   true,
                candidatos: entrada,
                layerKey:  mapaMeta.layerKey,
                field:     window.LAYERS?.[mapaMeta.layerKey]?.labelField || null,
              });
            } else {
              // Normalizar formato: acepta tanto { value, provincia } como string plano (legacy)
              const valorOriginal = typeof entrada === 'string' ? entrada : entrada.value;
              const provinciaVal  = typeof entrada === 'string' ? null    : entrada.provincia;
              candidatos.push({
                tipo:          mapaMeta.tipo,
                nivel:         mapaMeta.nivel ?? 99,
                pais,
                valorNorm:     frase,
                ambiguo:       false,
                valorOriginal,
                provincia:     provinciaVal,
                layerKey:      mapaMeta.layerKey,
                field:         window.LAYERS?.[mapaMeta.layerKey]?.labelField || null,
              });
            }
          }
        }

        // Si encontramos algo para esta longitud de frase, no seguir con frases más cortas
        if (candidatos.length) break;
      }
      if (candidatos.length) break;
    }

    if (!candidatos.length) return null;

    // Si hay un solo candidato, devolverlo directamente
    if (candidatos.length === 1) return candidatos[0];

    // Múltiples candidatos (mismo nombre en distintos niveles):
    // 1. Si hay hint de tipo en el texto, priorizar ese tipo
    if (tipoHint) {
      const porHint = candidatos.filter(c => c.tipo === tipoHint);
      if (porHint.length === 1) return porHint[0];
      if (porHint.length > 1) {
        // Si el hint matchea múltiples, quedarse con el de menor nivel (más general)
        return porHint.reduce((a, b) => a.nivel <= b.nivel ? a : b);
      }
    }

    // 2. Sin hint: preferir el nivel más bajo (más general).
    // Ej: "Salta" → provincia (nivel 2) sobre localidad (nivel 4).
    return candidatos.reduce((a, b) => a.nivel <= b.nivel ? a : b);
  }

  function buscarCapa(textoNorm, area) {
    const layers = window.LAYERS || {};
    let textoSinArea = textoNorm;
    if (area?.valorNorm) textoSinArea = textoNorm.replace(area.valorNorm, '').trim();

    // Si el área es solo un país (sin valorNorm), quitar el nombre del país del texto
    // para que los tokens restantes puedan matchear capas correctamente
    if (!area?.valorNorm && area?.pais) {
      const paises = buildPaisesMap();
      for (const [nombre, codigo] of Object.entries(paises)) {
        if (codigo === area.pais) {
          textoSinArea = textoSinArea.replace(new RegExp('\\b' + nombre + '\\b', 'g'), '').trim();
        }
      }
    }

    // Quitar del texto sin área las palabras de contexto administrativo —
    // son ruido para el scoring de capas ("departamento", "provincia", etc.)
    const CONTEXTO_ADMIN_TOKENS = new Set([
      'departamento', 'depto', 'partido', 'provincia', 'prov',
      'municipio', 'distrito',
    ]);

    const tokens = tokenizar(textoSinArea).filter(t => !CONTEXTO_ADMIN_TOKENS.has(t));
    if (!tokens.length && !area?.pais) {
      _dbg(`[INTENT] → LLM | sin tokens útiles tras filtrar stopwords y contexto admin`);
      return null;
    }

    const matchPalabraCompleta = (texto, palabra) =>
      new RegExp('(?:^|\\s)' + palabra + '(?:\\s|$)').test(texto);

    // ── Idioma de la UI para scoring multiidioma ─────────────────
    //
    // Si la capa tiene campos i18n (tituloUIEn, keywordsEn, etc.), el scorer
    // usa los del idioma de la interfaz en vez de los campos base (siempre ES).
    // Sufijos: 'Es' | 'En' | 'Pt'
    const _uiLang  = window.I18N?.getLang?.() || window.SETTINGS?.get?.('lang') || 'es';
    const _sufijo  = _uiLang === 'en' ? 'En' : _uiLang === 'pt' ? 'Pt' : 'Es';

    // ── Pre-computar IDF por token ────────────────────────────────
    //
    // Filtrar por visible !== false antes de construir el índice y scorear.
    // Excluye capas técnico-geodésicas y gemelas que no debería ver el usuario.
    const capasVisibles = Object.entries(layers).filter(([, c]) => c.visible !== false);
    const N = capasVisibles.length || 1;

    // Contar en cuántas capas visibles aparece cada token como keyword (IDF).
    // Un token exclusivo de 1 capa es señal fuerte; uno en 20 capas es ruido.
    const df = new Map();
    for (const [, capa] of capasVisibles) {
      const vistos = new Set();
      const kwArr = capa[`keywords${_sufijo}`] || capa.keywords || [];
      for (const kw of kwArr) {
        const kwNorm = normalizar(kw);
        const formas = [kwNorm];
        if (kwNorm.endsWith('es') && kwNorm.length > 4) formas.push(kwNorm.slice(0, -2));
        if (kwNorm.endsWith('s')  && kwNorm.length > 3) formas.push(kwNorm.slice(0, -1));
        for (const f of formas) {
          if (!vistos.has(f)) { vistos.add(f); df.set(f, (df.get(f) || 0) + 1); }
        }
      }
    }
    function idf(token) {
      const freq = df.get(token) || 1;
      const raw  = Math.log(N / freq);
      const max  = Math.log(N);
      return max > 0 ? 0.5 + 0.5 * (raw / max) : 1.0;
    }

    // ── Score por posición del keyword ───────────────────────────
    //
    // Zona canónica (pos 0..CANON-1): peso 1.0.
    // A partir de CANON: decae linealmente hasta 0.3 al final del array.
    const CANON = 3;
    function posWeight(pos, total) {
      if (pos < CANON) return 1.0;
      const tail = total - CANON;
      if (tail <= 0) return 1.0;
      return Math.max(0.3, 1 - 0.7 * ((pos - CANON) / tail));
    }

    const resultados = capasVisibles.map(([key, capa]) => {
      if (area?.pais) {
        const sourceCountry = window.SOURCES?.[capa.source]?.country;
        if (sourceCountry && sourceCountry !== area.pais) return { key, capa, score: 0 };
      }

      // Usar campos del idioma de la UI si existen; caer al campo base si no.
      const tituloUIi18n = capa[`tituloUI${_sufijo}`] || capa.tituloUI || '';
      const tituloI18n   = capa[`titulo${_sufijo}`]   || capa.titulo   || '';
      const keywordsI18n = capa[`keywords${_sufijo}`] || capa.keywords || [];

      const textoCapa = normalizar([
        tituloUIi18n, tituloI18n, key,
        keywordsI18n.join(' '),
        _sufijo !== 'Es' ? (capa.tituloUI || '') : '',
      ].join(' '));

      const keywordsNorm = keywordsI18n.map((k, i) => ({
        norm:  normalizar(k),
        pos:   i,
        total: keywordsI18n.length,
      }));

      const titulosNorm = [
        normalizar(tituloUIi18n),
        normalizar(tituloI18n),
      ];

      let score = 0;
      if (textoCapa.includes(textoSinArea)) score += 10;
      for (const token of tokens) {
        const singulares = [];
        if (token.endsWith('es') && token.length > 4) singulares.push(token.slice(0, -2));
        if (token.endsWith('s')  && token.length > 3) singulares.push(token.slice(0, -1));
        const singularesValidos = singulares.filter(s => s.length >= 4);

        const kwMatch = keywordsNorm.find(({ norm }) =>
          norm === token || singularesValidos.some(s => norm === s)
        );
        if (kwMatch) {
          score += 4 * posWeight(kwMatch.pos, kwMatch.total) * idf(token);
        } else if (matchPalabraCompleta(textoCapa, token)) {
          score += 2;
        } else if (singularesValidos.some(s => matchPalabraCompleta(textoCapa, s))) {
          score += 2;
        }

        const enTitulo = titulosNorm.some(t =>
          t === token ||
          matchPalabraCompleta(t, token) ||
          singularesValidos.some(s => matchPalabraCompleta(t, s))
        );
        if (enTitulo) score += 2;
      }

      for (let i = 0; i < tokens.length - 1; i++) {
        const bigramaNorm = tokens[i] + ' ' + tokens[i + 1];
        const seg = tokens[i + 1];
        const segSingulares = [];
        if (seg.endsWith('es') && seg.length > 4) segSingulares.push(seg.slice(0, -2));
        if (seg.endsWith('s')  && seg.length > 3) segSingulares.push(seg.slice(0, -1));
        const bigramasSingulares = segSingulares
          .filter(s => s.length >= 4)
          .map(s => tokens[i] + ' ' + s);

        const bkw = keywordsNorm.find(({ norm }) =>
          norm === bigramaNorm || bigramasSingulares.some(b => norm === b)
        );
        if (bkw) score += 3 * posWeight(bkw.pos, bkw.total) * idf(bigramaNorm);

        const bigramaEnTitulo = titulosNorm.some(t =>
          t.includes(bigramaNorm) || bigramasSingulares.some(b => t.includes(b))
        );
        if (bigramaEnTitulo) score += 2;
      }

      return { key, capa, score };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);

    if (!resultados.length) {
      _dbg(`[INTENT] → LLM | ninguna capa superó score > 0 para los tokens: [${tokens.join(', ')}]`);
      return null;
    }

    // Desempate: line/polygon > point, luego special:false
    const GEOM_PRIO = { line: 2, polygon: 1, point: 0 };
    const prioridad = (r) =>
      (GEOM_PRIO[r.capa.geomType] ?? 0) + (r.capa.special === false ? 1 : 0);
    resultados.sort((a, b) => b.score !== a.score ? b.score - a.score : prioridad(b) - prioridad(a));

    const mejor = resultados[0];
    if (mejor.score < MIN_SCORE) {
      _dbg(`[INTENT] → LLM | score insuficiente: mejor capa "${mejor.key}" obtuvo ${mejor.score} (mínimo: ${MIN_SCORE})`);
      return null;
    }

    if (resultados.length > 1) {
      const segundo = resultados[1];
      if (segundo.score >= mejor.score * EMPATE_RATIO) {
        if (prioridad(mejor) > prioridad(segundo)) {
          _dbg(`[INTENT] Desempate por prioridad: ${mejor.key}(${mejor.score}) sobre ${segundo.key}(${segundo.score})`);
        } else {
          _dbg(`[INTENT] Empate: ${mejor.key}(${mejor.score}) vs ${segundo.key}(${segundo.score}) → LLM`);
          return null;
        }
      }
    }
    return mejor;
  }

  // ── Detección de operación espacial ──────────────────────────
  //
  // Determina si el texto implica clip (contenido dentro), intersect
  // (features que tocan/cruzan) o buffer (features a X distancia).
  // El intent solo genera intersect/buffer cuando puede hacerlo con
  // alta confianza; en caso de duda deriva al LLM.

  const PATRON_INTERSECT = /\b(pasan?\s+por|tocan?|atraviesan?|cruzan?|intersectan?|que\s+recorren?|que\s+bordean?|pass\s+(through|by)|cross(es)?|go\s+through|traverse|intersect|run\s+through|border|passam?\s+por|cruzam?|atravessam?|intersectam?|percorrem?|margeiam?)\b/;
  const PATRON_BUFFER    = /\b(a\s+\d[\d.,]*\s*km|cerca\s+de|distancia\s+de|radio\s+de|a\s+menos\s+de|within\s+\d[\d.,]*\s*km|near|within\s+distance|less\s+than\s+\d[\d.,]*\s*km|around|close\s+to|a\s+\d[\d.,]*\s*km|perto\s+de|distância\s+de|raio\s+de|a\s+menos\s+de)\b/;
  const PATRON_DISTANCIA = /(\d[\d.,]*)\s*km/;

  function detectarOpEspacial(textoNorm) {
    if (PATRON_BUFFER.test(textoNorm))    return 'buffer';
    if (PATRON_INTERSECT.test(textoNorm)) return 'intersect';
    return 'clip';
  }

  function extraerDistanciaKm(textoNorm) {
    const match = textoNorm.match(PATRON_DISTANCIA);
    if (!match) return 50; // default razonable si no se encuentra
    return parseFloat(match[1].replace(',', '.'));
  }

  /**
   * Dado el texto normalizado y el filterField/filterValues de una capa,
   * intenta detectar si el usuario pidió un valor específico de ese campo.
   *
   * Estrategia en cascada:
   *   1. Coincidencia exacta del valor normalizado en el texto
   *   2. El texto contiene todas las palabras del valor (para valores multi-palabra)
   *   3. El valor normalizado empieza con algún token del texto (singular/plural)
   *
   * Devuelve un CQL string listo para usar, o null si no detectó nada.
   * Ej: "estadios de Córdoba" → "gna='Estadio'"
   */
  function _detectarFiltroAtributo(textoNorm, filterField, filterValues, isArcgis) {
    // Ordenar de más largo a más corto para preferir matches más específicos
    const ordenados = [...filterValues].sort((a, b) =>
      normalizar(b).length - normalizar(a).length
    );

    // ArcGIS REST usa SQL estándar → LOWER(campo)='valor'
    // GeoServer/WFS usa CQL        → strToLowerCase(campo)='valor'
    const lowerFn = isArcgis
      ? (field, val) => `LOWER(${field})='${val}'`
      : (field, val) => `strToLowerCase(${field})='${val}'`;

    for (const valor of ordenados) {
      const valorNorm  = normalizar(valor);       // sin tildes, minúsculas — solo para comparar con el texto del usuario
      const valorLower = valor.toLowerCase();     // minúsculas CON tildes — preservadas en ambos motores
      if (!valorNorm) continue;

      // 1. Coincidencia exacta del valor normalizado dentro del texto
      if (textoNorm.includes(valorNorm)) {
        return lowerFn(filterField, valorLower);
      }

      // 2. Para valores multi-palabra: todas las palabras significativas presentes
      const palabrasValor = valorNorm.split(/\s+/).filter(p => p.length > 3);
      if (palabrasValor.length > 1 && palabrasValor.every(p => textoNorm.includes(p))) {
        return lowerFn(filterField, valorLower);
      }

      // 3. Token del texto que coincide con inicio del valor (singular/plural simple)
      const tokensTexto = tokenizar(textoNorm);
      for (const token of tokensTexto) {
        if (token.length < 4) continue;
        // El valor normalizado empieza con el token (cubre plurales: "estadios" → "estadio")
        if (valorNorm.startsWith(token) && valorNorm.length <= token.length + 3) {
          return lowerFn(filterField, valorLower);
        }
        // El token empieza con el valor (valor es substring del principio del token)
        if (token.startsWith(valorNorm) && token.length <= valorNorm.length + 3) {
          return lowerFn(filterField, valorLower);
        }
      }
    }

    return null;
  }

  function construirInstruccion(layerKey, capa, area, textoOriginal) {
    const textoNorm   = normalizar(textoOriginal);
    const op          = detectarOpEspacial(textoNorm);
    const instruccion = { layerKey, filtro: '', clipArea: null, descripcion: textoOriginal };

    // ── Filtro por atributo de la capa (filterField + filterValues) ──────────
    // Si la capa declara filterField y filterValues, intentar detectar si el usuario
    // pidió un valor específico de ese campo (ej: "estadios" → gna='Estadio').
    // Se hace ANTES de construir el área espacial para que ambos puedan coexistir.
    // GUARDIA: si el texto coincide con el nombre genérico de la capa (tituloUI o titulo),
    // el usuario está pidiendo la capa completa, no un subtipo específico.
    // Ej: "áreas protegidas de Córdoba" no debe filtrar por gna='Area Protegida'.
    if (capa.filterField && Array.isArray(capa.filterValues) && capa.filterValues.length) {
      const nombreCapa = normalizar(capa.tituloUI || capa.titulo || '');
      const tokensNombreCapa = tokenizar(nombreCapa);

      const areaVal = typeof area === 'object' && area !== null ? (area.valorNorm || '') : '';
      const textoSinArea = areaVal ? textoNorm.replace(areaVal, '').trim() : textoNorm;
      const tokensTexto = tokenizar(textoSinArea);

      const cubreNombreCapa = (token) =>
        tokensNombreCapa.some(t =>
          t === token ||
          (token.endsWith('s')  && t === token.slice(0, -1)) ||
          (token.endsWith('es') && t === token.slice(0, -2))
        );

      const esPedidoGenerico =
        (nombreCapa && textoNorm.includes(nombreCapa)) ||
        (tokensTexto.length > 0 && tokensTexto.every(t => cubreNombreCapa(t)));

      if (!esPedidoGenerico) {
        const isArcgis   = window.SOURCES?.[capa.source]?.tipo === 'arcgis';
        const filtroAttr = _detectarFiltroAtributo(textoNorm, capa.filterField, capa.filterValues, isArcgis);
        if (filtroAttr) instruccion.filtro = filtroAttr;
      }

      _dbg(`[INTENT] filtro atributo: esPedidoGenerico=${esPedidoGenerico}${instruccion.filtro ? ' → ' + instruccion.filtro : ' → sin filtro'}`);
    }

    if (!area) return instruccion;

    // Área ambigua o área solo de país — no puede construir área espacial
    if (area.ambiguo || !area.valorOriginal) return instruccion;

    const strategy = capa.clipStrategy;

    if (op === 'buffer') {
      // Buffer: area puede ser cualquier tipo (provincia, localidad, puerto, etc.)
      // El área de referencia del buffer usa su propia layerKey del GEO_MAPS
      const distanceKm = extraerDistanciaKm(textoNorm);
      instruccion.op = 'buffer';
      instruccion.bufferArea = {
        layerKey:   area.layerKey,
        field:      area.field,
        value:      area.valorOriginal,
        distanceKm,
      };
      // Para buffer con capas de atributo: el filtro NO aplica (buscamos por proximidad, no por pertenencia)
      instruccion.filtro = '';
      return instruccion;
    }

    if (op === 'intersect') {
      // Intersect: solo tiene sentido para capas con estrategia spatial
      // Si la capa es attribute, el clip por atributo es más eficiente y correcto
      if (strategy === 'attribute') {
        // Degradar silenciosamente a attribute filter — "pasa por" con puntos/localidades
        // es semánticamente equivalente a "está en"
        const campo = (capa.geoFields || {})[area.tipo] || capa.clipField;
        if (campo) {
          const filtroArea = `${campo}='${area.valorOriginal}'`;
          instruccion.filtro = instruccion.filtro
            ? `${instruccion.filtro} AND ${filtroArea}`
            : filtroArea;
        }
        return instruccion;
      }
      instruccion.op = 'intersect';
      instruccion.intersectArea = {
        layerKey: area.layerKey,
        field:    area.field,
        value:    area.valorOriginal,
      };
      return instruccion;
    }

    // op === 'clip' (default)
    if (strategy === 'attribute') {
      const campo = (capa.geoFields || {})[area.tipo] || capa.clipField;
      if (campo) {
        // Usar valorOriginal directamente: es el valor exacto del WFS (con tildes correctas).
        // NO usar strToLowerCase — el valor canónico del GEO_MAPS ya tiene la capitalización
        // correcta y es case-sensitive igual que el campo en el servidor WFS.
        const filtroArea = `${campo}='${area.valorOriginal}'`;
        instruccion.filtro = instruccion.filtro
          ? `${instruccion.filtro} AND ${filtroArea}`
          : filtroArea;
      }
    } else if (strategy === 'spatial') {
      // Optimización para fuentes ArcGIS REST: si la capa tiene un campo de atributo
      // para el tipo de área pedida (geoFields), usar filtro SQL en lugar de clip
      // geométrico. Evita descargar toda la capa para filtrar en el cliente.
      // Para WFS (IGN/IGM) el clip espacial en el servidor es más eficiente.
      const isArcgis = window.SOURCES?.[capa.source]?.tipo === 'arcgis';
      const campoGeo = isArcgis && (capa.geoFields || {})[area.tipo];
      if (campoGeo) {
        const filtroArea = `${campoGeo}='${area.valorOriginal}'`;
        instruccion.filtro = instruccion.filtro
          ? `${instruccion.filtro} AND ${filtroArea}`
          : filtroArea;
        // No setear clipArea — el filtro SQL es suficiente
      } else {
        instruccion.clipArea = {
          layerKey: area.layerKey,
          field:    area.field,
          value:    area.valorOriginal,
        };
      }
    }
    return instruccion;
  }

  // ── 7. AGREGAR CAPA ───────────────────────────────────────────
  //
  // Detecta pedidos de agregar una capa al mapa activo sin limpiar.
  // Se evalúa antes de la guardia de historial de detectarCapa.

  const PATRON_AGREGAR = /^(agrega[r]?me?|añadi[r]?me?|suma[r]?me?|incorpora[r]?me?|agregale|tambien\s+(quiero\s+ver|mostra[r]?me?|carga[r]?me?)|ademas\s+(quiero\s+ver|mostra[r]?me?|carga[r]?me?)|add|include|also\s+show|show\s+also|also\s+add|add\s+also|and\s+also\s+show|adiciona[r]?(me)?|inclui[r]?(me)?|tambem\s+(quero\s+ver|mostra[r]?|carrega[r]?)|alem\s+disso\s+mostra[r]?)\s+/i;

  function detectarAgregar(textoUsuario) {
    const norm = normalizarSimple(textoUsuario);
    if (!PATRON_AGREGAR.test(norm)) return null;

    // Necesita un mapa activo con al menos una capa para "agregar"
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    if (!Object.keys(activeLayers).length) return null;

    // Quitar el verbo de adición para que buscarCapa vea solo la capa pedida
    const textoSinVerbo = textoUsuario.replace(PATRON_AGREGAR, '').trim();
    if (!textoSinVerbo) return null;

    const resultado = detectarCapaDirecta(textoSinVerbo);
    if (!resultado) return null;

    return { tipo: 'agregar', parametros: resultado.parametros };
  }

  // ── 8. QUITAR CAPA ────────────────────────────────────────────
  //
  // Detecta pedidos de eliminar una capa del mapa activo.
  // Resuelve contra getActiveLayers() usando el normalizador de texto.

  const PATRON_QUITAR = /^(saca[r]?me?|quita[r]?me?|elimina[r]?me?|borra[r]?me?|remueve|remove|delete|hide|take\s+off|get\s+rid\s+of|drop|remove[r]?|deleta[r]?|elimina[r]?|tira[r]?|esconde[r]?)\s+/i;

  function _matchCapaActiva(query) {
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const queryNorm = normalizar(query);
    const tokens = tokenizar(queryNorm);
    if (!tokens.length) return null;

    let mejorKey = null;
    let mejorScore = 0;

    for (const [mapKey, entry] of Object.entries(activeLayers)) {
      const tituloNorm   = normalizar(entry.titulo || '');
      const layerKeyNorm = normalizar(entry.layerKey || '');
      const texto = tituloNorm + ' ' + layerKeyNorm;

      let score = 0;
      for (const token of tokens) {
        const sv = [];
        if (token.endsWith('es') && token.length > 4) sv.push(token.slice(0, -2));
        if (token.endsWith('s')  && token.length > 3) sv.push(token.slice(0, -1));
        if (tituloNorm.includes(token) || sv.some(s => tituloNorm.includes(s))) score += 4;
        else if (texto.includes(token)  || sv.some(s => texto.includes(s)))     score += 2;
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

    const textoSinVerbo = textoUsuario.replace(PATRON_QUITAR, '').trim();

    // Si hay una sola capa activa y el texto es vago, asumir esa capa
    const keys = Object.keys(activeLayers);
    if (keys.length === 1) return { tipo: 'quitar', parametros: { mapKey: keys[0] } };

    if (!textoSinVerbo) return null;

    const mapKey = _matchCapaActiva(textoSinVerbo);
    if (!mapKey) return null;

    return { tipo: 'quitar', parametros: { mapKey } };
  }

  // ── detectarCapaDirecta ───────────────────────────────────────
  // Versión interna de detectarCapa sin guardia de historial.
  // Usada por detectarAgregar. No expuesta en la API pública.

  function detectarCapaDirecta(textoUsuario) {
    if (PATRON_NO_CAPA.test(textoUsuario)) return null;
    if (PATRON_MULTIPLE.test(textoUsuario)) return null;

    const textoNorm = normalizar(textoUsuario);
    const area = detectarArea(textoNorm);
    if (area?.ambiguo) return null;

    const paises = buildPaisesMap();
    let paisExplicito = null;
    for (const [nombre, codigo] of Object.entries(paises)) {
      if (textoNorm.includes(nombre)) { paisExplicito = codigo; break; }
    }

    let areaFinal = area;
    if (paisExplicito && area && !area.ambiguo) {
      const contextoAdmin = /\b(departamento|depto|partido|provincia|prov|municipio|distrito)\b/;
      if (!contextoAdmin.test(textoNorm)) areaFinal = { pais: paisExplicito };
    } else if (paisExplicito && !area) {
      areaFinal = { pais: paisExplicito };
    }

    const resultado = buscarCapa(textoNorm, areaFinal);
    if (!resultado) return null;

    if (!paisExplicito && !areaFinal?.pais && !areaFinal?.valorNorm) {
      const sourceCountry = window.SOURCES?.[resultado.capa.source]?.country;
      if (sourceCountry) {
        const paisesDisponibles = new Set(
          Object.values(window.SOURCES || {}).map(s => s.country).filter(Boolean)
        );
        if (paisesDisponibles.size > 1) return null;
      }
    }

    const instruccion = construirInstruccion(resultado.key, resultado.capa, areaFinal, textoUsuario);
    return { tipo: 'capa', parametros: { instruccion } };
  }

  function detectarCapa(textoUsuario, historial) {
    // Derivar al LLM solo si hay mensajes previos generados por el LLM.
    // Si todos los mensajes anteriores fueron resueltos por intent, el intent
    // puede seguir manejando el nuevo pedido sin problema.
    const mensajesLLM = (historial || []).filter(
      m => m.role === 'assistant' && m.fromLLM === true
    );
    if (mensajesLLM.length > 0) {
      console.log(`[INTENT] → LLM | hay conversación previa con LLM (${mensajesLLM.length} msg) | "${textoUsuario.slice(0, 60)}"`);
      return null;
    }
    if (PATRON_NO_CAPA.test(textoUsuario)) {
      console.log(`[INTENT] → LLM | texto contiene palabra excluida (export/estilo/limpiar/etc.) | "${textoUsuario.slice(0, 60)}"`);
      return null;
    }
    if (PATRON_MULTIPLE.test(textoUsuario)) {
      console.log(`[INTENT] → LLM | pedido múltiple detectado (y/también/además) | "${textoUsuario.slice(0, 60)}"`);
      return null;
    }

    const textoNorm = normalizar(textoUsuario);
    const area      = detectarArea(textoNorm);

    // Área ambigua — el LLM tiene más contexto para resolver
    if (area?.ambiguo) {
      _dbg(`[INTENT] Área ambigua: "${area.valorNorm}" en ${area.candidatos.length} provincias → LLM`);
      return null;
    }

    // Detectar país explícito en el texto (ej: "localidades de Uruguay")
    const paises = buildPaisesMap();
    let paisExplicito = null;
    for (const [nombre, codigo] of Object.entries(paises)) {
      if (textoNorm.includes(nombre)) { paisExplicito = codigo; break; }
    }

    // Si hay país explícito sin contexto admin, el país gana sobre cualquier área
    // administrativa que tenga el mismo nombre (ej: departamento "Uruguay" de Entre Ríos)
    let areaFinal = area;
    if (paisExplicito && area && !area.ambiguo) {
      const contextoAdmin = /\b(departamento|depto|partido|provincia|prov|municipio|distrito)\b/;
      if (!contextoAdmin.test(textoNorm)) {
        areaFinal = { pais: paisExplicito };
      }
    } else if (paisExplicito && !area) {
      areaFinal = { pais: paisExplicito };
    }

    const resultado = buscarCapa(textoNorm, areaFinal);
    if (!resultado) {
      console.log(`[INTENT] → LLM | buscarCapa no encontró coincidencia | "${textoUsuario.slice(0, 60)}"`);
      return null;
    }

    // Si el resultado tiene un país asignado pero el usuario no especificó
    // ningún país, y el catálogo tiene capas de más de un país → derivar al LLM
    // para que pregunte, en lugar de asumir silenciosamente el primer país del catálogo.
    if (!paisExplicito && !areaFinal?.pais && !areaFinal?.valorNorm) {
      const sourceCountry = window.SOURCES?.[resultado.capa.source]?.country;
      if (sourceCountry) {
        const paisesDisponibles = new Set(
          Object.values(window.SOURCES || {}).map(s => s.country).filter(Boolean)
        );
        if (paisesDisponibles.size > 1) {
          _dbg(`[INTENT] País ambiguo: "${resultado.key}" es de ${sourceCountry} pero hay ${paisesDisponibles.size} países → LLM`);
          return null;
        }
      }
    }

    const instruccion = construirInstruccion(resultado.key, resultado.capa, areaFinal, textoUsuario);
    _dbg(`[INTENT] capa: ${resultado.key}${areaFinal?.valorOriginal ? ' + ' + areaFinal.valorOriginal : ''} (score: ${resultado.score})`);
    return { tipo: 'capa', parametros: { instruccion } };
  }

  // ════════════════════════════════════════════════════════════════
  // PUNTO DE ENTRADA UNIFICADO
  // ════════════════════════════════════════════════════════════════

  /**
   * detectarIntencion(texto, historial)
   *
   * Evalúa en orden de prioridad y devuelve la primera intención
   * detectada, o null si ninguna aplica (→ LLM).
   *
   * Orden: limpiar → export → basemap → renombrar → estilo → agregar → quitar → capa
   *
   * agregar y quitar van antes de capa porque operan sobre el mapa activo
   * y deben evaluarse incluso con historial previo.
   */
  function detectarIntencion(texto, historial = []) {
    const resultado =
      detectarLimpiar(texto)       ||
      detectarExport(texto)        ||
      detectarBasemap(texto)       ||
      detectarRenombrar(texto)     ||
      detectarEstilo(texto)        ||
      detectarAgregar(texto)       ||
      detectarQuitar(texto)        ||
      detectarCapa(texto, historial);

    if (resultado) {
      const extra =
        resultado.tipo === 'capa'    ? ` → ${resultado.parametros?.instruccion?.layerKey || '?'}` :
        resultado.tipo === 'agregar' ? ` → ${resultado.parametros?.instruccion?.layerKey || '?'}` :
        resultado.tipo === 'quitar'  ? ` → ${resultado.parametros?.mapKey || '?'}` :
        resultado.subtipo ? ` (${resultado.subtipo})` : '';
      console.log(`[INTENT] ✓ ${resultado.tipo}${extra} | "${texto.slice(0, 60)}"`);
    } else {
      console.log(`[INTENT] → LLM | "${texto.slice(0, 60)}"`);
    }

    return resultado;
  }

  // ── API pública ───────────────────────────────────────────────

  // resolver() y detectarIntencionEstilo() se mantienen por compatibilidad
  function resolver(textoUsuario, historial = []) {
    const intencion = detectarCapa(textoUsuario, historial);
    return intencion?.parametros?.instruccion || null;
  }

  function detectarIntencionEstilo(texto) {
    const r = detectarEstilo(texto);
    if (!r) return null;
    return r.subtipo === 'vago' ? 'vaga' : 'especifica';
  }

  return { detectarIntencion, resolver, detectarIntencionEstilo };

})();
