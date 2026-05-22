/**
 * src/intent/intent-capa.js — Resolución de capas e instrucciones de mapa
 *
 * Este módulo toma una intención de tipo 'capa' y la convierte en una
 * instrucción ejecutable para el motor de mapa.
 *
 * Responsabilidades:
 *   1. detectarCapa / detectarCapaDirecta:
 *        Orquestar la detección de país, área geográfica y capa pedida.
 *        Aplicar guardias (historial LLM, pedido múltiple, país ambiguo).
 *
 *   2. construirInstruccion:
 *        Dado el resultado del scorer, construir el objeto instrucción
 *        completo con filtros de atributo, área de clip/intersect/buffer.
 *
 *   3. Detección de operación espacial:
 *        Determinar si el usuario pide clip, intersect, within_layer,
 *        dissolve, adjacent o nearest.
 *
 * Notas de diseño:
 *   - detectarCapaDirecta es la versión sin guardia de historial,
 *     usada por intent-acciones.js → detectarAgregar.
 *   - detectarCapa agrega la guardia: si ya hubo respuestas del LLM en
 *     la conversación, pasa al LLM para mantener el contexto.
 *
 * Dependencias:
 *   window.INTENT_UTILS  (intent-utils.js)
 *   window.INTENT_SCORER (intent-scorer.js)
 */

