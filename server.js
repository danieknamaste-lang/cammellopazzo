/**
 * EllenChat locale — server Node.js
 *
 * Backend a tre livelli, scelto automaticamente all'avvio:
 *   1. Claude API   → se è impostata ANTHROPIC_API_KEY
 *   2. Ollama       → se un server Ollama risponde su OLLAMA_URL (default http://localhost:11434)
 *   3. Demo         → nessuna configurazione: risposte simulate, utile per provare la UI
 *
 * Variabili d'ambiente:
 *   PORT              porta del server (default 3000)
 *   ANTHROPIC_API_KEY chiave API Anthropic (opzionale)
 *   CLAUDE_MODEL      modello Claude (default claude-opus-4-8)
 *   OLLAMA_URL        endpoint Ollama (default http://localhost:11434)
 *   OLLAMA_MODEL      modello Ollama (default: il primo disponibile)
 *   ASSISTANT_NAME    nome dell'assistente mostrato in UI (default "Ellen")
 *   SYSTEM_PROMPT     prompt di sistema personalizzato
 */

const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Ellen';

const DEFAULT_SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `Sei ${ASSISTANT_NAME}, un'assistente virtuale calorosa, empatica e preparata. ` +
  `Rispondi nella lingua dell'utente (di solito italiano), in modo chiaro e conciso. ` +
  `Usa il markdown quando aiuta la leggibilità (elenchi, grassetto, blocchi di codice).`;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Selezione del backend
// ---------------------------------------------------------------------------

let backend = { type: 'demo', model: 'demo' };

async function detectBackend() {
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
    if (backend.type === 'anthropic') {
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
    `Per attivare le risposte vere hai due opzioni:\n\n` +
    `1. **Claude API** — avvia il server con la tua chiave:\n` +
    `   \`\`\`bash\n   ANTHROPIC_API_KEY=sk-ant-... npm start\n   \`\`\`\n` +
    `2. **Ollama** (gratuito, 100% locale) — installa [Ollama](https://ollama.com), poi:\n` +
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
      console.log('   Suggerimento: imposta ANTHROPIC_API_KEY o avvia Ollama per risposte vere.');
    }
  });
});
