/**
 * geo_maps/TEMPLATE.js — Punto de partida para un país nuevo
 *
 * Copiar como geo_maps/[pais]/index.js y completar.
 * Ver FORMATO.md para la documentación completa del formato.
 *
 * Pasos:
 *   1. Copiar este archivo a geo_maps/[pais]/index.js
 *   2. Renombrar XX_GEO_MAPS → [PAIS]_GEO_MAPS (ej: CL_GEO_MAPS)
 *   3. Crear los archivos de diccionario (provincias.js, etc.)
 *   4. Importarlos acá y agregarlos a [PAIS]_GEO_MAPS
 *   5. Agregar la entrada en geo_maps/index.js
 */

// import { PROVINCIAS_MAP_XX }    from './provincias.js';
// import { DEPARTAMENTOS_MAP_XX } from './departamentos.js';
// import { LOCALIDADES_MAP_XX }   from './localidades.js';   // generado por script

// export { PROVINCIAS_MAP_XX, DEPARTAMENTOS_MAP_XX, LOCALIDADES_MAP_XX };

export const XX_GEO_MAPS = {

  // ── Primera subdivisión (nivel 2) ──────────────────────────
  // Ej: provincias, estados, regiones, departamentos nacionales
  //
  // provincias: PROVINCIAS_MAP_XX,

  // ── Segunda subdivisión (nivel 3) ─────────────────────────
  // Ej: departamentos, municipios, cantones
  //
  // departamentos: DEPARTAMENTOS_MAP_XX,

  // ── Tercera subdivisión (nivel 4) ─────────────────────────
  // Ej: localidades, parroquias, distritos
  //
  // localidades: LOCALIDADES_MAP_XX,

};

/**
 * Entrada en geo_maps/index.js — agregar esto:
 *
 * xx: {
 *   provincias: {
 *     valores:  XX_GEO_MAPS.provincias,
 *     layerKey: 'provincia_xx',   // ← debe existir en window.LAYERS
 *     tipo:     'provincia',
 *     nivel:    2,
 *   },
 *   departamentos: {
 *     valores:  XX_GEO_MAPS.departamentos,
 *     layerKey: 'departamento_xx',
 *     tipo:     'departamento',
 *     nivel:    3,
 *   },
 *   localidades: {
 *     valores:  XX_GEO_MAPS.localidades,
 *     layerKey: 'localidad_xx',
 *     tipo:     'localidad',
 *     nivel:    4,
 *   },
 * },
 */

/**
 * Ejemplo de diccionario mínimo (provincias.js):
 *
 * export const PROVINCIAS_MAP_XX = {
 *   // Entrada única
 *   'santiago': { provincia: null, value: 'Santiago' },
 *   'valparaiso': { provincia: null, value: 'Valparaíso' },
 *
 *   // Entrada ambigua (mismo nombre en varios países o niveles)
 *   'san jose': [
 *     { provincia: null, value: 'San José' },
 *     { provincia: null, value: 'San José de la Montaña' },
 *   ],
 * };
 */
