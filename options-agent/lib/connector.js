/**
 * Connettore verso il sistema multiagentico di opzioni che gira sul mini.
 *
 * Il sistema può esporre interfacce diverse, quindi qui ci sono più adattatori
 * e un rilevamento automatico:
 *
 *   openai → POST /v1/chat/completions (stream SSE)      — LiteLLM, vLLM, AutoGen Studio, CrewAI server…
 *   json   → POST /query|/ask|/run|/invoke (JSON secco)  — FastAPI/LangServe fatti in casa
 *   sse    → POST endpoint che risponde text/event-stream
 *   ollama → POST /api/chat (NDJSON)
 *   mock   → simulazione locale, per provare la UI prima di collegare il mini
 */

'use strict';

const { current } = require('./config');
const { queryToPrompt, describeQuery } = require('./schema');

const JSON_PATHS = ['/query', '/ask', '/run', '/chat', '/invoke', '/api/query', '/api/ask', '/api/chat'];
const TEXT_KEYS = [
  'answer', 'output', 'result', 'response', 'final_answer', 'final', 'summary',
  'content', 'text', 'message', 'reply', 'completion',
];

let detectCache = { at: 0, key: '', value: null };

function headers(extra) {
  const h = Object.assign({ 'content-type': 'application/json', accept: 'text/event-stream, application/json' }, extra);
  if (current.multiagent.token) h.authorization = `Bearer ${current.multiagent.token}`;
  return h;
}

