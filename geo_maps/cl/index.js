/**
 * geo_maps/cl/index.js — Barrel de geo_maps de Chile
 */

import { REGIONES_MAP_CL } from './regiones.js';
import { COMUNAS_MAP_CL }  from './comunas.js';

export { REGIONES_MAP_CL, COMUNAS_MAP_CL };

export const CL_GEO_MAPS = {
  regiones: REGIONES_MAP_CL,
  comunas:  COMUNAS_MAP_CL,
};
