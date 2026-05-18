/**
 * suggested-prompts.js
 *
 * Muestra 3 chips de prompts sugeridos debajo del input del chat,
 * solo cuando la conversación está vacía (primera vez o nueva conversación).
 *
 * Los prompts rotan según las capas disponibles en window.LAYERS.
 * Se priorizan capas nacionales. Se evitan tildes en nombres propios
 * que van dentro del prompt (provincias, departamentos).
 *
 * Depende de: window.LAYERS
 */

window.SUGGESTED_PROMPTS = (() => {

  // ── Pool de prompts por tema ───────────────────────────────────
  // Cada entrada tiene:
  //   text:     lo que se muestra en el chip
  //   prompt:   lo que se envía al chat (puede ser igual o más específico)
  //   layerKey: clave de la capa — el chip solo aparece si la capa existe
  //   weight:   prioridad relativa (mayor = aparece más seguido)

  // Pool multiidioma. Cada entrada tiene texto y prompt en es/en/pt.
  // El prompt es lo que se envía al LLM — siempre en el idioma activo.
  const POOL = [
    // División política
    {
      es: { text: 'Provincias de Argentina',       prompt: 'Provincias de Argentina' },
      en: { text: 'Provinces of Argentina',        prompt: 'Provinces of Argentina' },
      pt: { text: 'Províncias da Argentina',        prompt: 'Províncias da Argentina' },
      layerKey: 'provincia_ar', weight: 10,
    },
    {
      es: { text: 'Departamentos de Argentina',    prompt: 'Departamentos de Argentina' },
      en: { text: 'Departments of Argentina',      prompt: 'Departments of Argentina' },
      pt: { text: 'Departamentos da Argentina',    prompt: 'Departamentos da Argentina' },
      layerKey: 'departamento_ar', weight: 8,
    },
    {
      es: { text: 'Departamentos de Uruguay',      prompt: 'Departamentos de Uruguay' },
      en: { text: 'Departments of Uruguay',        prompt: 'Departments of Uruguay' },
      pt: { text: 'Departamentos do Uruguai',      prompt: 'Departamentos do Uruguai' },
      layerKey: 'departamento_uy', weight: 8,
    },
    {
      es: { text: 'Municipios de Argentina',       prompt: 'Municipios de Argentina' },
      en: { text: 'Municipalities of Argentina',   prompt: 'Municipalities of Argentina' },
      pt: { text: 'Municípios da Argentina',       prompt: 'Municípios da Argentina' },
      layerKey: 'municipio_ar', weight: 6,
    },
    // Transporte
    {
      es: { text: 'Rutas nacionales de Argentina',           prompt: 'Red vial nacional de Argentina' },
      en: { text: 'National roads of Argentina',             prompt: 'National road network of Argentina' },
      pt: { text: 'Rodovias nacionais da Argentina',         prompt: 'Rede rodoviária nacional da Argentina' },
      layerKey: 'vial_nacional_ar', weight: 10,
    },
    {
      es: { text: 'Rutas provinciales de Argentina',         prompt: 'Red vial provincial de Argentina' },
      en: { text: 'Provincial roads of Argentina',           prompt: 'Provincial road network of Argentina' },
      pt: { text: 'Estradas provinciais da Argentina',       prompt: 'Rede rodoviária provincial da Argentina' },
      layerKey: 'vial_provincial_ar', weight: 7,
    },
    {
      es: { text: 'Ferrocarriles de Argentina',    prompt: 'Red ferroviaria de Argentina' },
      en: { text: 'Railways of Argentina',         prompt: 'Railway network of Argentina' },
      pt: { text: 'Ferrovias da Argentina',        prompt: 'Rede ferroviária da Argentina' },
      layerKey: 'ferrocarril_ar', weight: 8,
    },
    {
      es: { text: 'Aeropuertos de Argentina',      prompt: 'Aeropuertos de Argentina' },
      en: { text: 'Airports of Argentina',         prompt: 'Airports of Argentina' },
      pt: { text: 'Aeroportos da Argentina',       prompt: 'Aeroportos da Argentina' },
      layerKey: 'aeropuerto_ar', weight: 7,
    },
    {
      es: { text: 'Pasos fronterizos de Argentina',          prompt: 'Pasos de frontera de Argentina' },
      en: { text: 'Border crossings of Argentina',           prompt: 'Border crossings of Argentina' },
      pt: { text: 'Postos de fronteira da Argentina',        prompt: 'Postos de fronteira da Argentina' },
      layerKey: 'pasos_frontera_ar', weight: 6,
    },
    {
      es: { text: 'Puertos de Argentina',          prompt: 'Puertos de Argentina' },
      en: { text: 'Ports of Argentina',            prompt: 'Ports of Argentina' },
      pt: { text: 'Portos da Argentina',           prompt: 'Portos da Argentina' },
      layerKey: 'puerto_ar', weight: 6,
    },
    // Hidrografía
    {
      es: { text: 'Ríos de Argentina',             prompt: 'Ríos y corrientes de Argentina' },
      en: { text: 'Rivers of Argentina',           prompt: 'Rivers and streams of Argentina' },
      pt: { text: 'Rios da Argentina',             prompt: 'Rios e córregos da Argentina' },
      layerKey: 'rio_ar', weight: 8,
    },
    {
      es: { text: 'Lagos de Argentina',            prompt: 'Lagos y embalses de Argentina' },
      en: { text: 'Lakes of Argentina',            prompt: 'Lakes and reservoirs of Argentina' },
      pt: { text: 'Lagos da Argentina',            prompt: 'Lagos e reservatórios da Argentina' },
      layerKey: 'lago_embalse_ar', weight: 7,
    },
    {
      es: { text: 'Ríos de Uruguay',               prompt: 'Ríos y arroyos de Uruguay' },
      en: { text: 'Rivers of Uruguay',             prompt: 'Rivers and streams of Uruguay' },
      pt: { text: 'Rios do Uruguai',               prompt: 'Rios e arroios do Uruguai' },
      layerKey: 'rio_linea_uy', weight: 7,
    },
    // Medio ambiente
    {
      es: { text: 'Áreas protegidas de Argentina', prompt: 'Áreas protegidas de Argentina' },
      en: { text: 'Protected areas of Argentina',  prompt: 'Protected areas of Argentina' },
      pt: { text: 'Áreas protegidas da Argentina', prompt: 'Áreas protegidas da Argentina' },
      layerKey: 'area_protegida_ar', weight: 9,
    },
    {
      es: { text: 'Bosques de Argentina',          prompt: 'Bosques y selvas de Argentina' },
      en: { text: 'Forests of Argentina',          prompt: 'Forests and jungles of Argentina' },
      pt: { text: 'Florestas da Argentina',        prompt: 'Florestas e matas da Argentina' },
      layerKey: 'bosque_ar', weight: 7,
    },
    // Infraestructura
    {
      es: { text: 'Localidades de Argentina',      prompt: 'Localidades de Argentina' },
      en: { text: 'Localities of Argentina',       prompt: 'Localities of Argentina' },
      pt: { text: 'Localidades da Argentina',      prompt: 'Localidades da Argentina' },
      layerKey: 'localidad_ar', weight: 7,
    },
    {
      es: { text: 'Universidades de Argentina',    prompt: 'Universidades de Argentina' },
      en: { text: 'Universities of Argentina',     prompt: 'Universities of Argentina' },
      pt: { text: 'Universidades da Argentina',    prompt: 'Universidades da Argentina' },
      layerKey: 'universidad_ar', weight: 6,
    },
    // Límites
    {
      es: { text: 'Fronteras de Argentina',        prompt: 'Límites internacionales de Argentina' },
      en: { text: 'Borders of Argentina',          prompt: 'International borders of Argentina' },
      pt: { text: 'Fronteiras da Argentina',       prompt: 'Fronteiras internacionais da Argentina' },
      layerKey: 'limite_internacional_ar', weight: 7,
    },
    {
      es: { text: 'Límites provinciales de Argentina',       prompt: 'Límites provinciales de Argentina' },
      en: { text: 'Provincial limits of Argentina',          prompt: 'Provincial borders of Argentina' },
      pt: { text: 'Limites provinciais da Argentina',        prompt: 'Limites provinciais da Argentina' },
      layerKey: 'limite_provincial_ar', weight: 6,
    },

    // ── Uruguay (MTOP) ────────────────────────────────────────────
    // Transporte vial
    {
      es: { text: 'Rutas nacionales de Uruguay',          prompt: 'Rutas nacionales de Uruguay' },
      en: { text: 'National roads of Uruguay',            prompt: 'National roads of Uruguay' },
      pt: { text: 'Rodovias nacionais do Uruguai',        prompt: 'Rodovias nacionais do Uruguai' },
      layerKey: 'rutas_nacionales_uy', weight: 10,
    },
    {
      es: { text: 'Caminería nacional de Uruguay',        prompt: 'Caminería nacional de Uruguay' },
      en: { text: 'National road network of Uruguay',     prompt: 'National road network of Uruguay' },
      pt: { text: 'Rede rodoviária nacional do Uruguai',  prompt: 'Rede rodoviária nacional do Uruguai' },
      layerKey: 'camineria_nacional_uy', weight: 8,
    },
    {
      es: { text: 'Puentes carreteros de Uruguay',        prompt: 'Puentes carreteros de Uruguay' },
      en: { text: 'Road bridges of Uruguay',              prompt: 'Road bridges of Uruguay' },
      pt: { text: 'Pontes rodoviárias do Uruguai',        prompt: 'Pontes rodoviárias do Uruguai' },
      layerKey: 'puentes_carreteros_uy', weight: 6,
    },
    {
      es: { text: 'Peajes de Uruguay',                    prompt: 'Peajes de Uruguay' },
      en: { text: 'Toll booths of Uruguay',               prompt: 'Toll booths of Uruguay' },
      pt: { text: 'Pedágios do Uruguai',                  prompt: 'Pedágios do Uruguai' },
      layerKey: 'peajes_uy', weight: 5,
    },
    {
      es: { text: 'Tránsito vial 2023 en Uruguay',        prompt: 'Tránsito promedio diario anual 2023 de Uruguay' },
      en: { text: 'Road traffic 2023 in Uruguay',         prompt: 'Annual average daily traffic 2023 in Uruguay' },
      pt: { text: 'Tráfego viário 2023 no Uruguai',       prompt: 'Tráfego médio diário anual 2023 no Uruguai' },
      layerKey: 'tpda_2023_uy', weight: 6,
    },
    // Transporte ferroviario
    {
      es: { text: 'Red ferroviaria de Uruguay',           prompt: 'Vías férreas activas de Uruguay' },
      en: { text: 'Railway network of Uruguay',           prompt: 'Active railway lines of Uruguay' },
      pt: { text: 'Rede ferroviária do Uruguai',          prompt: 'Linhas férreas ativas do Uruguai' },
      layerKey: 'via_ferrea_activa_uy', weight: 8,
    },
    {
      es: { text: 'Estaciones ferroviarias de Uruguay',   prompt: 'Estaciones ferroviarias de Uruguay' },
      en: { text: 'Railway stations of Uruguay',          prompt: 'Railway stations of Uruguay' },
      pt: { text: 'Estações ferroviárias do Uruguai',     prompt: 'Estações ferroviárias do Uruguai' },
      layerKey: 'estaciones_ferroviarias_uy', weight: 6,
    },
    {
      es: { text: 'Puentes ferroviarios de Uruguay',      prompt: 'Puentes ferroviarios de Uruguay' },
      en: { text: 'Railway bridges of Uruguay',           prompt: 'Railway bridges of Uruguay' },
      pt: { text: 'Pontes ferroviárias do Uruguai',       prompt: 'Pontes ferroviárias do Uruguai' },
      layerKey: 'puentes_ferroviarios_uy', weight: 5,
    },
    // Transporte aéreo y marítimo
    {
      es: { text: 'Aeropuertos de Uruguay',               prompt: 'Aeropuertos de Uruguay' },
      en: { text: 'Airports of Uruguay',                  prompt: 'Airports of Uruguay' },
      pt: { text: 'Aeroportos do Uruguai',                prompt: 'Aeroportos do Uruguai' },
      layerKey: 'aeropuertos_uy', weight: 8,
    },
    {
      es: { text: 'Puertos de Uruguay',                   prompt: 'Puertos de Uruguay' },
      en: { text: 'Ports of Uruguay',                     prompt: 'Ports of Uruguay' },
      pt: { text: 'Portos do Uruguai',                    prompt: 'Portos do Uruguai' },
      layerKey: 'puertos_uy', weight: 7,
    },
    // Hidrografía
    {
      es: { text: 'Cursos de agua de Uruguay',            prompt: 'Cursos de agua de Uruguay' },
      en: { text: 'Waterways of Uruguay',                 prompt: 'Waterways of Uruguay' },
      pt: { text: 'Cursos d\'água do Uruguai',            prompt: 'Cursos d\'água do Uruguai' },
      layerKey: 'cursos_agua_uy', weight: 7,
    },
    {
      es: { text: 'Cursos navegables de Uruguay',         prompt: 'Cursos de agua navegables de Uruguay' },
      en: { text: 'Navigable waterways of Uruguay',       prompt: 'Navigable waterways of Uruguay' },
      pt: { text: 'Vias navegáveis do Uruguai',           prompt: 'Vias navegáveis do Uruguai' },
      layerKey: 'cursos_navegables_uy', weight: 6,
    },
    {
      es: { text: 'Lagunas de Uruguay',                   prompt: 'Lagunas públicas de Uruguay' },
      en: { text: 'Lagoons of Uruguay',                   prompt: 'Public lagoons of Uruguay' },
      pt: { text: 'Lagoas do Uruguai',                    prompt: 'Lagoas públicas do Uruguai' },
      layerKey: 'lagunas_publicas_uy', weight: 6,
    },
    // Localidades e infraestructura
    {
      es: { text: 'Localidades de Uruguay',               prompt: 'Localidades de Uruguay' },
      en: { text: 'Localities of Uruguay',                prompt: 'Localities of Uruguay' },
      pt: { text: 'Localidades do Uruguai',               prompt: 'Localidades do Uruguai' },
      layerKey: 'localidades_uy', weight: 7,
    },
    {
      es: { text: 'Zonas francas de Uruguay',             prompt: 'Zonas francas de Uruguay' },
      en: { text: 'Free trade zones of Uruguay',          prompt: 'Free trade zones of Uruguay' },
      pt: { text: 'Zonas francas do Uruguai',             prompt: 'Zonas francas do Uruguai' },
      layerKey: 'zonas_francas_uy', weight: 6,
    },
    {
      es: { text: 'Parques industriales de Uruguay',      prompt: 'Parques industriales de Uruguay' },
      en: { text: 'Industrial parks of Uruguay',          prompt: 'Industrial parks of Uruguay' },
      pt: { text: 'Parques industriais do Uruguai',       prompt: 'Parques industriais do Uruguai' },
      layerKey: 'parques_industriales_uy', weight: 6,
    },
    {
      es: { text: 'Balnearios de Uruguay',                prompt: 'Balnearios de Uruguay' },
      en: { text: 'Beach resorts of Uruguay',             prompt: 'Beach resorts of Uruguay' },
      pt: { text: 'Balneários do Uruguai',                prompt: 'Balneários do Uruguai' },
      layerKey: 'balnearios_uy', weight: 6,
    },
    // Obras
    {
      es: { text: 'Obras viales en ejecución en Uruguay', prompt: 'Obras en ejecución en carreteras de Uruguay' },
      en: { text: 'Road works in progress in Uruguay',    prompt: 'Road construction works in Uruguay' },
      pt: { text: 'Obras viárias em execução no Uruguai', prompt: 'Obras em execução nas rodovias do Uruguai' },
      layerKey: 'obras_camineria_uy', weight: 5,
    },
    // ── Chile ─────────────────────────────────────────────────────
    // División política
    {
      es: { text: 'Regiones de Chile',              prompt: 'Regiones de Chile' },
      en: { text: 'Regions of Chile',               prompt: 'Regions of Chile' },
      pt: { text: 'Regiões do Chile',               prompt: 'Regiões do Chile' },
      layerKey: 'MAPA_BASE_LIMITES_MapServer_0_cl', weight: 10,
    },
    {
      es: { text: 'Comunas de Chile',               prompt: 'Comunas de Chile' },
      en: { text: 'Communes of Chile',              prompt: 'Communes of Chile' },
      pt: { text: 'Comunas do Chile',               prompt: 'Comunas do Chile' },
      layerKey: 'MAPA_BASE_LIMITES_MapServer_2_cl', weight: 8,
    },
    {
      es: { text: 'Provincias de Chile',            prompt: 'Provincias de Chile' },
      en: { text: 'Provinces of Chile',             prompt: 'Provinces of Chile' },
      pt: { text: 'Províncias do Chile',            prompt: 'Províncias do Chile' },
      layerKey: 'MAPA_BASE_LIMITES_MapServer_1_cl', weight: 7,
    },
    // Transporte
    {
      es: { text: 'Red vial de Chile',              prompt: 'Red vial de Chile' },
      en: { text: 'Road network of Chile',          prompt: 'Road network of Chile' },
      pt: { text: 'Rede viária do Chile',           prompt: 'Rede viária do Chile' },
      layerKey: 'VIALIDAD_Red_Vial_Chile_MapServer_2_cl', weight: 10,
    },
    {
      es: { text: 'Pasos fronterizos de Chile',     prompt: 'Pasos fronterizos de Chile' },
      en: { text: 'Border crossings of Chile',      prompt: 'Border crossings of Chile' },
      pt: { text: 'Postos de fronteira do Chile',   prompt: 'Postos de fronteira do Chile' },
      layerKey: 'VIALIDAD_Pasos_Fronterizos_MapServer_0_cl', weight: 7,
    },
    {
      es: { text: 'Aeropuertos de Chile',           prompt: 'Red aeroportuaria de Chile' },
      en: { text: 'Airports of Chile',              prompt: 'Airport network of Chile' },
      pt: { text: 'Aeroportos do Chile',            prompt: 'Rede aeroportuária do Chile' },
      layerKey: 'DAP_Red_Aeroportuaria_Nacional_MapServer_0_cl', weight: 7,
    },
    {
      es: { text: 'Infraestructura portuaria de Chile', prompt: 'Infraestructura portuaria de Chile' },
      en: { text: 'Port infrastructure of Chile',       prompt: 'Port infrastructure of Chile' },
      pt: { text: 'Infraestrutura portuária do Chile',  prompt: 'Infraestrutura portuária do Chile' },
      layerKey: 'DOP_CATASTRO_DOP_MapServer_0_cl', weight: 6,
    },
    // Hidrografía
    {
      es: { text: 'Ríos de Chile',                  prompt: 'Ríos de Chile' },
      en: { text: 'Rivers of Chile',                prompt: 'Rivers of Chile' },
      pt: { text: 'Rios do Chile',                  prompt: 'Rios do Chile' },
      layerKey: 'MAPA_BASE_RED_HIDROGRAFICA_MapServer_7_cl', weight: 8,
    },
    {
      es: { text: 'Lagos de Chile',                 prompt: 'Lagos y lagunas de Chile' },
      en: { text: 'Lakes of Chile',                 prompt: 'Lakes of Chile' },
      pt: { text: 'Lagos do Chile',                 prompt: 'Lagos e lagoas do Chile' },
      layerKey: 'MAPA_BASE_RED_HIDROGRAFICA_MapServer_8_cl', weight: 7,
    },
    {
      es: { text: 'Embalses de Chile',              prompt: 'Catastro de embalses de Chile' },
      en: { text: 'Reservoirs of Chile',            prompt: 'Reservoirs of Chile' },
      pt: { text: 'Reservatórios do Chile',         prompt: 'Reservatórios do Chile' },
      layerKey: 'DOH_Embalses_MapServer_0_cl', weight: 6,
    },
    // Medio ambiente
    {
      es: { text: 'Áreas protegidas de Chile',      prompt: 'Áreas protegidas de Chile' },
      en: { text: 'Protected areas of Chile',       prompt: 'Protected areas of Chile' },
      pt: { text: 'Áreas protegidas do Chile',      prompt: 'Áreas protegidas do Chile' },
      layerKey: 'MAPA_BASE_SNASPE_MapServer_0_cl', weight: 9,
    },
    // Infraestructura y servicios
    {
      es: { text: 'Centros de salud de Chile',      prompt: 'Centros de salud de Chile' },
      en: { text: 'Health centers of Chile',        prompt: 'Health centers of Chile' },
      pt: { text: 'Centros de saúde do Chile',      prompt: 'Centros de saúde do Chile' },
      layerKey: 'IDE_EXTERNA_CENTROSALUD_MapServer_0_cl', weight: 7,
    },
    {
      es: { text: 'Poblados de Chile',              prompt: 'Poblados de Chile' },
      en: { text: 'Towns of Chile',                 prompt: 'Towns of Chile' },
      pt: { text: 'Povoados do Chile',              prompt: 'Povoados do Chile' },
      layerKey: 'MAPA_BASE_ASENTAMIENTOS_MapServer_20_cl', weight: 7,
    },
  ];

  // ── Helpers ────────────────────────────────────────────────────

  // Idioma activo
  function _lang() {
    return window.I18N?.getLang?.() || 'es';
  }

  // Filtra el pool dejando solo las capas que existen en window.LAYERS
  function _available() {
    const layers = window.LAYERS || {};
    const lang   = _lang();
    return POOL
      .filter(p => layers[p.layerKey] && p[lang])
      .map(p => ({ ...p[lang], layerKey: p.layerKey, weight: p.weight }));
  }

  // Selecciona 3 prompts distintos usando los pesos como probabilidad,
  // con una rotación diaria para que no sean siempre los mismos.
  function _pick3(available, n = 3) {
    if (available.length <= n) return available;

    // Semilla de sesión: varía cada vez que el usuario carga la app
    const daySeed = Math.floor(Math.random() * 100000);

    // Shuffle determinístico seeded
    const seeded = [...available]
      .map((p, i) => ({ p, sort: ((daySeed * 31 + i * 17) % 97) / 97 + (1 / p.weight) }))
      .sort((a, b) => a.sort - b.sort)
      .map(x => x.p);

    // Tomar los 3 primeros asegurando variedad temática
    const picked = [];
    const usedKeys = new Set();
    for (const p of seeded) {
      // Evitar dos prompts del mismo tema (mismo prefijo del layerKey)
      // Extraer tema semántico del layerKey para evitar dos prompts del mismo tipo:
      //   AR/UY: 'rio_ar' → 'rio'
      //   CL:    'MAPA_BASE_RED_HIDROGRAFICA_MapServer_7_cl' → 'HIDROGRAFICA'
      //          'VIALIDAD_Red_Vial_Chile_MapServer_2_cl'    → 'VIALIDAD'
      //          'MAPA_BASE_LIMITES_MapServer_0_cl'          → 'LIMITES'
      const theme = p.layerKey.endsWith('_cl')
        ? p.layerKey.replace(/_cl$/, '').replace(/(_MapServer_\d+|_\d+)$/, '').replace(/^MAPA_BASE_/, '')
        : p.layerKey.replace(/_ar$|_uy$/, '').replace(/_\w+$/, '');
      if (!usedKeys.has(theme)) {
        picked.push(p);
        usedKeys.add(theme);
        if (picked.length === 3) break;
      }
    }
    // Fallback si no llegamos a 3
    for (const p of seeded) {
      if (picked.length === 3) break;
      if (!picked.includes(p)) picked.push(p);
    }
    return picked.slice(0, n);
  }

  // ── Render ─────────────────────────────────────────────────────

  let _container = null;

  // Mostrar en la home — debajo del input, chips clickeables que envían directo
  function showInHome() {
    const homeContainer = document.getElementById('home-suggested-prompts');
    if (!homeContainer) return;

    const available = _available();
    if (!available.length) return;

    const n = window.MAP_CONTROLS?.isMobile?.() ? 2 : 3;
    const prompts = _pick3(available, n);

    homeContainer.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'suggested-prompts';

    prompts.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'suggested-prompt-btn';
      btn.textContent = p.text;
      btn.addEventListener('click', () => {
        const ta = document.getElementById('initial-prompt');
        if (ta) ta.value = p.prompt;
        document.getElementById('btn-send-initial')?.click();
      });
      wrap.appendChild(btn);
    });

    homeContainer.appendChild(wrap);
  }

  // Mostrar en el chat (cuando no hay prompt inicial)
  function show(onSelect) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    const available = _available();
    if (!available.length) return;

    const n = window.MAP_CONTROLS?.isMobile?.() ? 2 : 3;
    const prompts = _pick3(available, n);

    hide();

    _container = document.createElement('div');
    _container.id = 'suggested-prompts';
    _container.className = 'suggested-prompts';

    prompts.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'suggested-prompt-btn';
      btn.textContent = p.text;
      btn.addEventListener('click', () => {
        hide();
        onSelect(p.prompt);
      });
      _container.appendChild(btn);
    });

    msgs.appendChild(_container);
  }

  function hide() {
    if (_container) {
      _container.remove();
      _container = null;
    }
    document.getElementById('suggested-prompts')?.remove();
  }

  return { show, hide, showInHome };

})();
