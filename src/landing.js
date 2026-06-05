/* ═══════ DATA ═══════ */
  // Leído de window.COUNTRIES (layers/countries.js — fuente de verdad única).
  // Adaptar al formato { key, status, name } que usa renderCountries().
  const COUNTRIES = (window.COUNTRIES || []).map(c => ({
    key:    'country_' + c.code,
    status: c.status || null,
    name:   l => c[l] || c.es || c.code.toUpperCase(),
  }));

  /* ═══════ i18n ═══════ */
  const S = {
    es:{
      hero_tagline: 'Escribí lo que querés.<br><span class="white">Casux</span> lo mapea.',
      hero_prompt_label: '¿Cuál querés que sea tu primer mapa?',
      hero_bullets: [
        'Sin tecnicismos, sin curva de aprendizaje.',
        'Con datos oficiales.',
        'Listo para usar en minutos.',
      ],
      how_label: 'Cómo funciona',
      step1_title: 'Escribís lo que querés en lenguaje natural',
      step1_body: 'Sin complicaciones, como si se lo dijeras a alguien.',
      step2_title: 'Casux interpreta y prepara los datos',
      step2_body: 'Siempre utilizando datos abiertos, publicados por organismos oficiales.',
      step3_title: 'Ajustás los detalles y exportás el mapa',
      step3_body: 'Podés descargarlo como imagen, archivo portable o mapa interactivo.',
      anim_trazando: 'Trazando…',
      hc_placeholder: 'Describí el mapa…',
      hc_new_map: 'Nuevo mapa',
      anim_mapa_generado: 'Mapa generado',
      anim_ver: 'VER',
      anim_exportar: 'Exportar',
      anim_jpeg_filename: 'puertos.jpeg',
      coverage_label: 'Cobertura',
      country_ar:'Argentina', country_bo:'Bolivia',  country_br:'Brasil',
      country_cl:'Chile',     country_co:'Colombia', country_ec:'Ecuador',
      country_gy:'Guyana',    country_pe:'Perú',     country_py:'Paraguay',
      country_sr:'Surinam',   country_uy:'Uruguay',  country_ve:'Venezuela',
      connected: 'Disponible',
      status_soon: 'Próximamente',
      cta_headline: 'Tu próximo mapa empieza con una frase.',
      cta_btn: 'ABRIR CASUX',
      nav_try: 'PROBAR CASUX',
      coverage_more: 'ESTADO DE GEOSERVICIOS',
      footer_copy: '© 2026 Casux · Todos los derechos reservados',
      page_title: 'Casux — Escribí lo que querés. Casux lo mapea.',
    },
    en:{
      hero_tagline: 'Write what you want.<br><span class="white">Casux</span> maps it.',
      hero_prompt_label: 'What should your first map be?',
      hero_bullets: [
        'No jargon, no learning curve.',
        'Official data.',
        'Ready to use in minutes.',
      ],
      how_label: 'How it works',
      step1_title: 'Write what you want in natural language',
      step1_body: 'No complications — just describe it like you would to a person.',
      step2_title: 'Casux interprets and prepares the data',
      step2_body: 'Always using open data published by official organizations.',
      step3_title: 'Adjust the details and export your map',
      step3_body: 'Download it as an image, a portable file, or an interactive map.',
      anim_trazando: 'Drawing…',
      anim_mapa_generado: 'Map generated',
      anim_ver: 'VIEW',
      anim_exportar: 'Export',
      anim_jpeg_filename: 'ports.jpeg',
      hc_placeholder: 'Describe the map…',
      hc_new_map: 'New map',
      coverage_label: 'Coverage',
      country_ar:'Argentina', country_bo:'Bolivia',  country_br:'Brazil',
      country_cl:'Chile',     country_co:'Colombia', country_ec:'Ecuador',
      country_gy:'Guyana',    country_pe:'Peru',     country_py:'Paraguay',
      country_sr:'Suriname',  country_uy:'Uruguay',  country_ve:'Venezuela',
      connected: 'Available',
      status_soon: 'Coming soon',
      cta_headline: 'Your next map starts with a sentence.',
      cta_btn: 'OPEN CASUX',
      nav_try: 'TRY CASUX',
      coverage_more: 'GEOSERVICE STATUS',
      footer_copy: '© 2026 Casux · All rights reserved',
      page_title: 'Casux — Write what you want. Casux maps it.',
    },
    pt:{
      hero_tagline: 'Escreva o que quer.<br><span class="white">Casux</span> mapeia.',
      hero_prompt_label: 'Qual deve ser o seu primeiro mapa?',
      hero_bullets: [
        'Sem tecnicismos, sem curva de aprendizado.',
        'Com dados oficiais.',
        'Pronto para usar em minutos.',
      ],
      how_label: 'Como funciona',
      step1_title: 'Escreva o que quer em linguagem natural',
      step1_body: 'Sem complicações — descreva como faria para uma pessoa.',
      step2_title: 'Casux interpreta e prepara os dados',
      step2_body: 'Sempre utilizando dados abertos publicados por organismos oficiais.',
      step3_title: 'Ajuste os detalhes e exporte o mapa',
      step3_body: 'Baixe como imagem, arquivo portátil ou mapa interativo.',
      anim_trazando: 'Traçando…',
      anim_mapa_generado: 'Mapa gerado',
      anim_ver: 'VER',
      anim_exportar: 'Exportar',
      anim_jpeg_filename: 'portos.jpeg',
      hc_placeholder: 'Descreva o mapa…',
      hc_new_map: 'Novo mapa',
      coverage_label: 'Cobertura',
      country_ar:'Argentina', country_bo:'Bolívia',  country_br:'Brasil',
      country_cl:'Chile',     country_co:'Colômbia', country_ec:'Equador',
      country_gy:'Guiana',    country_pe:'Peru',     country_py:'Paraguai',
      country_sr:'Suriname',  country_uy:'Uruguai',  country_ve:'Venezuela',
      connected: 'Disponível',
      status_soon: 'Em breve',
      cta_headline: 'Seu próximo mapa começa com uma frase.',
      cta_btn: 'ABRIR CASUX',
      nav_try: 'EXPERIMENTAR',
      coverage_more: 'ESTADO DOS GEOSERVIÇOS',
      footer_copy: '© 2026 Casux · Todos os direitos reservados',
      page_title: 'Casux — Escreva o que quer. Casux mapeia.',
    },
  };

  let lang = 'es';

  /* ═══════ LANG ═══════ */
  function applyLang(l) {
    lang = l;
    const s = S[l];
    document.documentElement.lang = l;
    document.title = s.page_title;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.dataset.i18n;
      if (s[k] !== undefined) el.innerHTML = s[k];
    });

    // placeholder = the prompt label text
    const inp = document.getElementById('hero-input');
    if (inp) inp.placeholder = s.hero_prompt_label;

    // bullets
    const bl = document.getElementById('hero-bullets');
    if (bl) bl.innerHTML = s.hero_bullets.map(b => `<li>${b}</li>`).join('');

    // footer
    document.getElementById('footer-copy-text').textContent = s.footer_copy;

    // lang buttons
    document.querySelectorAll('[data-lang]').forEach(b =>
      b.classList.toggle('active', b.dataset.lang === l));

    renderCountries(l);
  }

  /* ═══════ COVERAGE ═══════ */
  function renderCountries(l) {
    const s = S[l];
    const grid = document.getElementById('coverage-grid');

    function cardHTML(c) {
      const name = c.name(l);
      if (c.status === 'active') {
        return `
          <div class="country-card active">
            <div class="card-header">
              <span class="country-name">${name}</span>
              <span class="connected-label">${s.connected}</span>
            </div>
          </div>`;
      } else if (c.status === 'soon') {
        return `
          <div class="country-card soon">
            <div class="card-header">
              <span class="country-name">${name}</span>
              <span class="connected-label">${s.status_soon}</span>
            </div>
          </div>`;
      } else {
        return `
          <div class="country-card">
            <div class="card-header">
              <span class="country-name">${name}</span>
            </div>
          </div>`;
      }
    }

    // Distribuir en bloques contiguos (no round-robin) para que en mobile,
    // donde las columnas se apilan, el orden alfabético se preserve.
    // Round-robin (i % 3) rompía el orden en mobile: col0=[AR,CL,GY,PY,VE], col1=[BO,EC,SR]...
    const nCols = 3;
    const perCol = Math.ceil(COUNTRIES.length / nCols);
    const cols = Array.from({ length: nCols }, (_, ci) =>
      COUNTRIES.slice(ci * perCol, (ci + 1) * perCol)
    );
    grid.innerHTML = cols.map(col =>
      `<div class="coverage-col">${col.map(cardHTML).join('')}</div>`
    ).join('');
  }

  /* ═══════ STEP ANIMATIONS — coordinated cycle ═══════ */
  const PROMPTS = {
    es: [ 'Quiero un mapa de puertos' ],
    en: [ 'I want a map of ports' ],
    pt: [ 'Quero um mapa de portos' ],
  };

  let cycleIdx = 0;
  let paused = false;
  let _resumeFn = null;           // función para continuar desde donde se pausó
  const _activeTimers = new Set();

  function clearCycle() {
    _activeTimers.forEach(id => clearTimeout(id));
    _activeTimers.clear();
  }

  function after(ms, fn) {
    // Capturar fn como punto de continuación (el último timer registrado)
    _resumeFn = fn;
    const id = setTimeout(() => {
      _activeTimers.delete(id);
      if (!paused) fn();
    }, ms);
    _activeTimers.add(id);
    return id;
  }

  // Chat mockup sub-labels per prompt
  const PROMPT_META = {
    es: [ { title: 'Puertos', sub: '1 capa · Argentina' } ],
    en: [ { title: 'Ports',   sub: '1 layer · Argentina' } ],
    pt: [ { title: 'Portos',  sub: '1 camada · Argentina' } ],
  };

  // South America coastal ports
  const PORTS = [
    [-34.60, -58.37],  // Buenos Aires
    [-38.72, -62.27],  // Bahía Blanca
    [-42.77, -65.04],  // Puerto Madryn
    [-51.62, -69.22],  // Río Gallegos
    [-34.90, -56.20],  // Montevideo
    [-23.00, -43.17],  // Río de Janeiro
    [-33.05, -71.62],  // Valparaíso
    [10.40,  -75.53],  // Cartagena
  ];

  // Mercator projection matching Leaflet zoom:2 center:-25,-62
  function projectMercator(lat, lng, mapW, mapH) {
    const centerLat = -25, centerLng = -62, zoom = 2;
    const scale = 256 * Math.pow(2, zoom);
    const mercY = lat => Math.log(Math.tan(Math.PI/4 + lat * Math.PI/360));
    const cx = (centerLng + 180) / 360 * scale;
    const cy = (1 - mercY(centerLat) / Math.PI) / 2 * scale;
    const px = (lng + 180) / 360 * scale;
    const py = (1 - mercY(lat) / Math.PI) / 2 * scale;
    return [mapW/2 + (px - cx), mapH/2 + (py - cy)];
  }

  function buildSVG(promptIdx) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');

    const mapEl = document.getElementById('hc-leaflet');
    const W = mapEl ? (mapEl.offsetWidth  || 360) : 360;
    const H = mapEl ? (mapEl.offsetHeight || 260) : 260;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    function project(lat, lng) {
      if (hcLeaflet) {
        const p = hcLeaflet.latLngToContainerPoint([lat, lng]);
        return [p.x, p.y];
      }
      return projectMercator(lat, lng, W, H);
    }

    if (promptIdx === 0) {
      PORTS.forEach(([lat, lng], i) => {
        const [x, y] = project(lat, lng);
        if (x < -15 || x > W+15 || y < -15 || y > H+15) return;
        const cx = x.toFixed(1), cy = y.toFixed(1);
        const delay = (i * 0.4) % 2.5; // stagger start times

        // Core dot
        const c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy);
        c.setAttribute('r', '5'); c.setAttribute('fill', '#3d52a0'); c.setAttribute('opacity', '0.9');
        svg.appendChild(c);

        // Pulse ring — animates radius and opacity
        const ring = document.createElementNS(svgNS, 'circle');
        ring.setAttribute('cx', cx); ring.setAttribute('cy', cy);
        ring.setAttribute('r', '5'); ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#3d52a0'); ring.setAttribute('stroke-width', '1.2');

        const animR = document.createElementNS(svgNS, 'animate');
        animR.setAttribute('attributeName', 'r');
        animR.setAttribute('from', '6'); animR.setAttribute('to', '16');
        animR.setAttribute('dur', '2.5s'); animR.setAttribute('begin', `${delay}s`);
        animR.setAttribute('repeatCount', 'indefinite'); animR.setAttribute('calcMode', 'spline');
        animR.setAttribute('keySplines', '0.2 0 0.8 1');
        ring.appendChild(animR);

        const animO = document.createElementNS(svgNS, 'animate');
        animO.setAttribute('attributeName', 'opacity');
        animO.setAttribute('from', '0.45'); animO.setAttribute('to', '0');
        animO.setAttribute('dur', '2.5s'); animO.setAttribute('begin', `${delay}s`);
        animO.setAttribute('repeatCount', 'indefinite'); animO.setAttribute('calcMode', 'spline');
        animO.setAttribute('keySplines', '0.2 0 0.8 1');
        ring.appendChild(animO);

        svg.appendChild(ring);
      });
    }
    return svg;
  }

  const hcMapPanel  = document.getElementById('hc-map-panel');
  const hcMapPTitle = document.getElementById('hc-map-panel-title');

  // Init Leaflet — deferred to first show
  let hcLeaflet = null;
  let hcTileLayer = null;

  const TILES = {
    day:   'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    night: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
  };
  const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';

  function isDay() {
    // Match the same logic as settings.js: day = 7:00–20:00
    const h = new Date().getHours();
    return h >= 7 && h < 20;
  }

  function updateMapTiles() {
    if (!hcLeaflet || typeof L === 'undefined') return;
    const url = TILES[isDay() ? 'day' : 'night'];
    if (hcTileLayer) {
      hcTileLayer.setUrl(url);
    }
    // Also update fallback bg
    const el = document.getElementById('hc-leaflet');
    if (el) el.style.background = isDay() ? '#d8d4cc' : '#1a1a1a';
  }

  const MAP_LEGENDS = [
    [{ type:'dot', color:'#3d52a0', labelKey:'legend_ports' }],
  ];
  const LEGEND_LABELS = {
    es: { legend_ports: 'Puertos' },
    en: { legend_ports: 'Ports'   },
    pt: { legend_ports: 'Portos'  },
  };
  function initLeaflet() {
    const el = document.getElementById('hc-leaflet');
    if (!el || hcLeaflet || typeof L === 'undefined') {
      // Fallback: plain background if Leaflet not available
      if (el && typeof L === 'undefined') el.style.background = isDay() ? '#d8d4cc' : '#1a1a1a';
      return;
    }
    hcLeaflet = L.map('hc-leaflet', {
      center: [-25, -62], zoom: 2,
      zoomControl: false, attributionControl: true,
      dragging: false, touchZoom: false, doubleClickZoom: false,
      scrollWheelZoom: false, boxZoom: false, keyboard: false,
    });
    hcTileLayer = L.tileLayer(TILES[isDay() ? 'day' : 'night'], {
      attribution: TILE_ATTRIBUTION,
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(hcLeaflet);
  }

  function showMapPanel(promptIdx, title) {
    if (!hcMapPanel) return;
    if (hcMapPTitle) hcMapPTitle.textContent = title;

    initLeaflet();
    if (hcLeaflet) {
      setTimeout(() => {
        hcLeaflet.invalidateSize();
        renderOverlay(promptIdx);
      }, 80);
    } else {
      renderOverlay(promptIdx);
    }

    function renderOverlay(idx) {
      const svgEl = document.getElementById('hc-map-svg');
      if (svgEl) {
        while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
        const built = buildSVG(idx);
        // sync viewBox
        svgEl.setAttribute('viewBox', built.getAttribute('viewBox'));
        Array.from(built.children).forEach(c => svgEl.appendChild(c.cloneNode(true)));
      }
    }

    // Render legend
    const legend = document.getElementById('hc-map-legend');
    if (legend) {
      const items = MAP_LEGENDS[promptIdx % MAP_LEGENDS.length];
      const labels = LEGEND_LABELS[lang];
      legend.innerHTML = items.map(item => {
        const swatch = item.type === 'dot'
          ? `<div class="hc-legend-dot" style="background:${item.color}"></div>`
          : `<div class="hc-legend-swatch" style="background:${item.color};${item.dashed?'background:repeating-linear-gradient(90deg,'+item.color+' 0,'+item.color+' 4px,transparent 4px,transparent 7px)':''}"></div>`;
        return `<div class="hc-legend-row">${swatch}<span>${labels[item.labelKey]}</span></div>`;
      }).join('');
    }

    hcMapPanel.classList.add('visible');
  }
  function hideMapPanel() {
    if (hcMapPanel) hcMapPanel.classList.remove('visible');
  }

  let hcJpegLeaflet = null;

  function showJpegPanel() {
    const panel = document.getElementById('hc-jpeg-panel');
    if (!panel) return;

    panel.classList.add('visible');

    const jpegMapEl = document.getElementById('hc-jpeg-leaflet');

    // Set sheet bg to match main map tone
    const jpegSheet = panel.querySelector('.hc-jpeg-sheet');
    if (jpegSheet) jpegSheet.style.background = isDay() ? '#d8d4cc' : '#1a1a1a';

    function renderDots() {
      const svgEl = document.getElementById('hc-jpeg-svg');
      if (!svgEl) return;
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

      const area = document.getElementById('hc-jpeg-area');
      const W = area ? area.getBoundingClientRect().width  : (jpegMapEl ? jpegMapEl.getBoundingClientRect().width  : 0);
      const H = area ? area.getBoundingClientRect().height : (jpegMapEl ? jpegMapEl.getBoundingClientRect().height : 0);
      if (W < 5 || H < 5) return; // bail if layout not ready

      svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

      const svgNS = 'http://www.w3.org/2000/svg';
      PORTS.forEach(([lat, lng]) => {
        const [px, py] = projectMercator(lat, lng, W, H);
        if (px < -15 || px > W+15 || py < -15 || py > H+15) return;
        const c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('cx', px.toFixed(1));
        c.setAttribute('cy', py.toFixed(1));
        c.setAttribute('r', '5');
        c.setAttribute('fill', '#3d52a0');
        c.setAttribute('opacity', '0.9');
        svgEl.appendChild(c);
      });
    }

    if (jpegMapEl && !hcJpegLeaflet && hcLeaflet) {
      hcJpegLeaflet = L.map(jpegMapEl, {
        center: hcLeaflet.getCenter(), zoom: hcLeaflet.getZoom(),
        zoomControl: false, attributionControl: false,
        dragging: false, touchZoom: false, doubleClickZoom: false,
        scrollWheelZoom: false, boxZoom: false, keyboard: false,
      });
      L.tileLayer(TILES[isDay() ? 'day' : 'night'], {
        subdomains: 'abcd', maxZoom: 19,
      }).addTo(hcJpegLeaflet);
    }

    // Always invalidate + render after a reliable delay
    setTimeout(() => {
      if (hcJpegLeaflet) hcJpegLeaflet.invalidateSize();
      renderDots();
    }, 120);
  }
  function hideJpegPanel() {
    const panel = document.getElementById('hc-jpeg-panel');
    if (panel) panel.classList.remove('visible');
  }


  /* ── Cursor animation ── */
  const hcCursorEl = document.getElementById('hc-cursor');
  const heroRightEl = document.querySelector('.hero-right');

  function getCursorTarget(el) {
    // Returns center of el relative to hero-right
    if (!el || !heroRightEl) return null;
    const er = heroRightEl.getBoundingClientRect();
    const tr = el.getBoundingClientRect();
    return {
      x: tr.left - er.left + tr.width  / 2,
      y: tr.top  - er.top  + tr.height / 2,
    };
  }

  function moveCursor(el, durationMs, cb) {
    if (!hcCursorEl || !el) { if (cb) after(durationMs, cb); return; }
    const pos = getCursorTarget(el);
    if (!pos) { if (cb) after(durationMs, cb); return; }
    hcCursorEl.style.transition = `left ${durationMs}ms cubic-bezier(.25,.1,.25,1), top ${durationMs}ms cubic-bezier(.25,.1,.25,1)`;
    hcCursorEl.style.left = pos.x + 'px';
    hcCursorEl.style.top  = pos.y + 'px';
    if (cb) after(durationMs, cb);
  }

  function showCursor(el) {
    if (!hcCursorEl) return;
    const pos = getCursorTarget(el);
    if (!pos) return;
    hcCursorEl.style.transition = 'none';
    hcCursorEl.style.left = pos.x + 'px';
    hcCursorEl.style.top  = pos.y + 'px';
    hcCursorEl.classList.add('visible');
  }

  function hideCursor() {
    if (!hcCursorEl) return;
    hcCursorEl.classList.remove('visible', 'clicking');
  }

  function clickCursor(cb) {
    if (!hcCursorEl) { if (cb) after(180, cb); return; }
    hcCursorEl.classList.add('clicking');
    after(180, () => {
      hcCursorEl.classList.remove('clicking');
      if (cb) after(0, cb);
    });
  }

  function runCycle() {
    if (paused) return;
    clearCycle();
    const prompts = PROMPTS[lang];
    const text = prompts[cycleIdx % prompts.length];
    const meta = PROMPT_META[lang][cycleIdx % prompts.length];
    cycleIdx++;

    // How-it-works elements
    const typedEl   = document.getElementById('anim1-text');
    const sendBtn   = document.getElementById('anim1-send');
    const thinking  = document.getElementById('anim2-thinking');
    const done      = document.getElementById('anim2-done');
    const exportBtn = document.getElementById('anim3-export');

    // Chat mockup elements
    const hcInput     = document.getElementById('hc-input-text');
    const hcSend      = document.getElementById('hc-send-btn');
    const hcUser      = document.getElementById('hc-user-msg');
    const hcThink     = document.getElementById('hc-thinking');
    const hcCard      = document.getElementById('hc-map-card');
    const hcTitle     = document.getElementById('hc-map-title');
    const hcSub       = document.getElementById('hc-map-sub');
    const hcVer       = document.getElementById('hc-ver-btn');
    const hcExportBtn = document.getElementById('hc-export-btn');
    const hcChatTitle = document.getElementById('hc-chat-title');
    const hcInputArea = document.querySelector('.hc-input-area');

    if (!typedEl) return;

    // ── Reset all ──
    typedEl.textContent = '';
    if (hcInput)     hcInput.textContent = '';
    if (sendBtn)     sendBtn.classList.remove('clicked');
    if (hcSend)      hcSend.classList.remove('clicked');
    if (thinking)    { thinking.classList.remove('visible'); thinking.style.opacity = ''; }
    if (done)        done.classList.remove('visible');
    if (exportBtn)   exportBtn.classList.remove('clicked');
    if (hcUser)      hcUser.classList.remove('visible');
    if (hcThink)     hcThink.classList.remove('visible');
    if (hcCard)      hcCard.classList.remove('visible');
    if (hcVer)       hcVer.classList.remove('clicked');
    if (hcExportBtn) hcExportBtn.classList.remove('clicked');
    hideJpegPanel();
    if (hcChatTitle) { hcChatTitle.textContent = S[lang].hc_new_map; hcChatTitle.classList.remove('named'); }
    if (hcInputArea) hcInputArea.classList.remove('sent');
    hideMapPanel();
    hideCursor();

    // ── Phase 1: typewrite in both boxes simultaneously ──
    let i = 0;
    (function type() {
      if (i < text.length) {
        const ch = text[i++];
        typedEl.textContent += ch;
        if (hcInput) hcInput.textContent += ch;
        _resumeFn = type;
        const tid = setTimeout(() => { _activeTimers.delete(tid); if (!paused) type(); }, 46 + Math.random() * 28);
        _activeTimers.add(tid);
      } else {
        // ── Phase 2: appear at center, move cursor to send, click ──
        if (hcCursorEl && heroRightEl) {
          const r = heroRightEl.getBoundingClientRect();
          hcCursorEl.style.transition = 'none';
          hcCursorEl.style.left = (r.width  / 2) + 'px';
          hcCursorEl.style.top  = (r.height / 2) + 'px';
          hcCursorEl.classList.add('visible');
        }
        after(300, () => {
          moveCursor(hcSend, 500, () => {
            clickCursor(() => {
              if (sendBtn) sendBtn.classList.add('clicked');
              if (hcSend)  hcSend.classList.add('clicked');
              after(160, () => {
                if (sendBtn) sendBtn.classList.remove('clicked');
                if (hcSend)  hcSend.classList.remove('clicked');
                if (hcUser) { hcUser.textContent = text; hcUser.classList.add('visible'); }
                if (hcInputArea) hcInputArea.classList.add('sent');

                // ── Phase 3: Trazando appears in both ──
                after(500, () => {
                  if (thinking) thinking.classList.add('visible');
                  if (hcThink)  hcThink.classList.add('visible');

                  // ── Phase 4: Trazando → done/card ──
                  after(2000, () => {
                    if (thinking) thinking.classList.remove('visible');
                    if (hcThink)  hcThink.classList.remove('visible');
                    after(300, () => {
                      if (done) done.classList.add('visible');
                      if (hcTitle) hcTitle.textContent = meta.title;
                      if (hcSub)   hcSub.textContent = meta.sub;
                      if (hcCard)  hcCard.classList.add('visible');
                      if (hcChatTitle) { hcChatTitle.textContent = meta.title; hcChatTitle.classList.add('named'); }

                      // ── Phase 5: cursor → VER → map → cursor → EXPORTAR ──
                      after(400, () => {
                        moveCursor(hcVer, 500, () => {
                          after(200, () => {
                            if (hcVer) {
                              clickCursor(() => {
                                hcVer.classList.add('clicked');
                                after(160, () => {
                                  if (hcVer) hcVer.classList.remove('clicked');
                                  showMapPanel(0, meta.title);
                                  after(800, () => {
                                    moveCursor(hcExportBtn, 600, () => {
                                      after(200, () => {
                                        clickCursor(() => {
                                          if (exportBtn) exportBtn.classList.add('clicked');
                                          if (hcExportBtn) hcExportBtn.classList.add('clicked');
                                          after(180, () => {
                                            if (exportBtn) exportBtn.classList.remove('clicked');
                                            if (hcExportBtn) hcExportBtn.classList.remove('clicked');

                                            // ── Shutter flash → jpeg panel ──
                                            const shutter = document.getElementById('hc-shutter');
                                            if (shutter) {
                                              shutter.classList.add('flash');
                                              setTimeout(() => {
                                                shutter.style.transition = 'opacity 0.35s ease';
                                                requestAnimationFrame(() => {
                                                  shutter.classList.remove('flash');
                                                  setTimeout(() => { shutter.style.transition = ''; }, 400);
                                                });
                                              }, 80);
                                            }
                                            after(60, () => showJpegPanel());

                                            // ── Phase 6: hold, slide away, erase ──
                                            after(2200, () => {
                                              hideCursor();
                                              hideJpegPanel();
                                              hideMapPanel();
                                              // Ocultar los elementos del chat mockup ANTES
                                              // de la pausa de borrado — evita el flash donde
                                              // el chat escrito se ve por una fracción de segundo
                                              // antes de que runCycle los limpie.
                                              if (hcUser)      hcUser.classList.remove('visible');
                                              if (hcThink)     hcThink.classList.remove('visible');
                                              if (hcCard)      hcCard.classList.remove('visible');
                                              if (hcChatTitle) { hcChatTitle.textContent = S[lang].hc_new_map; hcChatTitle.classList.remove('named'); }
                                              if (hcInputArea) hcInputArea.classList.remove('sent');
                                              after(400, () => {
                                                (function erase() {
                                                  if (typedEl.textContent.length > 0) {
                                                    typedEl.textContent = typedEl.textContent.slice(0, -1);
                                                    if (hcInput) hcInput.textContent = typedEl.textContent;
                                                    _resumeFn = erase;
                                                    const eid = setTimeout(() => { _activeTimers.delete(eid); if (!paused) erase(); }, 18);
                                                    _activeTimers.add(eid);
                                                  } else {
                                                    after(400, runCycle);
                                                  }
                                                })();
                                              });
                                            });
                                          });
                                        });
                                      });
                                    });
                                  });
                                });
                              });
                            }
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      }
    })();
  }
  /* ── Pause button ── */
  const pauseBtn = document.getElementById('hc-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'play_arrow' : 'pause';
      if (!paused) {
        // Continuar desde donde se pausó; si no hay punto de continuación, reiniciar
        if (_resumeFn) { const fn = _resumeFn; _resumeFn = null; fn(); }
        else runCycle();
      } else {
        clearCycle();
      }
    });
  }

  /* ── Hero prompt: save to localStorage + navigate to /chat ── */
  const heroInput = document.getElementById('hero-input');
  const heroSend  = document.getElementById('hero-send');
  if (heroInput && heroSend) {
    heroInput.addEventListener('input', () => {
      heroInput.style.height = 'auto';
      heroInput.style.height = heroInput.scrollHeight + 'px';
    });
    function sendHero() {
      const val = heroInput.value.trim();
      if (val) localStorage.setItem('casux_pending_message', val);
      window.location.href = '/chat';
    }
    heroSend.addEventListener('click', e => { e.preventDefault(); sendHero(); });
    heroInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendHero(); }
    });
  }

  /* ═══════ BOTÓN PROBAR CASUX ═══════ */
  // Con login anónimo, todo va directo a /chat — la sesión se crea automáticamente al llegar.
  document.getElementById('btn-try')?.addEventListener('click', () => {
    window.location.href = '/chat';
  });

  /* ═══════ SCROLL REVEAL ═══════ */
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -28px 0px' });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

  /* ═══════ NAVBAR SCROLL ═══════ */
  const topBar = document.getElementById('top-bar');
  window.addEventListener('scroll', () => {
    topBar.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  /* ═══════ EVENTS ═══════ */
  document.querySelectorAll('[data-lang]').forEach(b =>
    b.addEventListener('click', () => applyLang(b.dataset.lang)));

  /* ═══════ INIT ═══════ */
  // Detect browser language
  function detectLang() {
    const nav = (navigator.language || navigator.userLanguage || 'es').toLowerCase().slice(0, 2);
    if (nav === 'pt') return 'pt';
    if (nav === 'en') return 'en';
    return 'es';
  }
  applyLang(detectLang());
  runCycle();
