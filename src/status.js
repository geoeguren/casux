/**
 * src/status.js — Página de estado de servicios
 *
 * Renderiza los países, servicios y capas disponibles en Casux.
 * Ejecuta health checks en paralelo al cargar la página.
 *
 * En producción, SOURCES y LAYERS_BY_SOURCE pueden reemplazarse por
 * window.SOURCES y un filtro sobre window.LAYERS (special:false, visible:true).
 */

// ── Datos ──────────────────────────────────────────────────────────

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

const SOURCES = {
  ign_ar: {
    label:   'Instituto Geográfico Nacional',
    country: 'ar',
    wfsBase: 'https://wms.ign.gob.ar/geoserver/ows',
    tipo:    'wfs',
  },
  igm_uy: {
    label:   'Instituto Geográfico Militar',
    country: 'uy',
    wfsBase: 'https://sig.igm.gub.uy/geoserver/wfs',
    tipo:    'wfs',
  },
  mtop_uy: {
    label:   'Ministerio de Transporte y Obras Públicas',
    country: 'uy',
    wfsBase: 'https://geoservicios.mtop.gub.uy/geoserver/ows',
    tipo:    'wfs',
  },
  mop_cl: {
    label:    'Ministerio de Obras Públicas',
    country:  'cl',
    restBase: 'https://rest-sit.mop.gob.cl/arcgis/rest/services',
    tipo:     'rest',
  },
};

// Solo capas con visible: true y special: false
const LAYERS_BY_SOURCE = {
  ign_ar: [
    { key: 'area_protegida_ar',  titulo: 'Áreas naturales protegidas',    geomType: 'polygon' },
    { key: 'aeropuerto_ar',      titulo: 'Aeropuertos y aeródromos',       geomType: 'point'   },
    { key: 'costa_ar',           titulo: 'Línea de costa',                 geomType: 'line'    },
    { key: 'departamento_ar',    titulo: 'Departamentos de Argentina',     geomType: 'polygon' },
    { key: 'embalse_ar',         titulo: 'Embalses y represas',            geomType: 'polygon' },
    { key: 'ferrocarril_ar',     titulo: 'Ferrocarriles',                  geomType: 'line'    },
    { key: 'lago_ar',            titulo: 'Lagos y lagunas',                geomType: 'polygon' },
    { key: 'limite_maritimo_ar', titulo: 'Límites marítimos',              geomType: 'line'    },
    { key: 'localidad_ar',       titulo: 'Localidades urbanas',            geomType: 'point'   },
    { key: 'municipio_ar',       titulo: 'Municipios de Argentina',        geomType: 'polygon' },
    { key: 'paraje_ar',          titulo: 'Parajes y localidades rurales',  geomType: 'point'   },
    { key: 'provincia_ar',       titulo: 'Provincias de Argentina',        geomType: 'polygon' },
    { key: 'puerto_ar',          titulo: 'Puertos',                        geomType: 'point'   },
    { key: 'rio_ar',             titulo: 'Ríos',                           geomType: 'line'    },
    { key: 'vial_nacional_ar',   titulo: 'Red vial nacional',              geomType: 'line'    },
    { key: 'vial_provincial_ar', titulo: 'Red vial provincial',            geomType: 'line'    },
  ],
  igm_uy: [
    { key: 'departamento_uy',    titulo: 'Departamentos de Uruguay',       geomType: 'polygon' },
    { key: 'localidad_uy',       titulo: 'Localidades de Uruguay',         geomType: 'point'   },
    { key: 'municipio_uy',       titulo: 'Municipios de Uruguay',          geomType: 'polygon' },
  ],
  mtop_uy: [
    { key: 'aeropuerto_uy',      titulo: 'Aeropuertos',                    geomType: 'point'   },
    { key: 'ferrocarril_uy',     titulo: 'Ferrocarriles',                  geomType: 'line'    },
    { key: 'puente_uy',          titulo: 'Puentes',                        geomType: 'point'   },
    { key: 'puerto_uy',          titulo: 'Puertos',                        geomType: 'point'   },
    { key: 'vial_dpto_uy',       titulo: 'Red vial departamental',         geomType: 'line'    },
    { key: 'vial_nacional_uy',   titulo: 'Red vial nacional',              geomType: 'line'    },
  ],
  mop_cl: [
    { key: 'aeropuerto_cl',      titulo: 'Aeropuertos',                    geomType: 'point'   },
    { key: 'puente_cl',          titulo: 'Puentes',                        geomType: 'point'   },
    { key: 'puerto_cl',          titulo: 'Puertos',                        geomType: 'point'   },
    { key: 'vial_nacional_cl',   titulo: 'Red vial nacional',              geomType: 'line'    },
    { key: 'vial_regional_cl',   titulo: 'Red vial regional',              geomType: 'line'    },
  ],
};

