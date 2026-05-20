/**
 * src/status.js — Página de estado de geoservicios
 */

// ── Strings i18n ───────────────────────────────────────────────────

const UI = {
  es: {
    pageTitle:    'Estado de geoservicios',
    pageSubtitle: 'Fuentes de los datos geoespaciales conectados a Casux en tiempo real.',
    tabTitle:     'Casux — Estado de geoservicios',
    backLabel:    'Volver',
    refreshBtn:   'Actualizar',
    searchPlaceholder: 'Buscar capas disponibles…',
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
    backLabel:    'Back',
    refreshBtn:   'Refresh',
    searchPlaceholder: 'Search available layers…',
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
    backLabel:    'Voltar',
    refreshBtn:   'Atualizar',
    searchPlaceholder: 'Buscar camadas disponíveis…',
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
  const displayThreshold = window.CLIP_THRESHOLDS?.display ?? 55000;
  for (const [, layer] of Object.entries(window.LAYERS)) {
    if (layer.special !== false) continue;
    if (layer.visible === false) continue;
    if (!layer.source) continue;
    if (!result[layer.source]) result[layer.source] = [];
    const fc = layer.featureCount ?? null;
    result[layer.source].push({
      titulo:       layerTitle(layer),
      typename:     layer.typename || '',
      geomType:     layer.geomType || 'polygon',
      featureCount: fc,
      restricted:   fc != null && fc > displayThreshold,
      keywordsEs:   layer.keywordsEs || [],
      keywordsEn:   layer.keywordsEn || [],
      keywordsPt:   layer.keywordsPt || [],
    });
  }
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => a.titulo.localeCompare(b.titulo, getLang()));
  }
  return result;
}

// ── Estado de filtro ───────────────────────────────────────────────
// Set de filtros activos: 'ok' | 'error' | 'soon'
// Set vacío = sin filtro (mostrar todo)

const activeFilters = new Set();

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
  if (dot) dot.className = 'service-status-dot ' + status;

  applyFilters();
  updateSummary();
}

// ── Filtros ────────────────────────────────────────────────────────

function applyFilters() {
  const none = activeFilters.size === 0;

  document.querySelectorAll('.country-block').forEach(block => {
    const code    = block.dataset.country;
    const country = (window.COUNTRIES || []).find(c => c.code === code);
    const state   = country?.status || 'inactive';
    const isSoon  = state === 'soon';
    const cards   = block.querySelectorAll('.service-card');

    if (none) {
      block.style.display = '';
      cards.forEach(c => { c.style.display = ''; });
      return;
    }

    // Bloque soon: visible solo si 'soon' está en el set de filtros
    if (isSoon) {
      block.style.display = activeFilters.has('soon') ? '' : 'none';
      cards.forEach(c => { c.style.display = ''; });
      return;
    }

    // Bloques normales: 'soon' en filtros no los afecta
    const statusFilters = [...activeFilters].filter(f => f !== 'soon');
    if (!statusFilters.length) {
      // Solo filtro soon activo, bloques normales se muestran todos
      block.style.display = '';
      cards.forEach(c => { c.style.display = ''; });
      return;
    }

    let visibleCount = 0;
    cards.forEach(card => {
      const s    = healthState[card.dataset.source];
      const show = statusFilters.includes(s);
      card.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });
    block.style.display = visibleCount === 0 ? 'none' : '';
  });

  updateSummary();
}

function toggleFilter(filter) {
  if (activeFilters.has(filter)) {
    activeFilters.delete(filter);
  } else {
    activeFilters.add(filter);
  }
  applyFilters();
}

