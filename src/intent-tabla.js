/**
 * src/intent/intent-tabla.js — Tabla declarativa de acciones
 *
 * Resuelve la acción final a partir de la tupla (GRUPO_VERBAL, TIPO_OBJETO).
 *
 * Acciones posibles:
 *   'limpiar'                → vaciar el mapa
 *   'quitar'                 → eliminar una capa del mapa
 *   'toggle_vis_off'         → ocultar capa (reversible)
 *   'toggle_vis_on'          → mostrar capa oculta
 *   'capa'                   → cargar capa nueva
 *   'agregar'                → agregar capa al mapa activo
 *   'estilo_vago'            → cambiar estilo (selector de propiedad)
 *   'estilo_resuelto'        → cambiar estilo (valor ya resuelto)
 *   'clasificar'             → clasificar capa por campo
 *   'limpiar_clasificacion'  → quitar clasificación de una capa
 *   'limpiar_estilo'         → resetear estilo de una capa al default
 *   'basemap'                → cambiar mapa de fondo
 *   'renombrar'              → cambiar nombre del chat/mapa
 *   'export'                 → exportar el mapa
 *   'filtrar'                → filtrar objetos de una capa cargada
 *   'selector_capa'          → mostrar selector de capa (ambiguo)
 *   'LLM'                    → derivar al LLM
 *   null                     → ignorar (no aplica)
 */

