/**
 * export-pdf.js — PDF idéntico al JPEG pero con texto/vectores nativos
 * Depende de: export-utils.js, export-canvas.js
 *
 * Layout idéntico al JPEG:
 *   - Fondo blanco A4
 *   - Título helvetica bold centrado arriba (texto nativo jsPDF)
 *   - Mapa rasterizado (basemap + capas) embebido como imagen
 *   - Borde del mapa
 *   - Grilla de coordenadas (paths jsPDF)
 *   - Leyenda completa: items, Fuente, separador, EPSG·escala, separador, Casux (paths y texto jsPDF)
 *   - Sin footer
 */

window.EXPORT_PDF = (() => {

  const _u = () => window.EXPORT_UTILS;
  const _c = () => window.EXPORT_CANVAS;

  const _getGraticuleInterval = (...a) => _u()._getGraticuleInterval(...a);
  const _graticuleCardinals   = (...a) => _u()._graticuleCardinals(...a);
  const _formatDegLabel       = (...a) => _u()._formatDegLabel(...a);
  const getMapScale           = (...a) => _u().getMapScale(...a);
  const formatScale           = (...a) => _u().formatScale(...a);
  const _getMapMeta           = (...a) => _u()._getMapMeta(...a);
  const hexToRgb              = (...a) => _u().hexToRgb(...a);
  const _flatCoords           = (...a) => _u()._flatCoords(...a);
  const sanitizeFilename      = (...a) => _u().sanitizeFilename(...a);
  const captureLeaflet              = (...a) => _c().captureLeaflet(...a);
  const buildLegendItems            = (...a) => _c().buildLegendItems(...a);
  const mercatorBase                = (...a) => _u().mercatorBase(...a);
  const _makeProjection             = (...a) => _c()._makeProjection(...a);
  const _drawVectorLayersFromBounds = (...a) => _c()._drawVectorLayersFromBounds(...a);

  // ── Conversiones ────────────────────────────────────────────────
  // Canvas A4 a 300 DPI: 2480 × 3508 px  (S=2 aplicado en export-canvas)
  const CANVAS_W_PX = 2480;
  const PDF_W_MM    = 210;
  const PX_TO_MM    = PDF_W_MM / CANVAS_W_PX;   // ≈ 0.08468
  const S           = 2;                          // factor DPI del canvas

  const pxToMm = px => px * PX_TO_MM;

  // ── Proyección Mercator: lng/lat → mm dentro del área del mapa ──
  // Proyección Mercator → mm para el PDF.
  // Usa mercatorBase() de export-utils.js — la matemática vive ahí.
  function _makeProjectionMm(bounds, mxMm, myMm, mwMm, mhMm) {
    const { toMerc, nwX, nwY, mercW, mercH } = mercatorBase(bounds);
    return {
      lngToX: lng => mxMm + ((toMerc(lng, 0)[0] - nwX) / mercW) * mwMm,
      latToY: lat => myMm + ((nwY - toMerc(0, lat)[1]) / mercH) * mhMm,
    };
  }

  // ── Grilla de coordenadas ────────────────────────────────────────
  function _drawGraticulePDF(doc, bounds, mxMm, myMm, mwMm, mhMm, scale_m) {
    const interval = _getGraticuleInterval(scale_m);
    if (!interval) return;

    const { w: west, e: east, n: north, s: south } = bounds;
    const cards = _graticuleCardinals();
    const proj  = _makeProjectionMm(bounds, mxMm, myMm, mwMm, mhMm);

    const firstLng = Math.ceil(west  / interval) * interval;
    const firstLat = Math.ceil(south / interval) * interval;

    // Líneas punteadas
    doc.saveGraphicsState();
    doc.setDrawColor(80, 80, 80);
    doc.setGState(doc.GState({ opacity: 0.25 }));
    doc.setLineWidth(0.18);

    const dashLen = 1.2, gapLen = 1.2;
    const drawDashed = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const step = dashLen + gapLen;
      for (let d = 0; d < len; d += step) {
        const t1 = d / len, t2 = Math.min((d + dashLen) / len, 1);
        doc.line(x1 + dx * t1, y1 + dy * t1, x1 + dx * t2, y1 + dy * t2);
      }
    };

    for (let lng = firstLng; lng <= east; lng += interval) {
      const x = proj.lngToX(lng);
      if (x < mxMm || x > mxMm + mwMm) continue;
      drawDashed(x, myMm, x, myMm + mhMm);
    }
    for (let lat = firstLat; lat <= north; lat += interval) {
      const y = proj.latToY(lat);
      if (y < myMm || y > myMm + mhMm) continue;
      drawDashed(mxMm, y, mxMm + mwMm, y);
    }
    doc.restoreGraphicsState();

    // Etiquetas
    doc.setFont('courier', 'normal');
    doc.setFontSize(4.5);
    doc.setTextColor(60, 60, 60);
    const MARGIN_MM = pxToMm(8 * S);

    for (let lng = firstLng; lng <= east; lng += interval) {
      const x = proj.lngToX(lng);
      if (x < mxMm + 2 || x > mxMm + mwMm - 2) continue;
      doc.text(_formatDegLabel(lng, 'lng', cards), x, myMm + mhMm + MARGIN_MM + 1.5, { align: 'center' });
    }
    for (let lat = firstLat; lat <= north; lat += interval) {
      const y = proj.latToY(lat);
      if (y < myMm + 1.5 || y > myMm + mhMm - 1.5) continue;
      doc.text(_formatDegLabel(lat, 'lat', cards), mxMm - MARGIN_MM, y, { align: 'right', baseline: 'middle' });
    }
  }

  // ── Leyenda completa — idéntica al JPEG ─────────────────────────
  // Estructura: fondo, título, items, bloque Fuente, línea, EPSG·escala,
  // línea, "Casux"
  async function _drawLegendPDF(doc, mapInst, items, mxMm, myMm, mwMm, mhMm, scale_m, meta, mapCanvas, opciones = {}) {
    const t = k => window.I18N?.t?.(k) || k;

    // ── Paleta claro/oscuro según basemap (igual que JPEG) ─────
    const base   = opciones.basemap || window.MAP.getCurrentBase?.() || 'gray';
    const isDark = base === 'dark';

    // Fondo leyenda
    const BG_R = isDark ? 42  : 255, BG_G = isDark ? 40  : 255, BG_B = isDark ? 38  : 255;
    const BG_OPACITY     = isDark ? 0.95 : 0.93;
    const BORDER_OPACITY = 0.12;
    // Título
    const T_R = isDark ? 255 : 26,  T_G = isDark ? 255 : 24,  T_B = isDark ? 255 : 20;
    // Texto items
    const TX_R = isDark ? 255 : 51,  TX_G = isDark ? 255 : 51,  TX_B = isDark ? 255 : 51;
    const TX_OP = isDark ? 0.90 : 1;
    // Meta (fuente, EPSG)
    const M_R = isDark ? 255 : 102, M_G = isDark ? 255 : 102, M_B = isDark ? 255 : 102;
    const M_OP = isDark ? 0.60 : 1;
    // Separadores
    const L_OP = 0.10;
    // Wordmark Casux — en oscuro se vuelve blanco semitransparente
    const WM_R = isDark ? 255 : 61,  WM_G = isDark ? 255 : 82,  WM_B = isDark ? 255 : 160;
    const WM_OP = isDark ? 0.35 : 0.65;

    // ── Textos y datos ──────────────────────────────────────────
    const legendTitle  = t('legend_title')  || 'Referencias';
    const sourceLabel  = t('legend_source') || 'Fuente';
    const scaleStr     = `1:${formatScale(scale_m)}`;
    const epsgLabel    = meta.epsgLabel    || '';
    const attributions = meta.attributions || (meta.attributionText ? [meta.attributionText] : []);
    const infoLine     = [epsgLabel, scaleStr].filter(Boolean).join('  ·  ');

    // ── Constantes de layout (en mm) — alineadas al JPEG ────────
    const PAD_L      = 3.73;  // 22px * S
    const PAD_V      = 3.39;  // 20px * S
    const TITLE_SZ   = 6.5;   // pt — tamaño fuente título
    const TITLE_H    = 6.1;   // 36px * S
    const ITEM_SZ    = 7.0;   // pt label items
    const ITEM_H     = 5.08;  // 30px * S (ROW_H)
    const SYM_W      = 3.05;  // 18px * S
    const SYM_GAP    = 1.69;  // 10px * S
    const META_SZ    = 5.0;   // pt para fuente/EPSG
    const META_SRC_H = 4.4;   // 26px * S
    const META_SUB_H = 3.73;  // 22px * S
    const LINE_H     = 2.71;  // 16px * S — grosor separador
    const INFO_H     = 4.4;   // 26px * S
    const BRAND_H    = 8.13;  // 32px+16px * S — alineado al canvas (BRAND_LINE_H)
    const GAP        = 2.03;  // 12px * S — alineado al canvas
    const GAP_ITEMS  = 2.03;  // = GAP
    const GAP_PRE    = 1.02;  // 6px * S — alineado al canvas
    const GAP_POST   = 2.37;  // 14px * S — alineado al canvas
    const GAP_POST1  = 1.69;  // 10px * S — alineado al canvas
    const MARGIN     = 4.0;   // mm margen del mapa

    // Medir texto real con jsPDF (igual que canvas usa ctx.measureText)
    const MAX_LABEL_MM = 45;
    const HEADER_H_MM  = 4.2;  // altura del encabezado de capa en mm

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(ITEM_SZ);
    const maxLabelMmRaw = items
      .filter(it => !it.isHeader)
      .reduce((acc, it) => Math.max(acc, doc.getTextWidth(it.label)), 0);
    const maxLabelMm    = Math.min(maxLabelMmRaw, MAX_LABEL_MM);
    const itemColW      = PAD_L + SYM_W + SYM_GAP + maxLabelMm + PAD_L;

    // Ancho mínimo para que los encabezados de capa quepan
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(ITEM_SZ);
    const maxHeaderMm = items
      .filter(it => it.isHeader)
      .reduce((acc, it) => Math.max(acc, doc.getTextWidth(it.label)), 0);
    const headerColW = PAD_L + Math.min(maxHeaderMm, MAX_LABEL_MM) + PAD_L;

    doc.setFont('courier', 'normal');
    doc.setFontSize(META_SZ);
    const maxInfoMm = Math.max(
      doc.getTextWidth(infoLine),
      attributions.length ? doc.getTextWidth(`${sourceLabel}:`) : 0,
      ...attributions.map(a => doc.getTextWidth(a))
    );
    const infoWMm = PAD_L + maxInfoMm + PAD_L;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TITLE_SZ);
    const titleWMm = doc.getTextWidth(legendTitle) + PAD_L * 2;

    const MAX_H_1COL = pxToMm(Math.round(600 * S));  // mismo umbral que canvas (~100mm a S=2)
    let cols = 1;
    let legW = Math.max(itemColW, headerColW, infoWMm, titleWMm, 32);

    // Pre-calcular líneas y alturas reales por item (wrap)
    const maxLabelColMm = legW / cols - SYM_W - SYM_GAP - PAD_L * 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(ITEM_SZ);
    const LINE_H_TEXT = ITEM_SZ * 0.35 * 2;   // interlineado ≈ 1pt leading
    const itemWrapped = items.map(it => {
      if (it.isHeader) return { lines: [it.label], h: HEADER_H_MM, isHeader: true };
      const lines = doc.splitTextToSize(it.label, maxLabelColMm);
      const h = lines.length === 1 ? ITEM_H : lines.length * LINE_H_TEXT + 1.5;
      return { lines, h };
    });
    const totalItemsH = itemWrapped.reduce((a, b) => a + b.h, 0);

    // Calcular altura total con 1 columna
    const srcBlock = attributions.length
      ? META_SUB_H + attributions.length * META_SRC_H + GAP_ITEMS / 2
      : 0;
    const singleH = PAD_V
      + TITLE_H
      + totalItemsH
      + (items.length ? GAP_ITEMS : 0)
      + srcBlock
      + GAP_POST1 + 1.0
      + INFO_H / 2
      + GAP_PRE + GAP_POST
      + BRAND_H
      + PAD_V;

    let legH = singleH;
    if (singleH > MAX_H_1COL && items.length > 2) {
      cols = 2;
      legW = Math.max(legW * 2 + PAD_L, 60);
      // Recalcular wrap con el nuevo ancho de columna
      const maxLabelCol2Mm = legW / 2 - SYM_W - SYM_GAP - PAD_L * 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ITEM_SZ);
      const pc = Math.ceil(items.length / 2);
      items.forEach((it, i) => {
        if (it.isHeader) { itemWrapped[i] = { lines: [it.label], h: HEADER_H_MM, isHeader: true }; return; }
        const lines = doc.splitTextToSize(it.label, maxLabelCol2Mm);
        const h = lines.length === 1 ? ITEM_H : lines.length * LINE_H_TEXT + 1.5;
        itemWrapped[i] = { lines, h };
      });
      const col1H = itemWrapped.slice(0, pc).reduce((a, b) => a + b.h, 0);
      const col2H = itemWrapped.slice(pc).reduce((a, b) => a + b.h, 0);
      legH = PAD_V
        + TITLE_H
        + Math.max(col1H, col2H)
        + (items.length ? GAP_ITEMS : 0)
        + srcBlock
        + GAP_POST1
        + INFO_H
        + GAP_PRE + GAP_POST
        + BRAND_H
        + PAD_V;
    }

    // ── Posicionamiento por sampleo de píxeles (igual que JPEG) ────
    // Color de fondo del basemap para el sampleo (mismo criterio que JPEG)
    const _bgColors = { gray: '#dde2e8', dark: '#1a1814', voyager: '#e8e0d8' };
    const bgColorForSample = window.EXPORT_CANVAS?.BASEMAP_BG_COLORS?.[base]
      ?? _bgColors[base]
      ?? '#dde2e8';

    const candidates = [
      { x: mxMm + mwMm - legW - MARGIN, y: myMm + mhMm - legH - MARGIN },
      { x: mxMm + MARGIN,               y: myMm + mhMm - legH - MARGIN },
      { x: mxMm + mwMm - legW - MARGIN, y: myMm + (mhMm - legH) / 2   },
      { x: mxMm + MARGIN,               y: myMm + (mhMm - legH) / 2   },
      { x: mxMm + mwMm - legW - MARGIN, y: myMm + MARGIN               },
      { x: mxMm + MARGIN,               y: myMm + MARGIN               },
    ];

    // Elegir posición sampleando píxeles del canvas, igual que en el JPEG.
    function _chooseLegendPositionPDF(candidates) {
      const OVERLAP_THRESHOLD = 0.02;

      // mapCanvas es el canvas compuesto mw_px×mh_px con basemap+vectores.
      // Las candidatas en mm → píxeles escalando por mw_px/mwMm.
      const cW = mapCanvas ? mapCanvas.width  : mw_px;
      const cH = mapCanvas ? mapCanvas.height : mh_px;
      const scaleX = cW / mwMm;
      const scaleY = cH / mhMm;

      // Construir canvas de solo-vectores (fondo transparente).
      // Cualquier píxel con alpha > 20 es definitivamente contenido vectorial.
      const vectorCanvas = document.createElement('canvas');
      vectorCanvas.width  = cW;
      vectorCanvas.height = cH;
      const vCtx = vectorCanvas.getContext('2d');
      let vectorReady = false;
      try {
        const proj = _makeProjection(bounds, cW, cH);
        if (proj) {
          _drawVectorLayersFromBounds(vCtx, activeLayers, proj, cW, cH)
            .catch(() => {});  // async pero no esperamos íconos Maki
          vectorReady = true;
        }
      } catch (e) { /* fallback */ }

      let bestCand = candidates[0], bestRatio = Infinity;
      for (const cand of candidates) {
        const sx = Math.round((cand.x - mxMm) * scaleX);
        const sy = Math.round((cand.y - myMm) * scaleY);
        const sw = Math.round(legW * scaleX);
        const sh = Math.round(legH * scaleY);
        if (sx < 0 || sy < 0 || sx + sw > cW || sy + sh > cH) continue;

        let ratio;
        if (vectorReady) {
          const imgData = vCtx.getImageData(sx, sy, sw, sh);
          const pixels  = imgData.data;
          const total   = sw * sh;
          let vectorPx  = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] > 20) vectorPx++;
          }
          ratio = vectorPx / total;
        } else if (mapCanvas) {
          // Fallback: comparar contra bgColor
          const sCtx2 = document.createElement('canvas').getContext('2d');
          sCtx2.canvas.width = sw; sCtx2.canvas.height = sh;
          sCtx2.drawImage(mapCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
          const bgRgb = (() => { const h = (bgColorForSample||'#dde2e8').replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; })();
          const imgData = sCtx2.getImageData(0, 0, sw, sh);
          const pixels = imgData.data, total = sw * sh; let nonBg = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i+3] < 10) continue;
            if (Math.abs(pixels[i]-bgRgb[0]) + Math.abs(pixels[i+1]-bgRgb[1]) + Math.abs(pixels[i+2]-bgRgb[2]) > 30) nonBg++;
          }
          ratio = nonBg / total;
        } else {
          ratio = 0;
        }

        if (ratio <= OVERLAP_THRESHOLD) return cand;
        if (ratio < bestRatio) { bestRatio = ratio; bestCand = cand; }
      }
      return bestCand;
    }

    // Posición: manual si el usuario eligió una, automática por sampleo si no.
    const MARGIN_POS_MM = pxToMm(Math.round(20 * S));
    const _posicionFijaPDF = (id) => {
      const posMap = {
        'top-left':     { x: mxMm + MARGIN_POS_MM,              y: myMm + MARGIN_POS_MM              },
        'top-right':    { x: mxMm + mwMm - legW - MARGIN_POS_MM, y: myMm + MARGIN_POS_MM              },
        'bottom-left':  { x: mxMm + MARGIN_POS_MM,              y: myMm + mhMm - legH - MARGIN_POS_MM },
        'bottom-right': { x: mxMm + mwMm - legW - MARGIN_POS_MM, y: myMm + mhMm - legH - MARGIN_POS_MM },
        'mid-left':     { x: mxMm + MARGIN_POS_MM,              y: myMm + (mhMm - legH) / 2          },
        'mid-right':    { x: mxMm + mwMm - legW - MARGIN_POS_MM, y: myMm + (mhMm - legH) / 2          },
      };
      return posMap[id] || posMap['bottom-right'];
    };
    const chosen = (opciones.leyendaPos && opciones.leyendaPos !== 'auto')
      ? _posicionFijaPDF(opciones.leyendaPos)
      : _chooseLegendPositionPDF(candidates);

    const lx = chosen.x;
    const ly = chosen.y;
    const barW = legW - PAD_L * 2;

    // ── Fondo + borde redondeado ─────────────────────────────────
    doc.setFillColor(BG_R, BG_G, BG_B);
    doc.setDrawColor(isDark ? 255 : 0, isDark ? 255 : 0, isDark ? 255 : 0);
    doc.setGState(doc.GState({ opacity: BG_OPACITY, 'stroke-opacity': BORDER_OPACITY }));
    doc.setLineWidth(0.15);
    doc.roundedRect(lx, ly, legW, legH, 1.2, 1.2, 'FD');
    doc.setGState(doc.GState({ opacity: 1, 'stroke-opacity': 1 }));

    let curY = ly + PAD_V;

    // ── Título ───────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TITLE_SZ);
    doc.setTextColor(T_R, T_G, T_B);
    doc.text(legendTitle, lx + legW / 2, curY + TITLE_SZ * 0.35, { align: 'center' });
    curY += TITLE_H;

    // ── Items ────────────────────────────────────────────────────
    const perCol = cols === 2 ? Math.ceil(items.length / 2) : items.length;
    // Acumular Y por columna (igual que colOffsets en el canvas)
    const colOffsets = [0, 0];

    items.forEach((item, i) => {
      const col    = Math.floor(i / perCol);
      const cx     = lx + PAD_L + col * (legW / cols);
      const iy     = curY + colOffsets[col];
      const { lines, h: rowH } = itemWrapped[i];

      if (item.isHeader) {
        // Nombre de la capa — misma tipografía que items no clasificados, sin negritas ni itálicas
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(ITEM_SZ);
        doc.setGState(doc.GState({ opacity: TX_OP }));
        doc.setTextColor(TX_R, TX_G, TX_B);
        doc.text(lines[0], cx, iy + rowH / 2, { baseline: 'middle' });
        doc.setGState(doc.GState({ opacity: 1 }));
        colOffsets[col] += rowH;
        return;
      }

      const symY   = iy + Math.min(SYM_W, rowH) / 2;
      const fill   = hexToRgb(item.color);
      const stroke = hexToRgb(item.strokeColor);

      if (item.geomType === 'line') {
        doc.setDrawColor(stroke.r, stroke.g, stroke.b);
        doc.setLineWidth(0.5);
        if (item.dashArray) doc.setLineDashPattern([1, 0.8], 0);
        doc.line(cx, symY, cx + SYM_W, symY);
        doc.setLineDashPattern([], 0);
      } else if (item.geomType === 'point') {
        const fo = item.fillOpacity ?? 1;
        doc.setFillColor(fill.r, fill.g, fill.b);
        doc.setDrawColor(stroke.r, stroke.g, stroke.b);
        doc.setLineWidth(0.3);
        doc.setGState(doc.GState({ opacity: fo }));
        if (item.shape === 'square') {
          doc.rect(cx, iy + (rowH - SYM_W) / 2, SYM_W, SYM_W, 'FD');
        } else {
          doc.circle(cx + SYM_W / 2, symY, SYM_W / 2 - 0.3, 'FD');
        }
        doc.setGState(doc.GState({ opacity: 1 }));
      } else {
        const fo = item.fillOpacity ?? 1;
        doc.setFillColor(fill.r, fill.g, fill.b);
        doc.setDrawColor(stroke.r, stroke.g, stroke.b);
        doc.setLineWidth(0.2);
        doc.setGState(doc.GState({ opacity: fo }));
        doc.rect(cx, iy + (rowH - SYM_W) / 2, SYM_W, SYM_W, 'FD');
        doc.setGState(doc.GState({ opacity: 1 }));
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ITEM_SZ - 1.5);
      doc.setGState(doc.GState({ opacity: TX_OP }));
      doc.setTextColor(TX_R, TX_G, TX_B);
      const textX = cx + SYM_W + SYM_GAP;
      if (lines.length === 1) {
        // Una línea: centrar verticalmente respecto al símbolo
        doc.text(lines[0], textX, iy + rowH / 2, { baseline: 'middle' });
      } else {
        // Varias líneas: alinear al top con pequeño margen (igual que canvas)
        lines.forEach((line, li) => {
          doc.text(line, textX, iy + 1.0 + li * LINE_H_TEXT, { baseline: 'top' });
        });
      }
      doc.setGState(doc.GState({ opacity: 1 }));

      colOffsets[col] += rowH;
    });

    const maxColOffset = Math.max(colOffsets[0], colOffsets[1] || 0);
    curY += items.length > 0 ? maxColOffset + GAP_ITEMS : 0;

    // ── Bloque Fuente ────────────────────────────────────────────
    if (attributions.length) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(META_SZ);
      doc.setGState(doc.GState({ opacity: M_OP }));
      doc.setTextColor(M_R, M_G, M_B);
      doc.text(`${sourceLabel}:`, lx + PAD_L, curY);
      curY += META_SUB_H;

      doc.setFont('courier', 'normal');
      for (const src of attributions) {
        doc.setTextColor(M_R, M_G, M_B);
        doc.text(src, lx + PAD_L, curY, { maxWidth: legW - PAD_L * 2 });
        curY += META_SRC_H;
      }
      curY += GAP_ITEMS / 2;  // mitad del espacio después de la última fuente
    }

    // ── Línea separadora 1 ───────────────────────────────────────
    doc.setDrawColor(isDark ? 255 : 0, isDark ? 255 : 0, isDark ? 255 : 0);
    doc.setGState(doc.GState({ 'stroke-opacity': L_OP }));
    doc.setLineWidth(0.15);
    doc.line(lx, curY, lx + legW, curY);
    doc.setGState(doc.GState({ 'stroke-opacity': 1 }));
    curY += GAP_POST1 + 1.0;  // +1mm extra antes de EPSG

    // ── EPSG · Escala numérica ────────────────────────────────────
    doc.setFont('courier', 'normal');
    doc.setFontSize(META_SZ);
    doc.setGState(doc.GState({ opacity: M_OP }));
    doc.setTextColor(M_R, M_G, M_B);
    doc.text(infoLine, lx + legW / 2, curY, { align: 'center' });
    doc.setGState(doc.GState({ opacity: 1 }));
    curY += INFO_H / 2;  // mitad del espacio después de EPSG

    // ── Línea separadora 2 ───────────────────────────────────────
    curY += GAP_PRE;  // +6px — igual que canvas
    doc.setDrawColor(isDark ? 255 : 0, isDark ? 255 : 0, isDark ? 255 : 0);
    doc.setGState(doc.GState({ 'stroke-opacity': L_OP }));
    doc.setLineWidth(0.15);
    doc.line(lx, curY, lx + legW, curY);
    doc.setGState(doc.GState({ 'stroke-opacity': 1 }));
    curY += GAP_POST;  // sin LINE_H — igual que canvas (+14px)

    // ── Wordmark "Casux" — misma imagen SVG/Fraunces que el JPEG ─
    try {
      const wmSizePx = 128; // alta resolución para PDF (downscale → nitidez a 300 DPI)
      const wmImg    = await _c().loadCasuxWordmark(wmSizePx);
      // Convertir la imagen a data URL para incrustarla en el PDF
      const tmpCanvas  = document.createElement('canvas');
      tmpCanvas.width  = wmImg.naturalWidth;
      tmpCanvas.height = wmImg.naturalHeight;
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.drawImage(wmImg, 0, 0);
      const wmData = tmpCanvas.toDataURL('image/png');
      // Escalar manteniendo proporción, altura ≈ BRAND_H
      const wmMmH  = BRAND_H - 1;
      const wmMmW  = wmMmH * (wmImg.naturalWidth / wmImg.naturalHeight);
      const wmX    = lx + (legW - wmMmW) / 2;
      doc.setGState(doc.GState({ opacity: WM_OP }));
      doc.addImage(wmData, 'PNG', wmX, curY, wmMmW, wmMmH);
      doc.setGState(doc.GState({ opacity: 1 }));
    } catch (e) {
      // Fallback: helvetica bold, sin itálica
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(WM_R, WM_G, WM_B);
      doc.setGState(doc.GState({ opacity: WM_OP }));
      doc.text('Casux', lx + legW / 2, curY + 4, { align: 'center' });
      doc.setGState(doc.GState({ opacity: 1 }));
    }

    // Retornar id de posición para que toPDF pueda posicionar la flecha de norte
    return { id: chosen?.id || 'bottom-right', lx: chosen?.x ?? 0, lw: legW };
  }

  // ── Capas vectoriales nativas ──────────────────────────────────
  const MAX_FEATURES_PDF = 5000;

  // ── Simplificación geográfica dinámica ──────────────────────────
  //
  // La tolerancia es proporcional a la escala del mapa de exportación,
  // evitando bordes destrozados en mapas de detalle (departamental, local).
  //
  // Escala de referencia:
  //   < 50.000       → sin simplificación (local, alta precisión requerida)
  //   ~ 500.000      → 0.001° ≈ 100 m   (provincial, imperceptible)
  //   ~ 5.000.000    → 0.01°  ≈ 1 km    (nacional, suave)
  //
  // Fórmula: tolerance = scale_m / 1.000.000 * 0.002
  // Factor reducido de 0.01 → 0.002 para preservar más detalle en vistas amplias.
  // Por debajo de SIMPLIFY_MIN_SCALE no se simplifica.

  const SIMPLIFY_MIN_SCALE = 50_000;

  function _toleranceForScale(scale_m) {
    if (scale_m < SIMPLIFY_MIN_SCALE) return 0;
    return (scale_m / 1_000_000) * 0.002;
  }

  function _simplifyFeature(feat, tolerance) {
    if (!tolerance || !window.turf?.simplify) return feat;
    try {
      return window.turf.simplify(feat, { tolerance, highQuality: false, mutate: false });
    } catch { return feat; }
  }

  function _drawVectorLayersPDF(doc, activeLayers, bounds, mxMm, myMm, mwMm, mhMm, scale_m) {
    const { w: west, e: east, n: north, s: south } = bounds;

    // Proyección Mercator: lng/lat → mm dentro del área del mapa
    const proj = _makeProjectionMm(bounds, mxMm, myMm, mwMm, mhMm);

    // Helper: proyectar y validar — devuelve null si el resultado no es finito
    // (ocurre con latitudes > ~85° donde Mercator diverge)
    const project = (lng, lat) => {
      const x = proj.lngToX(lng);
      const y = proj.latToY(lat);
      if (!isFinite(x) || !isFinite(y)) return null;
      return { x, y };
    };

    // Aplicar clipping path al área del mapa para que polígonos y líneas
    // que se extienden más allá del viewport no se dibujen en los márgenes.
    // jsPDF 2.5.1 no expone clip() directamente — escribimos el path PDF a mano.
    doc.saveGraphicsState();
    {
      // jsPDF trabaja en puntos internamente; scaleFactor convierte mm → pts
      const k  = doc.internal.scaleFactor;
      const pH = doc.internal.pageSize.getHeight();
      // En PDF el eje Y está invertido (origen abajo) — convertir con pageHeight
      const x1 = (mxMm        * k).toFixed(4);
      const x2 = ((mxMm + mwMm) * k).toFixed(4);
      const y1 = ((pH - myMm)        * k).toFixed(4);  // top del rect
      const y2 = ((pH - myMm - mhMm) * k).toFixed(4);  // bottom del rect
      doc.internal.write(x1+' '+y2+' m '+x2+' '+y2+' l '+x2+' '+y1+' l '+x1+' '+y1+' l h W n');
    }

    Object.values(activeLayers).forEach(layer => {
      const features = layer.geojson?.features || [];
      if (!features.length) return;

      const geomType = layer.geomType || 'polygon';
      const cl       = layer.classification;  // null si no está clasificada
      const tolerance = _toleranceForScale(scale_m);

      features.forEach(feat => {
        // Resolver estilo por feature — aplica clasificación categorizada/graduada
        const style = window.EXPORT_UTILS.resolveFeatureStyle(feat, layer, cl);
        if (!style) return; // feature oculto por clasificación categorizada

        const fill   = hexToRgb(style.fillColor || style.color || '#888888');
        const stroke = hexToRgb(style.color || '#333333');
        const fo     = style.fillOpacity ?? 0.5;
        const so     = style.opacity ?? 1;
        const fw     = style.weight ?? (geomType === 'line' ? 2 : 1);

        // Convertir weight (px Leaflet) a mm aproximado en el PDF
        const lwMm = Math.max(fw * PX_TO_MM * 2, 0.1);

        const feat2 = _simplifyFeature(feat, tolerance);
        const geom = feat2.geometry;
        if (!geom?.coordinates) return;

        doc.saveGraphicsState();

        if (geomType === 'polygon') {
          doc.setFillColor(fill.r, fill.g, fill.b);
          doc.setDrawColor(stroke.r, stroke.g, stroke.b);
          doc.setLineWidth(lwMm);
          doc.setGState(doc.GState({ opacity: fo, 'stroke-opacity': so }));

          const rings = geom.type === 'Polygon'
            ? geom.coordinates
            : geom.type === 'MultiPolygon'
              ? geom.coordinates.flat(1)
              : [];

          rings.forEach(ring => {
            const pts = ring.map(([lng, lat]) => project(lng, lat)).filter(p => p !== null);
            if (pts.length < 3) return;
            doc.lines(
              pts.slice(1).map((p, i) => [p.x - pts[i].x, p.y - pts[i].y]),
              pts[0].x, pts[0].y, [1, 1], 'FD', true
            );
          });

        } else if (geomType === 'line') {
          doc.setDrawColor(stroke.r, stroke.g, stroke.b);
          doc.setLineWidth(lwMm);
          doc.setGState(doc.GState({ 'stroke-opacity': so }));
          if (style.dashArray) {
            const parts = String(style.dashArray).split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
            if (parts.length) doc.setLineDashPattern(parts.map(p => p * PX_TO_MM * 2), 0);
          }

          const lines = geom.type === 'LineString'
            ? [geom.coordinates]
            : geom.type === 'MultiLineString'
              ? geom.coordinates
              : [];

          lines.forEach(coords => {
            const pts = coords.map(([lng, lat]) => project(lng, lat)).filter(p => p !== null);
            if (pts.length < 2) return;
            doc.lines(
              pts.slice(1).map((p, i) => [p.x - pts[i].x, p.y - pts[i].y]),
              pts[0].x, pts[0].y, [1, 1], 'S', false
            );
          });
          doc.setLineDashPattern([], 0);

        } else if (geomType === 'point') {
          const r  = Math.max((style.radius ?? 5) * PX_TO_MM * 2, 0.4);
          doc.setFillColor(fill.r, fill.g, fill.b);
          doc.setDrawColor(stroke.r, stroke.g, stroke.b);
          doc.setLineWidth(Math.max(lwMm * 0.5, 0.1));
          doc.setGState(doc.GState({ opacity: fo, 'stroke-opacity': so }));

          const pointsList = geom.type === 'MultiPoint'
            ? geom.coordinates
            : [geom.coordinates];

          pointsList.forEach(([lng, lat]) => {
            const x = proj.lngToX(lng);
            const y = proj.latToY(lat);
            // Saltar puntos fuera del área del mapa
            if (x < mxMm - r || x > mxMm + mwMm + r ||
                y < myMm - r || y > myMm + mhMm + r) return;
            if (style.shape === 'square') {
              doc.rect(x - r, y - r, r * 2, r * 2, 'FD');
            } else {
              doc.circle(x, y, r, 'FD');
            }
          });
        }

        doc.restoreGraphicsState();
      });
    });

    // Restaurar el estado gráfico anterior (elimina el clipping path)
    doc.restoreGraphicsState();
  }

  // ── Punto de entrada ────────────────────────────────────────────

  async function toPDF(opciones = {}) {
    const mapInst = window.MAP.getInstance();
    if (!mapInst) { window.TOAST.warning(t('export_no_map')); return; }

    window.TOAST.loading(t('export_loading_pdf'));

    try {
      // Cargar jsPDF
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload  = resolve;
          s.onerror = () => reject(new Error('No se pudo cargar jsPDF'));
          document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;

      // ── Capturar mapa (misma ruta que JPEG) ─────────────────────
      const { canvas: mapCanvas, bounds: exportBounds } = await captureLeaflet(mapInst, { onlyBasemap: true, basemap: opciones.basemap || null });

      // ── Crear PDF A4 ─────────────────────────────────────────────
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // ── Reproducir layout de buildA4Canvas en mm ─────────────────
      const PAD_PX     = Math.round(60 * S);           // 120 px
      const TITLE_H_PX = Math.round((44 + 28) * S);    // 144 px

      const mx_px = PAD_PX;
      const my_px = PAD_PX + TITLE_H_PX;
      const mw_px = CANVAS_W_PX - PAD_PX * 2;
      const mh_px = 3508 - PAD_PX - TITLE_H_PX - PAD_PX;

      const mxMm = pxToMm(mx_px);
      const myMm = pxToMm(my_px);
      const mwMm = pxToMm(mw_px);
      const mhMm = pxToMm(mh_px);

      // ── Fondo blanco ─────────────────────────────────────────────
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, 210, 297, 'F');

      // ── Título (texto nativo jsPDF) ──────────────────────────────
      const titulo = window.APP?.getCurrentPlan?.()?.titulo
        || document.getElementById('map-title')?.value
        || 'Mapa';
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(26, 24, 20);
      doc.text(titulo, 210 / 2, pxToMm(PAD_PX) + 5, { align: 'center' });

      // ── Mapa rasterizado (solo basemap, sin capas) ───────────────
      const imgData = mapCanvas.toDataURL('image/jpeg', 0.92);
      doc.addImage(imgData, 'JPEG', mxMm, myMm, mwMm, mhMm);

      // ── Capas vectoriales nativas ────────────────────────────────
      // Usar los mismos bounds que el basemap para alineación correcta.
      // El clipping path en _drawVectorLayersPDF restringe el dibujo al rectángulo del mapa.
      const activeLayers = window.MAP.getActiveLayers();
      const bounds = exportBounds || (() => {
        const b = mapInst.getBounds();
        return { w: b.getWest(), e: b.getEast(), s: b.getSouth(), n: b.getNorth() };
      })();

      // ── Escala desde bounds ──────────────────────────────────────
      const latC   = (bounds.n + bounds.s) / 2;
      const dLng   = bounds.e - bounds.w;
      const mW     = dLng * Math.cos(latC * Math.PI / 180) * 111319.49;
      const scale_m = (mW / mw_px) * 3779;

      _drawVectorLayersPDF(doc, activeLayers, bounds, mxMm, myMm, mwMm, mhMm, scale_m);

      // ── Borde del mapa ───────────────────────────────────────────
      doc.setDrawColor(0, 0, 0);
      doc.setGState(doc.GState({ 'stroke-opacity': 0.18 }));
      doc.setLineWidth(0.2);
      doc.rect(mxMm, myMm, mwMm, mhMm);
      doc.setGState(doc.GState({ 'stroke-opacity': 1 }));

      // ── Grilla de coordenadas ────────────────────────────────────
      // Se dibuja por defecto; se omite si opciones.grilla === false
      if (opciones.grilla !== false) {
        _drawGraticulePDF(doc, bounds, mxMm, myMm, mwMm, mhMm, scale_m);
      }

      // ── Leyenda ──────────────────────────────────────────────────
      const legendItems  = buildLegendItems(activeLayers);
      const _meta        = _getMapMeta(activeLayers);

      // Para elegir la posición de la leyenda necesitamos un canvas del área del
      // mapa (solo mw_px × mh_px) con basemap + vectores. El mapCanvas es el A4
      // completo; recortamos solo la región del mapa y dibujamos los vectores
      // proyectados a ese mismo espacio. Así el sampleo y las candidatas usan
      // el mismo sistema de coordenadas sin conversiones intermedias.
      let sampleCanvas = null;
      try {
        const proj = _makeProjection(bounds, mw_px, mh_px);
        if (proj) {
          const composite = document.createElement('canvas');
          composite.width  = mw_px;
          composite.height = mh_px;
          const cCtx = composite.getContext('2d');
          // Recortar la región del mapa desde el A4 completo
          cCtx.drawImage(mapCanvas, mx_px, my_px, mw_px, mh_px, 0, 0, mw_px, mh_px);
          await _drawVectorLayersFromBounds(cCtx, activeLayers, proj, mw_px, mh_px);
          sampleCanvas = composite;
        }
      } catch (e) {
        console.warn('[PDF] No se pudo crear canvas compuesto para sampleo de leyenda:', e.message);
      }

      const legendPosPDF = await _drawLegendPDF(doc, mapInst, legendItems, mxMm, myMm, mwMm, mhMm, scale_m, _meta, sampleCanvas, opciones);



      // Sin footer — igual que el JPEG

      // ── Guardar ──────────────────────────────────────────────────
      doc.save(sanitizeFilename(titulo || 'mapa') + '.pdf');
      window.TOAST.success(t('export_done_pdf'));
      window.ANALYTICS?.mapExported?.('pdf');

    } catch (err) {
      console.error('[EXPORT] Error PDF:', err);
      window.TOAST.error(t('export_error_pdf', { msg: err.message }));
      throw err;
    }
  }

  return { toPDF };

})();