function updateSummary() {
  let okCount = 0, errCount = 0, checkCount = 0, soonCount = 0;
  for (const [key, status] of Object.entries(healthState)) {
    if (isSoonCountry(key)) { soonCount++; continue; }
    if (status === 'ok')         okCount++;
    else if (status === 'error') errCount++;
    else                         checkCount++;
  }

  const mkChip = (cls, filter, count, text) => {
    const isActive = activeFilters.has(filter) ? ' active' : '';
    return `<button class="summary-chip ${cls}${isActive}" onclick="toggleFilter('${filter}')">
      <span class="dot"></span>${count} ${text}
    </button>`;
  };

  document.getElementById('summary-bar').innerHTML = `
    ${mkChip('ok',        'ok',    okCount,   ui('online'))}
    ${soonCount ? mkChip('soon-chip', 'soon', soonCount, ui('soon')) : ''}
    ${mkChip('err',       'error', errCount,  ui('offline'))}
    ${checkCount ? `<div class="summary-chip pend"><span class="dot"></span>${checkCount} …</div>` : ''}
    <button class="refresh-btn" id="btn-refresh">
      <span class="material-icons">refresh</span>
      ${ui('refreshBtn')}
    </button>
  `;
  document.getElementById('btn-refresh')?.addEventListener('click', runHealthChecks);
}

// ── Render helpers ─────────────────────────────────────────────────

function geomIconHTML(type) {
  if (type === 'polygon') return `<span class="material-icons" style="font-family:'Material Icons Outlined',sans-serif">hexagon</span>`;
  if (type === 'line')    return `<span class="material-icons">horizontal_rule</span>`;
  if (type === 'point')   return `<span class="material-icons">radio_button_unchecked</span>`;
  return `<span class="material-icons">layers</span>`;
}

function renderLayerRow(l) {
  const count = l.featureCount != null
    ? `<span class="layer-count${l.restricted ? ' layer-count-restricted' : ''}">${l.featureCount.toLocaleString()}</span>`
    : '';

  if (l.restricted) {
    return `
      <div class="layer-row layer-row-restricted" data-typename="${l.typename}">
        <div class="layer-geom layer-geom-restricted">${geomIconHTML(l.geomType)}</div>
        <div class="layer-text">
          <span class="layer-name layer-name-restricted">${l.titulo}</span>
          <span class="layer-key layer-key-restricted">${l.typename}</span>
        </div>
        ${count}
        <span class="material-icons layer-restricted-icon">block</span>
      </div>
    `;
  }

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
        <span class="service-status-dot checking"></span>
        <div class="service-info">
          <div class="service-name">${src.label} <span class="badge">${tipo}</span></div>
        </div>
        <span class="service-layer-count-right">${layers.length} ${ui('layers')}</span>
        <span class="service-toggle"><span class="material-icons">expand_more</span></span>
      </div>
      <div class="layers-panel">
        <div class="layers-grid-scroll"><div class="layers-grid">${renderLayers(layers)}</div></div>
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
  document.title                                        = ui('tabTitle');
  document.getElementById('page-title').textContent    = ui('pageTitle');
  document.getElementById('back-label').textContent    = ui('backLabel');
  document.documentElement.lang = lang;
}

// ── Init ───────────────────────────────────────────────────────────

function initStatus() {
  applyStaticI18n();

  const layersBySource  = getLayersBySource();
  window._STATUS_LAYERS = layersBySource;

  document.getElementById('country-list').innerHTML =
    getCountries().map(c => renderCountryBlock(c, layersBySource)).join('');

  Object.keys(window.SOURCES || {}).forEach(k => { healthState[k] = 'checking'; });
  updateSummary();

  setTimeout(runHealthChecks, 100);

  // Tema: igual que app.js — lee sm_theme de localStorage, fallback por hora
  const savedTheme = localStorage.getItem('sm_theme');
  const isDayHour  = new Date().getHours() >= 7 && new Date().getHours() < 20;
  const theme      = savedTheme || (isDayHour ? 'day' : 'night');
  document.body.classList.toggle('day', theme === 'day');
  document.documentElement.classList.toggle('day', theme === 'day');
}

if (window.LAYERS && Object.keys(window.LAYERS).length > 0) {
  document.addEventListener('DOMContentLoaded', initStatus);
} else {
  window.addEventListener('layers:ready', initStatus);
}
