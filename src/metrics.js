/**
 * src/metrics.js — Página de métricas de uso de Casux
 *
 * Consume /api/metrics y renderiza las estadísticas.
 * Página pública — no requiere autenticación.
 * Diseñada para mostrar el impacto de Casux como iniciativa
 * de acceso abierto a datos geoespaciales, orientada a
 * presentaciones de financiamiento.
 */

// ── i18n ──────────────────────────────────────────────────────────
// Misma lógica que la landing: localStorage('sm_lang') → navigator.language → 'es'
// No depende de window.I18N ni window.SETTINGS (módulos de la app interna).

const UI = {
  es: {
    pageTitle:     'Métricas',
    tabTitle:      'Casux — Métricas',
    backLabel:     'Volver',
    loading:       'Cargando métricas…',
    period7d:      'Últimos 7 días',
    period30d:     'Últimos 30 días',
    period90d:     'Últimos 90 días',
    periodAll:     'Desde el inicio',
    sectionAdoption:    'Adopción',
    sectionDepth:       'Profundidad de uso',
    sectionActivity:    'Actividad diaria',
    sectionLayers:      'Capas más consultadas',
    sectionAudience:    'Audiencia',
    sectionOps:         'Operaciones espaciales',
    sectionSources:     'Datos por país de fuente',
    kpiSessions:        'Sesiones únicas',
    kpiUsers:           'Usuarios registrados',
    kpiMapsGenerated:   'Mapas generados',
    kpiMapsExported:    'Mapas exportados',
    kpiAvgLayers:       'Promedio capas / mapa',
    kpiAvgLayers2:      'capas simultáneas',
    kpiTimeToMap:       'Tiempo a primer mapa',
    kpiTimeToMap2:      'desde inicio de sesión',
    kpiRefinements:     'Refinamientos / sesión',
    kpiRefinements2:    'mensajes post-mapa',
    kpiMessages:        'Mensajes totales',
    kpiRestAnon:        'resto anónimos',
    kpiExportOf:        'de los generados',
    mapsGenerated:      'mapas generados',
    sessions:           'sesiones',
    registeredUsers:    'usuarios registrados',
    sessionToMapRate:   'de las sesiones generó al menos un mapa',
    chartMapsByDay:     'Mapas generados por día',
    chartSessionsByDay: 'Sesiones por día',
    noData:             'Sin datos',
    distAnon:           'Anónimos',
    distRegistered:     'Registrados',
    opClip:             'Recorte',
    opClipExclude:      'Recorte inverso',
    opIntersect:        'Intersección',
    opIntersectExclude: 'Intersección inversa',
    opBuffer:           'Área de influencia',
    opBufferExclude:    'Área de influencia inversa',
    srcAr:              '🇦🇷 Argentina',
    srcUy:              '🇺🇾 Uruguay',
    srcCl:              '🇨🇱 Chile',
    btnStatus:          'ESTADO DE GEOSERVICIOS',
    computedAt:         'Calculado',
    retryBtn:           'Reintentar',

    periodLabels: {
      '7d':  'últimos 7 días',
      '30d': 'últimos 30 días',
      '90d': 'últimos 90 días',
      'all': 'histórico total',
    },
  },
  en: {
    pageTitle:     'Metrics',
    tabTitle:      'Casux — Metrics',
    backLabel:     'Back',
    loading:       'Loading metrics…',
    period7d:      'Last 7 days',
    period30d:     'Last 30 days',
    period90d:     'Last 90 days',
    periodAll:     'Since launch',
    sectionAdoption:    'Adoption',
    sectionDepth:       'Depth of use',
    sectionActivity:    'Daily activity',
    sectionLayers:      'Most queried layers',
    sectionAudience:    'Audience',
    sectionOps:         'Spatial operations',
    sectionSources:     'Data by source country',
    kpiSessions:        'Unique sessions',
    kpiUsers:           'Registered users',
    kpiMapsGenerated:   'Maps generated',
    kpiMapsExported:    'Maps exported',
    kpiAvgLayers:       'Avg layers / map',
    kpiAvgLayers2:      'simultaneous layers',
    kpiTimeToMap:       'Time to first map',
    kpiTimeToMap2:      'from session start',
    kpiRefinements:     'Refinements / session',
    kpiRefinements2:    'messages after first map',
    kpiMessages:        'Total messages',
    kpiRestAnon:        'rest anonymous',
    kpiExportOf:        'of generated',
    mapsGenerated:      'maps generated',
    sessions:           'sessions',
    registeredUsers:    'registered users',
    sessionToMapRate:   'of sessions generated at least one map',
    chartMapsByDay:     'Maps generated per day',
    chartSessionsByDay: 'Sessions per day',
    noData:             'No data',
    distAnon:           'Anonymous',
    distRegistered:     'Registered',
    opClip:             'Clip',
    opClipExclude:      'Inverse clip',
    opIntersect:        'Intersect',
    opIntersectExclude: 'Inverse intersect',
    opBuffer:           'Buffer',
    opBufferExclude:    'Inverse buffer',
    srcAr:              '🇦🇷 Argentina',
    srcUy:              '🇺🇾 Uruguay',
    srcCl:              '🇨🇱 Chile',
    btnStatus:          'GEOSERVICE STATUS',
    computedAt:         'Computed',
    retryBtn:           'Retry',

    periodLabels: {
      '7d':  'last 7 days',
      '30d': 'last 30 days',
      '90d': 'last 90 days',
      'all': 'all time',
    },
  },
  pt: {
    pageTitle:     'Métricas',
    tabTitle:      'Casux — Métricas',
    backLabel:     'Voltar',
    loading:       'Carregando métricas…',
    period7d:      'Últimos 7 dias',
    period30d:     'Últimos 30 dias',
    period90d:     'Últimos 90 dias',
    periodAll:     'Desde o início',
    sectionAdoption:    'Adoção',
    sectionDepth:       'Profundidade de uso',
    sectionActivity:    'Atividade diária',
    sectionLayers:      'Camadas mais consultadas',
    sectionAudience:    'Audiência',
    sectionOps:         'Operações espaciais',
    sectionSources:     'Dados por país de origem',
    kpiSessions:        'Sessões únicas',
    kpiUsers:           'Usuários registrados',
    kpiMapsGenerated:   'Mapas gerados',
    kpiMapsExported:    'Mapas exportados',
    kpiAvgLayers:       'Média camadas / mapa',
    kpiAvgLayers2:      'camadas simultâneas',
    kpiTimeToMap:       'Tempo até primeiro mapa',
    kpiTimeToMap2:      'desde início da sessão',
    kpiRefinements:     'Refinamentos / sessão',
    kpiRefinements2:    'mensagens pós-mapa',
    kpiMessages:        'Mensagens totais',
    kpiRestAnon:        'resto anônimos',
    kpiExportOf:        'dos gerados',
    mapsGenerated:      'mapas gerados',
    sessions:           'sessões',
    registeredUsers:    'usuários registrados',
    sessionToMapRate:   'das sessões gerou pelo menos um mapa',
    chartMapsByDay:     'Mapas gerados por dia',
    chartSessionsByDay: 'Sessões por dia',
    noData:             'Sem dados',
    distAnon:           'Anônimos',
    distRegistered:     'Registrados',
    opClip:             'Recorte',
    opClipExclude:      'Recorte inverso',
    opIntersect:        'Interseção',
    opIntersectExclude: 'Interseção inversa',
    opBuffer:           'Área de influência',
    opBufferExclude:    'Área de influência inversa',
    srcAr:              '🇦🇷 Argentina',
    srcUy:              '🇺🇾 Uruguay',
    srcCl:              '🇨🇱 Chile',
    btnStatus:          'ESTADO DOS GEOSERVIÇOS',
    computedAt:         'Calculado',
    retryBtn:           'Tentar novamente',

    periodLabels: {
      '7d':  'últimos 7 dias',
      '30d': 'últimos 30 dias',
      '90d': 'últimos 90 dias',
      'all': 'histórico total',
    },
  },
};

