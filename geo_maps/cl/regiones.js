/**
 * geo_maps/cl/regiones.js
 *
 * Normalización de nombres de regiones chilenas.
 * Mapea texto del usuario (normalizado, sin tildes) → valor exacto en el WFS del MOP.
 *
 * Campo de referencia: NOM_REG en MAPA_BASE/LIMITES/MapServer/0
 * Valores en MAYÚSCULAS — normalizar al consultar.
 *
 * Usado por GEO_MAPS en geo_maps/index.js.
 */

export const REGIONES_MAP_CL = {
  // Región de Arica y Parinacota (XV)
  'arica y parinacota':          { value: 'ARICA Y PARINACOTA' },
  'arica':                       { value: 'ARICA Y PARINACOTA' },
  'parinacota':                  { value: 'ARICA Y PARINACOTA' },
  'xv':                          { value: 'ARICA Y PARINACOTA' },

  // Región de Tarapacá (I)
  'tarapaca':                    { value: 'TARAPACÁ' },
  'tarapacá':                    { value: 'TARAPACÁ' },
  'i':                           { value: 'TARAPACÁ' },

  // Región de Antofagasta (II)
  'antofagasta':                 { value: 'ANTOFAGASTA' },
  'ii':                          { value: 'ANTOFAGASTA' },

  // Región de Atacama (III)
  'atacama':                     { value: 'ATACAMA' },
  'iii':                         { value: 'ATACAMA' },

  // Región de Coquimbo (IV)
  'coquimbo':                    { value: 'COQUIMBO' },
  'iv':                          { value: 'COQUIMBO' },

  // Región de Valparaíso (V)
  'valparaiso':                  { value: 'VALPARAÍSO' },
  'valparaíso':                  { value: 'VALPARAÍSO' },
  'v':                           { value: 'VALPARAÍSO' },

  // Región Metropolitana de Santiago (RM)
  'metropolitana':               { value: 'METROPOLITANA DE SANTIAGO' },
  'metropolitana de santiago':   { value: 'METROPOLITANA DE SANTIAGO' },
  'region metropolitana':        { value: 'METROPOLITANA DE SANTIAGO' },
  'región metropolitana':        { value: 'METROPOLITANA DE SANTIAGO' },
  'rm':                          { value: 'METROPOLITANA DE SANTIAGO' },
  'santiago':                    { value: 'METROPOLITANA DE SANTIAGO' },

  // Región del Libertador General Bernardo O'Higgins (VI)
  "o'higgins":                   { value: "LIBERTADOR GENERAL BERNARDO O'HIGGINS" },
  'ohiggins':                    { value: "LIBERTADOR GENERAL BERNARDO O'HIGGINS" },
  'libertador':                  { value: "LIBERTADOR GENERAL BERNARDO O'HIGGINS" },
  'libertador general bernardo ohiggins': { value: "LIBERTADOR GENERAL BERNARDO O'HIGGINS" },
  'vi':                          { value: "LIBERTADOR GENERAL BERNARDO O'HIGGINS" },

  // Región del Maule (VII)
  'maule':                       { value: 'MAULE' },
  'vii':                         { value: 'MAULE' },

  // Región de Ñuble (XVI)
  'nuble':                       { value: 'ÑUBLE' },
  'ñuble':                       { value: 'ÑUBLE' },
  'xvi':                         { value: 'ÑUBLE' },

  // Región del Biobío (VIII)
  'biobio':                      { value: 'BIOBÍO' },
  'biobío':                      { value: 'BIOBÍO' },
  'bio bio':                     { value: 'BIOBÍO' },
  'bío bío':                     { value: 'BIOBÍO' },
  'viii':                        { value: 'BIOBÍO' },

  // Región de La Araucanía (IX)
  'araucania':                   { value: 'LA ARAUCANÍA' },
  'araucanía':                   { value: 'LA ARAUCANÍA' },
  'la araucania':                { value: 'LA ARAUCANÍA' },
  'la araucanía':                { value: 'LA ARAUCANÍA' },
  'ix':                          { value: 'LA ARAUCANÍA' },

  // Región de Los Ríos (XIV)
  'los rios':                    { value: 'LOS RÍOS' },
  'los ríos':                    { value: 'LOS RÍOS' },
  'xiv':                         { value: 'LOS RÍOS' },

  // Región de Los Lagos (X)
  'los lagos':                   { value: 'LOS LAGOS' },
  'x':                           { value: 'LOS LAGOS' },

  // Región de Aysén (XI)
  'aysen':                       { value: 'AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO' },
  'aysén':                       { value: 'AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO' },
  'aisen':                       { value: 'AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO' },
  'aisén':                       { value: 'AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO' },
  'aysen del general carlos ibanez del campo': { value: 'AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO' },
  'xi':                          { value: 'AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO' },

  // Región de Magallanes (XII)
  'magallanes':                  { value: 'MAGALLANES Y DE LA ANTÁRTICA CHILENA' },
  'magallanes y de la antartica chilena': { value: 'MAGALLANES Y DE LA ANTÁRTICA CHILENA' },
  'magallanes y de la antártica chilena': { value: 'MAGALLANES Y DE LA ANTÁRTICA CHILENA' },
  'antartica':                   { value: 'MAGALLANES Y DE LA ANTÁRTICA CHILENA' },
  'antártica':                   { value: 'MAGALLANES Y DE LA ANTÁRTICA CHILENA' },
  'xii':                         { value: 'MAGALLANES Y DE LA ANTÁRTICA CHILENA' },
};
