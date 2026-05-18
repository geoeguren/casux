/**
 * i18n/i18n.js — Internacionalización
 *
 * Uso:
 *   t('clave')              → string en el idioma activo
 *   t('clave', {n: 5})      → string con interpolación de variables
 *   t('adv_all_disabled', { n: 15 }) → "Todos los campos tienen más de 15 valores…"
 *
 * Idiomas soportados: es, en, pt
 * Detección: localStorage('sm_lang') → navigator.language → 'es'
 * Cambio de idioma: guardar en localStorage y recargar la página
 */

window.I18N = (() => {

  const MAPS = {
    es: () => window.I18N_ES,
    en: () => window.I18N_EN,
    pt: () => window.I18N_PT,
  };

  // ── Detección de idioma ─────────────────────────────────────
  function detectLang() {
    const saved = localStorage.getItem('sm_lang');
    if (saved && MAPS[saved]) return saved;

    const browser = (navigator.language || navigator.userLanguage || 'es').slice(0, 2).toLowerCase();
    if (MAPS[browser]) return browser;

    // Portugués de Brasil / Portugal
    if (browser === 'pt') return 'pt';

    return 'es'; // fallback
  }

  const _lang   = detectLang();
  const _dict   = MAPS[_lang]?.() || window.I18N_ES || {};

  // ── Función principal ───────────────────────────────────────
  /**
   * t('clave') — devuelve el string traducido
   * t('clave', { n: 5, titulo: 'Rutas', msg: 'timeout' }) — con interpolación
   * Variables en el string: {n}, {titulo}, {msg}, {fmt}, {q}
   */
  function t(key, vars) {
    let str = _dict[key];
    if (str === undefined) {
      // Fallback a español
      str = window.I18N_ES?.[key];
    }
    if (str === undefined) {
      // Clave no encontrada — devolver la clave para detectar strings faltantes
      console.warn(`[i18n] Missing key: "${key}" for lang "${_lang}"`);
      return key;
    }
    if (!vars) return str;
    // Interpolación: reemplazar {variable} con el valor correspondiente
    return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
  }

  // ── API de idioma ───────────────────────────────────────────
  function getLang()       { return _lang; }

  function setLang(lang) {
    if (!MAPS[lang]) return;
    localStorage.setItem('sm_lang', lang);
    location.reload();
  }

  function getAvailableLangs() {
    return [
      { key: 'es', label: 'Español' },
      { key: 'en', label: 'English' },
      { key: 'pt', label: 'Português' },
    ];
  }

  return { t, getLang, setLang, getAvailableLangs };

})();

// Exponer t() globalmente para uso directo
window.t = window.I18N.t;

/**
 * Aplicar traducciones a elementos con data-i18n attributes.
 * Se llama automáticamente al cargar el DOM.
 *
 * data-i18n="key"              → textContent del elemento
 * data-i18n-placeholder="key"  → placeholder del input
 * data-i18n-title="key"        → title del elemento
 */
function _applyI18nDOM() {
  document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
    const key = el.dataset.i18nTooltip;
    const val = window.t(key);
    if (val !== key) el.setAttribute('data-tooltip', val);
  });
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = window.t(key);
    if (val !== key) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    const val = window.t(key);
    if (val !== key) el.placeholder = val;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    const val = window.t(key);
    if (val !== key) el.title = val;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _applyI18nDOM);
} else {
  _applyI18nDOM();
}
