/**
 * layers/countries.js — Lista canónica de países de Casux
 *
 * Fuente de verdad única para el estado de cobertura por país.
 * Consumida por src/landing.js y src/status.js.
 *
 * status:
 *   'active' → datos disponibles y funcionando
 *   'soon'   → en desarrollo o con errores conocidos
 *   null     → sin datos todavía (próximamente)
 *
 * Para agregar un país:
 *   1. Agregar su entrada acá
 *   2. Agregar su nombre en los diccionarios i18n de landing.js
 *   3. Crear layers/[code]/index.js con sus capas (cuando esté listo)
 */

window.COUNTRIES = [
  { code: 'ar', status: 'active' },
  { code: 'bo', status:  null   },
  { code: 'br', status:  null   },
  { code: 'cl', status: 'soon'  },
  { code: 'co', status:  null   },
  { code: 'ec', status:  null   },
  { code: 'gy', status:  null   },
  { code: 'pe', status:  null   },
  { code: 'py', status:  null   },
  { code: 'sr', status:  null   },
  { code: 'uy', status: 'active' },
  { code: 've', status:  null   },
];
