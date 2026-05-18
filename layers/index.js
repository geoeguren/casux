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
window.CLIP_THRESHOLDS = {
  display: 55000,
};

/**
 * Umbral de clasificación de campos.
 * Si un campo tiene más de este número de valores únicos, no es clasificable en la UI.
 * Subir cuando el rendimiento del clasificador mejore.
 */
window.CLASSIFY_THRESHOLDS = {
  maxUnique: 15,
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
