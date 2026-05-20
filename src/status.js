/**
 * src/status.js — Página de estado de geoservicios
 */

// ── Idioma ─────────────────────────────────────────────────────────

function getLang() {
  return window.I18N?.getLang?.() || window.SETTINGS?.get?.('lang') || 'es';
}

function layerTitle(layer) {
  const lang = getLang();
  if (lang === 'en' && layer.tituloUIEn) return layer.tituloUIEn;
  if (lang === 'pt' && layer.tituloUIPt) return layer.tituloUIPt;
  return layer.tituloUIEs || layer.tituloUI || layer.titulo || layer.typename || '—';
}

function geomTooltip(type) {
  const lang = getLang();
  const map = {
    es: { polygon: 'Polígono', line: 'Línea',  point: 'Punto' },
    en: { polygon: 'Polygon',  line: 'Line',   point: 'Point' },
    pt: { polygon: 'Polígono', line: 'Linha',  point: 'Ponto' },
  };
  return (map[lang] || map.es)[type] || type;
}

// ── Países ─────────────────────────────────────────────────────────

function getCountries() {
  const lang = getLang();
  return (window.COUNTRIES || []).map(c => ({
    code:  c.code,
    label: c[lang] || c.es || c.code.toUpperCase(),
    state: c.status || 'inactive',
  }));
}

// ── Datos desde window ─────────────────────────────────────────────

function getLayersBySource() {
  const result = {};
  if (!window.LAYERS) return result;
  for (const [, layer] of Object.entries(window.LAYERS)) {
    if (layer.special !== false) continue;
    if (layer.visible === false) continue;
    if (!layer.source) continue;
    if (!result[layer.source]) result[layer.source] = [];
    result[layer.source].push({
      titulo:   layerTitle(layer),
      typename: layer.typename || '',
      geomType: layer.geomType || 'polygon',
    });
  }
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => a.titulo.localeCompare(b.titulo, getLang()));
  }
  return result;
}

function buildSearchIndex(layersBySource) {
  const index = [];
  for (const [sourceKey, layers] of Object.entries(layersBySource)) {
    const src = window.SOURCES?.[sourceKey];
    if (!src) continue;
    for (const l of layers) {
      index.push({ ...l, sourceKey, sourceLabel: src.label, countryCode: src.country });
    }
  }
  return index;
}

// ── Estado de filtro ───────────────────────────────────────────────

let activeFilter = null;

// ── Health checks ──────────────────────────────────────────────────

const healthState = {};

function buildCheckUrl(sourceKey) {
  const src = window.SOURCES?.[sourceKey];
  if (!src) return null;
  if (src.wfsBase)  return `${src.wfsBase}?service=WFS&request=GetCapabilities&version=1.1.0`;
  if (src.restBase) return `${src.restBase}?f=json`;
  return null;
}

async function checkSource(sourceKey) {
  const url = buildCheckUrl(sourceKey);
  if (!url) { setStatus(sourceKey, 'error'); return; }
  setStatus(sourceKey, 'checking');
  try {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    await fetch(url, { method: 'HEAD', signal: ctrl.signal, mode: 'no-cors' });
    clearTimeout(timeout);
    setStatus(sourceKey, 'ok');
  } catch {
    setStatus(sourceKey, 'error');
  }
}

function setStatus(sourceKey, status) {
  healthState[sourceKey] = status;

  const dot = document.querySelector(`.service-card[data-source="${sourceKey}"] .service-status-dot`);
  const lbl = document.querySelector(`.service-card[data-source="${sourceKey}"] .service-status-label`);
  if (dot) dot.className = 'service-status-dot ' + status;
  if (lbl) {
    const lang = getLang();
    const labels = {
      es: { checking: 'verificando…', ok: 'en línea',    error: 'sin respuesta' },
      en: { checking: 'checking…',    ok: 'online',       error: 'no response'   },
      pt: { checking: 'verificando…', ok: 'on-line',      error: 'sem resposta'  },
    };
    lbl.className   = 'service-status-label ' + status;
    lbl.textContent = (labels[lang] || labels.es)[status];
  }

  applyFilter(activeFilter);
  updateSummary();
}

// ── Filtro ─────────────────────────────────────────────────────────

function applyFilter(filter) {
  activeFilter = filter;

  // Iterar TODOS los country-blocks
  document.querySelectorAll('.country-block').forEach(block => {
    // Los inactive/soon sin servicios: siempre ocultar si hay filtro activo
    if (block.classList.contains('country-inactive')) {
      block.style.display = filter ? 'none' : '';
      return;
    }
    if (block.classList.contains('country-soon-block')) {
      // soon puede tener servicios — misma lógica que active
    }

    const cards = block.querySelectorAll('.service-card');
    if (!cards.length) {
      // soon sin servicios
      block.style.display = filter ? 'none' : '';
      return;
    }

    let visibleCount = 0;
    cards.forEach(card => {
      const key    = card.dataset.source;
      const status = healthState[key];
      const show   = !filter || status === filter;
      card.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });

    block.style.display = filter && visibleCount === 0 ? 'none' : '';
  });

  updateSummary();
}

