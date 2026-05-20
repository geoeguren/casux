/**
 * src/intent/index.js — Orquestador del motor de intenciones
 *
 * Punto de entrada único: window.INTENT.detectarIntencion(texto, historial)
 *
 * Responsabilidad:
 *   Evaluar los detectores en orden de prioridad y devolver la primera
 *   intención detectada, o null si ninguna aplica (→ LLM).
 *
 * Orden de evaluación (de mayor a menor prioridad):
 *   1. limpiar    → borrar/vaciar el mapa
 *   2. export     → descargar/exportar
 *   3. basemap    → cambiar mapa de fondo
 *   4. renombrar  → cambiar nombre del chat/mapa
 *   5. estilo     → cambiar apariencia de una capa
 *   6. agregar    → sumar una capa al mapa activo (sin historial guard)
 *   7. quitar     → eliminar una capa del mapa activo (sin historial guard)
 *   8. capa       → cargar una capa nueva (con historial guard)
 *
 * agregar y quitar van antes de capa porque operan sobre el mapa activo
 * y deben evaluarse incluso cuando ya hubo conversación con el LLM.
 *
 * Si ningún detector devuelve un resultado → null → el mensaje se envía
 * al LLM con el historial completo.
 *
 * Dependencias (deben cargarse antes que este archivo):
 *   - src/intent/intent-utils.js   → window.INTENT_UTILS
 *   - src/intent/intent-scorer.js  → window.INTENT_SCORER
 *   - src/intent/intent-capa.js    → window.INTENT_CAPA
 *   - src/intent/intent-acciones.js → window.INTENT_ACCIONES
 */

window.INTENT = (() => {

  // Aliases locales de los módulos — facilitan la lectura del orquestador
  const Acciones = window.INTENT_ACCIONES;
  const Capa     = window.INTENT_CAPA;

  // ── detectarIntencion ─────────────────────────────────────────
  //
  // Evalúa todos los detectores en orden y devuelve el primer match.
  // Cada detector devuelve { tipo, subtipo?, parametros? } o null.
  //
  // @param texto     {string} Mensaje del usuario (texto original, sin normalizar)
  // @param historial {Array}  Historial de la conversación actual
  // @returns         {Object|null}

  function detectarIntencion(texto, historial = []) {
    const resultado =
      Acciones.detectarLimpiar(texto)         ||
      Acciones.detectarExport(texto)          ||
      Acciones.detectarBasemap(texto)         ||
      Acciones.detectarRenombrar(texto)       ||
      Acciones.detectarEstilo(texto)          ||
      Acciones.detectarAgregar(texto)         ||
      Acciones.detectarQuitar(texto)          ||
      Capa.detectarCapa(texto, historial);

    // Log de diagnóstico — visible en la consola del browser durante desarrollo
    if (resultado) {
      const extra =
        resultado.tipo === 'capa'    ? ` → ${resultado.parametros?.instruccion?.layerKey || '?'}` :
        resultado.tipo === 'agregar' ? ` → ${resultado.parametros?.instruccion?.layerKey || '?'}` :
        resultado.tipo === 'quitar'  ? ` → ${resultado.parametros?.mapKey || '?'}` :
        resultado.subtipo            ? ` (${resultado.subtipo})` : '';
      console.log(`[INTENT] ✓ ${resultado.tipo}${extra} | "${texto.slice(0, 60)}"`);
    } else {
      console.log(`[INTENT] → LLM | "${texto.slice(0, 60)}"`);
    }

    return resultado;
  }

  // ── API de compatibilidad ─────────────────────────────────────
  //
  // Estas funciones se mantienen para no romper llamadas existentes
  // en otros módulos (chat.js, app.js) que usaban la API anterior.
  // No deben usarse en código nuevo — usar detectarIntencion.

  // resolver(): alias legacy de detectarCapa — devuelve solo la instrucción
  function resolver(textoUsuario, historial = []) {
    const intencion = Capa.detectarCapa(textoUsuario, historial);
    return intencion?.parametros?.instruccion || null;
  }

  // detectarIntencionEstilo(): alias legacy para detectar estilo vago/especifico
  function detectarIntencionEstilo(texto) {
    const r = Acciones.detectarEstilo(texto);
    if (!r) return null;
    return r.subtipo === 'vago' ? 'vaga' : 'especifica';
  }

  // ── API pública ───────────────────────────────────────────────
  return { detectarIntencion, resolver, detectarIntencionEstilo };

})();
