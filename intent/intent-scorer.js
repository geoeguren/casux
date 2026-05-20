/**
 * src/intent/intent-scorer.js — Motor de scoring de capas
 *
 * Responsabilidad única: dado un texto de usuario y un área geográfica
 * opcional, encontrar la capa del catálogo que mejor corresponde al pedido.
 *
 * Algoritmo:
 *   1. Filtrar capas visibles del catálogo (visible !== false).
 *   2. Por cada capa, calcular un score TF-IDF contra los tokens del texto.
 *   3. Si hay empate (score del 2.º ≥ EMPATE_RATIO × score del 1.º):
 *        a. Desempatar por autoridad de dominio (domain 'primary' > 'secondary').
 *        b. Si siguen empatados: desempatar por geometría (line/polygon > point)
 *           y por special:false (capa pública > técnica).
 *        c. Si empatan fuentes distintas y ninguna es primaria → LLM.
 *   4. Si el score del ganador < MIN_SCORE → LLM.
 *
 * Autoridad de dominio (campo `domain` en sources.js):
 *   Cada fuente declara en qué temáticas es autoridad primaria (ej: MTOP → vialidad).
 *   La autoridad de una capa se infiere automáticamente comparando sus keywords
 *   contra el `domain` de su fuente — sin necesidad de campo `topic` en cada capa.
 *   IGN/IGM no declaran `domain` → todas sus capas son 'secondary' por defecto.
 *   Un servicio temático que declare `domain` gana el desempate sobre IGN/IGM
 *   para cualquier capa cuyas keywords coincidan con ese dominio.
 *
 * Dependencias: window.INTENT_UTILS (intent-utils.js)
 */

