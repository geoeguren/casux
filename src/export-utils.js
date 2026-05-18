/**
 * export-utils.js — Utilidades compartidas de exportación
 */

window.EXPORT_UTILS = (() => {

  // Darken helper para canvas (no depende del helper HSL del HTML export)
  function _darkenHex(hex, amount) {
    try {
      const h = hex.replace('#', '');
      let r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
      r = Math.max(0, Math.round(r * (1 - amount)));
      g = Math.max(0, Math.round(g * (1 - amount)));
      b = Math.max(0, Math.round(b * (1 - amount)));
      return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
    } catch { return hex; }
  }


  function _hexToRgbArr(hex) {
    let h = hex.replace('#','');
    if (h.length === 3 || h.length === 4) h = h[0]+h[0] + h[1]+h[1] + h[2]+h[2];
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }

  // ── Grilla de coordenadas (graticule) ────────────────────────
  //
  // Umbrales de escala:
  //   > 1:8.000.000   → cada 20° (nacional / continental)
  //   1:1.000.000 – 1:8.000.000  → cada 10° (regional amplio)
  //   1:200.000  – 1:1.000.000   → cada 5°  (provincial)
  //   < 1:200.000                → sin grilla (local)
  //
  // Etiquetas: solo grados, con indicador de hemisferio según idioma.


  function _getGraticuleInterval(scale_m) {
    if (scale_m > 8_000_000)  return 20;
    if (scale_m > 1_000_000)  return 10;
    if (scale_m > 200_000)    return 5;
    return 0; // sin grilla
  }


  function _graticuleCardinals() {
    const lang = window.SETTINGS?.get('lang') || 'es-419';
    const west = lang.startsWith('es') || lang.startsWith('pt') ? 'O' : 'W';
    return { N: 'N', S: 'S', E: 'E', W: west };
  }


  function _formatDegLabel(deg, axis, cardinals) {
    const abs = Math.abs(deg);
    if (axis === 'lat') {
      return `${abs}°${deg >= 0 ? cardinals.N : cardinals.S}`;
    } else {
      return `${abs}°${deg >= 0 ? cardinals.E : cardinals.W}`;
    }
  }


  function niceScaleKm(scale_m, viewerPx) {
    // Cuántos km representa el ancho del visor de Leaflet.
    // scale_m:  metros reales por px de pantalla (calculado por getMapScale sobre el visor).
    // viewerPx: ancho del contenedor de Leaflet en px de pantalla — el espacio donde scale_m es válido.
    // La barra muestra ~20% del ancho total del mapa visible.
    const kmTotal = (scale_m / 3779) * viewerPx / 1000;
    const kmRef   = kmTotal * 0.20;
    const mag   = Math.pow(10, Math.floor(Math.log10(kmRef)));
    const norms = [1, 2, 5, 10];
    const nice  = norms.map(n => n * mag).find(n => n >= kmRef) || kmRef;
    return Math.round(nice * 10) / 10;
  }


  function kmToPixelsOnOutput(km, scale_m, outputMapPx, sourceMapPx) {
    const ratio    = outputMapPx / sourceMapPx;
    const mPer1px  = scale_m / 3779;
    return (km * 1000) / mPer1px * ratio;
  }



  function getMapScale(mapInst) {
    if (!mapInst) return 1000000;
    const bounds  = mapInst.getBounds();
    const size    = mapInst.getSize();
    const lat     = (bounds.getNorth() + bounds.getSouth()) / 2;
    // Metros por pixel en latitud media
    const metersPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, mapInst.getZoom());
    // Escala = metros por pixel * píxeles por metro en pantalla (96 DPI → ~3779 px/m)
    return metersPerPx * 3779;
  }


  function formatScale(scale) {
    // Redondear a número "bonito"
    const magnitude = Math.pow(10, Math.floor(Math.log10(scale)));
    const rounded   = Math.round(scale / magnitude) * magnitude;
    return rounded.toLocaleString('es-AR');
  }


  // Extraer coordenadas [lng, lat] planas de una geometría GeoJSON
  function _flatCoords(geom) {
    if (!geom) return [];
    const c = geom.coordinates;
    if (!c) return [];
    switch (geom.type) {
      case 'Point':              return [c];
      case 'MultiPoint':         return c;
      case 'LineString':         return c;
      case 'MultiLineString':    return c.flat();
      case 'Polygon':            return c.flat();
      case 'MultiPolygon':       return c.flat(2);
      case 'GeometryCollection': return (geom.geometries || []).flatMap(g => _flatCoords(g));
      default:                   return [];
    }
  }


  function _getMapMeta(activeLayers) {
    const epsgSet       = new Set();
    const attributionSet = new Set();

    Object.values(activeLayers).forEach(layer => {
      const layerKey = layer.layerKey;
      const layerDef = window.LAYERS?.[layerKey];
      const source   = window.SOURCES?.[layerDef?.source];

      // EPSG: extraer número del campo srs
      if (layerDef?.srs) {
        const m = layerDef.srs.match(/EPSG[:\s]+(\d+)/i);
        epsgSet.add(m ? m[1] : layerDef.srs);
      }

      // Fuente: attribution de SOURCES
      if (source?.attribution) {
        attributionSet.add(source.attribution);
      }
    });

    const epsgLabel = [...epsgSet].map(c => `EPSG ${c}`).join(' · ');

    const attributionText = [...attributionSet].join(' · ');
    const attributions    = [...attributionSet];  // array para dibujar una por línea

    return { epsgLabel, attributionText, attributions };
  }


  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    if (h.length === 3) {
      return { r: parseInt(h[0]+h[0], 16), g: parseInt(h[1]+h[1], 16), b: parseInt(h[2]+h[2], 16) };
    }
    return { r: parseInt(h.slice(0,2), 16), g: parseInt(h.slice(2,4), 16), b: parseInt(h.slice(4,6), 16) };
  }



  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }


  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }


  function sanitizeFilename(name) {
    // Normalizar: quitar acentos, pasar a minúsculas
    function norm(s) {
      return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    const CONECTORES = new Set([
      'a','al','ante','bajo','con','contra','de','del','desde','durante',
      'el','en','entre','es','hacia','hasta','la','las','lo','los','ni',
      'o','para','pero','por','que','se','sin','sobre','tras','un','una',
      'unas','unos','y','and','as','at','but','by','for','if','in','nor',
      'of','on','or','the','to','up','via','vs','ao','com','das','dos',
      'e','em','na','nas','no','nos','ou','um','uma',
    ]);

    // Verbos/frases que introducen la operación espacial — todo lo que sigue es el área
    // Si el patrón matchea, el título se parte en: [objeto] [área]
    const SPATIAL_PATTERNS = [
      // intersect: "que pasan por", "que atraviesan", "que cruzan", "que tocan", etc.
      /\b(?:que\s+)?(?:pasan?\s+por|atraviesan?|cruzan?|tocan?|intersectan?|recorren?|bordean?)\b/i,
      // buffer: "a N km de", "dentro de N km de", "a menos de N km de", "cerca de"
      /\ba?\s*\d[\d.,]*\s*km\b.*?\bde\b/i,
      /\b(?:dentro\s+de|a\s+menos\s+de|cerca\s+de|a\s+distancia\s+de|radio\s+de)\b/i,
      // clip con preposición explícita: "de", "en" — solo si hay nombre geográfico después
      // (esto se maneja por fallback — no romper títulos simples como "Rutas de Santa Cruz")
    ];

    let obj  = name;
    let area = '';

    for (const pat of SPATIAL_PATTERNS) {
      const m = norm(name).search(pat);
      if (m > 2) {
        // Encontrado: obj = antes del match, area = después (quitando el patrón)
        const after = norm(name).replace(pat, '\x00');
        const idx   = after.indexOf('\x00');
        obj  = name.slice(0, m).trim();
        area = name.slice(name.length - (after.length - idx - 1)).trim();
        break;
      }
    }

    // Si no hubo patrón espacial, usar el nombre completo
    if (!area) {
      obj  = name;
      area = '';
    }

    function toSlug(s) {
      return norm(s)
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w && !CONECTORES.has(w))
        .join('_')
        .substring(0, 40);
    }

    const objSlug  = toSlug(obj);
    const areaSlug = toSlug(area);

    return (areaSlug ? objSlug + '-' + areaSlug : objSlug).substring(0, 80);
  }

  // ── Proyección Mercator compartida ──────────────────────────
  //
  // Núcleo matemático usado por export-canvas.js (_makeProjection)
  // y export-pdf.js (_makeProjectionMm). Centralizado acá para que
  // cualquier corrección se propague a ambos formatos de exportación.
  //
  // Devuelve: { toMerc, nwX, nwY, mercW, mercH }
  //   toMerc(lng, lat) → [x, y] en radianes Mercator
  //   nwX, nwY         → esquina noroeste en Mercator
  //   mercW, mercH     → extensión en Mercator (H siempre positivo)
  //
  // Uso en export-canvas.js:
  //   const { toMerc, nwX, nwY, mercW, mercH } = mercatorBase(bounds);
  //   lngToX = lng => ((toMerc(lng, 0)[0] - nwX) / mercW) * canvasW
  //   latToY = lat => ((nwY - toMerc(0, lat)[1]) / mercH) * canvasH
  //
  // Uso en export-pdf.js:
  //   const { toMerc, nwX, nwY, mercW, mercH } = mercatorBase(bounds);
  //   lngToX = lng => mxMm + ((toMerc(lng, 0)[0] - nwX) / mercW) * mwMm
  //   latToY = lat => myMm + ((nwY - toMerc(0, lat)[1]) / mercH) * mhMm

  function mercatorBase(bounds) {
    const toMerc = (lng, lat) => [
      lng * Math.PI / 180,
      Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)),
    ];
    const [nwX, nwY] = toMerc(bounds.w, bounds.n);
    const [seX, seY] = toMerc(bounds.e, bounds.s);
    const mercW = seX - nwX;
    const mercH = nwY - seY; // positivo: norte > sur en Mercator
    return { toMerc, nwX, nwY, seX, seY, mercW, mercH };
  }

  // ── Resolución de estilo por feature ────────────────────────────
  //
  // Usado por export-canvas.js y export-pdf.js para aplicar clasificación
  // categorizada o graduada a cada feature individual.
  // Centralizado acá para que ambos formatos se comporten idéntico.

  // Devuelve el objeto de estilo para un feature dado, aplicando
  // la clasificación si existe. Devuelve null si el feature debe omitirse
  // (categoría no visible en clasificación categorizada).
  function resolveFeatureStyle(feat, layer, cl) {
    const base = layer.style || {};
    if (!cl) return base;

    const val = feat?.properties?.[cl.field];

    if (cl.type === 'graduated') {
      const fill   = getColorForBreaks(parseFloat(val), cl.breaks, cl.paletteColors || ['#888']);
      const border = _darkenHex(fill, 0.25);
      return layer.geomType === 'line'
        ? { ...base, color: fill }
        : { ...base, color: border, fillColor: fill };
    }

    // categorized: ocultar features cuya categoría no está en el mapa
    if (!cl.colorMap?.hasOwnProperty(val)) return null;
    const fill     = cl.colorMap[val];
    const valStyle = cl.styleMap?.[val] || {};
    const border   = valStyle.color || _darkenHex(valStyle.fillColor || fill, 0.25);
    return layer.geomType === 'line'
      ? { ...base, ...valStyle, color: valStyle.color || fill }
      : { ...base, ...valStyle, color: border, fillColor: valStyle.fillColor || fill };
  }

  // Interpolación de color para clasificación graduada.
  // Replica la lógica de map.js sin depender de ella.
  function getColorForBreaks(val, breaks, colors) {
    if (!breaks?.length || isNaN(val)) return colors[0] || '#888';
    for (let i = 0; i < breaks.length - 1; i++) {
      if (val <= breaks[i + 1]) return colors[i] || colors[colors.length - 1];
    }
    return colors[colors.length - 1];
  }

  return {
    _darkenHex, _hexToRgbArr,
    _getGraticuleInterval, _graticuleCardinals, _formatDegLabel,
    niceScaleKm, kmToPixelsOnOutput, getMapScale, formatScale,
    _flatCoords, _getMapMeta, hexToRgb,
    escHtml, downloadBlob, sanitizeFilename,
    mercatorBase,
    resolveFeatureStyle, getColorForBreaks,
  };

})();
