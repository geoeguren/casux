/**
 * api/_utils.js — Utilidades compartidas del servidor
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/llm.js y cualquier otro endpoint que necesite
 * estas funciones.
 */

/**
 * normalizar(texto) → string
 *
 * Idéntica a window.UTILS.normalizar en el cliente (src/utils.js).
 * Convierte texto a minúsculas, elimina tildes, reemplaza
 * caracteres no alfanuméricos por espacios.
 *
 * MANTENER EN SYNC con src/utils.js — misma función, dos entornos.
 */
function normalizar(texto) {
  if (!texto) return '';
  return texto.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * STOPWORDS — palabras vacías para búsqueda semántica de capas.
 *
 * Lista canónica compartida entre servidor (api/llm.js) y cliente (src/intent.js).
 * MANTENER EN SYNC con src/intent.js — misma lista, dos entornos.
 */
const STOPWORDS = [
  'de','del','los','las','una','con','por','que','para','entre',
  'en','el','la','al','quiero','ver','mapa','mostrar','dame','muestrame',
  'mostrame','poneme','cargame','carga','muestra','necesito',
  'todos','todas','un',
];

module.exports = { normalizar, STOPWORDS };
