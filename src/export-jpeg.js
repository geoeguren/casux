/**
 * export-jpeg.js
 * Depende de: export-utils.js, export-canvas.js
 */

window.EXPORT_JPEG = (() => {

  const _u = () => window.EXPORT_UTILS;
  const _c = () => window.EXPORT_CANVAS;
  const getMapScale    = (...a) => _u().getMapScale(...a);
  const _getMapMeta    = (...a) => _u()._getMapMeta(...a);
  const downloadBlob   = (...a) => _u().downloadBlob(...a);
  const sanitizeFilename = (...a) => _u().sanitizeFilename(...a);
  const captureLeaflet = (...a) => _c().captureLeaflet(...a);
  const buildA4Canvas  = (...a) => _c().buildA4Canvas(...a);


  async function toJPEG(opciones = {}) {
    const mapInst = window.MAP.getInstance();
    if (!mapInst) { window.TOAST.warning(t('export_no_map')); return Promise.reject('sin mapa'); }

    window.TOAST.loading(t('export_loading_jpeg'));

    try {
      const { canvas: mapCanvas, bounds: exportBounds } = await captureLeaflet(mapInst, { basemap: opciones.basemap || null });
      const outputCanvas = await buildA4Canvas(mapCanvas, exportBounds, opciones);

      await new Promise((resolve, reject) => {
        outputCanvas.toBlob(blob => {
          if (!blob) { reject(new Error('Canvas vacío')); return; }
          const title = document.getElementById('map-title')?.value || 'casux';
          downloadBlob(blob, `${sanitizeFilename(title)}.jpg`);
          window.TOAST.success(t('export_done_jpeg'));
          window.ANALYTICS?.mapExported?.('jpeg');
          resolve();
        }, 'image/jpeg', 0.95);
      });

    } catch (err) {
      console.error('[EXPORT] Error JPEG:', err);
      window.TOAST.error(t('export_error_jpeg', {msg: err.message}));
      throw err;
    }
  }

  // Los colores de fondo de exportación están centralizados en export-canvas.js
  // (BASEMAP_BG_COLORS). No duplicar acá.

  return { toJPEG };

})();
