/**
 * api/intersect.js — Serverless Function de Vercel
 *
 * Acepta dos formas de request:
 *
 *   Forma nueva (camino principal — el servidor busca los datos):
 *     { typename, wfsBase, wfsVersion?, cqlFilter?, bbox?, mask: GeoJSON }
 *
 *   Forma vieja (fallback — el cliente manda los datos inline):
 *     { layer: GeoJSON, mask: GeoJSON }
 *
 * Devuelve: features COMPLETAS que tocan el área (sin recortar)
 *
 * A diferencia de clip.js, no recorta la geometría — devuelve cada
 * feature íntegra si tiene al menos un punto dentro del polígono máscara.
 *
 * Usa los mismos módulos individuales de Turf que clip.js para evitar
 * la dependencia de concaveman (ESM-only, incompatible con CommonJS de Vercel).
 *
 * Filtro de overlap mínimo:
 *   - Líneas:    ≥ 10% de la longitud total debe caer dentro de la máscara.
 *   - Polígonos: ≥ 5%  del área total debe solaparse con la máscara.
 *   - Puntos:    sin umbral (un punto o está adentro o no).
 * Esto evita que features que apenas rozan el borde del área de recorte
 * aparezcan en el resultado.
 */

const { fetchWFS }                              = require('./_wfs');
const { checkOrigin }                           = require('./_cors');
const { normalizarMascara, areaGeometria }      = require('./_geo');
const { booleanPointInPolygon, bbox, intersect } = require('./_turf');

// Umbrales de overlap minimo
// Porcentaje de la geometria del feature que debe quedar dentro de la
// mascara para que el feature sea incluido en el resultado.
//   - Lineas: 10% — evita rutas que apenas cruzan un limite provincial.
//   - Poligonos: 5% — criterio mas permisivo porque areas grandes que
//     cruzan un limite suelen ser relevantes aunque el overlap sea pequeno.
const OVERLAP_LINE_MIN    = 0.10;
const OVERLAP_POLYGON_MIN = 0.05;

// Helpers geometricos sin dependencias extra

/**
 * Distancia Haversine entre dos puntos [lng, lat] en metros.
 */
function haversine([lng1, lat1], [lng2, lat2]) {
  const R  = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlam = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Longitud total de un array de coordenadas [lng, lat] en metros.
 */
function longitudRing(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/**
 * Calcula que fraccion de la longitud de una linea cae dentro de la mascara.
 * Estrategia: por cada segmento, el punto medio determina si el segmento
 * esta "dentro". Es mas estable que contar vertices, porque un vertice
 * exactamente en el borde puede quedar dentro o fuera segun precision numerica.
 */
function fraccionLineaDentro(coords, maskNormalizada) {
  if (coords.length < 2) return 0;
  let total  = 0;
  let dentro = 0;

  for (let i = 1; i < coords.length; i++) {
    const segLen = haversine(coords[i - 1], coords[i]);
    total += segLen;

    // Punto medio del segmento como proxy de "esta dentro"
    const mid = [
      (coords[i - 1][0] + coords[i][0]) / 2,
      (coords[i - 1][1] + coords[i][1]) / 2,
    ];
    const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
    if (booleanPointInPolygon(midPt, maskNormalizada)) {
      dentro += segLen;
    }
  }

  return total > 0 ? dentro / total : 0;
}

/**
 * Calcula que fraccion del area de un poligono se solapa con la mascara.
 * Usa turf/intersect (ya disponible) para obtener el poligono de interseccion
 * y compara su area con la del feature original.
 */
function fraccionPoligonoDentro(feat, maskNormalizada) {
  try {
    const resultado = intersect(feat, maskNormalizada);
    if (!resultado) return 0;
    const areaInterseccion = areaGeometria(resultado.geometry);
    const areaTotal        = areaGeometria(feat.geometry);
    return areaTotal > 0 ? areaInterseccion / areaTotal : 0;
  } catch {
    return 0;
  }
}

/**
 * Determina si un feature supera el umbral de overlap con la mascara.
 * Para puntos: booleanPointInPolygon (sin umbral).
 * Para lineas: >= OVERLAP_LINE_MIN de longitud dentro.
 * Para poligonos: >= OVERLAP_POLYGON_MIN de area dentro.
 * Devuelve el feature original integro (no recortado) si supera el umbral.
 */
function tocaMascara(feat, maskNormalizada) {
  const geomType = feat.geometry?.type;
  if (!geomType) return false;

  try {
    // Puntos
    if (geomType === 'Point') {
      return booleanPointInPolygon(feat, maskNormalizada);
    }

    if (geomType === 'MultiPoint') {
      return feat.geometry.coordinates.some(coord => {
        const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} };
        return booleanPointInPolygon(pt, maskNormalizada);
      });
    }

    // Lineas: fraccion de longitud dentro de la mascara >= 10%
    if (geomType === 'LineString') {
      const fraccion = fraccionLineaDentro(feat.geometry.coordinates, maskNormalizada);
      return fraccion >= OVERLAP_LINE_MIN;
    }

    if (geomType === 'MultiLineString') {
      // Fraccion ponderada por longitud de cada sub-linea
      let totalLen  = 0;
      let dentroLen = 0;
      for (const ring of feat.geometry.coordinates) {
        const len = longitudRing(ring);
        totalLen  += len;
        dentroLen += fraccionLineaDentro(ring, maskNormalizada) * len;
      }
      const fraccion = totalLen > 0 ? dentroLen / totalLen : 0;
      return fraccion >= OVERLAP_LINE_MIN;
    }

    // Poligonos: fraccion de area dentro de la mascara >= 5%
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      const fraccion = fraccionPoligonoDentro(feat, maskNormalizada);
      return fraccion >= OVERLAP_POLYGON_MIN;
    }

  } catch {
    // Feature rota o geometria invalida — omitir de forma segura
  }

  return false;
}

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {

  const { layer, mask, maskInstructions, typename, wfsBase, wfsVersion, cqlFilter, bbox: bboxParam } = req.body || {};

  if (!mask && !maskInstructions) return res.status(400).json({ error: 'Se requiere "mask" o "maskInstructions"' });
  if (!layer && !typename) return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });

  let layerGeoJSON = layer;
  if (!layerGeoJSON) {
    layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox: bboxParam });
  }

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
  const intersected     = [];

  for (const feat of layerGeoJSON.features || []) {
    try {
      if (tocaMascara(feat, maskNormalizada)) {
        intersected.push(feat);
      }
    } catch { /* feature individual rota — omitir */ }
  }

  return res.status(200).json({
    type:     'FeatureCollection',
    features: intersected,
  });

  } catch (err) {
    // Error no manejado — fetchWFS timeout, IGN caído, etc.
    // Devolver JSON con error en lugar de dejar que Vercel retorne un 500 vacío.
    console.error(`[api/intersect] Error:`, err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
