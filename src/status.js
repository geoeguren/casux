/**
 * src/status.js — Página de estado de geoservicios
 */

// ── Strings i18n ───────────────────────────────────────────────────

const UI = {
  es: {
    pageTitle:    'Estado de geoservicios',
    pageSubtitle: 'Fuentes de los datos geoespaciales conectados a Casux en tiempo real.',
    tabTitle:     'Casux — Estado de geoservicios',
    backLabel:    'Volver al chat',
    refreshBtn:   'Actualizar',
    searchPlaceholder: 'Buscar capas…',
    themeToggleTitle:  'Cambiar tema',
    totalServices: 'servicios',
    soon:          'próximamente',
    online:        'en línea',
    offline:       'sin respuesta',
    checking:      'verificando…',
    layers:        'capas',
    noResults:     'Sin resultados',
  },
  en: {
    pageTitle:    'Geoservice status',
    pageSubtitle: 'Geospatial data sources connected to Casux in real time.',
    tabTitle:     'Casux — Geoservice status',
    backLabel:    'Back to chat',
    refreshBtn:   'Refresh',
    searchPlaceholder: 'Search layers…',
    themeToggleTitle:  'Toggle theme',
    totalServices: 'services',
    soon:          'coming soon',
    online:        'online',
    offline:       'no response',
    checking:      'checking…',
    layers:        'layers',
    noResults:     'No results',
  },
  pt: {
    pageTitle:    'Estado dos geoserviços',
    pageSubtitle: 'Fontes dos dados geoespaciais conectados ao Casux em tempo real.',
    tabTitle:     'Casux — Estado dos geoserviços',
    backLabel:    'Voltar ao chat',
    refreshBtn:   'Atualizar',
    searchPlaceholder: 'Buscar camadas…',
    themeToggleTitle:  'Alternar tema',
    totalServices: 'serviços',
    soon:          'em breve',
    online:        'on-line',
    offline:       'sem resposta',
    checking:      'verificando…',
    layers:        'camadas',
    noResults:     'Sem resultados',
  },
};

// ── Idioma ─────────────────────────────────────────────────────────

function getLang() {
  return window.I18N?.getLang?.() || window.SETTINGS?.get?.('lang') || 'es';
}

function ui(key) {
  return (UI[getLang()] || UI.es)[key] || key;
}

function layerTitle(layer) {
  const lang = getLang();
  if (lang === 'en' && layer.tituloUIEn) return layer.tituloUIEn;
  if (lang === 'pt' && layer.tituloUIPt) return layer.tituloUIPt;
  return layer.tituloUIEs || layer.tituloUI || layer.titulo || layer.typename || '—';
}

function geomTooltip(type) {
  const map = {
    es: { polygon: 'Polígono', line: 'Línea',  point: 'Punto' },
    en: { polygon: 'Polygon',  line: 'Line',   point: 'Point' },
    pt: { polygon: 'Polígono', line: 'Linha',  point: 'Ponto' },
  };
  return (map[getLang()] || map.es)[type] || type;
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
      titulo:       layerTitle(layer),
      typename:     layer.typename || '',
      geomType:     layer.geomType || 'polygon',
      featureCount: layer.featureCount ?? null,
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
// null = sin filtro | 'ok' = en línea | 'error' = sin respuesta | 'soon' = próximamente

let activeFilter = null;

// ── Health checks ──────────────────────────────────────────────────

const healthState = {};

// Países con state='soon' — sus servicios se muestran en amarillo independientemente del estado real
function isSoonCountry(sourceKey) {
  const src = window.SOURCES?.[sourceKey];
  if (!src) return false;
  const country = (window.COUNTRIES || []).find(c => c.code === src.country);
  return country?.status === 'soon';
}

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

  // Servicios de países 'soon': siempre muestran amarillo, independientemente del estado real
  const soon = isSoonCountry(sourceKey);

  if (dot) {
    dot.className = soon ? 'service-status-dot soon' : 'service-status-dot ' + status;
  }
  if (lbl) {
    const text = {
      checking: ui('checking'),
      ok:       ui('online'),
      error:    ui('offline'),
    }[status] || status;
    lbl.className   = soon ? 'service-status-label soon' : 'service-status-label ' + status;
    lbl.textContent = text;
  }

  applyFilter(activeFilter);
  updateSummary();
}

// ── Filtro ─────────────────────────────────────────────────────────

function applyFilter(filter) {
  activeFilter = filter;

  document.querySelectorAll('.country-block').forEach(block => {
    const code    = block.dataset.country;
    const country = (window.COUNTRIES || []).find(c => c.code === code);
    const state   = country?.status || 'inactive';
    const cards   = block.querySelectorAll('.service-card');

    // Sin servicios: mostrar solo cuando no hay filtro activo (o filtro 'soon' para soon)
    if (!cards.length) {
      if (!filter) {
        block.style.display = '';
      } else if (filter === 'soon' && state === 'soon') {
        block.style.display = '';
      } else {
        block.style.display = 'none';
      }
      return;
    }

    // Filtro 'soon': mostrar solo bloques de países soon
    if (filter === 'soon') {
      block.style.display = state === 'soon' ? '' : 'none';
      cards.forEach(card => { card.style.display = ''; });
      return;
    }

    // Filtros 'ok' / 'error': excluir completamente bloques soon
    if (filter && state === 'soon') {
      block.style.display = 'none';
      return;
    }

    // Sin filtro: mostrar todo
    if (!filter) {
      block.style.display = '';
      cards.forEach(card => { card.style.display = ''; });
      return;
    }

    // Filtro ok/error sobre bloques normales
    let visibleCount = 0;
    cards.forEach(card => {
      const s    = healthState[card.dataset.source];
      const show = s === filter;
      card.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });
    block.style.display = visibleCount === 0 ? 'none' : '';
  });

  updateSummary();
}

