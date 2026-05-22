/**
 * geo_maps/ar/regiones.js
 *
 * Regiones informales de Argentina.
 * Cada región mapea a un array de provincias exactamente como las devuelve el WFS de IGN
 * (campo 'nam' de la capa provincia_ar).
 *
 * Formato: { value: ['Provincia1', 'Provincia2', ...] }
 * El valor 'value' puede ser un array — resolverAreaFeature en spatial.js lo maneja
 * iterando cada elemento y uniendo los features resultantes.
 *
 * Nivel 2 (mismo que provincias) porque las regiones agrupan unidades de nivel 2.
 * Tipo 'region' para distinguirlas de 'provincia' en el hint de tipo.
 *
 * Usado por GEO_MAPS en geo_maps/index.js.
 */

export const REGIONES_MAP_AR = {

  // ── Patagonia ─────────────────────────────────────────────────
  'patagonia': {
    value: ['Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'],
  },
  'patagonica': { value: ['Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'] },
  'patagonicas': { value: ['Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'] },
  'patagonico': { value: ['Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'] },
  'patagonicos': { value: ['Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'] },

  // ── NOA — Noroeste Argentino ──────────────────────────────────
  'noa': {
    value: ['Jujuy', 'Salta', 'Tucumán', 'Santiago del Estero', 'Catamarca', 'La Rioja'],
  },
  'noroeste': { value: ['Jujuy', 'Salta', 'Tucumán', 'Santiago del Estero', 'Catamarca', 'La Rioja'] },
  'noroeste argentino': { value: ['Jujuy', 'Salta', 'Tucumán', 'Santiago del Estero', 'Catamarca', 'La Rioja'] },

  // ── NEA — Noreste Argentino ───────────────────────────────────
  'nea': {
    value: ['Misiones', 'Corrientes', 'Entre Ríos', 'Chaco', 'Formosa'],
  },
  'noreste': { value: ['Misiones', 'Corrientes', 'Entre Ríos', 'Chaco', 'Formosa'] },
  'noreste argentino': { value: ['Misiones', 'Corrientes', 'Entre Ríos', 'Chaco', 'Formosa'] },

  // ── Cuyo ──────────────────────────────────────────────────────
  'cuyo': {
    value: ['Mendoza', 'San Juan', 'San Luis'],
  },
  'cuyano': { value: ['Mendoza', 'San Juan', 'San Luis'] },
  'cuyanos': { value: ['Mendoza', 'San Juan', 'San Luis'] },
  'cuyanas': { value: ['Mendoza', 'San Juan', 'San Luis'] },

  // ── Mesopotamia ───────────────────────────────────────────────
  'mesopotamia': {
    value: ['Entre Ríos', 'Corrientes', 'Misiones'],
  },
  'mesopotamica': { value: ['Entre Ríos', 'Corrientes', 'Misiones'] },
  'mesopotamicas': { value: ['Entre Ríos', 'Corrientes', 'Misiones'] },

  // ── Litoral ───────────────────────────────────────────────────
  // Definición más común: provincias con frente al Paraná/Uruguay
  'litoral': {
    value: ['Entre Ríos', 'Corrientes', 'Misiones', 'Chaco', 'Formosa', 'Santa Fe'],
  },
  'litoraleno': { value: ['Entre Ríos', 'Corrientes', 'Misiones', 'Chaco', 'Formosa', 'Santa Fe'] },
  'litoralena': { value: ['Entre Ríos', 'Corrientes', 'Misiones', 'Chaco', 'Formosa', 'Santa Fe'] },

  // ── Pampeana / Región Pampeana ────────────────────────────────
  'pampa':     { value: ['Buenos Aires', 'Córdoba', 'Santa Fe', 'La Pampa', 'Entre Ríos'] },
  'pampeana':  { value: ['Buenos Aires', 'Córdoba', 'Santa Fe', 'La Pampa', 'Entre Ríos'] },
  'pampeanas': { value: ['Buenos Aires', 'Córdoba', 'Santa Fe', 'La Pampa', 'Entre Ríos'] },
  'pampeano':  { value: ['Buenos Aires', 'Córdoba', 'Santa Fe', 'La Pampa', 'Entre Ríos'] },
  'pampeanos': { value: ['Buenos Aires', 'Córdoba', 'Santa Fe', 'La Pampa', 'Entre Ríos'] },
  'region pampeana': { value: ['Buenos Aires', 'Córdoba', 'Santa Fe', 'La Pampa', 'Entre Ríos'] },

  // ── Puna ──────────────────────────────────────────────────────
  'puna': {
    value: ['Jujuy', 'Salta', 'Catamarca'],
  },

  // ── Gran Buenos Aires / Conurbano ─────────────────────────────
  // Nota: no es una provincia — se mapea a la provincia de Buenos Aires
  // como mejor aproximación disponible en el catálogo.
  'gran buenos aires': { value: ['Buenos Aires'] },
  'conurbano':         { value: ['Buenos Aires'] },
  'bonaerense':        { value: ['Buenos Aires'] },
  'bonaerenses':       { value: ['Buenos Aires'] },

  // ── Centro ───────────────────────────────────────────────────
  'centro': {
    value: ['Córdoba', 'Santa Fe', 'Entre Ríos'],
  },
  'region centro': { value: ['Córdoba', 'Santa Fe', 'Entre Ríos'] },

};
