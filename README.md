# DeepSeek Bridge per Codex CLI su Android

Bridge che permette a Codex CLI di usare **DeepSeek Chat API** (cloud) invece dei modelli locali, su Android (Termux/proot).

## Architettura

```
Codex CLI (--oss ollama)  ──▶  Proxy (porta 11434)  ──▶  api.deepseek.com
                                     ↑
                               Traduce chiamate
                               Ollama → OpenAI format
```

Codex non supporta nativamente API esterne, ma accetta provider locali via `--oss --local-provider ollama`. Il proxy intercetta le chiamate all'API di Ollama e le traduce per DeepSeek.

Il proxy espone tre superfici API sulla porta 11434, così funziona sia con le versioni vecchie che nuove di Codex CLI:

| Endpoint | Chi lo usa |
|----------|-----------|
| `/api/chat`, `/api/generate`, `/api/tags`, `/api/show` | API nativa Ollama — Codex CLI vecchio (`--oss --local-provider ollama`) |
| `/v1/responses` | **API Responses di OpenAI** — Codex CLI recente (default per il provider oss) |
| `/v1/chat/completions`, `/v1/models` | API Chat Completions — provider configurati con `wire_api = "chat"` |

## Installazione

```bash
git clone https://github.com/danieknamaste-lang/cammellopazzo.git
cd cammellopazzo/deepseek-bridge
```

## Uso

### 1. Avvia il proxy

```bash
export DEEPSEEK_API_KEY="sk-tuo-token"
./bin/start-proxy
```

### 2. Usa Codex con DeepSeek

```bash
codex --oss --local-provider ollama -m deepseek-chat
```

Oppure configura di default in `~/.codex/config.toml`:

```toml
model_provider = "ollama"
model = "deepseek-chat"
```

### 3. Ferma il proxy

```bash
./bin/stop-proxy
```

## Configurazione

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `DEEPSEEK_API_KEY` | — | API key di DeepSeek (obbligatoria) |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Modello DeepSeek da usare |

## Modelli supportati

| Modello Codex | Modello DeepSeek |
|--------------|------------------|
| `deepseek-chat` | `deepseek-chat` |
| `deepseek-coder` | `deepseek-coder` |
| `deepseek-reasoner` | `deepseek-reasoner` |

## Stabilità su Android/Termux

Il sintomo classico — **il proxy muore silenziosamente dopo qualche secondo in
background** — di solito **non** è un crash di Python. Su Android 12+ il sistema
uccide i processi figli in background tramite il *phantom process killer* e il
*low-memory killer*, spesso entro pochi secondi da quando la shell che li ha
avviati passa in background.

Cosa fa questo bridge per mitigarlo:

- `start-proxy` avvia il proxy dentro un **supervisor** (loop `setsid`
  distaccato) che lo **riavvia automaticamente** se Android lo uccide, finché
  non esegui `stop-proxy`.
- Se disponibile, acquisisce un **wake lock** (`termux-wake-lock`) per evitare
  la sospensione, rilasciandolo allo stop.
- Il proxy ignora `SIGHUP`, gestisce `SIGTERM`/`SIGINT` in modo pulito e tollera
  i client che si disconnettono a metà stream (niente più thread che cadono per
  `BrokenPipeError`).

Per eliminare il problema alla radice, disabilita il phantom process killer via
ADB (una tantum, richiede USB debugging):

```bash
adb shell settings put global settings_enable_monitor_phantom_procs false
adb shell "settings put global settings_enable_monitor_phantom_procs false"
```

## Troubleshooting

### `stream disconnected before completion: error sending request for url (http://localhost:11434/v1/responses)`

Questo errore ha due cause tipiche:

1. **Codex CLI aggiornato**: le versioni recenti di Codex non parlano più l'API
   nativa di Ollama ma l'**API Responses di OpenAI** (`/v1/responses`). Le
   versioni del proxy precedenti a questa rispondevano 404 su quell'endpoint.
   Soluzione: aggiorna il bridge (`git pull`) e riavvia il proxy
   (`./bin/stop-proxy && ./bin/start-proxy`) — ora `/v1/responses` è supportato,
   inclusi tool call e streaming.
2. **Proxy non in esecuzione**: se Android ha ucciso il proxy (phantom process
   killer) la richiesta fallisce a livello di connessione. Verifica con
   `curl -s http://127.0.0.1:11434/v1/models` — se non risponde, riavvia con
   `./bin/start-proxy` e vedi la sezione *Stabilità su Android/Termux*.

In alternativa puoi forzare Codex a usare la Chat Completions API definendo un
provider esplicito in `~/.codex/config.toml`:

```toml
model = "deepseek-chat"
model_provider = "deepseek-proxy"

[model_providers.deepseek-proxy]
name = "DeepSeek via proxy"
base_url = "http://127.0.0.1:11434/v1"
wire_api = "chat"
```

Nota: le versioni recenti di Codex supportano anche provider remoti diretti —
puoi puntare `base_url = "https://api.deepseek.com/v1"` con
`env_key = "DEEPSEEK_API_KEY"` e `wire_api = "chat"` senza passare dal proxy.

## Limitazioni note

- Il proxy è un workaround: Codex non supporta nativamente API OpenAI-compatibili
- La connessione a DeepSeek richiede internet e una API valida
- Codex su Termux "puro" potrebbe non funzionare; usare `proot-distro ubuntu`
- `termux-wake-lock` richiede il pacchetto `termux-api` (`pkg install termux-api`)
