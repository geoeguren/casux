/**
 * geo_maps/uy/index.js — Barrel de geo_maps de Uruguay
 */

import { DEPARTAMENTOS_MAP_UY } from './departamentos.js';
import { MUNICIPIOS_MAP_UY }    from './municipios.js';

export { DEPARTAMENTOS_MAP_UY, MUNICIPIOS_MAP_UY };

export const UY_GEO_MAPS = {
  departamentos: DEPARTAMENTOS_MAP_UY,
  municipios:    MUNICIPIOS_MAP_UY,
};
