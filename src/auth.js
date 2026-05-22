/**
 * auth.js — Manejo de sesión OAuth con Google
 * La autenticación pasa por api/auth/callback.js
 *
 * El token tiene formato: base64(payload).base64(hmac)
 * El frontend lo almacena opaco y lo reenvía tal cual al servidor.
 * La verificación de firma ocurre sólo en el servidor (api/db.js).
 */

window.AUTH = (() => {

  // CLIENT_ID es el OAuth Client ID de Google.
  // Es público por diseño del protocolo OAuth 2.0: el browser siempre lo ve
  // en la URL de redirección. NO es un secreto — no moverlo a variables de entorno.
  // El secreto real (CLIENT_SECRET) vive solo en el servidor (api/auth/callback.js).
  const CLIENT_ID        = '908589019953-ucr5hgaefb7195itd7pfedvsucidgkge.apps.googleusercontent.com';
  // Fallback usado si /api/config no responde. En producción la variable de entorno
  // REDIRECT_URI del servidor es la fuente de verdad — ver api/config.js.
  const REDIRECT_FALLBACK = 'https://casux.vercel.app/api/auth/callback';
  const SESSION_KEY = 'sm_session';

  // ── Login ─────────────────────────────────────────────────────

  // redirectUri y appOrigin se precargan al iniciar el módulo para que
  // loginWithGoogle() pueda abrir el popup síncronamente desde el click del usuario.
  // window.open() llamado con await previo pierde la cadena de confianza del gesto
  // y el browser lo bloquea como popup no solicitado, forzando el fallback a redirect.
  let _redirectUri  = REDIRECT_FALLBACK;
  let _appOrigin    = 'https://casux.vercel.app';

  fetch('https://casux-config.geoeguren.workers.dev/')
    .then(r => r.json())
    .then(cfg => {
      if (cfg.redirectUri) _redirectUri = cfg.redirectUri;
      if (cfg.appOrigin)   _appOrigin   = cfg.appOrigin;
    })
    .catch(() => {});

  // ── Login anónimo ─────────────────────────────────────────────
  //
  // Llama a /api/auth/anon para obtener un token firmado sin pasar por Google.
  // El uid tiene prefijo "anon_" y se guarda en localStorage igual que una sesión real.
  // Al hacer login con Google, el uid anónimo se pasa como parámetro state para
  // que callback.js lo migre al uid real.

  async function loginAnon() {
    const resp = await fetch('/api/auth/anon', { method: 'POST' });
    if (!resp.ok) throw new Error('Error al crear sesión anónima');
    const { token } = await resp.json();
    const session = _parseAndSaveToken(token);
    return session;
  }

  async function loginWithGoogle() {
    // Pasar el uid anónimo en el state para que callback.js migre los chats
    const currentSession = getSession();
    const anonUid = currentSession?.anon ? currentSession.uid : null;

    const params = new URLSearchParams({
      client_id:     CLIENT_ID,
      redirect_uri:  _redirectUri,
      response_type: 'code',
      scope:         'openid email profile',
      prompt:        'select_account',
      ...(anonUid ? { state: anonUid } : {})
    });

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;

    // Abrir popup síncronamente desde el gesto del usuario.
    // Sin await previo: el browser acepta window.open() como intención del usuario.
    const w = 520, h = 620;
    const left = Math.round(window.screenX + (window.outerWidth  - w) / 2);
    const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(
      authUrl,
      'casux_auth',
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      // Popup bloqueado igualmente (mobile Safari, algunos Android) — fallback a redirect.
      // El callback detecta window.opener === null y redirige a /chat con el token en query.
      window.location.href = authUrl;
      return;
    }

    return new Promise((resolve, reject) => {
      const handler = (event) => {
        // Solo aceptar mensajes de nuestro propio origen
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'casux_auth') return;
        window.removeEventListener('message', handler);
        clearInterval(pollClosed);
        try {
          const session = _parseAndSaveToken(event.data.token);
          if (session) {
            resolve(session);
            // Recargar para reflejar el estado autenticado
            window.location.reload();
          } else {
            reject(new Error('Token inválido'));
          }
        } catch (err) {
          reject(err);
        }
      };

      window.addEventListener('message', handler);

      // Detectar si el usuario cerró el popup sin autenticarse
      const pollClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollClosed);
          window.removeEventListener('message', handler);
          reject(new Error('popup_closed'));
        }
      }, 500);
    });
  }

  // Parsear el token firmado y guardar la sesión.
  // Extraído de handleCallback() para reutilizar desde loginWithGoogle().
  function _parseAndSaveToken(signedToken) {
    const dotIndex = signedToken.lastIndexOf('.');
    if (dotIndex === -1) throw new Error('Token sin firma');
    const payloadB64 = signedToken.slice(0, dotIndex);
    const payload = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0))
    ));
    const session = { ...payload, token: signedToken };
    saveSession(session);
    return session;
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.reload();
  }

  // ── Sesión ────────────────────────────────────────────────────
  //
  // Estructura guardada en localStorage:
  //   { token: "<signedToken>", uid, email, name, photo, exp }
  //
  // "token" es el valor opaco que se envía al servidor.
  // Los campos de perfil se leen para la UI (nombre, foto) sin confiar en ellos
  // para autorización — eso lo hace el servidor al verificar la firma.

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (session.exp && Date.now() > session.exp) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch { return null; }
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function currentUser() {
    return getSession();
  }

  // Devuelve el token firmado para enviarlo al servidor.
  // firebase.js lo usa en el header Authorization.
  function getSignedToken() {
    const session = getSession();
    return session?.token || null;
  }

  // ── Capturar sesión del hash al volver de Google ──────────────

  // handleCallback: detecta el token en dos lugares:
  //   1. sessionStorage['casux_auth_token'] — flujo redirect (mobile/popup bloqueado)
  //   2. hash #session=... — flujo legacy (compatibilidad con sesiones antiguas)
  function handleCallback() {
    // Flujo redirect: el callback guardó el token en sessionStorage
    const url = new URL(window.location.href);
    if (url.searchParams.get('auth_callback') === '1') {
      url.searchParams.delete('auth_callback');
      history.replaceState(null, '', url.pathname + (url.search === '?' ? '' : url.search));
      try {
        const signedToken = sessionStorage.getItem('casux_auth_token');
        sessionStorage.removeItem('casux_auth_token');
        if (signedToken) {
          const session = _parseAndSaveToken(signedToken);
          if (session) return session;
        }
      } catch (err) {
        console.error('[AUTH] Error leyendo token de sessionStorage:', err);
      }
    }

    // Flujo legacy: token en el hash de la URL
    const hash = window.location.hash;
    if (!hash.startsWith('#session=')) return false;
    try {
      const signedToken = decodeURIComponent(hash.slice('#session='.length));
      const session = _parseAndSaveToken(signedToken);
      history.replaceState(null, '', window.location.pathname);
      return session;
    } catch (err) {
      console.error('[AUTH] Error parsing session:', err);
      return false;
    }
  }

  // ── Error de auth ─────────────────────────────────────────────

  function handleAuthError() {
    const url = new URL(window.location.href);
    const err = url.searchParams.get('auth_error');
    if (!err) return false;
    url.searchParams.delete('auth_error');
    history.replaceState(null, '', url.toString());
    return err;
  }

  function checkExpiry() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (session.exp && Date.now() > session.exp) {
        localStorage.removeItem(SESSION_KEY);
        console.log('[AUTH] Sesión expirada, limpiando');
      }
    } catch { localStorage.removeItem(SESSION_KEY); }
  }

  checkExpiry();

  function isAnon() {
    const s = getSession();
    return s ? !!s.anon : false;
  }

  return { loginAnon, loginWithGoogle, logout, currentUser, isAnon, getSignedToken, handleCallback, handleAuthError };

})();