// ── Índice de búsqueda ─────────────────────────────────────────────

function buildSearchIndex() {
  const index = [];
  for (const [sourceKey, layers] of Object.entries(LAYERS_BY_SOURCE)) {
    const src = SOURCES[sourceKey];
    for (const l of layers) {
      index.push({ ...l, sourceKey, sourceLabel: src.label, countryCode: src.country });
    }
  }
  return index;
}

// ── Health checks ──────────────────────────────────────────────────

const healthState = {};

function buildCheckUrl(sourceKey) {
  const src = SOURCES[sourceKey];
  if (src.tipo === 'wfs')  return `${src.wfsBase}?service=WFS&request=GetCapabilities&version=1.1.0`;
  if (src.tipo === 'rest') return `${src.restBase}?f=json`;
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

  const countryCode = SOURCES[sourceKey].country;
  const countryDot  = document.querySelector(
    `.country-block[data-country="${countryCode}"] .src-dot[data-source="${sourceKey}"]`
  );
  if (countryDot) countryDot.className = 'src-dot ' + status;

  updateSummary();
}

function updateSummary() {
  const counts = { ok: 0, error: 0, checking: 0 };
  for (const v of Object.values(healthState)) counts[v] = (counts[v] || 0) + 1;
  const totalSources = Object.keys(SOURCES).length;
  const totalLayers  = Object.values(LAYERS_BY_SOURCE).flat().length;

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
  if (!layers.length) return `<p class="layers-empty">Sin capas</p>`;
  const sorted = [...layers].sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  return sorted.map(renderLayerRow).join('');
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

function renderServiceCard(sourceKey) {
  const src    = SOURCES[sourceKey];
  const layers = LAYERS_BY_SOURCE[sourceKey] || [];

  return `
    <div class="service-card" data-source="${sourceKey}">
      <div class="service-header" onclick="toggleService('${sourceKey}')">
        <span class="service-status-dot checking"></span>
        <div class="service-info">
          <div class="service-name">${src.label}</div>
          <div class="service-meta">
            <span class="badge">${src.tipo}</span>
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

function renderCountryBlock(country) {
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
  const countrySources = Object.entries(SOURCES)
    .filter(([, s]) => s.country === code)
    .map(([k]) => k);

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
        ${countrySources.map(renderServiceCard).join('')}
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
  const checks = Object.keys(SOURCES).map(k => checkSource(k));
  Promise.allSettled(checks).then(() => btn.classList.remove('spinning'));
}

// ── Init ───────────────────────────────────────────────────────────

function init() {
  searchIndex = buildSearchIndex();

  document.getElementById('country-list').innerHTML =
    COUNTRIES.map(renderCountryBlock).join('');

  document.getElementById('global-search').addEventListener('input', e => {
    onGlobalSearch(e.target.value);
  });

  document.getElementById('btn-refresh').addEventListener('click', runHealthChecks);

  Object.keys(SOURCES).forEach(k => { healthState[k] = 'checking'; });
  updateSummary();

  // Health checks en paralelo, sin bloquear el paint inicial
  setTimeout(runHealthChecks, 100);

  // Tema según hora del día, igual que settings.js
  const h = new Date().getHours();
  if (h >= 7 && h < 20) document.body.classList.add('day');
}

document.addEventListener('DOMContentLoaded', init);
