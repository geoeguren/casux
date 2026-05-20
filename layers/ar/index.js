/**
 * layers/ar/index.js — Barrel de capas de Argentina
 *
 * Para agregar un nuevo organismo:
 *   1. Crear layers/ar/indec.js con sus capas
 *   2. Importarlo acá y agregarlo a AR_LAYERS
 *
 * Los diccionarios de normalización geográfica viven en geo_maps/ar/
 */

import { IGN_AR }  from './ign.js';
import { PNME_AR } from './pnme.js';

export const AR_LAYERS = {
  ...IGN_AR,
  ...PNME_AR,
  // Futuro: ...INDEC_AR, ...INTA_AR
};
