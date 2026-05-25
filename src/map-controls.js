/**
 * map-controls.js — Divisor redimensionable y visibilidad del mapa
 *
 * Depende de: window.MAP
 */

window.MAP_CONTROLS = (() => {

  const isMobile = () => window.innerWidth <= 1024;

  let _dividerInited = false;

  function initResizeDivider() {
    // No inicializar el divisor en mobile
    if (isMobile()) return;
    if (_dividerInited) return;
    _dividerInited = true;
    const divider  = document.getElementById('resize-divider');
    const chat     = document.getElementById('chat-panel');
    const mapPanel = document.getElementById('map-panel');
    let dragging   = false, startX = 0, startChatW = 0, startMapW = 0;

    divider?.addEventListener('mousedown', e => {
      dragging     = true;
      startX       = e.clientX;
      startChatW   = chat.offsetWidth;
      startMapW    = mapPanel.offsetWidth;
      chat.style.flex     = 'none';
      mapPanel.style.flex = 'none';
      chat.style.width     = startChatW + 'px';
      mapPanel.style.width = startMapW  + 'px';
      chat.style.maxWidth  = 'none';
      divider.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    let _rafId = null;

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const minChat = 280, minMap = 280;
      const delta   = e.clientX - startX;
      const maxDelta =  startMapW  - minMap;
      const minDelta = -(startChatW - minChat);
      const clamped  = Math.min(Math.max(delta, minDelta), maxDelta);
      chat.style.width     = (startChatW + clamped) + 'px';
      mapPanel.style.width = (startMapW  - clamped) + 'px';
      // Throttle con rAF — invalidateSize es costoso, una vez por frame alcanza
      if (_rafId) return;
      _rafId = requestAnimationFrame(() => {
        window.MAP.getInstance()?.invalidateSize();
        _rafId = null;
      });
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      divider?.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      mapPanel.style.flex  = '1';
      mapPanel.style.width = '';
    });
  }

  function resetDivider() {
    _dividerInited = false;
  }

  function setMapVisible(visible) {
    const panel   = document.getElementById('map-panel');
    const chat    = document.getElementById('chat-panel');
    const divider = document.getElementById('resize-divider');

    if (panel) panel.style.display = visible ? 'flex' : 'none';
    const layersBtn   = document.getElementById('btn-map-layers');
    const labelsBtn   = document.getElementById('btn-labels');
    const identifyBtn = document.getElementById('btn-identify');
    const legend      = document.getElementById('map-legend');
    if (layersBtn)   layersBtn.style.display   = visible ? '' : 'none';
    if (labelsBtn)   labelsBtn.style.display   = visible ? '' : 'none';
    if (identifyBtn) identifyBtn.style.display = visible ? '' : 'none';
    if (legend)      legend.style.display      = visible ? '' : 'none';

    if (visible) {
      chat?.classList.add('with-map');

      if (!isMobile()) {
        divider?.classList.add('visible');
        initResizeDivider();
      } else {
        // Ocultar sidebar en mobile para que el mapa use toda la pantalla
        document.getElementById('sidebar')?.classList.add('mobile-hidden');
      }

      // Reducir umbrales de display en mobile (señal primaria fileSizeKb, fallback featureCount).
      // Se guardan los valores desktop para restaurarlos al cerrar el mapa.
      if (isMobile() && window.CLIP_THRESHOLDS) {
        window.CLIP_THRESHOLDS._desktopDisplay          = window.CLIP_THRESHOLDS._desktopDisplay          || window.CLIP_THRESHOLDS.display;
        window.CLIP_THRESHOLDS._desktopDisplayFcFallback = window.CLIP_THRESHOLDS._desktopDisplayFcFallback || window.CLIP_THRESHOLDS.displayFcFallback;
        window.CLIP_THRESHOLDS.display            = window.CLIP_THRESHOLDS.displayMobile            ?? 15_000;
        window.CLIP_THRESHOLDS.displayFcFallback  = window.CLIP_THRESHOLDS.displayMobileFcFallback  ?? 20_000;
      }

      window.MAP.init();
      requestAnimationFrame(() => window.MAP.getInstance()?.invalidateSize());
      setTimeout(() => window.MAP.getInstance()?.invalidateSize(), 150);
      setTimeout(() => {
        window.MAP.getInstance()?.invalidateSize();
        // En móvil, si renderMap ya terminó de cargar las capas y dejó el flag,
        // hacer zoom ahora que el panel tiene dimensiones reales.
        if (isMobile() && window._pendingFitBounds) {
          window._pendingFitBounds = false;
          window.MAP.fitBounds();
        }
      }, 400);
    } else {
      chat?.classList.remove('with-map');
      divider?.classList.remove('visible');
      if (chat) { chat.style.width = ''; chat.style.flex = ''; }
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel) { mapPanel.style.width = ''; mapPanel.style.flex = ''; }

      // Restaurar sidebar en mobile
      if (isMobile()) {
        document.getElementById('sidebar')?.classList.remove('mobile-hidden');
      }

      if (isMobile() && window.CLIP_THRESHOLDS?._desktopDisplay) {
        window.CLIP_THRESHOLDS.display           = window.CLIP_THRESHOLDS._desktopDisplay;
        window.CLIP_THRESHOLDS.displayFcFallback = window.CLIP_THRESHOLDS._desktopDisplayFcFallback || window.CLIP_THRESHOLDS.displayFcFallback;
      }
    }
  }

  return { setMapVisible, initResizeDivider, resetDivider, isMobile };

})();
