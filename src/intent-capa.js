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
 *        Determinar si el usuario pide clip (contenido dentro de),
 *        intersect (features que atraviesan) o buffer (features a X km).
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
  // Dado el texto del usuario, determina qué operación espacial aplica:
  //
  //   'buffer'    → "a X km de", "cerca de", "dentro de X km"
  //                 Genera un buffer alrededor del área de referencia.
  //
  //   'intersect' → "pasan por", "cruzan", "atraviesan"
  //                 Devuelve features que tocan/cruzan el área.
  //
  //   'clip'      → (default) "de Córdoba", "en la provincia de..."
  //                 Devuelve features contenidos dentro del área.

  const PATRON_INTERSECT = /\b(pasan?\s+por|tocan?|atraviesan?|cruzan?|intersectan?|que\s+recorren?|que\s+bordean?|pass\s+(through|by)|cross(es)?|go\s+through|traverse|intersect|run\s+through|border|passam?\s+por|cruzam?|atravessam?|intersectam?|percorrem?|margeiam?)\b/;
  const PATRON_BUFFER    = /\b(a\s+\d[\d.,]*\s*km|cerca\s+de|distancia\s+de|radio\s+de|a\s+menos\s+de|within\s+\d[\d.,]*\s*km|near|within\s+distance|less\s+than\s+\d[\d.,]*\s*km|around|close\s+to|a\s+\d[\d.,]*\s*km|perto\s+de|distância\s+de|raio\s+de|a\s+menos\s+de)\b/;
  const PATRON_DISTANCIA = /(\d[\d.,]*)\s*km/;

  // Patrones de exclusión — se evalúan ANTES que los de inclusión para que
  // "rutas que no pasan por Mendoza" no matchee primero el PATRON_INTERSECT.
  // Capturan las tres variantes (ES, EN, PT) de cada operación inversa.

  const PATRON_CLIP_EXCLUDE = /\b(fuera\s+de|excepto\s+(los?|las?)\s+de|salvo\s+(los?|las?)\s+de|todos?\s+menos\s+(los?|las?)\s+de|que\s+no\s+est[aá]n?\s+en|outside(\s+of)?|except(\s+those)?\s+(in|from)|all\s+except|excluding|fora\s+de|exceto\s+(os?|as?)\s+de|salvo\s+(os?|as?)\s+de|todos?\s+exceto)\b/i;

  const PATRON_INTERSECT_EXCLUDE = /\b(no\s+pasan?\s+por|no\s+tocan?|no\s+atraviesan?|no\s+cruzan?|que\s+evitan?|que\s+no\s+recorren?|not\s+pass(ing)?\s+through|not\s+cross(ing)?|not\s+go(ing)?\s+through|avoid(ing)?|that\s+don'?t?\s+(pass|cross|go\s+through)|não\s+passam?\s+por|não\s+cruzam?|não\s+atravessam?|evitam?)\b/i;

  const PATRON_BUFFER_EXCLUDE = /\b(a\s+m[aá]s\s+de\s+\d[\d.,]*\s*km|lejos\s+de|fuera\s+del?\s+radio|m[aá]s\s+de\s+\d[\d.,]*\s*km|more\s+than\s+\d[\d.,]*\s*km\s+(from|away)|outside\s+(a\s+)?\d[\d.,]*\s*km|far\s+(from|away)|beyond\s+\d[\d.,]*\s*km|a\s+mais\s+de\s+\d[\d.,]*\s*km|longe\s+de|fora\s+do\s+raio)\b/i;

  function detectarOpEspacial(textoNorm) {
    // Los exclude se evalúan primero para evitar que los patrones
    // de inclusión ganen por substring (ej: "no pasan por" contiene "pasan por").
    if (PATRON_BUFFER_EXCLUDE.test(textoNorm))    return 'buffer_exclude';
    if (PATRON_INTERSECT_EXCLUDE.test(textoNorm)) return 'intersect_exclude';
    if (PATRON_CLIP_EXCLUDE.test(textoNorm))      return 'clip_exclude';
    if (PATRON_BUFFER.test(textoNorm))            return 'buffer';
    if (PATRON_INTERSECT.test(textoNorm))         return 'intersect';
    return 'clip';
  }

  // Extrae la distancia en km del texto para operaciones de buffer.
  // Si no se menciona distancia, devuelve 50 km como valor razonable por defecto.
  function extraerDistanciaKm(textoNorm) {
    const match = textoNorm.match(PATRON_DISTANCIA);
    if (!match) return 50;
    return parseFloat(match[1].replace(',', '.'));
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
  //   { layerKey, filtro, clipArea?, op?, bufferArea?, intersectArea?, descripcion }
  //
  // El campo `op` solo aparece cuando la operación no es 'clip' (default).
  // `filtro` puede estar vacío o contener CQL/SQL (atributo + área combinados).

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

    // ── Buffer ────────────────────────────────────────────────────
    if (op === 'buffer' || op === 'buffer_exclude') {
      instruccion.op = op;
      instruccion.bufferArea = {
        layerKey:   area.layerKey,
        field:      area.field,
        value:      area.valorOriginal,
        distanceKm: extraerDistanciaKm(textoNorm),
      };
      // Con buffer se busca por proximidad, no por pertenencia → limpiar filtro de atributo
      instruccion.filtro = '';
      return instruccion;
    }

    // ── Intersect / intersect_exclude ────────────────────────────
    if (op === 'intersect' || op === 'intersect_exclude') {
      if (strategy === 'attribute') {
        // Para capas de atributo, "pasa por" / "no pasa por" se resuelve con filtro CQL.
        // intersect_exclude → NOT IN / != (más eficiente que clip geométrico inverso).
        const campo = (capa.geoFields || {})[area.tipo] || capa.clipField;
        if (campo) {
          const filtroArea = op === 'intersect_exclude'
            ? `${campo}!='${area.valorOriginal}'`
            : `${campo}='${area.valorOriginal}'`;
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
      // clip_exclude → NOT IN / != en lugar de = .
      const campo = (capa.geoFields || {})[area.tipo] || capa.clipField;
      if (campo) {
        const filtroArea = op === 'clip_exclude'
          ? `${campo}!='${area.valorOriginal}'`
          : `${campo}='${area.valorOriginal}'`;
        instruccion.filtro = instruccion.filtro
          ? `${instruccion.filtro} AND ${filtroArea}`
          : filtroArea;
      }
    } else if (strategy === 'spatial') {
      // Para fuentes ArcGIS REST con geoFields: filtro SQL (más eficiente).
      // Para WFS (IGN/IGM): clip espacial en el servidor.
      const isArcgis = window.SOURCES?.[capa.source]?.tipo === 'arcgis';
      const campoGeo = isArcgis && (capa.geoFields || {})[area.tipo];
      if (campoGeo) {
        const filtroArea = op === 'clip_exclude'
          ? `${campoGeo}!='${area.valorOriginal}'`
          : `${campoGeo}='${area.valorOriginal}'`;
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
  //   1. Guardias básicas (PATRON_NO_CAPA, PATRON_MULTIPLE).
  //   2. Detectar área y país explícito en el texto.
  //   3. Scorer → mejor capa.
  //   4. Guardia de país ambiguo.
  //   5. Construir instrucción.

  function detectarCapaDirecta(textoUsuario) {
    if (PATRON_NO_CAPA.test(textoUsuario))  return null;
    if (PATRON_MULTIPLE.test(textoUsuario)) return null;

    const textoNorm = normalizar(textoUsuario);
    const area      = detectarArea(textoNorm);
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
    if (PATRON_MULTIPLE.test(textoUsuario)) {
      console.log(`[CAPA] → LLM | pedido múltiple: "${textoUsuario.slice(0, 60)}"`);
      return null;
    }

    const textoNorm = normalizar(textoUsuario);
    const area      = detectarArea(textoNorm);

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
    console.log(`[CAPA] ✓ ${resultado.key}${areaFinal?.valorOriginal ? ' + ' + areaFinal.valorOriginal : ''} (score: ${resultado.score.toFixed(2)})`);
    return { tipo: 'capa', parametros: { instruccion } };
  }

  // ── API pública ───────────────────────────────────────────────
  return { detectarCapa, detectarCapaDirecta };

})();
