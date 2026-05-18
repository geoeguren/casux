/**
 * api/auth/callback.js — OAuth callback de Google
 *
 * Token firmado con HMAC-SHA256 usando TOKEN_SECRET (variable de entorno).
 * Formato: base64(payload) + "." + base64(hmac)
 * El servidor verifica la firma antes de confiar en el uid.
 */

const { checkOrigin } = require('../_cors');
const { signToken }   = require('./_token');

module.exports = async function handler(req, res) {
  const { code, error, state: anonUid } = req.query;

  if (error) return res.redirect('/chat?auth_error=' + encodeURIComponent(error));
  if (!code)  return res.status(400).send('Falta el código de autorización');

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenSecret  = process.env.TOKEN_SECRET;
  const redirectUri  = process.env.REDIRECT_URI;

  if (!tokenSecret) {
    console.error('[auth/callback] TOKEN_SECRET no configurado');
    return res.redirect('/chat?auth_error=server_config_error');
  }
  if (!redirectUri) {
    console.error('[auth/callback] REDIRECT_URI no configurada');
    return res.redirect('/chat?auth_error=server_config_error');
  }

  try {
    // 1. Intercambiar code por tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenResp.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    // 2. Obtener perfil
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResp.json();

    // 2b. Migrar chats anónimos si viene anonUid en el state
    if (anonUid && anonUid.startsWith('anon_')) {
      try {
        const { getDb } = require('../_firebase');
        const db = getDb();
        const anonChats = await db
          .collection('users').doc(anonUid)
          .collection('chats')
          .get();
        if (!anonChats.empty) {
          const batch = db.batch();
          anonChats.docs.forEach(doc => {
            const destRef = db
              .collection('users').doc(profile.sub)
              .collection('chats').doc(doc.id);
            batch.set(destRef, doc.data());
            batch.delete(doc.ref);
          });
          await batch.commit();
          await db.collection('users').doc(anonUid).delete().catch(() => {});
        }
      } catch (migErr) {
        // No bloquear el login si la migración falla
        console.warn('[auth/callback] Error migrando chats anónimos:', migErr.message);
      }
    }

    // 3. Sesión firmada con HMAC-SHA256
    // v: versión del token. Si TOKEN_MIN_VERSION en las variables de entorno
    // es mayor que v, el token se considera revocado (ver api/db.js verifySession).
    // Para invalidar todos los tokens activos: subir TOKEN_MIN_VERSION en Vercel.
    const TOKEN_VERSION = 1;
    const session = {
      uid:   profile.sub,
      email: profile.email,
      name:  profile.name,
      photo: profile.picture,
      exp:   Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 días
      v:     TOKEN_VERSION,
    };
    const signedToken = signToken(session, tokenSecret);

    // Entregar el token via postMessage en lugar del hash de la URL.
    // El hash expone el token en el historial del browser y en logs analíticos.
    // La página /api/auth/done cierra la ventana popup después de enviar el mensaje.
    const origin = process.env.APP_ORIGIN || 'https://casux.vercel.app';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Autenticando...</title></head>
<body>
<script>
  (function() {
    var token = ${JSON.stringify(signedToken)};
    var origin = ${JSON.stringify(origin)};
    if (window.opener) {
      // Flujo popup: entregar token via postMessage y cerrar
      try {
        window.opener.postMessage({ type: 'casux_auth', token: token }, origin);
      } catch(e) {}
      window.close();
    } else {
      // Flujo redirect (mobile Safari, popup bloqueado):
      // redirigir a /chat con el token en sessionStorage para no exponerlo en la URL
      try { sessionStorage.setItem('casux_auth_token', token); } catch(e) {}
      window.location.replace(origin + '/chat?auth_callback=1');
    }
  })();
</script>
</body>
</html>`);

  } catch (err) {
    console.error('[auth/callback]', err.message);
    res.redirect('/chat?auth_error=' + encodeURIComponent(err.message));
  }
};