function urlFor(path) {
  const base = current.multiagent.url;
  if (!base) throw new Error('MULTIAGENT_URL non configurato');
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

async function tryGet(path, timeout = 2500) {
  try {
    const res = await fetch(urlFor(path), { headers: headers(), signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    const body = type.includes('json') ? await res.json() : (await res.text()).slice(0, 2000);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** Indovina interfaccia e percorso del sistema remoto. */
async function detect(force = false) {
  const key = `${current.multiagent.url}|${current.multiagent.mode}|${current.multiagent.path}`;
  if (!force && detectCache.value && detectCache.key === key && Date.now() - detectCache.at < 60000) {
    return detectCache.value;
  }

  let result;
  if (current.multiagent.mode === 'mock' || !current.multiagent.url) {
    result = {
      mode: 'mock',
      path: null,
      ok: true,
      detail: current.multiagent.url
        ? 'Modalità simulazione forzata.'
        : 'Nessun MULTIAGENT_URL: modalità simulazione.',
    };
  } else if (current.multiagent.mode !== 'auto') {
    const path = current.multiagent.path || defaultPath(current.multiagent.mode);
    const probe = await tryGet('/health') || await tryGet('/healthz') || await tryGet('/');
    result = {
      mode: current.multiagent.mode,
      path,
      ok: Boolean(probe),
      detail: probe ? 'Endpoint raggiungibile.' : 'Endpoint configurato ma non risponde alle probe di salute.',
    };
  } else {
    result = await autoDetect();
  }

  detectCache = { at: Date.now(), key, value: result };
  return result;
}

function looksLikeModelList(body) {
  if (!body || typeof body !== 'object') return false;
  return Array.isArray(body.data) || body.object === 'list' || Array.isArray(body.models);
}

function defaultPath(mode) {
  if (mode === 'openai') return '/v1/chat/completions';
  if (mode === 'ollama') return '/api/chat';
  return '/query';
}

async function autoDetect() {
  // Le probe verificano anche la forma della risposta: un backend che risponde
  // 200 a qualunque percorso non deve essere scambiato per compatibile OpenAI.
  const models = await tryGet('/v1/models');
  if (models && looksLikeModelList(models.body)) {
    return { mode: 'openai', path: '/v1/chat/completions', ok: true, detail: 'Rilevata API compatibile OpenAI (/v1/models).' };
  }

  const tags = await tryGet('/api/tags');
  if (tags && tags.body && Array.isArray(tags.body.models)) {
    return { mode: 'ollama', path: '/api/chat', ok: true, detail: 'Rilevato Ollama (/api/tags).' };
  }

  const openapi = (await tryGet('/openapi.json')) || (await tryGet('/openapi.yaml'));
  if (openapi && openapi.body && typeof openapi.body === 'object' && openapi.body.paths) {
    const paths = Object.keys(openapi.body.paths);
    if (paths.includes('/v1/chat/completions')) {
      return { mode: 'openai', path: '/v1/chat/completions', ok: true, detail: 'OpenAPI espone /v1/chat/completions.' };
    }
    const match = JSON_PATHS.find((p) => paths.includes(p)) || paths.find((p) => /query|ask|run|invoke|chat|stream/i.test(p));
    if (match) {
      return { mode: 'json', path: match, ok: true, detail: `OpenAPI espone ${match}.` };
    }
  }

  for (const path of JSON_PATHS) {
    const head = await tryGet(path, 1500);
    if (head) return { mode: 'json', path, ok: true, detail: `Endpoint ${path} raggiungibile.` };
  }

  const root = (await tryGet('/health')) || (await tryGet('/healthz')) || (await tryGet('/'));
  if (root) {
    return {
      mode: 'json',
      path: current.multiagent.path || '/query',
      ok: true,
      detail: 'Host raggiungibile ma interfaccia non riconosciuta: uso POST JSON. Imposta MULTIAGENT_MODE/PATH se serve.',
    };
  }

  return {
    mode: current.multiagent.mode === 'auto' ? 'json' : current.multiagent.mode,
    path: current.multiagent.path || '/query',
    ok: false,
    detail: `Nessuna risposta da ${current.multiagent.url}. Controlla indirizzo, porta e rete del container.`,
  };
}

/** Stato per la UI: indirizzo, modalità rilevata, raggiungibilità. */
async function status(force = false) {
  const started = Date.now();
  const info = await detect(force);
  return {
    url: current.multiagent.url || null,
    configuredMode: current.multiagent.mode,
    mode: info.mode,
    path: info.path,
    ok: info.ok,
    detail: info.detail,
    latencyMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Lettura degli stream
// ---------------------------------------------------------------------------

async function* lines(res) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}

/** Estrae il testo utile da un frammento di stream, qualunque forma abbia. */
function chunkToText(payload) {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map(chunkToText).join('');

  const choice = payload.choices?.[0];
  if (choice) {
    if (typeof choice.delta?.content === 'string') return choice.delta.content;
    if (typeof choice.message?.content === 'string') return choice.message.content;
    if (typeof choice.text === 'string') return choice.text;
  }
  if (typeof payload.message?.content === 'string') return payload.message.content; // Ollama
  for (const key of ['token', 'delta', 'chunk', ...TEXT_KEYS]) {
    const value = payload[key];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const nested = chunkToText(value);
      if (nested) return nested;
    }
  }
  return '';
}

/** Nome dell'agente, se il sistema remoto lo dichiara nel frammento. */
function chunkToAgent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const name = payload.agent || payload.agent_name || payload.name || payload.speaker || payload.node;
  if (typeof name === 'string' && name && name !== 'assistant') return name;
  return null;
}

function parseMaybeJson(raw) {
  const text = raw.trim();
  if (!text || text === '[DONE]') return { done: text === '[DONE]', value: null };
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return { done: false, value: JSON.parse(text) };
    } catch {
      return { done: false, value: text };
    }
  }
  return { done: false, value: text };
}

async function consumeStream(res, emit) {
  let full = '';
  let currentAgent = null;

  for await (const line of lines(res)) {
    if (!line.trim()) continue;
    const raw = line.startsWith('data:') ? line.slice(5).trim() : line;
    if (line.startsWith('event:') || line.startsWith(':') || line.startsWith('id:')) continue;

    const { done, value } = parseMaybeJson(raw);
    if (done) break;
    if (value === null) continue;

    const agent = chunkToAgent(value);
    if (agent && agent !== currentAgent) {
      currentAgent = agent;
      emit({ type: 'agent', name: agent });
      const header = `\n\n[${agent}]\n`;
      full += header;
      emit({ type: 'token', text: header });
    }

    const text = chunkToText(value);
    if (text) {
      full += text;
      emit({ type: 'token', text });
    }
  }
  return full;
}

/** Trova la risposta testuale dentro un JSON non-streaming. */
function extractAnswer(data, depth = 0) {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object' || depth > 4) return '';

  const direct = chunkToText(data);
  if (direct) return direct;

  if (Array.isArray(data)) {
    const parts = data.map((item) => extractAnswer(item, depth + 1)).filter(Boolean);
    if (parts.length) return parts.join('\n\n');
  }
  for (const value of Object.values(data)) {
    const found = extractAnswer(value, depth + 1);
    if (found) return found;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Adattatori
// ---------------------------------------------------------------------------

async function runOpenAI(prompt, info, emit, signal) {
  const res = await fetch(urlFor(info.path || '/v1/chat/completions'), {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify({
      model: current.multiagent.model || 'default',
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Sistema multiagentico ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const type = res.headers.get('content-type') || '';
  if (type.includes('json') && !type.includes('event-stream')) {
    const data = await res.json();
    const text = extractAnswer(data) || JSON.stringify(data, null, 2);
    emit({ type: 'token', text });
    return text;
  }
  return consumeStream(res, emit);
}

async function runOllama(prompt, info, emit, signal) {
  const res = await fetch(urlFor(info.path || '/api/chat'), {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify({
      model: current.multiagent.model || 'llama3.2',
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return consumeStream(res, emit);
}

async function runJson(prompt, info, emit, signal, query) {
  // Alias multipli: ogni backend fatto in casa cerca il campo che preferisce.
  const payload = {
    prompt,
    query: prompt,
    input: prompt,
    message: prompt,
    question: prompt,
    text: prompt,
    stream: true,
    structured_query: query,
    metadata: { source: 'cammellopazzo-options-agent', summary: describeQuery(query) },
  };
  if (current.multiagent.model) payload.model = current.multiagent.model;

  const res = await fetch(urlFor(info.path || '/query'), {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sistema multiagentico ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const type = res.headers.get('content-type') || '';
  if (type.includes('event-stream') || type.includes('x-ndjson')) return consumeStream(res, emit);

  if (type.includes('json')) {
    const data = await res.json();
    const text = extractAnswer(data) || JSON.stringify(data, null, 2);
    emit({ type: 'token', text });
    return text;
  }
  const text = await res.text();
  emit({ type: 'token', text });
  return text;
}

const MOCK_AGENTS = [
  ['quant', (q) => `Prezzo la struttura con Black-Scholes e vol di mercato simulata. ${q.underlyings[0] || 'Il sottostante'} a ${q.horizon.dte || 30} DTE: delta netto ≈ 0.04, theta ≈ +18/giorno, vega ≈ -42. Credito stimato 3.20 su ampiezza 10 → rischio massimo 680.`],
  ['volatility', (q) => `IV rank simulato 38%: la vol è a metà del suo range annuale. ${q.scenarios.length ? 'Sullo scenario richiesto il vega lavora a favore della posizione corta di vol.' : 'Nessuno scenario richiesto: valuto solo il livello corrente.'}`],
  ['risk', (q) => `Con perdita massima ${q.constraints.max_risk ? `sotto ${q.constraints.max_risk} ${q.constraints.currency || 'EUR'}` : 'non vincolata'}, suggerisco size 1 contratto e uscita a 50% del credito o a 21 DTE.`],
  ['supervisor', () => 'Sintesi: struttura coerente con un profilo neutrale, il rischio principale è un movimento direzionale rapido. Dati simulati — collega MULTIAGENT_URL al sistema sul mini per numeri reali.'],
];

async function runMock(prompt, info, emit, signal, query) {
  let full = '';
  for (const [name, build] of MOCK_AGENTS) {
    if (signal?.aborted) break;
    emit({ type: 'agent', name });
    const body = `\n\n[${name}]\n${build(query)}`;
    for (const piece of body.match(/[\s\S]{1,24}/g) || []) {
      if (signal?.aborted) break;
      full += piece;
      emit({ type: 'token', text: piece });
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  return full;
}

/**
 * Invia la query al sistema multiagentico e trasmette la risposta.
 * `emit` riceve eventi {type:'token'|'agent', ...}.
 */
async function run(query, { emit, signal } = {}) {
  const info = await detect();
  const prompt = queryToPrompt(query);
  const send = typeof emit === 'function' ? emit : () => {};

  const timeout = AbortSignal.timeout(current.multiagent.timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  send({ type: 'status', text: `Interrogo il sistema multiagentico (${info.mode}${info.path ? ' ' + info.path : ''})…` });

  let text;
  if (info.mode === 'mock') text = await runMock(prompt, info, send, composed, query);
  else if (info.mode === 'openai') text = await runOpenAI(prompt, info, send, composed);
  else if (info.mode === 'ollama') text = await runOllama(prompt, info, send, composed);
  else text = await runJson(prompt, info, send, composed, query);

  return { text: text || '', mode: info.mode, path: info.path, prompt };
}

module.exports = { run, status, detect, extractAnswer };
