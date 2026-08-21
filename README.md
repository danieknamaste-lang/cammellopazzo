# Cammellopazzo

Due app che girano in casa:

| App | Cartella | Cosa fa |
| --- | -------- | ------- |
| **EllenChat** | `.` (radice) | chat AI locale con streaming, cronologia e persona configurabile |
| **[Agente Opzioni](options-agent/README.md)** | `options-agent/` | interfaccia + agente per il sistema multiagentico di opzioni che gira sul mini, installabile su **Umbrel** |

---

# EllenChat — chat AI locale 💬

Una chat AI in stile [ellenchat.evangefy.com](https://ellenchat.evangefy.com/) che gira **interamente in locale**: interfaccia web moderna con streaming delle risposte, cronologia delle conversazioni e persona configurabile.

## Caratteristiche

- 💬 Interfaccia in stile ChatGPT: sidebar con conversazioni multiple, bolle messaggi, suggerimenti iniziali
- ⚡ **Streaming** delle risposte in tempo reale (SSE)
- 🗂 Cronologia salvata nel browser (localStorage) — nessun database necessario
- 🎭 Persona configurabile (nome e prompt di sistema via variabili d'ambiente)
- 🔍 **Agente di ricerca web con Kimi**: il modello cerca sul web da solo quando serve
- 🔌 **Cinque backend, scelti automaticamente:**
  1. **Kimi API** (Moonshot AI) — se imposti `KIMI_API_KEY`, con ricerca web integrata
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

### Con Kimi API (agente di ricerca web 🔍)

```bash
KIMI_API_KEY=sk-... npm start
```

La chiave si ottiene su [platform.moonshot.ai](https://platform.moonshot.ai). Kimi usa la funzione integrata `$web_search`: quando la domanda richiede informazioni aggiornate (notizie, prezzi, eventi recenti…), il modello decide da solo di cercare sul web, la ricerca viene eseguita dai server Moonshot e la risposta finale arriva in streaming con le fonti. Durante la ricerca la UI mostra "🔍 Sto cercando sul web…".

- Modello: `KIMI_MODEL` (default `kimi-latest`; puoi usare ad es. `kimi-k2-0711-preview`)
- Dalla Cina: `KIMI_API_URL=https://api.moonshot.cn/v1/chat/completions`
- Per disattivare la ricerca web: `KIMI_SEARCH=off`

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
| `KIMI_API_KEY`      | —                        | Chiave API Moonshot/Kimi (opzionale) |
| `KIMI_MODEL`        | `kimi-latest`            | Modello Kimi da usare                |
| `KIMI_API_URL`      | `https://api.moonshot.ai/v1/chat/completions` | Endpoint Kimi (`.cn` per la Cina) |
| `KIMI_SEARCH`       | *(attiva)*               | `off` per disattivare la ricerca web |
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
├── server.js          # Server Express: API /api/chat (streaming SSE) + /api/status
├── public/
│   ├── index.html     # Struttura della pagina
│   ├── style.css      # Stile (sidebar scura, bolle, animazioni)
│   └── app.js         # Logica UI: conversazioni, streaming, mini-renderer Markdown
├── package.json
├── options-agent/     # Seconda app: Agente Opzioni (vedi options-agent/README.md)
├── cammellopazzo-options-agent/   # Manifest dell'app Umbrel
└── umbrel-app-store.yml           # Community app store da aggiungere su Umbrel
```

## Come funziona lo streaming

1. Il frontend invia la cronologia dei messaggi a `POST /api/chat`
2. Il server apre uno stream verso il modello (Claude o Ollama)
3. Ogni frammento di testo viene inoltrato al browser come evento SSE
4. La UI aggiorna la bolla del messaggio in tempo reale, con rendering Markdown

---

## Agente Opzioni (app Umbrel)

Interfaccia web e agente che trasformano una domanda in italiano in una query strutturata per il
sistema multiagentico di opzioni che gira sul mini, la inviano e riportano la risposta in streaming.

```bash
cd options-agent
MULTIAGENT_URL=http://10.0.0.12:8000 npm start      # oppure: docker compose up -d --build
```

Su Umbrel: **App Store → ⋯ → Community App Stores →**
`https://github.com/danieknamaste-lang/cammellopazzo` → installa *Agente Opzioni*.

Documentazione completa: [options-agent/README.md](options-agent/README.md).
