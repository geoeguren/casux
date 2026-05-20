# Contribuir a Casux · Contributing to Casux

[🇦🇷 Español](#español) · [🇬🇧 English](#english)

---

## Español

Gracias por tu interés en contribuir. Casux es un proyecto open source orientado a democratizar el acceso a datos geográficos oficiales en América del Sur — cualquier mejora, por pequeña que sea, suma.

### Formas de contribuir

No hace falta saber programar para contribuir. Hay varias formas de ayudar:

- **Reportar un bug** — algo no funciona como esperabas
- **Sugerir una mejora** — una funcionalidad que le faltaría al proyecto
- **Agregar datos de un nuevo país** — capas WFS de organismos cartográficos oficiales
- **Mejorar la documentación** — correcciones, traducciones, ejemplos
- **Escribir código** — fixes, nuevas features, optimizaciones

### Reportar un bug

1. Buscá primero en los [issues existentes](https://github.com/geoeguren/casux/issues) — puede que ya esté reportado.
2. Si no está, abrí un [nuevo issue](https://github.com/geoeguren/casux/issues/new) con:
   - Descripción clara del problema
   - Pasos para reproducirlo
   - Resultado esperado vs. resultado obtenido
   - Capturas de pantalla si aplica
   - Navegador y sistema operativo

### Agregar cobertura de un nuevo país

Esta es una de las contribuciones más valiosas. El proceso completo involucra varios archivos — seguí todos los pasos para que el país quede funcionando correctamente en todos los aspectos de la app.

**1. Datos geográficos**

- [`geo_maps/TEMPLATE.js`](geo_maps/TEMPLATE.js) — formato esperado para los datos geográficos
- [`geo_maps/FORMATO.md`](geo_maps/FORMATO.md) — especificación detallada
- Crear `geo_maps/[pais]/` con los archivos de regiones/departamentos/municipios
- Agregar el índice en `geo_maps/index.js`

**2. Capas WFS/REST**

- [`layers/sources.js`](layers/sources.js) — registrar la nueva fuente (URL del servidor, tipo, atribución)
- Crear `layers/[pais]/` con los archivos de capas siguiendo el schema existente
- Agregar el índice en `layers/[pais]/index.js` e importarlo en `layers/index.js`

**3. Reglas del LLM** — este paso se omite con frecuencia y es crítico

- `api/prompts/_shared.js` → `buildReglasRegiones()`: agregar las regiones/provincias/departamentos del nuevo país para que el LLM pueda usar `clipArea` correctamente
- `api/prompts/_shared.js` → `buildReglasCQL()`: agregar los campos de filtro geográfico específicos de las capas del nuevo país (equivalente a las reglas de Argentina, Uruguay y Chile ya documentadas)
- `api/prompts/_es.js`, `_en.js`, `_pt.js` → `reglasCobertura`: el LLM necesita saber qué países tiene disponibles para no inventar datos de países sin cobertura

**4. Documentación**

- `README.md` y `README.es.md`: mover el país de "Coming soon" a "Available" en la tabla de cobertura, agregarlo en la descripción de capas geográficas y en la sección de fuentes de datos

### Proponer una mejora

Abrí un [issue](https://github.com/geoeguren/casux/issues/new) describiendo qué problema resuelve, cómo la imaginás funcionando, y si tenés alguna referencia de otra herramienta. No hace falta que la implementes vos — la discusión también es valiosa.

### Contribuir código

**Setup**

```bash
git clone https://github.com/geoeguren/casux.git
cd casux
```

Para correr localmente necesitás la [Vercel CLI](https://vercel.com/docs/cli):

```bash
npm install -g vercel
vercel dev
```

Copiá `.env.example` a `.env.local` y completá las claves necesarias (LLM providers, Firebase). No commitees claves reales.

**Flujo de trabajo**

1. Forkeá el repositorio
2. Creá una rama descriptiva: `git checkout -b fix/nombre-del-bug` o `feat/nombre-de-feature`
3. Hacé tus cambios
4. Verificá que funcione en Chrome y Firefox
5. Abrí un Pull Request hacia `main` con una descripción clara de qué cambia y por qué

**Convenciones**

- El código existente está en español (variables, comentarios, funciones) — mantené esa convención
- Cada módulo JS se expone como `window.NOMBRE_MODULO`
- Los mensajes de UI pasan siempre por el sistema de i18n (`t('clave')`) — no pongas strings hardcodeados directamente

### Preguntas

Abrí un issue con la etiqueta `question`. Es mejor alinear antes que hacer trabajo en vano.

---

## English

Thank you for your interest in contributing. Casux is an open source project aimed at democratizing access to official geographic data in South America — any improvement, however small, makes a difference.

### Ways to contribute

You don't need to know how to code to contribute:

- **Report a bug** — something isn't working as expected
- **Suggest an improvement** — a feature the project is missing
- **Add data for a new country** — WFS layers from official cartographic agencies
- **Improve documentation** — corrections, translations, examples
- **Write code** — fixes, new features, optimizations

### Reporting a bug

1. First search the [existing issues](https://github.com/geoeguren/casux/issues) — it may already be reported.
2. If not, open a [new issue](https://github.com/geoeguren/casux/issues/new) with a clear description, steps to reproduce, expected vs. actual result, screenshots if applicable, and your browser and OS.

### Adding coverage for a new country

This is one of the most valuable contributions. The process spans several files — follow all steps to ensure the country works correctly across every part of the app.

**1. Geographic data**

- [`geo_maps/TEMPLATE.js`](geo_maps/TEMPLATE.js) — expected format for geographic data
- [`geo_maps/FORMATO.md`](geo_maps/FORMATO.md) — detailed specification
- Create `geo_maps/[country]/` with region/department/municipality files
- Register it in `geo_maps/index.js`

**2. WFS/REST layers**

- [`layers/sources.js`](layers/sources.js) — register the new source (server URL, type, attribution)
- Create `layers/[country]/` with layer files following the existing schema
- Add the index in `layers/[country]/index.js` and import it in `layers/index.js`

**3. LLM rules** — this step is frequently missed and is critical

- `api/prompts/_shared.js` → `buildReglasRegiones()`: add the regions/provinces/departments of the new country so the LLM can use `clipArea` correctly
- `api/prompts/_shared.js` → `buildReglasCQL()`: add the geographic filter fields specific to the new country's layers (equivalent to the existing Argentina, Uruguay and Chile rules)
- `api/prompts/_es.js`, `_en.js`, `_pt.js` → coverage rules: the LLM needs to know which countries are available so it doesn't fabricate data for uncovered countries

**4. Documentation**

- `README.md` and `README.es.md`: move the country from "Coming soon" to "Available" in the coverage table, add it to the geographic layers description and the data sources section

### Contributing code

**Setup**

```bash
git clone https://github.com/geoeguren/casux.git
cd casux
npm install -g vercel
vercel dev
```

Copy `.env.example` to `.env.local` and fill in the required keys. Do not commit real keys.

**Workflow**

1. Fork the repository
2. Create a descriptive branch: `git checkout -b fix/bug-name` or `feat/feature-name`
3. Make your changes and verify in Chrome and Firefox
4. Open a Pull Request to `main` with a clear description of what changes and why

**Conventions**

- Existing code uses Spanish for variables, comments and function names — maintain that convention
- Each JS module is exposed as `window.MODULE_NAME`
- UI strings always go through the i18n system (`t('key')`) — don't hardcode strings directly

### Questions

Open an issue with the `question` label before starting work on something significant.

---

*This project is distributed under the [AGPLv3](LICENSE).*
