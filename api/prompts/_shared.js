/**
 * api/prompts/_shared.js — Secciones del system prompt independientes del idioma
 *
 * Incluye: catálogo, máscaras, reglas técnicas de filtros CQL/ArcGIS,
 * reglas de operaciones espaciales, reglas de regiones, reglas de export.
 * Estas secciones no se traducen porque son instrucciones técnicas (sintaxis,
 * layerKeys, field names) que el modelo debe respetar tal cual.
 *
 * Importado por: prompts/es.js, prompts/en.js, prompts/pt.js
 */

'use strict';

function capasAContexto(capas, sources) {
  const excluir = ['gid', 'fdc', 'sag', 'entidad', 'objeto'];
  return capas.map(c => {
    const attrs = (c.attributes || [])
      .filter(a => !excluir.includes(a.campo))
      .map(a => `    ${a.campo}: ${a.label}`)
      .join('\n');
    const countInfo   = c.featureCount !== undefined ? ` [${c.featureCount} features]` : '';
    const clipInfo    = c.clipStrategy  ? ` [clip:${c.clipStrategy}]` : ' [clip:null]';
    const srcDef      = sources?.[c.source];
    const protoInfo   = srcDef?.tipo === 'arcgis' ? ' [proto:arcgis]' : ' [proto:wfs]';
    const geoFieldsInfo = c.geoFields
      ? '\n    filtros de área: ' + Object.entries(c.geoFields).map(([tipo, campo]) => `${tipo}→${campo}`).join(', ')
      : '';
    const filterInfo  = (c.filterField && Array.isArray(c.filterValues) && c.filterValues.length)
      ? `\n    filtro de subtipo: ${c.filterField} — valores posibles: ${c.filterValues.join(', ')}`
      : '';
    return `  ${c.key} — ${c.tituloUI || c.titulo} (${c.geomType})${countInfo}${clipInfo}${protoInfo}${geoFieldsInfo}${filterInfo}${attrs ? '\n' + attrs : ''}`;
  }).join('\n\n');
}

function buildCatalogo(todasLasCapas, sources) {
  const grupos = {};
  for (const [key, capa] of Object.entries(todasLasCapas)) {
    if (capa.special !== false) continue;
    const sourceKey = capa.source || 'desconocida';
    if (!grupos[sourceKey]) grupos[sourceKey] = [];
    grupos[sourceKey].push({ key, ...capa });
  }
  return Object.entries(grupos).map(([sourceKey, capas]) => {
    const src    = sources?.[sourceKey];
    const header = src
      ? `## ${src.countryLabel || src.country?.toUpperCase() || sourceKey} — ${src.label}`
      : `## ${sourceKey}`;
    const lista  = capas.map(c => `  ${c.key}: ${c.tituloUI || c.titulo}`).join('\n');
    return `${header}\n${lista}`;
  }).join('\n\n');
}

function buildMascarasDisponibles(todasLasCapas) {
  return Object.entries(todasLasCapas)
    .filter(([, c]) => c.geomType === 'polygon' && c.mask === true)
    .map(([key, c]) => {
      const fieldInfo = c.labelField ? `field="${c.labelField}"` : 'sin campo (polígono único)';
      return `  ${key}: ${fieldInfo} — ${c.tituloUI || c.titulo}`;
    })
    .join('\n') || '  (ninguna disponible)';
}

// ── Secciones técnicas (no se traducen) ──────────────────────────

