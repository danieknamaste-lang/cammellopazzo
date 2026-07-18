/**
 * Agente Kimi con deep search e memoria locale.
 *
 * Usa l'API di Moonshot AI (Kimi, OpenAI-compatibile) con:
 *   - $web_search: ricerca web nativa di Kimi (builtin_function) — la ricerca
 *     viene eseguita lato Moonshot; al modello basta rimandare gli argomenti
 *     della tool call come risultato.
 *   - save_memory / forget_memory: strumenti locali che leggono e scrivono
 *     la memoria persistente su file (vedi memory.js).
 *
 * Il loop agentico consente più passaggi di ricerca consecutivi ("deep
 * search"): il modello può cercare, leggere i risultati, raffinare la query
 * e cercare di nuovo prima di rispondere, fino a KIMI_MAX_STEPS passaggi.
 *
 * Variabili d'ambiente:
 *   KIMI_API_KEY    chiave API Moonshot/Kimi (in alternativa MOONSHOT_API_KEY)
 *   KIMI_MODEL      modello Kimi (default kimi-latest)
 *   KIMI_API_URL    endpoint (default https://api.moonshot.ai/v1/chat/completions)
 *   KIMI_MAX_STEPS  massimo numero di passaggi del loop agentico (default 12)
 */

const memory = require('./memory');

const KIMI_API_URL = process.env.KIMI_API_URL || 'https://api.moonshot.ai/v1/chat/completions';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-latest';
const MAX_STEPS = Number(process.env.KIMI_MAX_STEPS || 12);

function apiKey() {
  return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
}

const TOOLS = [
  // Ricerca web nativa di Kimi: eseguita sui server Moonshot
  { type: 'builtin_function', function: { name: '$web_search' } },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        "Salva un fatto nella memoria locale persistente, così te ne ricorderai nelle prossime conversazioni. " +
        "Usalo quando l'utente condivide informazioni durevoli su di sé (nome, preferenze, contesto) " +
        "o ti chiede esplicitamente di ricordare qualcosa. Salva fatti brevi e autonomi, uno per chiamata.",
      parameters: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description: "Il fatto da ricordare, in una frase breve (es. \"L'utente si chiama Daniele\").",
          },
        },
        required: ['fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget_memory',
      description:
        "Elimina un ricordo dalla memoria locale. Usalo quando un'informazione memorizzata non è più valida " +
        "o l'utente chiede di dimenticarla. L'id è quello mostrato tra parentesi quadre nella sezione Memoria locale.",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id del ricordo da eliminare.' },
        },
        required: ['id'],
      },
    },
  },
];

const TOOL_LABELS = {
  $web_search: '🔎 Ricerca sul web…',
  save_memory: '🧠 Salvo un ricordo…',
  forget_memory: '🗑️ Aggiorno la memoria…',
};

const AGENT_INSTRUCTIONS =
  `\n\n## Strumenti\n` +
  `Hai a disposizione la ricerca web ($web_search) e una memoria locale persistente (save_memory, forget_memory).\n` +
  `- Per domande su fatti recenti, notizie, dati verificabili o qualsiasi cosa di cui non sei certo, ` +
  `usa la ricerca web. Per le domande complesse fai una ricerca approfondita: più ricerche successive ` +
  `con query diverse, confrontando le fonti prima di rispondere. Cita le fonti con i link.\n` +
  `- Quando l'utente condivide informazioni durevoli su di sé o chiede di ricordare qualcosa, salvala ` +
  `in memoria con save_memory. Non salvare dati sensibili non richiesti.`;

// ---------------------------------------------------------------------------
// Loop agentico
// ---------------------------------------------------------------------------

/**
 * Esegue l'agente: streamma i delta di testo via send() e gestisce le tool
 * call in loop finché il modello non produce la risposta finale.
 * send() riceve eventi {type:'delta',text} e {type:'tool',name,label}.
 */
async function run(userMessages, send, systemPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt + AGENT_INSTRUCTIONS + memory.asPromptText() },
    ...userMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const { toolCalls, content } = await streamCompletion(messages, send);
    if (toolCalls.length === 0) return; // risposta finale già streammata

    messages.push({ role: 'assistant', content: content || '', tool_calls: toolCalls });
    for (const tc of toolCalls) {
      send({ type: 'tool', name: tc.function.name, label: TOOL_LABELS[tc.function.name] || `⚙️ ${tc.function.name}…` });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: executeTool(tc),
      });
    }
  }
  send({ type: 'delta', text: '\n\n*(Ho raggiunto il limite di passaggi di ricerca per questa risposta.)*' });
}

function executeTool(tc) {
  const name = tc.function.name;
  const args = tc.function.arguments || '{}';

  // La ricerca web di Kimi è eseguita lato Moonshot: il risultato da
  // restituire è semplicemente l'oggetto arguments della tool call.
  if (name === '$web_search') return args;

  let parsed;
  try {
    parsed = JSON.parse(args);
  } catch {
    return JSON.stringify({ error: 'argomenti non validi' });
  }

  if (name === 'save_memory') {
    const entry = memory.add(parsed.fact);
    return JSON.stringify(entry ? { saved: true, id: entry.id } : { saved: false, error: 'fatto vuoto' });
  }
  if (name === 'forget_memory') {
    return JSON.stringify({ removed: memory.remove(parsed.id) });
  }
  return JSON.stringify({ error: `strumento sconosciuto: ${name}` });
}

// ---------------------------------------------------------------------------
// Singola chiamata streaming (OpenAI-compatibile) con raccolta delle tool call
// ---------------------------------------------------------------------------

async function streamCompletion(messages, send) {
  const res = await fetch(KIMI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      stream: true,
      temperature: 0.6,
      messages,
      tools: TOOLS,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Kimi ha risposto ${res.status}: ${body.slice(0, 200)}`);
  }

  let content = '';
  const toolCalls = []; // accumulate per indice dai delta

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
      const delta = choice.delta || {};

      if (delta.content) {
        content += delta.content;
        send({ type: 'delta', text: delta.content });
      }
      for (const d of delta.tool_calls || []) {
        const i = d.index || 0;
        if (!toolCalls[i]) {
          toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (d.id) toolCalls[i].id = d.id;
        if (d.type) toolCalls[i].type = d.type;
        if (d.function) {
          if (d.function.name) toolCalls[i].function.name += d.function.name;
          if (d.function.arguments) toolCalls[i].function.arguments += d.function.arguments;
        }
      }
    }
  }

  return { content, toolCalls: toolCalls.filter(Boolean) };
}

module.exports = { run, model: KIMI_MODEL, apiKey };