function detectLang() {
  const saved = localStorage.getItem('sm_lang');
  if (saved && ['es','en','pt'].includes(saved)) return saved;
  const nav = (navigator.language || 'es').toLowerCase().slice(0, 2);
  if (nav === 'pt') return 'pt';
  if (nav === 'en') return 'en';
  return 'es';
}

function t(key) {
  const lang = detectLang();
  return (UI[lang] || UI.es)[key] || (UI.es)[key] || key;
}

// ── Nombres de capas legibles ────────────────────────────────────
// Derivados del layerKey. Para mostrar en la tabla de top layers
// sin necesidad de cargar el catálogo completo de capas.

const LAYER_LABELS = {
  // Argentina IGN
  localidad_ar:        'Localidades',
  provincia_ar:        'Provincias',
  departamento_ar:     'Departamentos',
  municipio_ar:        'Municipios',
  vial_nacional_ar:    'Red vial nacional',
  vial_provincial_ar:  'Red vial provincial',
  aeropuerto_ar:       'Aeropuertos',
  // Argentina otros
  escuela_ar:          'Establecimientos educativos',
  area_protegida_ar:   'Áreas protegidas',
  // Uruguay
  departamento_uy:     'Departamentos UY',
  localidad_uy:        'Localidades UY',
  // Chile
  region_cl:           'Regiones CL',
  comuna_cl:           'Comunas CL',
};

