# Bridge Codex CLI ↔ Claude Code su Android

Sì, si può fare: su Android sia **Codex CLI** che **Claude Code** girano dentro
[Termux](https://termux.dev) e condividono lo stesso filesystem. Il "bridge" non
richiede quindi nessun server: è un insieme di script che prendono il codice
generato da Codex e lo passano a Claude Code in modalità non interattiva
(`claude -p`) per la revisione — con la possibilità di un ciclo automatico
*genera → revisiona → correggi*.

```
┌─────────────┐   diff/file    ┌──────────────┐
│  Codex CLI  │ ─────────────▶ │ claude-review │──▶ review (+ verdetto)
│  (genera)   │ ◀───────────── │ (Claude Code) │
└─────────────┘  correzioni    └──────────────┘
        ▲                             │
        └──── codex-claude-bridge ────┘  (loop opzionale con --fix)
```

## Requisiti

- Android con [Termux](https://f-droid.org/packages/com.termux/) (versione F-Droid consigliata)
- Account Anthropic (per Claude Code) e account OpenAI (per Codex CLI)

## Installazione

Dentro Termux:

```sh
git clone https://github.com/danieknamaste-lang/cammellopazzo.git
cd cammellopazzo
bash setup-termux.sh
```

Lo script installa Node.js, Claude Code (`@anthropic-ai/claude-code`), Codex CLI
(`@openai/codex`) e mette `bin/` nel PATH. Al primo avvio esegui `claude` e
`codex` una volta ciascuno per fare il login.

> **Nota:** se il binario nativo di Codex non parte su Termux "puro" (dipende
> dalla versione), installa un Ubuntu dentro Termux e lavora lì — funziona tutto
> allo stesso modo:
> ```sh
> pkg install proot-distro
> proot-distro install ubuntu
> proot-distro login ubuntu
> ```

## Uso

### 1. Review manuale (il caso più comune)

Lavori con Codex come sempre; quando vuoi una seconda opinione, dalla radice del
progetto:

```sh
claude-review                  # rivede tutte le modifiche non committate
claude-review --staged         # solo ciò che è in staging
claude-review --last 3         # gli ultimi 3 commit
claude-review main..HEAD       # un range di commit
claude-review src/app.py       # file specifici
claude-review -o               # come sopra, ma salva la review in .claude-reviews/
```

La review termina sempre con una riga `VERDETTO: OK` oppure
`VERDETTO: CORREZIONI NECESSARIE`, e lo script esce con codice `2` nel secondo
caso — comodo per gli script.

### 2. Ciclo automatico genera → revisiona → correggi

```sh
codex-claude-bridge "aggiungi la validazione dell'email nel form di login"
```

Codex implementa il task, poi Claude lo revisiona. Con `--fix` il bridge chiude
il cerchio: se Claude segnala problemi, la review viene ripassata a Codex che
applica le correzioni, e Claude rirevisiona (massimo `--max-cycles` volte,
default 3):

```sh
codex-claude-bridge --fix "implementa la cache LRU in utils/cache.js"
codex-claude-bridge --review-only          # solo il ciclo di review sulle modifiche presenti
```

### 3. Review automatica a ogni commit (opzionale)

```sh
git config core.hooksPath hooks
export CLAUDE_AUTOREVIEW=1     # attivala solo quando la vuoi: le review costano tempo/token
```

Da quel momento ogni `git commit` fa partire una review dell'ultimo commit,
salvata in `.claude-reviews/`.

## Configurazione

| Variabile | Default | Descrizione |
|---|---|---|
| `CLAUDE_REVIEW_MODEL` | (default di Claude Code) | Modello per la review, es. `claude-sonnet-5` |
| `CLAUDE_REVIEW_LANG` | `italiano` | Lingua della review |
| `CLAUDE_REVIEW_DIR` | `.claude-reviews` | Dove salvare le review con `-o` |
| `CODEX_BIN` | `codex` | Comando Codex |
| `CODEX_EXEC_ARGS` | `--full-auto` | Argomenti per `codex exec` |
| `CLAUDE_AUTOREVIEW` | `0` | `1` = review automatica a ogni commit (con l'hook) |

## Alternativa senza Termux: review nel cloud

Se sul telefono preferisci non far girare due CLI, il bridge può passare da
GitHub: fai push del lavoro di Codex su un branch e chiedi la review a Claude
Code sul web ([claude.ai/code](https://claude.ai/code)) — anche dall'app mobile —
con un prompt tipo "fai la review del branch X" o il comando `/review` su una
pull request. In questo modo la revisione gira in un ambiente remoto e sul
telefono serve solo Codex.

## Note

- `claude -p` in modalità non interattiva può *leggere* il repository per capire
  il contesto, ma non modifica nulla: la review è sicura di default.
- Le review in `.claude-reviews/` sono ignorate da git (vedi `.gitignore`).
