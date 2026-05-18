/**
 * api/llm.js — Proxy LLM con streaming y fallback automático
 *
 * Orden: Cerebras → Groq 70b → Groq OSS 120b → Gemini
 * Usa Server-Sent Events (SSE) para streaming de tokens al browser
 */

const CEREBRAS_URL    = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_MODEL  = 'qwen-3-235b-a22b-instruct-2507';
const GROQ_URL        = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL      = 'llama-3.3-70b-versatile';
// Groq OSS usa el mismo endpoint que Groq — reemplazó a llama-4-maverick en marzo 2026
const GROQ_OSS_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_OSS_MODEL  = 'openai/gpt-oss-120b';
const MISTRAL_URL     = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL   = 'mistral-small-latest';
const GEMINI_URL      = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Tiempo máximo por proveedor antes de hacer fallback (ms)
const PROVIDER_TIMEOUT_MS = 8000;

// ── Búsqueda semántica local ──────────────────────────────────────

const { normalizar, STOPWORDS } = require('./_utils');
const { checkOrigin } = require('./_cors');

function buscarCapasRelevantes(textoUsuario, layers, max = 5) {
  const norm = normalizar(textoUsuario);
  const palabras = norm.split(/\s+/).filter(p => p.length > 2 && !STOPWORDS.includes(p));
  // Excluir capas special y capas visible:false (gemelas, técnico-geodésicas)
  const capasValidas = Object.entries(layers).filter(([, capa]) => capa.special === false && capa.visible !== false);
  if (!palabras.length) return capasValidas.slice(0, max).map(([k, v]) => ({ key: k, ...v }));
  const scored = capasValidas
    .map(([key, capa]) => {
      const textoCapa = normalizar([capa.tituloUI || '', capa.titulo, capa.abstract || '', key,
        (capa.keywords || []).join(' '),
        (capa.attributes || []).map(a => (a.label || '') + ' ' + (a.campo || '')).join(' ')
      ].join(' '));
      let score = 0;
      if (textoCapa.includes(norm)) score += 10;
      for (const p of palabras) {
        if (textoCapa.includes(p)) score += 2;
        if (textoCapa.split(/\s+/).some(w => w.startsWith(p))) score += 1;
      }
      return { key, capa, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  // Incluir hasta `max` resultados, pero si hay capas con el mismo score
  // máximo de distintos países, incluirlas todas para que el LLM vea la
  // ambigüedad y pueda preguntar en lugar de asumir un país por defecto.
  const topScore = scored[0]?.score ?? 0;
  const topTied  = scored.filter(r => r.score === topScore);
  const countries = new Set(topTied.map(r => r.capa.source));
  const result = countries.size > 1
    ? [...topTied, ...scored.filter(r => r.score < topScore)].slice(0, max + countries.size - 1)
    : scored.slice(0, max);

  return result.map(r => ({ key: r.key, ...r.capa }));
}

function capasAContexto(capas, sources) {
  const excluir = ['gid','fdc','sag','entidad','objeto'];
  return capas.map(c => {
    const attrs = (c.attributes || [])
      .filter(a => !excluir.includes(a.campo))
      .map(a => `    ${a.campo}: ${a.label}`)
      .join('\n');
    const countInfo = c.featureCount !== undefined
      ? ` [${c.featureCount} features]`
      : '';
    // Mostrar clipStrategy — crítico para que el LLM sepa si usar filtro CQL o clipArea
    const clipInfo = c.clipStrategy
      ? ` [clip:${c.clipStrategy}]`
      : ' [clip:null]';
    // Mostrar protocolo — crítico para que el LLM use la sintaxis de filtro correcta
    const srcDef = sources?.[c.source];
    const protoInfo = srcDef?.tipo === 'arcgis' ? ' [proto:arcgis]' : ' [proto:wfs]';
    // Mostrar geoFields si existen — son los campos correctos para filtrar por área
    const geoFieldsInfo = c.geoFields
      ? '\n    filtros de área: ' + Object.entries(c.geoFields).map(([tipo, campo]) => `${tipo}→${campo}`).join(', ')
      : '';
    // Mostrar filterField + filterValues — campo y valores EXACTOS para filtrar por subtipo.
    // Crítico: sin esto el LLM inventa nombres de campo (ej: tipo_de_instalacion en vez de gna).
    const filterInfo = (c.filterField && Array.isArray(c.filterValues) && c.filterValues.length)
      ? `\n    filtro de subtipo: ${c.filterField} — valores posibles: ${c.filterValues.join(', ')}`
      : '';
    return `  ${c.key} — ${c.tituloUI || c.titulo} (${c.geomType})${countInfo}${clipInfo}${protoInfo}${geoFieldsInfo}${filterInfo}${attrs ? '\n' + attrs : ''}`;
  }).join('\n\n');
}

/**
 * Genera el catálogo de capas agrupado por fuente/país.
 * Se construye dinámicamente desde el objeto layers recibido del cliente,
 * que proviene de window.LAYERS (generado por layers/index.js).
 * Al agregar nuevos países u organismos, aparecen aquí automáticamente.
 */
function buildCatalogo(todasLasCapas, sources) {
  // Agrupar capas por fuente
  // Excluir capas con special distinto de false — son técnicas, operacionales,
  // auxiliares o administrativas sin valor semántico para el usuario.
  // Las capas special:false con visible:false sí se incluyen (duplicados de área, etc.)
  const grupos = {};
  for (const [key, capa] of Object.entries(todasLasCapas)) {
    if (capa.special !== false) continue;
    const sourceKey = capa.source || 'desconocida';
    if (!grupos[sourceKey]) grupos[sourceKey] = [];
    grupos[sourceKey].push({ key, ...capa });
  }

  // Construir texto del catálogo agrupado
  return Object.entries(grupos).map(([sourceKey, capas]) => {
    const src = sources?.[sourceKey];
    const header = src
      ? `## ${src.countryLabel || src.country?.toUpperCase() || sourceKey} — ${src.label}`
      : `## ${sourceKey}`;
    const lista = capas.map(c => `  ${c.key}: ${c.tituloUI || c.titulo}`).join('\n');
    return `${header}\n${lista}`;
  }).join('\n\n');
}

/**
 * Tabla dinámica de capas-máscara para clipArea.
 * Se genera en runtime desde labelField de cada capa polygon.
 * Al agregar países o capas nuevas, aparece automáticamente — sin tocar el prompt.
 */
function buildMascarasDisponibles(todasLasCapas) {
  return Object.entries(todasLasCapas)
    .filter(([, c]) => c.geomType === 'polygon' && c.mask === true)
    .map(([key, c]) => {
      const fieldInfo = c.labelField ? `field="${c.labelField}"` : 'sin campo (polígono único)';
      return `  ${key}: ${fieldInfo} — ${c.tituloUI || c.titulo}`;
    })
    .join('\n') || '  (ninguna disponible)';
}

// ── Secciones del system prompt ──────────────────────────────────
//
// buildSystemPrompt() ensambla estas secciones en el prompt final.
// Cada función tiene una responsabilidad única y puede modificarse
// sin tocar las demás. Al agregar un país nuevo, solo hay que
// actualizar buildReglasRecorte() y buildReglasRegiones().

function _buildReglasAmbiguedad(tone) {
  return `AMBIGÜEDAD — REGLA OBLIGATORIA: Antes de generar cualquier mapa, necesitás tener claro:
1. ¿QUÉ zona geográfica? (país, provincia, departamento, región)
2. ¿QUÉ se quiere mostrar? (rutas, localidades, ríos, límites, aeropuertos, etc.)

Si falta alguna de las dos, hacé UNA sola pregunta concreta para resolverla. Nunca hagas dos preguntas a la vez.
Ejemplos:
- "mapa de Argentina" → "¿Qué querés ver? Por ejemplo: provincias, rutas, localidades, ríos..."
- "quiero ver las rutas" → "¿De qué provincia o país?"
- "mapa del NOA" → "¿Qué querés mostrar del NOA?"
Excepción: si el catálogo tiene una sola capa relevante y la zona es clara, generá el mapa directamente.
${tone === 'eficiente' ? 'En modo sintético: si podés inferir razonablemente la respuesta a ambas preguntas, generá el mapa sin preguntar.' : ''}`;
}

function _buildReglasEstilo() {
  return `ESTILOS VISUALES:
Siempre incluí un bloque "style" junto al bloque "map". Reglas:

1. COLOR DE BORDE: Para polígonos, "color" (borde) debe ser siempre el mismo hex que "fillColor" pero más oscuro (~25%). Nunca uses un color de borde que contraste fuertemente con el relleno.

2. MÚLTIPLES CAPAS DEL MISMO TIPO: Asigná colores de relleno distintos y claramente diferenciables. Paleta por orden:
   1ª: #3d52a0 (índigo) · 2ª: #52b788 (verde) · 3ª: #c8622a (terracota) · 4ª: #d4720f (naranja) · 5ª: #8b6abf (violeta)

3. Capa única: usá siempre #3d52a0, salvo que el usuario pida otro color.

4. Si el usuario pidió un color específico, usá ese. El borde siempre deriva del relleno.`;
}

function _buildReglasOperaciones() {
  return `El campo "op" define la operación espacial:

  "clip"             → recorte geométrico (default). La capa se recorta al contorno del área.
                       Usar para: "ríos de Córdoba", "localidades de Mendoza".

  "clip_exclude"     → clip inverso. Excluye lo que cae DENTRO del área, conserva lo que queda afuera.
                       Usar para: "puertos fuera de Santa Cruz", "rutas que no pasan por Catamarca",
                       "todos los aeropuertos menos los de Buenos Aires".
                       Usa clipArea igual que "clip".

  "intersect"        → features completas que tocan el área, sin recortarlas.
                       Usar cuando el usuario quiere la entidad ENTERA aunque cruce el límite.
                       Ejemplos: "rutas que pasan por Salta", "ríos que atraviesan Corrientes".
                       En lugar de clipArea, usá:
                       "intersectArea": { "layerKey": "...", "field": "...", "value": "..." }
                       value puede ser array para múltiples áreas:
                       "intersectArea": { "layerKey": "provincia_ar", "field": "nam", "value": ["Salta","Jujuy"] }

  "intersect_exclude" → intersect inverso. Excluye features que TOCAN el área.
                        Usar para: "rutas que NO pasan por Catamarca", "ríos que no atraviesan Chaco".
                        Usa intersectArea igual que "intersect".

  "buffer"           → área de influencia. Filtra features dentro de un radio alrededor de un punto o polígono.
                       Ejemplos: "localidades a menos de 50km de Rosario", "aeropuertos dentro de 100km de Córdoba".
                       En lugar de clipArea, usá:
                       "bufferArea": { "layerKey": "...", "field": "...", "value": "...", "distanceKm": 50 }

REGLA DE ELECCIÓN DE OPERACIÓN:
- "de", "en", "dentro de" + área → "clip"
- "fuera de", "menos los de", "excepto los de", "por fuera de" + área → "clip_exclude"
- "que pasan por", "que atraviesan", "que cruzan" → "intersect"
- "que NO pasan por", "que no atraviesan", "que evitan" → "intersect_exclude"
- "a menos de N km", "dentro de N km", "cerca de" + distancia → "buffer"
- Para líneas (rutas, ríos) con referencia a área, preferí "intersect"/"intersect_exclude" según el caso.

FILTRO INVERSO (sin operación espacial):
Para capas con geoFields (tienen campo de atributo por área), el filtro negado es más eficiente que clip_exclude.
Usar filtro CQL con != o NOT IN directamente:
  "todos los departamentos menos los de Catamarca" → filtro: "nom_pcia != 'Catamarca'" (sin clipArea)
  "departamentos fuera del NOA" → filtro: "nom_pcia NOT IN ('Jujuy','Salta','Tucumán','Santiago del Estero','Catamarca','La Rioja')"
Solo usar clip_exclude cuando la capa NO tiene geoFields para el área pedida.`;
}

function _buildReglasCQL(mascaras) {
  return `REGLAS DE FILTROS — SINTAXIS SEGÚN PROTOCOLO:

Las capas muestran [proto:wfs] o [proto:arcgis] en su descripción. La sintaxis del filtro es distinta según el protocolo:

[proto:wfs] → sintaxis CQL (GeoServer):
- Sin filtro: ""
- Texto exacto: campo='Valor Exacto con tildes'
- LIKE: strToLowerCase(campo) LIKE '%valor%'
- Múltiples valores: strToLowerCase(campo) IN ('valor1','valor2','valor3')  ← usar IN, nunca OR
- Combinado: strToLowerCase(pvecino)='chile' AND prov='Santa Cruz'
- Numéricos sin comillas ni strToLowerCase

[proto:arcgis] → sintaxis SQL estándar (ArcGIS REST):
- Sin filtro: ""
- Texto exacto: CAMPO='Valor Exacto'  ← mayúsculas exactas del campo
- Múltiples valores: CAMPO IN ('Valor1','Valor2','Valor3')  ← usar IN, nunca OR. NUNCA uses corchetes: IN (['...']) es sintaxis inválida.
- LIKE: CAMPO LIKE '%valor%'
- Numéricos sin comillas
- NUNCA usar strToLowerCase() ni LOWER() en capas [proto:arcgis] — no están soportadas

- Si no corresponde a ninguna capa: [{"error":"No tengo datos para esa consulta"}]
- Si el usuario pide limpiar o vaciar el mapa: []

FILTRO DE SUBTIPO — REGLA CRÍTICA:
Cuando una capa muestra "filtro de subtipo: CAMPO — valores posibles: ...", ese CAMPO es el ÚNICO correcto para filtrar por subtipo. NUNCA uses un nombre de campo distinto al indicado.
  [proto:wfs]:    strToLowerCase(CAMPO)='valor'
  [proto:arcgis]: CAMPO='Valor Exacto'
Si el usuario pide un subtipo que no está en la lista, usá el valor más cercano o LIKE.
Si el usuario no pide subtipo específico, omitir el filtro ("filtro": ""). Ej: "trenes de Argentina" o "ferrocarriles de Argentina" → filtro vacío, aunque la capa tenga filterValues.

IMPORTANTE — VALORES EN FILTROS: Usá siempre el valor exacto con tildes y mayúsculas como aparece en los datos (ej: prov='Salta', nom_pcia='Córdoba', nam='Catamarca'). NO uses strToLowerCase con el valor de área — solo para búsquedas de texto libre en capas WFS.

REGLA DE RECORTE GEOGRÁFICO:
Algunas capas tienen campos propios para filtrar por área — usá filtro CQL directamente en lugar de clipArea:

Argentina (IGN):
  localidad_ar, paraje_ar, sublocalidad_ar, base_antartica_ar: nom_pcia para provincia, nom_depto para departamento
  pasos_frontera_ar, complejo_fronterizo_ar: prov para provincia, pvecino para país vecino
  area_montana_ar: provincia para provincia

Uruguay (MTOP):
  camineria_nacional_uy, rutas_nacionales_uy, puentes_carreteros_uy, peajes_uy,
  peajes_otros_uy, obras_camineria_uy, relocalizaciones_uy: depto para departamento

Chile (MOP):
  DAP_Red_Aeroportuaria_Nacional_MapServer_0_cl, DGA_Decretos_Escasez_Hidrica_MapServer_0_cl,
  DGA_Red_Hidrometrica_MapServer_0_cl, DOH_APR_MapServer_0_cl, DOP_CATASTRO_DOP_MapServer_0_cl,
  IDE_EXTERNA_CENTROSALUD_MapServer_0_cl, MAPA_BASE_SNASPE_MapServer_0_cl,
  VIALIDAD_Pasos_Fronterizos_MapServer_0_cl: REGION para región, COMUNA para comuna
  DOH_Canales_CNR_MapServer_0_cl, DOH_Embalses_MapServer_0_cl: NOMREG para región, NOMCOM para comuna
  DGA_Acuiferos_Protegidos_MapServer_0_cl, DGA_Area_prohibicion_para_drenajes_en_turberas_MapServer_0_cl,
  DGA_Areas_de_Restriccion_y_Zonas_de_Prohibicion_MapServer_0_cl, DGA_Declaracion_de_Agotamiento_MapServer_0_cl,
  VIALIDAD_EGC_y_Control_Pesaje_MapServer_0_cl, VIALIDAD_Estado_Red_Vial_Pavimentada_MapServer_0_cl,
  VIALIDAD_Infraestructura_Vial_MapServer_1_cl, VIALIDAD_Infraestructura_Vial_MapServer_2_cl,
  VIALIDAD_Infraestructura_Vial_MapServer_3_cl, VIALIDAD_Red_Vial_Chile_MapServer_1_cl,
  VIALIDAD_Red_Vial_Estructurante_MapServer_0_cl, VIALIDAD_Zonas_de_Descanso_MapServer_1_cl: REGION para región

REGLA CRÍTICA — campos con múltiples valores posibles (pvecino, pais, etc.):
Usá un campo de área solo cuando el usuario menciona explícitamente ese valor (ej: "pasos con Chile" → pvecino='Chile').
Si el usuario pide la capa para un país entero sin acotarla (ej: "pasos de Argentina", "pasos internacionales de Argentina", "rutas de Uruguay", "embalses de Chile"), NO filtres por ningún campo de área ni generes múltiples instrucciones — devolvé UNA SOLA instrucción sin filtro CQL ni clipArea.
Importante: "pasos internacionales" es el nombre genérico de la capa — no implica filtrar por pvecino ni por ningún país vecino específico.

Otras capas NO tienen esos campos — usá "clipArea" para recorte espacial:
  vial_nacional_ar, area_protegida_ar, puerto_ar, puente_ar, y la mayoría de capas sin geoFields.

CUÁNDO OMITIR clipArea — REGLA CRÍTICA:
clipArea es SOLO para recortes parciales (una provincia, un departamento, una zona específica).
Si el usuario pide una capa sin zona geográfica acotada, omitir clipArea completamente — el fetch WFS ya devuelve todos los datos de esa fuente.
Ejemplos donde NO va clipArea:
  "rutas nacionales"                      → {"layerKey":"vial_nacional_ar","filtro":""}
  "todos los aeropuertos"                 → {"layerKey":"aeropuerto_ar","filtro":""}
  "puertos de Argentina"                  → {"layerKey":"puerto_ar","filtro":""}
  "áreas protegidas"                      → {"layerKey":"area_protegida_ar","filtro":""}
  "pasos internacionales de Argentina"    → {"layerKey":"pasos_frontera_ar","filtro":""}  ← sin filtro pvecino, sin clipArea
  "trenes de Argentina"                   → {"layerKey":"ferrocarril_ar","filtro":""}     ← sin filtro gna, sin clipArea
  "ferrocarriles de Argentina"            → {"layerKey":"ferrocarril_ar","filtro":""}     ← sin filtro gna, sin clipArea
Ejemplos donde SÍ va clipArea:
  "rutas de Córdoba"       → clipArea con provincia_ar / nam / Córdoba
  "aeropuertos del NOA"    → clipArea con las provincias del NOA
NUNCA uses clipArea apuntando al país entero — ese valor no existe en ninguna capa máscara y provoca un error.
NUNCA generes clipArea sin "field" y "value" — un clipArea sin esos campos es inválido y provoca errores. Si no sabés qué valor poner, omití clipArea.
Regla: si el área mencionada es el nombre del país completo (Argentina, Uruguay, Chile u otro país), omitir clipArea. El WFS ya devuelve todos los datos del país.
Ejemplos de pedidos a nivel país que NO llevan clipArea:
  "aeropuertos de Uruguay"   → {"layerKey":"aeropuertos_uy","filtro":""}
  "rutas de Uruguay"         → {"layerKey":"rutas_nacionales_uy","filtro":""}
  "rutas de Argentina"       → {"layerKey":"vial_nacional_ar","filtro":""}
  "puertos de Chile"         → {"layerKey":"..._cl","filtro":""}
  "todos los aeropuertos"    → {"layerKey":"aeropuerto_ar","filtro":""}

"clipArea" tiene tres campos:
  layerKey: clave de la capa-máscara (de la tabla de abajo)
  field:    el field que figura en la tabla. Si dice "sin campo (polígono único)", omitir field y value.
  value:    valor exacto tal como está en los datos (con tildes y mayúsculas correctas).
            Para múltiples áreas (varias provincias, varios departamentos), usar un ARRAY de strings.
            NUNCA generar múltiples instrucciones en el map para la misma capa con distintas áreas —
            usar un solo clipArea con value como array.
            Ejemplo correcto para "rutas de Córdoba, San Luis y Mendoza":
              {"layerKey":"vial_nacional_ar","clipArea":{"layerKey":"provincia_ar","field":"nam","value":["Córdoba","San Luis","Mendoza"]}}
            Ejemplo incorrecto (genera 3 capas duplicadas):
              [{"layerKey":"vial_nacional_ar","clipArea":{"layerKey":"provincia_ar","field":"nam","value":"Córdoba"}},
               {"layerKey":"vial_nacional_ar","clipArea":{"layerKey":"provincia_ar","field":"nam","value":"San Luis"}},
               {"layerKey":"vial_nacional_ar","clipArea":{"layerKey":"provincia_ar","field":"nam","value":"Mendoza"}}]

Las capas marcadas como "sin campo (polígono único)" son áreas únicas (mar territorial, ZEE, etc.) —
para usarlas como máscara no necesitás field ni value:
  {"layerKey":"mar_territorial_ar"}

CAPAS DISPONIBLES COMO MÁSCARA — usá siempre el field indicado acá:
${mascaras}

Cuando no se necesita recorte, omitir "clipArea" o enviar null.
NUNCA inventes un field que no esté en la tabla de arriba.
NUNCA uses filtro CQL por nombre geográfico en capas que no tienen ese campo.
NUNCA uses filtro CQL para recortar por área en capas con clipStrategy "spatial" — siempre usá clipArea.
  Incorrecto: {"layerKey":"puerto_ar","filtro":"strToLowerCase(nam)='santa cruz'"}
  Correcto:   {"layerKey":"puerto_ar","filtro":"","clipArea":{"layerKey":"provincia_ar","field":"nam","value":"Santa Cruz"}}

CAPAS SIN SOPORTE DE RECORTE:
Algunas capas tienen clipStrategy: "none" — volumen de datos demasiado grande para recortar.
Si el usuario pide una con recorte geográfico:
  1. Explicáselo: "Los ríos de Uruguay tienen demasiados datos para recortar por departamento."
  2. Preguntá si quiere verlos completos.
  3. NO incluyas esa capa en el bloque map hasta que el usuario confirme.

Lo mismo aplica para capas con muchos features:
  - Más de 50000 features: NO la cargues. Avisá que tiene demasiados datos.
  - Entre 3001 y 50000 features: podés cargarla con recorte normalmente.

CAPAS ADICIONALES NO SOLICITADAS:
No agregues capas que el usuario no pidió explícitamente.
Si el usuario pide "ríos de Durazno", cargá solo los ríos — no el departamento de fondo.
Excepción: si el usuario pide explícitamente contexto, o el modo es 'detallista'.`;
}

function _buildReglasRegiones() {
  return `REGIONES GEOGRÁFICAS INFORMALES:
El catálogo tiene provincias y departamentos, pero no regiones como Patagonia, NEA, NOA, Cuyo, Mesopotamia, Litoral, Puna, ni regiones de Uruguay.
Cuando el usuario pida una región informal:
  1. Explicá que no tenés esa región como unidad geográfica
  2. Descomponé en provincias/departamentos del catálogo
  3. Ofrecé cargarlos como alternativa concreta

Descomposiciones:
  Patagonia → Neuquén, Río Negro, Chubut, Santa Cruz, Tierra del Fuego
  NEA → Misiones, Corrientes, Entre Ríos, Chaco, Formosa
  NOA → Jujuy, Salta, Tucumán, Santiago del Estero, Catamarca, La Rioja
  Cuyo → Mendoza, San Juan, San Luis
  Mesopotamia → Entre Ríos, Corrientes, Misiones

Si el usuario confirma, generá una sola instrucción con value como array de provincias — no múltiples instrucciones.

CONSULTAS IMPOSIBLES CON EL SISTEMA ACTUAL:
  - Ranking por atributo: "provincias más grandes", "ciudades más pobladas"
  - Comparación temporal simultánea: "diferencia entre límites actuales e históricos"
Para estos casos, explicá la limitación y sugerí la alternativa más cercana.

NOTA: Las operaciones de intersección espacial ("rutas que pasan por X") y área de influencia
("localidades a menos de N km de Y") SÍ están disponibles — usá op "intersect" y "buffer".`;
}

function _buildReglasExport() {
  return `Cuando el usuario pida cambiar el mapa base, respondé con texto + bloque basemap:
\`\`\`basemap
gray
\`\`\`
Opciones válidas: "gray" (Positron, claro, por defecto), "dark" (Dark Matter, oscuro), "voyager" (Voyager, colores suaves).

Cuando el usuario pida cambiar el estilo de una capa existente, respondé SOLO con el bloque style (sin texto adicional, sin explicación, sin confirmación):
\`\`\`style
[{"layerKey":"...","color":"#hex","fillColor":"#hex","fillOpacity":0.5,"weight":2,"opacity":1,"radius":6}]
\`\`\`
Solo incluí los campos que el usuario quiera cambiar. layerKey es SIEMPRE la clave del catálogo (ej: "provincia_ar") — nunca uses identificadores internos.
REGLA DE COLOR AMBIGUO: Si el usuario pide cambiar "el color" de una capa con borde y relleno, cambiá AMBOS al mismo valor salvo que especifique uno solo ("el borde", "el relleno").

Cuando el usuario pida clasificar una capa por un atributo:
\`\`\`classify
[{"layerKey":"...","type":"categorized","field":"campo","palette":"qualitative"}]
\`\`\`
O para graduado:
\`\`\`classify
[{"layerKey":"...","type":"graduated","field":"campo_numerico","palette":"blues","method":"jenks","classes":5}]
\`\`\`
type: "categorized" o "graduated". palette: qualitative, blues, greens, oranges, purples, redblue, browngreen. method (graduated): jenks, equal, quantile.

AMBIGÜEDAD DE PAÍS — REGLA ABSOLUTA:
Si el catálogo tiene capas equivalentes en múltiples países y el usuario NO especificó el país, SIEMPRE preguntá antes de cargar. Esta regla no tiene excepción por modo de respuesta: ni en modo eficiente ni en ningún otro se asume un país por defecto.
Única excepción válida: el contexto hace inequívocamente obvio el país (nombre de ciudad, provincia o región reconocible, o el chat ya tiene capas cargadas de un país específico).

EXPORTACIÓN DE MAPAS:
Cuando el usuario pida exportar a un formato específico:
\`\`\`export
{"format":"pdf"}
\`\`\`
Formatos válidos: "pdf", "jpeg", "geojson", "html"

Cuando el usuario pida exportar sin especificar formato:
\`\`\`export-choice
\`\`\`
NUNCA uses export-choice para nada que no sea un pedido explícito de exportación.`;
}

function buildSystemPrompt(capasRelevantes, todasLasCapas, tone, activeMap, sources, userLang) {
  const toneInstructions = {
    // Modo por defecto: tono adaptativo, pregunta al cierre, observaciones breves
    default:    'Respondé con claridad. Podés hacer una observación breve sobre el territorio que se está mapeando — algo genuinamente interesante, no un dato enciclopédico. No uses emojis. No celebres ni exclames. Preguntá cuando necesitás saber algo para generar el mapa, no para completar un formulario.',
    // Modo sintético: máxima brevedad, cero preguntas salvo bloqueo total
    eficiente:  'Sé extremadamente breve. Una oración como máximo antes del bloque map. NO hagas preguntas: si podés inferir el pedido con razonable certeza, generá el mapa directamente. Solo preguntá si el pedido es ambiguo en AMBAS dimensiones (qué capa Y qué zona) al mismo tiempo, y en ese caso hacé UNA sola pregunta. Sin comentarios laterales, sin preguntas de cierre.',
    // Modo detallista: contexto profundo, atributos, fuentes
    detallista: 'Explicá cada capa con profundidad: atributos relevantes, fuente de datos, limitaciones conocidas. Dá contexto geográfico o histórico cuando sea pertinente. Sé exhaustivo pero preciso. Podés agregar capas de contexto que el usuario no pidió si enriquecen el mapa.',
    // Modo teórico: exploración conceptual, combinaciones no obvias
    creativo:    'Proponé combinaciones de capas no obvias. Hacé preguntas sobre el territorio que el usuario quizás no se hizo. Sugerí perspectivas alternativas. Pensá el mapa como argumento, no como ilustración. Este es el único modo donde explorás en lugar de ejecutar.'
  };
  const toneGuide = toneInstructions[tone] || toneInstructions.default;

  const catalogo = buildCatalogo(todasLasCapas, sources);
  const mascaras  = buildMascarasDisponibles(todasLasCapas);

  const activeMapContext = activeMap
    ? `\nMAPA ACTIVO EN ESTE MOMENTO:\nTítulo: ${activeMap.titulo}\nCapas: ${activeMap.capas}\nCualquier pedido de cambio de estilo, nombre o eliminación de capa se refiere a ESTE mapa.\n`
    : '';

  const langInstruction = userLang
    ? `El usuario configuró su idioma preferido como "${userLang}". Respondé SIEMPRE en ese idioma, independientemente del idioma en que esté escrito el mensaje del usuario.`
    : `Detectá el idioma del usuario por su mensaje y respondé en ese idioma.`;

  const toneAdaptation = tone === 'default' ? `
TONO ADAPTATIVO: Leé el registro del usuario en su primer mensaje y mantené esa sintonía.
- Escribe informal o rápido → respondé con naturalidad, sin rigidez.
- Escribe formal o técnico → respondé con precisión, sin adornos.
- Primer mensaje muy corto o ambiguo → tono neutro hasta tener más contexto.
No menciones este ajuste. Adoptalo sin comentarlo.` : '';

  const closingQuestion = tone !== 'eficiente' ? `
PREGUNTA DE CIERRE: Después de generar un mapa, terminá con una pregunta corta que invite a seguir. Coherente con lo generado — no genérica. Ejemplos: "¿Filtramos por alguna zona?", "¿Agregamos otra capa?", "¿Cambiamos el estilo?". Breve, directa, sin entusiasmo artificial.` : '';

  // Ensamblar secciones independientes
  const reglasAmbiguedad  = _buildReglasAmbiguedad(tone);
  const reglasEstilo      = _buildReglasEstilo();
  const reglasOperaciones = _buildReglasOperaciones();
  const reglasCQL         = _buildReglasCQL(mascaras);
  const reglasRegiones    = _buildReglasRegiones();
  const reglasExport      = _buildReglasExport();

  return `Sos Casux, un asistente de confección de mapas con lenguaje natural. Construís mapas a partir de datos geográficos oficiales: el usuario describe lo que quiere y vos lo ejecutás. Respondé siempre en primera persona, sin presentarte salvo que te pregunten.${activeMapContext}

IDIOMA: ${langInstruction}

MODO DE RESPUESTA: ${toneGuide}
${toneAdaptation}

${reglasAmbiguedad}

CAMBIOS DE ESTILO: Cuando el usuario pide cambiar un atributo (opacidad, color, grosor, tamaño, ícono, transparencia), actuá directamente con un valor razonable. No preguntes sobre atributos de estilo.
${closingQuestion}

CATÁLOGO DE CAPAS DISPONIBLES:
${catalogo}

CAPAS RELEVANTES PARA ESTA CONSULTA (con atributos):
${capasAContexto(capasRelevantes, sources)}

${reglasEstilo}

Cuando tengas suficiente información para generar el mapa, respondé con tu mensaje + estos bloques al final:
\`\`\`map
[{
  "layerKey": "...",
  "filtro": "CQL o vacío",
  "descripcion": "texto breve"
}]
\`\`\`

"op" y "clipArea"/"intersectArea"/"bufferArea" son opcionales — solo incluirlos cuando correspondan (ver reglas de operaciones y recorte más abajo). El caso más común es sin op ni clipArea.

${reglasOperaciones}
\`\`\`style
[{"layerKey":"...","color":"#hex","fillColor":"#hex","fillOpacity":0.5,"weight":2,"opacity":1,"radius":6}]
Para capas de puntos podés agregar opcionalmente:
- "shape": "circle" (default) o "square"
- "icon": clave de ícono Maki. NUNCA incluir icon salvo que el usuario lo pida explícitamente con palabras como "con ícono", "con símbolo" o similar. NO usar ícono aunque el contexto parezca obvio (aeropuertos, hospitales, etc.) — siempre círculo por defecto. Claves disponibles: aerialway, airfield, airport, alcohol-shop, american-football, amusement-park, animal-shelter, aquarium, art-gallery, attraction, bakery, bank, bar, barrier, baseball, basketball, bbq, beach, beer, bicycle, bicycle-share, blood-bank, bowling-alley, bridge, building, building-alt1, bus, cafe, campsite, car, car-rental, car-repair, casino, castle, caution, cemetery, charging-station, cinema, city, clothing-store, college, commercial, communications-tower, confectionery, construction, convenience, cricket, cross, dam, danger, defibrillator, dentist, doctor, dog-park, drinking-water, elevator, embassy, emergency-phone, entrance, entrance-alt1, farm, fast-food, fence, ferry, fire-station, fitness-centre, florist, fuel, furniture, gaming, garden, garden-centre, gate, gift, globe, golf, grocery, hairdresser, harbor, hardware, heart, heliport, highway-rest-area, historic, home, horse-riding, hospital, hot-spring, ice-cream, industry, information, jewelry-store, karaoke, landmark, landuse, laundry, library, lift-gate, lighthouse, lodging, logging, marker, mobile-phone, monument, mosque, mountain, museum, music, natural, nightclub, observation-tower, optician, park, park-alt1, parking, parking-garage, parking-paid, pharmacy, picnic-site, pitch, place-of-worship, playground, police, post, prison, racetrack, rail, rail-light, rail-metro, ranger-station, recycling, religious-buddhist, religious-christian, religious-jewish, religious-muslim, religious-shinto, residential-community, restaurant, road-accident, roadblock, rocket, school, scooter, shelter, shoe, shop, skateboard, skiing, slaughterhouse, slipway, soccer, social-facility, stadium, star, suitcase, swimming, table-tennis, taxi, teahouse, telephone, tennis, terminal, theatre, toilet, toll, town, town-hall, tree, tunnel, veterinary, viewpoint, village, volcano, volleyball, warehouse, waste-basket, water, waterfall, watermill, wetland, wheelchair, windmill, zoo
- "iconColor": color del ícono SVG en hex (default "#ffffff")
\`\`\`
\`\`\`chat-title
Título geográfico del mapa. Máximo 6 palabras. Ejemplos: "Puertos y rutas de Santa Cruz", "Áreas protegidas de Patagonia". NUNCA uses el texto del usuario como título.
Cuándo incluirlo: SIEMPRE que generes un bloque \`\`\`map\`\`\`, EXCEPTO cuando sea un refinamiento del mapa activo (filtro provincial/departamental, cambio de estilo, cambio de región de capa ya presente). Si el usuario pide un mapa de tema distinto al mapa activo, SÍ incluir con el nuevo tema.
\`\`\`
${reglasCQL}

${reglasRegiones}

${reglasExport}`;
}


// ── Streaming con OpenAI-compatible API (Cerebras/Groq) ───────────

async function streamOpenAI(url, model, apiKey, systemPrompt, messages, res) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      ]
    })
  });

  if (resp.status === 429 || resp.status === 503 || resp.status === 413) {
    // 429 = rate limit, 503 = servicio no disponible, 413 = contexto demasiado grande
    // Los tres son retriables: el siguiente proveedor puede tener límites distintos.
    throw Object.assign(new Error(`Rate limit HTTP ${resp.status}`), { rateLimit: true });
  }
  if (!resp.ok) {
    const errText = await resp.text();
    // Extraer solo el mensaje legible si el body es JSON de la API del proveedor.
    // Evita mostrar al usuario JSON crudo con URLs internas y códigos técnicos.
    let errMsg = `HTTP ${resp.status}`;
    try {
      const errJson = JSON.parse(errText);
      const msg = errJson?.error?.message || errJson?.message;
      if (msg) errMsg = msg.split('\n')[0].split('. Need')[0].trim();
    } catch { /* body no es JSON — usar status code solamente */ }
    throw new Error(errMsg);
  }

  // Leer el stream de SSE con buffer acumulativo para no partir líneas
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let fullText = '';
  let lineBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // decode sin stream:true para evitar corrupción de caracteres UTF-8 en límites de chunk
    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split('\n');
    // La última "línea" puede estar incompleta — guardarla para el próximo chunk
    lineBuffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content || '';
        if (token) {
          fullText += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      } catch {}
    }
  }
  // Procesar cualquier dato restante en el buffer
  if (lineBuffer.startsWith('data: ')) {
    const data = lineBuffer.slice(6).trim();
    if (data && data !== '[DONE]') {
      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content || '';
        if (token) { fullText += token; res.write(`data: ${JSON.stringify({ token })}\n\n`); }
      } catch {}
    }
  }
  return fullText;
}

