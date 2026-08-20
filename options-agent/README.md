# Agente Opzioni 📈

Interfaccia web + agente che parlano con il **sistema multiagentico di opzioni** che gira sul mini.
Pensata per essere installata su **Umbrel** come app e usata dal telefono.

```
  telefono / browser
        │
        ▼
  ┌───────────────────────────────┐        ┌──────────────────────────────┐
  │  Agente Opzioni (Umbrel)      │        │  Sistema multiagentico       │
  │  • pianificatore NL → query   │ ─────► │  di opzioni (mini)           │
  │  • builder + anteprima JSON   │ ◄───── │  quant · risk · macro · …    │
  │  • storico e preset condivisi │  SSE   └──────────────────────────────┘
  └───────────────────────────────┘
```

## Cosa fa

1. **Pianifica**: scrivi in italiano ("analizza un iron condor su NVDA a 30 giorni, che succede se la
   volatilità scende del 10%?") e l'agente costruisce la query strutturata — sottostanti, strategia,
   gambe, orizzonte, scenari, metriche, vincoli, agenti da coinvolgere.
2. **Interroga**: invia la query al sistema sul mini e trasmette la risposta in streaming,
   evidenziando il contributo di ogni agente.
3. **Approfondisce** (opzionale): letta la risposta, decide se serve una seconda query mirata e la
   esegue — è l'interruttore *Approfondisci (2 passaggi)*.
4. **Ricorda**: storico e preset stanno sul server, quindi si ritrovano identici da telefono e da
   portatile.

Il **builder** permette di comporre la query campo per campo, con l'anteprima JSON e il prompt esatto
che verrà inviato.

## Installazione su Umbrel

### Community App Store (consigliato)

1. Su Umbrel: **App Store → ⋯ → Community App Stores**
2. Incolla `https://github.com/danieknamaste-lang/cammellopazzo` e aggiungi lo store
3. Installa **Agente Opzioni** dallo store *Cammellopazzo*

L'immagine viene pubblicata su `ghcr.io/danieknamaste-lang/cammellopazzo-options-agent` dal workflow
`.github/workflows/options-agent.yml` (amd64 + arm64).

### Docker a mano (SSH sul mini o su Umbrel)

```bash
git clone https://github.com/danieknamaste-lang/cammellopazzo.git
cd cammellopazzo/options-agent
MULTIAGENT_URL=http://10.0.0.12:8000 docker compose up -d --build
```

### Senza Docker

```bash
cd options-agent
MULTIAGENT_URL=http://10.0.0.12:8000 npm start   # richiede Node ≥ 20
```

Senza `MULTIAGENT_URL` l'app parte in **modalità simulazione**: la UI è completamente navigabile con
risposte finte, utile per provarla prima di collegare il mini.

## Collegare il sistema multiagentico

Dall'ingranaggio in alto a destra (o via variabili d'ambiente) imposti indirizzo e interfaccia.
Il connettore riconosce da solo il tipo di endpoint:

| Modalità | Come viene rilevata | Cosa invia |
| -------- | ------------------- | ---------- |
| `openai` | risponde a `GET /v1/models` | `POST /v1/chat/completions` con `stream: true` |
| `ollama` | risponde a `GET /api/tags` | `POST /api/chat` (NDJSON) |
| `json`   | `GET /openapi.json` espone `/query`, `/ask`, `/run`, `/invoke`… | `POST` con il prompt sotto più alias (`prompt`, `query`, `input`, `message`, `question`, `text`) **e** la query strutturata in `structured_query` |
| `sse`    | forzata a mano | come `json`, leggendo la risposta come stream SSE |
| `mock`   | nessun endpoint configurato | simulazione locale |

La risposta viene letta in streaming (SSE o NDJSON) oppure, se il sistema risponde in un colpo solo,
il testo viene cercato nei campi più comuni (`answer`, `output`, `result`, `response`, `final_answer`,
`content`, `text`, `message`…), anche annidati.

