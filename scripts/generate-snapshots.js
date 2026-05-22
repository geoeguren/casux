#!/usr/bin/env node
/**
 * scripts/generate-snapshots.js
 *
 * Genera snapshots GeoJSON de todas las capas visible:true del catálogo
 * y los sube a Backblaze B2. Sin simplificación — datos originales.
 *
 * Uso:
 *   node scripts/generate-snapshots.js           → todas las capas
 *   node scripts/generate-snapshots.js --source ign_ar
 *   node scripts/generate-snapshots.js --dry-run
 *   node scripts/generate-snapshots.js --force
 */

'use strict';

const path         = require('path');
const { execSync } = require('child_process');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') }); } catch {}

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// ── CLI ───────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const FORCE       = args.includes('--force');
const sourceIdx   = args.indexOf('--source');
const ONLY_SOURCE = sourceIdx !== -1 ? args[sourceIdx + 1] : null;

// ── B2 ────────────────────────────────────────────────────────────

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

const DISPLAY_THRESHOLD  = 55000;
const FETCH_TIMEOUT_MS   = 120000;
const WFS_PAGE_SIZE      = 5000;   // features por página en WFS paginado
const REST_PAGE_SIZE     = 2000;   // features por página en REST
const CONCURRENCY        = 3;

// ── Fuentes ───────────────────────────────────────────────────────

const SOURCES = {
  ign_ar:  { wfsBase: 'https://wms.ign.gob.ar/geoserver/ows',           wfsVersion: '1.1.0', type: 'wfs' },
  igm_uy:  { wfsBase: 'https://sig.igm.gub.uy/geoserver/wfs',           wfsVersion: '1.1.0', type: 'wfs' },
  mtop_uy: { wfsBase: 'https://geoservicios.mtop.gub.uy/geoserver/ows', wfsVersion: '1.1.0', type: 'wfs' },
  se_ar:   { wfsBase: 'https://mapa.educacion.gob.ar/geoserver/ows',    wfsVersion: '1.1.0', type: 'wfs' },
  ssa_ar:  { wfsBase: 'https://geo.ambiente.gob.ar/geoserver/ows',      wfsVersion: '1.1.0', type: 'wfs' },
  mop_cl:  { restBase: 'https://rest-sit.mop.gob.cl/arcgis/rest/services', type: 'rest' },
};

// Capas con error conocido no recuperable del lado del servidor
// ArcGIS "Error performing query operation" = restricción del servidor, no recuperable
const SKIP_LIST = new Set([
  'DGA_Decretos_Escasez_Hidrica_MapServer_0_cl',  // ArcGIS query error
  'IDE_MOP_INFRA_MOP_ONEMI_MapServer_7_cl',        // ArcGIS query error
  'MAPA_BASE_LIMITES_MapServer_0_cl',              // timeout recurrente
  'MAPA_BASE_LIMITES_MapServer_1_cl',              // ArcGIS query error
  'MAPA_BASE_LIMITES_MapServer_2_cl',              // ArcGIS query error
]);

// ── Catálogo ──────────────────────────────────────────────────────

function loadLayers() {
  const exportScript = path.join(__dirname, 'export-catalog.mjs');
  const raw = execSync(`node ${exportScript}`, {
    encoding: 'utf8', timeout: 30000,
    cwd: path.join(__dirname, '..'),
  });
  const catalog = JSON.parse(raw);

  return Object.entries(catalog)
    .filter(([key, def]) => {
      if (!def.visible) return false;
      if (!def.typename || !def.source) return false;
      if (ONLY_SOURCE && def.source !== ONLY_SOURCE) return false;
      if (!SOURCES[def.source]) return false;
      if (def.geomType === 'none' || def.geomType === 'unknown') return false;
      if (def.featureCount != null && def.featureCount > DISPLAY_THRESHOLD) return false;
      if (SKIP_LIST.has(key)) return false;
      return true;
    })
    .map(([key, def]) => ({
      key,
      typename:     def.typename,
      source:       def.source,
      geomType:     def.geomType || 'polygon',
      featureCount: def.featureCount,
      // Sin filtros — fetchear la capa completa siempre
    }));
}

// ── Fetch WFS con paginación ──────────────────────────────────────
// Para capas grandes (>WFS_PAGE_SIZE features) usa startIndex para
// evitar que el servidor devuelva JSON malformado/cortado.