function updateSummary() {
  // Contar solo servicios de países no-soon
  let okCount = 0, errCount = 0, checkCount = 0, soonCount = 0;
  for (const [key, status] of Object.entries(healthState)) {
    if (isSoonCountry(key)) { soonCount++; continue; }
    if (status === 'ok')       okCount++;
    else if (status === 'error') errCount++;
    else                         checkCount++;
  }

  const totalSources = Object.keys(window.SOURCES || {}).length;
  const totalLayers  = Object.values(window._STATUS_LAYERS || {}).flat().length;

  const mkChip = (cls, filter, count, text) => {
    const isActive = activeFilter === filter ? ' active' : '';
    return `<button class="summary-chip ${cls}${isActive}" onclick="toggleFilter('${filter}')">
      <span class="dot"></span>${count} ${text}
    </button>`;
  };

  document.getElementById('summary-bar').innerHTML = `
    <button class="summary-chip info${activeFilter === null ? ' active' : ''}" onclick="toggleFilter(null)">
      <span class="dot"></span>${totalSources} ${ui('totalServices')}
    </button>
    ${mkChip('ok',   'ok',    okCount,   ui('online'))}
    ${mkChip('err',  'error', errCount,  ui('offline'))}
    ${soonCount ? mkChip('soon-chip', 'soon', soonCount, ui('soon')) : ''}
    ${checkCount ? `<div class="summary-chip pend"><span class="dot"></span>${checkCount} …</div>` : ''}
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
  const count = l.featureCount != null
    ? `<span class="layer-count">${l.featureCount.toLocaleString()}</span>`
    : '';
  return `
    <div class="layer-row" data-typename="${l.typename}">
      <div class="layer-geom">${geomIconHTML(l.geomType)}</div>
      <div class="layer-text">
        <span class="layer-name">${l.titulo}</span>
        <span class="layer-key">${l.typename}</span>
      </div>
      ${count}
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
    : `<p class="search-no-results">${ui('noResults')}</p>`;

  resultsEl.classList.add('visible');
}

// ── Render cards ───────────────────────────────────────────────────

function renderServiceCard(sourceKey, layersBySource) {
  const src  = window.SOURCES?.[sourceKey];
  if (!src) return '';
  const layers = layersBySource[sourceKey] || [];
  const tipo   = src.wfsBase ? 'wfs' : 'rest';
  const soon   = isSoonCountry(sourceKey);

  return `
    <div class="service-card" data-source="${sourceKey}">
      <div class="service-header" onclick="toggleService('${sourceKey}')">
        <span class="service-status-dot ${soon ? 'soon' : 'checking'}"></span>
        <div class="service-info">
          <div class="service-name">${src.label} <span class="badge">${tipo}</span></div>
          <div class="service-layer-count">${layers.length} ${ui('layers')}</div>
        </div>
        <span class="service-status-label ${soon ? 'soon' : 'checking'}">${ui('checking')}</span>
        <span class="service-toggle"><span class="material-icons">expand_more</span></span>
      </div>
      <div class="layers-panel">
        <div class="layers-grid">${renderLayers(layers)}</div>
      </div>
    </div>
  `;
}

function renderCountryBlock(country, layersBySource) {
  const { code, label, state } = country;
  const badges    = window.COUNTRIES_LABELS?.[getLang()] || window.COUNTRIES_LABELS?.es;
  const sources   = Object.keys(window.SOURCES || {}).filter(k => window.SOURCES[k].country === code);
  const hasSources = sources.length > 0;

  // Determinar clases CSS y badge
  let blockClass, headerClass, badgeHTML, clickable;

  if (state === 'active') {
    blockClass  = 'country-active';
    headerClass = '';
    badgeHTML   = `<span class="country-active-label">${badges.active}</span>`;
    clickable   = true;
  } else if (state === 'soon') {
    blockClass  = 'country-soon-block';
    headerClass = hasSources ? '' : 'country-header-soon';
    badgeHTML   = `<span class="country-soon">${badges.soon}</span>`;
    clickable   = hasSources;
  } else {
    // inactive
    blockClass  = 'country-inactive';
    headerClass = hasSources ? '' : 'inactive';
    badgeHTML   = '';
    clickable   = hasSources;
  }

  if (!hasSources) {
    return `
      <div class="country-block ${blockClass}" data-country="${code}">
        <div class="country-header ${headerClass}">
          <span class="country-name">${label}</span>
          ${badgeHTML}
        </div>
      </div>
    `;
  }

  return `
    <div class="country-block ${blockClass}" data-country="${code}">
      <div class="country-header" onclick="toggleCountry('${code}')">
        <span class="country-name">${label}</span>
        ${badgeHTML}
        <span class="country-toggle"><span class="material-icons">expand_more</span></span>
      </div>
      <div class="services-list">
        ${sources.map(k => renderServiceCard(k, layersBySource)).join('')}
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

// ── Aplicar i18n al HTML estático ──────────────────────────────────

function applyStaticI18n() {
  const lang = getLang();
  document.title                                         = ui('tabTitle');
  document.getElementById('page-title').textContent     = ui('pageTitle');
  document.getElementById('page-subtitle').textContent  = ui('pageSubtitle');
  document.getElementById('back-label').textContent     = ui('backLabel');
  document.getElementById('btn-refresh-label').textContent = ui('refreshBtn');
  document.getElementById('global-search').placeholder  = ui('searchPlaceholder');
  document.getElementById('theme-toggle-btn').title     = ui('themeToggleTitle');
  document.documentElement.lang = lang;
}

// ── Init ───────────────────────────────────────────────────────────

function initStatus() {
  applyStaticI18n();

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
