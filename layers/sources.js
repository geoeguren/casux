/**
 * sources.js — Registro de fuentes de datos geoespaciales
 *
 * Cada fuente define un organismo o servicio WFS.
 * Las capas en layers/[pais]/[organismo].js referencian su fuente
 * por clave (ej: 'ign_ar') para que wfs.js y clip.js sepan
 * a qué servidor ir y cómo hacer recortes espaciales.
 *
 * Para agregar una fuente nueva:
 *   1. Agregar su entrada acá
 *   2. Crear layers/[pais]/[organismo].js con las capas
 *   3. Importarlo en layers/[pais]/index.js
 *   4. No tocar nada más
 */

window.SOURCES = {

  ign_ar: {
    label:       'Instituto Geográfico Nacional',
    country:     'ar',
    countryLabel:'Argentina',
    wfsBase:     'https://wms.ign.gob.ar/geoserver/ows',
    wfsVersion:  '1.1.0',
    geomField:   'the_geom',       // campo de geometría para BBOX() en CQL
    // Capa usada para recortes espaciales (clip.js la busca cuando
    // clipStrategy === 'spatial' y hay una provincia en el pedido)
    clipLayer:   'ign:provincia',
    clipField:   'nam',            // campo de nombre normalizado (lowercase)
    attribution: 'Instituto Geográfico Nacional (Argentina)',
    url:         'https://www.ign.gob.ar',
  },

  igm_uy: {
    label:        'Instituto Geográfico Militar',
    country:      'uy',
    countryLabel: 'Uruguay',
    wfsBase:      'https://sig.igm.gub.uy/geoserver/wfs',
    wfsVersion:   '1.1.0',
    geomField:    'the_geom',      // campo de geometría para BBOX() en CQL
    clipLayer:    'LimitesDepartamentalesA:LimitesDepartamentalesA',
    clipField:    'depto',         // valores en MAYÚSCULAS — normalizar al consultar
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
    // clipLayer y clipField pendientes hasta implementar rest.js
    // y verificar campos de región en los datos reales
    attribution:  'Ministerio de Obras Públicas (Chile)',
    url:          'https://www.mop.gob.cl',
  },

};
