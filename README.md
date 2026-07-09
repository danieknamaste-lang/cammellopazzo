# 🎬📝 Agente di trascrizione video (+ musica)

Un agente AI che, partendo da un **video** (un file o un URL di YouTube e di migliaia di altre piattaforme), produce una **trascrizione fedele di tutto il parlato** — in inglese o in qualsiasi altra lingua — con testo `.txt` e sottotitoli `.srt` con i timestamp.

Tre motori di trascrizione a scelta:

| Backend | Motore | Costo | Timestamp | Note |
|---|---|---|---|---|
| `whisper_locale` *(default)* | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) sul tuo PC | gratuito | ✅ `.srt` | fedeltà regolabile col modello (`small` → `large-v3`) |
| `openai_whisper` | API OpenAI `whisper-1` | a consumo | ✅ `.srt` | richiede `OPENAI_API_KEY` |
| `openai_gpt4o` | API OpenAI `gpt-4o-transcribe` | a consumo | ❌ solo testo | massima fedeltà via API; richiede `OPENAI_API_KEY` |

In più, un passaggio opzionale di **rifinitura con Claude**: punteggiatura, maiuscole e paragrafi corretti *senza alterare una sola parola* della trascrizione.

L'agente sa anche gestire la parte musicale: separare la musica dal video, isolare la voce dagli strumenti (Demucs, modalità karaoke inclusa), tagliare/convertire con ffmpeg e trascrivere le melodie in MIDI (basic-pitch).

## Requisiti

- Python 3.10+
- [ffmpeg](https://ffmpeg.org/) installato e nel `PATH` (`sudo apt install ffmpeg` / `brew install ffmpeg`)
- Per l'agente conversazionale: una chiave API Anthropic (<https://platform.claude.com/>)
- Facoltativo: una chiave OpenAI per i backend `openai_*`

## Installazione

```bash
# Dipendenze base (download yt-dlp + trascrizione Whisper locale)
pip install -r requirements.txt

# Opzionale: backend OpenAI, separazione stems (Demucs), MIDI (basic-pitch).
# Attenzione: Demucs/basic-pitch scaricano PyTorch/TensorFlow (diversi GB).
pip install -r requirements-full.txt
```

```bash
export ANTHROPIC_API_KEY="la-tua-chiave"      # per l'agente conversazionale
export OPENAI_API_KEY="la-tua-chiave-openai"  # solo per i backend openai_*
```

## Uso 1 — Trascrizione diretta (senza chiave Anthropic)

Il modo più rapido per trascrivere un video:

```bash
# Da URL (YouTube, Vimeo, ...): scarica l'audio e lo trascrive
python -m agent.trascrivi "https://www.youtube.com/watch?v=..." --lingua en

# Da file locale, con la massima fedeltà
python -m agent.trascrivi lezione.mp4 --lingua en --modello large-v3

# Con l'API OpenAI invece di Whisper locale
python -m agent.trascrivi lezione.mp4 --backend openai_whisper
```

Output: `<nome>.txt` (testo) e `<nome>.srt` (sottotitoli con timestamp) nella cartella `workspace/`.

## Uso 2 — Agente conversazionale

```bash
# Sessione interattiva
python -m agent.main

# Richiesta singola
python -m agent.main "Trascrivi tutto quello che dicono in questo video: <url>"
```

L'agente concatena i passaggi da solo: *"trascrivi questo video"* → scarica l'audio → trascrive → (se richiesto) rifinisce il testo con Claude. Se c'è musica di sottofondo che disturba, isola prima la voce con Demucs.

Altri esempi di richieste:

- `Trascrivi lezione.mp4: è in inglese, e dammi anche i sottotitoli`
- `Trascrivi questo video e poi sistemami punteggiatura e paragrafi`
- `Togli la voce da questa canzone e dammi la base karaoke: <url>`
- `Estrai la musica da "video.mp4" e salvala in wav`
- `Trasforma in MIDI la melodia di piano.wav`
- `Taglia video.mp4 da 1:30 a 2:00`

## Consigli per la massima fedeltà

1. **Indica la lingua** (`--lingua en` o dillo all'agente): evita errori di rilevamento.
2. **Modello locale**: `small` è un buon compromesso; `large-v3` è il più fedele ma molto più lento su CPU (con GPU NVIDIA va veloce).
3. **Audio con musica di sottofondo**: chiedi all'agente di isolare prima la voce (Demucs in modalità karaoke) e poi trascrivere.
4. **Rifinitura**: il tool `rifinisci_trascrizione` sistema punteggiatura e paragrafi con Claude senza cambiare le parole — utile per testi lunghi da leggere.
5. File lunghi con i backend OpenAI vengono spezzati automaticamente in blocchi da 20 minuti (limite API di 25 MB) e i timestamp vengono riallineati.

## Struttura del progetto

```
agent/
├── main.py            # CLI interattiva (agente Claude)
├── trascrivi.py       # pipeline diretta: URL/file -> trascrizione
├── agent.py           # loop agentico (Claude + tool use, streaming)
└── tools/
    ├── common.py      # workspace e validazione percorsi
    ├── download.py    # yt-dlp: download, info, ricerca YouTube
    ├── media.py       # ffmpeg: estrazione audio, taglio, conversione...
    ├── separation.py  # Demucs: separazione stems / karaoke
    └── transcribe.py  # trascrizione (whisper locale / API OpenAI), rifinitura, MIDI
```

## Note

- I tool operano **solo** dentro `workspace/` (personalizzabile con `AGENT_WORKSPACE`): i percorsi fuori da quella cartella vengono rifiutati.
- Whisper e Demucs sono lenti su CPU: su video lunghi possono servire diversi minuti.
- Usa l'agente solo su contenuti che hai il diritto di scaricare ed elaborare.
