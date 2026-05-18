/**
 * geo_maps/ar/provincias.js
 *
 * Normalización de nombres de provincias argentinas.
 * Mapea texto del usuario (normalizado, sin tildes) → valor exacto en el WFS de IGN.
 *
 * Usado por GEO_MAPS en geo_maps/index.js.
 */

// Formato { value } — consistente con departamentos y localidades.
// 'provincia' es null porque las provincias son la unidad de primer orden
// y no pertenecen a ninguna subdivisión superior.
export const PROVINCIAS_MAP_AR = {
  'buenos aires':           { value: 'Buenos Aires',                                          provincia: null },
  'bsas':                   { value: 'Buenos Aires',                                          provincia: null },
  'caba':                   { value: 'Ciudad Autónoma de Buenos Aires',                       provincia: null },
  'ciudad autónoma':        { value: 'Ciudad Autónoma de Buenos Aires',                       provincia: null },
  'ciudad autonoma':        { value: 'Ciudad Autónoma de Buenos Aires',                       provincia: null },
  'ciudad de buenos aires': { value: 'Ciudad Autónoma de Buenos Aires',                       provincia: null },
  'catamarca':              { value: 'Catamarca',                                             provincia: null },
  'chaco':                  { value: 'Chaco',                                                 provincia: null },
  'chubut':                 { value: 'Chubut',                                                provincia: null },
  'córdoba':                { value: 'Córdoba',                                               provincia: null },
  'cordoba':                { value: 'Córdoba',                                               provincia: null },
  'corrientes':             { value: 'Corrientes',                                            provincia: null },
  'entre ríos':             { value: 'Entre Ríos',                                            provincia: null },
  'entre rios':             { value: 'Entre Ríos',                                            provincia: null },
  'formosa':                { value: 'Formosa',                                               provincia: null },
  'jujuy':                  { value: 'Jujuy',                                                 provincia: null },
  'la pampa':               { value: 'La Pampa',                                              provincia: null },
  'la rioja':               { value: 'La Rioja',                                              provincia: null },
  'mendoza':                { value: 'Mendoza',                                               provincia: null },
  'misiones':               { value: 'Misiones',                                              provincia: null },
  'neuquén':                { value: 'Neuquén',                                               provincia: null },
  'neuquen':                { value: 'Neuquén',                                               provincia: null },
  'río negro':              { value: 'Río Negro',                                             provincia: null },
  'rio negro':              { value: 'Río Negro',                                             provincia: null },
  'salta':                  { value: 'Salta',                                                 provincia: null },
  'san juan':               { value: 'San Juan',                                              provincia: null },
  'san luis':               { value: 'San Luis',                                              provincia: null },
  'santa cruz':             { value: 'Santa Cruz',                                            provincia: null },
  'santa fe':               { value: 'Santa Fe',                                              provincia: null },
  'santiago del estero':    { value: 'Santiago del Estero',                                   provincia: null },
  'tierra del fuego':       { value: 'Tierra del Fuego',                                        provincia: null },
  'tucumán':                { value: 'Tucumán',                                               provincia: null },
  'tucuman':                { value: 'Tucumán',                                               provincia: null },
};