window.INTENT_SCORER = (() => {

  const { normalizar, tokenizar, buildPaisesMap } = window.INTENT_UTILS;

  // ── Constantes de scoring ─────────────────────────────────────

  // Score mínimo para que una capa sea considerada resultado válido.
  // Por debajo de este umbral → LLM.
  const MIN_SCORE = 4;

  // Ratio de empate: si el 2.º candidato alcanza este porcentaje del 1.º,
  // se considera empate y se aplican los criterios de desempate.
  const EMPATE_RATIO = 0.90;

  // ── Patrones para detección de área geográfica ────────────────

  // Palabras que sugieren un tipo administrativo concreto en el texto.
  // Permiten que detectarArea resuelva ambigüedades de nombre:
  // "Salta" puede ser provincia o localidad — "provincia de Salta" lo aclara.
  const TIPO_HINTS = {
    provincia:    /\b(provincia|provincial)\b/,
    departamento: /\b(departamento|depto|partido)\b/,
    municipio:    /\b(municipio|municipalidad|municipal)\b/,
    localidad:    /\b(localidad|ciudad|pueblo|poblado)\b/,
    region:       /\b(region|regional)\b/,
    canton:       /\b(canton|cantonal)\b/,
  };

  // Palabras de contexto administrativo — se usan para distinguir el nombre
  // del país como área administrativa vs. como referencia geográfica general.
  // Ej: "departamento Uruguay" (en Entre Ríos) vs. "capas de Uruguay" (el país).
  const CONTEXTO_ADMIN = /\b(departamento|depto|partido|provincia|prov|municipio|municipios|distrito)\b/;

  // Tokens de contexto administrativo que se filtran antes del scoring
  // para que no contaminen el matching de keywords de capas.
  const CONTEXTO_ADMIN_TOKENS = new Set([
    'departamento', 'depto', 'partido', 'provincia', 'prov',
    'municipio', 'distrito',
  ]);

  // ── detectarArea ─────────────────────────────────────────────
  //
  // Busca en el texto normalizado referencias a áreas geográficas conocidas
  // (provincias, departamentos, municipios, localidades) usando window.GEO_MAPS.
  //
  // Estrategia:
  //   - Intenta frases de hasta 3 palabras (de más larga a más corta)
  //     para preferir nombres compuestos ("San Luis" sobre "Luis").
  //   - Si el mismo nombre existe en distintos niveles administrativos,
  //     usa el hint de tipo para resolver (o elige el nivel más general).
  //   - Si el nombre es ambiguo (mismo nombre en varias unidades del mismo nivel)
  //     devuelve { ambiguo: true } → el LLM tiene más contexto para resolver.
  //
  // Devuelve: objeto con tipo, pais, valorOriginal, layerKey, field, etc. | null

  function detectarArea(textoNorm) {
    const geoMaps  = window.GEO_MAPS || {};
    const paises   = buildPaisesMap();
    const palabras = textoNorm.split(/\s+/);

    // Detectar hint de tipo administrativo en el texto
    let tipoHint = null;
    for (const [tipo, patron] of Object.entries(TIPO_HINTS)) {
      if (patron.test(textoNorm)) { tipoHint = tipo; break; }
    }

    const candidatos = [];

    // Iterar de frases más largas a más cortas para preferir nombres compuestos
    for (let largo = 3; largo >= 1; largo--) {
      for (let i = 0; i <= palabras.length - largo; i++) {
        const frase = palabras.slice(i, i + largo).join(' ');

        // Frases de una sola letra son demasiado ambiguas (ej: "a" como preposición)
        if (frase.length <= 1) continue;

        // Si la frase es un nombre de país, solo considerarla si hay contexto
        // administrativo antes (ej: "departamento Uruguay")
        if (paises[frase]) {
          const contextoAntes = palabras.slice(Math.max(0, i - 2), i).join(' ');
          if (!CONTEXTO_ADMIN.test(contextoAntes)) continue;
        }

        for (const [pais, tipos] of Object.entries(geoMaps)) {
          for (const [, mapaMeta] of Object.entries(tipos)) {
            const entrada = mapaMeta.valores?.[frase];
            if (!entrada) continue;

            if (Array.isArray(entrada)) {
              // Múltiples unidades con el mismo nombre (ej: "San Martín" en varias provincias)
              candidatos.push({
                tipo:       mapaMeta.tipo,
                nivel:      mapaMeta.nivel ?? 99,
                pais,
                valorNorm:  frase,
                ambiguo:    true,
                candidatos: entrada,
                layerKey:   mapaMeta.layerKey,
                field:      window.LAYERS?.[mapaMeta.layerKey]?.labelField || null,
              });
            } else {
              // Formato normalizado: acepta string plano (legacy) o { value, provincia }
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

        if (candidatos.length) break;
      }
      if (candidatos.length) break;
    }

    if (!candidatos.length) return null;
    if (candidatos.length === 1) return candidatos[0];

    // Múltiples candidatos: resolver por hint de tipo o por nivel más general
    if (tipoHint) {
      const porHint = candidatos.filter(c => c.tipo === tipoHint);
      if (porHint.length === 1) return porHint[0];
      if (porHint.length > 1) return porHint.reduce((a, b) => a.nivel <= b.nivel ? a : b);
    }

    // Sin hint: preferir nivel más bajo (más general)
    // Ej: "Salta" → provincia (nivel 2) sobre localidad (nivel 4)
    return candidatos.reduce((a, b) => a.nivel <= b.nivel ? a : b);
  }

  // ── _dominioAuthority ─────────────────────────────────────────
  //
  // Determina si una capa es 'primary' o 'secondary' para su fuente.
  //
  // En lugar de requerir un campo `topic` en cada capa (que implicaría
  // editar cientos de entradas), infiere la autoridad comparando las
  // keywords de la capa contra el `domain` declarado en su fuente.
  //
  // Si alguna keyword normalizada de la capa coincide con algún término
  // normalizado del `domain` de la fuente → 'primary'.
  // Si la fuente no declara `domain`, o ninguna keyword coincide → 'secondary'.
  //
  // Esto permite agregar una fuente nueva simplemente declarando su `domain`
  // en sources.js, sin tocar ningún archivo de capas.
  //
  // Ejemplo:
  //   mtop_uy.domain = ['vialidad', 'rutas', 'ferroviario', 'puentes']
  //   capa rutas_uy tiene keywords: ['ruta', 'vialidad', 'camino', ...]
  //   → 'vialidad' matchea → 'primary'
  //
  //   ign_ar no declara domain → todas sus capas son 'secondary'
  //   → si empata con mtop_uy en una capa de transporte, mtop_uy gana

  function _dominioAuthority(capa) {
    const source = window.SOURCES?.[capa.source];
    if (!source?.domain?.length) return 'secondary';

    // Usar keywords del idioma activo con fallback a ES
    const lang     = window.I18N?.getLang?.() || 'es';
    const sufijo   = lang === 'en' ? 'En' : lang === 'pt' ? 'Pt' : 'Es';
    const keywords = (capa[`keywords${sufijo}`] || capa.keywords || [])
      .map(k => normalizar(k));

    const domainNorm = source.domain.map(d => normalizar(d));

    return domainNorm.some(d => keywords.includes(d)) ? 'primary' : 'secondary';
  }

  // ── buscarCapa ────────────────────────────────────────────────
  //
  // Núcleo del scorer: recibe texto normalizado + área detectada,
  // devuelve { key, capa, score } del mejor candidato o null.
  //
  // Pipeline:
  //   1. Filtrar capas visibles, restringir por país si se especificó.
  //   2. Pre-computar IDF por token sobre el corpus de capas visibles.
  //   3. Scorear cada capa con TF-IDF + bonus de título + bonus de bigrama.
  //   4. Desempatar: domain authority → geometría → special:false.
  //   5. Aplicar MIN_SCORE y EMPATE_RATIO.

  function buscarCapa(textoNorm, area) {
    const layers = window.LAYERS || {};

    // Quitar del texto el nombre del área detectada y tokens admin
    // para que el scorer vea solo las palabras relevantes a la capa
    let textoSinArea = textoNorm;
    if (area?.valorNorm) textoSinArea = textoNorm.replace(area.valorNorm, '').trim();
    if (!area?.valorNorm && area?.pais) {
      const paises = buildPaisesMap();
      for (const [nombre, codigo] of Object.entries(paises)) {
        if (codigo === area.pais) {
          textoSinArea = textoSinArea.replace(new RegExp('\\b' + nombre + '\\b', 'g'), '').trim();
        }
      }
    }

    const tokens = tokenizar(textoSinArea).filter(t => !CONTEXTO_ADMIN_TOKENS.has(t));
    if (!tokens.length && !area?.pais) {
      console.log(`[SCORER] → sin tokens útiles`);
      return null;
    }

    // Idioma de la UI para usar campos i18n correctos en el scoring
    const _uiLang = window.I18N?.getLang?.() || window.SETTINGS?.get?.('lang') || 'es';
    const _sufijo = _uiLang === 'en' ? 'En' : _uiLang === 'pt' ? 'Pt' : 'Es';

    // Solo scorear capas visibles (visible !== false)
    const capasVisibles = Object.entries(layers).filter(([, c]) => c.visible !== false);
    const N = capasVisibles.length || 1;

    // ── Pre-computar IDF ──────────────────────────────────────────
    //
    // IDF (Inverse Document Frequency): penaliza tokens que aparecen en
    // muchas capas (son poco discriminativos) y premia los que son únicos.
    // "argentina" aparece en 200 capas → IDF bajo.
    // "geomorfologia" aparece en 1 capa → IDF alto.
    const df = new Map();
    for (const [, capa] of capasVisibles) {
      const vistos = new Set();
      const kwArr  = capa[`keywords${_sufijo}`] || capa.keywords || [];
      for (const kw of kwArr) {
        const kwNorm = normalizar(kw);
        // También indexar formas singulares para cubrir plurales en la búsqueda
        const formas = [kwNorm];
        if (kwNorm.endsWith('es') && kwNorm.length > 4) formas.push(kwNorm.slice(0, -2));
        if (kwNorm.endsWith('s')  && kwNorm.length > 3) formas.push(kwNorm.slice(0, -1));
        for (const f of formas) {
          if (!vistos.has(f)) { vistos.add(f); df.set(f, (df.get(f) || 0) + 1); }
        }
      }
    }

    // IDF normalizado al rango [0.5, 1.0] para evitar valores extremos
    function idf(token) {
      const freq = df.get(token) || 1;
      const raw  = Math.log(N / freq);
      const max  = Math.log(N);
      return max > 0 ? 0.5 + 0.5 * (raw / max) : 1.0;
    }

    // ── Peso por posición de keyword ──────────────────────────────
    //
    // Las primeras CANON keywords de una capa son las más canónicas/representativas.
    // Keywords más alejadas reciben un peso que decae linealmente hasta 0.3.
    // Esto evita que keywords secundarias (muy específicas) dominen el score.
    const CANON = 3;
    function posWeight(pos, total) {
      if (pos < CANON) return 1.0;
      const tail = total - CANON;
      if (tail <= 0) return 1.0;
      return Math.max(0.3, 1 - 0.7 * ((pos - CANON) / tail));
    }

    // ── Coincidencia de palabra completa ──────────────────────────
    //
    // Evita falsos positivos por substring: "río" no debe matchear "frío".
    const matchPalabraCompleta = (texto, palabra) =>
      new RegExp('(?:^|\\s)' + palabra + '(?:\\s|$)').test(texto);

    // ── Scorear cada capa ─────────────────────────────────────────
    const resultados = capasVisibles.map(([key, capa]) => {

      // Filtrar por país si se especificó
      if (area?.pais) {
        const sourceCountry = window.SOURCES?.[capa.source]?.country;
        if (sourceCountry && sourceCountry !== area.pais) return { key, capa, score: 0 };
      }

      // Campos del idioma de la UI (con fallback al campo base en ES)
      const tituloUIi18n = capa[`tituloUI${_sufijo}`] || capa.tituloUI || '';
      const tituloI18n   = capa[`titulo${_sufijo}`]   || capa.titulo   || '';
      const keywordsI18n = capa[`keywords${_sufijo}`] || capa.keywords || [];

      // Corpus de la capa para búsqueda por substring
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

      // Bonus máximo si el texto completo está dentro del corpus de la capa
      if (textoCapa.includes(textoSinArea)) score += 10;

      // ── Scoring por token (unigrama TF-IDF) ──────────────────────
      for (const token of tokens) {
        // Generar formas singulares para cubrir plurales del usuario
        const singulares = [];
        if (token.endsWith('es') && token.length > 4) singulares.push(token.slice(0, -2));
        if (token.endsWith('s')  && token.length > 3) singulares.push(token.slice(0, -1));
        const singularesValidos = singulares.filter(s => s.length >= 4);

        // Match exacto en keywords (con IDF y peso por posición)
        const kwMatch = keywordsNorm.find(({ norm }) =>
          norm === token || singularesValidos.some(s => norm === s)
        );
        if (kwMatch) {
          score += 4 * posWeight(kwMatch.pos, kwMatch.total) * idf(token);
        } else if (matchPalabraCompleta(textoCapa, token)) {
          // Match en texto completo de la capa (título, key, etc.)
          score += 2;
        } else if (singularesValidos.some(s => matchPalabraCompleta(textoCapa, s))) {
          score += 2;
        }

        // Bonus adicional si aparece en el título (más relevante que en keywords)
        const enTitulo = titulosNorm.some(t =>
          t === token ||
          matchPalabraCompleta(t, token) ||
          singularesValidos.some(s => matchPalabraCompleta(t, s))
        );
        if (enTitulo) score += 2;
      }

      // ── Scoring por bigrama ───────────────────────────────────────
      //
      // Pares de tokens consecutivos: "vial nacional", "área protegida", etc.
      // Un bigrama match es señal más fuerte que dos unigramas separados.
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
      console.log(`[SCORER] → ninguna capa superó score > 0 para: [${tokens.join(', ')}]`);
      return null;
    }

    // ── Desempate ─────────────────────────────────────────────────
    //
    // Criterios en orden de prioridad:
    //   1. Domain authority: primary > secondary
    //   2. Geometría: line/polygon > point (para misma temática, capa de área es más útil)
    //   3. special:false: capa pública > capa técnica/auxiliar
    const GEOM_PRIO = { line: 2, polygon: 1, point: 0 };

    const prioridad = (r) => {
      const dominio = _dominioAuthority(r.capa) === 'primary' ? 10 : 0;
      const geom    = GEOM_PRIO[r.capa.geomType] ?? 0;
      const special = r.capa.special === false ? 1 : 0;
      return dominio + geom + special;
    };

    resultados.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : prioridad(b) - prioridad(a)
    );

    const mejor = resultados[0];

    // Score insuficiente → LLM
    if (mejor.score < MIN_SCORE) {
      console.log(`[SCORER] → score insuficiente: "${mejor.key}" obtuvo ${mejor.score.toFixed(2)} (mín: ${MIN_SCORE})`);
      return null;
    }

    // Empate: verificar si el 2.º candidato está demasiado cerca
    if (resultados.length > 1) {
      const segundo = resultados[1];
      if (segundo.score >= mejor.score * EMPATE_RATIO) {
        const priMejor   = prioridad(mejor);
        const priSegundo = prioridad(segundo);

        if (priMejor > priSegundo) {
          // El desempate por prioridad resuelve el empate
          const motivo = _dominioAuthority(mejor.capa) === 'primary'
            ? 'domain authority'
            : 'geometría/special';
          console.log(`[SCORER] Desempate por ${motivo}: "${mejor.key}"(${mejor.score.toFixed(2)}) sobre "${segundo.key}"(${segundo.score.toFixed(2)})`);
        } else if (priMejor === priSegundo && mejor.capa.source !== segundo.capa.source) {
          // Empate entre fuentes distintas sin diferencia de prioridad → LLM
          console.log(`[SCORER] Empate cross-source: "${mejor.key}"(${mejor.score.toFixed(2)}) vs "${segundo.key}"(${segundo.score.toFixed(2)}) → LLM`);
          return null;
        } else {
          // Empate genérico → LLM
          console.log(`[SCORER] Empate: "${mejor.key}"(${mejor.score.toFixed(2)}) vs "${segundo.key}"(${segundo.score.toFixed(2)}) → LLM`);
          return null;
        }
      }
    }

    return mejor;
  }

  // ── API pública ───────────────────────────────────────────────
  return { buscarCapa, detectarArea, CONTEXTO_ADMIN_TOKENS };

})();
