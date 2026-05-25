/**
 * src/intent/intent-validar.js — Validaciones de acciones
 *
 * Cada acción tiene un array de validaciones.
 * Cada validación tiene:
 *   check(params, ctx) → boolean   (true = válido, false = inválido)
 *   error: string                  (clave i18n del mensaje de error)
 *   bloquea: boolean               (true = no ejecutar, false = advertir y continuar)
 *
 * Contexto (ctx):
 *   ctx.activeLayers    → window.MAP.getActiveLayers()
 *   ctx.LAYERS          → window.LAYERS (catálogo completo)
 *   ctx.PALETTES        → window.PALETTES
 *   ctx.geojson         → GeoJSON de la capa activa (si está disponible)
 *
 * Restricciones reales del sistema (relevadas del código):
 *
 *   CLASIFICACIÓN:
 *     - MAX 8 categorías (paletas cualitativas de 8 colores) para tipo 'categorized'
 *     - Para tipo 'graduated' no hay límite estricto (usa breaks de Jenks)
 *     - El campo debe tener al menos 2 valores únicos
 *     - No aplica sobre geomType 'none' o 'unknown'
 *
 *   ESTILO:
 *     - 'radius' solo para geomType 'point'
 *     - 'weight' solo para geomType 'line'
 *     - 'icon' solo para geomType 'point'
 *     - 'geom' (forma) solo para geomType 'point'
 *     - 'color' y 'opacity' disponibles para todos
 *     - Si hay clasificación activa, cambiar color la anula (advertir)
 *
 *   EXPORT:
 *     - Formatos soportados: 'jpeg', 'pdf', 'geojson', 'html'
 *     - 'shapefile', 'csv', 'xlsx', 'kml' → NO soportados
 *     - Requiere al menos una capa cargada (excepto jpeg/pdf que pueden exportar basemap solo)
 *
 *   LIMPIAR:
 *     - Requiere al menos una capa cargada para tener sentido
 *
 *   QUITAR:
 *     - La capa debe estar en activeLayers
 *
 *   CAPA:
 *     - fileSizeKb > 30 MB (desktop) ó > 8 MB (móvil) → bloqueada por peso
 *     - Sin fileSizeKb: featureCount > 40 000 (desktop) ó > 10 000 (móvil) → bloqueada
 *     - featureCount > 25 000 (desktop) ó > 12 000 (móvil) → bloqueada por límite duro
 *     - clipStrategy 'none' → no se puede recortar
 *
 *   FILTRAR:
 *     - Solo si la capa tiene filterField, geoFields o labelField
 *
 * Uso:
 *   const resultado = window.INTENT_VALIDAR.validar('clasificar', params, ctx);
 *   // resultado: { valido: true } | { valido: false, error: 'i18n_key', bloquea: true }
 */

