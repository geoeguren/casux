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

  // Cargar configuración pública desde el servidor (una sola vez al inicio)
  fetch('/api/config')
    .then(r => r.json())
    .then(cfg => {
      window.__ANALYTICS_KEY__ = cfg.analyticsKey || '';
      // CASUX_CONFIG expone configuración pública al resto de módulos del cliente
      window.CASUX_CONFIG = {
        b2PublicUrl: cfg.b2PublicUrl || '',
        appOrigin:   cfg.appOrigin   || '',
      };
    })
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
    const userId = window.AUTH?.currentUser?.()?.uid || 'anonymous';

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
      referrer:  document.referrer || 'direct',
      // userType: 'anon' para usuarios sin Google login, 'registered' para los que sí.
      // Permite medir el embudo de conversión anónimo → registrado.
      userType:  window.AUTH?.isAnon?.() ? 'anon' : 'registered',
    });
  }

  function mapGenerated(plan) {
    _mapCount++;
    const now  = Date.now();
    const insts = plan?.instrucciones || [];

    // queryTypes: operaciones espaciales usadas en este mapa.
    // 'clip' es el default cuando no hay op explícita.
    // Permite medir adopción de clip_exclude, intersect, buffer, etc.
    const queryTypes = [...new Set(
      insts.map(i => i.op || 'clip').filter(Boolean)
    )];

    // sources: países de los datos consultados.
    // Se deriva del campo source del layerDef → country en SOURCES.
    // Permite medir uso por país de fuente (AR, UY, CL...).
    const sources = [...new Set(
      insts
        .map(i => {
          const layerDef = window.LAYERS?.[i.layerKey];
          const src      = layerDef?.source;
          return src ? (window.SOURCES?.[src]?.country || src) : null;
        })
        .filter(Boolean)
    )];

    const props = {
      mapCount:     _mapCount,
      layerCount:   insts.length,
      layers:       insts.map(i => i.layerKey).filter(Boolean),
      queryTypes,
      sources,
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
