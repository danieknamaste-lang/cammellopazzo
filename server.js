/**
 * EllenChat locale — server Node.js
 *
 * Backend a cinque livelli, scelto automaticamente all'avvio:
 *   1. Kimi (agente) → se è impostata KIMI_API_KEY: agente con deep search web
 *                      e memoria locale persistente (vedi agent.js e memory.js)
 *   2. DeepSeek API  → se è impostata DEEPSEEK_API_KEY
 *   3. Claude API    → se è impostata ANTHROPIC_API_KEY
 *   4. Ollama        → se un server Ollama risponde su OLLAMA_URL (default http://localhost:11434)
 *   5. Demo          → nessuna configurazione: risposte simulate, utile per provare la UI
 *
 * Variabili d'ambiente:
 *   PORT              porta del server (default 3000)
 *   KIMI_API_KEY      chiave API Kimi/Moonshot (opzionale; attiva l'agente)
 *   KIMI_MODEL        modello Kimi (default kimi-latest)
 *   DEEPSEEK_API_KEY  chiave API DeepSeek (opzionale)
 *   DEEPSEEK_MODEL    modello DeepSeek (default deepseek-chat)
 *   ANTHROPIC_API_KEY chiave API Anthropic (opzionale)
 *   CLAUDE_MODEL      modello Claude (default claude-opus-4-8)
 *   OLLAMA_URL        endpoint Ollama (default http://localhost:11434)
 *   OLLAMA_MODEL      modello Ollama (default: il primo disponibile)
 *   ASSISTANT_NAME    nome dell'assistente mostrato in UI (default "Ellen")
 *   SYSTEM_PROMPT     prompt di sistema personalizzato
 */

const express = require('express');
const path = require('path');
const agent = require('./agent');
const memory = require('./memory');

const PORT = process.env.PORT || 3000;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Ellen';

const DEFAULT_SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `Sei ${ASSISTANT_NAME}, un'assistente virtuale ispirata agli scritti di Ellen G. White, ` +
  `autrice cristiana e cofondatrice della Chiesa Avventista del Settimo Giorno. ` +
  `Conosci a fondo le sue opere principali (La via migliore, Il gran conflitto, ` +
  `La speranza dell'uomo, Patriarchi e profeti, Ministero della guarigione), la Bibbia ` +
  `e i principi avventisti su fede, sabato, salute ed educazione. ` +
  `Rispondi con calore, empatia e incoraggiamento. Quando è utile, cita le opere di ` +
  `Ellen White o passi biblici indicando la fonte, e distingui sempre le citazioni ` +
  `dalle tue interpretazioni. Rispondi nella lingua dell'utente (di solito italiano) ` +
  `e usa il markdown quando aiuta la leggibilità.`;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Selezione del backend
// ---------------------------------------------------------------------------

let backend = { type: 'demo', model: 'demo' };

async function detectBackend() {
  if (agent.apiKey()) {
    backend = { type: 'kimi', model: agent.model };
    return;
  }
  if (process.env.DEEPSEEK_API_KEY) {
    backend = { type: 'deepseek', model: DEEPSEEK_MODEL };
    return;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    backend = { type: 'anthropic', model: CLAUDE_MODEL };
    return;
  }
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name);
      const model = process.env.OLLAMA_MODEL || models[0];
      if (model) {
        backend = { type: 'ollama', model };
        return;
      }
    }
  } catch {
    // Ollama non raggiungibile: si passa alla modalità demo
  }
  backend = { type: 'demo', model: 'demo' };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get('/api/status', (req, res) => {
  res.json({
    assistantName: ASSISTANT_NAME,
    backend: backend.type,
    model: backend.model,
  });
});

