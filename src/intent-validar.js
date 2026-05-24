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
 *     - featureCount > 55000 → bloqueada por umbral de display
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
  const DISPLAY_THRESHOLD    = 55000;// featureCount máximo para mostrar sin recorte

  const FORMATOS_SOPORTADOS = new Set(['jpeg', 'pdf', 'geojson', 'html']);
  const FORMATOS_NO_SOPORTADOS = new Set(['shapefile', 'shp', 'csv', 'xlsx', 'xls', 'kml', 'kmz', 'gpx', 'dxf', 'dwg']);

  const GEOM_PROPS_VALIDAS = {
    point:   new Set(['color', 'radius', 'weight', 'icon', 'geom', 'opacity']),
    line:    new Set(['color', 'weight', 'opacity']),
    polygon: new Set(['color', 'opacity']),
    unknown: new Set(['color', 'opacity']),
    none:    new Set(),
  };

  // ── Tabla de validaciones por acción ─────────────────────────

  const VALIDACIONES = {

    // ── clasificar ──────────────────────────────────────────────
    clasificar: [
      {
        bloquea: true,
        error:   'validate_no_layer',
        check:   (p, ctx) => !!p.mapKey && !!ctx.activeLayers[p.mapKey],
      },
      {
        bloquea: true,
        error:   'validate_classify_no_field',
        check:   (p) => !!p.field,
        // No bloqueante a nivel de validar — si field es null, el handler
        // muestra el selector de campo. Esta validación es para cuando field está definido.
      },
      {
        bloquea: true,
        error:   'validate_classify_geom_none',
        check:   (p, ctx) => {
          const geom = ctx.activeLayers[p.mapKey]?.geomType;
          return geom !== 'none' && geom !== 'unknown';
        },
      },
      {
        bloquea: true,
        error:   'validate_classify_too_many_cats',
        errorParams: () => ({ max: MAX_CATS_CATEGORIZED }),
        check:   (p, ctx) => {
          if (p.type !== 'categorized') return true; // solo aplica a categorized
          const entry = ctx.activeLayers[p.mapKey];
          if (!entry?.geojson?.features) return true; // no se puede verificar aún
          const valores = new Set(
            entry.geojson.features
              .map(f => f.properties?.[p.field])
              .filter(v => v != null && v !== '')
          );
          return valores.size <= MAX_CATS_CATEGORIZED;
        },
      },
      {
        bloquea: true,
        error:   'validate_classify_too_few_values',
        check:   (p, ctx) => {
          const entry = ctx.activeLayers[p.mapKey];
          if (!entry?.geojson?.features) return true;
          const valores = new Set(
            entry.geojson.features
              .map(f => f.properties?.[p.field])
              .filter(v => v != null && v !== '')
          );
          return valores.size >= MIN_UNIQUE_VALUES;
        },
      },
    ],

    // ── limpiar_clasificacion ────────────────────────────────────
    limpiar_clasificacion: [
      {
        bloquea: true,
        error:   'validate_no_classification',
        check:   (p, ctx) => !!ctx.activeLayers[p.mapKey]?.classification,
      },
    ],

    // ── limpiar_estilo ───────────────────────────────────────────
    limpiar_estilo: [
      {
        bloquea: true,
        error:   'validate_no_layer',
        check:   (p, ctx) => !!p.mapKey && !!ctx.activeLayers[p.mapKey],
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
        bloquea: true,
        error:   'validate_no_layer',
        check:   (p, ctx) => !!p.mapKey && !!ctx.activeLayers[p.mapKey],
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
          return validas.has(p.propEstilo);
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
        bloquea: true,
        error:   'validate_layer_not_found',
        check:   (p, ctx) => !!p.mapKey && !!ctx.activeLayers[p.mapKey],
      },
    ],

    // ── toggle_vis_off ───────────────────────────────────────────
    toggle_vis_off: [
      {
        bloquea: true,
        error:   'validate_layer_not_found',
        check:   (p, ctx) => !!p.mapKey && !!ctx.activeLayers[p.mapKey],
      },
      {
        bloquea: false,
        error:   'validate_already_hidden',
        check:   (p, ctx) => ctx.activeLayers[p.mapKey]?.visible !== false,
      },
    ],

    // ── toggle_vis_on ────────────────────────────────────────────
    toggle_vis_on: [
      {
        bloquea: true,
        error:   'validate_layer_not_found',
        check:   (p, ctx) => !!p.mapKey && !!ctx.activeLayers[p.mapKey],
      },
      {
        bloquea: false,
        error:   'validate_already_visible',
        check:   (p, ctx) => ctx.activeLayers[p.mapKey]?.visible === false,
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
        check:   (p) => !p.subtipo || FORMATOS_SOPORTADOS.has(p.subtipo),
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
        bloquea: true,
        error:   'validate_layer_too_many_features',
        errorParams: (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return { titulo: layerDef?.titulo || p.layerKey, n: layerDef?.featureCount?.toLocaleString() };
        },
        check:   (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          if (!layerDef?.featureCount) return true;
          const threshold = window.CLIP_THRESHOLDS?.display ?? DISPLAY_THRESHOLD;
          return layerDef.featureCount <= threshold;
        },
      },
    ],

    // ── agregar ──────────────────────────────────────────────────
    agregar: [
      {
        bloquea: true,
        error:   'validate_no_active_layers_to_add',
        check:   (p, ctx) => Object.keys(ctx.activeLayers).length > 0,
      },
      {
        bloquea: false,
        error:   'validate_layer_already_on_map',
        check:   (p, ctx) => {
          if (!p.layerKey) return true;
          return !Object.values(ctx.activeLayers).some(e => e.layerKey === p.layerKey);
        },
      },
      // Hereda las validaciones de 'capa' para el featureCount
      {
        bloquea: true,
        error:   'validate_layer_too_many_features',
        errorParams: (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          return { titulo: layerDef?.titulo || p.layerKey, n: layerDef?.featureCount?.toLocaleString() };
        },
        check:   (p) => {
          const layerDef = window.LAYERS?.[p.layerKey];
          if (!layerDef?.featureCount) return true;
          const threshold = window.CLIP_THRESHOLDS?.display ?? DISPLAY_THRESHOLD;
          return layerDef.featureCount <= threshold;
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

  return {
    validar,
    esFormatoSoportado,
    esFormatoNoSoportado,
    getPropsValidasParaGeom,
    MAX_CATS_CATEGORIZED,
    MAX_CATS_GRADUATED,
    DISPLAY_THRESHOLD,
    FORMATOS_SOPORTADOS,
    FORMATOS_NO_SOPORTADOS,
  };

})();
