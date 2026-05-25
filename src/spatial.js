/**
 * spatial.js — Orquestador de operaciones espaciales
 *
 * Único punto de entrada para todas las operaciones espaciales.
 * Reemplaza a src/clip.js y se expone como window.SPATIAL.
 *
 * Lee el campo `op` de la instrucción y delega al módulo correcto:
 *
 *   Operaciones existentes:
 *   'clip'               → src/spatial-clip.js       (recorte geométrico dentro de un área)
 *   'clip_exclude'       → src/spatial-clip.js       (recorte geométrico fuera de un área)
 *   'intersect'          → src/spatial-intersect.js  (features completas que tocan el área)
 *   'intersect_exclude'  → src/spatial-intersect.js  (features completas que NO tocan el área)
 *   'buffer'             → redirigido a within_layer  (retrocompatibilidad — ver switch)
 *   'buffer_exclude'     → redirigido a within_layer_exclude (ídem)
 *   undefined            → 'clip' (retrocompatibilidad con instrucciones antiguas)
 *
 *   Operaciones nuevas:
 *   'dissolve'           → src/spatial-dissolve.js   (une features en un único polígono)
 *   'dissolve_exclude'   → src/spatial-dissolve.js   (une features fuera de un área)
 *   'within_layer'       → src/spatial-within_layer.js (features a ≤ X km de referencia)
 *   'within_layer_exclude' → src/spatial-within_layer.js (features a > X km)
 *   'adjacent'           → src/spatial-adjacent.js   (features que comparten borde)
 *   'adjacent_exclude'   → src/spatial-adjacent.js   (features que NO comparten borde)
 *   'nearest'            → src/spatial-nearest.js    (los N features más cercanos)
 *   'nearest_exclude'    → src/spatial-nearest.js    (los N más lejanos)
 *
 * Estructura de la instrucción según op:
 *
 *   clip / clip_exclude / (sin op):
 *     { layerKey, filtro, clipArea: { layerKey, field, value } | null, descripcion }
 *
 *   intersect / intersect_exclude:
 *     { op, layerKey, filtro, intersectArea: { layerKey, field, value }, descripcion }
 *
 *   buffer / buffer_exclude (DEPRECADO — usar within_layer):
 *     { op, layerKey, filtro, bufferArea: { layerKey, field, value, distanceKm }, descripcion }
 *
 *   dissolve:
 *     { op: 'dissolve', layerKey, filtro }
 *     filtro (cqlFilter/whereClause) permite disolver un subconjunto:
 *     ej: "une las provincias patagónicas" → filtro: "region='Patagonia'"
 *
 *   dissolve_exclude:
 *     { op: 'dissolve_exclude', layerKey, filtro,
 *       dissolveArea: { layerKey, field, value } }
 *     → une los features que quedan FUERA del área
 *
 *   within_layer / within_layer_exclude:
 *     { op, layerKey, filtro,
 *       withinArea?: { layerKey, field?, value? },  ← capa/área de referencia
 *       withinPoint?: { lat, lng },                  ← punto de referencia
 *       withinDistance: number }                     ← km
 *
 *   adjacent / adjacent_exclude:
 *     { op, layerKey, filtro,
 *       adjacentArea: { layerKey, field, value } }
 *
 *   nearest / nearest_exclude:
 *     { op, layerKey, filtro,
 *       nearestArea?: { layerKey, field?, value? },
 *       nearestPoint?: { lat, lng },
 *       nearestCount?: number }                      ← default: 1
 *
 * Dependencias (deben cargarse antes en index.html):
 *   window.WFS, window.LAYERS, window.SOURCES, window.TOAST, window.t
 *   window._SPATIAL_UTILS
 *   window._SPATIAL_CLIP, window._SPATIAL_INTERSECT
 *   window._SPATIAL_DISSOLVE
 *   window._SPATIAL_WITHIN_LAYER
 *   window._SPATIAL_ADJACENT
 *   window._SPATIAL_NEAREST
 */

