/**
 * spatial.js — Orquestador de operaciones espaciales
 *
 * Único punto de entrada para todas las operaciones espaciales.
 * Reemplaza a src/clip.js y se expone como window.SPATIAL.
 *
 * Lee el campo `op` de la instrucción y delega al módulo correcto:
 *   'clip'      → src/spatial-clip.js      (recorte geométrico)
 *   'intersect' → src/spatial-intersect.js (features completas que tocan el área)
 *   'buffer'    → src/spatial-buffer.js    (área de influencia)
 *   undefined   → 'clip' por retrocompatibilidad (instrucciones de INTENT o LLM antiguo)
 *
 * Estructura de la instrucción según op:
 *
 *   clip / (sin op):
 *     { layerKey, filtro, clipArea: { layerKey, field, value } | null, descripcion }
 *
 *   intersect:
 *     { op: 'intersect', layerKey, filtro, intersectArea: { layerKey, field, value }, descripcion }
 *
 *   buffer:
 *     { op: 'buffer', layerKey, filtro, bufferArea: { layerKey, field, value, distanceKm }, descripcion }
 *
 * Dependencias (deben cargarse antes en index.html):
 *   window.WFS, window.LAYERS, window.SOURCES, window.TOAST, window.t
 *   window._SPATIAL_CLIP, window._SPATIAL_INTERSECT, window._SPATIAL_BUFFER
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
    const valueNorm = window._SPATIAL_CLIP.normalizar(value);
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
      return window._SPATIAL_CLIP.unionFeatures(features);
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
      const valorNorm      = window._SPATIAL_CLIP.normalizar(value);        // minúsculas, sin tildes

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
        areaFeature = await window._SPATIAL_CLIP.unionFeatures([feat]);
      } else {
        areaFeature = feat;
      }
    } else {
      const geomType = maskGeoJSON.features[0]?.geometry?.type;
      if (geomType === 'Point' || geomType === 'MultiPoint') {
        // Para puntos: tomar el feature cuyo campo coincide más con el valor buscado
        const valorNorm = window._SPATIAL_CLIP.normalizar(value);
        areaFeature = maskGeoJSON.features.reduce((best, feat) => {
          const nombre = window._SPATIAL_CLIP.normalizar(feat.properties?.[field] || '');
          const bestNombre = window._SPATIAL_CLIP.normalizar(best.properties?.[field] || '');
          // Preferir coincidencia exacta, luego el nombre más corto (más específico)
          if (nombre === valorNorm) return feat;
          if (bestNombre === valorNorm) return best;
          return nombre.length < bestNombre.length ? feat : best;
        });
      } else {
        // Para polígonos: unir todos (comportamiento original)
        areaFeature = await window._SPATIAL_CLIP.unionFeatures(maskGeoJSON.features);
      }
    }

    return areaFeature;
  }

  // ── Verificaciones de umbral ──────────────────────────────────

  // Valor por defecto para el umbral de display.
  // window.CLIP_THRESHOLDS (definido en layers/index.js) puede sobreescribirlo.
  // En mobile, map-controls.js lo baja dinámicamente a 5000 al abrir el mapa.
  // El umbral spatial fue eliminado — el recorte lo hace el servidor, sin límite.
  // IMPORTANTE: mantener en sync con display: en layers/index.js.
  const _DISPLAY_DEFAULT = 55000;

  function verificarUmbralDisplay(layerDef) {
    const displayThreshold = window.CLIP_THRESHOLDS?.display ?? _DISPLAY_DEFAULT;
    if (layerDef.featureCount !== undefined && layerDef.featureCount > displayThreshold) {
      window.TOAST?.warning(t('toast_display_limit', {
        titulo: layerDef.titulo,
        n: layerDef.featureCount.toLocaleString(),
      }));
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
      const valueNorm = window._SPATIAL_CLIP?.normalizar?.(clipArea.value)
        ?? (Array.isArray(clipArea.value) ? clipArea.value[0] : clipArea.value)?.toLowerCase?.() ?? '';
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

  async function ejecutarBuffer(instruccion, layerDef, wfsOpts, cql) {
    const { bufferArea } = instruccion;

    if (!bufferArea) {
      throw new Error('[SPATIAL:buffer] La instrucción no tiene bufferArea.');
    }

    const areaFeature = await resolverAreaFeature(bufferArea, 'buffer');
    return window._SPATIAL_BUFFER.ejecutar(instruccion, layerDef, wfsOpts, cql, areaFeature);
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

    // Umbral de display — aplica a todas las operaciones
    if (!verificarUmbralDisplay(layerDef)) {
      return { type: 'FeatureCollection', features: [], _blockedByThreshold: true };
    }

    const source  = resolverFuente(layerDef, layerKey);
    const wfsOpts = buildWfsOpts(source, layerDef);
    const cql     = (filtro || '').trim();

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

      case 'buffer':
        return ejecutarBuffer(instruccion, layerDef, wfsOpts, cql);

      default:
        throw new Error(`[SPATIAL] Operación desconocida: "${op}"`);
    }
  }

  return { ejecutar };

})();
