/**
 * geo_maps/index.js — Punto de entrada del sistema de normalización geográfica
 *
 * Importa los diccionarios de cada país y construye window.GEO_MAPS.
 *
 * Estructura de GEO_MAPS:
 *   window.GEO_MAPS = {
 *     [pais]: {
 *       [tipo]: {
 *         valores:  { 'nombre normalizado': 'Valor Exacto WFS' | [...ambiguos] },
 *         layerKey: clave en window.LAYERS de la capa que representa esta unidad,
 *         tipo:     nombre del tipo geográfico ('provincia', 'departamento', etc.)
 *         nivel:    jerarquía administrativa (1 = más alto/general, 2, 3...)
 *                   Convención:
 *                     1 = nación / estado soberano
 *                     2 = primera subdivisión (provincia, estado, región)
 *                     3 = segunda subdivisión (departamento, municipio, cantón)
 *                     4 = tercera subdivisión (localidad, parroquia, etc.)
 *       }
 *     }
 *   }
 *
 * Para agregar un nuevo país:
 *   1. Crear geo_maps/{pais}/ con sus diccionarios
 *   2. Importar el GEO_MAPS del país acá
 *   3. Agregar la entrada en window.GEO_MAPS
 *
 * intent.js itera dinámicamente sobre todos los países y tipos.
 */

import { AR_GEO_MAPS } from './ar/index.js';
import { UY_GEO_MAPS } from './uy/index.js';
import { CL_GEO_MAPS } from './cl/index.js';

window.GEO_MAPS = {
  ar: {
    // nivel 2: primera subdivisión de Argentina
    provincias: {
      valores:  AR_GEO_MAPS.provincias,
      layerKey: 'provincia_ar',
      tipo:     'provincia',
      nivel:    2,
    },
    // nivel 2: regiones informales de Argentina (agrupan provincias)
    // Cada entrada tiene value:[...] con las provincias que componen la región.
    // El scorer las prefiere sobre localidades (nivel 4) pero no sobre provincias
    // cuando el hint de tipo dice 'provincia'.
    regiones: {
      valores:  AR_GEO_MAPS.regiones,
      layerKey: 'provincia_ar',
      tipo:     'region',
      nivel:    2,
    },
    // nivel 3: segunda subdivisión de Argentina (departamentos/partidos)
    departamentos: {
      valores:  AR_GEO_MAPS.departamentos,
      layerKey: 'departamento_ar',
      tipo:     'departamento',
      nivel:    3,
    },
    // nivel 3: municipios (gobiernos locales — misma jerarquía que departamentos)
    // Se registran en nivel 3 junto a departamentos. El scorer desambigua
    // entre ambos por contexto o elige el de mayor score.
    municipios: {
      valores:  AR_GEO_MAPS.municipios,
      layerKey: 'municipio_ar',
      tipo:     'municipio',
      nivel:    3,
    },
    // nivel 4: localidades (puntos poblados)
    localidades: {
      valores:  AR_GEO_MAPS.localidades,
      layerKey: 'localidad_ar',
      tipo:     'localidad',
      nivel:    4,
    },
  },
  uy: {
    // nivel 2: departamentos de Uruguay (primera subdivisión)
    departamentos: {
      valores:  UY_GEO_MAPS.departamentos,
      layerKey: 'departamento_uy',
      tipo:     'departamento',
      nivel:    2,
    },
    // nivel 2: regiones informales de Uruguay (agrupan departamentos)
    regiones: {
      valores:  UY_GEO_MAPS.regiones,
      layerKey: 'departamentos_uy',
      tipo:     'region',
      nivel:    2,
    },
    // nivel 3: municipios de Uruguay
    municipios: {
      valores:  UY_GEO_MAPS.municipios,
      layerKey: 'municipio_uy',
      tipo:     'municipio',
      nivel:    3,
    },
  },
  cl: {
    // nivel 2: regiones de Chile (primera subdivisión)
    regiones: {
      valores:  CL_GEO_MAPS.regiones,
      layerKey: 'MAPA_BASE_LIMITES_MapServer_0_cl',
      tipo:     'region',
      nivel:    2,
    },
    // nivel 2: macroregiones informales de Chile (agrupan regiones)
    macroregiones: {
      valores:  CL_GEO_MAPS.macroregiones,
      layerKey: 'MAPA_BASE_LIMITES_MapServer_0_cl',
      tipo:     'macroregion',
      nivel:    2,
    },
    // nivel 3: comunas de Chile
    comunas: {
      valores:  CL_GEO_MAPS.comunas,
      layerKey: 'MAPA_BASE_LIMITES_MapServer_2_cl',
      tipo:     'comuna',
      nivel:    3,
    },
  },
};