async function fetchWFSPage(wfsBase, wfsVersion, typename, startIndex, maxFeatures) {
  const params = new URLSearchParams({
    service:      'WFS',
    version:      wfsVersion,
    request:      'GetFeature',
    typename,
    outputFormat: 'application/json',
    srsName:      'EPSG:4326',
    maxFeatures,
    startIndex,
  });

  const url   = `${wfsBase}?${params.toString()}`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (text.trimStart().startsWith('<')) throw new Error('Respuesta XML del WFS');
    const geojson = JSON.parse(text);
    if (!Array.isArray(geojson.features)) throw new Error('Sin features');
    return geojson;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchWFS(source, typename, featureCount) {
  const src = SOURCES[source];

  // Si la capa es pequeña o no conocemos el count → fetch directo sin paginación
  const needsPagination = featureCount != null && featureCount > WFS_PAGE_SIZE;

  if (!needsPagination) {
    return fetchWFSPage(src.wfsBase, src.wfsVersion, typename, 0, 10000);
  }

  // Paginación: fetch en páginas de WFS_PAGE_SIZE
  // Si el servidor no soporta startIndex devuelve XML — en ese caso
  // caemos a fetch directo sin paginación (algunos servidores WFS 1.1.0
  // no implementan startIndex correctamente).
  const pages    = Math.ceil(featureCount / WFS_PAGE_SIZE);
  const allFeats = [];

  for (let i = 0; i < pages; i++) {
    const startIndex = i * WFS_PAGE_SIZE;
    let page;
    try {
      page = await fetchWFSPage(src.wfsBase, src.wfsVersion, typename, startIndex, WFS_PAGE_SIZE);
    } catch (err) {
      if (i === 0 && err.message.includes('XML')) {
        // El servidor no soporta startIndex — fetch directo sin paginación
        console.warn(`[WFS] ${typename}: startIndex no soportado, fetch directo`);
        return fetchWFSPage(src.wfsBase, src.wfsVersion, typename, 0, featureCount + 1000);
      }
      throw err;
    }
    allFeats.push(...page.features);
    if (page.features.length < WFS_PAGE_SIZE) break;
  }

  return { type: 'FeatureCollection', features: allFeats };
}

// ── Conversión Esri JSON → GeoJSON ────────────────────────────────

function esriGeomToGeoJSON(esriGeom, geomType) {
  if (!esriGeom) return null;
  if (geomType === 'esriGeometryPoint')
    return { type: 'Point', coordinates: [esriGeom.x, esriGeom.y] };
  if (geomType === 'esriGeometryPolyline') {
    const paths = esriGeom.paths || [];
    return paths.length === 1
      ? { type: 'LineString',      coordinates: paths[0] }
      : { type: 'MultiLineString', coordinates: paths };
  }
  if (geomType === 'esriGeometryPolygon') {
    const rings = esriGeom.rings || [];
    return rings.length === 1
      ? { type: 'Polygon',      coordinates: rings }
      : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) };
  }
  return null;
}

function esriToGeoJSON(json) {
  const geomType = json.geometryType;
  return {
    type: 'FeatureCollection',
    features: (json.features || []).map(f => ({
      type:       'Feature',
      geometry:   esriGeomToGeoJSON(f.geometry, geomType),
      properties: f.attributes || {},
    })),
  };
}

// ── Fetch REST con paginación y fallback f=json ───────────────────
// Igual que rest.js: intenta f=geojson, si da 400 → f=json (Esri JSON).
// Pagina automáticamente si hay más features que REST_PAGE_SIZE.

const _geojsonSupport = new Map(); // restBase → true/false

async function fetchRESTPage(restBase, typename, offset, count) {
  const baseParams = {
    where: '1=1', outFields: '*', outSR: '4326',
    returnGeometry: 'true',
    resultOffset:      offset,
    resultRecordCount: count,
  };

  const supportsGeoJSON = _geojsonSupport.get(restBase);

  if (supportsGeoJSON !== false) {
    const url  = `${restBase}/${typename}/query?` + new URLSearchParams({ ...baseParams, f: 'geojson' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.status === 400) {
        _geojsonSupport.set(restBase, false);
        // caer al fallback f=json abajo
      } else {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (json.error) throw new Error(`ArcGIS error: ${json.error.message}`);
        _geojsonSupport.set(restBase, true);
        return json;
      }
    } catch (err) {
      clearTimeout(timer);
      if (!err.message.includes('HTTP 400')) throw err;
      _geojsonSupport.set(restBase, false);
    }
  }

  // Fallback: f=json (Esri JSON)
  const url  = `${restBase}/${typename}/query?` + new URLSearchParams({ ...baseParams, f: 'json' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const resp  = await fetch(url, { signal: ctrl.signal });
  clearTimeout(timer);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(`ArcGIS error: ${json.error.message}`);
  return esriToGeoJSON(json);
}

async function fetchREST(source, typename, featureCount) {
  const src = SOURCES[source];

  // Intentar obtener el count real del servidor si no lo tenemos
  let total = featureCount;
  if (total == null) {
    try {
      const countUrl = `${src.restBase}/${typename}/query?` + new URLSearchParams({
        where: '1=1', returnCountOnly: 'true', f: 'json',
      });
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const resp  = await fetch(countUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.count === 'number') total = data.count;
      }
    } catch { /* continuar sin count */ }
  }

  // Sin paginación para capas pequeñas
  if (total == null || total <= REST_PAGE_SIZE) {
    const page = await fetchRESTPage(src.restBase, typename, 0, REST_PAGE_SIZE);
    return page;
  }

  // Paginación paralela
  const pages    = Math.ceil(total / REST_PAGE_SIZE);
  const offsets  = Array.from({ length: pages }, (_, i) => ({
    off:   i * REST_PAGE_SIZE,
    count: Math.min(REST_PAGE_SIZE, total - i * REST_PAGE_SIZE),
  }));

  const results  = await Promise.all(
    offsets.map(({ off, count }) => fetchRESTPage(src.restBase, typename, off, count))
  );
  const features = results.flatMap((r, i) => r.features.slice(0, offsets[i].count));
  return { type: 'FeatureCollection', features };
}

// ── B2 helpers ────────────────────────────────────────────────────

function b2Key(source, typename) {
  return `${source}/${typename.replace(/[\/\\]/g, '__')}.geojson`;
}

async function existsInB2(key) {
  try { await B2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function uploadToB2(key, body) {
  await B2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body,
    ContentType:  'application/geo+json',
    CacheControl: 'public, max-age=2592000',
    Metadata:     { 'generated-at': new Date().toISOString() },
  }));
}