function buildReglasCQL(mascaras) {
  return `FILTER RULES — SYNTAX BY PROTOCOL:

Layers show [proto:wfs] or [proto:arcgis] in their description. Filter syntax differs by protocol:

[proto:wfs] → CQL syntax (GeoServer):
- No filter: ""
- Exact text: campo='Valor Exacto con tildes'
- LIKE: strToLowerCase(campo) LIKE '%valor%'
- Multiple values: strToLowerCase(campo) IN ('valor1','valor2','valor3')  ← use IN, never OR
- Combined: strToLowerCase(pvecino)='chile' AND prov='Santa Cruz'
- Numbers: no quotes, no strToLowerCase

[proto:arcgis] → standard SQL (ArcGIS REST):
- No filter: ""
- Exact text: CAMPO='Valor Exacto'  ← exact field casing
- Multiple values: CAMPO IN ('Valor1','Valor2','Valor3')  ← use IN, never OR. NEVER use brackets: IN (['...']) is invalid.
- LIKE: CAMPO LIKE '%valor%'
- Numbers: no quotes
- NEVER use strToLowerCase() or LOWER() on [proto:arcgis] layers — not supported

- If no layer matches: [{"error":"No tengo datos para esa consulta"}]
- If user wants to clear the map: []

SUBTYPE FILTER — CRITICAL RULE:
When a layer shows "filtro de subtipo: CAMPO — valores posibles: ...", that CAMPO is the ONLY correct field for subtype filtering. NEVER use a different field name.
  [proto:wfs]:    strToLowerCase(CAMPO)='valor'
  [proto:arcgis]: CAMPO='Valor Exacto'
If the user asks for a subtype not in the list, use the closest value or LIKE.
If no specific subtype is requested, omit the filter ("filtro": ""). E.g. "trains of Argentina" → empty filter even if the layer has filterValues.

IMPORTANT — VALUES IN FILTERS: Always use the exact value with accents and casing as it appears in the data (e.g. prov='Salta', nom_pcia='Córdoba', nam='Catamarca'). Do NOT use strToLowerCase with area values — only for free-text searches in WFS layers.

GEOGRAPHIC CLIP RULE:
Some layers have their own fields for area filtering — use CQL filter directly instead of clipArea:

Argentina (IGN):
  localidad_ar, paraje_ar, sublocalidad_ar, base_antartica_ar: nom_pcia for province, nom_depto for department
  pasos_frontera_ar, complejo_fronterizo_ar: prov for province, pvecino for neighboring country
  area_montana_ar: provincia for province

Uruguay (MTOP):
  camineria_nacional_uy, rutas_nacionales_uy, puentes_carreteros_uy, peajes_uy,
  peajes_otros_uy, obras_camineria_uy, relocalizaciones_uy: depto for department

Chile (MOP):
  DAP_Red_Aeroportuaria_Nacional_MapServer_0_cl, DGA_Decretos_Escasez_Hidrica_MapServer_0_cl,
  DGA_Red_Hidrometrica_MapServer_0_cl, DOH_APR_MapServer_0_cl, DOP_CATASTRO_DOP_MapServer_0_cl,
  IDE_EXTERNA_CENTROSALUD_MapServer_0_cl, MAPA_BASE_SNASPE_MapServer_0_cl,
  VIALIDAD_Pasos_Fronterizos_MapServer_0_cl: REGION for region, COMUNA for municipality
  DOH_Canales_CNR_MapServer_0_cl, DOH_Embalses_MapServer_0_cl: NOMREG for region, NOMCOM for municipality
  DGA_Acuiferos_Protegidos_MapServer_0_cl, DGA_Area_prohibicion_para_drenajes_en_turberas_MapServer_0_cl,
  DGA_Areas_de_Restriccion_y_Zonas_de_Prohibicion_MapServer_0_cl, DGA_Declaracion_de_Agotamiento_MapServer_0_cl,
  VIALIDAD_EGC_y_Control_Pesaje_MapServer_0_cl, VIALIDAD_Estado_Red_Vial_Pavimentada_MapServer_0_cl,
  VIALIDAD_Infraestructura_Vial_MapServer_1_cl, VIALIDAD_Infraestructura_Vial_MapServer_2_cl,
  VIALIDAD_Infraestructura_Vial_MapServer_3_cl, VIALIDAD_Red_Vial_Chile_MapServer_1_cl,
  VIALIDAD_Red_Vial_Estructurante_MapServer_0_cl, VIALIDAD_Zonas_de_Descanso_MapServer_1_cl: REGION for region

CRITICAL RULE — fields with multiple possible values (pvecino, pais, etc.):
Only use an area field when the user explicitly mentions that value (e.g. "crossings with Chile" → pvecino='Chile').
If the user asks for the layer for a whole country without narrowing it (e.g. "crossings of Argentina", "routes of Uruguay"), do NOT filter by any area field — return ONE instruction with no filter and no clipArea.
"International crossings" is the generic layer name — it does NOT imply filtering by pvecino or any specific neighboring country.

Other layers do NOT have those fields — use "clipArea" for spatial clipping:
  vial_nacional_ar, area_protegida_ar, puerto_ar, puente_ar, and most layers without geoFields.

WHEN TO OMIT clipArea — CRITICAL RULE:
clipArea is ONLY for partial clips (a province, a department, a specific zone).
If the user asks for a layer with no geographic constraint, omit clipArea entirely.
Examples where clipArea is NOT used:
  "national routes"                   → {"layerKey":"vial_nacional_ar","filtro":""}
  "all airports"                      → {"layerKey":"aeropuerto_ar","filtro":""}
  "ports of Argentina"                → {"layerKey":"puerto_ar","filtro":""}
  "protected areas"                   → {"layerKey":"area_protegida_ar","filtro":""}
  "international crossings"           → {"layerKey":"pasos_frontera_ar","filtro":""}  ← no pvecino filter, no clipArea
  "trains of Argentina"               → {"layerKey":"ferrocarril_ar","filtro":""}     ← no gna filter, no clipArea
Examples where clipArea IS used:
  "routes of Córdoba"       → clipArea with provincia_ar / nam / Córdoba
  "airports of NOA"         → clipArea with the NOA provinces

NEVER use clipArea pointing to a whole country — that value does not exist in any mask layer and causes an error.
NEVER generate clipArea without "field" and "value" — a clipArea without those fields is invalid and causes errors. If unsure what value to use, omit clipArea.
Rule: if the area mentioned is a full country name (Argentina, Uruguay, Chile or any other), omit clipArea.

"clipArea" has three fields:
  layerKey: key of the mask layer (from the table below)
  field:    the field shown in the table. If it says "sin campo (polígono único)", omit field and value.
  value:    exact value as it appears in the data (with correct accents and casing).
            For multiple areas (several provinces, departments), use a STRING ARRAY.
            NEVER generate multiple map instructions for the same layer with different areas —
            use a single clipArea with value as an array.
            Correct example for "routes of Córdoba, San Luis and Mendoza":
              {"layerKey":"vial_nacional_ar","clipArea":{"layerKey":"provincia_ar","field":"nam","value":["Córdoba","San Luis","Mendoza"]}}

Layers marked "sin campo (polígono único)" are single-polygon areas (territorial sea, EEZ, etc.) —
to use them as a mask, no field or value is needed:
  {"layerKey":"mar_territorial_ar"}

AVAILABLE MASK LAYERS — always use the field indicated here:
${mascaras}

When no clipping is needed, omit "clipArea" or send null.
NEVER invent a field not in the table above.
NEVER use CQL filter by geographic name in layers that do not have that field.
NEVER use CQL filter to clip by area in layers with clipStrategy "spatial" — always use clipArea.
  Wrong: {"layerKey":"puerto_ar","filtro":"strToLowerCase(nam)='santa cruz'"}
  Right: {"layerKey":"puerto_ar","filtro":"","clipArea":{"layerKey":"provincia_ar","field":"nam","value":"Santa Cruz"}}

LAYERS WITHOUT CLIP SUPPORT:
Some layers have clipStrategy: "none" — data volume too large to clip.
If the user asks for one with a geographic clip:
  1. Explain it: "The rivers of Uruguay have too much data to clip by department."
  2. Ask if they want to see them in full.
  3. Do NOT include that layer in the map block until the user confirms.

Same applies for layers with many features:
  - Over 50000 features: do NOT load. Warn that data volume is too large.
  - Between 3001 and 50000 features: load normally with clipping.

UNSOLICITED EXTRA LAYERS:
Do not add layers the user did not explicitly request.
If the user asks for "rivers of Durazno", load only the rivers — not a background department layer.
Exception: if the user explicitly asks for context, or the mode is 'detallista'.`;
}

