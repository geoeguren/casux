/**
 * layers/cl/index.js — Barrel de Chile
 *
 * Exporta CL_LAYERS para que layers/index.js lo spreade en window.LAYERS.
 * Para agregar un organismo nuevo: importarlo acá y agregarlo al spread.
 */

import { MOP_CL } from './mop.js';

export const CL_LAYERS = {
  ...MOP_CL,
};
