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
//   display:           límite en KB para desktop  → bloquea si fileSizeKb > display
//   displayFcFallback: límite en features para desktop cuando no hay fileSizeKb
//   displayFcHard:     límite duro de features independiente del peso (desktop)
//   displayMobile:     límite en KB para móvil
//   displayMobileFcFallback: límite features para móvil sin fileSizeKb
//   displayMobileFcHard:     límite duro features en móvil
//
// Por qué estos valores:
//   - 30 MB desktop: Leaflet empieza a freezear el hilo principal del browser
//     con GeoJSONs > ~30 MB en hardware de gama media (polígonos complejos).
//     El valor anterior de 80 MB era demasiado generoso y dejaba pasar capas
//     que colgaban el browser durante varios segundos.
//   - 8 MB móvil: la memoria y CPU de mobile son más limitadas. Equivale a
//     ~20 K polígonos simples o ~3 K polígonos medianos.
//   - displayFcHard 25 000 desktop: Leaflet crea un objeto SVG/Canvas por feature.
//     Benchmarks empíricos: polígonos > ~25 K features → degradación severa
//     en hardware medio (tab congelado varios segundos). El anterior de 55 000
//     dejaba pasar capas que colgaban el browser.
//   - fc fallback 40 K / 10 K: para capas sin fileSizeKb (principalmente fuentes
//     ArcGIS REST de Chile). Conservador porque sin fileSizeKb no podemos saber
//     la complejidad real de los vértices.
//
// La restricción se aplica con OR lógico (no AND):
//   bloquear si fileSizeKb > display  OR  featureCount > displayFcHard
//
// COBERTURA: 68% de las capas tienen fileSizeKb. El 32% restante (principalmente
// mop.js de Chile) usa el fallback de featureCount hasta que se completen los campos.
//
// NOTA: la validación se basa exclusivamente en los campos del catálogo (fileSizeKb,
// featureCount). En el futuro, si el servidor lo permite, se podría reimplementar
// una consulta en tiempo real (resultType=hits para WFS / returnCountOnly=true para
// ArcGIS REST) para obtener el count real del subconjunto filtrado antes de hacer
// el fetch. La infraestructura para eso ya existió en spatial.js (verificarUmbralDisplay)
// y fue removida por latencia y complejidad; ver git history para referencia.
window.CLIP_THRESHOLDS = {
  display:                  30_000,  // KB — bloquea si fileSizeKb > 30 MB (desktop)
  displayFcFallback:        40_000,  // features — fallback cuando no hay fileSizeKb (desktop)
  displayFcHard:            25_000,  // features — límite duro de features independiente del peso
  //
  // displayFcHard existe porque fileSizeKb no captura el costo de renderizado en Leaflet.
  // Una capa con muchas líneas o puntos puede pesar poco pero colgar el browser porque
  // Leaflet debe crear y mantener un objeto SVG/Canvas por feature en el DOM.
  // Esta restricción se aplica ADEMÁS del límite de peso (OR lógico, no AND):
  //   bloquear si fileSizeKb > 30 MB  OR  featureCount > 25 000
  //
  displayMobile:             8_000,  // KB — bloquea si fileSizeKb > 8 MB (móvil)
  displayMobileFcFallback:  10_000,  // features — fallback móvil sin fileSizeKb
  displayMobileFcHard:      12_000,  // features — límite duro móvil
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
