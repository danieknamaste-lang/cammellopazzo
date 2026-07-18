/**
 * EllenChat locale — server Node.js
 *
 * Backend a cinque livelli, scelto automaticamente all'avvio:
 *   1. Kimi API     → se è impostata KIMI_API_KEY (agente di ricerca web integrato)
 *   2. DeepSeek API → se è impostata DEEPSEEK_API_KEY
 *   3. Claude API   → se è impostata ANTHROPIC_API_KEY
 *   4. Ollama       → se un server Ollama risponde su OLLAMA_URL (default http://localhost:11434)
 *   5. Demo         → nessuna configurazione: risposte simulate, utile per provare la UI
 *
 * Variabili d'ambiente:
 *   PORT              porta del server (default 3000)
 *   KIMI_API_KEY      chiave API Moonshot/Kimi (opzionale; accetta anche MOONSHOT_API_KEY)
 *   KIMI_MODEL        modello Kimi (default kimi-latest)
 *   KIMI_API_URL      endpoint Kimi (default https://api.moonshot.ai/v1/chat/completions;
 *                     per la Cina usare https://api.moonshot.cn/v1/chat/completions)
 *   KIMI_SEARCH       "off" per disattivare l'agente di ricerca web (default: attivo)
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

const PORT = process.env.PORT || 3000;
const KIMI_API_KEY = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-latest';
const KIMI_API_URL = process.env.KIMI_API_URL || 'https://api.moonshot.ai/v1/chat/completions';
const KIMI_SEARCH = process.env.KIMI_SEARCH !== 'off';
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
  if (KIMI_API_KEY) {
    backend = { type: 'kimi', model: KIMI_MODEL, search: KIMI_SEARCH };
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
    search: Boolean(backend.search),
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
      await streamKimi(messages, send);
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

// ---------------------------------------------------------------------------
// Backend: Kimi / Moonshot AI (agente di ricerca web con $web_search)
//
// Kimi espone la funzione integrata "$web_search": quando il modello decide
// di cercare sul web restituisce una tool call, il client rimanda gli
// argomenti così come sono e la ricerca viene eseguita lato Moonshot.
// Il ciclo continua finché il modello non produce la risposta finale,
// che viene trasmessa in streaming al browser.
// ---------------------------------------------------------------------------

const KIMI_MAX_SEARCH_ROUNDS = 6;

async function streamKimi(messages, send) {
  const convo = [
    { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const tools = KIMI_SEARCH
    ? [{ type: 'builtin_function', function: { name: '$web_search' } }]
    : undefined;

  for (let round = 0; round <= KIMI_MAX_SEARCH_ROUNDS; round++) {
    const res = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KIMI_API_KEY}`,
      },
      body: JSON.stringify({
        model: KIMI_MODEL,
        stream: true,
        temperature: 0.6,
        messages: convo,
        ...(tools ? { tools } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Kimi ha risposto ${res.status}: ${body.slice(0, 200)}`);
    }

    // Legge lo stream SSE: inoltra il testo e accumula le eventuali tool call
    let content = '';
    let finishReason = null;
    const toolCalls = []; // indicizzate per delta.tool_calls[].index

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
        if (payload === '[DONE]') continue;
        const data = JSON.parse(payload);
        const choice = data.choices && data.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (delta.content) {
          content += delta.content;
          send({ type: 'delta', text: delta.content });
        }
        for (const tc of delta.tool_calls || []) {
          const slot = (toolCalls[tc.index] ||= {
            id: '',
            type: 'builtin_function',
            function: { name: '', arguments: '' },
          });
          if (tc.id) slot.id = tc.id;
          if (tc.type) slot.type = tc.type;
          if (tc.function && tc.function.name) slot.function.name = tc.function.name;
          if (tc.function && tc.function.arguments) slot.function.arguments += tc.function.arguments;
        }
      }
    }

    if (finishReason !== 'tool_calls' || toolCalls.length === 0) return;

    // Il modello vuole usare uno strumento: esegue e riparte con un nuovo round
    convo.push({ role: 'assistant', content, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      let result;
      if (tc.function.name === '$web_search') {
        send({ type: 'status', text: '🔍 Sto cercando sul web…' });
        // Per la funzione integrata la ricerca avviene lato Moonshot:
        // il risultato da rimandare è la copia esatta degli argomenti.
        result = tc.function.arguments;
      } else {
        result = JSON.stringify({ error: `strumento "${tc.function.name}" non disponibile` });
      }
      convo.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result,
      });
    }
  }

  throw new Error(`Kimi ha superato il limite di ${KIMI_MAX_SEARCH_ROUNDS} ricerche consecutive`);
}

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
    `1. **Kimi API** (con 🔍 ricerca web integrata) — avvia il server con la tua chiave:\n` +
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
    if (backend.type === 'kimi') {
      console.log(`   Ricerca web: ${KIMI_SEARCH ? 'attiva ($web_search)' : 'disattivata (KIMI_SEARCH=off)'}`);
    }
    if (backend.type === 'demo') {
      console.log('   Suggerimento: imposta KIMI_API_KEY (o DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, o avvia Ollama) per risposte vere.');
    }
  });
});
