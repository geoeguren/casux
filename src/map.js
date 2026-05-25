/**
 * map.js — Módulo Leaflet
 *
 * Responsabilidades:
 *   - Inicializar y destruir el mapa Leaflet
 *   - Agregar/quitar capas GeoJSON con estilos
 *   - Exponer el objeto de capas activas para el editor de estilos y exportación
 */

window.MAP = (() => {

  let leafletMap   = null;
  let activeLayers = {};  // { layerKey: { geojson, leafletLayer, style, titulo } }

  // ── Inicialización ─────────────────────────────────────────────

  function init() {
    if (leafletMap) return;

    leafletMap = L.map('leaflet-map', {
      center:    [-23, -60],
      zoom:      3,
      zoomControl: false,
      attributionControl: true,
      zoomAnimation:        true,
      zoomAnimationThreshold: 4,
      bounceAtZoomLimits:   false,
      wheelPxPerZoomLevel:  60,   // scroll más sensible
    });

    leafletMap.on('popupclose', () => { clearHighlight(); _currentPopup = null; });



    const savedBase = localStorage.getItem('sm_basemap') || 'auto';
    applyBasemap(savedBase);

    // Zoom continuo en touch (similar a Google Maps)
    // Leaflet por defecto hace zoom discreto al soltar los dedos.
    // Con este handler, el mapa escala en tiempo real durante el pinch.
    if (L.Browser.touch) {
      const container = leafletMap.getContainer();
      let _startDist = 0, _startZoom = 0;

      container.addEventListener('touchstart', e => {
        if (e.touches.length !== 2) return;
        _startDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        _startZoom = leafletMap.getZoom();
      }, { passive: true });

      container.addEventListener('touchmove', e => {
        if (e.touches.length !== 2 || !_startDist) return;
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const scale    = dist / _startDist;
        const newZoom  = _startZoom + Math.log2(scale);
        leafletMap.setZoom(newZoom, { animate: false });
      }, { passive: true });

      container.addEventListener('touchend', () => {
        _startDist = 0;
        // Snap al zoom entero más cercano con animación suave
        leafletMap.setZoom(Math.round(leafletMap.getZoom()), { animate: true, duration: 0.15 });
      }, { passive: true });
    }

    // Forzar recálculo de tamaño luego del primer paint
    setTimeout(() => leafletMap.invalidateSize(), 0);
    setTimeout(() => leafletMap.invalidateSize(), 300);
  }

  // ── Catálogo de mapas base ────────────────────────────────────

  // Catálogo de mapas base.
  // Propiedades por entrada:
  //   label    — nombre legible para la UI
  //   url      — URL de tiles Leaflet
  //   exportBg — color de fondo para exportación JPEG/PDF (los tiles no se capturan por CORS)
  //   isLight  — true si el mapa es claro (afecta el contraste de la leyenda)
  // Al agregar un basemap nuevo, definir todas las propiedades acá —
  // export.js y applyBasemap() las leen automáticamente.
  const BASEMAPS = {
    gray: {
      label:    t('basemap_gray'),
      hint:     t('basemap_hint_gray'),
      url:      'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      exportBg: '#f2efe9',
      isLight:  true
    },
    dark: {
      label:    t('basemap_dark'),
      hint:     t('basemap_hint_dark'),
      url:      'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
      exportBg: '#1a1a2e',
      isLight:  false
    },
    voyager: {
      label:    t('basemap_voyager'),
      hint:     t('basemap_hint_voyager'),
      url:      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
      exportBg: '#e8e0d8',
      isLight:  true
    }
  };

  let _baseLayer   = null;
  let _labelsLayer = null;
  let _currentBase = 'gray';
  let _showLabels  = true;

  function applyBasemap(baseKey) {
    // 'auto' = positron en día, dark en noche
    if (baseKey === 'auto') {
      const h = new Date().getHours();
      baseKey = (h >= 7 && h < 20) ? 'gray' : 'dark';
    }

    const def = BASEMAPS[baseKey] || BASEMAPS.gray;
    _currentBase = baseKey;

    // Remover capas anteriores
    if (_baseLayer)   { leafletMap.removeLayer(_baseLayer);   _baseLayer   = null; }
    if (_labelsLayer) { leafletMap.removeLayer(_labelsLayer); _labelsLayer = null; }

    _baseLayer = L.tileLayer(def.url, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains:  'abcd',
      maxZoom:     19,
      crossOrigin: 'anonymous'
    });
    _baseLayer.addTo(leafletMap);

    // Mover capas de datos por encima de los labels
    Object.values(activeLayers).forEach(l => {
      if (l.leafletLayer) l.leafletLayer.bringToFront();
    });

    localStorage.setItem('sm_basemap', baseKey === 'gray' || baseKey === 'dark' ? 'auto' : baseKey);
    localStorage.setItem('sm_labels', _showLabels ? 'true' : 'false');

    // Actualizar clase de la leyenda según luminosidad del basemap.
    // isLight viene del catálogo BASEMAPS — al agregar un basemap nuevo
    // solo hay que definirlo ahí, sin tocar este código.
    const legend = document.getElementById('map-legend');
    if (legend) {
      const isLight = def.isLight ?? true;
      legend.classList.toggle('basemap-light', isLight);
      legend.classList.toggle('basemap-dark', !isLight);
    }
  }

  function setBasemap(key)   { applyBasemap(key); }
  // TODO(labels): Feature de etiquetas sobre el mapa — pendiente de implementación.
  // Requiere una capa de tiles con labels separada (p.ej. CARTO labels overlay)
  // y lógica para alternarla con la capa base actual según el basemap activo.
  // _labelsLayer y _showLabels están reservados para cuando se retome.
  function setLabels(show)   { /* no-op: sin labels */ }
  function getCurrentBase()  { return _currentBase; }
  function getShowLabels()   { return _showLabels; }
  function hasLabels(key)    { return BASEMAPS[key]?.hasLabels ?? false; }
  function getBasemaps()     { return BASEMAPS; }

  function destroy() {
    if (leafletMap) {
      leafletMap.remove();
      leafletMap   = null;
      activeLayers = {};
    }
  }

  // ── Agregar capa ──────────────────────────────────────────────
  // mapKey:    clave única en activeLayers (puede repetirse la misma capa con distinto índice)
  // layerKey:  clave en window.LAYERS (define geomType, defaultStyle, etc.)
  // titulo:    etiqueta legible (opcional, usa layerDef.tituloUI o titulo por defecto)

  function addLayer(mapKey, layerKey, geojson, style, titulo) {
    if (!leafletMap) init();

    // Remover si ya existe esa clave
    removeLayer(mapKey);

    // Filtrar features con coordenadas inválidas (NaN, null, vacías) antes
    // de pasarlas a Leaflet — una sola coordenada inválida tira toda la capa.
    if (geojson?.features) {
      const _isValidCoord = c => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]);
      const _hasValidCoords = geom => {
        if (!geom?.coordinates) return false;
        const flat = coords => {
          if (!Array.isArray(coords)) return false;
          if (_isValidCoord(coords)) return true;
          return coords.every(flat);
        };
        return flat(geom.coordinates);
      };
      const before = geojson.features.length;
      geojson = { ...geojson, features: geojson.features.filter(f => _hasValidCoords(f?.geometry)) };
      const dropped = before - geojson.features.length;
      if (dropped > 0) console.warn(`[MAP] addLayer ${mapKey}: descartadas ${dropped} feature(s) con coordenadas inválidas.`);
    }

    const layerDef = window.LAYERS[layerKey];
    const geomType = layerDef?.geomType || 'polygon';
    // Guardar el estilo inicial para poder restaurarlo con limpiar_estilo
    const _defaultStyle = style ? { ...style } : {};

    let leafletLayer;

    if (geomType === 'point') {
      leafletLayer = L.geoJSON(geojson, {
        pointToLayer: (feat, latlng) => _pointToLayer(feat, latlng, style),
        onEachFeature: bindIdentify
      });

    } else if (geomType === 'line') {
      leafletLayer = L.geoJSON(geojson, {
        style: () => lineStyle(style),
        onEachFeature: bindIdentify
      });

    } else {
      leafletLayer = L.geoJSON(geojson, {
        style: () => polygonStyle(style),
        onEachFeature: bindIdentify
      });
    }

    leafletLayer.addTo(leafletMap);

    activeLayers[mapKey] = {
      geojson,
      leafletLayer,
      layerKey,
      geomType,
      _defaultStyle,       // estilo original para restaurar con limpiar_estilo
      style:   { ...style },
      titulo:  titulo || layerDef?.tituloUI || layerDef?.titulo || mapKey,
      visible: true
    };

    // Reordenar z-order: polígonos abajo, líneas al medio, puntos arriba
    _reorderLayers();

    if (_layersChangeCb) _layersChangeCb();
    return leafletLayer;
  }

  function removeLayer(mapKey) {
    if (activeLayers[mapKey]) {
      leafletMap.removeLayer(activeLayers[mapKey].leafletLayer);
      delete activeLayers[mapKey];
      if (_layersChangeCb) _layersChangeCb();
    }
  }

  function clearAll() {
    Object.keys(activeLayers).forEach(k => {
      leafletMap.removeLayer(activeLayers[k].leafletLayer);
      delete activeLayers[k];
    });
    if (_layersChangeCb) _layersChangeCb();
  }

  function resetView() {
    if (!leafletMap) return;
    const layers = Object.values(activeLayers).filter(l => l.visible !== false);
    if (layers.length) {
      fitBounds();
    } else {
      leafletMap.setView([-23, -60], 3);
    }
  }

  // ── Actualizar estilo de una capa ─────────────────────────────

  function updateLayerStyle(mapKey, newStyle) {
    const entry = activeLayers[mapKey];
    if (!entry) return;

    const prevStyle = { ...entry.style }; // copia — no referencia
    // Merge: si newStyle tiene una clave con valor null/undefined explícito, borrarla
    const merged = { ...entry.style };
    Object.keys(newStyle).forEach(k => {
      if (newStyle[k] === null || newStyle[k] === undefined) delete merged[k];
      else merged[k] = newStyle[k];
    });
    entry.style = merged;

    const layerDef = window.LAYERS[entry.layerKey || mapKey];
    const geomType = layerDef?.geomType || 'polygon';

    // Para puntos con DivIcon (icon Maki o shape no-circle):
    //   - Si cambia el tipo de ícono o la forma → reconstruir toda la capa (no hay otra opción)
    //   - Si solo cambia un valor visual (color, radio, opacidad…) → actualizar solo el HTML
    //     del divIcon en cada marker. Evita el rebuildLayer que antes se disparaba en CADA
    //     cambio de estilo, lo cual destruía y recreaba toda la capa innecesariamente.
    const usesDivIcon = entry.style.icon || (entry.style.shape && entry.style.shape !== 'circle');
    if (geomType === 'point' && (
      newStyle.icon  !== prevStyle.icon  ||
      newStyle.shape !== prevStyle.shape
    )) {
      // Cambió el tipo de ícono o la forma: reconstruir
      rebuildLayer(entry, mapKey);
      updateLegend();
      if (_layerStyleCallback) _layerStyleCallback(mapKey, entry.style);
      return;
    }

    if (geomType === 'point' && usesDivIcon) {
      // Mismo ícono/forma, solo cambió un valor visual: actualizar divIcon sin reconstruir
      entry.leafletLayer.eachLayer(l => {
        if (!l.setIcon) return;
        let newHtml, newSize;
        if (entry.style.icon) {
          // Ícono Maki
          const svgRaw = window._makiSvgCache[entry.style.icon]?.svgRaw || null;
          newHtml = _makiIconHtml(entry.style, svgRaw);
          newSize = Math.round((entry.style.radius ?? 12) * 2);
        } else {
          // Shape (square, etc.) — reconstruir con _shapeIcon
          const shapeIcon = _shapeIcon(entry.style);
          if (!shapeIcon) return;
          // Extraer el html del divIcon recién creado
          newHtml = shapeIcon.options.html;
          newSize = (entry.style.radius ?? 8) * 2;
        }
        l.setIcon(L.divIcon({
          html:        newHtml,
          className:   '',
          iconSize:    [newSize, newSize],
          iconAnchor:  [newSize / 2, newSize / 2],
          popupAnchor: [0, -newSize / 2]
        }));
      });
      updateLegend();
      if (_layerStyleCallback) _layerStyleCallback(mapKey, entry.style);
      return;
    }

    // Para clasificación categorizada, usar rebuildLayer para garantizar que el
    // orden de pintado de features (z-order por clase) sea correcto. eachLayer
    // con setStyle pinta en el orden original del GeoJSON, ignorando el sort por clase.
    if (entry.classification?.field && entry.classification.type === 'categorized') {
      rebuildLayer(entry, mapKey);
      updateLegend();
      if (_layerStyleCallback) _layerStyleCallback(mapKey, entry.style);
      return;
    }

    entry.leafletLayer.eachLayer(l => {
      if (geomType === 'point') {
        l.setStyle(pointStyle(entry.style));
      } else if (geomType === 'line') {
        l.setStyle(lineStyle(entry.style));
      } else {
        l.setStyle(polygonStyle(entry.style));
      }
    });

    // Si hay clasificación activa (graduated), re-aplicar colores por feature.
    if (entry.classification?.field) {
      const cl = entry.classification;
      entry.leafletLayer.eachLayer(l => {
        const val = l.feature?.properties?.[cl.field];
        let featureStyle;
        if (cl.type === 'graduated') {
          const fill = getColorForValue(parseFloat(val), cl.breaks, cl.paletteColors || ['#888']);
          const border = darkenHex(fill);
          featureStyle = geomType === 'line'
            ? { ...entry.style, color: fill }
            : { ...entry.style, color: border, fillColor: fill };
        }
        if (featureStyle) l.setStyle(featureStyle);
      });
    }

    updateLegend();
    if (_layerStyleCallback) _layerStyleCallback(mapKey, entry.style);
  }

  // ── Actualizar estilo por clasificación de atributo ───────────

  function updateLayerClassification(mapKey, campo, classMap) {
    const entry = activeLayers[mapKey];
    if (!entry) return;

    const layerDef = window.LAYERS[entry.layerKey || mapKey];
    const geomType = layerDef?.geomType || 'polygon';

    entry.leafletLayer.eachLayer(l => {
      const val   = l.feature?.properties?.[campo];
      const color = classMap[val];
      // Si el valor no tiene categoría asignada, ocultar el feature
      if (!classMap.hasOwnProperty(val)) {
        const hiddenStyle = geomType === 'point'
          ? { ...entry.style, radius: 0, opacity: 0, fillOpacity: 0 }
          : { ...entry.style, opacity: 0, fillOpacity: 0, weight: 0 };
        if (geomType === 'point')   l.setStyle(pointStyle(hiddenStyle));
        else if (geomType === 'line') l.setStyle(lineStyle(hiddenStyle));
        else l.setStyle(polygonStyle(hiddenStyle));
        return;
      }
      const s     = { ...entry.style, fillColor: color, color };

      if (geomType === 'point')   l.setStyle(pointStyle(s));
      else if (geomType === 'line') l.setStyle(lineStyle(s));
      else l.setStyle(polygonStyle(s));
    });
  }

  // ── Ajustar bounds ────────────────────────────────────────────

  // ── Orden de capas ────────────────────────────────────────────

  const GEOM_ORDER = { polygon: 0, line: 1, point: 2 };

  // Reaplica el z-order de Leaflet respetando el orden actual de activeLayers,
  // sin reordenar. Usar cuando una capa se reconstruye (clasificación, estilo)
  // para no pisar el orden manual del usuario.
  function _reapplyZOrder() {
    Object.values(activeLayers).forEach(layer => {
      if (layer.leafletLayer && layer.visible !== false) {
        layer.leafletLayer.bringToFront();
      }
    });
  }

  function _reorderLayers() {
    // Ordenar por geomType: polígonos abajo, líneas medio, puntos arriba
    const sorted = Object.entries(activeLayers)
      .sort((a, b) => (GEOM_ORDER[a[1].geomType] ?? 1) - (GEOM_ORDER[b[1].geomType] ?? 1));

    // Reordenar el objeto activeLayers para que la leyenda refleje el mismo orden
    Object.keys(activeLayers).forEach(k => delete activeLayers[k]);
    sorted.forEach(([k, v]) => { activeLayers[k] = v; });

    // Aplicar z-order en Leaflet (el último en bringToFront queda más arriba)
    sorted.forEach(([, layer]) => {
      if (layer.leafletLayer && layer.visible !== false) {
        layer.leafletLayer.bringToFront();
      }
    });
  }

  // Mover una capa específica dentro del orden (delta: -1 = subir, +1 = bajar)
  function moveLayer(mapKey, targetIdx) {
    const keys = Object.keys(activeLayers);
    const fromIdx = keys.indexOf(mapKey);
    if (fromIdx < 0) return;
    const clampedIdx = Math.max(0, Math.min(keys.length - 1, targetIdx));
    if (clampedIdx === fromIdx) return;

    const entries = Object.entries(activeLayers);
    const [removed] = entries.splice(fromIdx, 1);
    entries.splice(clampedIdx, 0, removed);
    Object.keys(activeLayers).forEach(k => delete activeLayers[k]);
    entries.forEach(([k, v]) => { activeLayers[k] = v; });

    // Re-aplicar z-order: el último en el array queda arriba
    Object.values(activeLayers).forEach(layer => {
      if (layer.leafletLayer && layer.visible !== false) {
        layer.leafletLayer.bringToFront();
      }
    });
    if (_layerOrderCallback) _layerOrderCallback();
  }

  function fitBounds() {
    const layers = Object.values(activeLayers);
    if (!layers.length) return;

    const group = L.featureGroup(layers.map(l => l.leafletLayer));
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      leafletMap.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  function fitToLayer(mapKey) {
    const entry = activeLayers[mapKey];
    if (!entry?.leafletLayer) return;
    try {
      const bounds = entry.leafletLayer.getBounds();
      if (bounds.isValid()) {
        leafletMap.fitBounds(bounds, { padding: [40, 40], animate: true, duration: 0.6 });
        return;
      }
    } catch {}
    // Fallback para features sin bounds válidos (ej: punto único)
    const geojson = entry.geojson;
    if (geojson?.features?.length) {
      const first = geojson.features[0]?.geometry?.coordinates;
      if (first) {
        const coords = Array.isArray(first[0]) ? first[0] : first;
        leafletMap.panTo([coords[1], coords[0]], { animate: true, duration: 0.6 });
      }
    }
  }

  // ── Leyenda ───────────────────────────────────────────────────

  function makeSVG(geom, fill, stroke, fillOpacity, weight, opacity, dashArray, style) {
    return window.LP_UTILS.geomSVG({
      geomType: geom,
      style: {
        fillColor:  fill,
        color:      stroke,
        fillOpacity: fillOpacity,
        weight:     weight,
        opacity:    opacity,
        dashArray:  dashArray || null,
        shape:      style?.shape    || null,
        icon:       style?.icon     || null,
        iconColor:  style?.iconColor || '#ffffff',
      }
    });
  }

  // Restaurar visible desde instrucciones guardadas (llamado desde app.js tras addLayer)
  function restoreLayerVisible(key, visible) {
    const layer = activeLayers[key];
    if (!layer) return;
    if (visible === false && layer.visible !== false) {
      layer.visible = false;
      if (layer.leafletLayer) leafletMap.removeLayer(layer.leafletLayer);
    }
  }

  // Popup prefs: setear desde Turso (reemplaza localStorage)
  function setPopupPrefs(prefs) {
    Object.keys(_popupFieldPrefs).forEach(k => delete _popupFieldPrefs[k]);
    Object.entries(prefs).forEach(([lk, fields]) => {
      _popupFieldPrefs[lk] = new Set(fields);
    });
  }

  function getPopupPrefs() {
    const out = {};
    Object.entries(_popupFieldPrefs).forEach(([lk, set]) => { out[lk] = [...set]; });
    return out;
  }

  function updateLegend() {
    const el = document.getElementById('map-legend');
    if (!el) return;

    const items = Object.entries(activeLayers).reverse();
    if (!items.length) { el.classList.remove('visible'); return; }

    el.classList.add('visible');
    const layerDef = k => window.LAYERS[k] || {};

    // Formatea un conteo de features de forma compacta
    function fmtCount(n) {
      if (n === undefined || n === null) return '';
      if (n >= 1000) return `${(n / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k`;
      return n.toLocaleString('es-AR');
    }

    const isCollapsed = el.classList.contains('legend-collapsed');
    el.innerHTML = `
      <div class="legend-header">
        <div class="legend-title">${t('legend_title')}</div>
        <button class="legend-collapse-btn">
          <span class="material-icons">${isCollapsed ? 'expand_less' : 'expand_more'}</span>
        </button>
      </div>
      <div class="legend-items-wrap">` +
      items.map(([key, entry]) => {
        const s           = entry.style || {};
        const geom        = entry.geomType || window.LAYERS[entry.layerKey]?.geomType || 'polygon';
        const cl          = entry.classification;
        const features    = entry.geojson?.features || [];
        const totalCount  = features.length;
        const countTag    = totalCount > 0
          ? `<span class="legend-count">${fmtCount(totalCount)}</span>`
          : '';

        // Clasificación categorizada
        if (cl?.type === 'categorized' && cl.colorMap) {
          let html = `<div class="legend-item legend-item-title">
            <span>${entry.titulo || key}</span>${countTag}
          </div>`;
          Object.entries(cl.colorMap).forEach(([val, color]) => {
            const valStyle   = cl.styleMap?.[val] || {};
            const fill       = valStyle.fillColor || color;
            const border     = valStyle.color     || (geom === 'line' ? fill : darkenHex(fill));
            const svg        = makeSVG(geom, fill, border, s.fillOpacity ?? 0.85, s.weight ?? 1.5, s.opacity ?? 1, s.dashArray, s);
            const classCount = features.filter(f => String(f.properties?.[cl.field]) === String(val)).length;
            const classTag   = classCount > 0 ? `<span class="legend-count legend-count-class">${fmtCount(classCount)}</span>` : '';
            html += `<div class="legend-item legend-item-classified">${svg}<span>${val}</span>${classTag}</div>`;
          });
          return html;
        }

        // Clasificación graduada
        if (cl?.type === 'graduated' && cl.breaks?.length) {
          const METHOD_LABELS = { jenks: 'natural breaks', equal: 'intervalos iguales', quantile: 'cuantiles' };
          const methodLabel = METHOD_LABELS[cl.method] || cl.method || '';
          let html = `<div class="legend-item legend-item-title">
            <span>${entry.titulo || key}</span>${countTag}
          </div>`;
          if (methodLabel) html += `<div class="legend-item classify-title">${methodLabel}</div>`;
          const colors = cl.paletteColors || ['#888'];
          for (let i = 0; i < cl.breaks.length - 1; i++) {
            const fill       = colors[Math.min(i, colors.length-1)];
            const border     = geom === 'line' ? fill : darkenHex(fill);
            const svg        = makeSVG(geom, fill, border, s.fillOpacity ?? 0.85, s.weight ?? 1.5, s.opacity ?? 1, null, s);
            const from       = cl.breaks[i];
            const to         = cl.breaks[i+1];
            const fromFmt    = Number(from).toLocaleString('es-AR', {maximumFractionDigits: 1});
            const toFmt      = Number(to).toLocaleString('es-AR', {maximumFractionDigits: 1});
            const classCount = features.filter(f => {
              const v = Number(f.properties?.[cl.field]);
              return isFinite(v) && v >= from && v <= to;
            }).length;
            const classTag   = classCount > 0 ? `<span class="legend-count legend-count-class">${fmtCount(classCount)}</span>` : '';
            html += `<div class="legend-item legend-item-classified">${svg}<span>${fromFmt} – ${toFmt}</span>${classTag}</div>`;
          }
          return html;
        }

        // Estilo uniforme
        const fill        = s.fillColor  || s.color   || '#888';
        const fillOpacity = s.fillOpacity ?? (geom === 'polygon' ? 0.3 : 0.85);
        const stroke      = s.color      || fill;
        const weight      = Math.min(s.weight ?? 1.5, 3);
        const opacity     = s.opacity    ?? 1;
        const svgHTML     = makeSVG(geom, fill, stroke, fillOpacity, weight, opacity, s.dashArray, s);

        return `
          <div class="legend-item">
            ${svgHTML}
            <input class="legend-label-input" data-key="${key}"
                   value="${(entry.titulo || key).replace(/"/g,'&quot;')}"
                    />
            ${countTag}
          </div>`;
      }).join('') + `</div>`;

    // Wire colapsar
    el.querySelector('.legend-collapse-btn')?.addEventListener('click', () => {
      el.classList.toggle('legend-collapsed');
      const icon = el.querySelector('.legend-collapse-btn .material-icons');
      if (icon) icon.textContent = el.classList.contains('legend-collapsed') ? 'expand_less' : 'expand_more';
    });

    // Wire edición inline
    el.querySelectorAll('.legend-label-input').forEach(input => {
      input.addEventListener('focus', () => { input.dataset.original = input.value; });
      input.addEventListener('blur',  () => _onLegendRename(input));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = input.dataset.original || input.value; input.blur(); }
      });
    });

    // Actualizar íconos Maki en referencias cuando el caché esté listo
    items.forEach(([, entry]) => {
      const icon = entry.style?.icon;
      if (!icon) return;
      if (window._makiSvgCache?.[icon]?.svgRaw) return; // ya está en caché
      _fetchMakiSvg(icon).then(() => {
        // Re-renderizar solo las referencias — sin refrescar toda la leyenda
        el.querySelectorAll('.legend-item svg.layer-geom-svg, .legend-item svg, .legend-item-classified svg').forEach(svgEl => {
          // Identificar si este SVG pertenece a esta capa buscando el input de título cercano
          const item = svgEl.closest('.legend-item');
          const input = item?.querySelector('.legend-label-input');
          if (!input) return;
          const key = input.dataset.key;
          const e2  = activeLayers[key];
          if (!e2 || e2.style?.icon !== icon) return;
          const s2 = e2.style || {};
          const fill2   = s2.fillColor || s2.color || '#888';
          const stroke2 = s2.color || fill2;
          const newSvg  = makeSVG(e2.geomType || 'point', fill2, stroke2, s2.fillOpacity ?? 0.85, s2.weight ?? 1.5, s2.opacity ?? 1, s2.dashArray, s2);
          const tmp = document.createElement('div');
          tmp.innerHTML = newSvg;
          const fresh = tmp.firstChild;
          if (fresh) svgEl.replaceWith(fresh);
        });
      });
    });
  }

  // ── Etiquetas ─────────────────────────────────────────────────

  function setLayerLabels(mapKey, show, opts = {}) {
    const entry = activeLayers[mapKey];
    if (!entry?.leafletLayer) return;

    entry.labels     = show;
    entry.labelSize  = opts.size  || entry.labelSize  || 12;
    entry.labelColor = opts.color || entry.labelColor || '#ffffff';
    const field      = opts.field || entry.labelField;
    entry.labelField = field;

    // Quitar tooltips existentes
    entry.leafletLayer.eachLayer?.(l => l.unbindTooltip?.());
    if (entry.leafletLayer.unbindTooltip) entry.leafletLayer.unbindTooltip();

    if (!show || !field) return;

    const style = `
      font-size: ${entry.labelSize}px;
      color: ${entry.labelColor};
      font-family: var(--font-sans, sans-serif);
      font-weight: 500;
      text-shadow: 0 1px 3px rgba(0,0,0,0.6);
      white-space: nowrap;
    `;

    entry.leafletLayer.eachLayer(l => {
      const val = l.feature?.properties?.[field];
      if (!val) return;
      l.bindTooltip(String(val), {
        permanent:   true,
        direction:   'center',
        className:   'map-label-tooltip',
        offset:      [0, 0]
      });
      // Aplicar estilo inline al elemento del tooltip
      l.on('tooltipopen', ev => {
        const el = ev.tooltip?.getElement?.();
        if (el) el.style.cssText += style;
      });
    });
  }

  // ── Clasificación por atributo ────────────────────────────────

  // Métodos de clasificación graduada
  /**
   * runClassifyWorker — delega cálculos de clasificación al Web Worker.
   * Soporta operaciones: 'breaks' (graduado) y 'colorMap' (categorizado).
   * Fallback síncrono si Workers no están disponibles.
   */
  function runClassifyWorker(message, fallback) {
    return new Promise((resolve) => {
      try {
        const worker = new Worker('/src/workers/classify-worker.js');
        worker.onmessage = (e) => {
          worker.terminate();
          if (e.data.error) {
            console.warn('[MAP] classify-worker error:', e.data.error);
            resolve(fallback());
          } else {
            resolve(e.data.result);
          }
        };
        worker.onerror = () => { worker.terminate(); resolve(fallback()); };
        worker.postMessage(message);
      } catch {
        resolve(fallback());
      }
    });
  }

  // Fallbacks síncronos — usados si el Worker no está disponible
  function computeBreaksSync(values, method, classes) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    if (!n) return [];
    if (method === 'equal') {
      const min = sorted[0], max = sorted[n-1], step = (max - min) / classes;
      return Array.from({length: classes+1}, (_, i) => min + i * step);
    }
    if (method === 'quantile') {
      const breaks = [sorted[0]];
      for (let i = 1; i < classes; i++) breaks.push(sorted[Math.floor(i * n / classes)]);
      breaks.push(sorted[n-1]);
      return breaks;
    }
    if (method === 'jenks') {
      const mat1 = [], mat2 = [];
      for (let i = 0; i <= n; i++) { mat1[i] = []; mat2[i] = []; }
      for (let i = 1; i <= n; i++) { mat1[i][1] = 1; mat2[i][1] = 0; }
      for (let j = 2; j <= classes; j++) {
        for (let i = j; i <= n; i++) {
          let minV = Infinity;
          for (let m = 1; m <= i-1; m++) {
            const slice = sorted.slice(m-1, i);
            const mean  = slice.reduce((a,b)=>a+b,0)/slice.length;
            const ssd   = slice.reduce((a,b)=>a+(b-mean)**2,0);
            const v     = (mat2[m][j-1]||0) + ssd;
            if (v < minV) { minV = v; mat1[i][j] = m; mat2[i][j] = v; }
          }
        }
      }
      const breaks = [sorted[n-1]];
      let k = n;
      for (let j = classes; j >= 2; j--) {
        const id = mat1[k][j] - 1;
        breaks.unshift(sorted[id]);
        k = mat1[k][j];
      }
      breaks.unshift(sorted[0]);
      return breaks;
    }
    return [];
  }

  function _randomColor(seed) {
    const hue = (seed * 137.508) % 360;
    return `hsl(${Math.round(hue)},55%,48%)`;
  }

  function computeColorMapSync(values, colors, maxCats) {
    const unique = [...new Set(values)].sort();
    const colorMap = {};
    unique.slice(0, maxCats * 2).forEach((v, i) => {
      colorMap[v] = colors[i % colors.length] || _randomColor(i);
    });
    return colorMap;
  }

  // Oscurece un color hex reduciendo la luminosidad en HSL
  function darkenHex(hex, amount = 0.22) {
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s, l = (max+min)/2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      switch(max) {
        case r: h = ((g-b)/d + (g<b?6:0))/6; break;
        case g: h = ((b-r)/d + 2)/6; break;
        default: h = ((r-g)/d + 4)/6;
      }
    }
    l = Math.max(0, l - amount);
    const q = l < 0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l - q;
    const hue2rgb = (p,q,t) => {
      if(t<0) t+=1; if(t>1) t-=1;
      if(t<1/6) return p+(q-p)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    };
    const toHex2 = n => Math.round(n*255).toString(16).padStart(2,'0');
    return '#' + toHex2(hue2rgb(p,q,h+1/3)) + toHex2(hue2rgb(p,q,h)) + toHex2(hue2rgb(p,q,h-1/3));
  }

  function getColorForValue(val, breaks, palette) {
    if (!breaks?.length || val == null) return palette[0] || '#888';
    for (let i = 0; i < breaks.length - 1; i++) {
      if (val <= breaks[i+1]) return palette[Math.min(i, palette.length-1)];
    }
    return palette[palette.length-1];
  }

  // Ordena los features según el orden de clases en colorMap, invertido:
  // la primera clase del panel queda al final del array → se pinta última → queda arriba.
  // Aplica a cualquier geometría. El orden inicial es alfabético (colorMap se construye
  // con .sort()); si el usuario arrastra clases en el panel, colorMap refleja el nuevo
  // orden y el render se actualiza en consecuencia.
  function _sortFeaturesByClassOrder(geojson, colorMap, field) {
    if (!geojson?.features?.length || !colorMap || !field) return geojson;
    const classKeys = Object.keys(colorMap); // orden actual del panel
    // Índice de posición: mayor índice = más arriba en la lista = se pinta último = encima
    const rank = {};
    classKeys.forEach((k, i) => { rank[k] = i; });
    return {
      ...geojson,
      features: [...geojson.features].sort((a, b) => {
        const ra = rank[String(a.properties?.[field])] ?? -1;
        const rb = rank[String(b.properties?.[field])] ?? -1;
        return rb - ra; // mayor rank → se pinta último → queda arriba (= primero en la lista del panel)
      })
    };
  }

  function rebuildLayer(entry, mapKey) {
    if (entry.leafletLayer) leafletMap.removeLayer(entry.leafletLayer);
    const geom = entry.geomType || 'polygon';
    const cl   = entry.classification;
    let newLayer;

    // Para capas clasificadas (cualquier geometría), ordenar features según el orden
    // de clases en colorMap: primera clase del panel arriba en el visor.
    const geojson = (cl?.type === 'categorized' && cl.colorMap && cl.field)
      ? _sortFeaturesByClassOrder(entry.geojson, cl.colorMap, cl.field)
      : entry.geojson;

    const getStyle = (feat) => {
      if (!cl) return entry.style;
      const val = feat?.properties?.[cl.field];
      if (cl.type === 'graduated') {
        const fill = getColorForValue(parseFloat(val), cl.breaks, cl.paletteColors || ['#888']);
        const border = darkenHex(fill);
        return geom === 'line'
          ? { ...entry.style, color: fill }
          : { ...entry.style, color: border, fillColor: fill };
      }
      // categorized — si el valor no está en colorMap, ocultar el feature
      if (!cl.colorMap?.hasOwnProperty(val)) {
        return geom === 'point'
          ? { ...entry.style, radius: 0, opacity: 0, fillOpacity: 0 }
          : { ...entry.style, opacity: 0, fillOpacity: 0, weight: 0 };
      }
      const fill     = cl.colorMap[val];
      const valStyle = cl.styleMap?.[val] || {};
      // Usar color de borde explícito del styleMap si existe, si no derivar del fill
      const border   = valStyle.color || darkenHex(valStyle.fillColor || fill);
      return geom === 'line'
        ? { ...entry.style, ...valStyle, color: valStyle.color || fill }
        : { ...entry.style, ...valStyle, color: border, fillColor: valStyle.fillColor || fill };
    };

    if (geom === 'point') {
      newLayer = L.geoJSON(geojson, {
        pointToLayer:  (feat, latlng) => _pointToLayer(feat, latlng, getStyle(feat)),
        onEachFeature: bindIdentify
      });
    } else if (geom === 'line') {
      newLayer = L.geoJSON(geojson, {
        style:         feat => lineStyle(getStyle(feat)),
        onEachFeature: bindIdentify
      });
    } else {
      newLayer = L.geoJSON(geojson, {
        style:         feat => polygonStyle(getStyle(feat)),
        onEachFeature: bindIdentify
      });
    }
    newLayer.addTo(leafletMap);
    entry.leafletLayer = newLayer;
    _reapplyZOrder();
  }

  async function applyClassification(mapKey, opts) {
    const entry = activeLayers[mapKey];
    if (!entry?.geojson) return;

    const { type, field, palette, paletteColors, method, classes } = opts;
    const colors  = paletteColors || [];
    const MAX_CATS = 12;

    if (type === 'categorized') {
      const rawValues = entry.geojson.features
        .map(f => f.properties?.[field])
        .filter(v => v != null);
      // Validar cardinalidad antes de clasificar
      const uniqueCount = new Set(rawValues.map(String)).size;
      if (uniqueCount > MAX_CATS) {
        console.warn(`[MAP] classify: campo "${field}" tiene ${uniqueCount} valores únicos (máx ${MAX_CATS}). Sugiriendo graduated.`);
        // Intentar como graduated si los valores son numéricos
        const numVals = rawValues.map(v => parseFloat(v)).filter(v => !isNaN(v));
        if (numVals.length > rawValues.length * 0.5) {
          // Mayoría numérica → reclasificar como graduated
          const breaks = await runClassifyWorker(
            { op: 'breaks', values: numVals, method: method || 'jenks', classes: classes || 5 },
            () => computeBreaksSync(numVals, method || 'jenks', classes || 5)
          );
          entry.classification = { type: 'graduated', field, palette, paletteColors: colors, method: method || 'jenks', classes: classes || 5, breaks };
        } else {
          // Demasiados valores categóricos → clasificar con MAX_CATS y agrupar el resto en "Otros"
          const colorMap = await runClassifyWorker(
            { op: 'colorMap', values: rawValues, colors, maxCats: MAX_CATS },
            () => computeColorMapSync(rawValues, colors, MAX_CATS)
          );
          entry.classification = { type, field, palette, paletteColors: colors, colorMap };
        }
      } else {
        const colorMap = await runClassifyWorker(
          { op: 'colorMap', values: rawValues, colors, maxCats: MAX_CATS },
          () => computeColorMapSync(rawValues, colors, MAX_CATS)
        );
        entry.classification = { type, field, palette, paletteColors: colors, colorMap };
      }

    } else if (type === 'graduated') {
      const numVals = entry.geojson.features
        .map(f => parseFloat(f.properties?.[field]))
        .filter(v => !isNaN(v));
      const breaks = await runClassifyWorker(
        { op: 'breaks', values: numVals, method: method || 'jenks', classes: classes || 5 },
        () => computeBreaksSync(numVals, method || 'jenks', classes || 5)
      );
      entry.classification = { type, field, palette, paletteColors: colors, method, classes, breaks };
    }

    rebuildLayer(entry, mapKey);
    updateLegend();
  }

  function applyClassificationFromData(mapKey, classification) {
    const entry = activeLayers[mapKey];
    if (!entry) return;
    entry.classification = classification;
    rebuildLayer(entry, mapKey);
    updateLegend();
  }

  function clearClassification(mapKey) {
    const entry = activeLayers[mapKey];
    if (!entry) return;
    entry.classification = null;
    rebuildLayer(entry, mapKey);
    updateLegend();
  }

  // ── Renombrar capa desde leyenda ──────────────────────────────

  let _layerRenameCallback     = null;
  let _layerVisibilityCallback = null;
  let _layerOrderCallback      = null;
  let _layerStyleCallback      = null;
  let _layersChangeCb          = null;

  function onLayerRename(cb)           { _layerRenameCallback     = cb; }
  function onLayerVisibilityChange(cb) { _layerVisibilityCallback = cb; }
  function onLayerOrderChange(cb)      { _layerOrderCallback      = cb; }
  function onStyleChange(cb)           { _layerStyleCallback      = cb; }
  function onLayersChange(cb)          { _layersChangeCb          = cb; }

  function _onLegendRename(input) {
    const key      = input.dataset.key;
    const newName  = input.value.trim();
    const original = input.dataset.original || '';
    if (!newName) { input.value = original; return; }
    if (newName === original) return;
    if (activeLayers[key]) {
      activeLayers[key].tituloUI = newName;
    }
    if (_layerRenameCallback) _layerRenameCallback(key, newName);
  }

  function renameLayer(key, newName) {
    if (activeLayers[key]) activeLayers[key].tituloUI = newName;
    if (_layerRenameCallback) _layerRenameCallback(key, newName);
  }

  // ── Popup genérico ────────────────────────────────────────────

  // ── Modo consulta (identify) ─────────────────────────────────

  let _identifyMode             = false;
  let _identifyHighlight        = null;
  let _identifyClickedOnFeature = false;
  let _lastIdentifyFeature      = null;
  let _lastIdentifyMapKey       = null;
  let _currentPopup             = null;

  function setIdentifyMode(active) {
    _identifyMode = active;
    const container = leafletMap?.getContainer();
    if (container) container.classList.toggle('identify-active', active);
    if (!active) {
      leafletMap?.closePopup();
      clearHighlight();
    } else {
      // Cuando se activa: el próximo click en el mapa sin tocar un feature → desactivar
      setTimeout(() => {
        if (_identifyMode) leafletMap?.once('click', _onMapClickOutsideFeature);
      }, 0);
    }
  }

  function _onMapClickOutsideFeature() {
    if (!_identifyMode) return;
    if (_identifyClickedOnFeature) {
      _identifyClickedOnFeature = false;
      setTimeout(() => {
        if (_identifyMode) leafletMap?.once('click', _onMapClickOutsideFeature);
      }, 0);
    } else {
      _deactivateIdentify();
    }
  }

  function _deactivateIdentify() {
    _identifyMode = false;
    const container = leafletMap?.getContainer();
    if (container) container.classList.remove('identify-active');
    leafletMap?.closePopup();
    clearHighlight();
    document.getElementById('popup-field-customizer')?.remove();
    // Actualizar el botón en la UI
    const btn = document.getElementById('btn-identify');
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('data-tooltip', t('identify_on'));
    }
  }

  function getIdentifyMode() { return _identifyMode; }

  // ── Campos ocultos por defecto en el popup ────────────────────
  // Campos siempre excluidos (técnicos/internos):
  // Campos que nunca se muestran en el popup (geometría, IDs internos, tipos WFS).
  // Nota: 'objeto' y 'gna' se eliminan de esta lista — ahora los controla visible: en attributes.
  const POPUP_ALWAYS_EXCLUDE = new Set(['gid', 'fdc', 'sag', 'entidad']);

  // Preferencias de campos visibles: layerKey → Set de campos habilitados
  const _popupFieldPrefs = {};
  const POPUP_PREFS_KEY  = 'sm_popup_fields';

  function _loadPopupPrefs() {
    try {
      const raw = localStorage.getItem(POPUP_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([lk, fields]) => {
        _popupFieldPrefs[lk] = new Set(fields);
      });
    } catch {}
  }

  let _popupPrefsSaveCallback = null;
  function onPopupPrefsSave(cb) { _popupPrefsSaveCallback = cb; }

  function _savePopupPrefs() {
    try {
      const out = {};
      Object.entries(_popupFieldPrefs).forEach(([lk, set]) => { out[lk] = [...set]; });
      localStorage.setItem(POPUP_PREFS_KEY, JSON.stringify(out));
      if (_popupPrefsSaveCallback) _popupPrefsSaveCallback(out);
    } catch {}
  }

  _loadPopupPrefs();

  function _getVisibleFields(layerKey, allFields) {
    // Si el usuario ya configuró preferencias para esta capa, usar esas
    if (_popupFieldPrefs[layerKey]) {
      return allFields.filter(k => _popupFieldPrefs[layerKey].has(k));
    }
    // Fuente de verdad: los dos primeros attributes con visible: true.
    // El usuario puede expandir con "Más campos".
    const layerDef = window.LAYERS?.[layerKey] || {};
    const attrs    = layerDef.attributes || [];
    if (attrs.length) {
      const visibleSet = new Set(
        attrs.filter(a => a.visible !== false).slice(0, 2).map(a => a.campo)
      );
      const fromAttrs = allFields.filter(k => visibleSet.has(k));
      if (fromAttrs.length) return fromAttrs;
    }
    // Fallback si la capa no tiene attributes definidos: todos los campos presentes
    return allFields;
  }

  // buildPopupEl: devuelve un elemento DOM con eventos ya wired.
  // Leaflet acepta elementos DOM en setContent — así evitamos cualquier problema de timing.
  function buildPopupEl(feature, mapKey) {
    if (!feature.properties) return document.createElement('div');
    const props = feature.properties;

    const layerKey = activeLayers[mapKey]?.layerKey || mapKey;
    const layerDef = window.LAYERS?.[layerKey] || {};

    // Conjunto de campos permitidos: excluye visible:false de attributes.
    // Si la capa no tiene attributes, no se restringe nada.
    const _attrs = layerDef.attributes || [];
    const _hiddenSet = _attrs.length
      ? new Set(_attrs.filter(a => a.visible === false).map(a => a.campo))
      : new Set();

    const allFields = Object.keys(props).filter(k =>
      !POPUP_ALWAYS_EXCLUDE.has(k) &&
      !_hiddenSet.has(k) &&
      !k.endsWith('Type') &&
      props[k] !== null && props[k] !== undefined &&
      props[k] !== 'None' && props[k] !== ''
    );

    const visibleFields = _getVisibleFields(layerKey, allFields);
    // Título: usar labelField de la capa si existe, luego fallback a campos comunes
    const _labelField = layerDef.labelField;
    const name = (_labelField && props[_labelField]) || props.fna || props.nom_pfi || props.nam || props.rtn || '';

    // Filas: usar label legible si existe, nombre técnico en mono si no
    // label presente → traducción real (sans), label ausente → técnico (mono)
    const _attrMap = Object.fromEntries(
      (layerDef.attributes || []).map(a => [a.campo, a.label || null])
    );
    const dataRows = visibleFields
      .map(k => {
        const lbl = _attrMap[k];
        const keyHTML = lbl
          ? `<div class="popup-key popup-key-label">${lbl}</div>`
          : `<div class="popup-key">${k}</div>`;
        return `<div class="popup-row">${keyHTML}<div class="popup-val">${props[k]}</div></div>`;
      })
      .join('');

    const currentPref  = _popupFieldPrefs[layerKey];
    // isActive: refleja qué campos están activos en el popup (user pref o visible:true de attributes)
    const _defaultVisibleSet = new Set(_getVisibleFields(layerKey, allFields));
    const isActive = k => currentPref ? currentPref.has(k) : _defaultVisibleSet.has(k);

    const el = document.createElement('div');
    el.className = 'map-popup';
    el.dataset.layerKey = layerKey;

    // Construir filas de campos del acordeón
    const fieldRows = allFields.map(k => {
      const active  = isActive(k);
      const pfcLbl  = _attrMap[k];
      const pfcSpan = pfcLbl
        ? `<span class="pfc-acc-field pfc-acc-field-label">${pfcLbl}</span>`
        : `<span class="pfc-acc-field">${k}</span>`;
      return `<label class="pfc-acc-row">
        ${pfcSpan}
        <input type="checkbox" class="pfc-acc-chk" data-field="${k}" ${active ? 'checked' : ''}/>
      </label>`;
    }).join('');

    el.innerHTML = `
      <div class="popup-header">
        ${name ? `<span class="popup-name">${name}</span>` : '<span></span>'}
        <div class="popup-header-btns">
          <button class="popup-center-btn" data-tooltip="${t('popup_center')}"><span class="material-icons">filter_center_focus</span></button>
          <button class="popup-close-btn"><span class="material-icons">close</span></button>
        </div>
      </div>
      <div class="popup-table-wrap"><div class="popup-rows">${dataRows || '<div class="popup-empty">Sin datos</div>'}</div></div>
      <div class="pfc-acc-wrap">
        <div class="pfc-acc-header">
          <span class="pfc-acc-label">${t('popup_more_fields')}</span>
          <span class="pfc-acc-arrow material-icons">expand_more</span>
        </div>
        <div class="pfc-acc-body hidden">
          ${fieldRows}
        </div>
      </div>`;

    // Wire acordeón — deshabilita autoPan al abrir para que el popup no se mueva
    const accHeader = el.querySelector('.pfc-acc-header');
    const accBody   = el.querySelector('.pfc-acc-body');
    const accArrow  = el.querySelector('.pfc-acc-arrow');

    accHeader.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !accBody.classList.contains('hidden');
      accBody.classList.toggle('hidden', isOpen);
      accArrow.classList.toggle('open', !isOpen);
      // No llamar update() ni tocar autoPan: el acordeón crece dentro del
      // max-height del popup (ver .map-popup en map.css) y Leaflet no necesita
      // reposicionar nada. Llamar update() movería el popup hacia arriba.
    });

    // Wire checkboxes
    el.querySelectorAll('.pfc-acc-chk').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = [...el.querySelectorAll('.pfc-acc-chk:checked')]
          .map(i => i.dataset.field);
        if (checked.length === 0) { cb.checked = true; return; }
        _popupFieldPrefs[layerKey] = new Set(checked);
        _savePopupPrefs();
        _refreshOpenPopup(false);
      });
    });

    // Centrar en el elemento
    el.querySelector('.popup-center-btn')?.addEventListener('click', () => {
      if (!feature?.geometry) return;
      const geom = feature.geometry;
      if (geom.type === 'Point') {
        const [lng, lat] = geom.coordinates;
        const zoom = Math.max(leafletMap.getZoom(), 14);
        leafletMap?.setView([lat, lng], zoom, { animate: true });
      } else {
        try {
          const tempLayer = L.geoJSON(feature);
          const bounds = tempLayer.getBounds();
          if (bounds.isValid()) {
            const center     = bounds.getCenter();
            const targetZoom = leafletMap.getBoundsZoom(bounds, false, [60, 60]);
            // Reducir el zoom según la diferencia con el zoom actual:
            // 0–1.9 → sin reducción, 2–5.9 → 1 nivel, 6–9.9 → 2 niveles, 10+ → 3 niveles
            const diff     = Math.abs(targetZoom - leafletMap.getZoom());
            const reduccion = diff < 2 ? 0 : diff < 6 ? 1 : diff < 10 ? 2 : 3;
            leafletMap?.setView(center, Math.max(targetZoom - reduccion, 1), { animate: true });
          }
        } catch { /* ignorar */ }
      }
    });

    // Cerrar popup con X
    el.querySelector('.popup-close-btn')?.addEventListener('click', () => {
      leafletMap?.closePopup();
    });

    return el;
  }

  function _refreshOpenPopup(keepAccordion = false) {
    const openPopup = _currentPopup;
    if (!openPopup || !_lastIdentifyFeature) return;

    const wrapper = openPopup.getElement?.();
    if (!wrapper) return;
    const popupEl = wrapper.querySelector('.map-popup');
    const tableEl = popupEl?.querySelector('.popup-rows');
    if (!tableEl) return;

    const props     = _lastIdentifyFeature.properties;
    const layerKey  = activeLayers[_lastIdentifyMapKey]?.layerKey || _lastIdentifyMapKey;
    const _layerDef2  = window.LAYERS?.[layerKey] || {};
    const _attrs2     = _layerDef2.attributes || [];
    const _hiddenSet2 = _attrs2.length
      ? new Set(_attrs2.filter(a => a.visible === false).map(a => a.campo))
      : new Set();
    const allFields = Object.keys(props).filter(k =>
      !POPUP_ALWAYS_EXCLUDE.has(k) && !_hiddenSet2.has(k) && !k.endsWith('Type') &&
      props[k] !== null && props[k] !== undefined && props[k] !== 'None' && props[k] !== ''
    );
    const visibleFields = _getVisibleFields(layerKey, allFields);
    // _attrMap2 para traducir etiquetas en el identify mode
    const _attrMap2 = Object.fromEntries(
      (_layerDef2.attributes || []).map(a => [a.campo, a.label || null])
    );
    tableEl.innerHTML = visibleFields.map(k => {
      const lbl2 = _attrMap2[k];
      const keyHTML2 = lbl2
        ? `<div class="popup-key popup-key-label">${lbl2}</div>`
        : `<div class="popup-key">${k}</div>`;
      return `<div class="popup-row">${keyHTML2}<div class="popup-val">${props[k]}</div></div>`;
    }).join('') || '<div class="popup-empty">Sin datos</div>';

    // Recalcular tamaño sin disparar reposicionamiento de Leaflet.
    // No llamar update() — movería el popup igual que al expandir el acordeón.
  }


  function clearHighlight() {
    if (_identifyHighlight) {
      _identifyHighlight.remove();
      _identifyHighlight = null;
    }
  }

  function highlightFeature(feature, latlng) {
    clearHighlight();
    const geom = feature.geometry?.type?.toLowerCase() || '';
    let hl;
    if (geom.includes('point') || geom.includes('multipoint')) {
      hl = L.circleMarker(latlng, {
        radius: 14, color: '#f5c518', weight: 3,
        fillColor: '#f5c518', fillOpacity: 0.2, opacity: 0.9
      }).addTo(leafletMap);
    } else if (geom.includes('line')) {
      hl = L.geoJSON(feature, {
        style: { color: '#f5c518', weight: 12, opacity: 0.75 }
      }).addTo(leafletMap);
    } else {
      hl = L.geoJSON(feature, {
        style: { color: '#f5c518', weight: 3, fillColor: '#f5c518', fillOpacity: 0.2, opacity: 0.9 }
      }).addTo(leafletMap);
    }
    _identifyHighlight = hl;
  }

  function bindIdentify(feature, layer) {
    layer.on('click', e => {
      if (!_identifyMode) return;
      L.DomEvent.stopPropagation(e);
      _identifyClickedOnFeature = true;

      // Buscar el mapKey de este layer para pasar al buildPopupContent
      let mapKey = null;
      Object.entries(activeLayers).forEach(([mk, entry]) => {
        entry.leafletLayer?.eachLayer?.(l => { if (l === layer) mapKey = mk; });
      });

      highlightFeature(feature, e.latlng);
      _lastIdentifyFeature = feature;
      _lastIdentifyMapKey  = mapKey;

      // offset positivo en Y: la punta queda debajo del click, el globo crece hacia abajo
      _currentPopup = L.popup({
        className: 'sm-popup',
        offset: L.point(0, 6),
        autoPan: true,
        closeButton: false,
        autoPanPaddingTopLeft:     L.point(60, 64),
        autoPanPaddingBottomRight: L.point(60, 20)
      })
        .setLatLng(e.latlng)
        .setContent(buildPopupEl(feature, mapKey))
        .openOn(leafletMap);

    });

    // Cursor: solo cambiar a pointer cuando identify está activo
    layer.on('mouseover', e => {
      const el = e.originalEvent?.target;
      if (!_identifyMode) {
        // Asegurar cursor de mano grab, no pointer
        if (el) el.style.cursor = '';
        return;
      }
    });
  }

  // ── Funciones de estilo ───────────────────────────────────────

  function polygonStyle(s) {
    return {
      fillColor:   s.fillColor   || '#3d52a0',
      fillOpacity: s.fillOpacity ?? 0.2,
      color:       s.color       || s.fillColor || '#2d3d7a',
      weight:      s.weight      ?? 1.5,
      opacity:     s.opacity     ?? 1
    };
  }

  function lineStyle(s) {
    const st = {
      color:     s.color   || '#2d3d7a',
      weight:    s.weight  ?? 2,
      opacity:   s.opacity ?? 1,
      dashArray: null,   // reset explícito — sin esto Leaflet deja el patrón anterior al hacer setStyle
    };
    if (s.dashArray) {
      // Escalar el patrón proporcionalmente al grosor para que siempre se vea
      const w      = st.weight;
      const scale  = Math.max(1, w / 2);
      const scaled = s.dashArray.split(',').map(n => Math.round(parseFloat(n) * scale)).join(',');
      st.dashArray = scaled;
    }
    return st;
  }

  // ── Renderizado de puntos ─────────────────────────────────────
  //
  // style.icon      → ícono Maki (ej: 'airport') — usa L.DivIcon con SVG inline
  // style.shape     → 'circle' | 'square' (default: 'circle')
  // Sin icon ni shape → circleMarker (comportamiento original)

  const MAKI_BASE = 'https://casux-maki.geoeguren.workers.dev/?icon=';

  // Caché en memoria: key → SVG string con fill reemplazado
  // Estructura: { iconKey: { svgRaw: '...', byColor: { '#fff': '<svg...>' } } }
  window._makiSvgCache = window._makiSvgCache || {};

  async function _fetchMakiSvg(iconKey) {
    if (window._makiSvgCache[iconKey]?.svgRaw) return window._makiSvgCache[iconKey].svgRaw;
    // Si ya hay un fetch en curso para este ícono, esperar a que termine
    // en vez de lanzar otro request. Evita saturar las conexiones HTTP del
    // browser (que comparte el límite de 6 con los tiles de CartoDB).
    if (window._makiSvgCache[iconKey]?._promise) {
      return window._makiSvgCache[iconKey]._promise;
    }
    const promise = (async () => {
      try {
        const res = await fetch(MAKI_BASE + iconKey);
        if (!res.ok) return null;
        const raw = await res.text();
        window._makiSvgCache[iconKey] = { svgRaw: raw, byColor: {} };
        return raw;
      } catch { return null; }
    })();
    window._makiSvgCache[iconKey] = { _promise: promise };
    return promise;
  }

  function _coloredSvg(svgRaw, color, size) {
    // Reemplaza o agrega fill en el elemento raíz <svg>
    // y ajusta width/height al tamaño pedido
    let svg = svgRaw
      .replace(/\bwidth="[^"]*"/, `width="${size}"`)
      .replace(/\bheight="[^"]*"/, `height="${size}"`)
      .replace(/\bfill="[^"]*"/g, `fill="${color}"`);
    // Si no había fill, lo agrega en el tag <svg>
    if (!svg.includes(`fill="${color}"`)) {
      svg = svg.replace('<svg', `<svg fill="${color}"`);
    }
    return svg;
  }

  function _makiIconHtml(style, svgRaw) {
    const size        = Math.round((style.radius ?? 12) * 2);
    const fillColor   = style.fillColor  || '#3d52a0';
    const borderColor = style.color      || '#2d3d7a';
    const borderWidth = style.weight     ?? 0;
    const fillOpacity = style.fillOpacity ?? 0.85;
    const iconColor   = style.iconColor  || '#ffffff';
    const iconSize    = Math.round(size * 0.55);

    const bgShape = style.shape || 'circle';
    let bgCss = `width:${size}px;height:${size}px;background:${fillColor};opacity:${fillOpacity};border:${borderWidth}px solid ${borderColor};display:flex;align-items:center;justify-content:center;box-sizing:border-box;`;
    if (bgShape === 'circle') bgCss += 'border-radius:50%;';
    if (bgShape === 'square') bgCss += 'border-radius:2px;';

    const innerSvg = svgRaw
      ? _coloredSvg(svgRaw, iconColor, iconSize)
      : `<div style="width:${iconSize}px;height:${iconSize}px;border-radius:50%;background:${iconColor};opacity:.5"></div>`;

    return `<div style="${bgCss}">${innerSvg}</div>`;
  }

  // Versión síncrona — usa caché si está disponible, si no muestra placeholder
  function _makiIcon(style) {
    const iconKey  = style.icon;
    const cached   = window._makiSvgCache[iconKey]?.svgRaw || null;
    const size     = Math.round((style.radius ?? 12) * 2);

    const html = _makiIconHtml(style, cached);

    const icon = L.divIcon({
      html,
      className:   '',
      iconSize:    [size, size],
      iconAnchor:  [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });

    // Si no estaba en caché, fetch async y actualizar los markers en el mapa
    if (!cached) {
      _fetchMakiSvg(iconKey).then(svgRaw => {
        if (!svgRaw) return;
        // Actualizar todos los markers de capas que usen este ícono
        Object.values(activeLayers).forEach(entry => {
          if (entry.style?.icon !== iconKey) return;
          entry.leafletLayer?.eachLayer(l => {
            if (!l.setIcon) return;
            const newHtml = _makiIconHtml(entry.style, svgRaw);
            const newSize = Math.round((entry.style.radius ?? 12) * 2);
            l.setIcon(L.divIcon({
              html:        newHtml,
              className:   '',
              iconSize:    [newSize, newSize],
              iconAnchor:  [newSize / 2, newSize / 2],
              popupAnchor: [0, -newSize / 2]
            }));
          });
        });
      });
    }

    return icon;
  }

  // Precachear un ícono (llamar al seleccionarlo en el modal)
  async function precacheMakiIcon(iconKey) {
    return _fetchMakiSvg(iconKey);
  }

  function _shapeIcon(style) {
    const size        = (style.radius ?? 8) * 2;
    const fillColor   = style.fillColor || '#3d52a0';
    const borderColor = style.color     || '#2d3d7a';
    const borderWidth = style.weight    ?? 1.5;
    const fillOpacity = style.fillOpacity ?? 0.85;
    const shape       = style.shape || 'circle';

    let inner;
    if (shape === 'square') {
      // Convertir el color hex + opacidad a rgba para no afectar el borde
      const r = parseInt(fillColor.slice(1,3), 16);
      const g = parseInt(fillColor.slice(3,5), 16);
      const b = parseInt(fillColor.slice(5,7), 16);
      const bg = `rgba(${r},${g},${b},${fillOpacity})`;
      inner = `<div style="
        width:${size}px;height:${size}px;
        background:${bg};
        border:${borderWidth}px solid ${borderColor};
        border-radius:2px;
        box-sizing:border-box;
      "></div>`;
    } else {
      // circle (default)
      return null; // usa circleMarker normal
    }

    return L.divIcon({
      html:        inner,
      className:   '',
      iconSize:    [size, size],
      iconAnchor:  [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });
  }

  function _pointToLayer(feat, latlng, style) {
    if (style.icon)  return L.marker(latlng, { icon: _makiIcon(style) });
    const shapeIcon = _shapeIcon(style);
    if (shapeIcon)   return L.marker(latlng, { icon: shapeIcon });
    return L.circleMarker(latlng, pointStyle(style));
  }

  function pointStyle(s) {
    return {
      radius:      s.radius      ?? 5,
      fillColor:   s.fillColor   || '#3d52a0',
      fillOpacity: s.fillOpacity ?? 0.85,
      color:       s.color       || '#2d3d7a',
      weight:      s.weight      ?? 1.5,
      opacity:     s.opacity     ?? 1
    };
  }

  // ── API pública ───────────────────────────────────────────────

  function toggleLayerVisibility(key) {
    const layer = activeLayers[key];
    if (!layer) return;
    if (layer.visible === false) {
      layer.visible = true;
      if (layer.leafletLayer) {
        leafletMap.addLayer(layer.leafletLayer);
        _reapplyZOrder();
      }
    } else {
      layer.visible = false;
      if (layer.leafletLayer) leafletMap.removeLayer(layer.leafletLayer);
    }
    updateLegend();
    if (_layerVisibilityCallback) _layerVisibilityCallback(key, layer.visible !== false);
  }

  return {
    init,
    destroy,
    addLayer,
    removeLayer,
    clearAll,
    resetView,
    updateLayerStyle,
    updateLayerClassification,
    moveLayer,
    fitBounds,
    fitToLayer,
    getLeafletMap: () => leafletMap,
    updateLegend,
    toggleLayerVisibility,
    setBasemap,
    setLabels,
    getCurrentBase,
    getShowLabels,
    hasLabels,
    getBasemaps,
    setIdentifyMode,
    getIdentifyMode,
    applyClassification,
    applyClassificationFromData,
    clearClassification,
    setLayerLabels,
    onLayerRename,
    onLayerVisibilityChange,
    onLayerOrderChange,
    onStyleChange,
    onLayersChange,
    onPopupPrefsSave,
    restoreLayerVisible,
    setPopupPrefs,
    getPopupPrefs,
    renameLayer,
    getActiveLayers: () => activeLayers,
    getInstance:     () => leafletMap,
    darkenHex,
    precacheMakiIcon
  };

})();