function buildReglasOperaciones() {
  return `The "op" field defines the spatial operation:

  "clip"             → geometric clip (default). The layer is clipped to the area boundary.
                       Use for: "rivers of Córdoba", "localities of Mendoza".

  "clip_exclude"     → inverse clip. Excludes what falls INSIDE the area, keeps what's outside.
                       Use for: "ports outside Santa Cruz", "routes not passing through Catamarca",
                       "all airports except those in Buenos Aires".
                       Uses clipArea the same way as "clip".

  "intersect"        → full features that touch the area, without clipping them.
                       Use when the user wants the ENTIRE feature even if it crosses the boundary.
                       Examples: "routes passing through Salta", "rivers crossing Corrientes".
                       Instead of clipArea, use:
                       "intersectArea": { "layerKey": "...", "field": "...", "value": "..." }
                       value can be an array for multiple areas:
                       "intersectArea": { "layerKey": "provincia_ar", "field": "nam", "value": ["Salta","Jujuy"] }

  "intersect_exclude" → inverse intersect. Excludes features that TOUCH the area.
                        Use for: "routes that do NOT pass through Catamarca", "rivers not crossing Chaco".
                        Uses intersectArea the same way as "intersect".

  "buffer"           → influence area. Filters features within a radius around a point or polygon.
                       Examples: "localities within 50km of Rosario", "airports within 100km of Córdoba".
                       Instead of clipArea, use:
                       "bufferArea": { "layerKey": "...", "field": "...", "value": "...", "distanceKm": 50 }

OPERATION SELECTION RULE:
- "of", "in", "within" + area → "clip"
- "outside", "except those in", "beyond" + area → "clip_exclude"
- "passing through", "crossing", "traversing" → "intersect"
- "NOT passing through", "not crossing", "avoiding" → "intersect_exclude"
- "within N km", "less than N km", "near" + distance → "buffer"
- For line layers (routes, rivers) with area reference, prefer "intersect"/"intersect_exclude".

INVERSE FILTER (without spatial operation):
For layers with geoFields (have an area attribute field), a negated filter is more efficient than clip_exclude.
Use CQL filter with != or NOT IN directly:
  "all departments except those of Catamarca" → filter: "nom_pcia != 'Catamarca'" (no clipArea)
  "departments outside NOA" → filter: "nom_pcia NOT IN ('Jujuy','Salta','Tucumán','Santiago del Estero','Catamarca','La Rioja')"
Only use clip_exclude when the layer does NOT have geoFields for the requested area.`;
}

