/**
 * settings.js — Preferencias del usuario
 * Dropdown desde el avatar en el sidebar
 */

window.SETTINGS = (() => {

  const KEY = 'sm_settings';

  const defaults = {
    theme:  'auto',
    lang:   'es',
    model:  'auto',
    tone:   'default',
  };

  function load() {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Si no hay preferencias guardadas y el usuario es anónimo, usar defaults ligeros
    const isAnon = window.AUTH?.isAnon?.() ?? false;
    const anonDefaults = isAnon && !localStorage.getItem(KEY)
      ? { tone: 'efficient', model: 'mistral', theme: 'auto',
          lang: (navigator.language || 'es').slice(0,2).toLowerCase() }
      : {};
    try { return { ...defaults, ...anonDefaults, ...saved }; }
    catch { return { ...defaults, ...anonDefaults }; }
  }
  function save(prefs) { localStorage.setItem(KEY, JSON.stringify(prefs)); }
  function get(key) {
    if (key === 'lang') return window.I18N?.getLang?.() || load()['lang'] || defaults['lang'];
    return load()[key] ?? defaults[key];
  }

  function set(key, value) {
    const prefs = load();
    prefs[key] = value;
    save(prefs);
    if (key === 'theme') applyTheme(value);
    if (key === 'lang')  window.I18N?.setLang?.(value);
  }

  function applyTheme(theme) {
    let mode;
    if (theme === 'auto') {
      const h = new Date().getHours();
      mode = h >= 7 && h < 20 ? 'day' : 'night';
    } else {
      mode = theme === 'light' ? 'day' : 'night';
    }
    THEME.apply(mode);
    try {
      const curBase = window.MAP?.getCurrentBase?.();
      if (!curBase || curBase === 'gray' || curBase === 'dark') {
        window.MAP?.setBasemap?.(mode === 'day' ? 'gray' : 'dark');
      }
    } catch (e) {}
  }

  function init() { applyTheme(get('theme')); }

  // ── Opciones de cada sección ──────────────────────────────────

  const SECTIONS = [
    {
      key: 'theme',
      label: t('settings_appearance'),
      options: [
        { val: 'auto',  icon: 'access_time', label: t('settings_system') },
        { val: 'light', icon: 'light_mode',  label: t('settings_light')  },
        { val: 'dark',  icon: 'dark_mode',   label: t('settings_dark')   },
      ]
    },
    {
      key: 'lang',
      label: t('settings_language'),
      options: [
        { val: 'en', label: 'English'   },
        { val: 'es', label: 'Español'   },
        { val: 'pt', label: 'Português' },
      ]
    },
    {
      key: 'model',
      label: t('settings_ai_model'),
      options: [
        { val: 'auto',    label: 'Auto'                    },
        { val: 'gemini',  label: 'gemini-2.5-flash',          mono: true },
        { val: 'groq',    label: 'llama-3.3-70b-versatile',  mono: true },
        { val: 'mistral', label: 'mistral-small-latest',      mono: true },
      ]
    },
    {
      key: 'tone',
      label: t('settings_response_style'),
      options: [
        { val: 'default',    icon: 'lightbulb',      label: t('settings_default')   },
        { val: 'eficiente',  icon: 'bolt',          label: t('settings_efficient') },
        { val: 'detallista', icon: 'biotech',       label: t('settings_detailed')  },
        { val: 'creativo',    icon: 'hub',           label: t('settings_creative')  },
      ]
    },
  ];

  // ── Helpers ───────────────────────────────────────────────────

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function labelFor(key, val) {
    const sec = SECTIONS.find(s => s.key === key);
    const opt = sec?.options.find(o => o.val === val);
    return opt ? opt.label : val;
  }

  // ── Construir sección acordeón ────────────────────────────────

  function buildSection(sec, prefs) {
    const current = prefs[sec.key] ?? defaults[sec.key];
    const currentOpt = sec.options.find(o => o.val === current);
    const currentLabel = currentOpt?.label || current;
    const currentIcon  = currentOpt?.icon
      ? `<span class="material-icons sd-acc-icon">${currentOpt.icon}</span>` : '';

    const optionsHtml = sec.options.map(o => {
      const active  = o.val === current ? ' active' : '';
      const dis     = o.disabled ? ' sd-acc-opt-disabled' : '';
      const iconHtml = o.icon ? `<span class="material-icons sd-acc-icon">${o.icon}</span>` : '';
      const labelHtml = o.mono
        ? `<span style="font-family:var(--font-mono);font-size:12px">${esc(o.label)}</span>`
        : `<span>${esc(o.label)}</span>`;
      return `<div class="sd-acc-option${active}${dis}" data-key="${sec.key}" data-val="${esc(o.val)}">
        ${iconHtml}${labelHtml}
      </div>`;
    }).join('');

    return `
      <div class="sd-acc-section" data-key="${sec.key}">
        <div class="sd-acc-header">
          <span class="sd-acc-label">${esc(sec.label)}</span>
          <span class="sd-acc-arrow material-icons">expand_more</span>
        </div>
        <div class="sd-acc-body hidden">
          ${optionsHtml}
        </div>
      </div>`;
  }

  // ── Dropdown principal ────────────────────────────────────────

  function openFromBtn(btnEl) {
    const existing = document.getElementById('settings-dropdown');
    if (existing) { existing.remove(); return; }

    const prefs = load();
    const user  = window.AUTH?.currentUser();

    const dropdown = document.createElement('div');
    dropdown.id        = 'settings-dropdown';
    dropdown.className = 'settings-dropdown';

    dropdown.innerHTML = `
      ${user ? `
      <div class="sd-user-header">
        <span class="sd-user-name">${esc(user.name || '')}</span>
        <span class="sd-user-email">${esc(user.email || '')}</span>
      </div>` : ''}

      <div class="sd-acc-wrap">
        ${SECTIONS.map(s => buildSection(s, prefs)).join('')}
      </div>

      <div class="sd-divider"></div>

      <button class="sd-logout" id="sd-logout-btn">
        <span class="material-icons">logout</span>${t('settings_logout')}
      </button>
    `;

    document.body.appendChild(dropdown);

    // Posicionar arriba del botón
    const rect  = btnEl.getBoundingClientRect();
    const dropH = dropdown.offsetHeight;
    let top  = rect.top - dropH - 8;
    let left = rect.left;
    if (top < 8) top = rect.bottom + 8;
    // En mobile: limitar top para no salirse de la pantalla por abajo
    const maxTop = window.innerHeight - dropH - 8;
    if (top > maxTop) top = Math.max(8, maxTop);
    // En mobile: ancho ajustado
    if (window.innerWidth <= 768) {
      dropdown.style.width = Math.min(224, window.innerWidth - 16) + 'px';
    }
    left = Math.min(left, window.innerWidth - dropdown.offsetWidth - 8);
    left = Math.max(8, left);
    dropdown.style.top  = top + 'px';
    dropdown.style.left = left + 'px';

    // ── Wire acordeones ───────────────────────────────────────
    dropdown.querySelectorAll('.sd-acc-section').forEach(sec => {
      const header = sec.querySelector('.sd-acc-header');
      const body   = sec.querySelector('.sd-acc-body');
      const arrow  = sec.querySelector('.sd-acc-arrow');

      header.addEventListener('click', () => {
        const isOpen = !body.classList.contains('hidden');

        // Cerrar todos los acordeones
        dropdown.querySelectorAll('.sd-acc-section').forEach(s => {
          s.querySelector('.sd-acc-body').classList.add('hidden');
          s.querySelector('.sd-acc-arrow').classList.remove('open');
          s.querySelector('.sd-acc-header').classList.remove('active');
        });

        // Si estaba cerrado, abrir este
        if (!isOpen) {
          body.classList.remove('hidden');
          arrow.classList.add('open');
          header.classList.add('active');
        }

        // Recalcular posición cuando el acordeón crece
        requestAnimationFrame(() => {
          const r = btnEl.getBoundingClientRect();
          const h = dropdown.offsetHeight;
          let newTop = r.top - h - 8;
          if (newTop < 8) newTop = r.bottom + 8;
          // Si se sale por abajo, subir
          const maxTop = window.innerHeight - h - 8;
          if (newTop > maxTop) newTop = Math.max(8, maxTop);
          dropdown.style.top = newTop + 'px';
        });
      });

      // Wire opciones
      body.querySelectorAll('.sd-acc-option:not(.sd-acc-opt-disabled)').forEach(opt => {
        opt.addEventListener('click', () => {
          const key = opt.dataset.key;
          const val = opt.dataset.val;
          set(key, val);
          // Marcar opción activa
          body.querySelectorAll('.sd-acc-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
        });
      });
    });

    dropdown.querySelector('#sd-logout-btn').addEventListener('click', () => {
      dropdown.remove();
      window.AUTH?.logout();
    });

    // Cerrar al click afuera
    const openedAt = Date.now();
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (Date.now() - openedAt < 150) return;
        if (!dropdown.contains(e.target) && e.target !== btnEl && !btnEl.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 0);
  }

  return { open: openFromBtn, openFromBtn, get, set, init, load };

})();
