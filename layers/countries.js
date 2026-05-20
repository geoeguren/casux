/**
 * layers/countries.js — Lista canónica de países de Casux
 *
 * Fuente de verdad única para estado de cobertura y nombres por país.
 * Consumida por src/landing.js y src/status.js.
 *
 * status:
 *   'active' → datos disponibles y funcionando
 *   'soon'   → en desarrollo o con errores conocidos
 *   null     → sin datos todavía (próximamente)
 *
 * Para agregar un país: solo tocar este archivo.
 */

window.COUNTRIES = [
  { code: 'ar', status: 'active', es: 'Argentina', en: 'Argentina',  pt: 'Argentina'  },
  { code: 'bo', status:  null,    es: 'Bolivia',   en: 'Bolivia',    pt: 'Bolívia'    },
  { code: 'br', status:  null,    es: 'Brasil',    en: 'Brazil',     pt: 'Brasil'     },
  { code: 'cl', status: 'soon',   es: 'Chile',     en: 'Chile',      pt: 'Chile'      },
  { code: 'co', status:  null,    es: 'Colombia',  en: 'Colombia',   pt: 'Colômbia'   },
  { code: 'ec', status:  null,    es: 'Ecuador',   en: 'Ecuador',    pt: 'Equador'    },
  { code: 'gy', status:  null,    es: 'Guyana',    en: 'Guyana',     pt: 'Guiana'     },
  { code: 'pe', status:  null,    es: 'Perú',      en: 'Peru',       pt: 'Peru'       },
  { code: 'py', status:  null,    es: 'Paraguay',  en: 'Paraguay',   pt: 'Paraguai'   },
  { code: 'sr', status:  null,    es: 'Surinam',   en: 'Suriname',   pt: 'Suriname'   },
  { code: 'uy', status: 'active', es: 'Uruguay',   en: 'Uruguay',    pt: 'Uruguai'    },
  { code: 've', status:  null,    es: 'Venezuela', en: 'Venezuela',  pt: 'Venezuela'  },
];

// Labels por idioma para los badges de estado — igual que landing.js
window.COUNTRIES_LABELS = {
  es: { active: 'Disponible',  soon: 'Próximamente' },
  en: { active: 'Available',   soon: 'Coming soon'  },
  pt: { active: 'Disponível',  soon: 'Em breve'     },
};
