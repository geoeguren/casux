#!/usr/bin/env node
/**
 * scripts/generate-snapshots.js
 *
 * Genera snapshots GeoJSON simplificados de todas las capas visibles
 * del catálogo de Casux y los sube a Backblaze B2 (compatible con S3).
 *
 * Uso:
 *   node scripts/generate-snapshots.js           → todas las capas
 *   node scripts/generate-snapshots.js --source ign_ar  → solo una fuente
 *   node scripts/generate-snapshots.js --dry-run → sin subir, solo lista
 *   node scripts/generate-snapshots.js --force   → re-genera aunque ya exista
 *
 * Requiere en .env.local:
 *   B2_ENDPOINT, B2_BUCKET, B2_KEY_ID, B2_APP_KEY, B2_REGION
 *
 * Instalar dependencias una vez:
 *   npm install @aws-sdk/client-s3 @turf/simplify dotenv --save-dev
 */

'use strict';

const path    = require('path');
const fs      = require('fs');

// Cargar .env.local
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const simplify = require('@turf/simplify').default;

// ── Configuración B2 ──────────────────────────────────────────────

const B2 = new S3Client({
  endpoint:        `https://${process.env.B2_ENDPOINT}`,
  region:          process.env.B2_REGION,
  credentials: {
    accessKeyId:     process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
  forcePathStyle: true,  // requerido para B2
});

const BUCKET = process.env.B2_BUCKET;

// ── Argumentos CLI ────────────────────────────────────────────────

const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const FORCE      = args.includes('--force');
const sourceArg  = args.find(a => a.startsWith('--source'));
const ONLY_SOURCE = sourceArg ? sourceArg.split('=')[1] || args[args.indexOf(sourceArg) + 1] : null;

// ── Catálogo de fuentes ───────────────────────────────────────────

const SOURCES = {
  ign_ar:  { wfsBase: 'https://wms.ign.gob.ar/geoserver/ows',           wfsVersion: '1.1.0', type: 'wfs' },
  igm_uy:  { wfsBase: 'https://sig.igm.gub.uy/geoserver/wfs',           wfsVersion: '1.1.0', type: 'wfs' },
  mtop_uy: { wfsBase: 'https://geoservicios.mtop.gub.uy/geoserver/ows', wfsVersion: '1.1.0', type: 'wfs' },
  se_ar:   { wfsBase: 'https://mapa.educacion.gob.ar/geoserver/ows',    wfsVersion: '1.1.0', type: 'wfs' },
  ssa_ar:  { wfsBase: 'https://geo.ambiente.gob.ar/geoserver/ows',      wfsVersion: '1.1.0', type: 'wfs' },
  mop_cl:  { restBase: 'https://rest-sit.mop.gob.cl/arcgis/rest/services', type: 'rest' },
};

// ── Tolerancias de simplificación por tipo de geometría ──────────
// Valores en grados decimales (~0.001° ≈ 100m en latitudes medias)

const TOLERANCE = {
  polygon: 0.001,
  line:    0.0005,
  point:   null,   // los puntos no se simplifican
};

// ── Límites ───────────────────────────────────────────────────────

const DISPLAY_THRESHOLD = 55000;  // en sync con layers/index.js
const FETCH_TIMEOUT_MS  = 60000;  // 60s por capa
const CONCURRENCY       = 3;      // requests simultáneos

// ── Cargar capas del catálogo ─────────────────────────────────────

function loadLayers() {
  const layerFiles = [
    '../layers/ar/ign.js',
    '../layers/ar/se.js',
    '../layers/ar/ssa.js',
    '../layers/uy/igm.js',
    '../layers/uy/mtop.js',
    '../layers/cl/mop.js',
  ];

  const layers = [];

  for (const relPath of layerFiles) {
    const absPath = path.join(__dirname, relPath);
    if (!fs.existsSync(absPath)) {
      console.warn(`  ⚠ No encontrado: ${relPath}`);
      continue;
    }

    // Ejecutar el archivo como módulo CommonJS aislado
    // Los archivos usan module.exports o window.LAYERS — adaptamos
    const code = fs.readFileSync(absPath, 'utf8');

    // Convertir sintaxis de browser (window.LAYERS = {...}) a módulo
    const wrapped = code
      .replace(/window\.LAYERS\s*=\s*\{/, 'const _LAYERS = {')
      .replace(/window\.LAYERS\s*=\s*Object\.assign/, 'Object.assign(_LAYERS,')
      + '\nif (typeof module !== "undefined") module.exports = { _LAYERS };';

    try {
      const tmpFile = path.join(__dirname, '_tmp_layer.js');
      fs.writeFileSync(tmpFile, wrapped);
      const mod = require(tmpFile);
      fs.unlinkSync(tmpFile);
      // Limpiar cache de require para el archivo temporal
      delete require.cache[tmpFile];

      const layerMap = mod._LAYERS || mod;
      for (const [key, def] of Object.entries(layerMap)) {
        if (!def || typeof def !== 'object') continue;
        if (def.visible === false) continue;
        if (!def.typename) continue;
        if (!def.source) continue;
        if (ONLY_SOURCE && def.source !== ONLY_SOURCE) continue;

        // Excluir capas sin geometría real
        if (def.geomType === 'none' || def.geomType === 'unknown') continue;

        // Excluir capas que superan el display threshold
        if (def.featureCount != null && def.featureCount > DISPLAY_THRESHOLD) continue;

        layers.push({
          key,
          typename:     def.typename,
          source:       def.source,
          geomType:     def.geomType || 'polygon',
          featureCount: def.featureCount || null,
          filterField:  def.filterField || null,
          filterValues: def.filterValues || null,
        });
      }
    } catch (err) {
      console.warn(`  ⚠ Error parseando ${relPath}: ${err.message}`);
    }
  }

  return layers;
}

// ── Fetch WFS ─────────────────────────────────────────────────────

async function fetchWFS(source, typename, filterField, filterValues) {
  const src = SOURCES[source];
  const params = new URLSearchParams({
    service:      'WFS',
    version:      src.wfsVersion,
    request:      'GetFeature',
    typename,
    outputFormat: 'application/json',
    srsName:      'EPSG:4326',
  });

  if (filterField && filterValues?.length) {
    const values = filterValues.map(v => `'${v}'`).join(',');
    params.set('CQL_FILTER',
      filterValues.length === 1
        ? `${filterField}='${filterValues[0]}'`
        : `${filterField} IN (${values})`
    );
  }

  const url = `${src.wfsBase}?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (text.trimStart().startsWith('<')) throw new Error('Respuesta XML — posible error WFS');
    const geojson = JSON.parse(text);
    if (!geojson.features) throw new Error('Sin features en la respuesta');
    return geojson;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Fetch REST (ArcGIS) ───────────────────────────────────────────

async function fetchREST(source, typename) {
  const src = SOURCES[source];
  const url = `${src.restBase}/${typename}/query?` + new URLSearchParams({
    where:          '1=1',
    outFields:      '*',
    f:              'geojson',
    outSR:          '4326',
    returnGeometry: 'true',
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geojson = await resp.json();
    if (!geojson.features) throw new Error('Sin features en la respuesta REST');
    return geojson;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Simplificar GeoJSON ───────────────────────────────────────────

function simplifyGeoJSON(geojson, geomType) {
  const tolerance = TOLERANCE[geomType] || TOLERANCE.polygon;
  if (!tolerance) return geojson; // puntos: sin simplificación

  try {
    return simplify(geojson, { tolerance, highQuality: false, mutate: false });
  } catch {
    return geojson; // si falla la simplificación, devolver original
  }
}

// ── Subir a B2 ────────────────────────────────────────────────────

function r2Key(source, typename) {
  // Normalizar typename para usar como key de archivo
  // Ej: "ign:provincia" → "ign_ar/ign:provincia.geojson"
  const safe = typename.replace(/[\/\\]/g, '__');
  return `${source}/${safe}.geojson`;
}

async function existsInB2(key) {
  try {
    await B2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToB2(key, geojson) {
  const body = JSON.stringify(geojson);
  await B2.send(new PutObjectCommand({
    Bucket:       BUCKET,
    Key:          key,
    Body:         body,
    ContentType:  'application/geo+json',
    CacheControl: 'public, max-age=2592000', // 30 días
    Metadata: {
      'generated-at': new Date().toISOString(),
      'feature-count': String(geojson.features?.length || 0),
    },
  }));
}

// ── Procesar una capa ─────────────────────────────────────────────

async function processLayer(layer) {
  const key = r2Key(layer.source, layer.typename);
  const src = SOURCES[layer.source];

  if (!src) {
    return { key: layer.key, status: 'skip', reason: 'source desconocido' };
  }

  // Verificar si ya existe (skip si no --force)
  if (!FORCE && !DRY_RUN) {
    const exists = await existsInB2(key);
    if (exists) {
      return { key: layer.key, status: 'skip', reason: 'ya existe' };
    }
  }

  if (DRY_RUN) {
    return { key: layer.key, status: 'dry-run', b2Key: key, count: layer.featureCount };
  }

  // Fetch
  let geojson;
  try {
    if (src.type === 'wfs') {
      geojson = await fetchWFS(layer.source, layer.typename, layer.filterField, layer.filterValues);
    } else {
      geojson = await fetchREST(layer.source, layer.typename);
    }
  } catch (err) {
    return { key: layer.key, status: 'error', reason: `fetch: ${err.message}` };
  }

  const count = geojson.features?.length || 0;

  // Simplificar
  const simplified = simplifyGeoJSON(geojson, layer.geomType);

  // Subir
  try {
    await uploadToB2(key, simplified);
  } catch (err) {
    return { key: layer.key, status: 'error', reason: `upload: ${err.message}` };
  }

  const originalKB  = Math.round(JSON.stringify(geojson).length / 1024);
  const simplifiedKB = Math.round(JSON.stringify(simplified).length / 1024);

  return {
    key:    layer.key,
    status: 'ok',
    b2Key:  key,
    count,
    originalKB,
    simplifiedKB,
    saved:  Math.round((1 - simplifiedKB / originalKB) * 100) + '%',
  };
}

// ── Cola con concurrencia limitada ────────────────────────────────

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  Casux — Generación de snapshots WFS/REST → B2');
  console.log(`  Bucket: ${BUCKET}`);
  if (DRY_RUN)    console.log('  Modo: DRY-RUN (sin subir)');
  if (FORCE)      console.log('  Modo: FORCE (re-genera todo)');
  if (ONLY_SOURCE) console.log(`  Fuente: ${ONLY_SOURCE}`);
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  // Verificar credenciales
  if (!process.env.B2_KEY_ID || !process.env.B2_APP_KEY) {
    console.error('❌ Faltan variables B2_KEY_ID o B2_APP_KEY en .env.local');
    process.exit(1);
  }

  // Cargar catálogo
  console.log('📋 Cargando catálogo de capas…');
  const layers = loadLayers();
  console.log(`   ${layers.length} capas elegibles (visible:true, featureCount ≤ ${DISPLAY_THRESHOLD})`);
  console.log('');

  if (layers.length === 0) {
    console.log('No hay capas para procesar.');
    return;
  }

  // Agrupar por fuente para el log
  const bySource = {};
  for (const l of layers) {
    bySource[l.source] = (bySource[l.source] || 0) + 1;
  }
  for (const [src, count] of Object.entries(bySource)) {
    console.log(`   ${src.padEnd(12)} ${count} capas`);
  }
  console.log('');

  // Procesar
  const tasks = layers.map(layer => () => {
    process.stdout.write(`  ⏳ ${layer.key.slice(0, 60).padEnd(60)}\r`);
    return processLayer(layer);
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);

  // Resumen
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  Resultados');
  console.log('══════════════════════════════════════════════════════');

  const ok     = results.filter(r => r.status === 'ok');
  const skipped = results.filter(r => r.status === 'skip');
  const errors  = results.filter(r => r.status === 'error');
  const dryRuns = results.filter(r => r.status === 'dry-run');

  if (ok.length) {
    console.log(`\n  ✓ Subidos: ${ok.length}`);
    let totalOriginal = 0, totalSimplified = 0;
    for (const r of ok) {
      totalOriginal   += r.originalKB;
      totalSimplified += r.simplifiedKB;
      console.log(`    ${r.key.slice(0, 45).padEnd(45)} ${String(r.count).padStart(6)} features  ${r.originalKB}KB → ${r.simplifiedKB}KB (${r.saved})`);
    }
    console.log(`\n    Total: ${totalOriginal}KB → ${totalSimplified}KB (${Math.round((1 - totalSimplified/totalOriginal)*100)}% reducción)`);
  }

  if (skipped.length) {
    console.log(`\n  ↷ Saltados (ya existían): ${skipped.length}`);
  }

  if (dryRuns.length) {
    console.log(`\n  🔍 Dry-run — se procesarían ${dryRuns.length} capas:`);
    for (const r of dryRuns) {
      const count = r.count != null ? `${r.count} features` : 'count desconocido';
      console.log(`    ${r.key.slice(0, 50).padEnd(50)} ${count}`);
    }
  }

  if (errors.length) {
    console.log(`\n  ✗ Errores: ${errors.length}`);
    for (const r of errors) {
      console.log(`    ${r.key.slice(0, 45).padEnd(45)} ${r.reason}`);
    }
  }

  console.log('');
  const total = ok.length + errors.length + dryRuns.length;
  if (errors.length === 0) {
    console.log(`  ✅ ${total} capas procesadas sin errores`);
  } else {
    console.log(`  ⚠ ${total} capas procesadas, ${errors.length} con errores`);
  }
  console.log('══════════════════════════════════════════════════════');
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
