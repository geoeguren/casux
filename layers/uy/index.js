/**
 * layers/uy/index.js — Barrel de capas de Uruguay
 *
 * Para agregar un nuevo organismo:
 *   1. Crear layers/uy/mvotma.js (u otro) con sus capas
 *   2. Importarlo acá y agregarlo a UY_LAYERS
 *
 * Los diccionarios de normalización geográfica viven en geo_maps/uy/
 */

import { IGM_UY }  from './igm.js';
import { MTOP_UY } from './mtop.js';

export const UY_LAYERS = {
  ...IGM_UY,
  ...MTOP_UY,
  // Futuro: ...MVOTMA_UY, ...INE_UY
};
