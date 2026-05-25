/**
 * chat-utils.js — Utilidades de parsing y sanitización del chat
 *
 * Expone: window.CHAT_UTILS
 * Depende de: nada
 * Debe cargarse ANTES de chat.js
 *
 * Contiene: sanitizeHistoryForLLM, stripBloques, extractMapPlan,
 *           extractChatTitle (stub — depende de CHAT_TITLE),
 *           extractStylePlan, extractBasemapPlan,
 *           extractExportPlan, extractExportChoice
 */

window.CHAT_UTILS = (() => {

  /**
   * sanitizeHistoryForLLM(messages)
   *
   * Los mensajes del asistente se guardan con los bloques de código
   * (```map, ```style, etc.) incluidos — necesarios para persistencia y
   * para restaurar el estado. Pero enviárselos al LLM consume tokens
   * innecesarios y puede confundirlo en conversaciones largas.
   * Devuelve una copia del historial con esos bloques eliminados solo
   * de los mensajes del asistente.
   */
  function sanitizeHistoryForLLM(messages) {
    return messages
      // Filtrar mensajes internos del intent parser — no deben llegar al LLM
      // porque el LLM los imita y los reproduce en sus respuestas.
      .filter(m => !(m.role === 'assistant' && m.content?.startsWith('[intent]')))
      .map(m => {
        if (m.role !== 'assistant') return m;
        const clean = m.content
          .replace(/```map[\s\S]*?```/g, '')
          .replace(/```style[\s\S]*?```/g, '')
          .replace(/```classify[\s\S]*?```/g, '')
          .replace(/```chat-title[\s\S]*?```\s*/g, '')
          .replace(/```export-choice[\s\S]*?```/g, '')
          .replace(/```export[\s\S]*?```/g, '')
          .trim();
        return { ...m, content: clean };
      });
  }

  /**
   * stripBloques(text, streaming)
   *
   * Elimina del texto todos los bloques de código que el LLM emite como
   * instrucciones internas (map, style, classify, basemap, chat-title,
   * export, export-choice). El texto resultante es el único que se
   * muestra al usuario — nunca debe contener código ni backticks de bloque.
   *
   * Estrategia: parsear el texto en segmentos en lugar de aplicar múltiples
   * regex en cadena. Cada ``` abre o cierra un bloque; todo lo que esté
   * dentro de un bloque se descarta. Así el orden de los bloques, su nombre,
   * y si están pegados entre sí no importan.
   *
   * streaming=true  → hay un bloque abierto al final (LLM aún escribe): descartar.
   * streaming=false → texto completo; bloque sin cerrar al final también se descarta.
   */
  function stripBloques(text, streaming) {
    const segments = [];
    const re = /```(\w[-\w]*)?/g;
    let inBlock = false;
    let lastIdx = 0;
    let m;

    while ((m = re.exec(text)) !== null) {
      const hasLang = m[1] !== undefined;

      if (!inBlock) {
        if (hasLang) {
          segments.push(text.slice(lastIdx, m.index));
          inBlock = true;
        } else {
          segments.push(text.slice(lastIdx, m.index));
          lastIdx = text.length;
          break;
        }
      } else {
        if (!hasLang) {
          inBlock = false;
          lastIdx = re.lastIndex;
        }
      }
    }

    if (!inBlock && lastIdx <= text.length) {
      segments.push(text.slice(lastIdx));
    }

    const joined = segments.join('').replace(/\n{3,}/g, '\n\n').trim();

    const bloqueKeys = /^(map|style|classify|basemap|chat-title|export|export-choice)\s*[\[\{`]/;
    const lines = joined.split('\n');
    const filtered = lines.filter(l => !bloqueKeys.test(l.trim()));
    const result = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed) && parsed[0]?.error) return '';
    } catch { /* no es JSON, continuar normal */ }

    return result;
  }

  function extractMapPlan(text) {
    const match = text.match(/```map\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  function extractChatTitle(text) {
    // [^`]*? para no cruzar al ``` de apertura del bloque siguiente
    const match = text.match(/```chat-title[^\n]*\n([^`]*?)```/);
    if (!match) return null;
    // Delegar capitalización a CHAT_TITLE si está disponible
    const raw = match[1].trim();
    return window.CHAT_TITLE?.toTitleCase?.(raw) ?? raw;
  }

  function extractStylePlan(text) {
    const match = text.match(/```style\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  function extractBasemapPlan(text) {
    const match = text.match(/```basemap\s*([\s\S]*?)```/);
    if (!match) return null;
    const key = match[1].trim().toLowerCase();
    return ['gray', 'dark', 'voyager'].includes(key) ? key : null;
  }

  function extractExportPlan(text) {
    const match = text.match(/```export\s*([\s\S]*?)```/);
    if (!match) return null;
    try { return JSON.parse(match[1].trim()); } catch { return null; }
  }

  function extractExportChoice(text) {
    return /```export-choice[\s\S]*?```/.test(text);
  }

  return {
    sanitizeHistoryForLLM,
    stripBloques,
    extractMapPlan,
    extractChatTitle,
    extractStylePlan,
    extractBasemapPlan,
    extractExportPlan,
    extractExportChoice,
  };

})();
