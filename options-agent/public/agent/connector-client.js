/**
 * Connettore lato client: parla direttamente con il sistema multiagentico.
 *
 * È la versione browser di lib/connector.js, usata quando non c'è un server
 * Node davanti — cioè nell'app Android, dove il telefono raggiunge il mac via
 * Tailscale e non passa da Umbrel.
 */

import { queryToPrompt, describeQuery } from '../lib/schema.js';
import { PORTE_COMUNI, parseHost } from '../lib/ports.js';

const JSON_PATHS = ['/query', '/ask', '/run', '/chat', '/invoke', '/api/query', '/api/ask', '/api/chat'];
const TEXT_KEYS = [
  'answer', 'output', 'result', 'response', 'final_answer', 'final', 'summary',
  'content', 'text', 'message', 'reply', 'completion',
];

let cache = { at: 0, chiave: '', valore: null };

function headers(settings) {
  const h = { 'content-type': 'application/json', accept: 'text/event-stream, application/json' };
  if (settings.token) h.authorization = `Bearer ${settings.token}`;
  return h;
}

function urlFor(settings, p) {
  const base = String(settings.url || '').replace(/\/+$/, '');
  if (!base) throw new Error('Endpoint non configurato');
  return `${base}${p.startsWith('/') ? p : '/' + p}`;
}

