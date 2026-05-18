/**
 * export.js — Punto de entrada de exportación
 *
 * Delega a los módulos especializados:
 *   export-utils.js   — utilidades compartidas
 *   export-canvas.js  — captura y composición de canvas (JPEG)
 *   export-jpeg.js    — exportación a JPEG
 *   export-pdf.js     — exportación a PDF
 *   export-html.js    — exportación a HTML interactivo
 *   export-geojson.js — exportación a GeoJSON
 *
 * Los módulos deben cargarse en ese orden en index.html ANTES de este archivo.
 */

window.EXPORT = (() => {

  // Detectar móvil una sola vez al cargar el módulo.
  // JPEG usa canvas de 35 MB+ que supera el límite de memoria GPU de Chrome Android.
  const _isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
                  || window.innerWidth < 768;

  function _mobileBlock() {
    window.TOAST.warning(t('export_jpeg_mobile_unsupported'));
    return Promise.reject('mobile unsupported');
  }

  function toGeoJSON() { return window.EXPORT_GEOJSON.toGeoJSON(); }
  function toJPEG(opciones)    { return window.EXPORT_JPEG.toJPEG(opciones); }
  function toPDF(opciones)     { return window.EXPORT_PDF.toPDF(opciones); }
  function toHTML()    { return window.EXPORT_HTML.toHTML(); }

  return { toGeoJSON, toJPEG, toPDF, toHTML, isMobile: _isMobile };

})();
