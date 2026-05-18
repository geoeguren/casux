/**
 * api/_wfs.js — Helper compartido: fetch WFS desde el servidor
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/clip.js, api/intersect.js y api/buffer.js.
 *
 * Construye la URL WFS con los parámetros recibidos y devuelve
 * el GeoJSON parseado. Sin caché — eso es responsabilidad del cliente.
 *
 * Timeout: 7 segundos (igual que el proxy LLM).
 * En Vercel Hobby el límite total de la función es 10s, así que
 * dejamos 3s de margen para el procesamiento posterior al fetch.
 */

const FETCH_TIMEOUT_MS = 7000;

// Mapa de host → campo de geometría.
// GeoServer usa "the_geom" por defecto; agregar excepciones si algún servidor difiere.
// Este mapa sirve también como lista de hosts WFS autorizados:
// cualquier wfsBase cuyo hostname no esté aquí es rechazado antes del fetch.
// Para agregar un servidor nuevo: incluirlo acá con su campo de geometría.
const GEOM_FIELD_BY_HOST = {
  'wms.ign.gob.ar':    'the_geom',
  'sig.igm.gub.uy':    'the_geom',
};

function _geomFieldForUrl(wfsBase) {
  try {
    const host = new URL(wfsBase).hostname;
    return GEOM_FIELD_BY_HOST[host] || 'the_geom';
  } catch {
    return 'the_geom';
  }
}

/**
 * fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox, geomField })
 *
 * Devuelve un GeoJSON FeatureCollection.
 * Lanza Error si el servidor WFS responde con error o si hay timeout.
 *
 * geomField: nombre del campo de geometría para BBOX() en CQL (default: 'the_geom').
 *   GeoServer rechaza CQL_FILTER y bbox como parámetros simultáneos; cuando ambos
 *   están presentes, el bbox se embebe dentro del CQL como BBOX(geomField,...).
 */
async function fetchWFS({ typename, wfsBase, wfsVersion, cqlFilter, bbox, geomField }) {
  if (!typename) throw new Error('[_wfs] typename requerido');
  if (!wfsBase)  throw new Error('[_wfs] wfsBase requerido');

  // Validar que el host esté en la lista de servidores autorizados.
  // Evita que un cliente malicioso apunte a hosts arbitrarios (SSRF).
  try {
    const host = new URL(wfsBase).hostname;
    if (!Object.prototype.hasOwnProperty.call(GEOM_FIELD_BY_HOST, host)) {
      const error = new Error(`Servidor WFS no autorizado: ${host}`);
      error.isExternalServerError = false;
      throw error;
    }
  } catch (err) {
    if (err.isExternalServerError === false) throw err;
    throw new Error('[_wfs] wfsBase inválida');
  }

  // Resolver campo de geometría: parámetro explícito > tabla por host > default
  const resolvedGeomField = geomField || _geomFieldForUrl(wfsBase);

  const params = new URLSearchParams({
    service:      'WFS',
    version:      wfsVersion || '1.1.0',
    request:      'GetFeature',
    typename,
    outputFormat: 'application/json',
    srsName:      'EPSG:4326',
  });

  if (bbox) {
    // GeoServer IGN/IGM no acepta CQL_FILTER y bbox como parámetros simultáneos.
    // Cuando hay filtro de atributos, embebemos el bbox en el CQL con BBOX().
    const bboxCql = `BBOX(${resolvedGeomField},${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},'EPSG:4326')`;
    if (cqlFilter) {
      params.set('CQL_FILTER', `(${cqlFilter}) AND ${bboxCql}`);
    } else {
      // Sin filtro de atributos: parámetro bbox nativo WFS (más eficiente)
      params.set('bbox', `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},EPSG:4326`);
    }
  } else if (cqlFilter) {
    params.set('CQL_FILTER', cqlFilter);
  }

  const url = `${wfsBase}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    const error = new Error(
      isTimeout
        ? 'El servidor de datos tardó demasiado en responder.'
        : 'No se pudo conectar con el servidor de datos.'
    );
    error.isExternalServerError = true;
    error.isTimeout = isTimeout;
    throw error;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const error = new Error('El servidor de datos devolvió un error. Intentá de nuevo más tarde.');
    error.isExternalServerError = true;
    throw error;
  }

  let geojson;
  try {
    geojson = await resp.json();
  } catch (err) {
    const error = new Error('La respuesta del servidor de datos no es válida.');
    error.isExternalServerError = true;
    throw error;
  }

  if (!geojson.features) {
    const error = new Error('El servidor no devolvió datos para esta capa.');
    error.isExternalServerError = true;
    throw error;
  }

  return geojson;
}

module.exports = { fetchWFS };
