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

## Limitazioni note

- Il proxy è un workaround: Codex non supporta nativamente API OpenAI-compatibili
- La connessione a DeepSeek richiede internet e una API valida
- Codex su Termux "puro" potrebbe non funzionare; usare `proot-distro ubuntu`
- `termux-wake-lock` richiede il pacchetto `termux-api` (`pkg install termux-api`)
