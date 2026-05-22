/**
 * api/_turf.js — Imports centralizados de módulos Turf
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/buffer.js, api/intersect.js
 * y los nuevos endpoints espaciales: dissolve, within_layer,
 * adjacent, nearest.
 *
 * Por qué módulos individuales y no @turf/turf completo:
 *   @turf/turf depende de concaveman, que es ESM-only e incompatible
 *   con el runtime CommonJS de Vercel. Los módulos individuales
 *   son CJS-safe y solo cargan lo que se necesita.
 *
 * Cada módulo puede exportar de formas distintas según la versión,
 * así que se normaliza acá una sola vez.
 *
 * Para agregar un módulo nuevo:
 *   1. Agregarlo a package.json
 *   2. Agregarlo acá y exportarlo
 *   3. Importarlo en el endpoint que lo necesite
 *
 * Módulos actuales:
 *   boolean-point-in-polygon  → clip, intersect, buffer, within_layer, adjacent
 *   bbox                      → clip, intersect, buffer, within_layer
 *   intersect                 → clip, intersect, adjacent
 *   union                     → buffer, dissolve
 *   buffer (turfBuffer)       → buffer, within_layer
 *   line-split                → clip
 *   distance                  → within_layer, nearest
 *   centroid                  → within_layer, nearest (distancia a polígonos/líneas)
 *   boolean-touches           → adjacent
 */

const _boolMod        = require('@turf/boolean-point-in-polygon');
const _bboxMod        = require('@turf/bbox');
const _intersectMod   = require('@turf/intersect');
const _unionMod       = require('@turf/union');
const _bufferMod      = require('@turf/buffer');
const _lineSplitMod   = require('@turf/line-split');
const _distanceMod    = require('@turf/distance');
const _centroidMod    = require('@turf/centroid');
const _touchesMod     = require('@turf/boolean-touches');

module.exports = {
  booleanPointInPolygon: _boolMod.default       || _boolMod.booleanPointInPolygon || _boolMod,
  bbox:                  _bboxMod.default       || _bboxMod.bbox                  || _bboxMod,
  intersect:             _intersectMod.default  || _intersectMod.intersect        || _intersectMod,
  union:                 _unionMod.default      || _unionMod.union                || _unionMod,
  turfBuffer:            _bufferMod.default     || _bufferMod.buffer              || _bufferMod,
  lineSplit:             _lineSplitMod.default  || _lineSplitMod.lineSplit        || _lineSplitMod,
  distance:              _distanceMod.default   || _distanceMod.distance          || _distanceMod,
  centroid:              _centroidMod.default   || _centroidMod.centroid          || _centroidMod,
  booleanTouches:        _touchesMod.default    || _touchesMod.booleanTouches     || _touchesMod,
};