window.INTENT_CAPA = (() => {

  const { normalizar, tokenizar, buildPaisesMap } = window.INTENT_UTILS;
  const { buscarCapa, detectarArea, CONTEXTO_ADMIN_TOKENS } = window.INTENT_SCORER;

  // ── Patrones de guardia ───────────────────────────────────────
  //
  // Palabras que indican que el pedido NO es una solicitud de capa.
  // Si alguna aparece, se deriva al LLM antes de intentar el scorer.
  // Evita que "exportar la capa" active el detector de capas.
  const PATRON_NO_CAPA = /\b(export|exporta|descarga|qué es|qué son|cuánto|cuántos|explicame|explicá|contame|ayuda|borrá|limpiar|vaciar|cambiar|cambio|color|estilo|clasificá|clasificar|download|what\s+is|what\s+are|how\s+many|explain|help|clear|clean|style|classify|baixar|o\s+que\s+é|quantos?|explique|ajuda|limpar|apagar|cor|estilo|classificar)\b/i;

  // Palabras de "pedido múltiple" que indican que el usuario quiere
  // cargar varias capas en un solo mensaje. El LLM las descompone mejor.
  const PATRON_MULTIPLE = /\b(y|mas|tambien|junto|ademas|and|also|plus|as\s+well|additionally|e|tambem|alem|mais)\b/i;

  // ── Detección de operación espacial ──────────────────────────
  //
  // Dado el texto del usuario, determina qué operación espacial aplica.
  // El orden de evaluación importa: los exclude SIEMPRE antes que los
  // de inclusión para evitar falsos positivos por substring.
  //
  // Operaciones soportadas:
  //   'within_layer'       → "a X km de", "cerca de", "dentro de X km"
  //   'within_layer_exclude' → "a más de X km de", "lejos de"
  //   'intersect'          → "pasan por", "cruzan", "atraviesan"
  //   'intersect_exclude'  → "no pasan por", "evitan"
  //   'clip_exclude'       → "fuera de", "excepto los de"
  //   'dissolve'           → "uní", "juntá", "fusioná", "merge"
  //   'dissolve_exclude'   → "uní todo menos", "todo excepto"
  //   'adjacent'           → "limita con", "adyacente a", "comparte borde"
  //   'adjacent_exclude'   → "no limita con", "no es adyacente"
  //   'nearest'            → "más cercano a", "los N más cercanos"
  //   'nearest_exclude'    → "más lejano de", "los N más distantes"
  //   'clip'               → (default) "de Córdoba", "en la provincia de..."

  const PATRON_INTERSECT = /\b(pasan?\s+por|tocan?|atraviesan?|cruzan?|intersectan?|que\s+recorren?|que\s+bordean?|pass\s+(through|by)|cross(es)?|go\s+through|traverse|intersect|run\s+through|border|passam?\s+por|cruzam?|atravessam?|intersectam?|percorrem?|margeiam?)\b/;

  const PATRON_WITHIN    = /\b(a\s+\d[\d.,]*\s*km|cerca\s+de|distancia\s+de|radio\s+de|a\s+menos\s+de|within\s+\d[\d.,]*\s*km|near|within\s+distance|less\s+than\s+\d[\d.,]*\s*km|around|close\s+to|perto\s+de|distância\s+de|raio\s+de)\b/;

  const PATRON_DISTANCIA = /(\d[\d.,]*)\s*km/;

  // dissolve: unir/fusionar features en uno solo
  const PATRON_DISSOLVE = /\b(un[ií](r|los?|las?|se)?|junt[aá](r|los?|las?)?|combin[aá](r|los?|las?)?|fusion[aá](r|los?|las?)?|une\s+todas?|dissolve|merge|fundir|agrupa[r]?|merg[ei]|dissolver|combinar|fusionar)\b/i;

  // dissolve_exclude: unir todo menos X — se evalúa ANTES que dissolve
  const PATRON_DISSOLVE_EXCLUDE = /\b(un[ií](r|los?|las?)?\s+(todo|todas?|todos?)\s+(menos|excepto|salvo)|todo\s+excepto|todo\s+salvo|todos?\s+menos|merge\s+(all\s+)?(except|but)|dissolve\s+(all\s+)?(except|but)|combina[r]?\s+(todo\s+)?(menos|excepto)|juntar?\s+(todo\s+)?(menos|excepto))\b/i;

  // adjacent: comparte borde/límite con un área
  const PATRON_ADJACENT = /\b(adyacente|adyacentes?|limita\s+con|limitan\s+con|bordea\s+a?|bordean\s+a?|fronterizo\s+(con|a)|comparte\s+borde|comparten\s+borde|toca\s+a?|tocan\s+a?|adjacent|adjoins?|borders?|shares?\s+border|abuts?|côté|contiguos?)\b/i;

  // adjacent_exclude — se evalúa ANTES que adjacent
  const PATRON_ADJACENT_EXCLUDE = /\b(no\s+limita\s+con|no\s+limitan\s+con|no\s+es\s+adyacente|no\s+son\s+adyacentes?|no\s+bordea|no\s+bordan?|no\s+comparte\s+borde|not\s+adjacent|not\s+bordering|doesn'?t?\s+border|don'?t?\s+border|não\s+faz\s+fronteira|não\s+limita)\b/i;

  // nearest: los N más cercanos / el más cercano a
  const PATRON_NEAREST = /\b(m[aá]s\s+cercano|m[aá]s\s+pr[oó]ximo|los\s+\d+\s+m[aá]s\s+cercanos?|las\s+\d+\s+m[aá]s\s+cercanas?|nearest|closest|cerca\s+de\b|el\s+m[aá]s\s+cercano|la\s+m[aá]s\s+cercana|o\s+mais\s+pr[oó]ximo|os\s+\d+\s+mais\s+pr[oó]ximos?)\b/i;

  // nearest_exclude: los N más lejanos — se evalúa ANTES que nearest
  const PATRON_NEAREST_EXCLUDE = /\b(m[aá]s\s+lejano|m[aá]s\s+distante|los\s+\d+\s+m[aá]s\s+lejanos?|las\s+\d+\s+m[aá]s\s+lejanas?|furthest|farthest|most\s+distant|el\s+m[aá]s\s+lejano|la\s+m[aá]s\s+lejana|o\s+mais\s+distante|mais\s+afastado)\b/i;

  // Patrones de exclusión de las ops clásicas
  const PATRON_CLIP_EXCLUDE = /\b(fuera\s+de|excepto\s+(los?|las?)\s+de|salvo\s+(los?|las?)\s+de|todos?\s+menos\s+(los?|las?)\s+de|que\s+no\s+est[aá]n?\s+en|outside(\s+of)?|except(\s+those)?\s+(in|from)|all\s+except|excluding|fora\s+de|exceto\s+(os?|as?)\s+de|salvo\s+(os?|as?)\s+de|todos?\s+exceto)\b/i;

  const PATRON_INTERSECT_EXCLUDE = /\b(no\s+pasan?\s+por|no\s+tocan?|no\s+atraviesan?|no\s+cruzan?|que\s+evitan?|que\s+no\s+recorren?|not\s+pass(ing)?\s+through|not\s+cross(ing)?|not\s+go(ing)?\s+through|avoid(ing)?|that\s+don'?t?\s+(pass|cross|go\s+through)|não\s+passam?\s+por|não\s+cruzam?|não\s+atravessam?|evitam?)\b/i;

  const PATRON_WITHIN_EXCLUDE = /\b(a\s+m[aá]s\s+de\s+\d[\d.,]*\s*km|lejos\s+de|fuera\s+del?\s+radio|m[aá]s\s+de\s+\d[\d.,]*\s*km|more\s+than\s+\d[\d.,]*\s*km\s+(from|away)|outside\s+(a\s+)?\d[\d.,]*\s*km|far\s+(from|away)|beyond\s+\d[\d.,]*\s*km|a\s+mais\s+de\s+\d[\d.,]*\s*km|longe\s+de|fora\s+do\s+raio)\b/i;

  function detectarOpEspacial(textoNorm) {
    // Exclude siempre antes que su par de inclusión para evitar falsos positivos.
    if (PATRON_WITHIN_EXCLUDE.test(textoNorm))       return 'within_layer_exclude';
    if (PATRON_INTERSECT_EXCLUDE.test(textoNorm))    return 'intersect_exclude';
    if (PATRON_DISSOLVE_EXCLUDE.test(textoNorm))     return 'dissolve_exclude';
    if (PATRON_ADJACENT_EXCLUDE.test(textoNorm))     return 'adjacent_exclude';
    if (PATRON_NEAREST_EXCLUDE.test(textoNorm))      return 'nearest_exclude';
    if (PATRON_CLIP_EXCLUDE.test(textoNorm))         return 'clip_exclude';
    if (PATRON_WITHIN.test(textoNorm))               return 'within_layer';
    if (PATRON_INTERSECT.test(textoNorm))            return 'intersect';
    if (PATRON_DISSOLVE.test(textoNorm))             return 'dissolve';
    if (PATRON_ADJACENT.test(textoNorm))             return 'adjacent';
    if (PATRON_NEAREST.test(textoNorm))              return 'nearest';
    return 'clip';
  }

  // Extrae la distancia en km del texto para operaciones within_layer.
  // Si no se menciona distancia, devuelve 50 km como valor razonable por defecto.
  function extraerDistanciaKm(textoNorm) {
    const match = textoNorm.match(PATRON_DISTANCIA);
    if (!match) return 50;
    return parseFloat(match[1].replace(',', '.'));
  }

  // Extrae el número N de features para nearest ("los 5 más cercanos").
  // Si no se menciona N, devuelve 1 (el más cercano).
  function extraerNearestCount(textoNorm) {
    const match = textoNorm.match(/\b(?:los?|las?|os?|as?)\s+(\d+)\s+m[aá]s\b/i)
               || textoNorm.match(/\b(\d+)\s+m[aá]s\s+(?:cercanos?|pr[oó]ximos?|lejanos?|distantes?)\b/i)
               || textoNorm.match(/\bthe\s+(\d+)\s+(?:nearest|closest|furthest|farthest)\b/i)
               || textoNorm.match(/\b(\d+)\s+(?:nearest|closest|furthest|farthest)\b/i);
    if (!match) return 1;
    return parseInt(match[1], 10);
  }

  // ── _detectarFiltroAtributo ───────────────────────────────────
  //
  // Si la capa tiene filterField + filterValues, intenta detectar si el
  // usuario pidió un subtipo específico de esa capa.
  // Ej: "estadios de Córdoba" → capa=puntos_culturales, filtro="gna='Estadio'"
  //
  // Estrategia en cascada (de más a menos específica):
  //   1. Coincidencia exacta del valor normalizado en el texto.
  //   2. Para valores multi-palabra: todas sus palabras están en el texto.
  //   3. Token del texto que coincide con el inicio del valor (cubre plurales).
  //
  // El generador de CQL/SQL adapta la sintaxis según el backend:
  //   - GeoServer/WFS: strToLowerCase(campo)='valor'
  //   - ArcGIS REST:   LOWER(campo)='valor'
  //
  // Devuelve un string CQL listo para usar, o null si no detectó subtipo.

  function _detectarFiltroAtributo(textoNorm, filterField, filterValues, isArcgis) {
    // Ordenar de más largo a más corto para preferir matches más específicos
    const ordenados = [...filterValues].sort((a, b) =>
      normalizar(b).length - normalizar(a).length
    );

    const lowerFn = isArcgis
      ? (field, val) => `LOWER(${field})='${val}'`
      : (field, val) => `strToLowerCase(${field})='${val}'`;

    for (const valor of ordenados) {
      const valorNorm  = normalizar(valor);       // para comparar con texto del usuario
      const valorLower = valor.toLowerCase();     // para el filtro (preserva tildes)
      if (!valorNorm) continue;

      // 1. Coincidencia exacta
      if (textoNorm.includes(valorNorm)) {
        return lowerFn(filterField, valorLower);
      }

      // 2. Todas las palabras significativas del valor están en el texto
      const palabrasValor = valorNorm.split(/\s+/).filter(p => p.length > 3);
      if (palabrasValor.length > 1 && palabrasValor.every(p => textoNorm.includes(p))) {
        return lowerFn(filterField, valorLower);
      }

      // 3. Token del usuario que coincide con inicio del valor (plural/singular)
      const tokensTexto = tokenizar(textoNorm);
      for (const token of tokensTexto) {
        if (token.length < 4) continue;
        if (valorNorm.startsWith(token) && valorNorm.length <= token.length + 3) {
          return lowerFn(filterField, valorLower);
        }
        if (token.startsWith(valorNorm) && token.length <= valorNorm.length + 3) {
          return lowerFn(filterField, valorLower);
        }
      }
    }

    return null;
  }

  // ── construirInstruccion ──────────────────────────────────────
  //
  // Dado un layerKey, la definición de la capa, el área detectada y el
  // texto original, construye el objeto instrucción que consume el motor
  // de mapa para cargar y filtrar la capa.
  //
  // Estructura de la instrucción:
  //   { layerKey, filtro, clipArea?, op?, withinArea?, intersectArea?,
  //     dissolveArea?, adjacentArea?, nearestArea?, nearestPoint?,
  //     refLayerKey?, descripcion }
  //
  // El campo `op` solo aparece cuando la operación no es 'clip' (default).
  // `filtro` puede estar vacío o contener CQL/SQL (atributo + área combinados).

  // ── Helper: construir filtro de área para capas con geoFields ─
  //
  // Maneja tanto valorOriginal string como array (regiones).
  //   Array  → campo IN ('v1','v2') / campo NOT IN ('v1','v2')
  //   String → campo='v' / campo!='v'
  function _buildFiltroArea(campo, valorOriginal, excluir) {
    if (Array.isArray(valorOriginal)) {
      const lista = valorOriginal.map(v => `'${v}'`).join(',');
      return excluir
        ? `${campo} NOT IN (${lista})`
        : `${campo} IN (${lista})`;
    }
    return excluir
      ? `${campo}!='${valorOriginal}'`
      : `${campo}='${valorOriginal}'`;
  }

  function construirInstruccion(layerKey, capa, area, textoOriginal) {
    const textoNorm   = normalizar(textoOriginal);
    const op          = detectarOpEspacial(textoNorm);
    const instruccion = { layerKey, filtro: '', clipArea: null, descripcion: textoOriginal };

    // ── Filtro por atributo ───────────────────────────────────────
    //
    // Se intenta ANTES de construir el área espacial para que puedan
    // coexistir (ej: "estadios en Córdoba" → filtro de tipo + clip por provincia).
    //
    // GUARDIA: si el texto coincide con el nombre genérico de la capa,
    // el usuario pide la capa completa, no un subtipo.
    // Ej: "áreas protegidas de Córdoba" NO debe filtrar por gna='Area Protegida'.
    if (capa.filterField && Array.isArray(capa.filterValues) && capa.filterValues.length) {
      const nombreCapa       = normalizar(capa.tituloUI || capa.titulo || '');
      const tokensNombreCapa = tokenizar(nombreCapa);

      const areaVal      = typeof area === 'object' && area !== null ? (area.valorNorm || '') : '';
      const textoSinArea = areaVal ? textoNorm.replace(areaVal, '').trim() : textoNorm;
      const tokensTexto  = tokenizar(textoSinArea);

      // Verifica si un token del usuario está cubierto por los tokens del nombre de la capa
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

      console.log(`[CAPA] filtro atributo: esPedidoGenerico=${esPedidoGenerico}${instruccion.filtro ? ' → ' + instruccion.filtro : ' → sin filtro'}`);
    }

    if (!area) return instruccion;

    // Área solo de país o ambigua → no se puede construir área espacial
    if (area.ambiguo || !area.valorOriginal) return instruccion;

    const strategy = capa.clipStrategy;
    const isArcgis = window.SOURCES?.[capa.source]?.tipo === 'arcgis';

    // ── Within layer / within_layer_exclude ──────────────────────
    if (op === 'within_layer' || op === 'within_layer_exclude') {
      instruccion.op = op;
      instruccion.withinArea = {
        layerKey:   area.layerKey,
        field:      area.field,
        value:      area.valorOriginal,
      };
      instruccion.withinDistance = extraerDistanciaKm(textoNorm);
      // Búsqueda por proximidad, no por pertenencia → limpiar filtro de atributo
      instruccion.filtro = '';
      return instruccion;
    }

    // ── Dissolve / dissolve_exclude ───────────────────────────────
    //
    // Paso C: dissolve con área y geoFields resuelto por intent.
    // Si la capa tiene geoFields para el tipo del área detectada, se construye
    // el filtro CQL directamente sin necesitar al LLM.
    // Ej: "uní los departamentos de Córdoba"
    //     → geoFields.provincia='nom_pcia' → filtro: nom_pcia='Córdoba'
    // Con regiones (valorOriginal array):
    //     → filtro: nom_pcia IN ('Neuquén','Río Negro',...)
    if (op === 'dissolve') {
      instruccion.op = 'dissolve';
      const campo = (capa.geoFields || {})[area.tipo];
      if (campo) {
        const filtroArea = _buildFiltroArea(campo, area.valorOriginal, false);
        instruccion.filtro = instruccion.filtro
          ? `${instruccion.filtro} AND ${filtroArea}`
          : filtroArea;
      }
      // Sin geoFields para el tipo del área: dissolve sin filtro de área.
      return instruccion;
    }

    if (op === 'dissolve_exclude') {
      instruccion.op = 'dissolve_exclude';
      instruccion.dissolveArea = {
        layerKey: area.layerKey,
        field:    area.field,
        value:    area.valorOriginal,
      };
      instruccion.filtro = '';
      return instruccion;
    }

    // ── Adjacent / adjacent_exclude ───────────────────────────────
    if (op === 'adjacent' || op === 'adjacent_exclude') {
      instruccion.op = op;
      instruccion.adjacentArea = {
        layerKey: area.layerKey,
        field:    area.field,
        value:    area.valorOriginal,
      };
      instruccion.filtro = '';
      return instruccion;
    }

    // ── Nearest / nearest_exclude ────────────────────────────────
    if (op === 'nearest' || op === 'nearest_exclude') {
      instruccion.op = op;
      instruccion.nearestArea = {
        layerKey: area.layerKey,
        field:    area.field,
        value:    area.valorOriginal,
      };
      instruccion.nearestCount = extraerNearestCount(textoNorm);
      instruccion.filtro = '';
      return instruccion;
    }

    // ── Intersect / intersect_exclude ────────────────────────────
    if (op === 'intersect' || op === 'intersect_exclude') {
      if (strategy === 'attribute') {
        // Para capas de atributo, "pasa por" / "no pasa por" se resuelve con filtro CQL.
        // Usa _buildFiltroArea para manejar correctamente arrays (regiones).
        const campo = (capa.geoFields || {})[area.tipo] || capa.clipField;
        if (campo) {
          const filtroArea = _buildFiltroArea(campo, area.valorOriginal, op === 'intersect_exclude');
          instruccion.filtro = instruccion.filtro
            ? `${instruccion.filtro} AND ${filtroArea}`
            : filtroArea;
        }
        return instruccion;
      }
      instruccion.op = op;
      instruccion.intersectArea = {
        layerKey: area.layerKey,
        field:    area.field,
        value:    area.valorOriginal,
      };
      return instruccion;
    }

    // ── Clip / clip_exclude ───────────────────────────────────────
    if (strategy === 'attribute') {
      // Filtro por campo de atributo del WFS (más eficiente que clip geométrico).
      // Usa _buildFiltroArea para manejar correctamente arrays (regiones).
      const campo = (capa.geoFields || {})[area.tipo] || capa.clipField;
      if (campo) {
        const filtroArea = _buildFiltroArea(campo, area.valorOriginal, op === 'clip_exclude');
        instruccion.filtro = instruccion.filtro
          ? `${instruccion.filtro} AND ${filtroArea}`
          : filtroArea;
      }
    } else if (strategy === 'spatial') {
      // Para fuentes ArcGIS REST con geoFields: filtro SQL (más eficiente).
      // Para WFS (IGN/IGM): clip espacial en el servidor.
      const campoGeo = isArcgis && (capa.geoFields || {})[area.tipo];
      if (campoGeo) {
        const filtroArea = _buildFiltroArea(campoGeo, area.valorOriginal, op === 'clip_exclude');
        instruccion.filtro = instruccion.filtro
          ? `${instruccion.filtro} AND ${filtroArea}`
          : filtroArea;
        // No setear clipArea — el filtro SQL es suficiente
      } else {
        // Clip geométrico espacial: setear clipArea con op
        instruccion.op      = op === 'clip_exclude' ? 'clip_exclude' : undefined;
        instruccion.clipArea = {
          layerKey: area.layerKey,
          field:    area.field,
          value:    area.valorOriginal,
        };
      }
    }

    return instruccion;
  }

  // ── detectarCapaDirecta ───────────────────────────────────────
  //
  // Versión interna sin guardia de historial LLM.
  // Usada por detectarAgregar (intent-acciones.js) porque "también cargá X"
  // debe funcionar incluso si ya hubo conversación con el LLM.
  //
  // Flujo:
  //   1. Guardias básicas (PATRON_NO_CAPA, PATRON_MULTIPLE refinado).
  //   2. Detectar área y país explícito en el texto.
  //   3. Scorer → mejor capa.
  //   4. Guardia de país ambiguo.
  //   5. Construir instrucción.

  // ── Paso D: _intentarResolverMultiple ─────────────────────────
  //
  // Si PATRON_MULTIPLE matcheó, intenta verificar si el "y"/"and"/"e" conecta
  // dos o más áreas del mismo tipo en GEO_MAPS (ej: "rutas de Córdoba y Mendoza").
  // En ese caso resuelve con un area.valorOriginal array en lugar de derivar al LLM.
  //
  // Solo actúa cuando:
  //   a) Hay exactamente un conector (y/and/e/o) en el texto.
  //   b) Las partes a ambos lados son áreas del mismo tipo y país.
  //   c) El scorer puede identificar la capa a partir del texto sin las áreas.
  //
  // Devuelve el area modificada con valorOriginal:[v1,v2,...] o null si no puede resolver.

  function _intentarResolverMultiple(textoNorm) {
    // Splitear por conectores de lista: "y", "and", "e", comas + "y", etc.
    // Separar el texto en candidatos: "Córdoba y Mendoza" → ['córdoba','mendoza']
    const partes = textoNorm
      .split(/\b(?:y|and|e|ou)\b/i)
      .map(p => p.replace(/,\s*$/, '').trim())
      .filter(p => p.length > 1);

    if (partes.length < 2) return null;

    // Intentar detectar área en cada parte por separado
    const areas = partes.map(p => detectarArea(p)).filter(Boolean);

    // Todos tienen que ser áreas no ambiguas del mismo tipo y país
    if (areas.length < 2) return null;
    if (areas.some(a => a.ambiguo)) return null;
    if (new Set(areas.map(a => a.tipo)).size > 1) return null;
    if (new Set(areas.map(a => a.pais)).size > 1) return null;

    // Todas usan el mismo layerKey y field
    if (new Set(areas.map(a => a.layerKey)).size > 1) return null;
    if (new Set(areas.map(a => a.field)).size > 1) return null;

    // Construir area combinada con valorOriginal como array
    const valores = areas.map(a => a.valorOriginal);
    return {
      tipo:          areas[0].tipo,
      nivel:         areas[0].nivel,
      pais:          areas[0].pais,
      // valorNorm: concatenar para el log (no se usa en filtros)
      valorNorm:     areas.map(a => a.valorNorm).join(' y '),
      ambiguo:       false,
      valorOriginal: valores,
      layerKey:      areas[0].layerKey,
      field:         areas[0].field,
    };
  }

  // ── Paso E: _detectarRefCapa ──────────────────────────────────
  //
  // Para within_layer y nearest: cuando detectarArea no encontró un área
  // administrativa conocida, intenta identificar si la referencia es una
  // capa del catálogo (ej: "aeropuertos a 100km de una ruta nacional").
  //
  // Estrategia:
  //   1. Extraer el fragmento del texto DESPUÉS del separador de proximidad
  //      ("a X km de", "cerca de", "más cercano a", etc.)
  //   2. Scorear ese fragmento como si fuera una capa pedida.
  //   3. Si el scorer devuelve un resultado con score suficiente → refLayerKey.
  //
  // Solo actúa cuando detectarArea devuelve null y la op es within_layer o nearest.
  // Si falla, devuelve null y el flujo normal sigue (→ LLM).

  const PATRON_SEPARADOR_PROX = /\b(?:a\s+[\d.,]+\s*km\s+de|cerca\s+de|distancia\s+de|radio\s+de|a\s+menos\s+de|within\s+[\d.,]+\s*km\s+of|near(?:est)?\s+(?:to\s+)?(?:a\s+)?|m[aá]s\s+cercano\s+a|m[aá]s\s+pr[oó]ximo\s+a|los\s+\d+\s+m[aá]s\s+cercanos?\s+a|closest\s+to|nearest\s+to)\b/i;

  function _detectarRefCapa(textoNorm, op) {
    if (!['within_layer','within_layer_exclude','nearest','nearest_exclude'].includes(op)) return null;

    const match = textoNorm.match(PATRON_SEPARADOR_PROX);
    if (!match) return null;

    const idxFin      = match.index + match[0].length;
    const fragmentoRef = textoNorm.slice(idxFin).trim();
    if (fragmentoRef.length < 3) return null;

    // Scorear el fragmento de referencia como capa
    const resultadoRef = buscarCapa(fragmentoRef, null);
    if (!resultadoRef) return null;

    // El fragmento de la capa pedida está ANTES del separador
    const fragmentoCapa = textoNorm.slice(0, match.index).trim();
    if (fragmentoCapa.length < 3) return null;

    // Scorear la capa pedida sobre el fragmento anterior al separador
    // (quitando el layerKey de referencia para no contaminar)
    const resultadoCapa = buscarCapa(fragmentoCapa, null);
    if (!resultadoCapa) return null;

    // No usar la misma capa como pedida y como referencia
    if (resultadoCapa.key === resultadoRef.key) return null;

    console.log(`[CAPA] Paso E: capa="${resultadoCapa.key}" refLayerKey="${resultadoRef.key}"`);
    return { layerKey: resultadoCapa.key, capa: resultadoCapa.capa, refLayerKey: resultadoRef.key };
  }

  function detectarCapaDirecta(textoUsuario) {
    if (PATRON_NO_CAPA.test(textoUsuario))  return null;

    const textoNorm = normalizar(textoUsuario);

    // Paso D: si PATRON_MULTIPLE matchea, intentar resolver como array de áreas
    // antes de derivar al LLM.
    let areaMultiple = null;
    if (PATRON_MULTIPLE.test(textoUsuario)) {
      areaMultiple = _intentarResolverMultiple(textoNorm);
      if (!areaMultiple) return null; // no se pudo resolver → LLM
    }

    const area = areaMultiple || detectarArea(textoNorm);
    if (area?.ambiguo) return null;

    const paises = buildPaisesMap();
    let paisExplicito = null;
    for (const [nombre, codigo] of Object.entries(paises)) {
      if (textoNorm.includes(nombre)) { paisExplicito = codigo; break; }
    }

    // País explícito sin contexto admin → el país gana sobre cualquier área administrativa
    // con el mismo nombre (ej: departamento "Uruguay" de Entre Ríos)
    let areaFinal = area;
    const contextoAdmin = /\b(departamento|depto|partido|provincia|prov|municipio|distrito)\b/;
    if (paisExplicito && area && !area.ambiguo) {
      if (!contextoAdmin.test(textoNorm)) areaFinal = { pais: paisExplicito };
    } else if (paisExplicito && !area) {
      areaFinal = { pais: paisExplicito };
    }

    // Paso E: si no hay área y la op es within_layer/nearest, intentar refLayerKey
    const op = detectarOpEspacial(textoNorm);
    if (!areaFinal?.valorOriginal && ['within_layer','within_layer_exclude','nearest','nearest_exclude'].includes(op)) {
      const refResult = _detectarRefCapa(textoNorm, op);
      if (refResult) {
        const instruccion = construirInstruccion(refResult.layerKey, refResult.capa, null, textoUsuario);
        instruccion.op          = op;
        instruccion.refLayerKey = refResult.refLayerKey;
        if (op === 'within_layer' || op === 'within_layer_exclude') {
          instruccion.withinDistance = extraerDistanciaKm(textoNorm);
        }
        if (op === 'nearest' || op === 'nearest_exclude') {
          instruccion.nearestCount = extraerNearestCount(textoNorm);
        }
        return { tipo: 'capa', parametros: { instruccion } };
      }
    }

    const resultado = buscarCapa(textoNorm, areaFinal);
    if (!resultado) return null;

    // Guardia de país ambiguo: si hay capas de varios países y no se especificó
    // ninguno, no asumir el del resultado → LLM pregunta
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

  // ── detectarCapa ─────────────────────────────────────────────
  //
  // Versión pública con guardia de historial LLM.
  //
  // Si ya hubo respuestas del LLM en la conversación, se deriva al LLM
  // para que mantenga el contexto (el LLM puede haber hecho preguntas
  // aclaratorias que condicionan la respuesta correcta).
  // Si todos los mensajes previos fueron resueltos por intent, intent
  // puede seguir manejando el pedido.

  function detectarCapa(textoUsuario, historial) {
    const mensajesLLM = (historial || []).filter(
      m => m.role === 'assistant' && m.fromLLM === true
    );
    if (mensajesLLM.length > 0) {
      console.log(`[CAPA] → LLM | conversación LLM previa (${mensajesLLM.length} msgs)`);
      return null;
    }
    if (PATRON_NO_CAPA.test(textoUsuario)) {
      console.log(`[CAPA] → LLM | palabra excluida en: "${textoUsuario.slice(0, 60)}"`);
      return null;
    }

    const textoNorm = normalizar(textoUsuario);

    // Paso D: si PATRON_MULTIPLE matchea, intentar resolver como array de áreas
    // antes de derivar al LLM.
    let areaMultiple = null;
    if (PATRON_MULTIPLE.test(textoUsuario)) {
      areaMultiple = _intentarResolverMultiple(textoNorm);
      if (!areaMultiple) {
        console.log(`[CAPA] → LLM | pedido múltiple no resolvible: "${textoUsuario.slice(0, 60)}"`);
        return null;
      }
    }

    const area = areaMultiple || detectarArea(textoNorm);

    if (area?.ambiguo) {
      console.log(`[CAPA] → LLM | área ambigua: "${area.valorNorm}" en ${area.candidatos?.length} unidades`);
      return null;
    }

    const paises = buildPaisesMap();
    let paisExplicito = null;
    for (const [nombre, codigo] of Object.entries(paises)) {
      if (textoNorm.includes(nombre)) { paisExplicito = codigo; break; }
    }

    let areaFinal = area;
    const contextoAdmin = /\b(departamento|depto|partido|provincia|prov|municipio|distrito)\b/;
    if (paisExplicito && area && !area.ambiguo) {
      if (!contextoAdmin.test(textoNorm)) areaFinal = { pais: paisExplicito };
    } else if (paisExplicito && !area) {
      areaFinal = { pais: paisExplicito };
    }

    // Paso E: si no hay área y la op es within_layer/nearest, intentar refLayerKey
    const op = detectarOpEspacial(textoNorm);
    if (!areaFinal?.valorOriginal && ['within_layer','within_layer_exclude','nearest','nearest_exclude'].includes(op)) {
      const refResult = _detectarRefCapa(textoNorm, op);
      if (refResult) {
        const instruccion = construirInstruccion(refResult.layerKey, refResult.capa, null, textoUsuario);
        instruccion.op          = op;
        instruccion.refLayerKey = refResult.refLayerKey;
        if (op === 'within_layer' || op === 'within_layer_exclude') {
          instruccion.withinDistance = extraerDistanciaKm(textoNorm);
        }
        if (op === 'nearest' || op === 'nearest_exclude') {
          instruccion.nearestCount = extraerNearestCount(textoNorm);
        }
        console.log(`[CAPA] ✓ ${refResult.layerKey} + refLayerKey=${refResult.refLayerKey} (score: ${refResult.capa ? 'ok' : '?'})`);
        return { tipo: 'capa', parametros: { instruccion } };
      }
    }

    const resultado = buscarCapa(textoNorm, areaFinal);
    if (!resultado) {
      console.log(`[CAPA] → LLM | scorer no encontró coincidencia: "${textoUsuario.slice(0, 60)}"`);
      return null;
    }

    // Guardia de país ambiguo
    if (!paisExplicito && !areaFinal?.pais && !areaFinal?.valorNorm) {
      const sourceCountry = window.SOURCES?.[resultado.capa.source]?.country;
      if (sourceCountry) {
        const paisesDisponibles = new Set(
          Object.values(window.SOURCES || {}).map(s => s.country).filter(Boolean)
        );
        if (paisesDisponibles.size > 1) {
          console.log(`[CAPA] → LLM | país ambiguo: "${resultado.key}" es de ${sourceCountry} pero hay ${paisesDisponibles.size} países`);
          return null;
        }
      }
    }

    const instruccion = construirInstruccion(resultado.key, resultado.capa, areaFinal, textoUsuario);
    console.log(`[CAPA] ✓ ${resultado.key}${areaFinal?.valorOriginal ? ' + ' + (Array.isArray(areaFinal.valorOriginal) ? areaFinal.valorOriginal.join(', ') : areaFinal.valorOriginal) : ''} (score: ${resultado.score.toFixed(2)})`);
    return { tipo: 'capa', parametros: { instruccion } };
  }

  // ── API pública ───────────────────────────────────────────────
  return { detectarCapa, detectarCapaDirecta };

})();