window.INTENT_TABLA = (() => {

  // ── Tabla (GRUPO_VERBAL × TIPO_OBJETO) → ACCION ──────────────
  //
  // Formato: TABLA[grupo_verbal][tipo_objeto] = accion
  // Valores especiales:
  //   'LLM'           → el LLM puede hacer esto mejor
  //   'selector_capa' → pedir al usuario que especifique la capa
  //   null            → acción inválida o sin sentido, ignorar

  const TABLA = {

    // ── CARGAR ────────────────────────────────────────────────────
    // "mostrá X" / "dame X" / "cargá X"
    CARGAR: {
      NUEVA_CAPA:   'capa',
      CAPA_ACTIVA:  'toggle_vis_on',   // la capa ya existe → mostrarla
      MAPA:         null,              // "mostrá el mapa" → sin sentido
      CLASIFICACION:'LLM',
      ESTILO_PROP:  null,
      BASEMAP:      null,
      NOMBRE:       null,
      FILTRO:       null,
      AMBIGUO:      'LLM',
    },

    // ── AGREGAR ───────────────────────────────────────────────────
    // "agregá X" / "también mostrá X"
    AGREGAR: {
      NUEVA_CAPA:   'agregar',
      CAPA_ACTIVA:  'toggle_vis_on',   // ya cargada pero oculta → mostrar
      MAPA:         null,
      CLASIFICACION:'LLM',
      ESTILO_PROP:  null,
      BASEMAP:      null,
      NOMBRE:       null,
      FILTRO:       null,
      AMBIGUO:      'LLM',
    },

    // ── BORRAR ────────────────────────────────────────────────────
    // "borrá X" / "eliminá X" / "quitá X" / "sacá X" / "limpiá X"
    BORRAR: {
      MAPA:         'limpiar',
      CAPA_ACTIVA:  'quitar',
      NUEVA_CAPA:   'LLM',            // "borrá los aeropuertos" — no está cargada
      CLASIFICACION:'limpiar_clasificacion',
      ESTILO_PROP:  'limpiar_estilo',
      BASEMAP:      null,             // no se puede "borrar" el basemap
      NOMBRE:       null,
      FILTRO:       'limpiar_filtro',
      AMBIGUO:      'selector_capa',  // ¿qué querés borrar?
    },

    // ── OCULTAR ───────────────────────────────────────────────────
    // "ocultá X" / "escondé X" / "hide X"
    OCULTAR: {
      CAPA_ACTIVA:  'toggle_vis_off',
      MAPA:         null,             // no se puede ocultar el mapa entero
      NUEVA_CAPA:   'LLM',
      CLASIFICACION:'limpiar_clasificacion', // "ocultá la clasificación"
      ESTILO_PROP:  null,
      BASEMAP:      null,
      NOMBRE:       null,
      FILTRO:       null,
      AMBIGUO:      'selector_capa',
    },

    // ── MOSTRAR_VIS ───────────────────────────────────────────────
    // "mostrá X" (capa ya cargada) / "activá X" / "volvé a mostrar X"
    MOSTRAR_VIS: {
      CAPA_ACTIVA:  'toggle_vis_on',
      NUEVA_CAPA:   'capa',           // no está cargada → cargar
      MAPA:         null,
      CLASIFICACION:'LLM',
      ESTILO_PROP:  null,
      BASEMAP:      null,
      NOMBRE:       null,
      FILTRO:       null,
      AMBIGUO:      'selector_capa',
    },

    // ── ESTILO ────────────────────────────────────────────────────
    // "cambiá el color" / "hacelo más grande" / "poné rojo"
    ESTILO: {
      CAPA_ACTIVA:  'estilo_vago',    // resolución de valor se hace en validar
      ESTILO_PROP:  'estilo_vago',
      MAPA:         null,
      NUEVA_CAPA:   'LLM',
      CLASIFICACION:'LLM',
      BASEMAP:      'basemap',        // "cambiá el basemap oscuro"
      NOMBRE:       'renombrar',      // "cambiá el nombre"
      FILTRO:       null,
      AMBIGUO:      'selector_capa',
    },

    // ── CLASIFICAR ────────────────────────────────────────────────
    // "clasificá por X" / "pinta por X"
    CLASIFICAR: {
      CAPA_ACTIVA:  'clasificar',
      MAPA:         'selector_capa', // ¿qué capa?
      NUEVA_CAPA:   'LLM',
      CLASIFICACION:'LLM',           // "clasificá la clasificación" — sin sentido → LLM
      ESTILO_PROP:  'clasificar',    // "clasificá por color" — válido
      BASEMAP:      null,
      NOMBRE:       null,
      FILTRO:       null,
      AMBIGUO:      'selector_capa',
    },

    // ── LIMPIAR_PROP ──────────────────────────────────────────────
    // "borrá la clasificación" / "resetea el estilo" / "quitá el filtro"
    LIMPIAR_PROP: {
      CLASIFICACION:'limpiar_clasificacion',
      ESTILO_PROP:  'limpiar_estilo',
      FILTRO:       'limpiar_filtro',
      CAPA_ACTIVA:  'limpiar_clasificacion', // vago → asume clasificación
      MAPA:         'limpiar',
      NUEVA_CAPA:   null,
      BASEMAP:      null,
      NOMBRE:       null,
      AMBIGUO:      'LLM',
    },

    // ── EXPORTAR ──────────────────────────────────────────────────
    // "exportá el mapa" / "descargá los datos"
    EXPORTAR: {
      MAPA:         'export',
      CAPA_ACTIVA:  'export',        // exportar los datos de esa capa
      NUEVA_CAPA:   'export',
      CLASIFICACION:'export',
      ESTILO_PROP:  null,
      BASEMAP:      null,
      NOMBRE:       null,
      FILTRO:       null,
      AMBIGUO:      'export',        // exportar siempre tiene sentido
    },

    // ── BASEMAP ───────────────────────────────────────────────────
    // "cambiá el basemap" / "poné el fondo oscuro"
    BASEMAP: {
      BASEMAP:      'basemap',
      MAPA:         'basemap',       // "cambiá el mapa" puede ser basemap
      CAPA_ACTIVA:  null,
      NUEVA_CAPA:   null,
      CLASIFICACION:null,
      ESTILO_PROP:  null,
      NOMBRE:       null,
      FILTRO:       null,
      AMBIGUO:      'LLM',
    },

    // ── RENOMBRAR ─────────────────────────────────────────────────
    // "renombrá el mapa" / "cambiá el nombre"
    RENOMBRAR: {
      NOMBRE:       'renombrar',
      MAPA:         'renombrar',
      CAPA_ACTIVA:  'renombrar',     // renombrar la capa en la leyenda
      NUEVA_CAPA:   null,
      CLASIFICACION:null,
      ESTILO_PROP:  null,
      BASEMAP:      null,
      FILTRO:       null,
      AMBIGUO:      'renombrar',     // si solo dice "renombrá" → vago
    },

    // ── FILTRAR ───────────────────────────────────────────────────
    // "filtrá los pasos con Chile" / "mostrá solo los aeropuertos internacionales"
    FILTRAR: {
      CAPA_ACTIVA:  'filtrar',
      NUEVA_CAPA:   'filtrar',       // filtrar al cargar
      MAPA:         'selector_capa',
      CLASIFICACION:'filtrar',
      ESTILO_PROP:  null,
      BASEMAP:      null,
      NOMBRE:       null,
      FILTRO:       'filtrar',
      AMBIGUO:      'selector_capa',
    },

  };

  // ── API pública ───────────────────────────────────────────────

  /**
   * resolver(grupoVerbal, tipoObjeto) → string | null
   *
   * Devuelve la acción correspondiente a la tupla (verbo, objeto).
   * Devuelve 'LLM' si el grupo o el objeto no están en la tabla.
   */
  function resolver(grupoVerbal, tipoObjeto) {
    const fila = TABLA[grupoVerbal];
    if (!fila) return 'LLM';
    return fila[tipoObjeto] ?? 'LLM';
  }

  /**
   * getAccionesValidas(grupoVerbal) → string[]
   *
   * Todas las acciones posibles para un grupo verbal dado.
   * Útil para mensajes de error y tests.
   */
  function getAccionesValidas(grupoVerbal) {
    const fila = TABLA[grupoVerbal];
    if (!fila) return [];
    return [...new Set(Object.values(fila).filter(Boolean))];
  }

  return { resolver, getAccionesValidas, TABLA };

})();
