/**
 * api/adjacent.js — Serverless Function de Vercel
 *
 * Features que comparten borde o están a ≤ 0km de un área de referencia.
 *
 * Formas de request:
 *   { typename, wfsBase, wfsVersion?, restBase?, cqlFilter?, whereClause?,
 *     exclude?: boolean,
 *     mask: GeoJSON             ← área de referencia inline
 *     maskInstructions: {...}   ← alternativa a mask inline
 *   }
 *
 * exclude: false → features que SON adyacentes (tocan el borde)
 * exclude: true  → features que NO son adyacentes
 *
 * Criterio de adyacencia:
 *   - Puntos:    estar dentro del área (mismo criterio que intersect/clip)
 *   - Líneas:    al menos un vértice toca o está sobre el borde del área
 *   - Polígonos: booleanTouches (comparten borde) OR tienen intersección real
 *               con área > 0 (se solapan parcialmente)
 *
 * Diferencia con intersect:
 *   intersect: devuelve features que se solapan con el área interior
 *   adjacent:  devuelve features que tocan el BORDE del área
 *              (pueden estar adentro o afuera, lo que importa es el contacto)
 *
 * Nota: para capas de polígonos la distinción práctica es sutil — la mayoría
 * de los casos de uso son "provincias que limitan con X" donde el borde
 * compartido es lo relevante.
 */

const { fetchWFS }    = require('./_wfs');
const { fetchREST }   = require('./_rest');
const { checkOrigin } = require('./_cors');
const { normalizarMascara } = require('./_geo');
const {
  booleanPointInPolygon,
  intersect,
  booleanTouches,
} = require('./_turf');

// ── Criterio de adyacencia ────────────────────────────────────────

function esAdyacente(feat, maskNormalizada) {
  const geomType = feat.geometry?.type;
  if (!geomType) return false;

  try {
    if (geomType === 'Point') {
      // Puntos: adyacente si está sobre el borde o dentro
      return booleanPointInPolygon(feat, maskNormalizada, { ignoreBoundary: false });
    }

    if (geomType === 'MultiPoint') {
      return feat.geometry.coordinates.some(c =>
        booleanPointInPolygon(
          { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
          maskNormalizada,
          { ignoreBoundary: false }
        )
      );
    }

    if (geomType === 'LineString' || geomType === 'MultiLineString') {
      // Líneas: al menos un vértice sobre el borde o dentro
      const coords = geomType === 'LineString'
        ? feat.geometry.coordinates
        : feat.geometry.coordinates.flat();
      return coords.some(c =>
        booleanPointInPolygon(
          { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
          maskNormalizada,
          { ignoreBoundary: false }
        )
      );
    }

    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      // Polígonos: booleanTouches (comparten borde sin solaparse)
      // OR tienen intersección real (se solapan — también son "adyacentes" en sentido práctico)
      try {
        if (booleanTouches(feat, maskNormalizada)) return true;
      } catch {}
      // Fallback: intersect con área > 0
      try {
        const inter = intersect(feat, maskNormalizada);
        return inter !== null && inter !== undefined;
      } catch {}
    }
  } catch {}

  return false;
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {

    const {
      layer, typename, wfsBase, wfsVersion, restBase, cqlFilter, whereClause,
      exclude, mask, maskInstructions,
    } = req.body || {};

    const isExclude = !!exclude;

    if (!mask && !maskInstructions) {
      return res.status(400).json({ error: 'Se requiere "mask" o "maskInstructions"' });
    }
    if (!layer && !typename) {
      return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });
    }

    // Fetchear la capa — adjacent_exclude necesita todos los features (sin bbox)
    // adjacent puede usar bbox del área de referencia como pre-filtro
    let maskFeatureRaw;
    if (maskInstructions) {
      const maskGeoJSON = await fetchWFS({
        typename:   maskInstructions.typename,
        wfsBase:    maskInstructions.wfsBase,
        wfsVersion: maskInstructions.wfsVersion,
        cqlFilter:  maskInstructions.cqlFilter,
      });
      maskFeatureRaw = maskGeoJSON.features?.[0];
      if (!maskFeatureRaw) return res.status(400).json({ error: 'La máscara no devolvió features' });
    } else {
      maskFeatureRaw = mask.features?.[0] || mask;
    }

    const maskNormalizada = normalizarMascara(maskFeatureRaw);

    // Pre-filtro bbox solo para adjacent (no exclude)
    let fetchBbox;
    if (!isExclude) {
      const geom = maskNormalizada.geometry;
      if (geom) {
        const coords = geom.type === 'Polygon'
          ? geom.coordinates.flat()
          : geom.type === 'MultiPolygon'
            ? geom.coordinates.flat(2)
            : [];
        if (coords.length) {
          const lons = coords.map(c => c[0]);
          const lats = coords.map(c => c[1]);
          fetchBbox = {
            minX: Math.min(...lons),
            minY: Math.min(...lats),
            maxX: Math.max(...lons),
            maxY: Math.max(...lats),
          };
        }
      }
    }

    let layerGeoJSON = layer;
    if (!layerGeoJSON) {
      if (restBase) {
        layerGeoJSON = await fetchREST({ typename, restBase, whereClause, bbox: fetchBbox });
      } else {
        layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: fetchBbox });
      }
    }

    const result = [];
    for (const feat of layerGeoJSON.features || []) {
      try {
        const adj = esAdyacente(feat, maskNormalizada);
        if (isExclude ? !adj : adj) result.push(feat);
      } catch {}
    }

    console.log(`[api/adjacent] ${layerGeoJSON.features?.length} → ${result.length} features (exclude: ${isExclude})`);
    return res.status(200).json({ type: 'FeatureCollection', features: result });

  } catch (err) {
    console.error('[api/adjacent] Error:', err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
