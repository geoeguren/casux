[🇦🇷 Español](README.es.md) · **🇬🇧 English**

# Casux

**Type what you want. Casux maps it.**

Casux is a conversational interface for building geographic maps with official open data. No GIS knowledge required. Type in plain language, Casux interprets your request and renders the map in seconds.

→ **Live demo:** [casux.vercel.app](https://casux.vercel.app)

---

## The problem it solves

Cartographic agencies across South America — IGN, IGM, IBGE and others — publish open, official geospatial data. The catch: accessing that data today requires knowing WFS, QGIS, GeoJSON or CQL queries. These technical barriers lock out journalists, educators, students and anyone who simply needs to make a map.

Casux removes that barrier.

---

## How it works

1. **Type** what you want in plain language — as if you were telling a person.
2. **Casux interprets** your request, identifies the relevant layers and queries them in real time from official sources.
3. **Adjust** colors, styles, legend and other details from the interface.
4. **Export** the result in whichever format you need.

```
Example: "Show me the national roads in Patagonia"
         → automatically loads the national road network, clips to the area, renders the map
```

---

## Features

### Conversational mapping
- Plain language input in Spanish, English and Portuguese
- Local intent engine (no network latency for common commands)
- LLM fallback for complex or ambiguous requests
- Conversation history and saved maps

### Geographic layers
Official data from public sources, queried in real time via WFS/REST:

**Argentina (IGN):** provinces, departments, municipalities, localities, hamlets, rivers, lakes, reservoirs, national and provincial road networks, railways, airports, ports, coastlines, maritime limits, contour lines, protected areas, and 190+ available layers.

**Uruguay (IGM):** departments, municipalities, and administrative boundary layers.

**Chile (MOP):** road network, airports, ports, water infrastructure, health centers, protected areas, and more via ArcGIS REST services.

**Coming soon:** Bolivia, Brazil, Colombia, Ecuador, Paraguay, Peru, Venezuela.

### Spatial analysis

Casux supports seven spatial operations, each with an exclude variant:

| Operation | What it does | Example |
|---|---|---|
| **Clip** | Crops features to the boundary of an area | "rivers of Córdoba" |
| **Clip exclude** | Keeps features *outside* an area | "airports outside Buenos Aires" |
| **Intersect** | Returns complete features that touch an area (unclipped) | "national roads passing through Salta" |
| **Intersect exclude** | Returns features that do *not* touch an area | "roads that don't pass through Córdoba" |
| **Within layer** | Features within N km of a reference point or area | "airports within 200km of Rosario" |
| **Within layer exclude** | Features *more than* N km away | "airports more than 500km from Buenos Aires" |
| **Dissolve** | Merges a set of features into a single polygon | "merge the Patagonian provinces" |
| **Dissolve exclude** | Merges features *outside* a reference area | "merge all provinces except Patagonia" |
| **Adjacent** | Features that share a border with a reference area | "provinces bordering Santa Fe" |
| **Adjacent exclude** | Features that do *not* share a border | "provinces not bordering Buenos Aires" |
| **Nearest** | The N closest features to a reference | "the 5 nearest airports to Mendoza" |
| **Nearest exclude** | The N *farthest* features from a reference | "the airport farthest from Buenos Aires" |

Operations are resolved locally by the intent engine when the layer and reference area are unambiguous, and fall back to the LLM for complex or multi-step requests.

Areas of influence and reference points support informal geographic regions (Patagonia, NOA, NEA, Cuyo, Mesopotamia for Argentina; Norte Grande, Zona Central, Austral for Chile; Sur, Este, Litoral for Uruguay) and multiple simultaneous areas ("airports in Córdoba and Mendoza").

### Export
- **JPEG** — high-resolution image ready to publish
- **PDF** — document with map and legend
- **GeoJSON** — vector data for use in QGIS, ArcGIS or other tools
- **HTML** — interactive map embeddable in any website

### Interface
- Light / dark theme (manual or automatic based on time of day)
- Feature identification mode (click on the map to see attributes)
- Layers panel with visibility, order, color, fill, stroke width and opacity controls
- Location search
- Anonymous and authenticated sessions

---

## Tech stack

- **Frontend:** vanilla JavaScript, Leaflet
- **Backend:** Vercel Serverless Functions (Node.js) + Cloudflare Workers (lightweight endpoints)
- **Data:** WFS (OGC Web Feature Service) and REST/ArcGIS; layer snapshots cached in Cloudflare R2
- **AI:** Cerebras → Groq → Gemini pipeline with automatic fallback (token streaming)
- **Persistence:** Turso (SQLite) for chats and analytics
- **Spatial processing:** Turf.js (in Web Workers), with edge function fallback for heavy operations

---

## Coverage

| Country | Status |
|---|---|
| 🇦🇷 Argentina | ✅ Available |
| 🇺🇾 Uruguay | ✅ Available |
| 🇨🇱 Chile | ✅ Available |
| 🇧🇴 Bolivia | 🔜 Coming soon |
| 🇧🇷 Brazil | 🔜 Coming soon |
| 🇨🇴 Colombia | 🔜 Coming soon |
| 🇪🇨 Ecuador | 🔜 Coming soon |
| 🇵🇾 Paraguay | 🔜 Coming soon |
| 🇵🇪 Peru | 🔜 Coming soon |
| 🇻🇪 Venezuela | 🔜 Coming soon |

---

## Data sources

Casux exclusively uses data from official public agencies:

- **Instituto Geográfico Nacional (IGN)** — Argentina — [ign.gob.ar](https://www.ign.gob.ar)
- **Instituto Geográfico Militar (IGM)** — Uruguay — [igm.gub.uy](https://www.igm.gub.uy)
- **Ministerio de Obras Públicas (MOP)** — Chile — [mop.gob.cl](https://www.mop.gob.cl)

Data is fetched in real time via OGC standards (WFS 1.1.0 / ArcGIS REST) and cached locally in IndexedDB for 24 hours to improve performance.

---

## Adding coverage for a new country

The project is designed to make contributing data for new countries straightforward. See [`geo_maps/TEMPLATE.js`](geo_maps/TEMPLATE.js) and [`geo_maps/FORMATO.md`](geo_maps/FORMATO.md) for the expected format, and [`layers/sources.js`](layers/sources.js) to register new WFS sources.

---

## Use cases

**Data journalism:** a journalist can generate in minutes a map of mining concessions, polluted rivers or school distribution — without needing a technical intermediary.

**Education:** geography, social sciences or urban planning teachers and students can explore administrative divisions, hydrography and infrastructure across the whole region.

**Research:** analysts and academics can export layers as GeoJSON to process in other tools or cross-reference with their own data.

**Civic use:** anyone can visualize public data that affects their territory — protected areas, road networks, jurisdictional boundaries — without any technical training.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## License

This project is distributed under the [GNU Affero General Public License v3.0 (AGPLv3)](LICENSE).

You are free to use, study, modify and distribute Casux, provided that any derivative work is published under the same license. If you offer Casux as a service on a server, you must publish the source code of your version.

For commercial uses that are not compatible with the AGPLv3, contact me to discuss a separate commercial license.

---

*Your next map starts with a sentence.*

© 2026 Casux
