/**
 * src/utils.js — Utilidades compartidas del cliente
 *
 * Cargado antes que intent.js, spatial-clip.js, chat.js y cualquier
 * otro módulo que necesite estas funciones.
 *
 * Expuesto como window.UTILS para acceso global sin imports ES Module
 * (los módulos src/ se cargan como scripts clásicos en index.html).
 */

window.UTILS = (() => {

  /**
   * normalizar(texto) → string
   *
   * Convierte texto a minúsculas, elimina tildes y diacríticos,
   * reemplaza caracteres no alfanuméricos por espacios y colapsa espacios.
   *
   * Uso: matching de nombres geográficos, búsquedas tolerantes a variantes.
   *
   * Ejemplos:
   *   normalizar('Córdoba')          → 'cordoba'
   *   normalizar('Entre Ríos')       → 'entre rios'
   *   normalizar('São Paulo')        → 'sao paulo'
   *   normalizar('  Río  Negro  ')   → 'rio negro'
   *
   * MANTENER EN SYNC con api/_utils.js — misma función, dos entornos.
   */
  function normalizar(texto) {
    if (!texto) return '';
    // Guardia: si viene un array, tomar el primer elemento
    if (Array.isArray(texto)) texto = texto[0] || '';
    // Guardia: convertir cualquier no-string a string
    if (typeof texto !== 'string') texto = String(texto);
    return texto.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { normalizar };

})();
