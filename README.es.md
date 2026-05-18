**🇦🇷 Español** · [🇬🇧 English](README.md)

# Casux

**Escribí lo que querés. Casux lo mapea.**

Casux es una interfaz conversacional para construir mapas geográficos con datos oficiales. Sin tecnicismos, sin curva de aprendizaje. Escribís en lenguaje natural, Casux interpreta y genera el mapa en segundos.

→ **Demo en vivo:** [casux.vercel.app](https://casux.vercel.app)

---

## El problema que resuelve

Los organismos cartográficos de América del Sur (IGN, IGM, IBGE y otros) publican datos geoespaciales abiertos y oficiales. El problema es que acceder a esos datos hoy requiere conocer WFS, QGIS, GeoJSON o consultas CQL — barreras técnicas que dejan fuera a periodistas, docentes, estudiantes y cualquier persona que simplemente necesite hacer un mapa.

Casux elimina esa barrera.

---

## Cómo funciona

1. **Escribís** lo que querés en lenguaje natural — como si se lo dijeras a alguien.
2. **Casux interpreta** tu pedido, identifica las capas relevantes y las consulta en tiempo real desde fuentes oficiales.
3. **Ajustás** colores, estilos, leyenda y otros detalles desde la interfaz.
4. **Exportás** el resultado en el formato que necesitás.

```
Ejemplo: "Mostrame las rutas nacionales de la Patagonia"
         → carga automáticamente red vial nacional, recorta al área, renderiza el mapa
```

---

## Funcionalidades

### Mapeo conversacional
- Lenguaje natural en español, inglés y portugués
- Motor de intenciones local (sin latencia de red para comandos frecuentes)
- Fallback a LLM para pedidos complejos o ambiguos
- Historial de conversaciones y mapas guardados

### Capas geográficas
Datos oficiales de fuentes públicas, consultados en tiempo real vía WFS/REST:

**Argentina (IGN):** provincias, departamentos, municipios, localidades, parajes, ríos, lagos, embalses, red vial nacional y provincial, ferrocarriles, aeropuertos, puertos, costas, límites marítimos, curvas de nivel, áreas protegidas, y más de 190 capas disponibles.

**Uruguay (IGM):** departamentos, municipios, y capas de límites administrativos.

**Próximamente:** Bolivia, Brasil, Chile, Colombia, Ecuador, Paraguay, Perú, Venezuela.

### Análisis espacial
- **Buffer:** área de influencia alrededor de una o más entidades
- **Clip:** recorte de una capa dentro de un área definida
- **Intersect:** features que se superponen con un área dada
- Variantes exclude para cada operación

### Exportación
- **JPEG** — imagen de alta resolución lista para publicar
- **PDF** — documento con mapa y leyenda
- **GeoJSON** — datos vectoriales para usar en QGIS, ArcGIS u otras herramientas
- **HTML** — mapa interactivo embebible en cualquier sitio web

### Interfaz
- Tema claro / oscuro (manual o automático según horario)
- Modo de identificación de features (click sobre el mapa para ver atributos)
- Panel de capas con control de visibilidad, orden, color, relleno, grosor y opacidad
- Búsqueda de ubicaciones
- Autenticación anónima y con cuenta

---

## Tecnología

- **Frontend:** JavaScript vanilla, MapLibre GL JS
- **Backend:** Vercel Serverless Functions (Node.js)
- **Datos:** WFS (OGC Web Feature Service) y REST/ArcGIS
- **IA:** pipeline con Cerebras → Groq → Gemini como fallback (streaming de tokens)
- **Persistencia:** Firebase Firestore
- **Procesamiento espacial:** Turf.js (en Web Workers)

---

## Cobertura

| País | Estado |
|---|---|
| 🇦🇷 Argentina | ✅ Disponible |
| 🇺🇾 Uruguay | ✅ Disponible |
| 🇧🇴 Bolivia | 🔜 Próximamente |
| 🇧🇷 Brasil | 🔜 Próximamente |
| 🇨🇱 Chile | 🔜 Próximamente |
| 🇨🇴 Colombia | 🔜 Próximamente |
| 🇪🇨 Ecuador | 🔜 Próximamente |
| 🇵🇾 Paraguay | 🔜 Próximamente |
| 🇵🇪 Perú | 🔜 Próximamente |
| 🇻🇪 Venezuela | 🔜 Próximamente |

---

## Fuentes de datos

Casux utiliza exclusivamente datos de organismos oficiales con acceso público:

- **Instituto Geográfico Nacional (IGN)** — Argentina — [ign.gob.ar](https://www.ign.gob.ar)
- **Instituto Geográfico Militar (IGM)** — Uruguay — [igm.gub.uy](https://www.igm.gub.uy)

Los datos se consultan en tiempo real vía estándares OGC (WFS 1.1.0) y se cachean localmente en IndexedDB por 24 horas para mejorar el rendimiento.

---

## Agregar cobertura de un país nuevo

El proyecto está diseñado para que sea sencillo contribuir con datos de nuevos países. Ver [`geo_maps/TEMPLATE.js`](geo_maps/TEMPLATE.js) y [`geo_maps/FORMATO.md`](geo_maps/FORMATO.md) para el formato esperado, y [`layers/sources.js`](layers/sources.js) para registrar nuevas fuentes WFS.

---

## Casos de uso

**Periodismo de datos:** un periodista puede generar en minutos un mapa de concesiones mineras, ríos contaminados o distribución de escuelas — sin intermediarios técnicos.

**Educación:** docentes y estudiantes de geografía, ciencias sociales o urbanismo pueden explorar divisiones administrativas, hidrografía e infraestructura de toda la región.

**Investigación:** analistas y académicos pueden exportar capas en GeoJSON para procesarlas en otras herramientas o cruzarlas con datos propios.

**Ciudadanía:** cualquier persona puede visualizar datos públicos que afectan su territorio — áreas protegidas, redes viales, límites jurisdiccionales — sin necesitar capacitación técnica.

---

## Licencia

Este proyecto se distribuye bajo la [GNU Affero General Public License v3.0 (AGPLv3)](LICENSE).

Eso significa que podés usar, estudiar, modificar y distribuir Casux libremente, siempre que cualquier trabajo derivado se publique bajo la misma licencia. Si ofrecés Casux como servicio en un servidor, debés publicar el código fuente de tu versión.

Para usos comerciales que no sean compatibles con la AGPLv3, contactame para una licencia comercial separada.

---

## Contacto

¿Preguntas, sugerencias o querés colaborar?

→ Abrí un [issue](https://github.com/tuusuario/casux/issues) en este repositorio.

---

*Tu próximo mapa empieza con una frase.*

© 2026 Casux
