/**
 * geo_maps/ar/index.js — Barrel de geo_maps de Argentina
 */

import { PROVINCIAS_MAP_AR }    from './provincias.js';
import { DEPARTAMENTOS_MAP_AR } from './departamentos.js';
import { LOCALIDADES_MAP_AR }   from './localidades.js';
import { MUNICIPIOS_MAP_AR }    from './municipios.js';
import { REGIONES_MAP_AR }      from './regiones.js';

export { PROVINCIAS_MAP_AR, DEPARTAMENTOS_MAP_AR, LOCALIDADES_MAP_AR, MUNICIPIOS_MAP_AR, REGIONES_MAP_AR };

export const AR_GEO_MAPS = {
  provincias:    PROVINCIAS_MAP_AR,
  departamentos: DEPARTAMENTOS_MAP_AR,
  localidades:   LOCALIDADES_MAP_AR,
  municipios:    MUNICIPIOS_MAP_AR,
  regiones:      REGIONES_MAP_AR,
};
