/**
 * api/buffer.js — Serverless Function de Vercel
 *
 * Acepta dos formas de request:
 *
 *   Forma nueva (camino principal — el servidor busca los datos y genera el buffer):
 *     { typename, wfsBase, wfsVersion?, cqlFilter?,
 *       bufferFeature: GeoJSON,   ← feature central (ej: punto de Rosario)
 *       distanceKm: number,
 *       exclude?: boolean }
 *
 *   Forma vieja (fallback — el cliente manda los datos inline):
 *     { layer: GeoJSON, buffer: GeoJSON, exclude?: boolean }
 *
 * exclude: false (default) → features DENTRO del área de influencia (buffer)
 * exclude: true            → features FUERA del área de influencia (buffer_exclude)
 *
 * Con exclude:false el servidor usa el bbox del círculo como pre-filtro WFS.
 * Con exclude:true el bbox no se usa — se necesitan todos los features para
 * poder devolver los que quedan fuera.
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
 * Para líneas: al menos un vértice dentro (misma lógica que el original).
 * Para polígonos: cualquier intersección geométrica.
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

  const { layer, buffer, typename, wfsBase, wfsVersion, cqlFilter, bufferFeature, distanceKm, exclude } = req.body || {};
  const isExclude = !!exclude;

  // ── Resolver el polígono de área de influencia ────────────────

  let bufferPolygon;

  if (buffer) {
    bufferPolygon = buffer;
  } else if (bufferFeature && distanceKm) {
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
  // exclude:false → bbox del círculo como pre-filtro (trae solo lo que puede estar adentro)
  // exclude:true  → sin bbox, se necesitan TODOS los features de la capa

  let layerGeoJSON = layer;
  if (!layerGeoJSON) {
    if (!typename) return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });
    let fetchBbox;
    if (!isExclude) {
      const [minX, minY, maxX, maxY] = turfBbox(bufferPolygon);
      fetchBbox = { minX, minY, maxX, maxY };
    }
    layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: fetchBbox });
  }

  const bufferFeatureResolved = bufferPolygon.features?.[0] || bufferPolygon;
  const bufferNormalizado     = normalizarBuffer(bufferFeatureResolved);
  const result                = [];

  for (const feat of layerGeoJSON.features || []) {
    try {
      const dentro = dentroDelBuffer(feat, bufferNormalizado);
      if (isExclude ? !dentro : dentro) result.push(feat);
    } catch { /* feature individual rota — omitir */ }
  }

  return res.status(200).json({
    type:     'FeatureCollection',
    features: result,
  });

  } catch (err) {
    console.error(`[api/buffer] Error:`, err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
