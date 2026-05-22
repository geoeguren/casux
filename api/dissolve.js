/**
 * api/dissolve.js — Serverless Function de Vercel
 *
 * Une features de una capa en un único polígono (dissolve / dissolve_exclude).
 *
 * Formas de request:
 *
 *   dissolve (une un subconjunto por filtro):
 *     { typename, wfsBase, wfsVersion?, restBase?, cqlFilter?, whereClause? }
 *     → fetchea la capa (con filtro si aplica) y une todos los features en uno
 *
 *   dissolve_exclude (une los features FUERA de un área geográfica):
 *     { typename, wfsBase, wfsVersion?, restBase?, cqlFilter?, whereClause?,
 *       exclude: true,
 *       mask: GeoJSON  ← área a excluir (el resultado NO incluye features de esta área)
 *       maskInstructions: { typename, wfsBase, cqlFilter } ← alternativa a mask inline
 *     }
 *     → fetchea TODOS los features, excluye los que están dentro del área, une el resto
 *
 * Casos de uso:
 *   dissolve:         "uní las provincias patagónicas en una sola forma"
 *   dissolve_exclude: "uní todas las provincias menos las de la Patagonia"
 *
 * Nota sobre dissolve con filtro por atributo:
 *   "uní las provincias de la región cuyana" → el LLM genera un cqlFilter
 *   como "region='Cuyo'" y op: 'dissolve' (sin exclude). El servidor fetchea
 *   solo esas provincias y las une. No hay área de exclusión.
 *
 * TODO (Paso 3 — dissolve post-operación):
 *   Agregar dissolveAfter + dissolveField a clip.js e intersect.js para resolver
 *   el problema de tramos fraccionados (ej: rutas divididas por segmentos).
 */

const { fetchWFS }                = require('./_wfs');
const { fetchREST }               = require('./_rest');
const { checkOrigin }             = require('./_cors');
const { normalizarMascara }       = require('./_geo');
const { booleanPointInPolygon,
        union }                   = require('./_turf');

// ── Helpers ───────────────────────────────────────────────────────

/**
 * featuresEnMascara(features, maskNormalizada) → Set de índices
 * Devuelve los índices de features que están DENTRO del área de exclusión.
 * Usado solo en dissolve_exclude.
 */
function featuresEnMascara(features, maskNormalizada) {
  const dentro = new Set();
  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    const geom = feat.geometry?.type;
    if (!geom) continue;
    try {
      if (geom === 'Point') {
        if (booleanPointInPolygon(feat, maskNormalizada)) dentro.add(i);
      } else if (geom === 'MultiPoint') {
        if (feat.geometry.coordinates.some(c =>
          booleanPointInPolygon(
            { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} },
            maskNormalizada
          )
        )) dentro.add(i);
      } else {
        // Líneas y polígonos: usar centroide como aproximación
        // (dissolve opera sobre áreas administrativas — el centroide es suficiente)
        const coords = geom === 'Polygon'
          ? feat.geometry.coordinates[0]
          : geom === 'MultiPolygon'
            ? feat.geometry.coordinates[0][0]
            : geom === 'LineString'
              ? feat.geometry.coordinates
              : feat.geometry.coordinates[0];
        if (!coords?.length) continue;
        const midIdx = Math.floor(coords.length / 2);
        const midPt  = { type: 'Feature', geometry: { type: 'Point', coordinates: coords[midIdx] }, properties: {} };
        if (booleanPointInPolygon(midPt, maskNormalizada)) dentro.add(i);
      }
    } catch { /* feature rota — ignorar */ }
  }
  return dentro;
}

/**
 * dissolverFeatures(features) → Feature | null
 * Une todos los features en uno solo usando union iterado.
 * Solo opera sobre polígonos — líneas y puntos se devuelven sin unir.
 * Devuelve null si no hay features válidos.
 */
function dissolverFeatures(features) {
  // Filtrar solo polígonos — dissolve tiene sentido para áreas
  const poligonos = features.filter(f => {
    const t = f.geometry?.type;
    return t === 'Polygon' || t === 'MultiPolygon';
  });

  if (!poligonos.length) {
    // Si no hay polígonos, devolver los features tal cual (líneas, puntos)
    // El dissolve de puntos/líneas no tiene sentido geométrico pero no bloqueamos
    return null;
  }

  if (poligonos.length === 1) return poligonos[0];

  try {
    return poligonos.reduce((acc, feat) => {
      try { return union(acc, feat); }
      catch { return acc; } // si un feature es inválido, ignorarlo
    });
  } catch (err) {
    throw new Error(`Error al unir features: ${err.message}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {

    const {
      layer,           // GeoJSON inline (forma vieja — fallback)
      typename,
      wfsBase,
      wfsVersion,
      restBase,
      cqlFilter,
      whereClause,
      exclude,         // true → dissolve_exclude
      mask,            // GeoJSON del área a excluir (dissolve_exclude)
      maskInstructions // instrucciones para que el servidor fetchee la máscara
    } = req.body || {};

    const isExclude = !!exclude;

    if (!layer && !typename) {
      return res.status(400).json({ error: 'Se requiere "layer" o "typename"' });
    }

    if (isExclude && !mask && !maskInstructions) {
      return res.status(400).json({ error: 'dissolve_exclude requiere "mask" o "maskInstructions"' });
    }

    // 1. Fetchear la capa completa (dissolve siempre necesita todos los features)
    let layerGeoJSON = layer;
    if (!layerGeoJSON) {
      if (restBase) {
        layerGeoJSON = await fetchREST({ typename, restBase, whereClause });
      } else {
        layerGeoJSON = await fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter });
      }
    }

    const features = layerGeoJSON.features || [];
    if (!features.length) {
      return res.status(200).json({ type: 'FeatureCollection', features: [] });
    }

    // 2. Para dissolve_exclude: resolver la máscara y filtrar los features dentro
    let featuresADisolver = features;

    if (isExclude) {
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
      const dentroSet       = featuresEnMascara(features, maskNormalizada);

      // Excluir los features que están dentro del área
      featuresADisolver = features.filter((_, i) => !dentroSet.has(i));

      if (!featuresADisolver.length) {
        return res.status(200).json({ type: 'FeatureCollection', features: [] });
      }
    }

    // 3. Disolver (unir) los features
    const resultado = dissolverFeatures(featuresADisolver);

    if (!resultado) {
      // No había polígonos — devolver features sin unir
      return res.status(200).json({
        type:     'FeatureCollection',
        features: featuresADisolver,
      });
    }

    // Preservar propiedades del primer feature como referencia
    if (!resultado.properties || Object.keys(resultado.properties).length === 0) {
      resultado.properties = featuresADisolver[0]?.properties || {};
    }

    console.log(`[api/dissolve] OK: ${features.length} features → 1 feature disuelto (exclude: ${isExclude})`);

    return res.status(200).json({
      type:     'FeatureCollection',
      features: [resultado],
    });

  } catch (err) {
    console.error('[api/dissolve] Error:', err.message);
    const status = err.isExternalServerError ? 504 : 500;
    return res.status(status).json({ error: err.message });
  }
};
