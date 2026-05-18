/**
 * analytics.js — Cliente de tracking de eventos para métricas PMV
 *
 * Uso:
 *   window.ANALYTICS.track('map_generated', { layerCount: 2, layers: ['rutas_ar'] })
 *
 * Todos los eventos se enriquecen automáticamente con userId, sessionId y ts.
 * Los fallos son silenciosos — el tracking nunca interrumpe el flujo principal.
 */

window.ANALYTICS = (() => {

  // Cargar la clave de analytics desde el servidor (una sola vez al inicio)
  fetch('/api/config')
    .then(r => r.json())
    .then(cfg => { window.__ANALYTICS_KEY__ = cfg.analyticsKey || ''; })
    .catch(() => {});

  // ── Sesión ────────────────────────────────────────────────────
  // ID único por pestaña/sesión (no persiste entre recargas)
  const SESSION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // Timestamp de inicio de sesión — para calcular tiempo hasta primer mapa
  const SESSION_START = Date.now();

  // ── Estado interno ────────────────────────────────────────────
  let _firstMapTs     = null;   // ts del primer mapa generado en la sesión
  let _mapCount       = 0;      // mapas generados en la sesión
  let _msgCount       = 0;      // mensajes enviados en la sesión
  let _msgAfterMap    = 0;      // mensajes enviados después del primer mapa

  // ── Función principal ─────────────────────────────────────────
  async function track(event, props = {}) {
    const userId = window.AUTH?.getUser?.()?.uid || 'anonymous';

    try {
      await fetch('/api/analytics', {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'X-Analytics-Key': window.__ANALYTICS_KEY__ || '',
        },
        body: JSON.stringify({
          event,
          userId,
          sessionId: SESSION_ID,
          props: {
            ...props,
            language: window.I18N?.getLang?.() || 'es',
            ua:       navigator.userAgent.slice(0, 120),
            mobile:   window.MAP_CONTROLS?.isMobile?.() || false,
          }
        })
      });
    } catch {
      // Fallo silencioso
    }
  }

  // ── Eventos de alto nivel ─────────────────────────────────────

  function sessionStart() {
    track('session_start', {
      referrer: document.referrer || 'direct',
    });
  }

  function mapGenerated(plan) {
    _mapCount++;
    const now = Date.now();

    const props = {
      mapCount:    _mapCount,
      layerCount:  (plan?.instrucciones || []).length,
      layers:      (plan?.instrucciones || []).map(i => i.layerKey).filter(Boolean),
      msToFirstMap: _firstMapTs ? null : now - SESSION_START,  // solo en el primero
    };

    if (!_firstMapTs) _firstMapTs = now;

    track('map_generated', props);
  }

  function mapExported(format = 'jpeg') {
    track('map_exported', { format, mapCount: _mapCount });
  }

  function styleChanged(trigger = 'button') {
    track('style_changed', { trigger });
  }

  function chatMessageSent(intent = 'unknown') {
    _msgCount++;
    if (_firstMapTs) _msgAfterMap++;

    track('chat_message_sent', {
      intent,
      msgCount:      _msgCount,
      msgAfterMap:   _msgAfterMap,
      refinements:   _firstMapTs ? _msgAfterMap : 0,
    });
  }

  function chatMessageFailed(reason = 'unknown') {
    track('chat_message_failed', { reason, msgCount: _msgCount });
  }

  return {
    track,
    sessionStart,
    mapGenerated,
    mapExported,
    styleChanged,
    chatMessageSent,
    chatMessageFailed,
    getSessionId: () => SESSION_ID,
  };

})();
