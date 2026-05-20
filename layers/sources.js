/**
 * layers/sources.js — Registro de fuentes de datos geoespaciales
 *
 * Compatible con browser (window.SOURCES) y Node (module.exports).
 * Un solo archivo — al agregar una fuente nueva, solo tocar acá.
 *
 * Campos por fuente:
 *   label, country, countryLabel  → metadatos de display
 *   wfsBase | restBase            → URL del servicio (determina el tipo)
 *   wfsVersion, geomField         → parámetros WFS
 *   clipLayer, clipField          → capa y campo para clip espacial
 *   attribution, url              → créditos y enlace institucional
 *   domain (opcional)             → array de términos que definen las temáticas
 *                                   sobre las que esta fuente es autoridad primaria.
 *                                   Se compara (normalizado) contra las keywords de
 *                                   cada capa para resolver empates en el scorer.
 *                                   IGN/IGM no lo declaran → son 'secondary' por defecto.
 *
 * Para agregar una fuente:
 *   1. Agregar su entrada acá (con domain si aplica)
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
    // Temáticas sobre las que MTOP es autoridad primaria.
    // Cualquier capa de esta fuente cuyas keywords incluyan alguno de estos
    // términos (normalizados) será considerada 'primary' en el desempate.
    domain: ['vialidad', 'rutas', 'ruta', 'camino', 'camineria', 'ferroviario',
             'ferrocarril', 'puente', 'puentes', 'transporte', 'peaje',
             'aeropuerto', 'puerto', 'zona franca'],
  },

  se_ar: {
    label:        'Secretaría de Educación',
    country:      'ar',
    countryLabel: 'Argentina',
    wfsBase:      'https://mapa.educacion.gob.ar/geoserver/ows',
    wfsVersion:   '1.1.0',
    geomField:    'the_geom',
    clipLayer:    'ign:provincia',
    clipField:    'nam',
    attribution:  'Secretaría de Educación (Argentina)',
    url:          'https://www.argentina.gob.ar/educacion',
    domain: [
      // Establecimientos preuniversitarios
      'educación', 'educacion', 'escuela', 'escuelas', 'colegio', 'colegios',
      'instituto', 'institutos', 'jardín', 'jardin', 'jardines',
      'establecimiento educativo', 'establecimientos educativos',
      'nivel educativo', 'modalidad educativa', 'mapa educativo',
      // Educación superior y universitaria
      'universidad', 'universidades', 'universitario', 'universitaria',
      'facultad', 'facultades', 'unidad académica', 'unidad academica',
      'educación superior', 'educacion superior', 'nivel superior',
      'formación superior', 'formacion superior',
      'sede universitaria', 'instituto universitario',
      // Organismos
      'ministerio de educación', 'ministerio de educacion',
    ],
  },

  mop_cl: {
    label:        'Ministerio de Obras Públicas',
    country:      'cl',
    countryLabel: 'Chile',
    restBase:     'https://rest-sit.mop.gob.cl/arcgis/rest/services',
    tipo:         'arcgis',
    attribution:  'Ministerio de Obras Públicas (Chile)',
    url:          'https://www.mop.gob.cl',
    // MOP Chile es autoridad en infraestructura vial, hídrica, aeroportuaria y portuaria.
    domain: ['vialidad', 'rutas', 'ruta', 'camino', 'puente', 'puentes',
             'aeropuerto', 'puerto', 'hidrico', 'embalse', 'agua potable',
             'concesion', 'transporte'],
  },

};

// Browser: exponer como window.SOURCES (igual que antes)
// Node:    exponer via module.exports para api/health.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SOURCES_DATA };
} else {
  window.SOURCES = SOURCES_DATA;
}
