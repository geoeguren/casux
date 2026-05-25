/**
 * chat-title.js — Generación de títulos y capitalización geográfica
 *
 * Expone: window.CHAT_TITLE
 * Depende de: window.SETTINGS, window.I18N, window.LAYERS, window.SOURCES, window.GEO_MAPS
 * Debe cargarse ANTES de chat.js
 *
 * Contiene: toTitleCase, tituloDesdePlan, generarTitulo, _buildGeoLookup
 */

window.CHAT_TITLE = (() => {

  // Stopwords para title case en inglés
  const _EN_STOPWORDS = new Set([
    'a','an','the','and','but','or','nor','for','so','yet',
    'at','by','in','of','on','to','up','as','via','vs',
  ]);

  /**
   * _buildGeoLookup()
   *
   * Construye un lookup normNombre → valorCanónico desde window.GEO_MAPS
   * y window.SOURCES. Se reconstruye en cada llamada para reflejar
   * automáticamente nuevos países o fuentes agregados al sistema.
   */
  function _buildGeoLookup() {
    const lookup = {};

    for (const src of Object.values(window.SOURCES || {})) {
      if (src.countryLabel) {
        const norm = src.countryLabel.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        lookup[norm] = src.countryLabel;
      }
    }

    for (const tipos of Object.values(window.GEO_MAPS || {})) {
      for (const meta of Object.values(tipos)) {
        for (const [norm, entrada] of Object.entries(meta.valores || {})) {
          const canonico = Array.isArray(entrada)
            ? entrada[0]?.value
            : (typeof entrada === 'string' ? entrada : entrada?.value);
          if (canonico && !lookup[norm]) lookup[norm] = canonico;
        }
      }
    }

    return lookup;
  }

  function toTitleCase(texto) {
    if (!texto) return texto;
    const t = texto.trim();
    if (!t) return t;

    const lang = window.SETTINGS?.get('lang') || window.I18N?.getLang?.() || 'es';

    if (lang === 'en') {
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
   */
  function tituloDesdePlan(instrucciones) {
    if (!instrucciones?.length) return null;

    const _lang = window.I18N?.getLang?.() || 'es';
    const _suf  = _lang === 'en' ? 'En' : _lang === 'pt' ? 'Pt' : 'Es';

    function _nombreCapa(inst, conRecorte) {
      const capa = window.LAYERS?.[inst.layerKey];
      if (!capa) return inst.tituloUI || inst.layerKey;
      const tituloUI = capa[`tituloUI${_suf}`] || capa.tituloUI || '';
      if (!conRecorte) return tituloUI || capa.titulo || inst.layerKey;
      const sinSufijo = tituloUI
        .replace(/\s+(?:de|of|do|da|del|of\s+the)\s+\S.*$/i, '')
        .trim();
      if (sinSufijo && sinSufijo.length >= 3) return sinSufijo;
      return tituloUI || capa.titulo || inst.layerKey;
    }

    function _extraerRecorte(inst) {
      if (inst.clipArea?.value)      return { valor: inst.clipArea.value,      op: inst.op || 'clip' };
      if (inst.intersectArea?.value) return { valor: inst.intersectArea.value, op: 'intersect' };
      if (inst.withinArea?.value)    return { valor: inst.withinArea.value,    op: 'within' };
      if (inst.adjacentArea?.value)  return { valor: inst.adjacentArea.value,  op: 'adjacent' };
      if (inst.nearestArea?.value)   return { valor: inst.nearestArea.value,   op: 'nearest' };
      if (inst.dissolveArea?.value)  return { valor: inst.dissolveArea.value,  op: 'dissolve' };
      if (inst.refLayerKey && (inst.op === 'within_layer' || inst.op === 'nearest')) {
        const refCapa = window.LAYERS?.[inst.refLayerKey];
        const refNombre = refCapa?.[`tituloUI${_suf}`] || refCapa?.tituloUI || inst.refLayerKey;
        return { valor: refNombre, op: inst.op };
      }
      return null;
    }

    function _formatearArea(recorte, nearestCount) {
      if (!recorte) return null;
      const { valor, op } = recorte;
      const valorStr = Array.isArray(valor) ? valor.join(', ') : valor;

      if (_lang === 'en') {
        if (op === 'intersect' || op === 'intersect_exclude') return valorStr;
        if (op === 'within' || op === 'within_layer') {
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
      return valorStr;
    }

    const MAX_CAPAS_TITULO = 3;
    const insts = instrucciones.slice(0, MAX_CAPAS_TITULO);

    let recorte = null;
    for (const inst of insts) {
      recorte = _extraerRecorte(inst);
      if (recorte) break;
    }

    const conRecorte = !!recorte;

    const nombres = insts
      .map(inst => _nombreCapa(inst, conRecorte))
      .filter(Boolean);
    if (!nombres.length) return null;

    const nombreCapas = nombres.length === 1
      ? nombres[0]
      : nombres.length === 2
        ? `${nombres[0]} y ${nombres[1]}`
        : `${nombres[0]}, ${nombres[1]} y ${nombres[2]}`;

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

  return { toTitleCase, tituloDesdePlan, generarTitulo };

})();
