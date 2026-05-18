# Formato de los diccionarios GEO_MAPS

Documentación del sistema de normalización geográfica de Casux.

---

## Qué es GEO_MAPS

`window.GEO_MAPS` es un diccionario jerárquico que mapea nombres geográficos
escritos por el usuario (con o sin tildes, en cualquier capitalización) al valor
exacto que espera el servidor WFS del organismo oficial.

Lo usan dos partes del sistema:

- **`intent.js`** — para resolver pedidos directamente sin llamar al LLM:
  "localidades de Salta" → capa + filtro CQL, sin gasto de API.
- **`spatial.js`** — para normalizar el `value` que emite el LLM antes del
  fetch WFS, evitando fallbacks y haciendo las operaciones más rápidas.

---

## Estructura de `window.GEO_MAPS`

```
window.GEO_MAPS = {
  [pais]: {                        // código ISO 2 letras: 'ar', 'uy', 'cl'...
    [tipo]: {
      valores:  { ... },           // diccionario normNombre → entrada
      layerKey: 'clave_en_LAYERS', // debe coincidir exactamente con window.LAYERS
      tipo:     'provincia',       // string libre, usado por intent.js
      nivel:    2,                 // jerarquía: 2=provincia, 3=depto, 4=localidad
    }
  }
}
```

### Niveles jerárquicos (convención)

| nivel | Descripción | Ejemplo AR | Ejemplo UY |
|-------|-------------|------------|------------|
| 1 | Nación / estado soberano | — | — |
| 2 | Primera subdivisión | Provincia | Departamento |
| 3 | Segunda subdivisión | Departamento / Municipio | Municipio |
| 4 | Tercera subdivisión | Localidad | — |

El nivel se usa para desambiguar: si "Salta" existe como provincia (nivel 2)
y como localidad (nivel 4), `intent.js` prefiere el nivel más bajo (más general).

---

## Formato de cada entrada en `valores`

### Entrada única (sin ambigüedad)

```javascript
// Unidad con jerarquía superior conocida
'rosario': { provincia: 'Santa Fe', value: 'Rosario' },

// Unidad de primer nivel (provincia, departamento nacional)
'salta': { provincia: null, value: 'Salta' },

// Cuando el WFS no provee campo de agrupación
'montevideo': { value: 'MONTEVIDEO' },
```

**Reglas:**
- La clave es el nombre en **minúsculas, sin tildes, sin puntuación**
- `value` es el nombre **exactamente como lo devuelve el WFS** (tildes y mayúsculas incluidas)
- `provincia: null` es obligatorio para unidades de primer nivel — no omitirlo

### Entrada ambigua (mismo nombre en varias unidades superiores)

```javascript
'san martin': [
  { provincia: 'Mendoza',    value: 'San Martín' },
  { provincia: 'Santa Fe',   value: 'San Martín' },
  { provincia: 'Corrientes', value: 'San Martín' },
],
```

Cuando hay ambigüedad, `intent.js` la detecta y deriva al LLM para que
el usuario aclare. `spatial.js` toma el primer entry como fallback.

### ⚠️ Formato obsoleto — no usar

```javascript
// INCORRECTO — string plano, no usar en diccionarios nuevos
'salta': 'Salta',
```

El formato string plano existe en algunos diccionarios legacy pero no debe
usarse en diccionarios nuevos. Siempre usar `{ value }`.

---

## Archivos por país

```
geo_maps/
  index.js          ← ensambla window.GEO_MAPS desde todos los países
  ar/
    index.js        ← exporta AR_GEO_MAPS con todas las entradas de AR
    provincias.js   ← PROVINCIAS_MAP_AR
    departamentos.js← DEPARTAMENTOS_MAP_AR
    localidades.js  ← LOCALIDADES_MAP_AR (generado por script)
  uy/
    index.js        ← exporta UY_GEO_MAPS
    departamentos.js← DEPARTAMENTOS_MAP_UY
    municipios.js   ← MUNICIPIOS_MAP_UY (generado por script)
  FORMATO.md        ← este archivo
  TEMPLATE.js       ← punto de partida para un país nuevo
```

---

## Cómo agregar un país nuevo

Ver `AGREGAR_FUENTE_WFS.md` (en la raíz del repo) para el proceso completo.
Resumen:

1. Crear `geo_maps/[pais]/[tipo].js` con el diccionario
2. Crear `geo_maps/[pais]/index.js` usando `TEMPLATE.js` como base
3. Agregar la entrada en `geo_maps/index.js`
4. Verificar en consola: `Object.keys(window.GEO_MAPS.[pais].[tipo].valores).length`

---

## Scripts de generación

Los diccionarios de localidades y municipios se generan desde el WFS oficial,
no se escriben a mano. Los scripts viven en `scripts/fetch_*.js` y se corren
desde la consola del browser en `casux.vercel.app/chat`.

Ver `AGREGAR_FUENTE_WFS.md` sección 7 para el proceso detallado.