// POST /api/chat  { messages: [{role: 'user'|'assistant', content: string}] }
// Risposta: stream SSE con eventi {type:'delta',text}, {type:'done'}, {type:'error',message}
app.post('/api/chat', async (req, res) => {
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  if (messages.length === 0) {
    return res.status(400).json({ error: 'messages mancante o vuoto' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    if (backend.type === 'kimi') {
      await agent.run(messages, send, DEFAULT_SYSTEM_PROMPT);
    } else if (backend.type === 'deepseek') {
      await streamDeepSeek(messages, send);
    } else if (backend.type === 'anthropic') {
      await streamAnthropic(messages, send);
    } else if (backend.type === 'ollama') {
      await streamOllama(messages, send, req);
    } else {
      await streamDemo(messages, send);
    }
    send({ type: 'done' });
  } catch (err) {
    send({ type: 'error', message: String(err.message || err) });
  }
  res.end();
});

// Memoria locale dell'agente: consultazione e gestione dalla UI
app.get('/api/memory', (req, res) => {
  res.json({ entries: memory.list() });
});

app.delete('/api/memory/:id', (req, res) => {
  res.json({ removed: memory.remove(req.params.id) });
});

app.delete('/api/memory', (req, res) => {
  memory.clear();
  res.json({ removed: true });
});

// ---------------------------------------------------------------------------
// Backend: DeepSeek API (OpenAI-compatibile, streaming SSE)
// ---------------------------------------------------------------------------

async function streamDeepSeek(messages, send) {
  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      stream: true,
      messages: [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }, ...messages],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DeepSeek ha risposto ${res.status}: ${body.slice(0, 200)}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      const data = JSON.parse(payload);
      const delta = data.choices && data.choices[0] && data.choices[0].delta;
      if (delta && delta.content) {
        send({ type: 'delta', text: delta.content });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Backend: Claude API (streaming con SDK ufficiale)
// ---------------------------------------------------------------------------

async function streamAnthropic(messages, send) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: DEFAULT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      send({ type: 'delta', text: event.delta.text });
    }
  }
  await stream.finalMessage();
}

// ---------------------------------------------------------------------------
// Backend: Ollama (modelli locali gratuiti)
// ---------------------------------------------------------------------------

async function streamOllama(messages, send, req) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: backend.model,
      stream: true,
      messages: [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ha risposto ${res.status}`);

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const data = JSON.parse(line);
      if (data.message && data.message.content) {
        send({ type: 'delta', text: data.message.content });
      }
      if (data.done) return;
    }
  }
}

// ---------------------------------------------------------------------------
// Backend: demo (nessuna configurazione richiesta)
// ---------------------------------------------------------------------------

async function streamDemo(messages, send) {
  const last = messages[messages.length - 1];
  const reply =
    `Ciao! Sono **${ASSISTANT_NAME}** in *modalità demo* — al momento non è configurato ` +
    `nessun modello AI, quindi non posso rispondere davvero alla tua domanda:\n\n` +
    `> ${String(last.content).slice(0, 200)}\n\n` +
    `Per attivare le risposte vere hai quattro opzioni:\n\n` +
    `1. **Kimi (agente con deep search e memoria)** — avvia il server con la tua chiave:\n` +
    `   \`\`\`bash\n   KIMI_API_KEY=sk-... npm start\n   \`\`\`\n` +
    `2. **DeepSeek API** — avvia il server con la tua chiave:\n` +
    `   \`\`\`bash\n   DEEPSEEK_API_KEY=sk-... npm start\n   \`\`\`\n` +
    `3. **Claude API** — avvia il server con la tua chiave:\n` +
    `   \`\`\`bash\n   ANTHROPIC_API_KEY=sk-ant-... npm start\n   \`\`\`\n` +
    `4. **Ollama** (gratuito, 100% locale) — installa [Ollama](https://ollama.com), poi:\n` +
    `   \`\`\`bash\n   ollama pull llama3.2\n   npm start\n   \`\`\`\n\n` +
    `L'interfaccia che stai usando (streaming, cronologia, conversazioni multiple) ` +
    `funziona già esattamente come farà con un modello vero. 🚀`;

  // Simula lo streaming parola per parola
  for (const word of reply.split(/(?<=\s)/)) {
    send({ type: 'delta', text: word });
    await new Promise((r) => setTimeout(r, 12));
  }
}

// ---------------------------------------------------------------------------

detectBackend().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ EllenChat locale avviata su http://localhost:${PORT}`);
    console.log(`   Backend: ${backend.type} (modello: ${backend.model})`);
    if (backend.type === 'demo') {
      console.log('   Suggerimento: imposta KIMI_API_KEY (o DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, o avvia Ollama) per risposte vere.');
    }
    if (backend.type === 'kimi') {
      console.log(`   Agente attivo: deep search web + memoria locale (${memory.list().length} ricordi)`);
    }
  });
});
