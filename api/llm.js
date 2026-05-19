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
const { buildSystemPrompt: buildPromptEs } = require('./prompts/_es');
const { buildSystemPrompt: buildPromptEn } = require('./prompts/_en');
const { buildSystemPrompt: buildPromptPt } = require('./prompts/_pt');

function buscarCapasRelevantes(textoUsuario, layers, max = 5, userLang = 'es') {
  const norm = normalizar(textoUsuario);
  const palabras = norm.split(/\s+/).filter(p => p.length > 2 && !STOPWORDS.includes(p));
  // Excluir capas special y capas visible:false (gemelas, técnico-geodésicas)
  const capasValidas = Object.entries(layers).filter(([, capa]) => capa.special === false && capa.visible !== false);
  if (!palabras.length) return capasValidas.slice(0, max).map(([k, v]) => ({ key: k, ...v }));

  // Usar campos del idioma del usuario si existen
  const sufijo = userLang === 'en' ? 'En' : userLang === 'pt' ? 'Pt' : 'Es';

  const scored = capasValidas
    .map(([key, capa]) => {
      const tituloUIi18n = capa[`tituloUI${sufijo}`] || capa.tituloUI || '';
      const keywordsI18n = capa[`keywords${sufijo}`] || capa.keywords || [];
      const textoCapa = normalizar([tituloUIi18n, capa.titulo, capa.abstract || '', key,
        keywordsI18n.join(' '),
        (capa.attributes || []).map(a => (a.label || '') + ' ' + (a.campo || '')).join(' '),
        sufijo !== 'Es' ? (capa.tituloUI || '') : '',
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

// ── Mensajes de error i18n ────────────────────────────────────────
const ERR = {
  no_keys:       { es: 'No hay API keys configuradas',                                                                         en: 'No API keys configured',                                                                pt: 'Nenhuma chave de API configurada'                                                           },
  no_messages:   { es: 'Se requiere messages',                                                                                 en: 'messages is required',                                                                  pt: 'messages é obrigatório'                                                                     },
  non_retriable: { es: 'No se pudo obtener una respuesta. Intentá de nuevo.',                                          en: 'Could not get a response. Please try again.',                                           pt: 'Não foi possível obter uma resposta. Tente novamente.'                                      },
  timeout:       { es: 'Los proveedores de IA tardaron demasiado. Intentá de nuevo en unos segundos.',                        en: 'AI providers took too long. Please try again in a few seconds.',                        pt: 'Os provedores de IA demoraram demais. Tente novamente em alguns segundos.'                  },
  rate_limit:    { es: 'Los proveedores de IA están saturados en este momento. Intentá de nuevo en unos segundos.',           en: 'AI providers are overloaded right now. Please try again in a few seconds.',             pt: 'Os provedores de IA estão sobrecarregados no momento. Tente novamente em alguns segundos.' },
  no_provider:   { es: 'No se pudo conectar con ningún proveedor de IA. Intentá de nuevo en unos segundos.',                  en: 'Could not connect to any AI provider. Please try again in a few seconds.',              pt: 'Não foi possível conectar a nenhum provedor de IA. Tente novamente em alguns segundos.'    },
  no_available:  { es: 'No hay proveedores de IA disponibles. Verificá la configuración.',                                    en: 'No AI providers available. Check the configuration.',                                   pt: 'Nenhum provedor de IA disponível. Verifique a configuração.'                               },
};
function t(key, lang) { return ERR[key]?.[lang] || ERR[key]?.es || key; }


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
    return res.status(500).json({ error: t('no_keys', 'es') });
  }

  const { messages, layers, sources, model, tone, activeMap, userLang } = req.body || {};
  if (!messages?.length) return res.status(400).json({ error: t('no_messages', req.body?.userLang || 'es') });

  const textoUsuario    = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const capasRelevantes = buscarCapasRelevantes(textoUsuario, layers || {}, 5, userLang || 'es');
  console.log(`[llm] Capas relevantes para "${textoUsuario.slice(0, 60)}": ${capasRelevantes.map(c => c.key).join(', ')}`);
  const _promptBuilders = { es: buildPromptEs, en: buildPromptEn, pt: buildPromptPt };
  const _buildPrompt    = _promptBuilders[userLang] || buildPromptEs;
  const systemPrompt    = _buildPrompt(capasRelevantes, layers || {}, tone || 'default', activeMap, sources || {});

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
      res.write(`data: ${JSON.stringify({ error: t('non_retriable', userLang) })}\n\n`);
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
        ? t('timeout', userLang)
        : allRateLimit
          ? t('rate_limit', userLang)
          : t('no_provider', userLang);
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
      ? t('no_provider', userLang)
      : t('no_available', userLang);
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
    return;
  }

  // Enviar el texto completo al final para que el cliente lo procese
  res.write(`data: ${JSON.stringify({ done: true, fullText, model: usedModel })}\n\n`);
  res.end();
};
