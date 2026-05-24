/**
 * src/intent/intent-index.js — Orquestador del motor de intenciones v2
 *
 * Punto de entrada único: window.INTENT.detectarIntencion(texto, historial)
 *
 * Arquitectura:
 *   1. INTENT_RESOLVER.detectar() — modelo (Verbo × Objeto)
 *      Si no encuentra nada → paso 2
 *   2. INTENT_CAPA.detectarCapa() — pedido de nueva capa (scorer TF-IDF)
 *      Si no encuentra nada → null → LLM
 *
 * Dependencias (orden de carga en HTML):
 *   intent-utils.js, intent-scorer.js, intent-capa.js,
 *   intent-verbos.js, intent-objeto.js, intent-tabla.js,
 *   intent-validar.js, intent-resolver.js, intent-index.js
 */

window.INTENT = (() => {

  function detectarIntencion(texto, historial = []) {
    const norm = window.INTENT_UTILS?.normalizarSimple?.(texto) || texto.toLowerCase();

    // ── Resolver con el modelo Verbo × Objeto ─────────────────────
    const resultado = window.INTENT_RESOLVER?.detectar?.(texto, historial);

    // Log de diagnóstico
    if (resultado) {
      const extra = resultado.parametros
        ? ` | ref=${resultado.parametros.mapKey || resultado.parametros.layerKey || '?'}`
        : '';
      console.log(`[INTENT] ✓ ${resultado.tipo}${resultado.subtipo ? '/' + resultado.subtipo : ''}${extra} | "${texto.slice(0, 60)}"`);
    } else {
      console.log(`[INTENT] → LLM | "${texto.slice(0, 60)}"`);
    }

    return resultado;
  }

  return { detectarIntencion };

})();
