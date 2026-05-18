/**
 * api/_turf.js — Imports centralizados de módulos Turf
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/buffer.js y api/intersect.js.
 *
 * Por qué módulos individuales y no @turf/turf completo:
 *   @turf/turf depende de concaveman, que es ESM-only e incompatible
 *   con el runtime CommonJS de Vercel. Los módulos individuales
 *   son CJS-safe y solo cargan lo que se necesita.
 *
 * Cada módulo puede exportar de formas distintas según la versión,
 * así que se normaliza acá una sola vez.
 *
 * Para agregar un módulo nuevo (ej: @turf/area):
 *   1. Agregarlo a package.json
 *   2. Agregarlo acá y exportarlo
 *   3. Importarlo en el endpoint que lo necesite
 */

const _boolMod      = require('@turf/boolean-point-in-polygon');
const _bboxMod      = require('@turf/bbox');
const _intersectMod = require('@turf/intersect');
const _unionMod     = require('@turf/union');
const _bufferMod    = require('@turf/buffer');
const _lineSplitMod = require('@turf/line-split');

module.exports = {
  booleanPointInPolygon: _boolMod.default      || _boolMod.booleanPointInPolygon || _boolMod,
  bbox:                  _bboxMod.default      || _bboxMod.bbox                  || _bboxMod,
  intersect:             _intersectMod.default  || _intersectMod.intersect        || _intersectMod,
  union:                 _unionMod.default     || _unionMod.union                || _unionMod,
  turfBuffer:            _bufferMod.default    || _bufferMod.buffer              || _bufferMod,
  lineSplit:             _lineSplitMod.default  || _lineSplitMod.lineSplit        || _lineSplitMod,
};
