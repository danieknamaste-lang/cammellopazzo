# EllenChat — chat AI locale 💬

Una chat AI in stile [ellenchat.evangefy.com](https://ellenchat.evangefy.com/) che gira **interamente in locale**: interfaccia web moderna con streaming delle risposte, cronologia delle conversazioni e persona configurabile.

## Caratteristiche

- 💬 Interfaccia in stile ChatGPT: sidebar con conversazioni multiple, bolle messaggi, suggerimenti iniziali
- ⚡ **Streaming** delle risposte in tempo reale (SSE)
- 🗂 Cronologia salvata nel browser (localStorage) — nessun database necessario
- 🎭 Persona configurabile (nome e prompt di sistema via variabili d'ambiente)
- 🤖 **Agente Kimi** con **deep search** (ricerca web nativa `$web_search` di Moonshot, in loop: più ricerche successive con query raffinate prima di rispondere) e **memoria locale persistente** su file
- 🧠 Memoria gestibile dalla UI (pulsante "🧠 Memoria" in sidebar) o via API (`/api/memory`)
- 🔌 **Cinque backend, scelti automaticamente:**
  1. **Kimi / Moonshot** (agente) — se imposti `KIMI_API_KEY`
  2. **DeepSeek API** — se imposti `DEEPSEEK_API_KEY`
  3. **Claude API** (Anthropic) — se imposti `ANTHROPIC_API_KEY`
  4. **Ollama** — modelli gratuiti 100% locali, se Ollama è in esecuzione
  5. **Demo** — nessuna configurazione: la UI funziona con risposte simulate
- 📱 Layout responsive (desktop e mobile)

## Avvio rapido

```bash
npm install
npm start
```

Poi apri **http://localhost:3000** nel browser. Senza configurazione parte in modalità demo.

### Con Kimi — agente con deep search e memoria (consigliato)

```bash
KIMI_API_KEY=sk-... npm start
```

In alternativa crea un file `.env` nella cartella del progetto (è gitignorato, la chiave non finisce nel repository):

```bash
echo "KIMI_API_KEY=sk-..." > .env
npm start
```

La chiave si ottiene su [platform.moonshot.ai](https://platform.moonshot.ai). Con Kimi attivo la chat diventa un **agente**:

- 🔎 **Deep search**: per le domande su fatti recenti o complesse l'agente cerca sul web (ricerca nativa Moonshot, eseguita lato server), legge i risultati, raffina la query e cerca di nuovo — fino a `KIMI_MAX_STEPS` passaggi — citando le fonti.
- 🧠 **Memoria locale**: quando condividi informazioni durevoli ("mi chiamo…", "ricordati che…") l'agente le salva in `data/memory.json` e le ritrova nelle conversazioni successive. Vedi e cancelli i ricordi dal pulsante **🧠 Memoria** nella sidebar.

### Con Claude API (qualità massima)

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

### Con Ollama (gratuito, 100% locale)

1. Installa [Ollama](https://ollama.com)
2. Scarica un modello: `ollama pull llama3.2`
3. Avvia l'app: `npm start` (rileva Ollama automaticamente)

## Configurazione

| Variabile           | Default                  | Descrizione                          |
| ------------------- | ------------------------ | ------------------------------------ |
| `PORT`              | `3000`                   | Porta del server                     |
| `KIMI_API_KEY`      | —                        | Chiave API Kimi/Moonshot (attiva l'agente) |
| `KIMI_MODEL`        | `kimi-latest`            | Modello Kimi da usare                |
| `KIMI_MAX_STEPS`    | `12`                     | Passaggi massimi del loop agentico   |
| `MEMORY_DIR`        | `./data`                 | Cartella della memoria locale        |
| `DEEPSEEK_API_KEY`  | —                        | Chiave API DeepSeek (opzionale)      |
| `DEEPSEEK_MODEL`    | `deepseek-chat`          | Modello DeepSeek da usare            |
| `ANTHROPIC_API_KEY` | —                        | Chiave API Anthropic (opzionale)     |
| `CLAUDE_MODEL`      | `claude-opus-4-8`        | Modello Claude da usare              |
| `OLLAMA_URL`        | `http://localhost:11434` | Endpoint del server Ollama           |
| `OLLAMA_MODEL`      | *(primo disponibile)*    | Modello Ollama da usare              |
| `ASSISTANT_NAME`    | `Ellen`                  | Nome dell'assistente mostrato in UI  |
| `SYSTEM_PROMPT`     | *(persona di Ellen)*     | Prompt di sistema personalizzato     |

Esempio con persona personalizzata:

```bash
ASSISTANT_NAME=Sofia SYSTEM_PROMPT="Sei Sofia, un'esperta di cucina italiana..." npm start
```

## Struttura del progetto

```
├── server.js          # Server Express: API /api/chat (streaming SSE), /api/status, /api/memory
├── agent.js           # Agente Kimi: loop con deep search web + strumenti di memoria
├── memory.js          # Memoria locale persistente (data/memory.json)
├── public/
│   ├── index.html     # Struttura della pagina
│   ├── style.css      # Stile (sidebar scura, bolle, animazioni)
│   └── app.js         # Logica UI: conversazioni, streaming, mini-renderer Markdown
└── package.json
```

## Come funziona l'agente Kimi

1. Il prompt di sistema include la persona, le istruzioni degli strumenti e la **memoria locale** (i fatti salvati in `data/memory.json`)
2. Il modello può chiamare gli strumenti: `$web_search` (ricerca web nativa Moonshot), `save_memory`, `forget_memory`
3. Il server esegue lo strumento e rimanda il risultato al modello, in loop, finché non arriva la risposta finale — la UI mostra intanto lo stato ("🔎 Ricerca sul web…", "🧠 Salvo un ricordo…")
4. La memoria si consulta e si cancella da **🧠 Memoria** in sidebar, oppure via `GET /api/memory`, `DELETE /api/memory/:id`, `DELETE /api/memory`

## Come funziona lo streaming

1. Il frontend invia la cronologia dei messaggi a `POST /api/chat`
2. Il server apre uno stream verso il modello (Claude o Ollama)
3. Ogni frammento di testo viene inoltrato al browser come evento SSE
4. La UI aggiorna la bolla del messaggio in tempo reale, con rendering Markdown
