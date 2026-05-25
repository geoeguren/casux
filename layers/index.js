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
//   display:               límite en KB para desktop  → bloquea si fileSizeKb > display
//   displayFcFallback:     límite en features para desktop cuando no hay fileSizeKb
//   displayFcHard:         objeto {polygon, line, point, unknown} — límite duro por geomType (desktop)
//   displayMobile:         límite en KB para móvil
//   displayMobileFcFallback: límite features para móvil sin fileSizeKb
//   displayMobileFcHard:   objeto {polygon, line, point, unknown} — límite duro por geomType (móvil)
//
// Por qué estos valores:
//   - 30 MB desktop / 8 MB móvil: Leaflet empieza a freezear el hilo principal del browser
//     con GeoJSONs > ~30 MB en hardware de gama media (polígonos complejos).
//   - displayFcHard diferenciado por geomType: el costo de renderizado en Leaflet
//     no es igual para polígonos (caro), líneas (medio) y puntos (barato).
//     Detalle y justificación en el bloque displayFcHard más abajo.
//   - fc fallback 40 K / 10 K: para capas sin fileSizeKb (principalmente fuentes
//     ArcGIS REST de Chile). Conservador porque sin fileSizeKb no podemos saber
//     la complejidad real de los vértices.
//   - clipStrategy='attribute': el servidor filtra antes de enviar → sin límite duro fc.
//
// La restricción se aplica con OR lógico (no AND):
//   bloquear si fileSizeKb > display  OR  featureCount > displayFcHard[geomType]
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
// ── displayFcHard por tipo de geometría (desktop y móvil) ─────────────────
//
// El costo de renderizado en Leaflet no es igual para todos los geomTypes.
// Leaflet crea un objeto SVG/Canvas por feature, pero el peso por objeto varía:
//   - polygon: el más caro — geometrías complejas, muchos vértices, fill + stroke
//   - line:    costo intermedio — solo stroke, sin fill
//   - point:   el más barato — un círculo simple, muy liviano en el DOM
//
// Por eso el límite duro se diferencia por geomType en lugar de ser uno único.
// La restricción por fileSizeKb (señal de peso real) sigue siendo igual para todos.
//
// Valores desktop:
//   polygon 15 000 — benchmarks: > 15 K polígonos medianos → freeze severo
//   line    20 000 — líneas son más livianas que polígonos; 20 K es el límite práctico
//   point   50 000 — puntos son muy baratos; 50 K es razonable en hardware medio
//
// Capas con clipStrategy='attribute': el servidor filtra antes de enviar,
// nunca llega la capa completa al cliente → sin límite duro por featureCount.
// Capas con clipStrategy='none': se descargan completas → aplica el límite normal.
//
// FUTURO — zona de advertencia (no implementado aún):
//   Agregar un umbral intermedio displayFcWarn por geomType (ej: polygon 8 000,
//   line 12 000, point 30 000) que muestre un mensaje no bloqueante al usuario
//   ("esta capa puede tardar en cargar — ¿continuar?") antes de llegar al hard limit.
//   La infraestructura ya existe: bloquea:false en intent-validar.js.
window.CLIP_THRESHOLDS = {
  display:                  30_000,  // KB — bloquea si fileSizeKb > 30 MB (desktop)
  displayFcFallback:        40_000,  // features — fallback cuando no hay fileSizeKb (desktop)
  //
  // displayFcHard diferenciado por geomType (ver explicación arriba).
  // Usado por _estaRestringida() en intent-validar.js y verificarUmbralDisplay() en spatial.js.
  displayFcHard: {
    polygon: 15_000,
    line:    20_000,
    point:   50_000,
    unknown: 15_000,  // conservador: sin info de geom, tratar como polígono
  },
  //
  displayMobile:             8_000,  // KB — bloquea si fileSizeKb > 8 MB (móvil)
  displayMobileFcFallback:  10_000,  // features — fallback móvil sin fileSizeKb
  displayMobileFcHard: {
    polygon:  8_000,
    line:    10_000,
    point:   25_000,
    unknown:  8_000,
  },
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
