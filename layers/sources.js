/**
 * layers/sources.js — Registro de fuentes de datos geoespaciales
 *
 * Compatible con browser (window.SOURCES) y Node (module.exports).
 * Un solo archivo — al agregar una fuente nueva, solo tocar acá.
 *
 * Para agregar una fuente:
 *   1. Agregar su entrada en SOURCES_DATA
 *   2. Crear layers/[pais]/[organismo].js con las capas
 *   3. Importarlo en layers/[pais]/index.js
 */

const SOURCES_DATA = {

  ign_ar: {
    label:        'Instituto Geográfico Nacional',
    country:      'ar',
    countryLabel: 'Argentina',
    wfsBase:      'https://wms.ign.gob.ar/geoserver/ows',
    wfsVersion:   '1.1.0',
    geomField:    'the_geom',
    clipLayer:    'ign:provincia',
    clipField:    'nam',
    attribution:  'Instituto Geográfico Nacional (Argentina)',
    url:          'https://www.ign.gob.ar',
  },

  igm_uy: {
    label:        'Instituto Geográfico Militar',
    country:      'uy',
    countryLabel: 'Uruguay',
    wfsBase:      'https://sig.igm.gub.uy/geoserver/wfs',
    wfsVersion:   '1.1.0',
    geomField:    'the_geom',
    clipLayer:    'LimitesDepartamentalesA:LimitesDepartamentalesA',
    clipField:    'depto',
    attribution:  'Instituto Geográfico Militar (Uruguay)',
    url:          'https://www.igm.gub.uy',
  },

  mtop_uy: {
    label:        'Ministerio de Transporte y Obras Públicas',
    country:      'uy',
    countryLabel: 'Uruguay',
    wfsBase:      'https://geoservicios.mtop.gub.uy/geoserver/ows',
    wfsVersion:   '1.1.0',
    geomField:    'the_geom',
    clipLayer:    'geoportal_capas_base:departamentos',
    clipField:    'nombre',
    attribution:  'Ministerio de Transporte y Obras Públicas (Uruguay)',
    url:          'https://www.mtop.gub.uy',
  },

  mop_cl: {
    label:        'Ministerio de Obras Públicas',
    country:      'cl',
    countryLabel: 'Chile',
    restBase:     'https://rest-sit.mop.gob.cl/arcgis/rest/services',
    tipo:         'arcgis',
    attribution:  'Ministerio de Obras Públicas (Chile)',
    url:          'https://www.mop.gob.cl',
  },

};

// Browser: exponer como window.SOURCES (igual que antes)
// Node:    exponer via module.exports para api/health.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SOURCES_DATA };
} else {
  window.SOURCES = SOURCES_DATA;
}