function updateSummary() {
  const counts = { ok: 0, error: 0, checking: 0 };
  for (const v of Object.values(healthState)) counts[v] = (counts[v] || 0) + 1;

  const totalSources = Object.keys(window.SOURCES || {}).length;
  const totalLayers  = Object.values(window._STATUS_LAYERS || {}).flat().length;
  const lang         = getLang();

  const labels = {
    es: { total: 'servicios', layers: 'capas',   online: 'en línea',   offline: 'sin respuesta' },
    en: { total: 'services',  layers: 'layers',  online: 'online',     offline: 'no response'   },
    pt: { total: 'serviços',  layers: 'camadas', online: 'on-line',    offline: 'sem resposta'  },
  };
  const l = labels[lang] || labels.es;

  const mkChip = (cls, filter, count, text) => {
    const isActive = activeFilter === filter ? ' active' : '';
    return `<button class="summary-chip ${cls}${isActive}" onclick="toggleFilter('${filter}')">
      <span class="dot"></span>${count} ${text}
    </button>`;
  };

  document.getElementById('summary-bar').innerHTML = `
    <div class="summary-chip info">
      <span class="dot"></span>${totalSources} ${l.total} &middot; ${totalLayers} ${l.layers}
    </div>
    ${mkChip('ok',  'ok',    counts.ok    || 0, l.online)}
    ${mkChip('err', 'error', counts.error || 0, l.offline)}
    ${counts.checking ? `<div class="summary-chip pend"><span class="dot"></span>${counts.checking} …</div>` : ''}
  `;
}

function toggleFilter(filter) {
  applyFilter(activeFilter === filter ? null : filter);
}

// ── Render helpers ─────────────────────────────────────────────────

function geomIconHTML(type) {
  const tip = geomTooltip(type);
  if (type === 'polygon') return `<span class="material-icons" data-tooltip="${tip}" style="font-family:'Material Icons Outlined',sans-serif">hexagon</span>`;
  if (type === 'line')    return `<span class="material-icons" data-tooltip="${tip}">horizontal_rule</span>`;
  if (type === 'point')   return `<span class="material-icons" data-tooltip="${tip}">radio_button_unchecked</span>`;
  return `<span class="material-icons">layers</span>`;
}

function renderLayerRow(l) {
  return `
    <div class="layer-row" data-typename="${l.typename}">
      <div class="layer-text">
        <span class="layer-name">${l.titulo}</span>
        <span class="layer-key">${l.typename}</span>
      </div>
      <div class="layer-geom">${geomIconHTML(l.geomType)}</div>
    </div>
  `;
}

function renderLayers(layers) {
  if (!layers || !layers.length) return `<p class="layers-empty">—</p>`;
  return layers.map(renderLayerRow).join('');
}

// ── Global search ──────────────────────────────────────────────────

let searchIndex = [];

function onGlobalSearch(value) {
  const q         = value.trim().toLowerCase();
  const resultsEl = document.getElementById('global-search-results');

  if (!q) {
    resultsEl.classList.remove('visible');
    resultsEl.innerHTML = '';
    return;
  }

  const matches = searchIndex
    .filter(l => l.titulo.toLowerCase().includes(q) || l.typename.toLowerCase().includes(q))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, getLang()));

  resultsEl.innerHTML = matches.length
    ? matches.map(l => `
        <div class="search-result-row">
          <div class="search-result-info">
            <div class="search-result-name">${l.titulo}</div>
            <div class="search-result-key">${l.typename}</div>
          </div>
          <div class="search-result-source">${l.sourceLabel}</div>
          <div class="search-geom-icon">${geomIconHTML(l.geomType)}</div>
        </div>
      `).join('')
    : `<p class="search-no-results">—</p>`;

  resultsEl.classList.add('visible');
}

// ── Render cards ───────────────────────────────────────────────────

function renderServiceCard(sourceKey, layersBySource) {
  const src    = window.SOURCES?.[sourceKey];
  if (!src) return '';
  const layers = layersBySource[sourceKey] || [];
  const tipo   = src.wfsBase ? 'wfs' : 'rest';

  return `
    <div class="service-card" data-source="${sourceKey}">
      <div class="service-header" onclick="toggleService('${sourceKey}')">
        <span class="service-status-dot checking"></span>
        <div class="service-info">
          <div class="service-name">${src.label} <span class="badge">${tipo}</span></div>
          <div class="service-layer-count">${layers.length} capas</div>
        </div>
        <span class="service-status-label checking">verificando…</span>
        <span class="service-toggle"><span class="material-icons">expand_more</span></span>
      </div>
      <div class="layers-panel">
        <div class="layers-grid">
          ${renderLayers(layers)}
        </div>
      </div>
    </div>
  `;
}

