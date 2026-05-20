/**
 * src/status.js — Página de estado de servicios
 *
 * Lee window.SOURCES y window.LAYERS (cargados por sources.js y layers/index.js).
 * Espera el evento 'layers:ready' antes de renderizar.
 * Ejecuta health checks en paralelo sin bloquear el paint inicial.
 */

// ── Lista de países ────────────────────────────────────────────────
// state: 'active' | 'soon' | 'inactive'
// 'active'   → verde, tiene servicios funcionando
// 'soon'     → amarillo, tiene servicios pero con errores/parciales
// 'inactive' → gris, sin datos todavía

const COUNTRIES = [
  { code: 'ar', label: 'Argentina', state: 'active'   },
  { code: 'bo', label: 'Bolivia',   state: 'inactive'  },
  { code: 'br', label: 'Brasil',    state: 'inactive'  },
  { code: 'cl', label: 'Chile',     state: 'soon'      },
  { code: 'co', label: 'Colombia',  state: 'inactive'  },
  { code: 'ec', label: 'Ecuador',   state: 'inactive'  },
  { code: 'gy', label: 'Guyana',    state: 'inactive'  },
  { code: 'py', label: 'Paraguay',  state: 'inactive'  },
  { code: 'pe', label: 'Perú',      state: 'inactive'  },
  { code: 'sr', label: 'Surinam',   state: 'inactive'  },
  { code: 'uy', label: 'Uruguay',   state: 'active'    },
  { code: 've', label: 'Venezuela', state: 'inactive'  },
];

// ── Derivar datos desde window.SOURCES y window.LAYERS ────────────

function getLayersBySource() {
  const result = {};
  if (!window.LAYERS) return result;

  for (const [, layer] of Object.entries(window.LAYERS)) {
    if (layer.special !== false) continue;       // solo capas públicas
    if (layer.visible === false) continue;       // solo visibles por defecto
    if (!layer.source) continue;

    if (!result[layer.source]) result[layer.source] = [];
    result[layer.source].push({
      key:      layer.layerKey || layer.source,  // clave única de la capa
      titulo:   layer.tituloUI || layer.titulo,
      geomType: layer.geomType || 'polygon',
    });
  }

  // Ordenar cada lista alfabéticamente
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  }

  return result;
}

// ── Índice de búsqueda ─────────────────────────────────────────────

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
    // mode:'no-cors' evita bloqueo CORS; si no lanza = servidor alcanzable
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
    const labels = { checking: 'verificando…', ok: 'en línea', error: 'sin respuesta' };
    lbl.className = 'service-status-label ' + status;
    lbl.textContent = labels[status];
  }

  const src = window.SOURCES?.[sourceKey];
  if (src) {
    const countryDot = document.querySelector(
      `.country-block[data-country="${src.country}"] .src-dot[data-source="${sourceKey}"]`
    );
    if (countryDot) countryDot.className = 'src-dot ' + status;
  }

  updateSummary();
}

function updateSummary() {
  const counts = { ok: 0, error: 0, checking: 0 };
  for (const v of Object.values(healthState)) counts[v] = (counts[v] || 0) + 1;

  const totalSources = Object.keys(window.SOURCES || {}).length;
  const totalLayers  = Object.values(window._STATUS_LAYERS_BY_SOURCE || {}).flat().length;

  document.getElementById('summary-bar').innerHTML = `
    <div class="summary-chip ok"><span class="dot"></span>${counts.ok || 0} en línea</div>
    <div class="summary-chip err"><span class="dot"></span>${counts.error || 0} sin respuesta</div>
    ${counts.checking ? `<div class="summary-chip pend"><span class="dot"></span>${counts.checking} verificando…</div>` : ''}
    <div class="summary-chip pend" style="margin-left:auto;border-color:var(--border-md)">
      <span class="dot" style="background:var(--accent);animation:none"></span>
      ${totalSources} servicios · ${totalLayers} capas
    </div>
  `;
}

// ── Render helpers ─────────────────────────────────────────────────

