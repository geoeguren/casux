/**
 * export-canvas.js — Captura de mapa y composición del canvas para JPEG
 * Depende de: export-utils.js
 */

window.EXPORT_CANVAS = (() => {

  // Factor de escala DPI. Base: 150 DPI (1240×1754 px). 300 DPI → S = 2.
  const DPI = 300;
  const S   = DPI / 150;

  function _u() { return window.EXPORT_UTILS; }
  const _darkenHex          = (...a) => _u()._darkenHex(...a);
  const _hexToRgbArr        = (...a) => _u()._hexToRgbArr(...a);
  const _getGraticuleInterval = (...a) => _u()._getGraticuleInterval(...a);
  const _graticuleCardinals   = (...a) => _u()._graticuleCardinals(...a);
  const _formatDegLabel     = (...a) => _u()._formatDegLabel(...a);
  const niceScaleKm         = (...a) => _u().niceScaleKm(...a);
  const kmToPixelsOnOutput  = (...a) => _u().kmToPixelsOnOutput(...a);
  const getMapScale         = (...a) => _u().getMapScale(...a);
  const formatScale         = (...a) => _u().formatScale(...a);
  const _getMapMeta         = (...a) => _u()._getMapMeta(...a);
  const _flatCoords         = (...a) => _u()._flatCoords(...a);
  const hexToRgb            = (...a) => _u().hexToRgb(...a);

  //
  // Para agregar un basemap nuevo, definir su color de fondo en BASEMAP_BG_COLORS
  // (o en el propio catálogo window.MAP.getBasemaps() con una propiedad `exportBg`).
  // Si no se define, se usa el fallback '#e8e4de' (gris claro).

  // Colores de fondo para la exportación, indexados por la clave del basemap.
  // Centralizado acá para no hardcodear strings en múltiples lugares.
  const BASEMAP_BG_COLORS = {
    gray:    '#f2efe9',  // coincide con exportBg de CARTO Light en map.js
    dark:    '#1a1a2e',  // coincide con exportBg de CARTO Dark en map.js
    voyager: '#e8e0d8'   // coincide con exportBg de Voyager en map.js
    // Agregar nuevos basemaps acá cuando se incorporen
  };


  async function captureLeaflet(mapInst, { onlyBasemap = false, basemap = null } = {}) {
    const container = mapInst.getContainer();

    // ── Tamaño de captura fijo — proporción A4 ────────────────
    // El canvas siempre tiene las mismas dimensiones, independiente del layout.
    const EXPORT_W = 1240;  // px a 150 DPI base (S lo escala a 300 DPI)
    const EXPORT_H = 1754;

    const outW = Math.round(EXPORT_W * S);
    const outH = Math.round(EXPORT_H * S);

    const output = document.createElement('canvas');
    output.width  = outW;
    output.height = outH;
    const ctx = output.getContext('2d');
    ctx.scale(S, S);

    // ── Encuadre geográfico — vista actual del visor con margen generoso ─
    // Respeta el zoom que el usuario tiene en pantalla, pero agrega un margen
    // del 15% en todos los lados para que el mapa "respire" dentro del A4.
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const exportBounds = _calcViewBoundsWithMargin(mapInst);

    // Fondo del basemap — usar el elegido en el modal si viene, sino el activo
    const base       = basemap || window.MAP.getCurrentBase?.() || 'gray';
    const basemapDef = window.MAP.getBasemaps?.()?.[base];
    const bgColor    = basemapDef?.exportBg ?? BASEMAP_BG_COLORS[base] ?? '#e8e4de';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

    // Proyección: bounds geográficos → px del canvas de exportación
    // Usa Mercator (mismo sistema que Leaflet) para alineación correcta con tiles.
    const proj = _makeProjection(exportBounds, EXPORT_W, EXPORT_H);

    // ── Basemap: tiles ────────────────────────────────────────────
    // Si el usuario eligió un basemap distinto al activo en el visor,
    // descargamos los tiles directamente por URL — no podemos usar el DOM
    // porque muestra el basemap equivocado.
    // Si el basemap coincide con el activo, usamos el DOM (más rápido)
    // con fallback a descarga directa si la cobertura es insuficiente.
    const activeBase = window.MAP.getCurrentBase?.() || 'gray';
    const usingDifferentBase = basemap && basemap !== activeBase;

    if (usingDifferentBase) {
      // Basemap distinto al del visor → descargar tiles directamente
      await _drawExportTiles(ctx, mapInst, exportBounds, EXPORT_W, EXPORT_H, bgColor, basemap);
    } else {
      // Mismo basemap → capturar del DOM (más rápido y sin requests extra)
      await _drawBasemapReprojected(ctx, mapInst, exportBounds, EXPORT_W, EXPORT_H, bgColor);

      // Verificar cobertura — si el DOM no cubre suficiente área, descargar
      const tileImgsDom = mapInst.getContainer()
        .querySelector('.leaflet-tile-pane')
        ?.querySelectorAll('img.leaflet-tile') || [];

      let domWest = Infinity, domEast = -Infinity,
          domNorth = -Infinity, domSouth = Infinity;

      for (const img of tileImgsDom) {
        const m = (img.src || '').match(/\/(\d+)\/(\d+)\/(\d+)(?:@2x)?\.png/);
        if (!m) continue;
        const z = +m[1], x = +m[2], y = +m[3], n = Math.pow(2, z);
        const lngW = x / n * 360 - 180;
        const lngE = (x + 1) / n * 360 - 180;
        const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
        const latS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
        if (lngW < domWest)  domWest  = lngW;
        if (lngE > domEast)  domEast  = lngE;
        if (latN > domNorth) domNorth = latN;
        if (latS < domSouth) domSouth = latS;
      }

      const covW = Math.max(0, Math.min(domEast,  exportBounds.e) - Math.max(domWest,  exportBounds.w));
      const covH = Math.max(0, Math.min(domNorth, exportBounds.n) - Math.max(domSouth, exportBounds.s));
      const expW = exportBounds.e - exportBounds.w;
      const expH = exportBounds.n - exportBounds.s;
      const coverage = (expW > 0 && expH > 0) ? (covW * covH) / (expW * expH) : 0;

      if (coverage < 0.90) {
        await _drawExportTiles(ctx, mapInst, exportBounds, EXPORT_W, EXPORT_H, bgColor, null);
      }
    }

    if (!onlyBasemap) {
      await _drawVectorLayersFromBounds(ctx, activeLayers, proj, EXPORT_W, EXPORT_H);
    }

    return { canvas: output, bounds: exportBounds };
  }


  // ── Bounds para la miniatura de previa: visor exacto + aspecto A4 ─────
  // Usa el encuadre real del visor sin ninguna lógica de intersección con capas.
  // Solo ajusta el aspecto al formato A4 para que la previa sea proporcional.
  function _calcPreviewBounds(mapInst) {
    const toMercY   = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const fromMercY = y   => (Math.atan(Math.exp(y)) * 2 - Math.PI / 2) * 180 / Math.PI;
    const A4_RATIO  = 1240 / 1754;

    const b = mapInst.getBounds();
    let west  = b.getWest();
    let east  = b.getEast();
    let south = b.getSouth();
    let north = b.getNorth();

    // Solo ajustar aspecto al A4 en Mercator, sin tocar el encuadre
    const mercW  = (east - west) * Math.PI / 180;
    const mercH  = toMercY(north) - toMercY(south);
    const mercRatio = mercW / mercH;

    if (mercRatio < A4_RATIO) {
      const targetW  = mercH * A4_RATIO;
      const extraLng = (targetW - mercW) * 180 / Math.PI / 2;
      west -= extraLng;
      east += extraLng;
    } else {
      const targetH = mercW / A4_RATIO;
      const extraY  = (targetH - mercH) / 2;
      south = fromMercY(toMercY(south) - extraY);
      north = fromMercY(toMercY(north) + extraY);
    }

    return { w: west, e: east, s: south, n: north };
  }

    // ── Bounds de exportación: vista actual + margen generoso ─────
  // Toma los bounds del visor actual y los expande un 15% en todos los
  // lados (en espacio Mercator) para dar aire al mapa dentro del A4.
  function _calcViewBoundsWithMargin(mapInst) {
    const toMercY   = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const fromMercY = y   => (Math.atan(Math.exp(y)) * 2 - Math.PI / 2) * 180 / Math.PI;
    const A4_RATIO  = 1240 / 1754;

    // Base: getBounds() de Leaflet — refleja el encuadre real del visor.
    const b = mapInst.getBounds();
    let west  = b.getWest();
    let east  = b.getEast();
    let south = b.getSouth();
    let north = b.getNorth();

    // Intersección con el bbox de las capas activas:
    // Si el visor es más grande que los datos (zoom out, vista general),
    // recortar al bbox de las capas para que la exportación no tenga
    // enormes márgenes vacíos. Si el usuario hizo zoom in (visor contenido
    // dentro de los datos), respetar el encuadre exacto del visor.
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const lb = _calcLayersBoundsRaw(activeLayers);
    if (lb) {
      const viewerLargerThanLayers =
        west  <= lb.west  &&
        east  >= lb.east  &&
        south <= lb.south &&
        north >= lb.north;

      if (viewerLargerThanLayers) {
        // Visor más grande que los datos → recortar al bbox de las capas
        west  = lb.west;
        east  = lb.east;
        south = lb.south;
        north = lb.north;
      }
      // Si el visor está parcialmente fuera de los datos (scroll lateral),
      // intersectar para no exportar área vacía innecesaria
      else if (west < lb.west || east > lb.east || south < lb.south || north > lb.north) {
        const iWest  = Math.max(west,  lb.west);
        const iEast  = Math.min(east,  lb.east);
        const iSouth = Math.max(south, lb.south);
        const iNorth = Math.min(north, lb.north);
        if (iWest < iEast && iSouth < iNorth) {
          west  = iWest;
          east  = iEast;
          south = iSouth;
          north = iNorth;
        }
      }
      // Si el visor está completamente dentro de los datos (zoom in) → no tocar
    }

    // Margen: 8% del lado más corto en Mercator, uniforme en los 4 lados
    const mercW  = (east - west) * Math.PI / 180;
    const mercH  = toMercY(north) - toMercY(south);
    const pad    = Math.min(mercW, mercH) * 0.08;

    west  -= pad * 180 / Math.PI;
    east  += pad * 180 / Math.PI;
    south  = fromMercY(toMercY(south) - pad);
    north  = fromMercY(toMercY(north) + pad);

    // Ajustar aspecto al A4 en Mercator
    const newMercW  = (east - west) * Math.PI / 180;
    const newMercH  = toMercY(north) - toMercY(south);
    const mercRatio = newMercW / newMercH;

    if (mercRatio < A4_RATIO) {
      const targetW  = newMercH * A4_RATIO;
      const extraLng = (targetW - newMercW) * 180 / Math.PI / 2;
      west -= extraLng;
      east += extraLng;
    } else {
      const targetH = newMercW / A4_RATIO;
      const extraY  = (targetH - newMercH) / 2;
      south = fromMercY(toMercY(south) - extraY);
      north = fromMercY(toMercY(north) + extraY);
    }

    return { w: west, e: east, s: south, n: north };
  }

  // Devuelve el bbox raw de las capas activas sin margen ni ajuste de aspecto.
  // Retorna null si no hay capas visibles con geometría.
  function _calcLayersBoundsRaw(activeLayers) {
    let minLng =  Infinity, maxLng = -Infinity;
    let minLat =  Infinity, maxLat = -Infinity;

    Object.values(activeLayers).forEach(layer => {
      if (layer.visible === false) return;
      (layer.geojson?.features || []).forEach(f => {
        _flatCoords(f.geometry).forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        });
      });
    });

    if (!isFinite(minLng)) return null;
    return { west: minLng, east: maxLng, south: minLat, north: maxLat };
  }

  // ── Calcular bounding box de todas las capas activas visibles ──
  function _calcLayersBounds(activeLayers) {
    let minLng =  Infinity, maxLng = -Infinity;
    let minLat =  Infinity, maxLat = -Infinity;

    Object.values(activeLayers).forEach(layer => {
      if (layer.visible === false) return;
      (layer.geojson?.features || []).forEach(f => {
        const coords = _flatCoords(f.geometry);
        coords.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        });
      });
    });

    // Fallback si no hay capas — usar bounds del mapa actual
    if (!isFinite(minLng)) {
      const b = window.MAP?.getInstance?.()?.getBounds?.();
      if (b) return { w: b.getWest(), e: b.getEast(), s: b.getSouth(), n: b.getNorth() };
      return { w: -180, e: 180, s: -90, n: 90 };
    }

    // Margen inicial: 8% del extent en cada dirección
    const dLng = (maxLng - minLng) || 1;
    const dLat = (maxLat - minLat) || 1;
    const padLng = dLng * 0.08;
    const padLat = dLat * 0.08;

    let west  = minLng - padLng;
    let east  = maxLng + padLng;
    let south = minLat - padLat;
    let north = maxLat + padLat;

    // Ajustar el aspecto en espacio Mercator (no en grados).
    // En Mercator: X es proporcional a lng, Y es log(tan(...)) de lat.
    // Hay que comparar el ancho y alto en unidades Mercator para saber
    // cuánto expandir sin distorsionar.
    const A4_RATIO = 1240 / 1754;  // ancho / alto

    const toMercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const fromMercY = y => (Math.atan(Math.exp(y)) * 2 - Math.PI / 2) * 180 / Math.PI;

    const mercW = (east  - west)  * Math.PI / 180;
    const mercH = toMercY(north) - toMercY(south);
    const mercRatio = mercW / mercH;  // aspecto actual en Mercator

    if (mercRatio < A4_RATIO) {
      // Demasiado alto: expandir en X (longitud)
      const targetMercW = mercH * A4_RATIO;
      const extraLng = (targetMercW - mercW) * 180 / Math.PI / 2;
      west  -= extraLng;
      east  += extraLng;
    } else {
      // Demasiado ancho: expandir en Y (latitud, en Mercator)
      const targetMercH = mercW / A4_RATIO;
      const extraMercY  = (targetMercH - mercH) / 2;
      south = fromMercY(toMercY(south) - extraMercY);
      north = fromMercY(toMercY(north) + extraMercY);
    }

    // Segundo margen aplicado DESPUÉS del ajuste de aspecto — garantiza
    // espacio visual uniforme en el canvas final independientemente de la
    // forma del área (países largos como Chile, etc.).
    // Se aplica en espacio Mercator para que sea simétrico en el canvas.
    const PAD2 = 0.12;  // 12% adicional en cada eje Mercator
    const mercW2 = (east - west) * Math.PI / 180;
    const mercH2 = toMercY(north) - toMercY(south);
    const extraLng2 = mercW2 * PAD2 * 180 / Math.PI;
    const extraMercY2 = mercH2 * PAD2;
    west  -= extraLng2;
    east  += extraLng2;
    south = fromMercY(toMercY(south) - extraMercY2);
    north = fromMercY(toMercY(north) + extraMercY2);
  }

  // ── Proyección Mercator para el canvas de exportación ─────────
  // Devuelve funciones lngToX / latToY basadas en los bounds calculados,
  // usando la misma proyección Web Mercator que Leaflet.
  function _makeProjection(bounds, canvasW, canvasH) {
    // Proyectar las 4 esquinas a Mercator para obtener el extent en px
    const toMerc = ([lng, lat]) => {
      const x = lng * Math.PI / 180;
      const y = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
      return [x, y];
    };

    const [nwX, nwY] = toMerc([bounds.w, bounds.n]);
    const [seX, seY] = toMerc([bounds.e, bounds.s]);
    const mercW = seX - nwX;
    const mercH = nwY - seY;  // Y invertida (norte arriba)

    return {
      lngToX: lng => ((toMerc([lng, 0])[0] - nwX) / mercW) * canvasW,
      latToY: lat => ((nwY - toMerc([0, lat])[1]) / mercH) * canvasH,
      bounds, canvasW, canvasH, nwX, nwY, seX, seY, mercW, mercH,
    };
  }

  // ── Dibujar tiles para el encuadre de exportación ─────────────
  // Calcula qué tiles cubre el bounding box exportado al zoom apropiado
  // y los descarga directamente — sin depender del DOM del visor.
  async function _drawExportTiles(ctx, mapInst, bounds, canvasW, canvasH, bgColor, basemap = null) {
    const _tileBase  = basemap || window.MAP.getCurrentBase?.() || 'gray';
    const basemapDef = window.MAP.getBasemaps?.()?.[_tileBase];
    const urlTemplate = basemapDef?.url || '';
    // Usar @2x si está disponible
    const url2x = urlTemplate.replace('{r}', '@2x');
    const tileUrl = url2x !== urlTemplate ? url2x : urlTemplate.replace('{r}', '');

    if (!tileUrl) return;

    // Elegir zoom para que el canvas quede bien cubierto
    // Queremos que el ancho geográfico del export esté representado
    // por ~canvasW píxeles — despejamos el zoom de la fórmula de Leaflet.
    const dLng = bounds.e - bounds.w;
    const latCenter = (bounds.n + bounds.s) / 2;
    const zoom = Math.min(
      Math.floor(Math.log2(canvasW * 360 / (dLng * 256 * Math.cos(latCenter * Math.PI / 180)))),
      16
    );

    // Rango de tiles que cubre el extent
    const tileCount = Math.pow(2, zoom);
    const lngToTileX = lng => Math.floor((lng + 180) / 360 * tileCount);
    const latToTileY = lat => {
      const rad = lat * Math.PI / 180;
      return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * tileCount);
    };

    const txMin = lngToTileX(bounds.w);
    const txMax = lngToTileX(bounds.e);
    const tyMin = latToTileY(bounds.n);
    const tyMax = latToTileY(bounds.s);

    // Proyección: coordenadas geográficas del tile → px en el canvas
    const proj = _makeProjection(bounds, canvasW, canvasH);

    // Función para construir la URL de un tile
    const subdomains = 'abcd';
    const tileToUrl = (x, y, z) => {
      const s = subdomains[(x + y) % subdomains.length];
      return tileUrl.replace('{s}', s).replace('{z}', z).replace('{x}', x).replace('{y}', y);
    };

    // Cargar y dibujar todos los tiles en paralelo
    const tilePromises = [];
    for (let tx = txMin; tx <= txMax; tx++) {
      for (let ty = tyMin; ty <= tyMax; ty++) {
        tilePromises.push(new Promise(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            // Calcular posición del tile en el canvas
            // El tile cubre de (tx, ty) a (tx+1, ty+1) en coordenadas de tile
            const tileLngW = tx / tileCount * 360 - 180;
            const tileLngE = (tx + 1) / tileCount * 360 - 180;
            const tileLatN = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / tileCount))) * 180 / Math.PI;
            const tileLatS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + 1) / tileCount))) * 180 / Math.PI;

            const px1 = proj.lngToX(tileLngW);
            const py1 = proj.latToY(tileLatN);
            const px2 = proj.lngToX(tileLngE);
            const py2 = proj.latToY(tileLatS);

            try {
              ctx.drawImage(img, px1, py1, px2 - px1, py2 - py1);
            } catch (e) {}
            resolve();
          };
          img.onerror = () => resolve();
          img.src = tileToUrl(tx, ty, zoom);
        }));
      }
    }
    await Promise.all(tilePromises);
  }

  // ── Dibujar capas vectoriales desde bounds calculados ─────────

  // ── Dibujar basemap: tiles posicionados directamente en el encuadre de exportación
  // Para cada tile visible en el visor, calcula su posición en el canvas de
  // exportación usando sus coordenadas geográficas reales. Sin reproyección
  // aproximada — cada tile va exactamente donde corresponde.
  async function _drawBasemapReprojected(ctx, mapInst, exportBounds, canvasW, canvasH, bgColor) {
    const container = mapInst.getContainer();
    const tilePane  = container.querySelector('.leaflet-tile-pane');

    if (!tilePane) return;

    const tileImgs = tilePane.querySelectorAll('img.leaflet-tile');
    if (!tileImgs.length) return;

    // Proyección de exportación: lng/lat → px en el canvas de salida
    const eProj = _makeProjection(exportBounds, canvasW, canvasH);

    // Extraer coordenadas geográficas de cada tile desde su src URL.
    // La URL de CARTO tiene el formato .../z/x/y.png — decodificar z,x,y
    // da las coordenadas exactas del tile sin depender del DOM ni del layout.
    // Esto es inmune a transforms CSS, scroll, y posición del panel en pantalla.
    function tileUrlToGeo(src) {
      const m = src.match(/\/(\d+)\/(\d+)\/(\d+)(?:@2x)?\.png/);
      if (!m) return null;
      const z = parseInt(m[1]), x = parseInt(m[2]), y = parseInt(m[3]);
      const n = Math.pow(2, z);
      const lngW = x / n * 360 - 180;
      const lngE = (x + 1) / n * 360 - 180;
      const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
      const latS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
      return { lngW, lngE, latN, latS };
    }

    // Cargar versiones @2x en paralelo.
    // Timeout de 8s por tile para evitar cuelgues en móvil.
    const loadPromises = [...tileImgs].map(img => new Promise(resolve => {
      const geo = tileUrlToGeo(img.src || '');
      if (!geo) { resolve(null); return; }

      const src2x = (img.src || '').replace('.png', '@2x.png');

      if (src2x === img.src) {
        // Sin variante @2x — usar el img del DOM directamente
        resolve({ drawImg: img, geo });
        return;
      }

      // Cargar @2x con CORS
      const img2x = new Image();
      img2x.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve({ drawImg: img, geo }), 8000);
      img2x.onload  = () => { clearTimeout(timer); resolve({ drawImg: img2x, geo }); };
      img2x.onerror = () => { clearTimeout(timer); resolve({ drawImg: img,   geo }); };
      img2x.src = src2x;
    }));

    const results = await Promise.all(loadPromises);

    for (const result of results) {
      if (!result) continue;
      const { drawImg, geo } = result;
      if (!drawImg.complete || drawImg.naturalWidth === 0) continue;
      try {
        // Posición del tile en el canvas de exportación usando sus coords geográficas exactas
        const ex1 = eProj.lngToX(geo.lngW);
        const ey1 = eProj.latToY(geo.latN);
        const ex2 = eProj.lngToX(geo.lngE);
        const ey2 = eProj.latToY(geo.latS);
        ctx.drawImage(drawImg, ex1, ey1, ex2 - ex1, ey2 - ey1);
      } catch (e) { /* tainted — skip */ }
    }
  }

    async function _drawVectorLayersFromBounds(ctx, activeLayers, proj, canvasW, canvasH) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvasW, canvasH);
    ctx.clip();

    const byGeom = { polygon: [], line: [], point: [] };
    Object.values(activeLayers).forEach(layer => {
      if (layer.visible === false) return;
      const g = layer.geomType || 'polygon';
      if (byGeom[g]) byGeom[g].push(layer);
    });

    for (const layer of [...byGeom.polygon, ...byGeom.line, ...byGeom.point]) {
      const features = layer.geojson?.features || [];
      const cl = layer.classification;
      for (const feat of features) {
        const style = _resolveFeatureStyle(feat, layer, cl);
        if (!style) continue;
        _drawFeature(ctx, feat, layer.geomType, style, proj.lngToX, proj.latToY, canvasW, canvasH);
      }
      if (layer.geomType === 'point' && layer.style?.icon) {
        const iconKey = layer.style.icon;
        const iconColor = layer.style.iconColor || '#ffffff';
        const r = layer.style?.radius ?? 5;
        const iconPromises = features.flatMap(feat => {
          const geom = feat.geometry;
          if (!geom?.coordinates) return [];
          const pointsList = geom.type === 'MultiPoint'
            ? geom.coordinates
            : [geom.coordinates];
          return pointsList.map(coords => {
            const x = proj.lngToX(coords[0]);
            const y = proj.latToY(coords[1]);
            return _drawMakiIcon(ctx, x - r, y - r, r * 2, iconKey, iconColor);
          });
        });
        await Promise.allSettled(iconPromises);
      }
    }
    ctx.restore();
  }



  // ── Tiles de alta resolución: @2x + zoom+1 ───────────────────
  //
  // Crea un tileLayer temporal con tiles @2x de CARTO (512×512px) y un nivel
  // de zoom extra. Los tiles se cargan en un container auxiliar invisible,
  // se espera su carga y se dibujan sobre el canvas de salida ya escalado.
  //
  // El visor principal no se toca — todo ocurre en un mapa auxiliar oculto.

  async function _drawHiResTiles(ctx, mapInst, w, h) {
    const container  = mapInst.getContainer();
    const tilePane   = container.querySelector('.leaflet-tile-pane');
    if (!tilePane) return;

    // Posición del container en el viewport — referencia absoluta
    const cRect = container.getBoundingClientRect();

    const tileImgs = tilePane.querySelectorAll('img.leaflet-tile');
    if (!tileImgs.length) return;

    // Posición de cada tile: getBoundingClientRect relativo al container.
    // Capturamos las posiciones ANTES del await para que el layout no cambie.
    // Tamaño real del tile en CSS px (puede diferir de 256 según la config de Leaflet)
    const firstRect = tileImgs[0].getBoundingClientRect();
    const tileSize  = Math.round(firstRect.width) || 256;

    const loadPromises = [...tileImgs].map(img => {
      const tRect = img.getBoundingClientRect();
      const x = tRect.left - cRect.left;
      const y = tRect.top  - cRect.top;

      return new Promise(resolve => {
        const originalSrc = img.src || '';
        const src2x = originalSrc.replace('.png', '@2x.png');

        if (src2x === originalSrc) {
          resolve({ drawImg: img, x, y });
          return;
        }

        const img2x = new Image();
        img2x.crossOrigin = 'anonymous';
        img2x.onload  = () => resolve({ drawImg: img2x, x, y });
        img2x.onerror = () => resolve({ drawImg: img,   x, y }); // fallback
        img2x.src = src2x;
      });
    });

    const results = await Promise.all(loadPromises);

    for (const { drawImg, x, y } of results) {
      try {
        // Dibujar al tamaño real del tile en CSS px
        ctx.drawImage(drawImg, x, y, tileSize, tileSize);
      } catch (e) { /* tainted — skip */ }
    }
  }

  // Fallback: capturar los tiles del DOM tal como están (resolución de pantalla)
  function _drawDomTiles(ctx, mapInst, w, h) {
    const container = mapInst.getContainer();
    const tilePane  = container.querySelector('.leaflet-tile-pane');
    if (!tilePane) return;
    const cRect    = container.getBoundingClientRect();
    const tileImgs = tilePane.querySelectorAll('img.leaflet-tile');
    const tileSize  = tileImgs.length ? Math.round(tileImgs[0].getBoundingClientRect().width) || 256 : 256;
    for (const img of tileImgs) {
      if (!img.complete || img.naturalWidth === 0) continue;
      try {
        const tRect = img.getBoundingClientRect();
        const x = tRect.left - cRect.left;
        const y = tRect.top  - cRect.top;
        ctx.drawImage(img, x, y, tileSize, tileSize);
      } catch (e) { /* tainted — skip */ }
    }
  }

  // Proyecta y dibuja todas las capas activas directamente en el canvas,
  // usando los bounds de Leaflet como sistema de referencia.
  async function _drawVectorLayers(ctx, mapInst, w, h) {
    // Proyección usando el sistema de Leaflet (Mercator via latLngToContainerPoint).
    // Crítico: debe ser el mismo sistema que usa Leaflet para posicionar los tiles,
    // de lo contrario capas y mapa base quedan desalineados.
    const lngToX = lng => mapInst.latLngToContainerPoint([0, lng]).x;
    const latToY = lat => mapInst.latLngToContainerPoint([lat, 0]).y;

    // Clip al área del mapa
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    const activeLayers = window.MAP?.getActiveLayers?.() || {};

    // Dibujar en el mismo orden que Leaflet: polígonos → líneas → puntos
    const byGeom = { polygon: [], line: [], point: [] };
    Object.values(activeLayers).forEach(layer => {
      if (layer.visible === false) return;
      const g = layer.geomType || 'polygon';
      if (byGeom[g]) byGeom[g].push(layer);
    });

    for (const layer of [...byGeom.polygon, ...byGeom.line, ...byGeom.point]) {
      const features = layer.geojson?.features || [];
      const cl       = layer.classification;

      for (const feat of features) {
        const style = _resolveFeatureStyle(feat, layer, cl);
        if (!style) continue;
        _drawFeature(ctx, feat, layer.geomType, style, lngToX, latToY, w, h);
      }

      // Íconos Maki (puntos con icon) — dibujados encima del círculo base
      if (layer.geomType === 'point') {
        const iconKey   = layer.style?.icon;
        const iconColor = layer.style?.iconColor || '#ffffff';
        if (iconKey) {
          const r = (layer.style?.radius ?? 5);
          const iconPromises = features.flatMap(feat => {
            const geom = feat.geometry;
            if (!geom?.coordinates) return [];
            const pointsList = geom.type === 'MultiPoint'
              ? geom.coordinates
              : [geom.coordinates];
            return pointsList.map(coords => {
              const x = lngToX(coords[0]);
              const y = latToY(coords[1]);
              return _drawMakiIcon(ctx, x - r, y - r, r * 2, iconKey, iconColor);
            });
          });
          await Promise.allSettled(iconPromises);
        }
      }
    }

    ctx.restore();
  }


  // Delegados a EXPORT_UTILS — fuente única para canvas y PDF
  const _resolveFeatureStyle = (...a) => window.EXPORT_UTILS.resolveFeatureStyle(...a);
  const _getColorForBreaks   = (...a) => window.EXPORT_UTILS.getColorForBreaks(...a);


  // Dibuja un feature GeoJSON en el canvas.
  function _drawFeature(ctx, feat, geomType, style, lngToX, latToY, w, h) {
    const geom = feat.geometry;
    if (!geom) return;

    ctx.save();

    if (geomType === 'polygon') {
      const fo = style.fillOpacity ?? 0.5;
      const so = style.opacity     ?? 1;
      const fw = style.weight      ?? 1;
      ctx.fillStyle   = _hexAlpha(style.fillColor || style.color || '#888', fo);
      ctx.strokeStyle = _hexAlpha(style.color     || '#333',                so);
      ctx.lineWidth   = fw * S;  // escalar grosor al DPI de salida
      _pathGeometry(ctx, geom, lngToX, latToY);
      if (fo > 0) ctx.fill('evenodd');
      if (fw > 0 && so > 0) ctx.stroke();

    } else if (geomType === 'line') {
      const so = style.opacity ?? 1;
      const fw = style.weight  ?? 2;
      ctx.strokeStyle = _hexAlpha(style.color || '#888', so);
      ctx.lineWidth   = fw * S;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      if (style.dashArray) {
        const parts = String(style.dashArray).split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        ctx.setLineDash(parts.length ? parts.map(p => p * S) : []);
      }
      _pathGeometry(ctx, geom, lngToX, latToY);
      ctx.stroke();
      ctx.setLineDash([]);

    } else if (geomType === 'point') {
      if (!geom.coordinates) { ctx.restore(); return; }
      // Normalizar: Point → array de un par, MultiPoint → array de pares
      const pointsList = geom.type === 'MultiPoint'
        ? geom.coordinates
        : [geom.coordinates];
      const r  = (style.radius ?? 5) * S;
      const fo = style.fillOpacity ?? 0.85;
      const so = style.opacity     ?? 1;
      const fw = (style.weight     ?? 1.5) * S;
      ctx.fillStyle   = _hexAlpha(style.fillColor || style.color || '#888', fo);
      ctx.strokeStyle = _hexAlpha(style.color     || '#333',                so);
      ctx.lineWidth   = fw;
      for (const coords of pointsList) {
        const x = lngToX(coords[0]);
        const y = latToY(coords[1]);
        if (style.shape === 'square') {
          ctx.fillRect  (x - r, y - r, r * 2, r * 2);
          ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }


  // Traza el path de una geometría GeoJSON (sin stroke/fill — el caller decide)
  function _pathGeometry(ctx, geom, lngToX, latToY) {
    const trace = (ring) => {
      ring.forEach(([lng, lat], i) => {
        const x = lngToX(lng), y = latToY(lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
    };
    ctx.beginPath();
    switch (geom.type) {
      case 'Polygon':
        geom.coordinates.forEach(trace); break;
      case 'MultiPolygon':
        geom.coordinates.forEach(poly => poly.forEach(trace)); break;
      case 'LineString':
        geom.coordinates.forEach(([lng, lat], i) => {
          const x = lngToX(lng), y = latToY(lat);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }); break;
      case 'MultiLineString':
        geom.coordinates.forEach(line => {
          line.forEach(([lng, lat], i) => {
            const x = lngToX(lng), y = latToY(lat);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
        }); break;
    }
  }


  // Convierte hex + alpha a rgba string
  function _hexAlpha(hex, alpha) {
    let h = (hex || '#888888').replace('#', '');
    // Expandir hex corto: #rgb → #rrggbb
    if (h.length === 3 || h.length === 4) h = h[0]+h[0] + h[1]+h[1] + h[2]+h[2];
    const r = parseInt(h.slice(0,2), 16);
    const g = parseInt(h.slice(2,4), 16);
    const b = parseInt(h.slice(4,6), 16);
    return `rgba(${r},${g},${b},${alpha ?? 1})`;
  }




  // ── Calcular scale_m desde bounds de exportación ──────────────
  // Devuelve metros reales por pixel del canvas (a 96 DPI base).
  function _calcScaleFromBounds(bounds, canvasWPx) {
    const latCenter = (bounds.n + bounds.s) / 2;
    const dLng = bounds.e - bounds.w;
    // Metros que representa el ancho geográfico del export
    const metersW = dLng * Math.cos(latCenter * Math.PI / 180) * 111319.49;
    // Escala = metros totales / pixels totales * (pixels por metro a 96 DPI)
    return (metersW / canvasWPx) * 3779;
  }

  // ── Graticule desde bounds calculados (no desde el visor) ─────
  function _drawGraticuleFromBounds(ctx, bounds, mx, my, mw, mh, scale_m, monoFont) {
    const interval = _getGraticuleInterval(scale_m);
    if (!interval) return;

    const west  = bounds.w ?? bounds.getWest?.()  ?? -180;
    const east  = bounds.e ?? bounds.getEast?.()  ??  180;
    const north = bounds.n ?? bounds.getNorth?.() ??   90;
    const south = bounds.s ?? bounds.getSouth?.() ??  -90;
    const cards = _graticuleCardinals();

    // Proyección Mercator para la graticule
    const proj = _makeProjection({ w: west, e: east, n: north, s: south }, mw, mh);
    const lngToX = lng => mx + proj.lngToX(lng);
    const latToY = lat => my + proj.latToY(lat);

    const firstLng = Math.ceil(west  / interval) * interval;
    const firstLat = Math.ceil(south / interval) * interval;

    ctx.save();
    ctx.beginPath();
    ctx.rect(mx, my, mw, mh);
    ctx.clip();

    ctx.strokeStyle = 'rgba(80,80,80,0.25)';
    ctx.lineWidth   = Math.round(1.5 * S);
    ctx.setLineDash([Math.round(6*S), Math.round(6*S)]);

    for (let lng = firstLng; lng <= east; lng += interval) {
      const x = lngToX(lng);
      ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my + mh); ctx.stroke();
    }
    for (let lat = firstLat; lat <= north; lat += interval) {
      const y = latToY(lat);
      ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx + mw, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Etiquetas fuera del área del mapa
    ctx.font         = `${Math.round(11*S)}px ${monoFont}`;
    ctx.fillStyle    = 'rgba(60,60,60,0.7)';
    const MARGIN = 8;

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    for (let lng = firstLng; lng <= east; lng += interval) {
      const x = lngToX(lng);
      if (x < mx + 10 || x > mx + mw - 10) continue;
      ctx.fillText(_formatDegLabel(lng, 'lng', cards), x, my + mh + MARGIN + 5);
    }

    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    for (let lat = firstLat; lat <= north; lat += interval) {
      const y = latToY(lat);
      if (y < my + 10 || y > my + mh - 10) continue;
      ctx.save();
      ctx.translate(mx - MARGIN - 5, y);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(_formatDegLabel(lat, 'lat', cards), 0, 0);
      ctx.restore();
    }
  }

  async function buildA4Canvas(mapCanvas, exportBounds, opciones = {}) {
    // A4 a 300 DPI: 2480 x 3508 px
    const W = 2480, H = 3508;  // A4 a 300 DPI
    const PAD = Math.round(60 * S);

    const c = document.createElement('canvas');
    c.width  = W;
    c.height = H;
    const ctx = c.getContext('2d');

    // Cargar fuentes del proyecto
    const MONO_FONT   = await _loadMonoFont();
    const SANSFONT   = await _loadSansFont();
    // serifFont reemplazado por loadCasuxWordmark — se llama en _drawLegendOnMap

    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // ── Título centrado — DM Sans bold ───────────────────────
    // PAD es el margen uniforme: aplica igual arriba (sobre título),
    // abajo (bajo pie), izquierda y derecha (del mapa).
    const FONT_TITLE = Math.round(44 * S);
    const titulo = document.getElementById('map-title')?.value || 'Mapa';
    ctx.fillStyle    = '#1a1814';
    ctx.font         = `bold ${FONT_TITLE}px ${SANSFONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(titulo, W / 2, PAD);
    ctx.textAlign = 'left';

    // ── Layout con márgenes uniformes ─────────────────────────
    // Todos los márgenes exteriores = PAD.
    // titleH: espacio que ocupa el título (alto de fuente + aire hasta el mapa)
    // footerH: espacio desde el mapa hasta el borde inferior de la hoja
    const titleH   = Math.round((44 + 28) * S);  // título + aire generoso
    const footerH  = PAD;                         // margen inferior = PAD (igual al resto)
    const mapAreaW = W - PAD * 2;                 // márgenes laterales = PAD
    const mapAreaH = H - PAD - titleH - footerH;  // margen superior = PAD (sobre título)

    const mw = mapAreaW;
    const mh = mapAreaH;
    const mx = PAD;
    const my = PAD + titleH;

    ctx.drawImage(mapCanvas, mx, my, mw, mh);

    // Adjuntar exportBounds al canvas A4 para que _chooseLegendPosition
    // pueda reproyectar las capas vectoriales al espacio del mapa.
    if (exportBounds) c._exportBounds = exportBounds;

    // ── Borde del mapa ────────────────────────────────────────
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth   = Math.round(1.5 * S);
    ctx.strokeRect(mx, my, mw, mh);

    // ── Leyenda dentro del mapa ───────────────────────────────
    const activeLayers = window.MAP.getActiveLayers();
    const _meta        = _getMapMeta(activeLayers);

    // Calcular scale_m desde los exportBounds — independiente del zoom del visor.
    // Metros por pixel en el canvas de exportación (a 96 DPI base).
    const scale_m = exportBounds
      ? _calcScaleFromBounds(exportBounds, mw)
      : getMapScale(window.MAP.getInstance());

    // ── Grilla de coordenadas ─────────────────────────────────
    // Se dibuja por defecto; se omite si opciones.grilla === false
    if (opciones.grilla !== false) {
      _drawGraticuleFromBounds(ctx, exportBounds || window.MAP.getInstance().getBounds(), mx, my, mw, mh, scale_m, MONO_FONT);
    }

    // Construir items de la leyenda
    const legendItems = buildLegendItems(activeLayers);

    // Leyenda en la mejor posición disponible.
    // Se pasa 'c' (canvas A4 compuesto) en lugar de 'mapCanvas':
    // el sampleo de posición lee desde (mx,my,mw,mh) del A4 — coordenadas exactas
    // sin conversiones de escala. mapCanvas tiene dims distintas a mw×mh.
    const legendPos = await _drawLegendOnMap(ctx, c, legendItems, mx, my, mw, mh, scale_m, MONO_FONT, _meta, opciones);

    // Footer eliminado — la info está en el recuadro de referencias

    ctx.textAlign = 'left';
    return c;
  }

  // ── Cargar DM Mono desde Google Fonts ────────────────────────
  // Inyecta un @font-face y espera a que el browser la tenga lista.


  async function _loadMonoFont() {
    const FAMILY = 'DM Mono';
    const FALLBACK = 'Courier New, monospace';
    try {
      if (document.fonts.check(`16px "${FAMILY}"`)) return `"${FAMILY}", monospace`;
      await Promise.race([
        document.fonts.load(`16px "${FAMILY}"`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
      ]);
      return document.fonts.check(`16px "${FAMILY}"`) ? `"${FAMILY}", monospace` : FALLBACK;
    } catch {
      return FALLBACK;
    }
  }

  async function _loadSansFont() {
    const FAMILY = 'DM Sans';
    const FALLBACK = 'system-ui, sans-serif';
    try {
      if (document.fonts.check(`bold 88px "${FAMILY}"`)) return `"${FAMILY}", sans-serif`;
      await Promise.race([
        document.fonts.load(`bold 88px "${FAMILY}"`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
      ]);
      return document.fonts.check(`bold 88px "${FAMILY}"`) ? `"${FAMILY}", sans-serif` : FALLBACK;
    } catch {
      return FALLBACK;
    }
  }

  // Genera un SVG del wordmark "Casux" con Fraunces 500 embebida y lo retorna como HTMLImageElement
  async function loadCasuxWordmark(sizePx) {
    const FONT_B64 = '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';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx * 3}" height="${sizePx * 1.5}">
      <defs>
        <style>
          @font-face {
            font-family: 'FrauncesWM';
            src: url('data:font/woff2;base64,${FONT_B64}') format('woff2');
            font-weight: 500;
          }
        </style>
      </defs>
      <text
        x="50%" y="75%"
        font-family="FrauncesWM, Georgia, serif"
        font-weight="500"
        font-size="${sizePx}px"
        text-anchor="middle"
        fill="#3d52a0">Casux</text>
    </svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
      img.src = url;
    });
  }

  // ── Construir items de leyenda ────────────────────────────────
  // Devuelve array de { label, color, strokeColor, geomType, dashArray }


  function buildLegendItems(activeLayers) {
    const items = [];
    Object.values(activeLayers).reverse().forEach(layer => {
      if (layer.visible === false) return;
      const geom  = layer.geomType || 'polygon';
      const style = layer.style || {};

      if (layer.classification?.colorMap) {
        // Encabezado con el nombre de la capa antes de sus clases
        items.push({ isHeader: true, label: layer.tituloUI || layer.titulo || '' });
        Object.entries(layer.classification.colorMap).forEach(([val, color]) => {
          const vs = layer.classification.styleMap?.[val] || {};
          const fo = vs.fillOpacity ?? style.fillOpacity ?? (geom === 'polygon' ? 0.5 : 0.85);
          const op = vs.opacity     ?? style.opacity     ?? 1;
          const w  = vs.weight      ?? style.weight      ?? 1.5;
          if (geom === 'polygon' && fo === 0) return;
          if (geom !== 'polygon' && op === 0) return;
          const fill   = vs.fillColor || color;
          const stroke = geom === 'line' ? (vs.color || fill) : (vs.color || _darkenHex(fill, 0.2));
          items.push({ label: String(val), color: fill, strokeColor: stroke, geomType: geom, dashArray: vs.dashArray || style.dashArray || null, weight: w, fillOpacity: fo, opacity: op });
        });
      } else {
        const fo = style.fillOpacity ?? (geom === 'polygon' ? 0.5 : 0.85);
        const op = style.opacity     ?? 1;
        const w  = style.weight      ?? 1.5;
        if (geom === 'polygon' && fo === 0) return;
        if (geom !== 'polygon' && op === 0) return;
        const fill   = style.fillColor || style.color || '#888888';
        const stroke = geom === 'line' ? fill : (style.color || _darkenHex(fill, 0.2));
        items.push({ label: layer.tituloUI || layer.titulo || '', color: fill, strokeColor: stroke, geomType: geom, dashArray: style.dashArray || null, icon: style.icon || null, shape: style.shape || null, iconColor: style.iconColor || '#ffffff', weight: w, fillOpacity: fo, opacity: op });
      }
    });
    return items;
  }


  function _drawSymbol(ctx, x, y, size, geomType, fillColor, strokeColor, dashArray, icon, shape, weight, fillOpacity, opacity) {
    ctx.save();
    const w  = Math.min(weight ?? 1.5, 3);
    const fo = fillOpacity ?? (geomType === 'polygon' ? 0.5 : 0.85);
    const op = opacity ?? 1;

    if (geomType === 'line') {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = w * 1.5;
      ctx.globalAlpha = op;
      if (dashArray) {
        const parts = String(dashArray).split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        ctx.setLineDash(parts.length ? parts : [4,3]);
      }
      ctx.beginPath();
      ctx.moveTo(x, y + size / 2);
      ctx.lineTo(x + size, y + size / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (geomType === 'point') {
      if (shape === 'square') {
        ctx.fillStyle   = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth   = w;
        ctx.globalAlpha = fo;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.globalAlpha = op;
        ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      } else {
        // círculo (default)
        ctx.fillStyle   = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth   = w;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2 - 1, 0, Math.PI * 2);
        ctx.globalAlpha = fo;
        ctx.fill();
        ctx.globalAlpha = op;
        ctx.stroke();
      }
    } else {
      // polígono — con rx visual usando arc
      const r = Math.round(2 * S);
      const x1 = x + 1, y1 = y + 1, bw = size - 2, bh = size - 2;
      ctx.fillStyle   = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = w;
      ctx.beginPath();
      ctx.moveTo(x1 + r, y1);
      ctx.lineTo(x1 + bw - r, y1);
      ctx.arcTo(x1 + bw, y1, x1 + bw, y1 + r, r);
      ctx.lineTo(x1 + bw, y1 + bh - r);
      ctx.arcTo(x1 + bw, y1 + bh, x1 + bw - r, y1 + bh, r);
      ctx.lineTo(x1 + r, y1 + bh);
      ctx.arcTo(x1, y1 + bh, x1, y1 + bh - r, r);
      ctx.lineTo(x1, y1 + r);
      ctx.arcTo(x1, y1, x1 + r, y1, r);
      ctx.closePath();
      ctx.globalAlpha = fo;
      ctx.fill();
      ctx.globalAlpha = op;
      ctx.stroke();
    }
    ctx.restore();
  }


  async function _drawMakiIcon(ctx, x, y, size, iconKey, iconColor) {
    const MAKI_BASE = '/api/maki?icon=';
    // Intentar usar el caché de map.js primero
    const cached = window._makiSvgCache?.[iconKey]?.svgRaw;
    const color  = iconColor || '#ffffff';

    if (cached) {
      // Rasterizar SVG inline via Blob URL
      const colored  = cached
        .replace(/\bwidth="[^"]*"/, `width="${size}"`)
        .replace(/\bheight="[^"]*"/, `height="${size}"`)
        .replace(/\bfill="[^"]*"/g, `fill="${color}"`)
        .replace('<svg', `<svg fill="${color}"`);
      const blob = new Blob([colored], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, x, y, size, size);
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        img.src = url;
      });
    }

    // Fallback: fetch → blob URL (evita img-src externo bloqueado por CSP)
    return new Promise(resolve => {
      fetch(MAKI_BASE + iconKey)
        .then(r => r.ok ? r.text() : null)
        .then(raw => {
          if (!raw) { resolve(); return; }
          // Guardar en caché para usos futuros
          window._makiSvgCache = window._makiSvgCache || {};
          window._makiSvgCache[iconKey] = { svgRaw: raw, byColor: {} };
          // Colorear y rasterizar via blob URL (no requiere img-src externo)
          const colored = raw
            .replace(/\bwidth="[^"]*"/, `width="${size}"`)
            .replace(/\bheight="[^"]*"/, `height="${size}"`)
            .replace(/\bfill="[^"]*"/g, `fill="${color}"`)
            .replace('<svg', `<svg fill="${color}"`);
          const blob = new Blob([colored], { type: 'image/svg+xml' });
          const url  = URL.createObjectURL(blob);
          const img  = new Image();
          img.onload  = () => { ctx.drawImage(img, x, y, size, size); URL.revokeObjectURL(url); resolve(); };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          img.src = url;
        })
        .catch(() => resolve());
    });
  }

  // ── Medir dimensiones de la leyenda ──────────────────────────


  function _measureLegend(ctx, items, monoFont, meta) {
    const PAD_L    = Math.round(22  * S);
    const PAD_V    = Math.round(20  * S);
    const SYM_SIZE = Math.round(18  * S);
    const SYM_GAP  = Math.round(10  * S);
    const LINE_H_TEXT = Math.round(22 * S);
    const ROW_H    = Math.round(30  * S);
    const TITLE_H  = Math.round(36  * S);
    const INFO_H   = Math.round(26  * S);
    const SRC_H    = items.length ? Math.round(26 * S) : 0;
    const BRAND_H  = Math.round(58  * S);
    const GAP      = Math.round(12  * S);
    const MAX_H_1COL = Math.round(600 * S);
    const MAX_LABEL_W = Math.round(260 * S);

    // Función de wrap: parte el texto en líneas que caben en maxW
    function wrapText(text, maxW) {
      const words = text.split(' ');
      const lines = [];
      let current = '';
      for (const word of words) {
        const test = current ? current + ' ' + word : word;
        if (ctx.measureText(test).width <= maxW) {
          current = test;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : [text];
    }

    // Medir labels con wrap
    ctx.font = `${Math.round(14*S)}px sans-serif`;
    const itemLines   = items.map(it => {
      if (it.isHeader) return [it.label];
      return wrapText(it.label, MAX_LABEL_W);
    });
    const HEADER_H    = Math.round(22 * S);
    const itemHeights = items.map((it, i) =>
      it.isHeader ? HEADER_H : Math.max(ROW_H, itemLines[i].length * LINE_H_TEXT + Math.round(8*S))
    );
    const totalItemsH = itemHeights.reduce((a, b) => a + b, 0);

    // Ancho real del label (sin superar el máximo) — excluir headers del cálculo de símbolo
    ctx.font = `${Math.round(14*S)}px sans-serif`;
    const maxHeaderW = items
      .filter(it => it.isHeader)
      .reduce((acc, it) => Math.max(acc, ctx.measureText(it.label).width), 0);

    ctx.font = `${Math.round(14*S)}px sans-serif`;
    const maxLabelW = Math.min(
      Math.max(
        items.filter(it => !it.isHeader).reduce((acc, it) => Math.max(acc, ctx.measureText(it.label).width), 0),
        maxHeaderW
      ),
      MAX_LABEL_W
    );

    // Medir info lines
    ctx.font = `${Math.round(13*S)}px ${monoFont}`;
    const scaleStr       = meta.scaleStr  || '';
    const epsgStr        = meta.epsgLabel || '';
    const attributions   = meta.attributions || (meta.sourceStr ? [meta.sourceStr] : []);
    const sourceLabelStr = meta.sourceLabel || 'Fuente';
    const infoLine       = [epsgStr, scaleStr].filter(Boolean).join('  ·  ');
    const srcSubtitle    = attributions.length ? `${sourceLabelStr}:` : '';

    // Math.max seguro — siempre al menos 0 como base
    const maxInfoW = [
      infoLine    ? ctx.measureText(infoLine).width    : 0,
      srcSubtitle ? ctx.measureText(srcSubtitle).width : 0,
      ...attributions.map(a => ctx.measureText(a).width)
    ].reduce((a, b) => Math.max(a, b), 0);

    ctx.font = `bold ${Math.round(18*S)}px sans-serif`;
    const titleW = ctx.measureText(meta.legendTitle || 'Referencias').width;

    const itemW = PAD_L + SYM_SIZE + SYM_GAP + maxLabelW + PAD_L;
    const infoW = PAD_L + maxInfoW + PAD_L;
    const minW  = Math.max(itemW, infoW, titleW + PAD_L * 2, Math.round(260 * S));

    const nSrc         = attributions.length;
    const SRC_SUB      = nSrc ? Math.round(22 * S) : 0;
    const srcLinesH    = nSrc * SRC_H;
    const LINE_H       = Math.round(16 * S);
    const BRAND_LINE_H = Math.round(32 * S) + Math.round(16 * S);
    const srcBlock     = nSrc ? SRC_SUB + srcLinesH + Math.round(8*S) : 0;

    const singleColH = PAD_V + TITLE_H
      + (items.length ? totalItemsH + GAP : 0)
      + srcBlock
      + LINE_H + INFO_H + Math.round(6*S)
      + LINE_H + BRAND_LINE_H
      + PAD_V;

    let cols    = 1;
    let legendW = minW;
    let legendH = singleColH;

    if (singleColH > MAX_H_1COL && items.length > 2) {
      cols = 2;
      const perCol    = Math.ceil(items.length / 2);
      const halfItemsH = itemHeights.slice(0, perCol).reduce((a, b) => a + b, 0);
      legendH = PAD_V + TITLE_H
        + halfItemsH + GAP
        + srcBlock
        + LINE_H + INFO_H + Math.round(6*S)
        + LINE_H + BRAND_LINE_H
        + PAD_V;
      legendW = Math.max(minW * 2 + Math.round(12*S), Math.round(400*S));
    }

    return {
      w: Math.ceil(legendW), h: Math.ceil(legendH),
      cols, ROW_H, SYM_SIZE, SYM_GAP, PAD_L, PAD_V, TITLE_H,
      INFO_H, SRC_H, SRC_SUB, BRAND_H, GAP,
      itemLines, itemHeights, LINE_H_TEXT
    };
  }

  // ── Elegir posición de la leyenda ─────────────────────────────
  // Evalúa 6 posiciones en orden de preferencia, samplea el canvas del mapa


  function _chooseLegendPosition(mapCanvas, mx, my, mw, mh, legW, legH, bgColor) {
    const MARGIN = Math.round(20 * 2); // margen interior respecto al borde del mapa (300 DPI)

    // Una posición se considera libre si menos del 2% de sus píxeles
    // tienen contenido vectorial encima.
    const OVERLAP_THRESHOLD = 0.02;

    const positions = [
      { id: 'bottom-right', x: mx + mw - legW - MARGIN, y: my + mh - legH - MARGIN },
      { id: 'bottom-left',  x: mx + MARGIN,              y: my + mh - legH - MARGIN },
      { id: 'mid-right',    x: mx + mw - legW - MARGIN, y: my + (mh - legH) / 2    },
      { id: 'mid-left',     x: mx + MARGIN,              y: my + (mh - legH) / 2    },
      { id: 'top-right',    x: mx + mw - legW - MARGIN, y: my + MARGIN              },
      { id: 'top-left',     x: mx + MARGIN,              y: my + MARGIN              },
    ];

    // Crear un canvas auxiliar con SOLO las capas vectoriales sobre fondo transparente.
    // Cualquier píxel opaco en este canvas es definitivamente un vector — sin ambigüedad
    // con los tiles del basemap que tienen colores muy variados.
    const activeLayers = window.MAP?.getActiveLayers?.() || {};
    const vectorCanvas = document.createElement('canvas');
    vectorCanvas.width  = mw;
    vectorCanvas.height = mh;
    const vCtx = vectorCanvas.getContext('2d');
    // Fondo completamente transparente — no limpiar con fillRect
    // _drawVectorLayersFromBounds necesita los bounds del export para proyectar
    // Obtenemos el exportBounds desde el último captureLeaflet vía closure del canvas
    // Si no está disponible, fallback a sampleo contra bgColor
    let vectorReady = false;
    try {
      // mapCanvas tiene dimensiones A4 (2480×3508); el área del mapa empieza en (mx,my)
      // con tamaño (mw,mh). Necesitamos los exportBounds para proyectar correctamente.
      // Los pasamos desde buildA4Canvas como atributo del canvas.
      const exportBounds = mapCanvas._exportBounds;
      if (exportBounds) {
        const proj = _makeProjection(exportBounds, mw, mh);
        // Dibujar vectores sincrónicamente (los íconos Maki son async pero no afectan
        // la posición — los polígonos y líneas son los que determinan la superposición)
        const byGeom = { polygon: [], line: [], point: [] };
        Object.values(activeLayers).forEach(layer => {
          if (layer.visible === false) return;
          const g = layer.geomType || 'polygon';
          if (byGeom[g]) byGeom[g].push(layer);
        });
        for (const layer of [...byGeom.polygon, ...byGeom.line, ...byGeom.point]) {
          const features = layer.geojson?.features || [];
          const cl = layer.classification;
          for (const feat of features) {
            const style = window.EXPORT_UTILS.resolveFeatureStyle(feat, layer, cl);
            if (!style) continue;
            _drawFeature(vCtx, feat, layer.geomType, style, proj.lngToX, proj.latToY, mw, mh);
          }
        }
        vectorReady = true;
      }
    } catch (e) {
      // fallback silencioso
    }

    let bestRatio = Infinity, bestPos = positions[0];

    for (const pos of positions) {
      const sx = Math.round(pos.x - mx);
      const sy = Math.round(pos.y - my);
      const sw = Math.round(legW);
      const sh = Math.round(legH);

      if (sx < 0 || sy < 0 || sx + sw > mw || sy + sh > mh) continue;

      let ratio;

      if (vectorReady) {
        // Samplear el canvas de vectores: contar píxeles con alpha > 20
        const imgData = vCtx.getImageData(sx, sy, sw, sh);
        const pixels  = imgData.data;
        const total   = sw * sh;
        let vectorPx  = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 20) vectorPx++;
        }
        ratio = vectorPx / total;
      } else {
        // Fallback: comparar contra bgColor del basemap
        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width  = sw;
        sampleCanvas.height = sh;
        const sCtx = sampleCanvas.getContext('2d');
        sCtx.drawImage(mapCanvas, mx + sx, my + sy, sw, sh, 0, 0, sw, sh);
        const bgRgb   = _hexToRgbArr(bgColor || '#e8e4de');
        const imgData = sCtx.getImageData(0, 0, sw, sh);
        const pixels  = imgData.data;
        const total   = sw * sh;
        let nonBg     = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] < 10) continue;
          const dr = Math.abs(pixels[i]     - bgRgb[0]);
          const dg = Math.abs(pixels[i + 1] - bgRgb[1]);
          const db = Math.abs(pixels[i + 2] - bgRgb[2]);
          if (dr + dg + db > 30) nonBg++;
        }
        ratio = nonBg / total;
      }

      if (ratio <= OVERLAP_THRESHOLD) {
        return { x: pos.x, y: pos.y, id: pos.id };
      }
      if (ratio < bestRatio) { bestRatio = ratio; bestPos = pos; }
    }

    return { x: bestPos.x, y: bestPos.y, id: 'fallback' };
  }

  // Canvas (JPEG)
  function drawGraticuleCanvas(ctx, mapInst, mx, my, mw, mh, scale_m, monoFont) {
    const interval = _getGraticuleInterval(scale_m);
    if (!interval) return;

    const bounds = mapInst.getBounds();
    const west   = bounds.getWest(),  east  = bounds.getEast();
    const south  = bounds.getSouth(), north = bounds.getNorth();
    const cards  = _graticuleCardinals();

    // Proyectar grado → pixel dentro del área del mapa
    const lngToX = (lng) => mx + ((lng - west)  / (east  - west))  * mw;
    const latToY = (lat) => my + ((north - lat)  / (north - south)) * mh;

    // Primer meridiano/paralelo alineado al intervalo
    const firstLng = Math.ceil(west  / interval) * interval;
    const firstLat = Math.ceil(south / interval) * interval;

    ctx.save();
    // Clip al área del mapa para que las líneas no salgan del borde
    ctx.beginPath();
    ctx.rect(mx, my, mw, mh);
    ctx.clip();

    ctx.strokeStyle = 'rgba(80,80,80,0.25)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);

    // Meridianos (líneas verticales)
    for (let lng = firstLng; lng <= east; lng += interval) {
      const x = lngToX(lng);
      ctx.beginPath();
      ctx.moveTo(x, my);
      ctx.lineTo(x, my + mh);
      ctx.stroke();
    }

    // Paralelos (líneas horizontales)
    for (let lat = firstLat; lat <= north; lat += interval) {
      const y = latToY(lat);
      ctx.beginPath();
      ctx.moveTo(mx, y);
      ctx.lineTo(mx + mw, y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();

    // Etiquetas — fuera del clip, sobre los bordes del mapa
    ctx.save();
    ctx.font         = `${Math.round(11*S)}px ${monoFont}`;
    ctx.fillStyle    = '#444444';
    ctx.textBaseline = 'middle';

    const MARGIN = 8; // px entre borde del mapa y etiqueta (300 DPI)

    // Etiquetas de meridianos — borde inferior
    ctx.textAlign = 'center';
    for (let lng = firstLng; lng <= east; lng += interval) {
      const x = lngToX(lng);
      if (x < mx + 10 || x > mx + mw - 10) continue; // evitar solapamiento con esquinas
      ctx.fillText(_formatDegLabel(lng, 'lng', cards), x, my + mh + MARGIN + 5);
    }

    // Etiquetas de paralelos — borde izquierdo (rotadas 90°)
    for (let lat = firstLat; lat <= north; lat += interval) {
      const y = latToY(lat);
      if (y < my + 8 || y > my + mh - 8) continue;
      ctx.save();
      ctx.translate(mx - MARGIN - 5, y);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(_formatDegLabel(lat, 'lat', cards), 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }


  async function _drawLegendOnMap(ctx, mapCanvas, items, mx, my, mw, mh, scale_m, monoFont, meta, opciones = {}) {
    // ── Determinar paleta (claro u oscuro) según basemap ─────────
    const base    = opciones.basemap || window.MAP.getCurrentBase?.() || 'gray';
    const isDark  = base === 'dark';

    const LEGEND_BG     = isDark ? 'rgba(42,40,38,0.95)'      : 'rgba(255,255,255,0.93)';
    const LEGEND_BORDER = isDark ? 'rgba(255,255,255,0.12)'   : 'rgba(0,0,0,0.12)';
    const COLOR_TITLE   = isDark ? '#ffffff'                   : '#1a1814';
    const COLOR_TEXT    = isDark ? 'rgba(255,255,255,0.90)'   : '#333333';
    const COLOR_META    = isDark ? 'rgba(255,255,255,0.60)'   : '#666666';
    const COLOR_BRAND   = isDark ? 'rgba(255,255,255,0.35)'   : 'rgba(0,0,0,0.30)';
    const COLOR_LINE    = isDark ? 'rgba(255,255,255,0.12)'   : 'rgba(0,0,0,0.10)';
    const BAR_FILL      = isDark ? '#ffffff'                   : '#333333';
    const BAR_EMPTY     = isDark ? 'rgba(255,255,255,0.25)'   : 'rgba(0,0,0,0.12)';
    const BAR_BORDER    = isDark ? 'rgba(255,255,255,0.60)'   : '#333333';

    // ── Textos localizados ────────────────────────────────────────
    const t = (k, fb) => window.I18N?.t?.(k) || fb;
    const legendTitle = t('legend_title', 'Referencias');
    const sourceLabel = t('legend_source', 'Fuente');

    // Escala numérica y EPSG
    const scaleStr  = `1:${formatScale(scale_m)}`;
    const epsgLabel = meta.epsgLabel || '';
    const sourceStr = meta.attributionText || '';

    // ── Medir ─────────────────────────────────────────────────────
    const attributions  = meta.attributions || (sourceStr ? [sourceStr] : []);
    const metaForMeasure = { scaleStr, epsgLabel, attributions, sourceLabel, legendTitle };
    const dims = _measureLegend(ctx, items, monoFont, metaForMeasure);
    const { w: legW, h: legH, cols, ROW_H, SYM_SIZE, SYM_GAP, PAD_L, PAD_V, TITLE_H, INFO_H, SRC_H, SRC_SUB, BRAND_H, GAP } = dims;

    const bgDef   = window.MAP.getBasemaps?.()?.[base];
    const bgColor = bgDef?.exportBg ?? BASEMAP_BG_COLORS[base] ?? '#e8e4de';

    // Posición: manual si el usuario eligió una, automática por sampleo si no.
    const MARGIN_POS = Math.round(20 * 2);
    const _posicionFija = (id) => {
      const posMap = {
        'top-left':     { x: mx + MARGIN_POS,              y: my + MARGIN_POS              },
        'top-right':    { x: mx + mw - legW - MARGIN_POS,  y: my + MARGIN_POS              },
        'bottom-left':  { x: mx + MARGIN_POS,              y: my + mh - legH - MARGIN_POS  },
        'bottom-right': { x: mx + mw - legW - MARGIN_POS,  y: my + mh - legH - MARGIN_POS  },
        'mid-left':     { x: mx + MARGIN_POS,              y: my + (mh - legH) / 2         },
        'mid-right':    { x: mx + mw - legW - MARGIN_POS,  y: my + (mh - legH) / 2         },
      };
      return posMap[id] || posMap['bottom-right'];
    };
    const pos = (opciones.leyendaPos && opciones.leyendaPos !== 'auto')
      ? _posicionFija(opciones.leyendaPos)
      : _chooseLegendPosition(mapCanvas, mx, my, mw, mh, legW, legH, bgColor);
    const lx  = pos.x;
    const ly  = pos.y;

    // ── Fondo + borde ─────────────────────────────────────────────
    ctx.save();
    const RADIUS = Math.round(10 * S);

    ctx.shadowColor   = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur    = Math.round(20 * S);
    ctx.shadowOffsetY = Math.round(4 * S);
    ctx.fillStyle = LEGEND_BG;
    _roundRect(ctx, lx, ly, legW, legH, RADIUS);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = LEGEND_BORDER;
    ctx.lineWidth   = Math.round(1.5 * S);
    _roundRect(ctx, lx, ly, legW, legH, RADIUS);
    ctx.stroke();

    // ── Título ────────────────────────────────────────────────────
    ctx.fillStyle    = COLOR_TITLE;
    ctx.font         = `bold ${Math.round(18*S)}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'center';
    ctx.fillText(legendTitle, lx + legW / 2, ly + PAD_V);
    ctx.textAlign = 'left';

    // ── Items ─────────────────────────────────────────────────────
    const perCol = cols === 2 ? Math.ceil(items.length / 2) : items.length;
    const iconPromises = [];

    // Acumular Y por columna para que cada fila use su altura real (multi-línea)
    const colOffsets = [0, 0];

    items.forEach((item, i) => {
      const col   = Math.floor(i / perCol);
      const colX  = lx + PAD_L + col * (legW / cols);
      const iy    = ly + PAD_V + TITLE_H + colOffsets[col];
      const lines = dims.itemLines ? dims.itemLines[i] : [item.label];
      const rowH  = dims.itemHeights ? dims.itemHeights[i] : ROW_H;

      if (item.isHeader) {
        // Nombre de la capa — misma tipografía que items no clasificados, sin negritas ni itálicas
        ctx.fillStyle    = COLOR_TEXT;
        ctx.font         = `${Math.round(14*S)}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, colX, iy + rowH / 2);
        ctx.textBaseline = 'top';
        colOffsets[col] += rowH;
        return;
      }

      _drawSymbol(ctx, colX, iy, SYM_SIZE, item.geomType, item.color, item.strokeColor, item.dashArray, item.icon, item.shape, item.weight, item.fillOpacity, item.opacity);

      if (item.icon && item.geomType === 'point') {
        iconPromises.push(_drawMakiIcon(ctx, colX, iy, SYM_SIZE, item.icon, item.iconColor));
      }

      ctx.fillStyle    = COLOR_TEXT;
      ctx.font         = `${Math.round(14*S)}px sans-serif`;
      ctx.textBaseline = 'top';
      const textX = colX + SYM_SIZE + SYM_GAP;
      const LINE_H_TEXT = dims.LINE_H_TEXT || Math.round(22 * S);
      // Centrar verticalmente si es una sola línea, alinear al top si son varias
      const textStartY = lines.length === 1
        ? iy + (SYM_SIZE - LINE_H_TEXT) / 2
        : iy + Math.round(4 * S);
      lines.forEach((line, li) => {
        ctx.fillText(line, textX, textStartY + li * LINE_H_TEXT);
      });

      colOffsets[col] += rowH;
    });

    if (iconPromises.length) await Promise.allSettled(iconPromises);

    // Cursor Y — empieza debajo de los items (columna más alta)
    const maxColOffset = Math.max(colOffsets[0], colOffsets[1] || 0);
    let curY = ly + PAD_V + TITLE_H + (items.length ? maxColOffset + GAP : 0);

    // ── Fuente ────────────────────────────────────────────────────
    if (attributions.length) {
      ctx.textBaseline = 'top';
      ctx.textAlign    = 'left';
      // Subtítulo
      ctx.fillStyle = COLOR_META;
      ctx.font      = `bold ${Math.round(12*S)}px ${monoFont}`;
      ctx.fillText(`${sourceLabel}:`, lx + PAD_L, curY);
      curY += SRC_SUB;
      // Una línea por fuente
      ctx.font = `${Math.round(13*S)}px ${monoFont}`;
      for (const src of attributions) {
        ctx.fillText(src, lx + PAD_L, curY);
        curY += SRC_H;
      }
      curY += Math.round(8 * S);
    }

    // ── Línea 1 ───────────────────────────────────────────────────
    const drawLine = y => {
      ctx.strokeStyle = COLOR_LINE;
      ctx.lineWidth   = Math.round(1.5 * S);
      ctx.beginPath();
      ctx.moveTo(lx,        y);
      ctx.lineTo(lx + legW, y);
      ctx.stroke();
    };

    drawLine(curY);
    curY += Math.round(10 * S);

    // ── EPSG · Escala numérica (centrado) ─────────────────────────
    const infoLine = [epsgLabel, scaleStr].filter(Boolean).join('  ·  ');
    ctx.fillStyle    = COLOR_META;
    ctx.font         = `${Math.round(13*S)}px ${monoFont}`;
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'center';
    ctx.fillText(infoLine, lx + legW / 2, curY);
    curY += INFO_H;

    // ── Línea 2 ───────────────────────────────────────────────────
    curY += Math.round(6 * S);
    drawLine(curY);
    curY += Math.round(14 * S);

    // ── Marca (centrado) — SVG con Fraunces embebida ─────────────
    try {
      const wmSizePx = Math.round(32 * S);
      const wmImg    = await loadCasuxWordmark(wmSizePx);
      const wmW      = wmImg.naturalWidth;
      const wmH      = wmImg.naturalHeight;
      const wmX      = lx + (legW - wmW) / 2;
      ctx.globalAlpha = 0.65;
      ctx.drawImage(wmImg, wmX, curY);
      ctx.globalAlpha = 1;
    } catch(e) {
      // Fallback a texto plano si el SVG falla
      ctx.fillStyle    = COLOR_BRAND;
      ctx.font         = `bold ${Math.round(32*S)}px Georgia, serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Casux', lx + legW / 2, curY);
    }

    ctx.textAlign = 'left';
    ctx.restore();

    // Retornar posición y dimensiones de la leyenda para que buildA4Canvas
    // pueda posicionar la flecha de norte sin superposición.
    return { id: pos.id, lx: pos.x, ly: pos.y, lw: legW, lh: legH };
  }

    // Helper: dibujar rectángulo redondeado en canvas
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x,     y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
  }

  // ── Footer mínimo ─────────────────────────────────────────────


  function _drawFooter(ctx, W, H, PAD, mx, my, mh, scale_m, monoFont, meta) {
    const PAD_H = meta._padH || PAD;
    // Sin línea separadora — el espacio en blanco es suficiente
    const fy = my + mh + Math.round(24 * S);

    // Texto: epsg · 1:escala · fuente — DM Mono, color muy suave
    const scaleStr = formatScale(scale_m);
    const parts    = [];
    if (meta.epsgLabel)       parts.push(meta.epsgLabel);
    parts.push(`1:${scaleStr}`);
    if (meta.attributionText) parts.push(meta.attributionText);
    const footerLine = parts.join('  ·  ');

    ctx.save();
    ctx.fillStyle    = '#b0aba3';
    ctx.font         = `${Math.round(11*S)}px ${monoFont}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(footerLine, W / 2, fy);
    ctx.restore();
  }





  // ── Miniatura para el modal de salida gráfica ────────────────
  // Dibuja un canvas pequeño (proporciones A4) con el color de fondo
  // del basemap seleccionado y las capas vectoriales activas.
  // Dibuja la miniatura del modal: mapa base real + capas vectoriales.
  // El canvas interno es 210×297 (A4) pero se renderiza pequeño via CSS.
  // Si basemap == basemap activo → captura tiles del DOM (instantáneo).
  // Si basemap difiere → descarga tiles por URL (red, cacheado).
  async function drawMiniPreview(canvas, activeLayers, basemap) {
    const ctx = canvas.getContext('2d');
    const w   = canvas.width;
    const h   = canvas.height;

    // Fondo de color mientras cargan los tiles
    const _bDef   = window.MAP?.getBasemaps?.()?.[basemap];
    const bgColor = _bDef?.exportBg ?? BASEMAP_BG_COLORS[basemap] ?? '#e8e4de';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (!activeLayers || !Object.keys(activeLayers).length) return;

    const mapInst = window.MAP?.getInstance();
    if (!mapInst) return;

    // Bounds — encuadre exacto del visor, ajustado al aspecto A4.
    // No se aplica la lógica de intersección con capas de _calcViewBoundsWithMargin:
    // la previa debe mostrar lo que el usuario tiene en pantalla, incluyendo
    // zonas sin datos (océano, áreas vacías), sin recortes ni expansiones.
    let bounds;
    try {
      bounds = _calcPreviewBounds(mapInst);
    } catch(e) {
      const b = mapInst.getBounds();
      bounds = { w: b.getWest(), e: b.getEast(), s: b.getSouth(), n: b.getNorth() };
    }

    // ── Mapa base ─────────────────────────────────────────────
    const activeBase = window.MAP.getCurrentBase?.() || 'gray';
    if (basemap && basemap !== activeBase) {
      // Basemap distinto al del visor → descargar tiles por URL
      await _drawExportTiles(ctx, mapInst, bounds, w, h, bgColor, basemap);
    } else {
      // Mismo basemap → capturar del DOM (más rápido)
      await _drawBasemapReprojected(ctx, mapInst, bounds, w, h, bgColor);
    }

    const proj = _makeProjection(bounds, w, h);
    if (!proj) return;

    // ── Capas vectoriales ─────────────────────────────────────
    // Escalar estilos al tamaño del canvas de miniatura
    const SCALE = Math.min(0.35, Math.max(0.15, w / 700));

    const byGeom = { polygon: [], line: [], point: [] };
    for (const layer of Object.values(activeLayers)) {
      if (layer.visible === false) continue;
      const g = layer.geomType || 'polygon';
      if (byGeom[g]) byGeom[g].push(layer);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    for (const layer of [...byGeom.polygon, ...byGeom.line, ...byGeom.point]) {
      const features = layer.geojson?.features || [];
      const cl       = layer.classification;
      const geomType = layer.geomType || 'polygon';

      for (const feat of features) {
        const baseStyle = window.EXPORT_UTILS.resolveFeatureStyle(feat, layer, cl);
        if (!baseStyle) continue;

        const style = {
          ...baseStyle,
          weight: Math.max(0.3, (baseStyle.weight ?? 1.5) * SCALE),
          radius: Math.max(1,   (baseStyle.radius ?? 5)   * SCALE * 1.5),
        };

        // Polígonos: saltear si proyectados ocupan menos de 1px² en la miniatura
        if (geomType === 'polygon') {
          const coords = _flatCoords(feat.geometry);
          if (coords.length >= 2) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const [lng, lat] of coords) {
              const px = proj.lngToX(lng), py = proj.latToY(lat);
              if (px < minX) minX = px; if (px > maxX) maxX = px;
              if (py < minY) minY = py; if (py > maxY) maxY = py;
            }
            if ((maxX - minX) * (maxY - minY) < 1) continue;
          }
        }

        // Líneas: saltear si el segmento completo es subpíxel
        if (geomType === 'line') {
          const coords = _flatCoords(feat.geometry);
          if (coords.length >= 2) {
            const x0 = proj.lngToX(coords[0][0]), y0 = proj.latToY(coords[0][1]);
            const x1 = proj.lngToX(coords[coords.length-1][0]), y1 = proj.latToY(coords[coords.length-1][1]);
            if (Math.abs(x1 - x0) < 0.5 && Math.abs(y1 - y0) < 0.5) continue;
          }
        }

        // Puntos: sin límite — un arc() por punto es trivial incluso con miles
        _drawFeature(ctx, feat, geomType, style, proj.lngToX, proj.latToY, w, h);
      }
    }
    ctx.restore();
  }

  return {
    captureLeaflet, buildA4Canvas,
    buildLegendItems, drawGraticuleCanvas,
    loadCasuxWordmark,
    BASEMAP_BG_COLORS,
    _makeProjection,
    _drawVectorLayersFromBounds,
    drawMiniPreview,
  };

})();