// ── Gemini (no streaming, fallback) ──────────────────────────────

async function callGemini(apiKey, systemPrompt, messages) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  });
  if (resp.status === 429 || resp.status === 503 || resp.status === 413) {
    throw Object.assign(new Error(`Gemini rate limit ${resp.status}`), { rateLimit: true });
  }
  if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS headers vienen de vercel.json — no duplicar acá.
  // Verificar origen para bloquear llamadas externas no autorizadas.
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const cerebrasKey   = process.env.CEREBRAS_API_KEY;
  const groqKey       = process.env.GROQ_API_KEY;
  const mistralKey    = process.env.MISTRAL_API_KEY;
  const geminiKey     = process.env.GEMINI_API_KEY;

  if (!cerebrasKey && !groqKey && !mistralKey && !geminiKey) {
    return res.status(500).json({ error: 'No hay API keys configuradas' });
  }

  const { messages, layers, sources, model, tone, activeMap, userLang } = req.body || {};
  if (!messages?.length) return res.status(400).json({ error: 'Se requiere messages' });

  const textoUsuario    = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const capasRelevantes = buscarCapasRelevantes(textoUsuario, layers || {});
  console.log(`[llm] Capas relevantes para "${textoUsuario.slice(0, 60)}": ${capasRelevantes.map(c => c.key).join(', ')}`);
  const systemPrompt    = buildSystemPrompt(capasRelevantes, layers || {}, tone || 'default', activeMap, sources || {}, userLang || null);

  // Configurar SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // ── Selección de proveedores ──────────────────────────────────
  //
  // Gemini no tiene streaming nativo compatible con SSE, así que se
  // maneja separado: primero intentamos los proveedores streaming
  // (Cerebras/Groq/Mistral/DeepSeek) y Gemini queda como fallback final
  // — o como proveedor único si el usuario lo seleccionó explícitamente.
  //
  // useGeminiOnly: el usuario eligió Gemini → saltar los demás
  // useGeminiFallback: modo auto → usar Gemini si los otros fallan

  const useGeminiOnly     = model === 'gemini';
  const useGeminiFallback = !useGeminiOnly;

  const proveedores = [];
  if (!useGeminiOnly) {
    if (model === 'cerebras' && cerebrasKey) {
      proveedores.push({ nombre: 'Cerebras',  fn: () => streamOpenAI(CEREBRAS_URL,  CEREBRAS_MODEL,  cerebrasKey,  systemPrompt, messages, res) });
    } else if (model === 'groq' && groqKey) {
      proveedores.push({ nombre: 'Groq',      fn: () => streamOpenAI(GROQ_URL,      GROQ_MODEL,      groqKey,      systemPrompt, messages, res) });
    } else if (model === 'groq-oss' && groqKey) {
      proveedores.push({ nombre: 'Groq OSS',  fn: () => streamOpenAI(GROQ_OSS_URL,  GROQ_OSS_MODEL,  groqKey,      systemPrompt, messages, res) });
    } else if (model === 'mistral' && mistralKey) {
      proveedores.push({ nombre: 'Mistral',   fn: () => streamOpenAI(MISTRAL_URL,   MISTRAL_MODEL,   mistralKey,   systemPrompt, messages, res) });
    } else {
      // Auto: Cerebras → Groq → Groq OSS → Mistral con fallback
      if (cerebrasKey)  proveedores.push({ nombre: 'Cerebras',  fn: () => streamOpenAI(CEREBRAS_URL,  CEREBRAS_MODEL,  cerebrasKey,  systemPrompt, messages, res) });
      if (groqKey)      proveedores.push({ nombre: 'Groq',      fn: () => streamOpenAI(GROQ_URL,      GROQ_MODEL,      groqKey,      systemPrompt, messages, res) });
      if (groqKey)      proveedores.push({ nombre: 'Groq OSS',  fn: () => streamOpenAI(GROQ_OSS_URL,  GROQ_OSS_MODEL,  groqKey,      systemPrompt, messages, res) });
      if (mistralKey)   proveedores.push({ nombre: 'Mistral',   fn: () => streamOpenAI(MISTRAL_URL,   MISTRAL_MODEL,   mistralKey,   systemPrompt, messages, res) });
    }
  }

  let fullText  = '';
  let success   = false;
  let usedModel = 'auto';
  const providerErrors = []; // acumula errores para el mensaje final honesto

  // Intentar proveedores streaming
  for (const p of proveedores) {
    try {
      fullText  = await p.fn();
      success   = true;
      usedModel = p.nombre.toLowerCase();
      console.log(`[llm] Streaming OK: ${p.nombre}`);
      break;
    } catch (err) {
      const isRetriable = err.rateLimit || err.name === 'TimeoutError' || err.name === 'AbortError';
      if (isRetriable) {
        // Rate limit o timeout — intentar el siguiente proveedor
        console.warn(`[llm] ${p.nombre} no disponible (${err.message}), probando siguiente...`);
        providerErrors.push({ nombre: p.nombre, err });
        continue;
      }
      // Error no retriable (400, 401, 500, etc.) — loguear el error técnico y mostrar mensaje genérico al usuario.
      console.error(`[llm] ${p.nombre} error no retriable: ${err.message}`);
      const userMsg = 'No se pudo obtener una respuesta. Intentá de nuevo.';
      res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
      res.end();
      return;
    }
  }

  // Gemini: usarlo si fue seleccionado explícitamente o si todos los anteriores fallaron
  if (!success && (useGeminiOnly || useGeminiFallback) && geminiKey) {
    try {
      fullText = await callGemini(geminiKey, systemPrompt, messages);
      // Simular streaming para Gemini enviando chunks de 256 chars.
      // Sin delay entre chunks: el loop completo para 8000 chars tarda microsegundos,
      // y un delay artificial de 15ms por chunk de 8 sumaba hasta 15s — superaba el
      // límite de 10s de Vercel Hobby para una respuesta de 2048 tokens.
      const CHUNK = 256;
      for (let i = 0; i < fullText.length; i += CHUNK) {
        res.write(`data: ${JSON.stringify({ token: fullText.slice(i, i + CHUNK) })}\n\n`);
      }
      success   = true;
      usedModel = 'gemini';
    } catch (err) {
      providerErrors.push({ nombre: 'Gemini', err });
      // Mensaje final honesto según qué falló realmente
      const allTimeout   = providerErrors.every(e => e.err.name === 'TimeoutError' || e.err.name === 'AbortError');
      const allRateLimit = providerErrors.every(e => e.err.rateLimit);
      const finalMsg = allTimeout
        ? 'Los proveedores de IA tardaron demasiado. Intentá de nuevo en unos segundos.'
        : allRateLimit
          ? 'Los proveedores de IA están saturados en este momento. Intentá de nuevo en unos segundos.'
          : 'No se pudo conectar con ningún proveedor de IA. Intentá de nuevo en unos segundos.';
      console.error(`[llm] Todos los proveedores fallaron:`, providerErrors.map(e => `${e.nombre}: ${e.err.message}`).join(', '));
      res.write(`data: ${JSON.stringify({ error: finalMsg })}\n\n`);
      res.end();
      return;
    }
  }

  // Si ningún proveedor respondió (todas las keys ausentes o todos fallaron sin Gemini),
  // enviar un error explícito en lugar de una respuesta vacía silenciosa.
  if (!success) {
    const msg = providerErrors.length
      ? 'No se pudo conectar con ningún proveedor de IA. Intentá de nuevo en unos segundos.'
      : 'No hay proveedores de IA disponibles. Verificá la configuración.';
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
    return;
  }

  // Enviar el texto completo al final para que el cliente lo procese
  res.write(`data: ${JSON.stringify({ done: true, fullText, model: usedModel })}\n\n`);
  res.end();
};