function geomIconHTML(type) {
  if (type === 'polygon') return `<span class="material-icons" data-tooltip="Polígono" style="font-family:'Material Icons Outlined',sans-serif">hexagon</span>`;
  if (type === 'line')    return `<span class="material-icons" data-tooltip="Línea">horizontal_rule</span>`;
  if (type === 'point')   return `<span class="material-icons" data-tooltip="Punto">radio_button_unchecked</span>`;
  return `<span class="material-icons">layers</span>`;
}

function renderLayerRow(l) {
  return `
    <div class="layer-row" data-key="${l.key}">
      <div class="layer-text">
        <span class="layer-name">${l.titulo}</span>
        <span class="layer-key">${l.key}</span>
      </div>
      <div class="layer-geom">${geomIconHTML(l.geomType)}</div>
    </div>
  `;
}

function renderLayers(layers) {
  if (!layers || !layers.length) return `<p class="layers-empty">Sin capas</p>`;
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
    .filter(l => l.titulo.toLowerCase().includes(q) || l.key.toLowerCase().includes(q))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));

  resultsEl.innerHTML = matches.length
    ? matches.map(l => `
        <div class="search-result-row">
          <div class="search-result-info">
            <div class="search-result-name">${l.titulo}</div>
            <div class="search-result-key">${l.key}</div>
          </div>
          <div class="search-result-source">${l.sourceLabel}</div>
          <div class="search-geom-icon">${geomIconHTML(l.geomType)}</div>
        </div>
      `).join('')
    : `<p class="search-no-results">Sin resultados para "${value}"</p>`;

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
          <div class="service-name">${src.label}</div>
          <div class="service-meta">
            <span class="badge">${tipo}</span>
            <span class="service-layer-count">${layers.length} capas</span>
          </div>
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

function renderCountryBlock(country, layersBySource) {
  const { code, label, state } = country;

  if (state === 'inactive') {
    return `
      <div class="country-block country-inactive" data-country="${code}">
        <div class="country-header inactive">
          <span class="country-name">${label}</span>
          <span class="country-soon">próximamente</span>
        </div>
      </div>
    `;
  }

  if (state === 'soon') {
    return `
      <div class="country-block country-soon-block" data-country="${code}">
        <div class="country-header country-header-soon">
          <span class="country-name">${label}</span>
          <span class="country-soon">con errores</span>
        </div>
      </div>
    `;
  }

  // state === 'active'
  const countrySources = Object.keys(window.SOURCES || {})
    .filter(k => window.SOURCES[k].country === code);

  const srcDots = countrySources
    .map(k => `<span class="src-dot checking" data-source="${k}"></span>`)
    .join('');

  return `
    <div class="country-block country-active" data-country="${code}">
      <div class="country-header" onclick="toggleCountry('${code}')">
        <span class="country-name">${label}</span>
        <div class="src-dots">${srcDots}</div>
        <span class="country-src-count">${countrySources.length} ${countrySources.length === 1 ? 'servicio' : 'servicios'}</span>
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

// ── Health checks runner ───────────────────────────────────────────

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
  const layersBySource = getLayersBySource();

  // Guardar referencia global para updateSummary
  window._STATUS_LAYERS_BY_SOURCE = layersBySource;

  searchIndex = buildSearchIndex(layersBySource);

  document.getElementById('country-list').innerHTML =
    COUNTRIES.map(c => renderCountryBlock(c, layersBySource)).join('');

  document.getElementById('global-search').addEventListener('input', e => {
    onGlobalSearch(e.target.value);
  });

  document.getElementById('btn-refresh').addEventListener('click', runHealthChecks);

  Object.keys(window.SOURCES || {}).forEach(k => { healthState[k] = 'checking'; });
  updateSummary();

  // Health checks en paralelo, sin bloquear el paint inicial
  setTimeout(runHealthChecks, 100);

  // Tema: leer de window.SETTINGS si está disponible (chat cargado),
  // si no, usar la hora como fallback
  const theme = window.SETTINGS?.get?.('theme');
  if (theme === 'day' || (!theme && new Date().getHours() >= 7 && new Date().getHours() < 20)) {
    document.body.classList.add('day');
  }
}

// Esperar layers:ready (igual que app.js), con fallback por si ya cargó
if (window.LAYERS && Object.keys(window.LAYERS).length > 0) {
  document.addEventListener('DOMContentLoaded', initStatus);
} else {
  window.addEventListener('layers:ready', initStatus);
}