Se un frammento dello stream dichiara l'agente (`{"agent": "quant", "content": "…"}`), la UI lo
mostra come sezione separata con la sua etichetta.

## Configurazione

| Variabile | Default | Descrizione |
| --------- | ------- | ----------- |
| `PORT` | `3100` | porta del server |
| `MULTIAGENT_URL` | — | indirizzo del sistema sul mini (es. `http://10.0.0.12:8000`) |
| `MULTIAGENT_MODE` | `auto` | `auto`, `openai`, `json`, `sse`, `ollama`, `mock` |
| `MULTIAGENT_PATH` | *(rilevato)* | percorso da usare se l'autorilevamento sbaglia |
| `MULTIAGENT_MODEL` | — | nome del modello/agente da passare al sistema remoto |
| `MULTIAGENT_TOKEN` | — | bearer token del sistema remoto |
| `MULTIAGENT_TIMEOUT_MS` | `180000` | timeout di una singola query |
| `PLANNER` | `auto` | `auto`, `anthropic`, `deepseek`, `ollama`, `rules` |
| `ANTHROPIC_API_KEY` | — | pianificatore con Claude |
| `CLAUDE_MODEL` | `claude-sonnet-5` | modello Claude del pianificatore |
| `DEEPSEEK_API_KEY` | — | pianificatore con DeepSeek |
| `OLLAMA_URL` | `http://localhost:11434` | pianificatore con un modello locale |
| `AGENT_MAX_STEPS` | `2` | passaggi massimi dell'agente (pianifica → interroga → approfondisci) |
| `APP_TOKEN` | — | se impostato, le API richiedono l'header `x-app-token` |
| `DATA_DIR` | `./data` | storico, preset e impostazioni |

Il pianificatore è **opzionale**: senza nessun LLM configurato la query viene costruita
dall'estrattore a regole (ticker, DTE, strategia, scenari, vincoli), e il resto funziona uguale.

### Accesso dal telefono

Se esponi l'app fuori dalla LAN, imposta `APP_TOKEN`. Il token si inserisce dalle impostazioni oppure
si passa una volta sola nel link: `http://mini.local:3100/?token=…` — l'app lo salva e ripulisce l'URL.
La pagina è una PWA: da Chrome sul telefono, *Aggiungi a schermata Home*.

## API

| Endpoint | Descrizione |
| -------- | ----------- |
| `GET /api/config` | schema della query, configurazione pubblica, stato del collegamento |
| `GET /api/status?refresh=1` | riprova il rilevamento dell'endpoint remoto |
| `POST /api/plan` | `{ text }` → query strutturata + prompt che verrebbe inviato |
| `POST /api/preview` | `{ query }` → prompt e riassunto, senza inviare nulla |
| `POST /api/run` | `{ text \| query, refine }` → stream SSE: `status`, `query`, `agent`, `token`, `followup`, `done`, `error` |
| `GET /api/history` · `GET /api/history/:id` · `DELETE /api/history/:id` | storico |
| `GET/POST /api/presets` · `DELETE /api/presets/:id` | preset |
| `POST /api/settings` | endpoint, modalità, percorso, modello e token del sistema remoto |

## Test

```bash
cd options-agent && node test/smoke.js
```

Avvia un finto sistema multiagentico e verifica rilevamento, pianificazione, streaming, storico e
preset. Gira anche in CI a ogni push.

## Struttura

```
options-agent/
├── server.js            # server HTTP senza dipendenze + router + SSE
├── lib/
│   ├── config.js        # env + impostazioni salvate
│   ├── schema.js        # schema della query, prompt, riassunti
│   ├── rules.js         # estrattore deterministico NL → query
│   ├── planner.js       # agente: plan() e refine()
│   ├── llm.js           # provider del pianificatore (Claude/DeepSeek/Ollama)
│   ├── connector.js     # adattatori verso il sistema sul mini
│   └── store.js         # storico, preset, impostazioni su file
├── public/              # interfaccia (mobile first, PWA)
├── test/smoke.js        # test end-to-end senza dipendenze
└── Dockerfile
```
