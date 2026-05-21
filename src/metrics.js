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
    kpiSessions:        'Sesiones únicas',
    kpiUsers:           'Usuarios registrados',
    kpiMapsGenerated:   'Mapas generados',
    kpiMapsExported:    'Mapas exportados',
    kpiAvgLayers:       'Promedio capas / mapa',
    kpiTimeToMap:       'Tiempo a primer mapa',
    kpiRefinements:     'Refinamientos / sesión',
    kpiMessages:        'Mensajes totales',
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
    refreshBtn:         'Actualizar',
    errorMsg:           'Las métricas no están disponibles en este momento. Volvé a intentarlo más tarde.',
    updatedAt:          'Última actualización',

    periodLabels: {
      '7d':  'últimos 7 días',
      '30d': 'últimos 30 días',
      '90d': 'últimos 90 días',
      'all': 'desde el inicio',
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
    kpiSessions:        'Unique sessions',
    kpiUsers:           'Registered users',
    kpiMapsGenerated:   'Maps generated',
    kpiMapsExported:    'Maps exported',
    kpiAvgLayers:       'Avg layers / map',
    kpiTimeToMap:       'Time to first map',
    kpiRefinements:     'Refinements / session',
    kpiMessages:        'Total messages',
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
    refreshBtn:         'Refresh',
    errorMsg:           'Metrics are not available right now. Please try again later.',
    updatedAt:          'Last updated',

    periodLabels: {
      '7d':  'last 7 days',
      '30d': 'last 30 days',
      '90d': 'last 90 days',
      'all': 'since launch',
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
    kpiSessions:        'Sessões únicas',
    kpiUsers:           'Usuários registrados',
    kpiMapsGenerated:   'Mapas gerados',
    kpiMapsExported:    'Mapas exportados',
    kpiAvgLayers:       'Média camadas / mapa',
    kpiTimeToMap:       'Tempo até primeiro mapa',
    kpiRefinements:     'Refinamentos / sessão',
    kpiMessages:        'Mensagens totais',
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
    refreshBtn:         'Atualizar',
    errorMsg:           'As métricas não estão disponíveis no momento. Tente novamente mais tarde.',
    updatedAt:          'Última atualização',

    periodLabels: {
      '7d':  'últimos 7 dias',
      '30d': 'últimos 30 dias',
      '90d': 'últimos 90 dias',
      'all': 'desde o início',
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

function renderChart(data, label, color = 'var(--accent)', period = '30d') {
  // data: { 'YYYY-MM-DD': count }
  // Generar el rango de días según el período activo
  const today    = new Date();
  const daysBack = period === '7d' ? 6 : period === '90d' ? 89 : period === 'all' ? 179 : 29;
  const days     = [];
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  // Para 'all' — si hay datos anteriores al rango, solo mostrar desde el primer día con datos
  const allDataKeys = Object.keys(data).sort();
  const effectiveDays = period === 'all' && allDataKeys.length
    ? days.filter(d => d >= allDataKeys[0])
    : days;

  const total = effectiveDays.length;
  const values = effectiveDays.map(d => data[d] || 0);
  const max    = Math.max(...values, 1);

  // Etiquetas: siempre inicio, fin, y un punto intermedio si hay espacio
  const showLabelSet = new Set([0, Math.floor(total / 2), total - 1]);

  const bars = effectiveDays.map((d, i) => {
    const v      = values[i];
    const height = Math.round((v / max) * 100);
    const lbl    = d.slice(5); // MM-DD
    return `
      <div class="chart-bar-wrap">
        <div class="chart-bar"
             style="height:${height}%; background:${color}"
             data-tooltip="${d}: ${v}"></div>
        <div class="chart-label">${showLabelSet.has(i) ? lbl : ''}</div>
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
  const cards = langs.map(({ code, label }) => {
    const count = data[code] || 0;
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    return `<div class="kpi-card"><div class="kpi-value">${pct}%</div><div class="kpi-label">${label}</div></div>`;
  }).join('');
  return `<div class="kpi-grid">${cards}</div>`;
}

function renderDistDevice(byDevice) {
  if (!byDevice) return '';
  const total      = (byDevice.mobile || 0) + (byDevice.desktop || 0);
  const mobilePct  = total > 0 ? Math.round((byDevice.mobile  / total) * 100) : 0;
  const desktopPct = total > 0 ? Math.round((byDevice.desktop / total) * 100) : 0;
  return `<div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-value">${mobilePct}%</div><div class="kpi-label">Mobile</div></div>
    <div class="kpi-card"><div class="kpi-value">${desktopPct}%</div><div class="kpi-label">Desktop</div></div>
  </div>`;
}

function renderDistUserType(byUserType) {
  if (!byUserType) return '';
  const total   = (byUserType.anon || 0) + (byUserType.registered || 0);
  const anonPct = total > 0 ? Math.round(((byUserType.anon || 0) / total) * 100) : 0;
  const regPct  = total > 0 ? Math.round(((byUserType.registered || 0) / total) * 100) : 0;
  return `<div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-value">${anonPct}%</div><div class="kpi-label">${t('distAnon')}</div></div>
    <div class="kpi-card"><div class="kpi-value">${regPct}%</div><div class="kpi-label">${t('distRegistered')}</div></div>
  </div>`;
}

function opLabel(op) {
  const map = {
    clip:              'opClip',
    clip_exclude:      'opClipExclude',
    intersect:         'opIntersect',
    intersect_exclude: 'opIntersectExclude',
    buffer:            'opBuffer',
    buffer_exclude:    'opBufferExclude',
  };
  return map[op] ? t(map[op]) : op;
}

function renderDistQueryType(byQueryType) {
  if (!byQueryType || !Object.keys(byQueryType).length) return '';
  const total = Object.values(byQueryType).reduce((a, b) => a + b, 0);
  const cards = Object.entries(byQueryType)
    .sort((a, b) => b[1] - a[1])
    .map(([op, count]) => {
      const pct = Math.round((count / total) * 100);
      return `<div class="kpi-card"><div class="kpi-value">${pct}%</div><div class="kpi-label">${opLabel(op)}</div></div>`;
    }).join('');
  return `<div class="kpi-grid">${cards}</div>`;
}

const SOURCE_LABELS = { ar: '🇦🇷 Argentina', uy: '🇺🇾 Uruguay', cl: '🇨🇱 Chile' };

function renderDistSource(bySource) {
  if (!bySource || !Object.keys(bySource).length) return '';
  const total = Object.values(bySource).reduce((a, b) => a + b, 0);
  const cards = Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([src, count]) => {
      const pct = Math.round((count / total) * 100);
      return `<div class="kpi-card"><div class="kpi-value">${pct}%</div><div class="kpi-label">${SOURCE_LABELS[src] || src.toUpperCase()}</div></div>`;
    }).join('');
  return `<div class="kpi-grid">${cards}</div>`;
}

function renderMetrics(d) {
  const exportRate = d.mapsGenerated > 0
    ? Math.round((d.mapsExported / d.mapsGenerated) * 100)
    : 0;

  const periodLabel = t('periodLabels');

  const S = '<div class="metrics-sep"></div>';

  return `
    <!-- Highlight principal -->
    <div class="highlight-card">
      <span class="material-icons">map</span>
      <div class="highlight-text">
        <strong>${fmt(d.mapsGenerated)} ${t('mapsGenerated')}</strong>
        <span>${fmt(d.sessions)} ${t('sessions')} · ${periodLabel[d.period] || d.period}</span>
        <span class="highlight-rate">
          <span class="material-icons">trending_up</span>
          <strong>${fmtPct(d.sessionToMapRate)}</strong> ${t('sessionToMapRate')}
        </span>
      </div>
    </div>

    ${S}
    <!-- KPIs de adopción -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiSessions')}</div>
        <div class="kpi-value">${fmt(d.sessions)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiUsers')}</div>
        <div class="kpi-value">${fmt(d.users)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiMapsGenerated')}</div>
        <div class="kpi-value accent">${fmt(d.mapsGenerated)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiMapsExported')}</div>
        <div class="kpi-value">${fmt(d.mapsExported)}</div>
      </div>
    </div>

    ${S}
    <!-- KPIs de calidad -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiAvgLayers')}</div>
        <div class="kpi-value">${d.avgLayersPerMap ?? '—'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiTimeToMap')}</div>
        <div class="kpi-value">${fmtMs(d.avgMsToFirstMap)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiRefinements')}</div>
        <div class="kpi-value">${d.avgRefinements ?? '—'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${t('kpiMessages')}</div>
        <div class="kpi-value">${fmt(d.messages)}</div>
      </div>
    </div>

    ${S}
    <!-- Gráfico mapas por día -->
    ${renderChart(d.mapsPerDay, t('chartMapsByDay'), 'var(--accent)', d.period)}
    ${renderChart(d.sessionsPerDay, t('chartSessionsByDay'), 'var(--ok)', d.period)}

    ${S}
    <!-- Top capas -->
    ${renderTopLayers(d.topLayers)}

    ${S}
    <!-- Distribución -->
    ${renderDistLang(d.byLanguage)}
    ${renderDistDevice(d.byDevice)}
    ${renderDistUserType(d.byUserType)}

    ${S}
    <!-- Operaciones espaciales -->
    ${renderDistQueryType(d.byQueryType)}

    ${S}
    <!-- Países de datos -->
    ${renderDistSource(d.bySource)}

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
  document.getElementById('period-bar').innerHTML =
    PERIODS.map(p => `
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
      ${t('loading')}
    </div>
  `;

  try {
    const data = await fetchMetrics(period);
    el.innerHTML = renderMetrics(data);
    const lu = document.getElementById('last-updated');
    if (lu) {
      lu.textContent = data.computedAt
        ? `${t('updatedAt')}: ${new Date(data.computedAt).toLocaleDateString(detectLang(), { day: 'numeric', month: 'long', year: 'numeric' })}`
        : '';
    }
  } catch (err) {
    el.innerHTML = `
      <div class="error-state">
        <span class="material-icons">error_outline</span>
        <span>${t('errorMsg')}</span>
        <button class="period-btn" onclick="loadPeriod('${period}')">${t('retryBtn')}</button>
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
document.getElementById('back-label').textContent = t('backLabel');
document.getElementById('page-title').textContent = t('pageTitle');
document.title = t('tabTitle');
document.documentElement.lang = detectLang();
