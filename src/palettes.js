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
// 6 paletas × 8 colores, cada una con contraste perceptual entre valores

window.CAT_PALETTES = {
  cat_tableau:   ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7'],
  cat_bold:      ['#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00','#a65628','#f781bf','#999999'],
  cat_pastel:    ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5'],
  cat_dark:      ['#1b6ca8','#c0392b','#27ae60','#8e44ad','#d35400','#16a085','#2c3e50','#7f8c8d'],
  cat_earth:     ['#a6611a','#dfc27d','#80cdc1','#018571','#d8b365','#5ab4ac','#762a83','#e9a3c9'],
  cat_vivid:     ['#ff0000','#00b4d8','#06d6a0','#ffbe0b','#8338ec','#fb5607','#3a86ff','#ff006e'],
};

// ── Paletas secuenciales ──────────────────────────────────────────
// 6 paletas × 8 colores, de claro (bajo) a oscuro/saturado (alto)

window.SEQ_PALETTES = {
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
