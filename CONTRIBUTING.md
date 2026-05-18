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

Esta es una de las contribuciones más valiosas. El proceso está documentado en:

- [`geo_maps/TEMPLATE.js`](geo_maps/TEMPLATE.js) — formato esperado para los datos geográficos
- [`geo_maps/FORMATO.md`](geo_maps/FORMATO.md) — especificación detallada
- [`layers/sources.js`](layers/sources.js) — cómo registrar una nueva fuente WFS

En líneas generales:

1. Identificá el organismo cartográfico oficial del país (equivalente al IGN en Argentina)
2. Verificá que tenga un servidor WFS público
3. Seguí el template para crear los archivos de capas
4. Abrí un Pull Request con tu contribución

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

This is one of the most valuable contributions. The process is documented in:

- [`geo_maps/TEMPLATE.js`](geo_maps/TEMPLATE.js) — expected format for geographic data
- [`geo_maps/FORMATO.md`](geo_maps/FORMATO.md) — detailed specification
- [`layers/sources.js`](layers/sources.js) — how to register a new WFS source

In broad strokes: identify the official cartographic agency for the country, verify it has a public WFS server, follow the template to create the layer files, and open a Pull Request.

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