// Render country block — active, soon y inactive comparten lógica de servicios
function renderCountryBlock(country, layersBySource) {
  const { code, label, state } = country;
  const badges = window.COUNTRIES_LABELS?.[getLang()] || window.COUNTRIES_LABELS?.es;

  // Inactive sin servicios: solo header gris, no desplegable
  if (state === 'inactive') {
    const countrySources = Object.keys(window.SOURCES || {})
      .filter(k => window.SOURCES[k].country === code);

    if (!countrySources.length) {
      return `
        <div class="country-block country-inactive" data-country="${code}">
          <div class="country-header inactive">
            <span class="country-name">${label}</span>
          </div>
        </div>
      `;
    }
    // Inactive con servicios: misma estructura que active pero con estilo gris
  }

  const countrySources = Object.keys(window.SOURCES || {})
    .filter(k => window.SOURCES[k].country === code);

  // Sin servicios y no active: solo header
  if (!countrySources.length) {
    const headerClass = state === 'soon' ? 'country-header country-header-soon' : 'country-header inactive';
    const blockClass  = state === 'soon' ? 'country-soon-block' : 'country-inactive';
    const badge       = state === 'soon' ? `<span class="country-soon">${badges.soon}</span>` : '';
    return `
      <div class="country-block ${blockClass}" data-country="${code}">
        <div class="${headerClass}" ${state !== 'soon' ? 'style="opacity:.4;cursor:default;pointer-events:none"' : ''}>
          <span class="country-name">${label}</span>
          ${badge}
        </div>
      </div>
    `;
  }

  // Con servicios: desplegable, color según state
  const blockClass  = state === 'active' ? 'country-active'
                    : state === 'soon'   ? 'country-soon-block'
                    : 'country-inactive-has-services';

  const badgeHTML = state === 'active' ? `<span class="country-active-label">${badges.active}</span>`
                  : state === 'soon'   ? `<span class="country-soon">${badges.soon}</span>`
                  : '';

  return `
    <div class="country-block ${blockClass}" data-country="${code}">
      <div class="country-header ${state !== 'active' && state !== 'soon' ? 'country-header-inactive-services' : ''}"
           onclick="toggleCountry('${code}')">
        <span class="country-name">${label}</span>
        ${badgeHTML}
        <span class="country-toggle"><span class="material-icons">expand_more</span></span>
      </div>
      <div class="services-list">
        ${countrySources.map(k => renderServiceCard(k, layersBySource)).join('')}
      </div>
    </div>
  `;
}

// ── Toggle handlers ────────────────────────────────────────────────

function toggleCountry(code) {
  document.querySelector(`.country-block[data-country="${code}"]`).classList.toggle('open');
}

function toggleService(sourceKey) {
  document.querySelector(`.service-card[data-source="${sourceKey}"]`).classList.toggle('open');
}

// ── Theme toggle (transitorio para testing) ────────────────────────

function toggleTheme() {
  document.body.classList.toggle('day');
}

// ── Runner ─────────────────────────────────────────────────────────

function runHealthChecks() {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  const sources = Object.keys(window.SOURCES || {});
  sources.forEach(k => { healthState[k] = 'checking'; });
  const checks = sources.map(k => checkSource(k));
  Promise.allSettled(checks).then(() => btn.classList.remove('spinning'));
}

// ── Init ───────────────────────────────────────────────────────────

function initStatus() {
  const layersBySource  = getLayersBySource();
  window._STATUS_LAYERS = layersBySource;
  searchIndex           = buildSearchIndex(layersBySource);

  document.getElementById('country-list').innerHTML =
    getCountries().map(c => renderCountryBlock(c, layersBySource)).join('');

  document.getElementById('global-search')
    .addEventListener('input', e => onGlobalSearch(e.target.value));

  document.getElementById('btn-refresh')
    .addEventListener('click', runHealthChecks);

  Object.keys(window.SOURCES || {}).forEach(k => { healthState[k] = 'checking'; });
  updateSummary();

  setTimeout(runHealthChecks, 100);

  const theme = window.SETTINGS?.get?.('theme');
  const h     = new Date().getHours();
  if (theme === 'day' || (!theme && h >= 7 && h < 20)) {
    document.body.classList.add('day');
  }
}

if (window.LAYERS && Object.keys(window.LAYERS).length > 0) {
  document.addEventListener('DOMContentLoaded', initStatus);
} else {
  window.addEventListener('layers:ready', initStatus);
}
