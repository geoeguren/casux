/**
 * geo_maps/cl/macroregiones.js
 *
 * Macrorregiones informales de Chile.
 * Cada macroregión mapea a un array de regiones exactamente como las devuelve el WFS del MOP
 * (campo 'NOM_REG' de la capa MAPA_BASE_LIMITES_MapServer_0_cl, en MAYÚSCULAS).
 *
 * Formato: { value: ['REGIÓN1', 'REGIÓN2', ...] }
 *
 * Nivel 2 (mismo que regiones chilenas).
 * Tipo 'region' para distinguirlas de 'region' (las regiones administrativas reales).
 * Nota: se usa 'macroregion' como tipo para evitar colisión con las regiones individuales.
 *
 * Usado por GEO_MAPS en geo_maps/index.js.
 */

export const MACROREGIONES_MAP_CL = {

  // ── Norte Grande ──────────────────────────────────────────────
  'norte grande': {
    value: ['ARICA Y PARINACOTA', 'TARAPACÁ', 'ANTOFAGASTA'],
  },
  'norte grande de chile': { value: ['ARICA Y PARINACOTA', 'TARAPACÁ', 'ANTOFAGASTA'] },

  // ── Norte Chico ───────────────────────────────────────────────
  'norte chico': {
    value: ['ATACAMA', 'COQUIMBO'],
  },
  'norte chico de chile': { value: ['ATACAMA', 'COQUIMBO'] },

  // ── Norte (combinado) ─────────────────────────────────────────
  // Se usa cuando el usuario dice solo "norte de Chile" sin especificar grande/chico
  'norte de chile': {
    value: ['ARICA Y PARINACOTA', 'TARAPACÁ', 'ANTOFAGASTA', 'ATACAMA', 'COQUIMBO'],
  },
  'norte chileno': { value: ['ARICA Y PARINACOTA', 'TARAPACÁ', 'ANTOFAGASTA', 'ATACAMA', 'COQUIMBO'] },

  // ── Zona Central ──────────────────────────────────────────────
  'zona central': {
    value: ['VALPARAÍSO', 'METROPOLITANA DE SANTIAGO', "LIBERTADOR GENERAL BERNARDO O'HIGGINS", 'MAULE'],
  },
  'zona central de chile': { value: ['VALPARAÍSO', 'METROPOLITANA DE SANTIAGO', "LIBERTADOR GENERAL BERNARDO O'HIGGINS", 'MAULE'] },
  'chile central':         { value: ['VALPARAÍSO', 'METROPOLITANA DE SANTIAGO', "LIBERTADOR GENERAL BERNARDO O'HIGGINS", 'MAULE'] },
  'centro de chile':       { value: ['VALPARAÍSO', 'METROPOLITANA DE SANTIAGO', "LIBERTADOR GENERAL BERNARDO O'HIGGINS", 'MAULE'] },
  'central':               { value: ['VALPARAÍSO', 'METROPOLITANA DE SANTIAGO', "LIBERTADOR GENERAL BERNARDO O'HIGGINS", 'MAULE'] },

  // ── Sur ───────────────────────────────────────────────────────
  'sur de chile': {
    value: ['ÑUBLE', 'BIOBÍO', 'LA ARAUCANÍA', 'LOS RÍOS', 'LOS LAGOS'],
  },
  'sur chileno':  { value: ['ÑUBLE', 'BIOBÍO', 'LA ARAUCANÍA', 'LOS RÍOS', 'LOS LAGOS'] },
  'zona sur':     { value: ['ÑUBLE', 'BIOBÍO', 'LA ARAUCANÍA', 'LOS RÍOS', 'LOS LAGOS'] },
  'macrozona sur':{ value: ['ÑUBLE', 'BIOBÍO', 'LA ARAUCANÍA', 'LOS RÍOS', 'LOS LAGOS'] },

  // ── La Frontera / Araucanía ───────────────────────────────────
  'la frontera': { value: ['LA ARAUCANÍA'] },
  'araucania':   { value: ['LA ARAUCANÍA'] },

  // ── Austral / Patagonia chilena ───────────────────────────────
  'austral': {
    value: ['AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO', 'MAGALLANES Y DE LA ANTÁRTICA CHILENA'],
  },
  'zona austral':        { value: ['AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO', 'MAGALLANES Y DE LA ANTÁRTICA CHILENA'] },
  'patagonia chilena':   { value: ['AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO', 'MAGALLANES Y DE LA ANTÁRTICA CHILENA'] },
  'patagonia de chile':  { value: ['AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO', 'MAGALLANES Y DE LA ANTÁRTICA CHILENA'] },
  'extremo sur':         { value: ['AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO', 'MAGALLANES Y DE LA ANTÁRTICA CHILENA'] },
  'extremo sur de chile':{ value: ['AISÉN DEL GENERAL CARLOS IBAÑEZ DEL CAMPO', 'MAGALLANES Y DE LA ANTÁRTICA CHILENA'] },

  // ── Región de los Lagos (alias común) ────────────────────────
  'los lagos y los rios': { value: ['LOS RÍOS', 'LOS LAGOS'] },
  'region de los lagos y los rios': { value: ['LOS RÍOS', 'LOS LAGOS'] },

};
