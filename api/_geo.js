/**
 * api/_geo.js — Helpers geométricos compartidos entre endpoints espaciales
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/clip_exclude.js, api/intersect.js
 * y api/intersect_exclude.js.
 *
 * Para agregar un helper nuevo: agregarlo acá y exportarlo.
 * No agregar lógica específica de un solo endpoint — eso va en el archivo propio.
 */

const { union } = require('./_turf');

/**
 * normalizarMascara(maskFeature) → Feature<Polygon>
 *
 * Prepara la máscara geométrica para las operaciones espaciales del servidor.
 * Realiza dos transformaciones en orden:
 *
 * 1. UNIÓN DE MULTIPOLYGON:
 *    Si la máscara es MultiPolygon (ej: Santa Cruz con 37 subpolígonos),
 *    une todos los subpolígonos en un Polygon único usando @turf/union.
 *    Necesario porque @turf/intersect y @turf/boolean-point-in-polygon
 *    funcionan mejor con un Polygon simple que con un MultiPolygon complejo.
 *
 * 2. SIMPLIFICACIÓN DE GEOMETRÍA:
 *    Reduce la cantidad de vértices del polígono usando el algoritmo
 *    Douglas-Peucker con tolerancia SIMPLIFY_TOLERANCE_DEG (~1km).
 *
 *    POR QUÉ: el cliente manda el polígono completo del WFS (ej: Buenos Aires
 *    con ~50.000 vértices). Procesar clip/intersect contra esa geometría
 *    en el servidor es extremadamente lento y causa timeouts de 90s+.
 *    Con la máscara simplificada, la misma operación tarda 2-5s.
 *
 *    IMPACTO EN EL RESULTADO: mínimo. Una tolerancia de ~1km en el borde
 *    de la máscara no cambia visualmente qué features quedan dentro o fuera.
 *    La geometría de los FEATURES RESULTANTES (rutas, ríos, etc.) permanece
 *    completamente intacta — solo el molde del corte es simplificado.
 *
 *    DEUDA TÉCNICA: esta simplificación es un workaround. La solución
 *    definitiva es que el cliente mande solo las instrucciones de la máscara
 *    (maskInstructions: { layerKey, field, value }) y el servidor resuelva
 *    el polígono él mismo con su propia normalización — evitando el envío
 *    del GeoJSON pesado por completo. Ver TODO en spatial-clip.js,
 *    spatial-intersect.js y spatial-buffer.js.
 *
 * En caso de error en cualquier paso, devuelve el feature original
 * sin modificar para no bloquear la operación.
 */

// Tolerancia de simplificación en grados decimales.
// 0.01° ≈ 1.1km en el ecuador, ~800m en latitud -40° (Patagonia).
// Suficiente para preservar la forma visual de cualquier provincia argentina.
const SIMPLIFY_TOLERANCE_DEG = 0.01;

// Cuenta mínima de vértices para activar la simplificación.
// Polígonos pequeños (< 500 vértices) no necesitan simplificación.
const SIMPLIFY_MIN_VERTICES = 500;

function contarVertices(feature) {
  const g = feature.geometry;
  if (!g) return 0;
  const rings = g.type === 'Polygon'
    ? g.coordinates
    : g.type === 'MultiPolygon'
      ? g.coordinates.flat()
      : [];
  return rings.reduce((sum, ring) => sum + ring.length, 0);
}

/**
 * douglasPeucker(points, tolerance) → points[]
 * Implementación del algoritmo Douglas-Peucker para simplificar líneas.
 * Recibe y devuelve arrays de [lng, lat].
 */
function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;

  // Encontrar el punto más lejano de la línea start→end
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  let maxDist = 0;
  let maxIdx  = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    // Distancia perpendicular del punto a la línea
    const dist = len === 0
      ? Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
      : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];

  const left  = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
  const right = douglasPeucker(points.slice(maxIdx), tolerance);
  return [...left.slice(0, -1), ...right];
}

function simplificarRing(ring, tolerance) {
  const simplified = douglasPeucker(ring, tolerance);
  // Un anillo válido necesita al menos 4 puntos (3 únicos + cierre)
  if (simplified.length < 4) return ring;
  // Asegurar que el anillo esté cerrado
  const first = simplified[0];
  const last  = simplified[simplified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([...first]);
  return simplified;
}

function simplificarGeometria(geom, tolerance) {
  if (geom.type === 'Polygon') {
    return {
      ...geom,
      coordinates: geom.coordinates.map(ring => simplificarRing(ring, tolerance)),
    };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      ...geom,
      coordinates: geom.coordinates.map(poly =>
        poly.map(ring => simplificarRing(ring, tolerance))
      ),
    };
  }
  return geom;
}

function normalizarMascara(maskFeature) {
  let resultado = maskFeature;

  // Paso 1: Unir MultiPolygon en Polygon único
  if (resultado.geometry?.type === 'MultiPolygon') {
    try {
      const poligonos = resultado.geometry.coordinates.map(coords => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: coords },
        properties: {},
      }));
      resultado = poligonos.reduce((acc, feat) => union(acc, feat));
    } catch {
      // Si falla la unión, continuar con el feature original
    }
  }

  // Paso 2: Simplificar si tiene demasiados vértices
  // (ver comentario de DEUDA TÉCNICA arriba)
  const vertexCount = contarVertices(resultado);
  if (vertexCount >= SIMPLIFY_MIN_VERTICES) {
    try {
      const geomSimplificada = simplificarGeometria(resultado.geometry, SIMPLIFY_TOLERANCE_DEG);
      const vertexCountPost  = contarVertices({ geometry: geomSimplificada });
      console.log(`[_geo] Máscara simplificada: ${vertexCount} → ${vertexCountPost} vértices (tolerancia ${SIMPLIFY_TOLERANCE_DEG}°)`);
      resultado = { ...resultado, geometry: geomSimplificada };
    } catch {
      // Si falla la simplificación, continuar con la geometría original
    }
  }

  return resultado;
}

/**
 * areaRing(coords) → number (m²)
 *
 * Área aproximada de un anillo de coordenadas [lng, lat] en m²,
 * usando la fórmula de Gauss en proyección esférica (shoelace).
 * Suficientemente precisa para comparación relativa de overlap.
 *
 * Fuente canónica: importar desde acá en clip.js, clip_exclude.js,
 * intersect.js e intersect_exclude.js. No duplicar.
 */
function areaRing(coords) {
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    area += (lng2 - lng1) * Math.PI / 180 *
      (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs(area) * R * R / 2;
}

/**
 * areaFeature(feat) → number (m²)
 *
 * Área total de un Feature Polygon o MultiPolygon en m².
 * Solo usa el anillo exterior de cada parte (suficiente para overlap relativo).
 * Usado en clip.js y clip_exclude.js.
 */
function areaFeature(feat) {
  const g = feat.geometry;
  if (!g) return 0;
  if (g.type === 'Polygon')      return areaRing(g.coordinates[0] || []);
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + areaRing(p[0] || []), 0);
  return 0;
}

/**
 * areaGeometria(geom) → number (m²)
 *
 * Igual que areaFeature pero recibe una geometry directa (sin wrapper Feature).
 * Usado en intersect.js e intersect_exclude.js, que trabajan con geometrías
 * extraídas del resultado de turf/intersect.
 */
function areaGeometria(geom) {
  if (!geom) return 0;
  if (geom.type === 'Polygon')      return areaRing(geom.coordinates[0] || []);
  if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((s, p) => s + areaRing(p[0] || []), 0);
  return 0;
}

module.exports = { normalizarMascara, areaRing, areaFeature, areaGeometria };
