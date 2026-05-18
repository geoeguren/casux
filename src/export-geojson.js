/**
 * export-geojson.js
 * Depende de: export-utils.js
 */

window.EXPORT_GEOJSON = (() => {

  const _u = () => window.EXPORT_UTILS;
  const downloadBlob     = (...a) => _u().downloadBlob(...a);
  const sanitizeFilename = (...a) => _u().sanitizeFilename(...a);


  function toGeoJSON() {
    const activeLayers = window.MAP.getActiveLayers();
    const keys = Object.keys(activeLayers);
    if (!keys.length) { window.TOAST.warning(t('export_no_layers')); return Promise.reject('sin capas'); }

    const allFeatures = keys.flatMap(key => {
      const { geojson, titulo } = activeLayers[key];
      return (geojson.features || []).map(f => ({
        ...f,
        properties: { ...f.properties, _layer: titulo }
      }));
    });

    const fc = {
      type:     'FeatureCollection',
      name:     document.getElementById('map-title')?.value || 'casux-export',
      features: allFeatures
    };

    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
    downloadBlob(blob, `${sanitizeFilename(fc.name)}.geojson`);
    window.TOAST.success(t('export_done_geojson'));
    return Promise.resolve();
  }


  return { toGeoJSON };

})();
