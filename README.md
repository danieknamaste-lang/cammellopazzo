# EllenChat — chat AI locale 💬

Una chat AI in stile [ellenchat.evangefy.com](https://ellenchat.evangefy.com/) che gira **interamente in locale**: interfaccia web moderna con streaming delle risposte, cronologia delle conversazioni e persona configurabile.

## Caratteristiche

- 💬 Interfaccia in stile ChatGPT: sidebar con conversazioni multiple, bolle messaggi, suggerimenti iniziali
- ⚡ **Streaming** delle risposte in tempo reale (SSE)
- 🗂 Cronologia salvata nel browser (localStorage) — nessun database necessario
- 🎭 Persona configurabile (nome e prompt di sistema via variabili d'ambiente)
- 🔌 **Tre backend, scelti automaticamente:**
  1. **Claude API** (Anthropic) — se imposti `ANTHROPIC_API_KEY`
  2. **Ollama** — modelli gratuiti 100% locali, se Ollama è in esecuzione
  3. **Demo** — nessuna configurazione: la UI funziona con risposte simulate
- 📱 Layout responsive (desktop e mobile)

## Avvio rapido

```bash
npm install
npm start
```

Poi apri **http://localhost:3000** nel browser. Senza configurazione parte in modalità demo.

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
└── package.json
```

## Come funziona lo streaming

1. Il frontend invia la cronologia dei messaggi a `POST /api/chat`
2. Il server apre uno stream verso il modello (Claude o Ollama)
3. Ogni frammento di testo viene inoltrato al browser come evento SSE
4. La UI aggiorna la bolla del messaggio in tempo reale, con rendering Markdown
