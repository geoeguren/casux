/**
 * api/auth/callback.js — OAuth callback de Google
 *
 * Token firmado con HMAC-SHA256 usando TOKEN_SECRET (variable de entorno).
 * Formato: base64(payload) + "." + base64(hmac)
 * El servidor verifica la firma antes de confiar en el uid.
 */

const { checkOrigin } = require('../_cors');
const { signToken }   = require('./_token');
const { getDb }       = require('../_turso');

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
        const db = getDb();
        await db.execute({
          sql:  `UPDATE chats SET user_id = ? WHERE user_id = ?`,
          args: [profile.sub, anonUid],
        });
      } catch (migErr) {
        // No bloquear el login si la migración falla
        console.warn('[auth/callback] Error migrando chats anónimos:', migErr.message);
      }
    }

    // 3. Sesión firmada con HMAC-SHA256
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
      try {
        window.opener.postMessage({ type: 'casux_auth', token: token }, origin);
      } catch(e) {}
      window.close();
    } else {
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
