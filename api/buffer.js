/**
 * api/buffer.js — Serverless Function de Vercel
 *
 * Acepta dos formas de request:
 *
 *   Forma nueva (camino principal — el servidor busca los datos y genera el buffer):
 *     { typename, wfsBase, wfsVersion?, cqlFilter?,
 *       bufferFeature: GeoJSON,   ← feature central (ej: punto de Rosario)
 *       distanceKm: number }
 *
 *   Forma vieja (fallback — el cliente manda los datos inline):
 *     { layer: GeoJSON, buffer: GeoJSON }  ← buffer ya calculado por el cliente
 *
 * En la forma nueva, el servidor:
 *   1. Genera el polígono circular con @turf/buffer
 *   2. Calcula el bbox del círculo
 *   3. Hace el fetch WFS de la capa con ese bbox como pre-filtro
 *   4. Filtra las features dentro del área de influencia
 *
 * Devuelve: features COMPLETAS dentro del área de influencia (sin recortar).
 *
 * El filtro espacial es idéntico a intersect.js — el buffer se trata
 * como cualquier polígono máscara.
 *
 * Separado de intersect.js para mantener semántica clara en los logs
 * y poder divergir el comportamiento en el futuro si hace falta.
 */

const { fetchWFS } = require('./_wfs');
const { checkOrigin } = require('./_cors');
const { booleanPointInPolygon, intersect, union, turfBuffer, bbox: turfBbox } = require('./_turf');

/**
 * Normaliza la geometría del buffer: si es MultiPolygon, une en uno.
 * El buffer generado por turf.buffer siempre debería ser Polygon simple,
 * pero lo normalizamos por seguridad.
 */
function normalizarBuffer(bufferFeature) {
  if (bufferFeature.geometry?.type !== 'MultiPolygon') return bufferFeature;
  try {
    const poligonos = bufferFeature.geometry.coordinates.map(coords => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: coords },
      properties: {},
    }));
    return poligonos.reduce((acc, feat) => union(acc, feat));
  } catch {
    return bufferFeature;
  }
}

/**
 * Determina si un feature toca el área de influencia.
 * Lógica idéntica a intersect.js — el buffer se trata como cualquier polígono máscara.
 */
function dentroDelBuffer(feat, bufferNormalizado) {
  const geomType = feat.geometry?.type;
  if (!geomType) return false;

  try {
    if (geomType === 'Point') {
      return booleanPointInPolygon(feat, bufferNormalizado);
    }

    if (geomType === 'MultiPoint') {
      return feat.geometry.coordinates.some(coord => {
        const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} };
        return booleanPointInPolygon(pt, bufferNormalizado);
      });
    }

    if (geomType === 'LineString' || geomType === 'MultiLineString') {
      const coordsList = geomType === 'LineString'
        ? feat.geometry.coordinates
        : feat.geometry.coordinates.flat();
      return coordsList.some(coord => {
        const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} };
        return booleanPointInPolygon(pt, bufferNormalizado);
      });
    }

    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      const result = intersect(feat, bufferNormalizado);
      return result !== null && result !== undefined;
    }
  } catch {
    // Feature rota o geometría inválida — omitir de forma segura
  }

  return false;
}

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {

  const { layer, buffer, typename, wfsBase, wfsVersion, cqlFilter, bufferFeature, distanceKm } = req.body || {};

  // ── Resolver el polígono de área de influencia ────────────────
  //
  // Forma vieja: buffer ya viene calculado desde el cliente.
  // Forma nueva: bufferFeature es el feature central (ej: punto de Rosario)
  //              y el servidor genera el círculo con @turf/buffer.

  let bufferPolygon;

  if (buffer) {
    // Forma vieja: usar el polígono que mandó el cliente directamente
    bufferPolygon = buffer;
  } else if (bufferFeature && distanceKm) {
    // Forma nueva: generar el polígono circular en el servidor
    if (!typename) return res.status(400).json({ error: 'Se requiere "typename" en la forma nueva' });
    try {
      bufferPolygon = turfBuffer(bufferFeature, distanceKm, { units: 'kilometers' });
      if (!bufferPolygon) throw new Error('turfBuffer devolvió null');
    } catch (err) {
      return res.status(400).json({ error: `No se pudo generar el buffer: ${err.message}` });
    }
  } else {
    return res.status(400).json({ error: 'Se requiere "buffer" o ("bufferFeature" + "distanceKm")' });
  }

  // ── Resolver la capa a filtrar ────────────────────────────────
  //
  // Forma vieja: layer viene inline desde el cliente.
  // Forma nueva: el servidor hace el fetch WFS usando el bbox del buffer como pre-filtro.

  let layerGeoJSON = layer;
  if (!layerGeoJSON) {
    if (!typename) return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });
    // Calcular bbox del polígono de buffer para pre-filtrar el fetch WFS
    const [minX, minY, maxX, maxY] = turfBbox(bufferPolygon);
    layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: { minX, minY, maxX, maxY } });
  }

  const bufferFeatureResolved = bufferPolygon.features?.[0] || bufferPolygon;
  const bufferNormalizado     = normalizarBuffer(bufferFeatureResolved);
  const filtered              = [];

  for (const feat of layerGeoJSON.features || []) {
    try {
      if (dentroDelBuffer(feat, bufferNormalizado)) {
        filtered.push(feat);
      }
    } catch { /* feature individual rota — omitir */ }
  }

  return res.status(200).json({
    type:     'FeatureCollection',
    features: filtered,
  });

  } catch (err) {
    // Error no manejado — fetchWFS timeout, IGN caído, etc.
    // Devolver JSON con error en lugar de dejar que Vercel retorne un 500 vacío.
    console.error(`[api/buffer] Error:`, err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
