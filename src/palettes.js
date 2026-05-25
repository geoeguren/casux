/**
 * palettes.js — Paletas de color para clasificación de capas
 *
 * Fuente única de verdad. Consumido por:
 *   app.js (renderMap, applyClassifyPlan)
 *   layers-panel.js (clasificación interactiva)
 *
 * CUALITATIVAS (categórico): colores con máximo contraste entre categorías
 * SECUENCIALES (graduado): progresión de magnitud clara
 */

// ── Paletas cualitativas ──────────────────────────────────────────
// 6 paletas × 12 colores, cada una con contraste perceptual entre valores

window.CAT_PALETTES = {
  // Paletas cualitativas — 12 colores con contraste perceptual validado (ΔE mínimo entre pares)
  // Primera posición: paleta de marca Casux (índigo + complementarios)
  casux_cat:     ['#3d52a0','#e07b39','#4a9e6b','#c94f5a','#6ab0c8','#b5832a','#7c5c99','#2a6b55','#c05080','#2e7da6','#9b4d4d','#8db84a'],
  cat_tableau:   ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#d37295','#a0cbe8','#499894'],
  cat_bold:      ['#e6194b','#3cb44b','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6','#bfef45','#469990','#9a6324','#800000','#aaffc3'],
  cat_pastel:    ['#aec6cf','#ffb347','#b5ead7','#ff6961','#c3b1e1','#fdfd96','#77dd77','#ff9aa2','#ffc8a2','#ffe5b4','#ffd1dc','#e6e6fa'],
  cat_dark:      ['#1b4f72','#922b21','#1d6a39','#6c3483','#784212','#0e6655','#212f3d','#b7770d','#4a235a','#0d5f5f','#145a32','#641e16'],
  cat_earth:     ['#8b4513','#4a7c59','#c68642','#2f4858','#a0522d','#8fa97d','#d4955a','#2d6a4f','#e8c99a','#704214','#c5e0b4','#7b5e3a'],
  cat_vivid:     ['#ff595e','#ffca3a','#6a4c93','#1982c4','#8ac926','#ff924c','#c77dff','#2dc653','#118ab2','#06d6a0','#d62828','#f4d35e'],
};

// ── Paletas secuenciales ──────────────────────────────────────────
// 6 paletas × 8 colores, de claro (bajo) a oscuro/saturado (alto)

window.SEQ_PALETTES = {
  // Primera posición: paleta secuencial de marca Casux (crema → índigo profundo)
  casux_seq:     ['#eef1f9','#c8d0ea','#a3b2da','#7d93ca','#5a74b8','#3d52a0','#2d3d7a','#1d2850'],
  seq_blues:     ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#3182bd','#08519c','#08306b'],
  seq_greens:    ['#f7fcf5','#e5f5e0','#c7e9c0','#a1d99b','#74c476','#31a354','#006d2c','#00441b'],
  seq_oranges:   ['#fff5eb','#feedde','#fdd0a2','#fdae6b','#fd8d3c','#e6550d','#a63603','#7f2704'],
  seq_purples:   ['#fcfbfd','#efedf5','#dadaeb','#bcbddc','#9e9ac8','#756bb1','#54278f','#3f007d'],
  seq_redyellow: ['#ffffcc','#ffeda0','#fed976','#feb24c','#fd8d3c','#fc4e2a','#e31a1c','#800026'],
  seq_teal:      ['#f0f9e8','#ccebc5','#a8ddb5','#7bccc4','#4eb3d3','#2b8cbe','#0868ac','#084081'],
};

// Combinado para compatibilidad con código existente
window.PALETTES = {
  ...window.CAT_PALETTES,
  ...window.SEQ_PALETTES,
  // aliases legacy usados por el LLM
  qualitative: window.CAT_PALETTES.cat_tableau,
  blues:       window.SEQ_PALETTES.seq_blues,
  greens:      window.SEQ_PALETTES.seq_greens,
  oranges:     window.SEQ_PALETTES.seq_oranges,
  purples:     window.SEQ_PALETTES.seq_purples,
  redblue:     ['#b2182b','#d6604d','#f4a582','#fddbc7','#d1e5f0','#92c5de','#4393c3','#2166ac'],
  browngreen:  ['#8c510a','#bf812d','#dfc27d','#f6e8c3','#c7eae5','#80cdc1','#35978f','#01665e'],
};

window.PALETTE_LABELS = {
  casux_cat:     'Casux',
  casux_seq:     'Casux',
  cat_tableau:   'tableau',
  cat_bold:      'bold',
  cat_pastel:    'pastel',
  cat_dark:      'dark',
  cat_earth:     t('palette_tierra'),
  cat_vivid:     t('palette_vivida'),
  seq_blues:     t('palette_azules'),
  seq_greens:    t('palette_verdes'),
  seq_oranges:   t('palette_naranjas'),
  seq_purples:   t('palette_purpuras'),
  seq_redyellow: t('palette_rojo_amarillo'),
  seq_teal:      t('palette_teal'),
  // legacy
  qualitative: t('palette_cualitativa'),
  blues:       t('palette_azules'),
  greens:      t('palette_verdes'),
  oranges:     t('palette_naranjas'),
  purples:     t('palette_purpuras'),
  redblue:     t('palette_rojo_azul'),
  browngreen:  t('palette_marron_verde'),
};