window.INTENT_VALIDAR = (() => {

  // ── Constantes del sistema ────────────────────────────────────

  const MAX_CATS_CATEGORIZED = 8;    // paletas cualitativas tienen 8 colores
  const MAX_CATS_GRADUATED   = 8;    // breaks de Jenks: máximo 8 clases
  const MIN_UNIQUE_VALUES    = 2;    // mínimo de valores únicos para clasificar
  // Helper: guardia rápida pre-fetch usando campos del catálogo.
  // La verificación definitiva ocurre en spatial.js justo antes del fetch.
  // CLIP_THRESHOLDS siempre está disponible (carga sincrónica en layers/index.js).
  //
  // Retorna uno de tres valores:
  //   false               → la capa puede cargarse sin restricciones
  //   'advertencia'       → zona intermedia: aviso no bloqueante al usuario
  //   true                → bloqueada (no cargar)
  //
  // Reglas por clipStrategy:
  //
  //   'attribute': el servidor filtra ANTES de enviar → la capa completa nunca
  //     llega al cliente. Por eso se exime TANTO del límite fileSizeKb COMO
  //     del límite featureCount. El fileSizeKb refleja el tamaño de la capa
  //     entera, que es irrelevante cuando el servidor va a devolver solo 3-20
  //     features del filtro.
  //     Ejemplo: area_montana_ar tiene 60 MB y 72 features. Con clipStrategy
  //     'attribute', "área de montaña de Mendoza" → servidor devuelve ~4
  //     features, ~100 KB. Bloquear por 60 MB es incorrecto.
  //
  //   'spatial' / 'none' / null: el cliente descarga features del servidor,
  //     por lo que aplican los umbrales normales de fileSizeKb y featureCount.
  //     Para 'spatial', el LLM puede pasar un CQL/clipArea que reduzca el
  //     subconjunto — la consulta en tiempo real (sección 9.1) resolverá esto
  //     correctamente cuando se reimplemente. Por ahora, los umbrales se
  //     aplican sobre los valores del catálogo (capa completa).
  //
  // Zona de advertencia (displayFcWarn):
  //   Si fc está entre displayFcWarn[geomType] y displayFcHard[geomType],
  //   retorna 'advertencia' en lugar de true (bloqueo duro). El llamador
  //   muestra un aviso no bloqueante: "Esta capa puede tardar. ¿Continuar?"
  //
  // FUTURO — consulta en tiempo real (sección 9.1):
  //   Antes del fetch, consultar el count real del subconjunto filtrado al
  //   servidor (WFS: resultType=hits | ArcGIS: returnCountOnly=true).
  //   Si count real < umbral → permitir aunque la capa completa esté bloqueada.
  //   Ver src/spatial.js → verificarUmbralDisplay() para reimplementar.
  function _estaRestringida(layerDef) {
    const ct         = window.CLIP_THRESHOLDS;
    const fsLimit    = ct.display;
    const fcFallback = ct.displayFcFallback;
    const fs = layerDef?.fileSizeKb;
    const fc = layerDef?.featureCount;

    // clipStrategy='attribute': el servidor filtra → nunca llega la capa completa.
    // Se exime TANTO del límite fileSizeKb como del featureCount.
    if (layerDef?.clipStrategy === 'attribute') return false;

    // Límite por peso (señal primaria). Solo aplica para capas no-attribute.
    if (fs !== undefined && fs > fsLimit) return true;

    const geomType = layerDef?.geomType || 'unknown';
    const fcHard   = ct.displayFcHard?.[geomType]   ?? ct.displayFcHard?.unknown;
    const fcWarn   = ct.displayFcWarn?.[geomType]   ?? ct.displayFcWarn?.unknown;

    // Bloqueo duro por featureCount
    if (fc !== undefined && fcHard !== undefined && fc > fcHard) return true;

    // Fallback sin fileSizeKb (principalmente capas ArcGIS de Chile sin fileSizeKb)
    if (fs === undefined && fc !== undefined && fc > fcFallback) return true;

    // Zona de advertencia no bloqueante
    if (fc !== undefined && fcWarn !== undefined && fc > fcWarn) return 'advertencia';

    return false;
  }

  // Helper: construye los params del mensaje de error de restricción.
  function _restrictedParams(layerDef, layerKey) {
    const fs = layerDef?.fileSizeKb;
    const fc = layerDef?.featureCount;
    const titulo = layerDef?.titulo || layerKey;
    if (fs !== undefined) {
      const mb = (fs / 1024).toFixed(0);
      return { titulo, n: `${mb} mb`, tipo: 'size' };
    }
    return { titulo, n: fc?.toLocaleString() ?? '?', tipo: 'count' };
  }

  const FORMATOS_SOPORTADOS = new Set(['jpeg', 'pdf', 'geojson', 'html']);
  const FORMATOS_NO_SOPORTADOS = new Set(['shapefile', 'shp', 'csv', 'xlsx', 'xls', 'kml', 'kmz', 'gpx', 'dxf', 'dwg']);

  const GEOM_PROPS_VALIDAS = {
    point:   new Set(['color', 'radius', 'weight', 'icon', 'geom', 'opacity']),
    line:    new Set(['color', 'weight', 'opacity', 'dashArray']),
    polygon: new Set(['color', 'opacity', 'weight']),
    unknown: new Set(['color', 'opacity']),
    none:    new Set(),
  };

  // ── Tabla de validaciones por acción ─────────────────────────

  const VALIDACIONES = {

    // ── limpiar_estilo ───────────────────────────────────────────
    limpiar_estilo: [
      {
        // mapKey=null con capas activas → chat.js muestra selector. No bloquear.
        bloquea: true,
        error:   'validate_no_layer',
        check:   (p, ctx) => {
          const keys = Object.keys(ctx.activeLayers);
          if (keys.length === 0) return false;
          if (p.mapKey && !ctx.activeLayers[p.mapKey]) return false;
          return true;
        },
      },
    ],

    // ── limpiar_filtro ───────────────────────────────────────────
    limpiar_filtro: [
      {
        bloquea: true,
        error:   'validate_no_filter',
        check:   (p, ctx) => {
          const entry = ctx.activeLayers[p.mapKey];
          const layerDef = ctx.LAYERS?.[entry?.layerKey];
          return !!(layerDef?.filterField || layerDef?.geoFields || layerDef?.labelField);
        },
      },
    ],

    // ── estilo_vago / estilo_resuelto ────────────────────────────
    estilo_vago: [
      {
        // Bloquea solo si NO hay ninguna capa en el mapa.
        // Si mapKey es null pero hay capas activas, chat.js mostrará el selector — no bloquear.
        bloquea: true,
        error:   'validate_no_layer',
        check:   (p, ctx) => {
          const keys = Object.keys(ctx.activeLayers);
          if (keys.length === 0) return false;          // sin capas → bloquear
          if (p.mapKey && !ctx.activeLayers[p.mapKey]) return false; // mapKey inválido → bloquear
          return true;                                  // mapKey null con capas → ok (selector en chat)
        },
      },
      {
        bloquea: true,
        error:   'validate_style_prop_not_valid',
        errorParams: (p, ctx) => ({
          param: p.propEstilo,
          geom:  ctx.activeLayers[p.mapKey]?.geomType || 'polygon',
        }),
        check:   (p, ctx) => {
          if (!p.propEstilo) return true; // sin prop específica → selector de prop
          const geom = ctx.activeLayers[p.mapKey]?.geomType || 'polygon';
          const validas = GEOM_PROPS_VALIDAS[geom] || GEOM_PROPS_VALIDAS.polygon;
          if (validas.has(p.propEstilo)) return true;
          // La prop no aplica para la capa resuelta, pero puede haber otra capa activa
          // que sí la soporte (ej: radius pedido con polígono+punto activos).
          // En ese caso no bloquear — showStyleFlow mostrará el selector de capa.
          return Object.entries(ctx.activeLayers)
            .filter(([k]) => k !== p.mapKey)
            .some(([, l]) => (GEOM_PROPS_VALIDAS[l.geomType] || GEOM_PROPS_VALIDAS.polygon).has(p.propEstilo));
        },
      },
      {
        bloquea: false,               // advertencia, no bloqueo
        error:   'validate_style_has_classification',
        check:   (p, ctx) => {
          if (p.propEstilo !== 'color') return true;
          return !ctx.activeLayers[p.mapKey]?.classification;
        },
      },
    ],

    // ── quitar ───────────────────────────────────────────────────
    quitar: [
      {
        // mapKey=null con capas activas → chat.js muestra selector. No bloquear.
        bloquea: true,
        error:   'validate_layer_not_found',
        check:   (p, ctx) => {
          const keys = Object.keys(ctx.activeLayers);
          if (keys.length === 0) return false;
          if (p.mapKey && !ctx.activeLayers[p.mapKey]) return false;
          return true;
        },
      },
    ],

    // ── limpiar ──────────────────────────────────────────────────
    limpiar: [
      {
        bloquea: false,              // advertencia, no bloqueo
        error:   'validate_map_empty',
        check:   (p, ctx) => Object.keys(ctx.activeLayers).length > 0,
      },
    ],

    // ── export ───────────────────────────────────────────────────
    export: [
      {
        bloquea: true,
        error:   'validate_export_format_not_supported',
        errorParams: (p) => ({ formato: p.subtipo }),
        check:   (p) => !p.subtipo || p.subtipo === 'vago' || FORMATOS_SOPORTADOS.has(p.subtipo),
      },
      {
        bloquea: true,
        error:   'validate_export_no_layers',
        check:   (p, ctx) => {
          // jpeg y pdf pueden exportar aunque no haya capas (solo el basemap)
          if (p.subtipo === 'jpeg' || p.subtipo === 'pdf' || p.subtipo === 'vago') return true;
          return Object.keys(ctx.activeLayers).length > 0;
        },
      },
    ],

    // ── basemap ──────────────────────────────────────────────────
    basemap: [
      {
        bloquea: true,
        error:   'validate_basemap_invalid',
        check:   (p) => ['dark', 'gray', 'voyager', 'vago'].includes(p.subtipo),
      },
    ],

    // ── capa ─────────────────────────────────────────────────────
    capa: [
      {
        // Bloqueo duro: capa completamente restringida
        bloquea: true,
        error:   'validate_layer_too_many_features',
        errorParams: (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _restrictedParams(layerDef, p.layerKey);
        },
        check:   (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _estaRestringida(layerDef) !== true;
        },
      },
      {
        // Advertencia no bloqueante: la capa puede tardar en cargar
        bloquea: false,
        error:   'validate_layer_may_be_slow',
        errorParams: (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _restrictedParams(layerDef, p.layerKey);
        },
        check:   (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _estaRestringida(layerDef) !== 'advertencia';
        },
      },
    ],

    // ── agregar ──────────────────────────────────────────────────
    agregar: [
      {
        bloquea: false,
        error:   'validate_layer_already_on_map',
        check:   (p, ctx) => {
          if (!p.layerKey) return true;
          return !Object.values(ctx.activeLayers).some(e => e.layerKey === p.layerKey);
        },
      },
      // Hereda la validación de display de 'capa' (peso / featureCount)
      {
        // Bloqueo duro
        bloquea: true,
        error:   'validate_layer_too_many_features',
        errorParams: (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _restrictedParams(layerDef, p.layerKey);
        },
        check:   (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _estaRestringida(layerDef) !== true;
        },
      },
      {
        // Advertencia no bloqueante
        bloquea: false,
        error:   'validate_layer_may_be_slow',
        errorParams: (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _restrictedParams(layerDef, p.layerKey);
        },
        check:   (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return _estaRestringida(layerDef) !== 'advertencia';
        },
      },
    ],

    // ── renombrar ────────────────────────────────────────────────
    renombrar: [
      // Sin restricciones técnicas — el nombre puede ser cualquier string
    ],

    // ── filtrar ──────────────────────────────────────────────────
    filtrar: [
      {
        bloquea: false,              // advertencia: la capa puede no tener campos filtrables
        error:   'validate_filter_no_filterable_fields',
        check:   (p, ctx) => {
          const entry    = ctx.activeLayers[p.mapKey];
          const layerDef = ctx.LAYERS?.[entry?.layerKey];
          if (!layerDef) return true;
          return !!(layerDef.filterField || layerDef.geoFields || layerDef.labelField);
        },
      },
    ],

  };

  // Alias: estilo_resuelto comparte validaciones con estilo_vago
  VALIDACIONES.estilo_resuelto = VALIDACIONES.estilo_vago;

  // ── API pública ───────────────────────────────────────────────

  /**
   * validar(accion, params, ctx) → { valido: true } | { valido: false, error, bloquea, errorParams }
   *
   * Ejecuta todas las validaciones para la acción dada.
   * Se detiene en la primera validación que falla.
   *
   * @param accion  {string}  Nombre de la acción ('clasificar', 'estilo_vago', etc.)
   * @param params  {object}  Parámetros de la acción (mapKey, layerKey, field, etc.)
   * @param ctx     {object}  Contexto del sistema (activeLayers, LAYERS, etc.)
   */
  function validar(accion, params, ctx) {
    const validaciones = VALIDACIONES[accion];
    if (!validaciones) return { valido: true };

    const contexto = {
      activeLayers: ctx.activeLayers || window.MAP?.getActiveLayers?.() || {},
      LAYERS:       ctx.LAYERS       || window.LAYERS || {},
      PALETTES:     ctx.PALETTES     || window.PALETTES || {},
      geojson:      ctx.geojson      || null,
    };

    for (const v of validaciones) {
      let ok;
      try {
        ok = v.check(params, contexto);
      } catch (e) {
        console.warn('[VALIDAR] Error en validación de ' + accion + ':', e);
        ok = true; // no bloquear si hay error en la validación misma
      }

      if (!ok) {
        const errorParams = v.errorParams ? v.errorParams(params, contexto) : {};
        return {
          valido:      false,
          error:       v.error,
          errorParams,
          bloquea:     v.bloquea !== false, // por defecto bloquea
        };
      }
    }

    return { valido: true };
  }

  /**
   * esFormatoSoportado(subtipo) → boolean
   */
  function esFormatoSoportado(subtipo) {
    return FORMATOS_SOPORTADOS.has(subtipo);
  }

  /**
   * esFormatoNoSoportado(norm) → string | null
   * Si el texto menciona un formato que no soportamos, devuelve su nombre.
   */
  function esFormatoNoSoportado(norm) {
    for (const fmt of FORMATOS_NO_SOPORTADOS) {
      if (new RegExp('\\b' + fmt + '\\b', 'i').test(norm)) return fmt;
    }
    return null;
  }

  /**
   * getPropsValidasParaGeom(geomType) → string[]
   */
  function getPropsValidasParaGeom(geomType) {
    return [...(GEOM_PROPS_VALIDAS[geomType] || GEOM_PROPS_VALIDAS.polygon)];
  }


  // ══════════════════════════════════════════════════════════════
  // VALIDACIONES DE OPERACIONES ESPACIALES
  // ══════════════════════════════════════════════════════════════
  //
  // validarOpEspacial(op, instruccion, layerDef) →
  //   { valida: true }
  // | { valida: false, bloquea: true,  error: 'i18n_key', errorParams }
  // | { valida: false, bloquea: false, preguntar: 'distancia'|'area'|'n'|'confirmar' }
  //
  // 'preguntar' indica que chat.js debe pedir al usuario el dato faltante
  // antes de ejecutar la operación.

  // Geometrías sobre las que ADJACENT tiene sentido
  const GEOMS_ADJACENT_VALIDAS = new Set(['polygon']);

  // Geometrías sobre las que INTERSECT tiene sentido
  const GEOMS_INTERSECT_VALIDAS = new Set(['line', 'polygon']);

  // Geometrías sobre las que DISSOLVE tiene sentido
  const GEOMS_DISSOLVE_VALIDAS = new Set(['polygon', 'line', 'point']);

  const VALIDACIONES_OP = {

    within_layer: [
      {
        // Sin área de referencia → preguntar
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.withinArea?.value || inst.refLayerKey),
      },
      {
        // Sin distancia → preguntar (eliminado el default de 50km)
        bloquea: false, preguntar: 'distancia',
        check: (inst) => inst.withinDistance != null,
      },
    ],

    within_layer_exclude: [
      {
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.withinArea?.value || inst.refLayerKey),
      },
      {
        bloquea: false, preguntar: 'distancia',
        check: (inst) => inst.withinDistance != null,
      },
    ],

    nearest: [
      {
        // Sin área de referencia → preguntar
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.nearestArea?.value || inst.refLayerKey),
      },
      {
        // Sin N → preguntar
        bloquea: false, preguntar: 'n',
        check: (inst) => inst.nearestCount != null,
      },
    ],

    nearest_exclude: [
      {
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.nearestArea?.value || inst.refLayerKey),
      },
      {
        bloquea: false, preguntar: 'n',
        check: (inst) => inst.nearestCount != null,
      },
    ],

    adjacent: [
      {
        // Sin área de referencia → preguntar
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.adjacentArea?.value),
      },
      {
        // Geomería de puntos → no tiene sentido
        bloquea: true, error: 'validate_op_adjacent_not_polygon',
        check: (inst, layerDef) => GEOMS_ADJACENT_VALIDAS.has(layerDef?.geomType),
      },
    ],

    adjacent_exclude: [
      {
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.adjacentArea?.value),
      },
      {
        bloquea: true, error: 'validate_op_adjacent_not_polygon',
        check: (inst, layerDef) => GEOMS_ADJACENT_VALIDAS.has(layerDef?.geomType),
      },
    ],

    intersect: [
      {
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.intersectArea?.value),
      },
    ],

    intersect_exclude: [
      {
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.intersectArea?.value),
      },
    ],

    dissolve: [
      {
        // Sin área → confirmar si quieren unir TODOS los features
        bloquea: false, preguntar: 'confirmar_dissolve_all',
        check: (inst) => !!(inst.dissolveArea?.value || inst.clipArea?.value || inst.filtro),
      },
    ],

    dissolve_exclude: [
      {
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.dissolveArea?.value),
      },
    ],

    clip: [
      // clip sin área es la capa completa — siempre válido
    ],

    clip_exclude: [
      {
        bloquea: false, preguntar: 'area',
        check: (inst) => !!(inst.clipArea?.value),
      },
    ],
  };

  /**
   * validarOpEspacial(op, instruccion, layerDef)
   *
   * @param op         string     Operación detectada ('within_layer', 'nearest', etc.)
   * @param instruccion object    Instrucción construida por construirInstruccion()
   * @param layerDef   object    Definición de la capa del catálogo
   *
   * @returns { valida: true }
   *        | { valida: false, bloquea: true, error, errorParams }
   *        | { valida: false, bloquea: false, preguntar }
   */
  function validarOpEspacial(op, instruccion, layerDef) {
    const validaciones = VALIDACIONES_OP[op];
    if (!validaciones || !validaciones.length) return { valida: true };

    for (const v of validaciones) {
      let ok;
      try { ok = v.check(instruccion, layerDef); }
      catch (e) { ok = true; }

      if (!ok) {
        if (v.bloquea) {
          return {
            valida:      false,
            bloquea:     true,
            error:       v.error,
            errorParams: v.errorParams || {},
          };
        } else {
          return {
            valida:    false,
            bloquea:   false,
            preguntar: v.preguntar,
          };
        }
      }
    }

    return { valida: true };
  }

  return {
    validar,
    validarOpEspacial,
    esFormatoSoportado,
    esFormatoNoSoportado,
    getPropsValidasParaGeom,
    MAX_CATS_CATEGORIZED,
    MAX_CATS_GRADUATED,
    // DISPLAY_THRESHOLD removida — usar CLIP_THRESHOLDS (layers/index.js)
    // o la función interna _estaRestringida() de este módulo.
    FORMATOS_SOPORTADOS,
    FORMATOS_NO_SOPORTADOS,
  };

})();
