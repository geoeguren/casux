/**
 * geo_maps/uy/regiones.js
 *
 * Regiones informales de Uruguay.
 * Cada región mapea a un array de departamentos exactamente como los devuelve el WFS de MTOP
 * (campo 'nombre' de la capa departamentos_uy, en MAYÚSCULAS).
 *
 * Formato: { value: ['DEPTO1', 'DEPTO2', ...] }
 *
 * Nivel 2 (mismo que departamentos uruguayos).
 * Tipo 'region' para distinguirlos de 'departamento'.
 *
 * Usado por GEO_MAPS en geo_maps/index.js.
 */

export const REGIONES_MAP_UY = {

  // ── Sur ───────────────────────────────────────────────────────
  'sur': {
    value: ['MONTEVIDEO', 'CANELONES', 'MALDONADO', 'SAN JOSÉ', 'COLONIA', 'SORIANO', 'FLORES', 'FLORIDA'],
  },
  'sur de uruguay': { value: ['MONTEVIDEO', 'CANELONES', 'MALDONADO', 'SAN JOSÉ', 'COLONIA', 'SORIANO', 'FLORES', 'FLORIDA'] },
  'region sur':     { value: ['MONTEVIDEO', 'CANELONES', 'MALDONADO', 'SAN JOSÉ', 'COLONIA', 'SORIANO', 'FLORES', 'FLORIDA'] },

  // ── Norte ─────────────────────────────────────────────────────
  'norte': {
    value: ['ARTIGAS', 'RIVERA', 'SALTO', 'PAYSANDÚ', 'TACUAREMBÓ'],
  },
  'norte de uruguay': { value: ['ARTIGAS', 'RIVERA', 'SALTO', 'PAYSANDÚ', 'TACUAREMBÓ'] },
  'region norte':     { value: ['ARTIGAS', 'RIVERA', 'SALTO', 'PAYSANDÚ', 'TACUAREMBÓ'] },

  // ── Litoral ───────────────────────────────────────────────────
  // Frente al río Uruguay
  'litoral': {
    value: ['SALTO', 'PAYSANDÚ', 'RÍO NEGRO', 'SORIANO', 'COLONIA'],
  },
  'litoral uruguayo': { value: ['SALTO', 'PAYSANDÚ', 'RÍO NEGRO', 'SORIANO', 'COLONIA'] },

  // ── Este ──────────────────────────────────────────────────────
  'este': {
    value: ['ROCHA', 'TREINTA Y TRES', 'CERRO LARGO', 'LAVALLEJA', 'MALDONADO'],
  },
  'este de uruguay': { value: ['ROCHA', 'TREINTA Y TRES', 'CERRO LARGO', 'LAVALLEJA', 'MALDONADO'] },
  'region este':     { value: ['ROCHA', 'TREINTA Y TRES', 'CERRO LARGO', 'LAVALLEJA', 'MALDONADO'] },

  // ── Centro ────────────────────────────────────────────────────
  'centro': {
    value: ['DURAZNO', 'TACUAREMBÓ', 'FLORIDA', 'FLORES'],
  },
  'centro de uruguay': { value: ['DURAZNO', 'TACUAREMBÓ', 'FLORIDA', 'FLORES'] },

  // ── Metropolitana ─────────────────────────────────────────────
  'metropolitana':           { value: ['MONTEVIDEO', 'CANELONES'] },
  'area metropolitana':      { value: ['MONTEVIDEO', 'CANELONES'] },
  'metropolitano':           { value: ['MONTEVIDEO', 'CANELONES'] },
  'gran montevideo':         { value: ['MONTEVIDEO', 'CANELONES'] },

};
