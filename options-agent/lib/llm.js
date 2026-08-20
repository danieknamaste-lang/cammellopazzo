/**
 * Provider LLM usati dal pianificatore (non dal sistema multiagentico: quello
 * ha il suo connettore dedicato).
 *
 * Ordine automatico: Claude → DeepSeek → Ollama sul mini → nessuno (solo regole).
 */

'use strict';

const { current } = require('./config');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

let ollamaCache = { at: 0, model: null };

async function ollamaModel() {
  const now = Date.now();
  if (now - ollamaCache.at < 60000) return ollamaCache.model;
  let model = null;
  try {
    const res = await fetch(`${current.planner.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name).filter(Boolean);
      model = current.planner.ollamaModel || models[0] || null;
      if (current.planner.ollamaModel && models.length && !models.includes(current.planner.ollamaModel)) {
        model = current.planner.ollamaModel; // fidiamoci della configurazione esplicita
      }
    }
  } catch {
    model = null;
  }
  ollamaCache = { at: now, model };
  return model;
}

/** Provider effettivamente utilizzabile adesso, o null. */
async function resolveProvider() {
  const mode = current.planner.mode || 'auto';
  const wanted = mode === 'auto' ? ['anthropic', 'deepseek', 'ollama'] : [mode];

  for (const name of wanted) {
    if (name === 'anthropic' && current.planner.anthropicKey) {
      return { name, model: current.planner.anthropicModel };
    }
    if (name === 'deepseek' && current.planner.deepseekKey) {
      return { name, model: current.planner.deepseekModel };
    }
    if (name === 'ollama') {
      const model = await ollamaModel();
      if (model) return { name, model };
    }
    if (name === 'rules' || name === 'none') return null;
  }
  return null;
}

async function callAnthropic(provider, { system, prompt, maxTokens }) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': current.planner.anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens || 1500,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function callDeepseek(provider, { system, prompt, maxTokens }) {
  const res = await fetch(current.planner.deepseekUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${current.planner.deepseekKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens || 1500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOllama(provider, { system, prompt, json }) {
  const res = await fetch(`${current.planner.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      format: json ? 'json' : undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.message?.content || '';
}

/** Una singola risposta testuale dal provider disponibile. Null se non ce n'è. */
async function complete({ system, prompt, json = false, maxTokens = 1500 }) {
  const provider = await resolveProvider();
  if (!provider) return null;

  let text;
  if (provider.name === 'anthropic') text = await callAnthropic(provider, { system, prompt, maxTokens });
  else if (provider.name === 'deepseek') text = await callDeepseek(provider, { system, prompt, maxTokens });
  else if (provider.name === 'ollama') text = await callOllama(provider, { system, prompt, json });
  else return null;

  return { provider: provider.name, model: provider.model, text: text || '' };
}

/** Estrae il primo oggetto JSON da una risposta, anche se avvolto in ``` o testo. */
function parseJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = { complete, parseJson, resolveProvider };
