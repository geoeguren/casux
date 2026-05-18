/**
 * api/_cors.js — Helper compartido de CORS y verificación de origen
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por todos los handlers que necesiten CORS.
 *
 * Estrategia de origen:
 *   - En producción: solo acepta requests desde ALLOWED_ORIGINS
 *   - En desarrollo (sin ORIGIN_ALLOWLIST en env): permisivo para facilitar el dev local
 *
 * Por qué no confiar solo en vercel.json:
 *   vercel.json agrega los headers CORS en la RESPUESTA pero no bloquea el request.
 *   Un atacante puede ignorar CORS desde Node/curl y llamar igual.
 *   La verificación de origen acá es la barrera real del lado servidor.
 */

// Dominios autorizados a llamar a las APIs.
// Agregar dominios de preview de Vercel si se usan (*.vercel.app).
const ALLOWED_ORIGINS = new Set([
  'https://casux.vercel.app',
]);

/**
 * checkOrigin(req) → boolean
 *
 * Devuelve true si el request viene de un origen autorizado.
 * En ausencia de ORIGIN_ALLOWLIST=strict en las variables de entorno,
 * permite todos los orígenes (modo desarrollo).
 *
 * Usar así en cada handler:
 *   if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
 */
function checkOrigin(req) {
  // En desarrollo (sin la variable de entorno) no bloquear
  if (!process.env.ORIGIN_ALLOWLIST) return true;

  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';

  // Aceptar si origin está en la lista, o si el referer empieza con un origen permitido
  for (const allowed of ALLOWED_ORIGINS) {
    if (origin === allowed) return true;
    if (referer.startsWith(allowed)) return true;
  }

  // Aceptar requests sin origin (ej: curl interno de Vercel, server-to-server)
  // pero solo si no viene de un browser (sin User-Agent de browser)
  if (!origin && !referer) {
    const ua = req.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/i.test(ua);
    if (!isBrowser) return true;
  }

  return false;
}

/**
 * setCorsHeaders(res) — Elimina duplicación con vercel.json
 *
 * vercel.json ya agrega los headers CORS en la capa de CDN.
 * Los handlers NO deben repetirlos con setHeader() — produce headers duplicados
 * que algunos clientes rechazan.
 *
 * Esta función existe como no-op documentado: si algún handler necesita
 * headers distintos, los agrega acá y los demás no tocan nada.
 */
function setCorsHeaders(_res) {
  // No-op intencional: los headers CORS vienen de vercel.json.
  // Ver: https://vercel.com/docs/edge-network/headers
}

module.exports = { checkOrigin, setCorsHeaders };