async function tryGet(settings, p, timeout = 3000) {
  try {
    const res = await fetch(urlFor(settings, p), {
      headers: headers(settings),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const type = headerOf(res, 'content-type');
    const body = type.includes('json') ? await res.json() : (await res.text()).slice(0, 2000);
    return { body };
  } catch {
    return null;
  }
}

/**
 * Legge un header in modo tollerante: nell'app Android le richieste passano dal
 * livello nativo e la Response può non essere quella standard del browser.
 */
function headerOf(res, nome) {
  try {
    if (res.headers && typeof res.headers.get === 'function') return res.headers.get(nome) || '';
    if (res.headers && typeof res.headers === 'object') return res.headers[nome] || res.headers[nome.toLowerCase()] || '';
  } catch {
    // niente header disponibili: si tratta la risposta come testo
  }
  return '';
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

/** Rileva l'interfaccia del sistema remoto, come fa il server. */
export async function detect(settings, force = false) {
  const chiave = `${settings.url}|${settings.mode}|${settings.path}`;
  if (!force && cache.valore && cache.chiave === chiave && Date.now() - cache.at < 60000) return cache.valore;

  let esito;
  if (settings.mode === 'mock' || !settings.url) {
    esito = {
      mode: 'mock',
      path: null,
      ok: true,
      detail: settings.url ? 'Modalità simulazione forzata.' : 'Nessun endpoint configurato: modalità simulazione.',
    };
  } else if (settings.mode && settings.mode !== 'auto') {
    const probe = (await tryGet(settings, '/health')) || (await tryGet(settings, '/healthz')) || (await tryGet(settings, '/'));
    esito = {
      mode: settings.mode,
      path: settings.path || defaultPath(settings.mode),
      ok: Boolean(probe),
      detail: probe ? 'Endpoint raggiungibile.' : 'Endpoint configurato ma non risponde alle probe di salute.',
    };
  } else {
    const models = await tryGet(settings, '/v1/models');
    const tags = models ? null : await tryGet(settings, '/api/tags');
    const openapi = models || tags ? null : await tryGet(settings, '/openapi.json');

    if (models && looksLikeModelList(models.body)) {
      esito = { mode: 'openai', path: '/v1/chat/completions', ok: true, detail: 'Rilevata API compatibile OpenAI.' };
    } else if (tags && tags.body && Array.isArray(tags.body.models)) {
      esito = { mode: 'ollama', path: '/api/chat', ok: true, detail: 'Rilevato Ollama.' };
    } else if (openapi && openapi.body && openapi.body.paths) {
      const percorsi = Object.keys(openapi.body.paths);
      const scelto = percorsi.includes('/v1/chat/completions')
        ? '/v1/chat/completions'
        : JSON_PATHS.find((p) => percorsi.includes(p)) || percorsi.find((p) => /query|ask|run|invoke|chat/i.test(p));
      esito = scelto === '/v1/chat/completions'
        ? { mode: 'openai', path: scelto, ok: true, detail: 'OpenAPI espone /v1/chat/completions.' }
        : scelto
          ? { mode: 'json', path: scelto, ok: true, detail: `OpenAPI espone ${scelto}.` }
          : null;
    }

    if (!esito) {
      let trovato = null;
      for (const p of JSON_PATHS) {
        if (await tryGet(settings, p, 1500)) {
          trovato = p;
          break;
        }
      }
      if (trovato) esito = { mode: 'json', path: trovato, ok: true, detail: `Endpoint ${trovato} raggiungibile.` };
    }

    if (!esito) {
      const root = (await tryGet(settings, '/health')) || (await tryGet(settings, '/'));
      esito = root
        ? { mode: 'json', path: settings.path || '/query', ok: true, detail: 'Host raggiungibile, interfaccia non riconosciuta: uso POST JSON.' }
        : { mode: 'json', path: settings.path || '/query', ok: false, detail: `Nessuna risposta da ${settings.url}. Sei nella stessa rete/tailnet del mac?` };
    }
  }

  cache = { at: Date.now(), chiave, valore: esito };
  return esito;
}

/** Righe dello stream; se il body non è leggibile a pezzi si legge tutto insieme. */
async function* lines(res) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const testo = await res.text();
    for (const riga of testo.split('\n')) yield riga;
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      yield buffer.slice(0, i).replace(/\r$/, '');
      buffer = buffer.slice(i + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

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
  if (typeof payload.message?.content === 'string') return payload.message.content;
  for (const key of ['token', 'delta', 'chunk', ...TEXT_KEYS]) {
    const value = payload[key];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const dentro = chunkToText(value);
      if (dentro) return dentro;
    }
  }
  return '';
}

function chunkToAgent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const nome = payload.agent || payload.agent_name || payload.name || payload.speaker || payload.node;
  return typeof nome === 'string' && nome && nome !== 'assistant' ? nome : null;
}

export function extractAnswer(data, depth = 0) {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object' || depth > 4) return '';
  const diretto = chunkToText(data);
  if (diretto) return diretto;
  if (Array.isArray(data)) {
    const parti = data.map((x) => extractAnswer(x, depth + 1)).filter(Boolean);
    if (parti.length) return parti.join('\n\n');
  }
  for (const value of Object.values(data)) {
    const trovato = extractAnswer(value, depth + 1);
    if (trovato) return trovato;
  }
  return '';
}

async function consume(res, emit) {
  let full = '';
  let agenteCorrente = null;
  for await (const riga of lines(res)) {
    if (!riga.trim()) continue;
    if (riga.startsWith('event:') || riga.startsWith(':') || riga.startsWith('id:')) continue;
    const grezzo = riga.startsWith('data:') ? riga.slice(5).trim() : riga.trim();
    if (!grezzo || grezzo === '[DONE]') {
      if (grezzo === '[DONE]') break;
      continue;
    }

    let valore = grezzo;
    if (grezzo.startsWith('{') || grezzo.startsWith('[')) {
      try {
        valore = JSON.parse(grezzo);
      } catch {
        valore = grezzo;
      }
    }

    const agente = chunkToAgent(valore);
    if (agente && agente !== agenteCorrente) {
      agenteCorrente = agente;
      emit({ type: 'agent', name: agente });
      const testa = `\n\n[${agente}]\n`;
      full += testa;
      emit({ type: 'token', text: testa });
    }
    const testo = chunkToText(valore);
    if (testo) {
      full += testo;
      emit({ type: 'token', text: testo });
    }
  }
  return full;
}

const MOCK = [
  ['quant', (q) => `Prezzo la struttura con vol simulata. ${q.underlyings[0] || 'Il sottostante'} a ${q.horizon.dte || 30} DTE: delta netto ≈ 0.04, theta ≈ +18/giorno, vega ≈ -42.`],
  ['risk', (q) => `Perdita massima ${q.constraints.max_risk ? `sotto ${q.constraints.max_risk}` : 'non vincolata'}: size 1 contratto, uscita a 50% del credito o a 21 DTE.`],
  ['supervisor', () => 'Dati simulati — collega l\'endpoint del mac per numeri reali.'],
];

async function runMock(query, emit, signal) {
  let full = '';
  for (const [nome, costruisci] of MOCK) {
    if (signal?.aborted) break;
    emit({ type: 'agent', name: nome });
    const corpo = `\n\n[${nome}]\n${costruisci(query)}`;
    for (const pezzo of corpo.match(/[\s\S]{1,24}/g) || []) {
      if (signal?.aborted) break;
      full += pezzo;
      emit({ type: 'token', text: pezzo });
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  return full;
}

/** Invia la query al sistema multiagentico e trasmette la risposta. */
export async function run(query, settings, { emit, signal } = {}) {
  const info = await detect(settings);
  const prompt = queryToPrompt(query);
  const send = typeof emit === 'function' ? emit : () => {};

  send({ type: 'status', text: `Interrogo il sistema (${info.mode}${info.path ? ' ' + info.path : ''})…` });
  if (info.mode === 'mock') return { text: await runMock(query, send, signal), mode: 'mock', prompt };

  const timeout = AbortSignal.timeout(settings.timeoutMs || 180000);
  const composto = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res;
  if (info.mode === 'openai' || info.mode === 'ollama') {
    res = await fetch(urlFor(settings, info.path || defaultPath(info.mode)), {
      method: 'POST',
      headers: headers(settings),
      signal: composto,
      body: JSON.stringify({
        model: settings.model || (info.mode === 'ollama' ? 'llama3.2' : 'default'),
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } else {
    res = await fetch(urlFor(settings, info.path || '/query'), {
      method: 'POST',
      headers: headers(settings),
      signal: composto,
      body: JSON.stringify({
        prompt, query: prompt, input: prompt, message: prompt, question: prompt, text: prompt,
        stream: true,
        structured_query: query,
        metadata: { source: 'cammellopazzo-options-agent', summary: describeQuery(query) },
        ...(settings.model ? { model: settings.model } : {}),
      }),
    });
  }

  if (!res.ok) throw new Error(`Sistema multiagentico ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const type = headerOf(res, 'content-type');
  // Attenzione all'ordine: "application/x-ndjson" contiene "json" ma è uno stream.
  if (type.includes('event-stream') || type.includes('ndjson')) {
    return { text: await consume(res, send), mode: info.mode, prompt };
  }
  if (type.includes('json')) {
    const dati = await res.json();
    const testo = extractAnswer(dati) || JSON.stringify(dati, null, 2);
    send({ type: 'token', text: testo });
    return { text: testo, mode: info.mode, prompt };
  }
  return { text: await consume(res, send), mode: info.mode, prompt };
}

export async function status(settings, force = false) {
  const inizio = Date.now();
  const info = await detect(settings, force);
  return {
    url: settings.url || null,
    configuredMode: settings.mode || 'auto',
    mode: info.mode,
    path: info.path,
    ok: info.ok,
    detail: info.detail,
    latencyMs: Date.now() - inizio,
  };
}

/**
 * Cerca su quale porta risponde qualcosa, dato un host.
 *
 * Serve quando si conosce l'indirizzo Tailscale del mac ma non la porta del
 * sistema multiagentico. Una porta chiusa fa fallire la connessione subito;
 * una aperta risponde (anche con 404, e va benissimo: vuol dire che c'è).
 */
export async function scanPorts(hostTesto, { onProgress, porte = PORTE_COMUNI, timeout = 2500 } = {}) {
  const host = parseHost(hostTesto);
  if (!host) throw new Error('Indirizzo non valido');

  const daProvare = host.port ? [host.port, ...porte.filter((p) => p !== host.port)] : porte;
  const trovate = [];

  for (let i = 0; i < daProvare.length; i++) {
    const porta = daProvare[i];
    const base = `${host.protocol}//${host.hostname}:${porta}`;
    if (onProgress) onProgress({ porta, fatte: i, totali: daProvare.length, trovate: trovate.slice() });

    let risponde = false;
    try {
      // no-cors: basta sapere che la connessione riesce, non serve leggere il corpo.
      await fetch(base, { mode: 'no-cors', signal: AbortSignal.timeout(timeout) });
      risponde = true;
    } catch (err) {
      // Un rifiuto per CORS significa comunque che qualcuno ha risposto.
      risponde = err && err.name === 'TypeError' && !/failed to fetch|load failed|network/i.test(err.message || '');
    }

    if (risponde) {
      const info = await detect({ url: base, mode: 'auto', path: '', model: '', token: '' }, true);
      trovate.push({ porta, base, mode: info.mode, path: info.path, riconosciuto: info.ok, detail: info.detail });
    }
  }

  if (onProgress) onProgress({ fatte: daProvare.length, totali: daProvare.length, trovate: trovate.slice() });
  return trovate;
}
