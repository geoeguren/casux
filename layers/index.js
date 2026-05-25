/**
 * layers/index.js — Punto de entrada del catálogo de capas
 *
 * Único archivo de capas que carga index.html (con type="module").
 * Para agregar un país nuevo:
 *   1. Crear layers/[pais]/index.js con sus capas
 *   2. Importarlo acá y agregarlo a window.LAYERS
 *   3. index.html no cambia nunca
 */

import { AR_LAYERS } from './ar/index.js';
import { UY_LAYERS } from './uy/index.js';
import { CL_LAYERS } from './cl/index.js';
import '../geo_maps/index.js'; // construye window.GEO_MAPS

window.LAYERS = {
  ...AR_LAYERS,
  ...UY_LAYERS,
  ...CL_LAYERS,
};

/**
 * Umbrales de features por estrategia de clip.
 * Centralizado acá — no hardcodeado en cada capa.
 *
 * display: máximo features para mostrar la capa en el camino principal (servidor).
 *   En mobile, map-controls.js lo baja dinámicamente a 5000 cuando se abre el mapa
 *   — protege el fallback al cliente en dispositivos con memoria y conexión limitadas.
 *   En desktop el fallback al cliente aguanta hasta ~30000 features;
 *   el valor de 50000 aplica cuando el servidor procesa correctamente.
 *   Ajustar si se migra a Vercel Pro (timeout 60s → se puede subir más).
 *
 * spatial eliminado — el recorte geométrico ahora lo hace el servidor (Vercel),
 *   no el cliente. No hay límite de features para operaciones espaciales.
 */
// ── Umbrales de display (qué capas se pueden mostrar) ─────────────────────
//
// La señal primaria es fileSizeKb (peso real del GeoJSON descargado).
// Si la capa no declara fileSizeKb, se usa featureCount como fallback.
//
// Lógica (aplicada en spatial.js, intent-validar.js y map-controls.js):
//
//   display:          límite en KB para desktop  → bloquea si fileSizeKb > 80 000 KB (80 MB)
//   displayFcFallback: límite en features para desktop cuando no hay fileSizeKb → 100 000
//   displayMobile:    límite en KB para móvil    → bloquea si fileSizeKb > 15 000 KB (15 MB)
//   displayMobileFcFallback: límite features para móvil sin fileSizeKb → 20 000
//
// Por qué estos valores:
//   - 80 MB desktop: límite práctico del parser JSON del browser sin freezear el hilo
//     principal en hardware de gama media (>3 s de bloqueo). Leaflet también empieza
//     a tener problemas de renderizado de polígonos complejos a partir de ese peso.
//   - 15 MB móvil: en mobile la memoria disponible y la CPU son más limitadas.
//     Representa ~40 K polígonos simples o ~5 K polígonos medianos, manejable.
//   - fc fallback 100 K / 20 K: para capas sin fileSizeKb (principalmente fuentes
//     ArcGIS REST de Chile que tienden a features simples). Más conservador en móvil.
//
// Antes: un único umbral `display: 55000` basado solo en featureCount.
// Problema: 13 K polígonos hidrológicos de 115 M vértices pesaban 3 GB y pasaban,
// mientras que 64 K puntos simples de 35 MB quedaban bloqueados incorrectamente.
//
// COBERTURA: 68% de las capas tienen fileSizeKb. El 32% restante (principalmente
// mop.js de Chile) usa el fallback de featureCount hasta que se completen los campos.
window.CLIP_THRESHOLDS = {
  display:                  80_000,  // KB — bloquea si fileSizeKb > 80 MB (desktop)
  displayFcFallback:       100_000,  // features — fallback cuando no hay fileSizeKb (desktop)
  displayFcHard:            55_000,  // features — límite duro de features independiente del peso
  //
  // displayFcHard existe porque fileSizeKb no captura el costo de renderizado en Leaflet.
  // Una capa con 84K líneas de 34 MB (huella_ar) pesa poco pero cuelga el browser porque
  // Leaflet debe crear y mantener 84K objetos SVG en el DOM.
  // Benchmarks empíricos: líneas/puntos > ~55K features → degradación severa en hardware medio.
  // Esta restricción se aplica ADEMÁS del límite de peso (OR lógico, no AND):
  //   bloquear si fileSizeKb > 80 MB  OR  featureCount > 55 000
  //
  displayMobile:            15_000,  // KB — bloquea si fileSizeKb > 15 MB (móvil)
  displayMobileFcFallback:  20_000,  // features — fallback móvil sin fileSizeKb
  displayMobileFcHard:      20_000,  // features — límite duro móvil (coincide con fallback)
};

// ── Umbral de clasificación de campos ──────────────────────────────────────
//
// Si un campo tiene más de este número de valores únicos, no es clasificable
// en la UI (categorización). Alineado con el tamaño máximo de la paleta (12 colores).
// Antes era 15 — con 13-15 clases las últimas no tenían color diferenciado.
window.CLASSIFY_THRESHOLDS = {
  maxUnique: 12,   // alineado con paleta categórica de 12 colores
};


// ── Validación de schema al arrancar ─────────────────────────
//
// Verifica que cada capa tenga los campos obligatorios.
// Si falta alguno, loguea un error claro con el nombre de la capa
// y el campo faltante — nunca falla silenciosamente en runtime.
//
// Campos obligatorios y su razón:
//   source       → wfs.js y spatial.js lo necesitan para buscar la fuente
//   typename     → es la clave WFS, sin ella no hay fetch posible
//   geomType     → map.js y export*.js lo usan para renderizar
//   clipStrategy → spatial.js lo lee para decidir la operación

const REQUIRED_FIELDS = ['source', 'typename', 'geomType', 'clipStrategy'];

(function validarCapas() {
  let errores = 0;
  for (const [key, capa] of Object.entries(window.LAYERS)) {
    for (const campo of REQUIRED_FIELDS) {
      if (capa[campo] === undefined) {
        console.error(`[layers] Campo obligatorio faltante: "${campo}" en capa "${key}"`);
        errores++;
      }
    }
    // Verificar que la fuente referenciada exista en SOURCES
    if (capa.source && window.SOURCES && !window.SOURCES[capa.source]) {
      console.error(`[layers] Fuente desconocida: "${capa.source}" en capa "${key}"`);
      errores++;
    }
  }
  if (errores > 0) {
    console.error(`[layers] ${errores} error(es) de schema detectado(s). Revisá las capas antes de deployar.`);
  }
})();

console.log(
  '[layers] Catálogo cargado: ' + Object.keys(window.LAYERS).length + ' capas' +
  ' de ' + Object.keys(window.SOURCES || {}).length + ' fuentes'
);

// Notificar a app.js (y al verificador de módulos) que el catálogo está listo.
// Reemplaza el polling waitForLayers() — más limpio y sin latencia artificial.
// El flag __LAYERS_READY__ cubre la race condition: si app.js llega después
// del evento, lee el flag directamente en lugar de esperar un evento que ya pasó.
window.__LAYERS_READY__ = true;
window.dispatchEvent(new Event('layers:ready'));