function layerLabel(key) {
  if (LAYER_LABELS[key]) return LAYER_LABELS[key];
  // Fallback: limpiar el key
  return key.replace(/_ar$|_uy$|_cl$/, '').replace(/_/g, ' ');
}

function layerSource(key) {
  if (key.endsWith('_ar')) return 'AR';
  if (key.endsWith('_uy')) return 'UY';
  if (key.endsWith('_cl')) return 'CL';
  return '';
}

// ── Formateo ─────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function fmtPct(n) {
  return n != null ? n + '%' : '—';
}

// ── Auth ─────────────────────────────────────────────────────────

// ── Fetch de métricas ─────────────────────────────────────────────

async function fetchMetrics(period) {
  const resp = await fetch(`/api/metrics?period=${period}`);
  if (!resp.ok) throw new Error(`Error ${resp.status}`);
  return resp.json();
}

// ── Renderizado ───────────────────────────────────────────────────

function renderChart(data, label, color = 'var(--accent)') {
  // data: { 'YYYY-MM-DD': count }
  // Últimos 30 días ordenados
  const today = new Date();
  const days  = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const values = days.map(d => data[d] || 0);
  const max    = Math.max(...values, 1);

  const bars = days.map((d, i) => {
    const v      = values[i];
    const height = Math.round((v / max) * 100);
    const label  = d.slice(5); // MM-DD
    // Mostrar solo algunos labels para no saturar
    const showLabel = i === 0 || i === 14 || i === 29;
    return `
      <div class="chart-bar-wrap">
        <div class="chart-bar"
             style="height:${height}%; background:${color}"
             data-tooltip="${d}: ${v}"></div>
        <div class="chart-label">${showLabel ? label : ''}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="chart-card">
      <div class="chart-title">${label}</div>
      <div class="chart-bars">${bars}</div>
    </div>
  `;
}

function renderTopLayers(layers) {
  if (!layers?.length) return `<p style="color:var(--cream2);font-size:13px;padding:16px">${t('noData')}</p>`;

  const max = layers[0].count;
  const rows = layers.map((l, i) => {
    const pct  = Math.round((l.count / max) * 100);
    const src  = layerSource(l.key);
    return `
      <div class="layer-row">
        <span class="layer-rank">${i + 1}</span>
        <span class="layer-name">${layerLabel(l.key)}</span>
        ${src ? `<span class="layer-source">${src}</span>` : ''}
        <div class="layer-bar-wrap">
          <div class="layer-bar" style="width:${pct}%"></div>
        </div>
        <span class="layer-count">${l.count}</span>
      </div>
    `;
  }).join('');

  return `<div class="layers-table">${rows}</div>`;
}

function renderDistLang(byLang) {
  const data  = byLang || {};
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const langs = [
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'English' },
    { code: 'pt', label: 'Português' },
  ];
  return langs.map(({ code, label }) => {
    const count = data[code] || 0;
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="dist-pill">
        <span class="dist-pill-label">${label}</span>
        <span class="dist-pill-value">${pct}%</span>
      </div>
    `;
  }).join('');
}

function renderDistDevice(byDevice) {
  if (!byDevice) return '—';
  const total = (byDevice.mobile || 0) + (byDevice.desktop || 0);
  if (!total) return '—';
  const mobilePct  = Math.round((byDevice.mobile  / total) * 100);
  const desktopPct = Math.round((byDevice.desktop / total) * 100);
  return `
    <div class="dist-pill">
      <span class="dist-pill-label">Mobile</span>
      <span class="dist-pill-value">${mobilePct}%</span>
    </div>
    <div class="dist-pill">
      <span class="dist-pill-label">Desktop</span>
      <span class="dist-pill-value">${desktopPct}%</span>
    </div>
  `;
}

function renderDistUserType(byUserType) {
  if (!byUserType) return '—';
  const total = (byUserType.anon || 0) + (byUserType.registered || 0);
  if (!total) return '—';
  const anonPct = Math.round(((byUserType.anon || 0) / total) * 100);
  const regPct  = Math.round(((byUserType.registered || 0) / total) * 100);
  return `
    <div class="dist-pill">
      <span class="dist-pill-label">Anónimos</span>
      <span class="dist-pill-value">${anonPct}%</span>
    </div>
    <div class="dist-pill">
      <span class="dist-pill-label">Registrados</span>
      <span class="dist-pill-value">${regPct}%</span>
    </div>
  `;
}

const OP_LABELS = {
  clip:              'Recorte',
  clip_exclude:      'Recorte inverso',
  intersect:         'Intersección',
  intersect_exclude: 'Intersección inversa',
  buffer:            'Área de influencia',
  buffer_exclude:    'Área de influencia inversa',
};

function renderDistQueryType(byQueryType) {
  if (!byQueryType || !Object.keys(byQueryType).length) return '—';
  const total = Object.values(byQueryType).reduce((a, b) => a + b, 0);
  return Object.entries(byQueryType)
    .sort((a, b) => b[1] - a[1])
    .map(([op, count]) => {
      const pct = Math.round((count / total) * 100);
      return `
        <div class="dist-pill">
          <span class="dist-pill-label">${OP_LABELS[op] || op}</span>
          <span class="dist-pill-value">${pct}%</span>
        </div>
      `;
    }).join('');
}

const SOURCE_LABELS = { ar: '🇦🇷 Argentina', uy: '🇺🇾 Uruguay', cl: '🇨🇱 Chile' };

function renderDistSource(bySource) {
  if (!bySource || !Object.keys(bySource).length) return '—';
  const total = Object.values(bySource).reduce((a, b) => a + b, 0);
  return Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([src, count]) => {
      const pct = Math.round((count / total) * 100);
      return `
        <div class="dist-pill">
          <span class="dist-pill-label">${SOURCE_LABELS[src] || src.toUpperCase()}</span>
          <span class="dist-pill-value">${pct}%</span>
        </div>
      `;
    }).join('');
}

function renderMetrics(d) {
  const exportRate = d.mapsGenerated > 0
    ? Math.round((d.mapsExported / d.mapsGenerated) * 100)
    : 0;

  const periodLabel = t('periodLabels');

  return `
    <!-- Highlight principal -->
    <div class="highlight-card">
      <span class="material-icons">map</span>
      <div class="highlight-text">
        <strong>${fmt(d.mapsGenerated)} mapas generados</strong>
        <span>${fmt(d.sessions)} ${t('sessions')} · ${fmt(d.users)} ${t('registeredUsers')} · ${periodLabel[d.period] || d.period}</span>
      </div>
    </div>

    <!-- KPIs de adopción -->
    <div class="section-title">${t('sectionAdoption')}</div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Sesiones únicas</div>
        <div class="kpi-value">${fmt(d.sessions)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Usuarios registrados</div>
        <div class="kpi-value">${fmt(d.users)}</div>
        <div class="kpi-sub">resto anónimos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Mapas generados</div>
        <div class="kpi-value accent">${fmt(d.mapsGenerated)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Mapas exportados</div>
        <div class="kpi-value">${fmt(d.mapsExported)}</div>
        <div class="kpi-sub">${exportRate}% de los generados</div>
      </div>
    </div>

    <!-- Tasa de conversión sesión → mapa -->
    <div class="rate-card" style="margin-top:10px">
      <span class="material-icons">trending_up</span>
      <div class="rate-text">
        <strong>${fmtPct(d.sessionToMapRate)}</strong>
        <span> de las sesiones generó al menos un mapa</span>
      </div>
    </div>

    <!-- KPIs de calidad -->
    <div class="section-title">${t('sectionDepth')}</div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Promedio capas / mapa</div>
        <div class="kpi-value">${d.avgLayersPerMap ?? '—'}</div>
        <div class="kpi-sub">capas simultáneas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tiempo a primer mapa</div>
        <div class="kpi-value">${fmtMs(d.avgMsToFirstMap)}</div>
        <div class="kpi-sub">desde inicio de sesión</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Refinamientos / sesión</div>
        <div class="kpi-value">${d.avgRefinements ?? '—'}</div>
        <div class="kpi-sub">mensajes post-mapa</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Mensajes totales</div>
        <div class="kpi-value">${fmt(d.messages)}</div>
      </div>
    </div>

    <!-- Gráfico mapas por día -->
    <div class="section-title">${t('sectionActivity')}</div>
    ${renderChart(d.mapsPerDay, 'Mapas generados por día')}
    ${renderChart(d.sessionsPerDay, 'Sesiones por día', 'var(--ok)')}

    <!-- Top capas -->
    <div class="section-title">${t('sectionLayers')}</div>
    ${renderTopLayers(d.topLayers)}

    <!-- Distribución -->
    <div class="section-title">${t('sectionAudience')}</div>
    <div class="dist-row">${renderDistLang(d.byLanguage)}</div>
    <div class="dist-row" style="margin-top:8px">${renderDistDevice(d.byDevice)}</div>
    <div class="dist-row" style="margin-top:8px">${renderDistUserType(d.byUserType)}</div>

    <!-- Operaciones espaciales -->
    <div class="section-title">${t('sectionOps')}</div>
    <div class="dist-row">${renderDistQueryType(d.byQueryType)}</div>

    <!-- Países de datos -->
    <div class="section-title">${t('sectionSources')}</div>
    <div class="dist-row">${renderDistSource(d.bySource)}</div>

    <div class="computed-at">${t('computedAt')}: ${new Date(d.computedAt).toLocaleString()}</div>

    <div class="metrics-footer">
      <a href="/status" class="btn-status">ESTADO DE GEOSERVICIOS</a>
    </div>
  `;
}

// ── Init ──────────────────────────────────────────────────────────

let _currentPeriod = '30d';

const PERIODS = [
  { id: '7d',  label: () => t('period7d') },
  { id: '30d', label: () => t('period30d') },
  { id: '90d', label: () => t('period90d') },
  { id: 'all', label: () => t('periodAll') },
];

function renderPeriodBar() {
  document.getElementById('period-bar').innerHTML = PERIODS.map(p => `
    <button class="period-btn${p.id === _currentPeriod ? ' active' : ''}"
            onclick="loadPeriod('${p.id}')">${typeof p.label === 'function' ? p.label() : p.label}</button>
  `).join('');
}

async function loadPeriod(period) {
  _currentPeriod = period;
  renderPeriodBar();

  const el = document.getElementById('metrics-content');
  el.innerHTML = `
    <div class="loading-state">
      <span class="material-icons">refresh</span>
      Cargando métricas…
    </div>
  `;

  try {
    const data = await fetchMetrics(period);
    el.innerHTML = renderMetrics(data);
  } catch (err) {
    el.innerHTML = `
      <div class="error-state">
        <span class="material-icons">error_outline</span>
        ${err.message}
        <br><br>
        <button class="period-btn" onclick="loadPeriod('${period}')">Reintentar</button>
      </div>
    `;
  }
}

// Tema día/noche
const savedTheme = localStorage.getItem('sm_theme');
const isDayHour  = new Date().getHours() >= 7 && new Date().getHours() < 20;
const theme      = savedTheme || (isDayHour ? 'day' : 'night');
document.body.classList.toggle('day', theme === 'day');

// Función global para los botones
window.loadPeriod = loadPeriod;

// Arrancar
renderPeriodBar();
loadPeriod(_currentPeriod);

// Aplicar i18n a elementos estáticos del HTML
document.getElementById('back-label').textContent   = t('backLabel');
document.getElementById('page-title').textContent   = t('pageTitle');
document.getElementById('loading-text').textContent = t('loading');
document.title = t('tabTitle');
document.documentElement.lang = detectLang();
