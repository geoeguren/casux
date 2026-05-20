/**
 * src/intent/intent-utils.js — Utilidades compartidas del motor de intenciones
 *
 * Contiene las primitivas de texto que usan todos los demás módulos de intent:
 * normalización, tokenización, stopwords, y la construcción del mapa de países.
 *
 * No tiene dependencias internas — puede cargarse primero sin riesgo.
 * Se expone como window.INTENT_UTILS para que los otros módulos lo consuman.
 */

window.INTENT_UTILS = (() => {

  // ── Stopwords ─────────────────────────────────────────────────
  //
  // Palabras que no aportan significado para el scoring de capas.
  // Se filtran antes de tokenizar para reducir ruido.
  // Son principalmente preposiciones, artículos y verbos de pedido comunes.
  const STOPWORDS = new Set([
    'de','del','los','las','una','con','por','que','para','entre',
    'en','el','la','al','quiero','ver','mapa','mostrar','dame','muéstrame',
    'mostrame','poneme','cargame','carga','muestra','necesito','quiero',
    'todos','todas','el','la','un','una','los','las',
  ]);

  // ── normalizar ────────────────────────────────────────────────
  //
  // Delega en window.UTILS.normalizar (src/utils.js), que es la fuente
  // única de verdad para la normalización de texto en toda la app.
  // El alias local preserva todas las llamadas internas sin cambios.
  //
  // Transforma: "Río Paraná" → "rio parana"
  //             "Córdoba"    → "cordoba"
  const normalizar = (texto) => window.UTILS.normalizar(texto);

  // ── normalizarSimple ──────────────────────────────────────────
  //
  // Versión más liviana usada por los detectores de acciones (limpiar,
  // exportar, etc.) donde no se necesita la normalización completa.
  // Solo quita tildes y pasa a minúsculas.
  function normalizarSimple(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  // ── tokenizar ─────────────────────────────────────────────────
  //
  // Divide un texto normalizado en tokens significativos.
  // Filtra stopwords y tokens cortos (≤ 2 caracteres) que son ruido.
  // Entrada: texto ya normalizado (sin tildes, minúsculas).
  // Salida:  array de strings, ej: ['universidades', 'argentina']
  function tokenizar(textoNorm) {
    return textoNorm.split(/\s+/).filter(p => p.length > 2 && !STOPWORDS.has(p));
  }

  // ── buildPaisesMap ────────────────────────────────────────────
  //
  // Construye dinámicamente el mapa nombre_normalizado → código_de_país
  // leyendo window.SOURCES. Así no hay lista hardcodeada de países —
  // al agregar una fuente nueva en sources.js, el mapa se actualiza solo.
  //
  // Variantes comunes se agregan como fallback para garantizar detección
  // incluso si SOURCES no está cargado (ej: durante tests).
  //
  // Ejemplo de salida: { 'argentina': 'ar', 'uruguay': 'uy', 'chile': 'cl' }
  function buildPaisesMap() {
    const map = {};
    for (const [, src] of Object.entries(window.SOURCES || {})) {
      if (src.country && src.countryLabel) {
        map[normalizar(src.countryLabel)] = src.country;
      }
    }
    // Variantes de fallback
    map['argentina'] = 'ar';
    map['uruguay']   = 'uy';
    map['chile']     = 'cl';
    return map;
  }

  // ── API pública ───────────────────────────────────────────────
  return { STOPWORDS, normalizar, normalizarSimple, tokenizar, buildPaisesMap };

})();
