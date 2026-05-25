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
 * ── Señal primaria: fileSizeKb ────────────────────────────────────────────
 *
 * display:       límite en KB para desktop  → bloquea si fileSizeKb > display
 * displayMobile: límite en KB para móvil
 *
 * IMPORTANTE: para capas con clipStrategy='attribute', el servidor filtra
 * antes de enviar → la capa completa NUNCA se descarga al cliente.
 * Por eso, los límites de fileSizeKb NO aplican a esas capas (ver lógica
 * en _estaRestringida() de intent-validar.js y verificarUmbralDisplay() de
 * spatial.js).
 *
 * ── Señal secundaria: featureCount ────────────────────────────────────────
 *
 * Si la capa no declara fileSizeKb, se usa featureCount como fallback.
 *
 * displayFcFallback:     límite features desktop cuando no hay fileSizeKb
 * displayFcHard:         objeto {polygon, line, point, unknown} — límite duro (desktop)
 * displayMobileFcFallback: fallback móvil
 * displayMobileFcHard:   objeto — límite duro móvil
 *
 * ── Zona de advertencia (no bloqueante) ────────────────────────────────────
 *
 * displayFcWarn: umbrales intermedios por geomType.
 * Si fc > displayFcWarn[geomType] pero < displayFcHard[geomType]:
 *   → aviso no bloqueante: "Esta capa puede tardar en cargar. ¿Continuar?"
 * Si fc > displayFcHard[geomType]:
 *   → bloqueo duro.
 *
 * ── Por qué estos valores ─────────────────────────────────────────────────
 *
 * display 80 MB desktop (antes 30 MB):
 *   Benchmarks actualizados muestran que Leaflet maneja bien hasta ~80 MB
 *   de GeoJSON en hardware de gama media con Chrome/Firefox modernos.
 *   El límite de 30 MB era excesivamente conservador y bloqueaba capas
 *   importantes (departamentos, municipios, red vial, áreas protegidas)
 *   incluso al pedirlas completas.
 *
 * displayFcHard polygon 25 000 (antes 15 000):
 *   15 K bloqueaba espejo_agua_ar (21 K polígonos) y varios OTBN provinciales
 *   que son perfectamente manejables en desktop. 25 K es el límite práctico
 *   observado en pruebas con hardware de gama media.
 *
 * displayFcHard line 30 000 (antes 20 000):
 *   senda_ar (20 965 líneas) se bloqueaba por 965 features de margen.
 *   30 K es más realista para líneas (costo de render menor que polígonos).
 *
 * displayFcHard point 75 000 (antes 50 000):
 *   educacion_ar (51 141 puntos) se bloqueaba por 1 141 features. Los puntos
 *   son muy baratos en Leaflet; 75 K es seguro en desktop.
 *
 * displayFcFallback 50 000 (antes 40 000):
 *   Alineado con el aumento del límite duro de puntos.
 *
 * Móvil sin cambios: los dispositivos móviles tienen memoria y conexión
 * limitadas, los valores conservadores originales se mantienen.
 *
 * ── Zona de advertencia (displayFcWarn) ───────────────────────────────────
 *
 * Introduce una zona no bloqueante entre el umbral normal y el límite duro:
 *   polygon: aviso a 12 000, bloqueo a 25 000
 *   line:    aviso a 20 000, bloqueo a 30 000
 *   point:   aviso a 40 000, bloqueo a 75 000
 *
 * Implementación: _estaRestringida() en intent-validar.js devuelve el estado
 * { restriccion: 'advertencia' | 'bloqueada' | false }.
 * intent-validar.js mapea 'advertencia' a bloquea:false con mensaje de aviso.
 * Ver sección "Zona de advertencia" más abajo.
 *
 * ── Consulta en tiempo real (reimplementación futura) ──────────────────────
 *
 * Cuando el usuario pide un SUBCONJUNTO de una capa pesada (ej: "glaciares
 * de Mendoza"), la restricción basada en el catálogo es incorrecta: bloquea
 * usando el tamaño/count TOTAL cuando el subset real es mucho más liviano.
 *
 * La solución documentada (sección 9.1 del diseño) es hacer un request de
 * conteo al servidor ANTES del fetch:
 *   WFS:       ?SERVICE=WFS&REQUEST=GetFeature&resultType=hits&CQL_FILTER=...
 *   ArcGIS:    ?f=json&returnCountOnly=true&where=...
 * Si el count real < umbral → permitir, aunque la capa completa esté bloqueada.
 * Timeout recomendado: 5 s, con fallback al catálogo si no responde.
 *
 * Punto de reimplementación: src/spatial.js → verificarUmbralDisplay().
 * Los parámetros _wfsOpts y _cql ya están en la firma reservados.
 * Ver git history para la implementación anterior de referencia.
 *
 * ── Lógica de restricción (OR lógico) ─────────────────────────────────────
 *
 * bloquear si:
 *   (fileSizeKb > display)                           ← señal primaria
 *   OR (featureCount > displayFcHard[geomType])      ← señal secundaria
 *   OR (fileSizeKb===undefined AND fc > fcFallback)  ← fallback sin fileSizeKb
 *
 * Excepciones:
 *   clipStrategy='attribute' → NUNCA bloquear por fileSizeKb ni fcHard
 *     (el servidor filtra; nunca llega la capa completa)
 *   clipStrategy='none' → bloquear normalmente (se descarga siempre completa)
 */
window.CLIP_THRESHOLDS = {
  // ── Desktop ────────────────────────────────────────────────────
  display:                  80_000,  // KB — bloquea si fileSizeKb > 80 MB (antes: 30 MB)
  displayFcFallback:        50_000,  // features — fallback sin fileSizeKb (antes: 40 K)

  // Límite duro por geomType (desktop). Ver explicación arriba.
  displayFcHard: {
    polygon: 25_000,   // antes: 15 000
    line:    30_000,   // antes: 20 000
    point:   75_000,   // antes: 50 000
    unknown: 20_000,   // conservador: sin info de geom, entre polygon y line
  },

  // Zona de advertencia NO bloqueante (nueva).
  // Si fc > displayFcWarn[geomType] → aviso "puede tardar, ¿continuar?"
  // Si fc > displayFcHard[geomType] → bloqueo duro.
  displayFcWarn: {
    polygon: 12_000,
    line:    20_000,
    point:   40_000,
    unknown: 12_000,
  },

  // ── Móvil (sin cambios respecto a versión anterior) ────────────
  displayMobile:             8_000,  // KB
  displayMobileFcFallback:  10_000,  // features
  displayMobileFcHard: {
    polygon:  8_000,
    line:    10_000,
    point:   25_000,
    unknown:  8_000,
  },
  displayMobileFcWarn: {
    polygon:  5_000,
    line:     7_000,
    point:   15_000,
    unknown:  5_000,
  },
};

// ── Umbral de clasificación de campos ──────────────────────────────────────
//
// Si un campo tiene más de este número de valores únicos, no es clasificable
// en la UI (categorización). Alineado con el tamaño máximo de la paleta (12 colores).
window.CLASSIFY_THRESHOLDS = {
  maxUnique: 12,
};


// ── Validación de schema al arrancar ─────────────────────────
//
// Verifica que cada capa tenga los campos obligatorios.
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

window.__LAYERS_READY__ = true;
window.dispatchEvent(new Event('layers:ready'));
