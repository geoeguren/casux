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
 * Requiere en .env.local (local) o secrets (GitHub Actions):
 *   B2_ENDPOINT, B2_BUCKET, B2_KEY_ID, B2_APP_KEY, B2_REGION
 */

'use strict';

const path    = require('path');
const { execSync } = require('child_process');

// Cargar .env.local si existe (local) — en Actions las vars vienen de secrets
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
} catch { /* dotenv opcional */ }

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// ── Argumentos CLI ────────────────────────────────────────────────

const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const FORCE       = args.includes('--force');
const sourceIdx   = args.indexOf('--source');
const ONLY_SOURCE = sourceIdx !== -1 ? args[sourceIdx + 1] : null;

// ── Configuración B2 ──────────────────────────────────────────────

const B2 = new S3Client({
  endpoint:    `https://${process.env.B2_ENDPOINT}`,
  region:      process.env.B2_REGION,
  credentials: {
    accessKeyId:     process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.B2_BUCKET;

// ── Límites ───────────────────────────────────────────────────────

const DISPLAY_THRESHOLD = 55000;
const FETCH_TIMEOUT_MS  = 60000;
const CONCURRENCY       = 3;

// ── Fuentes ───────────────────────────────────────────────────────

const SOURCES = {
  ign_ar:  { wfsBase: 'https://wms.ign.gob.ar/geoserver/ows',           wfsVersion: '1.1.0', type: 'wfs' },
  igm_uy:  { wfsBase: 'https://sig.igm.gub.uy/geoserver/wfs',           wfsVersion: '1.1.0', type: 'wfs' },
  mtop_uy: { wfsBase: 'https://geoservicios.mtop.gub.uy/geoserver/ows', wfsVersion: '1.1.0', type: 'wfs' },
  se_ar:   { wfsBase: 'https://mapa.educacion.gob.ar/geoserver/ows',    wfsVersion: '1.1.0', type: 'wfs' },
  ssa_ar:  { wfsBase: 'https://geo.ambiente.gob.ar/geoserver/ows',      wfsVersion: '1.1.0', type: 'wfs' },
  mop_cl:  { restBase: 'https://rest-sit.mop.gob.cl/arcgis/rest/services', type: 'rest' },
};

// ── Tolerancias de simplificación ────────────────────────────────

const TOLERANCE = {
  polygon: 0.001,
  line:    0.0005,
  point:   null,
};

// ── Cargar catálogo via export-catalog.mjs ────────────────────────

function loadLayers() {
  const exportScript = path.join(__dirname, 'export-catalog.mjs');

  let raw;
  try {
    raw = execSync(`node ${exportScript}`, {
      encoding: 'utf8',
      timeout:  30000,
      cwd: path.join(__dirname, '..'),
    });
  } catch (err) {
    throw new Error(`Error ejecutando export-catalog.mjs: ${err.message}`);
  }

  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch {
    throw new Error('export-catalog.mjs devolvió JSON inválido');
  }

  const layers = [];
  for (const [key, def] of Object.entries(catalog)) {
    if (!def.visible) continue;
    if (!def.typename || !def.source) continue;
    if (ONLY_SOURCE && def.source !== ONLY_SOURCE) continue;
    if (!SOURCES[def.source]) continue;
    if (def.geomType === 'none' || def.geomType === 'unknown') continue;
    if (def.featureCount != null && def.featureCount > DISPLAY_THRESHOLD) continue;

    layers.push({
      key,
      typename:     def.typename,
      source:       def.source,
      geomType:     def.geomType || 'polygon',
      featureCount: def.featureCount,
      filterField:  def.filterField,
      filterValues: def.filterValues,
    });
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
    params.set('CQL_FILTER',
      filterValues.length === 1
        ? `${filterField}='${filterValues[0]}'`
        : `${filterField} IN (${filterValues.map(v => `'${v}'`).join(',')})`
    );
  }

  const url  = `${src.wfsBase}?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (text.trimStart().startsWith('<')) throw new Error('Respuesta XML del WFS');
    const geojson = JSON.parse(text);
    if (!geojson.features) throw new Error('Sin features');
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
    where: '1=1', outFields: '*', f: 'geojson',
    outSR: '4326', returnGeometry: 'true',
    resultRecordCount: '2000',
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geojson = await resp.json();
    if (!geojson.features) throw new Error('Sin features REST');
    return geojson;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Simplificar ───────────────────────────────────────────────────

function simplifyGeoJSON(geojson, geomType) {
  const tolerance = TOLERANCE[geomType];
  if (!tolerance) return geojson;

  // Simplificación manual sin @turf/simplify para evitar dependencias pesadas
  // Algoritmo: reducir vértices por distancia mínima entre puntos consecutivos
  function simplifyCoords(coords) {
    if (coords.length <= 2) return coords;
    const result = [coords[0]];
    for (let i = 1; i < coords.length - 1; i++) {
      const prev = result[result.length - 1];
      const curr = coords[i];
      const dx = Math.abs(curr[0] - prev[0]);
      const dy = Math.abs(curr[1] - prev[1]);
      if (dx > tolerance || dy > tolerance) result.push(curr);
    }
    result.push(coords[coords.length - 1]);
    return result.length >= 2 ? result : coords;
  }

  function simplifyGeom(geom) {
    if (!geom) return geom;
    switch (geom.type) {
      case 'LineString':
        return { ...geom, coordinates: simplifyCoords(geom.coordinates) };
      case 'MultiLineString':
        return { ...geom, coordinates: geom.coordinates.map(simplifyCoords) };
      case 'Polygon':
        return { ...geom, coordinates: geom.coordinates.map(simplifyCoords) };
      case 'MultiPolygon':
        return { ...geom, coordinates: geom.coordinates.map(p => p.map(simplifyCoords)) };
      default:
        return geom;
    }
  }

  return {
    ...geojson,
    features: geojson.features.map(f => ({ ...f, geometry: simplifyGeom(f.geometry) })),
  };
}

// ── B2 helpers ────────────────────────────────────────────────────

function b2Key(source, typename) {
  return `${source}/${typename.replace(/[\/\\]/g, '__')}.geojson`;
}

async function existsInB2(key) {
  try {
    await B2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function uploadToB2(key, geojson) {
  await B2.send(new PutObjectCommand({
    Bucket:       BUCKET,
    Key:          key,
    Body:         JSON.stringify(geojson),
    ContentType:  'application/geo+json',
    CacheControl: 'public, max-age=2592000',
    Metadata:     { 'generated-at': new Date().toISOString(), 'feature-count': String(geojson.features?.length || 0) },
  }));
}

// ── Procesar capa ─────────────────────────────────────────────────

async function processLayer(layer) {
  const key = b2Key(layer.source, layer.typename);

  if (!FORCE && !DRY_RUN) {
    if (await existsInB2(key)) return { key: layer.key, status: 'skip' };
  }

  if (DRY_RUN) return { key: layer.key, status: 'dry-run', b2Key: key, count: layer.featureCount };

  let geojson;
  try {
    const src = SOURCES[layer.source];
    geojson = src.type === 'wfs'
      ? await fetchWFS(layer.source, layer.typename, layer.filterField, layer.filterValues)
      : await fetchREST(layer.source, layer.typename);
  } catch (err) {
    return { key: layer.key, status: 'error', reason: `fetch: ${err.message}` };
  }

  const count        = geojson.features?.length || 0;
  const simplified   = simplifyGeoJSON(geojson, layer.geomType);
  const originalKB   = Math.round(JSON.stringify(geojson).length / 1024);
  const simplifiedKB = Math.round(JSON.stringify(simplified).length / 1024);

  try {
    await uploadToB2(key, simplified);
  } catch (err) {
    return { key: layer.key, status: 'error', reason: `upload: ${err.message}` };
  }

  return {
    key: layer.key, status: 'ok', b2Key: key, count,
    originalKB, simplifiedKB,
    saved: originalKB > 0 ? Math.round((1 - simplifiedKB / originalKB) * 100) + '%' : '0%',
  };
}

// ── Concurrencia ──────────────────────────────────────────────────

async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Casux — Generación de snapshots WFS/REST → B2');
  console.log(`  Bucket: ${BUCKET}`);
  if (DRY_RUN)     console.log('  Modo: DRY-RUN (sin subir)');
  if (FORCE)       console.log('  Modo: FORCE (re-genera todo)');
  if (ONLY_SOURCE) console.log(`  Fuente: ${ONLY_SOURCE}`);
  console.log('══════════════════════════════════════════════════════\n');

  if (!process.env.B2_KEY_ID || !process.env.B2_APP_KEY) {
    console.error('❌ Faltan variables B2_KEY_ID o B2_APP_KEY');
    process.exit(1);
  }

  console.log('📋 Cargando catálogo de capas…');
  const layers = loadLayers();
  console.log(`   ${layers.length} capas elegibles (visible:true, featureCount ≤ ${DISPLAY_THRESHOLD})\n`);

  if (!layers.length) { console.log('No hay capas para procesar.'); return; }

  // Log por fuente
  const bySource = {};
  for (const l of layers) bySource[l.source] = (bySource[l.source] || 0) + 1;
  for (const [src, n] of Object.entries(bySource)) console.log(`   ${src.padEnd(12)} ${n} capas`);
  console.log('');

  const tasks   = layers.map(layer => () => {
    process.stdout.write(`  ⏳ ${layer.key.slice(0, 65).padEnd(65)}\r`);
    return processLayer(layer);
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  console.log('');

  const ok      = results.filter(r => r.status === 'ok');
  const skipped = results.filter(r => r.status === 'skip');
  const errors  = results.filter(r => r.status === 'error');
  const dryRuns = results.filter(r => r.status === 'dry-run');

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Resultados');
  console.log('══════════════════════════════════════════════════════');

  if (ok.length) {
    let totOrig = 0, totSimp = 0;
    console.log(`\n  ✓ Subidos: ${ok.length}`);
    for (const r of ok) {
      totOrig += r.originalKB; totSimp += r.simplifiedKB;
      console.log(`    ${r.key.slice(0,45).padEnd(45)} ${String(r.count).padStart(6)} feat  ${r.originalKB}KB→${r.simplifiedKB}KB (${r.saved})`);
    }
    console.log(`\n    Total: ${totOrig}KB → ${totSimp}KB (${Math.round((1-totSimp/totOrig)*100)}% reducción)`);
  }

  if (skipped.length) console.log(`\n  ↷ Saltados (ya existían): ${skipped.length}`);

  if (dryRuns.length) {
    console.log(`\n  🔍 Dry-run — se procesarían ${dryRuns.length} capas:`);
    for (const r of dryRuns) console.log(`    ${r.key.slice(0,55).padEnd(55)} ${r.count != null ? r.count + ' features' : '?'}`);
  }

  if (errors.length) {
    console.log(`\n  ✗ Errores: ${errors.length}`);
    for (const r of errors) console.log(`    ${r.key.slice(0,45).padEnd(45)} ${r.reason}`);
  }

  const total = ok.length + errors.length + dryRuns.length;
  console.log(`\n  ${errors.length === 0 ? '✅' : '⚠'} ${total} capas procesadas${errors.length ? `, ${errors.length} con errores` : ' sin errores'}`);
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('\n❌ Error fatal:', err.message); process.exit(1); });