window.SPATIAL = (() => {

  // ── Resolver fuente WFS ───────────────────────────────────────

  function resolverFuente(layerDef, layerKey) {
    const sourceKey = layerDef.source;
    const source    = sourceKey && window.SOURCES?.[sourceKey];
    if (!source) {
      throw new Error(`[SPATIAL] Fuente "${sourceKey}" no encontrada en window.SOURCES (capa: ${layerKey}).`);
    }
    return source;
  }

  function buildWfsOpts(source, layerDef) {
    if (source.tipo === 'arcgis') {
      return {
        restBase: source.restBase,
        tituloUI: layerDef?.tituloUI,
      };
    }
    return {
      wfsBase:    source.wfsBase,
      wfsVersion: source.wfsVersion || '1.1.0',
      tituloUI:   layerDef?.tituloUI,
    };
  }

  // Devuelve el fetcher correcto según el protocolo de la fuente.
  // Interfaz uniforme: fetcher(source).fetch(typename, opts) → GeoJSON
  function fetcher(source) {
    return source.tipo === 'arcgis' ? window.REST : window.WFS;
  }

  // ── Resolver el feature de área (máscara, intersect o buffer) ─

  /**
   * Busca en GEO_MAPS el valor canónico WFS para un value dado.
   * Evita fallbacks LIKE cuando el LLM escribe el nombre diferente al WFS.
   * Ej: "Ciudad Autónoma de Buenos Aires" → "Ciudad de Buenos Aires"
   */
  function normalizarValueDesdeGeoMaps(layerKey, value) {
    const geoMaps = window.GEO_MAPS || {};
    const valueNorm = window._SPATIAL_UTILS.normalizar(value);
    for (const tipos of Object.values(geoMaps)) {
      for (const mapaMeta of Object.values(tipos)) {
        if (mapaMeta.layerKey !== layerKey) continue;
        const entrada = mapaMeta.valores?.[valueNorm];
        if (!entrada) continue;
        // Entrada única → devolver value canónico (acepta { value } u objeto string legacy)
        if (!Array.isArray(entrada)) return typeof entrada === 'string' ? entrada : entrada.value;
        // Entrada ambigua → tomar el más corto (más específico) como fallback
        return entrada.reduce((a, b) => a.value.length <= b.value.length ? a : b).value;
      }
    }
    return value; // sin cambios si no encontró
  }

  /**
   * Dado un descriptor de área { layerKey, field, value }, obtiene
   * el feature GeoJSON correspondiente del servidor WFS.
   * value puede ser un string o un array de strings para múltiples áreas
   * (ej: ["Córdoba", "San Luis", "Mendoza"]). En ese caso, se resuelven
   * todos y se unen en un único feature antes de devolver.
   * Usado por clip, intersect y buffer — los tres necesitan esta pieza.
   */
  async function resolverAreaFeature(areaDesc, opLabel) {
    // Si value es array, resolver cada uno en paralelo y unir
    if (Array.isArray(areaDesc.value)) {
      const features = await Promise.all(
        areaDesc.value.map(v => resolverAreaFeature({ ...areaDesc, value: v }, opLabel))
      );
      if (features.length === 1) return features[0];
      // Unir todos los features en uno solo usando el Worker/Turf union
      return window._SPATIAL_UTILS.unionFeatures(features);
    }

    const { layerKey, field } = areaDesc;
    // Normalizar el value contra GEO_MAPS antes de ir al servidor
    const value = normalizarValueDesdeGeoMaps(layerKey, areaDesc.value);
    const maskDef = window.LAYERS[layerKey];
    if (!maskDef) {
      throw new Error(`[SPATIAL:${opLabel}] Capa de área desconocida: "${layerKey}"`);
    }

    const maskSource  = resolverFuente(maskDef, layerKey);
    const maskWfsOpts = buildWfsOpts(maskSource);
    const maskFetcher = fetcher(maskSource);
    const isArcgis    = maskSource.tipo === 'arcgis';

    // Helpers para construir el filtro correcto según el motor:
    //   ArcGIS REST → SQL estándar: WHERE LOWER(campo)='valor' / LOWER(campo) LIKE '%valor%'
    //   GeoServer   → CQL:          strToLowerCase(campo)='valor' / strToLowerCase(campo) LIKE '%..%'
    const filterExact = (f, v) => isArcgis
      ? { whereClause: `LOWER(${f})='${v}'` }
      : { cqlFilter:   `strToLowerCase(${f})='${v}'` };
    const filterLike  = (f, v) => isArcgis
      ? { whereClause: `LOWER(${f}) LIKE '%${v}%'` }
      : { cqlFilter:   `strToLowerCase(${f}) LIKE '%${v}%'` };
    const filterRaw   = (f, v) => isArcgis
      ? { whereClause: `${f}='${v}'` }
      : { cqlFilter:   `${f}='${v}'` };

    let maskGeoJSON;
    if (field && value) {
      // Estrategia de búsqueda en cascada para máxima compatibilidad entre servidores:
      //
      //   1. Exacto canónico    → value tal como viene de GEO_MAPS (con tildes correctas,
      //                           capitalización exacta). Funciona en servidores case-sensitive.
      //   2. Lower con tildes   → valor en minúsculas. Case-insensitive, tildes preservadas.
      //                           GeoServer: strToLowerCase()  |  ArcGIS: LOWER()
      //   3. LIKE con tildes    → búsqueda parcial con tildes.
      //   4. Exacto sin tildes  → para servidores que almacenan sin tildes (IGM Uruguay, etc.)
      //   5. LIKE sin tildes    → búsqueda parcial sin tildes.
      //   6. LIKE últimas 2 palabras sin tildes → fallback para nombres muy largos
      //                           (ej: "Tierra del Fuego, Antártida e Islas del Atlántico Sur").
      //
      // El intento 1 (exacto canónico) resuelve el bug de tildes: antes se usaba
      // strToLowerCase como primer intento, lo que fallaba cuando el servidor almacena
      // con tildes (strToLowerCase('Córdoba') = 'córdoba' ≠ 'cordoba').

      const valorCanonical = value;                                         // con tildes, capitalización WFS
      const valorLower     = value.toLowerCase();                           // minúsculas, con tildes
      const valorNorm      = window._SPATIAL_UTILS.normalizar(value);        // minúsculas, sin tildes

      // Intento 1 — exacto canónico (valor exacto del GEO_MAPS, con tildes)
      maskGeoJSON = await maskFetcher.fetch(maskDef.typename, {
        ...maskWfsOpts,
        ...filterRaw(field, valorCanonical),
      });

      // Intento 2 — lower con tildes (case-insensitive, tildes preservadas)
      if (!maskGeoJSON.features?.length) {
        maskGeoJSON = await maskFetcher.fetch(maskDef.typename, {
          ...maskWfsOpts,
          ...filterExact(field, valorLower),
          forceRefresh: true,
        });
      }

      // Intento 3 — LIKE con tildes (búsqueda parcial)
      if (!maskGeoJSON.features?.length) {
        maskGeoJSON = await maskFetcher.fetch(maskDef.typename, {
          ...maskWfsOpts,
          ...filterLike(field, valorLower),
          forceRefresh: true,
        });
      }

      // Intento 4 — exacto sin tildes (servidores que almacenan sin tilde)
      if (!maskGeoJSON.features?.length && valorNorm !== valorLower) {
        maskGeoJSON = await maskFetcher.fetch(maskDef.typename, {
          ...maskWfsOpts,
          ...filterExact(field, valorNorm),
          forceRefresh: true,
        });
      }

      // Intento 5 — LIKE sin tildes
      if (!maskGeoJSON.features?.length && valorNorm !== valorLower) {
        maskGeoJSON = await maskFetcher.fetch(maskDef.typename, {
          ...maskWfsOpts,
          ...filterLike(field, valorNorm),
          forceRefresh: true,
        });
      }

      // Intento 6 — LIKE últimas 2 palabras sin tildes (nombres muy largos)
      if (!maskGeoJSON.features?.length) {
        const palabras = valorNorm.split(' ').filter(p => p.length > 2);
        if (palabras.length > 2) {
          const termino = palabras.slice(-2).join(' ');
          maskGeoJSON = await maskFetcher.fetch(maskDef.typename, {
            ...maskWfsOpts,
            ...filterLike(field, termino),
            forceRefresh: true,
          });
        }
      }

      if (!maskGeoJSON.features?.length) {
        throw new Error(`[SPATIAL:${opLabel}] No se encontró "${value}" en "${layerKey}" (campo: ${field}).`);
      }
    } else {
      // Polígono único (mar territorial, ZEE, etc.) — fetch sin filtro
      maskGeoJSON = await maskFetcher.fetch(maskDef.typename, { ...maskWfsOpts });
      if (!maskGeoJSON.features?.length) {
        throw new Error(`[SPATIAL:${opLabel}] La capa "${layerKey}" no devolvió features.`);
      }
    }

    // Unir múltiples features en uno solo si hace falta (ej: municipio con varios polígonos).
    // Para puntos con múltiples resultados (ej: LIKE devolvió varios), tomar el más parecido al valor buscado.
    let areaFeature;
    if (maskGeoJSON.features.length === 1) {
      const feat = maskGeoJSON.features[0];
      // Un único feature con geometría MultiPolygon también necesita normalización
      // (union convierte MultiPolygon → Polygon). Sin esto, los fallbacks del cliente
      // reciben un MultiPolygon crudo y recortan solo contra el primer subpolígono.
      if (feat.geometry?.type === 'MultiPolygon') {
        areaFeature = await window._SPATIAL_UTILS.unionFeatures([feat]);
      } else {
        areaFeature = feat;
      }
    } else {
      const geomType = maskGeoJSON.features[0]?.geometry?.type;
      if (geomType === 'Point' || geomType === 'MultiPoint') {
        // Para puntos: tomar el feature cuyo campo coincide más con el valor buscado
        const valorNorm = window._SPATIAL_UTILS.normalizar(value);
        areaFeature = maskGeoJSON.features.reduce((best, feat) => {
          const nombre = window._SPATIAL_UTILS.normalizar(feat.properties?.[field] || '');
          const bestNombre = window._SPATIAL_UTILS.normalizar(best.properties?.[field] || '');
          // Preferir coincidencia exacta, luego el nombre más corto (más específico)
          if (nombre === valorNorm) return feat;
          if (bestNombre === valorNorm) return best;
          return nombre.length < bestNombre.length ? feat : best;
        });
      } else {
        // Para polígonos: unir todos (comportamiento original)
        areaFeature = await window._SPATIAL_UTILS.unionFeatures(maskGeoJSON.features);
      }
    }

    return areaFeature;
  }

  // ── Verificaciones de umbral ──────────────────────────────────
  //
  // verificarUmbralDisplay — decide si una capa puede mostrarse basándose
  // en los campos del catálogo (fileSizeKb y featureCount).
  //
  // Estrategia:
  //   1. clipStrategy='attribute' → eximir SIEMPRE (el servidor filtra).
  //   2. Usar fileSizeKb como señal primaria.
  //   3. Si no hay fileSizeKb, usar featureCount como fallback.
  //   4. Si supera el umbral → bloquear y avisar al usuario.
  //
  // FUTURO — consulta en tiempo real (sección 9.1 del diseño):
  //   Antes del fetch, consultar el count real del subconjunto filtrado:
  //     WFS:    ?SERVICE=WFS&REQUEST=GetFeature&resultType=hits&CQL_FILTER=...
  //     ArcGIS: ?f=json&returnCountOnly=true&where=...
  //   Si count real < umbral → permitir aunque la capa completa esté bloqueada.
  //   Timeout recomendado: 5 s con fallback al catálogo si no responde.
  //   Los parámetros _wfsOpts y _cql ya están en la firma reservados.
  //   Ver git history para la implementación anterior de referencia.

  async function verificarUmbralDisplay(layerDef, _wfsOpts, _cql) {
    const ct         = window.CLIP_THRESHOLDS;
    const fsLimit    = ct.display;
    const fcFallback = ct.displayFcFallback;
    const titulo     = layerDef?.titulo || '';
    const fs         = layerDef?.fileSizeKb;
    const fc         = layerDef?.featureCount;

    // clipStrategy='attribute': el servidor filtra antes de enviar.
    // La capa completa nunca se descarga → eximir de todos los umbrales.
    if (layerDef?.clipStrategy === 'attribute') return true;

    // Límite por peso (señal primaria)
    if (fs !== undefined && fs > fsLimit) {
      const n = `${(fs / 1024).toFixed(0)} mb`;
      window.TOAST?.warning(t('toast_display_limit', { titulo, n }));
      return false;
    }

    const geomType = layerDef?.geomType || 'unknown';
    const fcHard   = ct.displayFcHard?.[geomType] ?? ct.displayFcHard?.unknown;

    if (fc !== undefined && fcHard !== undefined && fc > fcHard) {
      window.TOAST?.warning(t('toast_display_limit', { titulo, n: fc.toLocaleString() }));
      return false;
    }
    if (fs === undefined && fc !== undefined && fc > fcFallback) {
      window.TOAST?.warning(t('toast_display_limit', { titulo, n: fc.toLocaleString() }));
      return false;
    }
    return true;
  }

  // ── Operación: clip ───────────────────────────────────────────

  async function ejecutarClip(instruccion, layerDef, wfsOpts, cql) {
    let { clipArea } = instruccion;

    // Sin clipArea: fetch directo (filtro atributo o capa completa)
    if (!clipArea) {
      const src = resolverFuente(layerDef, layerDef.source);
      return fetcher(src).fetch(layerDef.typename, {
        ...wfsOpts,
        cqlFilter:   src.tipo !== 'arcgis' ? (cql || undefined) : undefined,
        whereClause: src.tipo === 'arcgis'  ? (cql || undefined) : undefined,
      });
    }

    // Guard: si el value del clipArea coincide con el nombre de un país Y la capa
    // máscara pertenece a ese mismo país, no tiene sentido recortar — el WFS ya
    // devuelve los datos del país completo.
    // Esto evita que el LLM genere clipArea con value:"Uruguay" apuntando a
    // departamento_uy y provoque un error en el WFS.
    // OJO: NO aplica cuando la máscara es de un país distinto al value — por ejemplo,
    // clipArea con layerKey:"departamento_ar" y value:"Uruguay" es legítimo (existe
    // el departamento Uruguay en Entre Ríos, Argentina) y no debe ignorarse.
    if (clipArea.value) {
      const PAISES_CODIGOS = { 'argentina': 'ar', 'uruguay': 'uy', 'chile': 'cl' };
      // clipArea.value puede ser string o array — normalizar toma el primer elemento si es array
      const valueNorm = window._SPATIAL_UTILS.normalizar(
        Array.isArray(clipArea.value) ? clipArea.value[0] : (clipArea.value ?? '')
      );
      const paisDelValue = PAISES_CODIGOS[valueNorm];
      if (paisDelValue) {
        const maskLayerDef  = window.LAYERS?.[clipArea.layerKey];
        const maskSource    = maskLayerDef ? window.SOURCES?.[maskLayerDef.source] : null;
        const paisDeMascara = maskSource?.country;
        if (paisDeMascara === paisDelValue) {
          console.warn(`[SPATIAL:clip] clipArea.value "${clipArea.value}" es un país y la máscara (${clipArea.layerKey}) es del mismo país — ignorando clipArea, fetch directo.`);
          const src = resolverFuente(layerDef, layerDef.source);
          return fetcher(src).fetch(layerDef.typename, {
            ...wfsOpts,
            cqlFilter:   src.tipo !== 'arcgis' ? (cql || undefined) : undefined,
            whereClause: src.tipo === 'arcgis'  ? (cql || undefined) : undefined,
          });
        }
      }
    }

    // Optimización para fuentes ArcGIS REST con geoFields definido:
    // si la capa tiene un campo de atributo para el tipo de área pedida,
    // filtrar por SQL en lugar de hacer clip geométrico.
    const src = resolverFuente(layerDef, layerDef.source);
    if (src.tipo === 'arcgis' && layerDef.geoFields && clipArea.field && clipArea.value) {
      const areaType = _inferirTipoArea(clipArea.layerKey);
      const campoGeo = areaType && layerDef.geoFields[areaType];
      if (campoGeo) {
        const whereArea = `${campoGeo}='${clipArea.value}'`;
        const whereFull = cql ? `(${cql}) AND (${whereArea})` : whereArea;
        return fetcher(src).fetch(layerDef.typename, {
          ...wfsOpts,
          whereClause: whereFull,
        });
      }
    }

    const maskFeature = await resolverAreaFeature(clipArea, 'clip');
    return window._SPATIAL_CLIP.ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature);
  }

  // Infiere el tipo de área ('region', 'comuna', 'provincia', etc.)
  // desde el layerKey de la capa de máscara, buscando en GEO_MAPS.
  function _inferirTipoArea(layerKey) {
    if (!layerKey) return null;
    for (const pais of Object.values(window.GEO_MAPS || {})) {
      for (const [tipo, meta] of Object.entries(pais)) {
        if (meta.layerKey === layerKey) return meta.tipo;
      }
    }
    return null;
  }

  // ── Operación: intersect ──────────────────────────────────────

  async function ejecutarIntersect(instruccion, layerDef, wfsOpts, cql) {
    const { intersectArea } = instruccion;

    if (!intersectArea) {
      throw new Error('[SPATIAL:intersect] La instrucción no tiene intersectArea.');
    }

    const maskFeature = await resolverAreaFeature(intersectArea, 'intersect');
    return window._SPATIAL_INTERSECT.ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature);
  }

  // ── Operación: buffer ─────────────────────────────────────────

  // ── Operación: within_layer (absorbe buffer) ────────────────
  //
  // buffer y buffer_exclude se redirigen acá para retrocompatibilidad.
  // La instrucción puede llegar con bufferArea.distanceKm (formato buffer antiguo)
  // o con withinDistance (formato within_layer nuevo).

  async function ejecutarWithinLayer(instruccion, layerDef, wfsOpts, cql) {
    const { withinArea, withinPoint, refLayerKey } = instruccion;

    // Resolver la referencia según el tipo
    let areaFeature = null;

    if (withinPoint) {
      // Punto explícito — no hay feature que resolver
      areaFeature = null;
    } else if (refLayerKey) {
      // Capa de referencia — fetchear y adjuntar al instruccion
      const refLayerDef = window.LAYERS[refLayerKey];
      if (!refLayerDef) throw new Error(`[SPATIAL:within_layer] Capa de referencia desconocida: "${refLayerKey}"`);
      const refSource  = resolverFuente(refLayerDef, refLayerKey);
      const refFetcher = fetcher(refSource);
      const refWfsOpts = buildWfsOpts(refSource, refLayerDef);
      const refGeoJSON = await refFetcher.fetch(refLayerDef.typename, refWfsOpts);
      instruccion.refLayerGeoJSON = refGeoJSON;
    } else if (withinArea) {
      // Área/división administrativa
      areaFeature = await resolverAreaFeature(withinArea, 'within_layer');
    } else {
      // Compatibilidad con buffer: bufferArea tiene { layerKey, field, value, distanceKm }
      const bufferArea = instruccion.bufferArea;
      if (bufferArea) {
        instruccion.withinDistance = bufferArea.distanceKm;
        if (bufferArea.layerKey) {
          areaFeature = await resolverAreaFeature(bufferArea, 'within_layer');
        }
      }
    }

    return window._SPATIAL_WITHIN_LAYER.ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature);
  }

  // ── Operación: dissolve ──────────────────────────────────────

  async function ejecutarDissolve(instruccion, layerDef, wfsOpts, cql) {
    // dissolve sin área — une todos los features (con filtro si aplica vía cql)
    return window._SPATIAL_DISSOLVE.ejecutar(instruccion, layerDef, wfsOpts, cql, null);
  }

  async function ejecutarDissolveExclude(instruccion, layerDef, wfsOpts, cql) {
    const { dissolveArea } = instruccion;
    if (!dissolveArea) {
      throw new Error('[SPATIAL:dissolve_exclude] La instrucción no tiene dissolveArea.');
    }
    const maskFeature = await resolverAreaFeature(dissolveArea, 'dissolve_exclude');
    return window._SPATIAL_DISSOLVE.ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature);
  }

  // ── Operación: clip_exclude ───────────────────────────────────

  async function ejecutarClipExclude(instruccion, layerDef, wfsOpts, cql) {
    const { clipArea } = instruccion;

    // Sin clipArea: misma lógica que clip sin área — no hay qué excluir
    if (!clipArea) {
      throw new Error('[SPATIAL:clip_exclude] La instrucción no tiene clipArea.');
    }

    // Optimización para ArcGIS REST: si hay geoFields, no se puede hacer clip_exclude
    // con atributo (no hay operador NOT IN espacial en REST simple) — va siempre al spatial.
    const maskFeature = await resolverAreaFeature(clipArea, 'clip_exclude');
    return window._SPATIAL_CLIP.ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature);
  }

  // ── Operación: intersect_exclude ─────────────────────────────

  async function ejecutarIntersectExclude(instruccion, layerDef, wfsOpts, cql) {
    const { intersectArea } = instruccion;

    if (!intersectArea) {
      throw new Error('[SPATIAL:intersect_exclude] La instrucción no tiene intersectArea.');
    }

    const maskFeature = await resolverAreaFeature(intersectArea, 'intersect_exclude');
    return window._SPATIAL_INTERSECT.ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature);
  }

  // ── Operación: adjacent ─────────────────────────────────────

  async function ejecutarAdjacent(instruccion, layerDef, wfsOpts, cql) {
    const { adjacentArea } = instruccion;
    if (!adjacentArea) throw new Error('[SPATIAL:adjacent] La instrucción no tiene adjacentArea.');
    const maskFeature = await resolverAreaFeature(adjacentArea, 'adjacent');
    return window._SPATIAL_ADJACENT.ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature);
  }

  async function ejecutarAdjacentExclude(instruccion, layerDef, wfsOpts, cql) {
    const { adjacentArea } = instruccion;
    if (!adjacentArea) throw new Error('[SPATIAL:adjacent_exclude] La instrucción no tiene adjacentArea.');
    const maskFeature = await resolverAreaFeature(adjacentArea, 'adjacent_exclude');
    return window._SPATIAL_ADJACENT.ejecutar(instruccion, layerDef, wfsOpts, cql, maskFeature);
  }

  // ── Operación: nearest ────────────────────────────────────────

  async function ejecutarNearest(instruccion, layerDef, wfsOpts, cql) {
    const { nearestArea, nearestPoint } = instruccion;
    let areaFeature = null;
    if (nearestArea?.layerKey) {
      areaFeature = await resolverAreaFeature(nearestArea, 'nearest');
    }
    return window._SPATIAL_NEAREST.ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature);
  }

  // ── Punto de entrada principal ────────────────────────────────

  /**
   * ejecutar(instruccion)
   *
   * Lee instruccion.op y deriva al módulo correcto.
   * Si no hay op, asume 'clip' (retrocompatibilidad con INTENT y LLM antiguo).
   *
   * Devuelve GeoJSON FeatureCollection listo para renderizar.
   */
  async function ejecutar(instruccion) {
    const { layerKey, filtro } = instruccion;
    const op = instruccion.op || 'clip';

    const layerDef = window.LAYERS[layerKey];
    if (!layerDef) throw new Error(`[SPATIAL] Capa desconocida: "${layerKey}"`);

    const source  = resolverFuente(layerDef, layerKey);
    const wfsOpts = buildWfsOpts(source, layerDef);
    const cql     = (filtro || '').trim();

    // Umbral de display — consulta el count real al servidor antes de pedir datos
    if (!await verificarUmbralDisplay(layerDef, wfsOpts, cql)) {
      return { type: 'FeatureCollection', features: [], _blockedByThreshold: true };
    }

    // Capa sin soporte de recorte — clipStrategy null o 'none'
    // null: la capa no tiene estrategia definida (polígonos únicos, capas auxiliares)
    // 'none': explícitamente sin recorte por volumen de datos
    if (!layerDef.clipStrategy || layerDef.clipStrategy === 'none') {
      if (op !== 'clip' || instruccion.clipArea) {
        window.TOAST?.warning(t('toast_spatial_none', { titulo: layerDef.titulo }));
      }
      return fetcher(source).fetch(layerDef.typename, {
        ...wfsOpts,
        cqlFilter:   source.tipo !== 'arcgis' ? (cql || undefined) : undefined,
        whereClause: source.tipo === 'arcgis'  ? (cql || undefined) : undefined,
      });
    }

    // clipStrategy: 'attribute'
    //
    // La capa se filtra por campo de atributo, no por geometría.
    // Ejemplos: localidad_ar (nom_pcia='Mendoza'), sublocalidad_ar (nom_pcia='Córdoba').
    //
    // El flujo normal (via intent-capa.js) construye el CQL correcto y NO pone clipArea:
    //   "localidades de Mendoza" → instruccion.filtro = "nom_pcia='Mendoza'", clipArea = null
    //   → spatial.js recibe clip sin clipArea → fetch directo con CQL.
    //
    // Guard para llamadas directas (tests, API externa) que pasen clipArea igualmente:
    // si la capa es 'attribute' y viene clipArea, convertimos el clipArea en CQL y
    // vaciamos el clipArea para evitar que se dispare un clip geométrico innecesario
    // (que en el servidor no conoce clipStrategy y procesaría puntos con booleanPointInPolygon
    // contra un MultiPolygon complejo, devolviendo 0 features incorrectamente).
    if (layerDef.clipStrategy === 'attribute') {
      const areaRaw = instruccion.clipArea || instruccion.intersectArea;
      if (areaRaw?.field && areaRaw?.value != null) {
        // Construir CQL de atributo y limpiar el área geométrica
        const { _buildFiltroArea } = window._INTENT_CAPA_UTILS || {};
        if (_buildFiltroArea) {
          const esExclude = op === 'clip_exclude' || op === 'intersect_exclude';
          const filtroArea = _buildFiltroArea(areaRaw.field, areaRaw.value, esExclude);
          instruccion = {
            ...instruccion,
            filtro:       cql ? `${cql} AND ${filtroArea}` : filtroArea,
            clipArea:     null,
            intersectArea: null,
          };
        } else {
          // _buildFiltroArea no está expuesta: construir CQL simple como fallback
          const values    = Array.isArray(areaRaw.value) ? areaRaw.value : [areaRaw.value];
          const esExclude = op === 'clip_exclude' || op === 'intersect_exclude';
          const filtroArea = values.length === 1
            ? `${areaRaw.field}='${values[0]}'`
            : `${areaRaw.field} IN (${values.map(v => `'${v}'`).join(',')})`;
          const filtroFinal = esExclude ? `NOT (${filtroArea})` : filtroArea;
          instruccion = {
            ...instruccion,
            filtro:       cql ? `${cql} AND ${filtroFinal}` : filtroFinal,
            clipArea:     null,
            intersectArea: null,
          };
        }
      }
    }

    // Derivar según op
    switch (op) {
      case 'clip':
        return ejecutarClip(instruccion, layerDef, wfsOpts, cql);

      case 'clip_exclude':
        return ejecutarClipExclude(instruccion, layerDef, wfsOpts, cql);

      case 'intersect':
        return ejecutarIntersect(instruccion, layerDef, wfsOpts, cql);

      case 'intersect_exclude':
        return ejecutarIntersectExclude(instruccion, layerDef, wfsOpts, cql);

      // buffer y buffer_exclude redirigen a within_layer (retrocompatibilidad)
      case 'buffer':
      case 'buffer_exclude':
        instruccion = {
          ...instruccion,
          op: instruccion.op === 'buffer_exclude' ? 'within_layer_exclude' : 'within_layer',
        };
        return ejecutarWithinLayer(instruccion, layerDef, wfsOpts, cql);

      case 'dissolve':
        return ejecutarDissolve(instruccion, layerDef, wfsOpts, cql);

      case 'dissolve_exclude':
        return ejecutarDissolveExclude(instruccion, layerDef, wfsOpts, cql);

      case 'within_layer':
      case 'within_layer_exclude':
        return ejecutarWithinLayer(instruccion, layerDef, wfsOpts, cql);

      case 'adjacent':
        return ejecutarAdjacent(instruccion, layerDef, wfsOpts, cql);

      case 'adjacent_exclude':
        return ejecutarAdjacentExclude(instruccion, layerDef, wfsOpts, cql);

      case 'nearest':
      case 'nearest_exclude':
        return ejecutarNearest(instruccion, layerDef, wfsOpts, cql);

      default:
        throw new Error(`[SPATIAL] Operación desconocida: "${op}"`);
    }
  }

  return { ejecutar };

})();