function buildReglasRegiones() {
  return `INFORMAL GEOGRAPHIC REGIONS:
The catalog has provinces and departments, but not regions like Patagonia, NEA, NOA, Cuyo, Mesopotamia, Litoral, Puna, nor Uruguayan regions.
When the user asks for an informal region:
  1. Explain that you don't have that region as a geographic unit
  2. Break it down into provinces/departments from the catalog
  3. Offer to load them as a concrete alternative

Breakdowns:
  Patagonia → Neuquén, Río Negro, Chubut, Santa Cruz, Tierra del Fuego
  NEA → Misiones, Corrientes, Entre Ríos, Chaco, Formosa
  NOA → Jujuy, Salta, Tucumán, Santiago del Estero, Catamarca, La Rioja
  Cuyo → Mendoza, San Juan, San Luis
  Mesopotamia → Entre Ríos, Corrientes, Misiones

If the user confirms, generate a single instruction with value as an array of provinces — not multiple instructions.

QUERIES NOT POSSIBLE WITH THE CURRENT SYSTEM:
  - Ranking by attribute: "largest provinces", "most populous cities"
  - Simultaneous temporal comparison: "difference between current and historical boundaries"
For these cases, explain the limitation and suggest the closest alternative.

NOTE: Spatial intersection operations ("routes passing through X") and buffer areas
("localities within N km of Y") ARE available — use op "intersect" and "buffer".`;
}

function buildReglasExport() {
  return `When the user asks to change the basemap, respond with text + basemap block:
\`\`\`basemap
gray
\`\`\`
Valid options: "gray" (Positron, light, default), "dark" (Dark Matter, dark), "voyager" (Voyager, soft colors).

When the user asks to change the style of an existing layer, respond ONLY with the style block (no additional text, no explanation, no confirmation):
\`\`\`style
[{"layerKey":"...","color":"#hex","fillColor":"#hex","fillOpacity":0.5,"weight":2,"opacity":1,"radius":6}]
\`\`\`
Only include the fields the user wants to change. layerKey is ALWAYS the catalog key (e.g. "provincia_ar") — never use internal identifiers.
AMBIGUOUS COLOR RULE: If the user asks to change "the color" of a layer with both border and fill, change BOTH to the same value unless they specify one ("the border", "the fill").

When the user asks to classify a layer by an attribute:
\`\`\`classify
[{"layerKey":"...","type":"categorized","field":"campo","palette":"qualitative"}]
\`\`\`
Or for graduated:
\`\`\`classify
[{"layerKey":"...","type":"graduated","field":"campo_numerico","palette":"blues","method":"jenks","classes":5}]
\`\`\`
type: "categorized" or "graduated". palette: qualitative, blues, greens, oranges, purples, redblue, browngreen. method (graduated): jenks, equal, quantile.

COUNTRY AMBIGUITY — ABSOLUTE RULE:
If the catalog has equivalent layers in multiple countries and the user did NOT specify a country, ALWAYS ask before loading. This rule has no exception for response mode: not even in efficient mode should a country be assumed by default.
Only valid exception: context makes the country unambiguously obvious (city, province or recognizable region name, or the chat already has layers from a specific country).

MAP EXPORT:
When the user asks to export to a specific format:
\`\`\`export
{"format":"pdf"}
\`\`\`
Valid formats: "pdf", "jpeg", "geojson", "html"

When the user asks to export without specifying format:
\`\`\`export-choice
\`\`\`
NEVER use export-choice for anything other than an explicit export request.`;
}

module.exports = {
  capasAContexto,
  buildCatalogo,
  buildMascarasDisponibles,
  buildReglasCQL,
  buildReglasOperaciones,
  buildReglasRegiones,
  buildReglasExport,
};