// ── Procesar capa ─────────────────────────────────────────────────

async function processLayer(layer) {
  const key = b2Key(layer.source, layer.typename);

  if (!FORCE && !DRY_RUN && await existsInB2(key))
    return { key: layer.key, status: 'skip' };

  if (DRY_RUN)
    return { key: layer.key, status: 'dry-run', b2Key: key, count: layer.featureCount };

  let body, count;
  try {
    const src = SOURCES[layer.source];
    const geojson = src.type === 'wfs'
      ? await fetchWFS(layer.source, layer.typename, layer.featureCount)
      : await fetchREST(layer.source, layer.typename, layer.featureCount);
    count = geojson.features?.length || 0;
    body  = JSON.stringify(geojson);
  } catch (err) {
    return { key: layer.key, status: 'error', reason: `fetch: ${err.message}` };
  }

  const sizeKB = Math.round(body.length / 1024);

  try {
    await uploadToB2(key, body);
  } catch (err) {
    return { key: layer.key, status: 'error', reason: `upload: ${err.message}` };
  }

  return { key: layer.key, status: 'ok', b2Key: key, count, sizeKB };
}

// ── Concurrencia ──────────────────────────────────────────────────

async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) { const idx = i++; results[idx] = await tasks[idx](); }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Casux — Generación de snapshots WFS/REST → B2');
  console.log(`  Bucket: ${BUCKET}`);
  if (DRY_RUN)     console.log('  Modo: DRY-RUN');
  if (FORCE)       console.log('  Modo: FORCE (re-genera todo)');
  if (ONLY_SOURCE) console.log(`  Fuente: ${ONLY_SOURCE}`);
  console.log('══════════════════════════════════════════════════════\n');

  if (!process.env.B2_KEY_ID || !process.env.B2_APP_KEY) {
    console.error('❌ Faltan variables B2_KEY_ID o B2_APP_KEY'); process.exit(1);
  }

  console.log('📋 Cargando catálogo…');
  const layers = loadLayers();

  const bySource = {};
  for (const l of layers) bySource[l.source] = (bySource[l.source] || 0) + 1;
  for (const [src, n] of Object.entries(bySource))
    console.log(`   ${src.padEnd(12)} ${n} capas`);
  console.log(`   ─────────────────`);
  console.log(`   Total: ${layers.length} capas elegibles`);
  console.log(`   Excluidas: ${SKIP_LIST.size} por error conocido del servidor\n`);

  if (!layers.length) { console.log('No hay capas para procesar.'); return; }

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
    let totalKB = 0;
    console.log(`\n  ✓ Subidos: ${ok.length}`);
    for (const r of ok) {
      totalKB += r.sizeKB;
      console.log(`    ${r.key.slice(0,50).padEnd(50)} ${String(r.count).padStart(6)} feat  ${r.sizeKB}KB`);
    }
    console.log(`\n    Total subido: ${Math.round(totalKB / 1024)}MB`);
  }

  if (skipped.length) console.log(`\n  ↷ Saltados (ya existían): ${skipped.length}`);

  if (dryRuns.length) {
    console.log(`\n  🔍 Dry-run — se procesarían ${dryRuns.length} capas`);
    for (const r of dryRuns)
      console.log(`    ${r.key.slice(0,55).padEnd(55)} ${r.count ?? '?'} features`);
  }

  if (errors.length) {
    console.log(`\n  ✗ Errores: ${errors.length}`);
    for (const r of errors)
      console.log(`    ${r.key.slice(0,50).padEnd(50)} ${r.reason}`);
  }

  const total = ok.length + errors.length + dryRuns.length;
  console.log(`\n  ${errors.length === 0 ? '✅' : '⚠'} ${total} procesadas${errors.length ? `, ${errors.length} con errores` : ''}`);
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('\n❌ Error fatal:', err.message); process.exit(1); });
