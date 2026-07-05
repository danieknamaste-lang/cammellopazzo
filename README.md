# 🎬🎵 Agente video & musica

Un agente AI (basato sull'API di Claude) che gestisce video e musica in linguaggio naturale:

- **Scarica** video o solo audio da **YouTube** e da migliaia di altre piattaforme (Vimeo, SoundCloud, TikTok, Instagram, ... — tutte quelle supportate da [yt-dlp](https://github.com/yt-dlp/yt-dlp))
- **Cerca** video su YouTube per titolo
- **Separa la musica dal video**: estrae la traccia audio, crea il video muto, sostituisce l'audio
- **Separa le sorgenti musicali** con [Demucs](https://github.com/facebookresearch/demucs): voce, batteria, basso, altri strumenti — oppure modalità *karaoke* (voce + base strumentale)
- **Trascrive** parlato e testi cantati con [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (testo `.txt` + sottotitoli `.srt` con timestamp)
- **Trascrive la musica in MIDI** (le note suonate) con [basic-pitch](https://github.com/spotify/basic-pitch) di Spotify
- **Taglia e converte** file audio/video con ffmpeg

L'agente concatena da solo i passaggi: ad esempio *"dammi il testo di questa canzone"* → scarica l'audio → isola la voce → la trascrive.

## Requisiti

- Python 3.10+
- [ffmpeg](https://ffmpeg.org/) installato e nel `PATH` (`sudo apt install ffmpeg` / `brew install ffmpeg`)
- Una chiave API Anthropic: <https://platform.claude.com/>

## Installazione

```bash
# Dipendenze base (download, ffmpeg wrapper, trascrizione Whisper)
pip install -r requirements.txt

# Opzionale: separazione stems (Demucs) e trascrizione MIDI (basic-pitch).
# Attenzione: scarica anche PyTorch/TensorFlow (diversi GB).
pip install -r requirements-full.txt
```

```bash
export ANTHROPIC_API_KEY="la-tua-chiave"
```

## Uso

```bash
# Sessione interattiva
python -m agent.main

# Richiesta singola
python -m agent.main "Scarica solo l'audio di https://www.youtube.com/watch?v=... in mp3"
```

Esempi di richieste:

- `Scarica questo video: https://www.youtube.com/watch?v=...`
- `Estrai la musica da "video.mp4" e salvala in wav`
- `Togli la voce da questa canzone e dammi la base karaoke: <url>`
- `Trascrivi il testo di brano.mp3 con i sottotitoli`
- `Trasforma in MIDI la melodia di piano.wav`
- `Taglia video.mp4 da 1:30 a 2:00 e convertilo in mp4`

Tutti i file di lavoro finiscono nella cartella `workspace/` (personalizzabile con la variabile d'ambiente `AGENT_WORKSPACE`).

## Struttura del progetto

```
agent/
├── main.py            # CLI interattiva
├── agent.py           # loop agentico (Claude + tool use, streaming)
└── tools/
    ├── common.py      # workspace e validazione percorsi
    ├── download.py    # yt-dlp: download, info, ricerca YouTube
    ├── media.py       # ffmpeg: estrazione audio, taglio, conversione...
    ├── separation.py  # Demucs: separazione stems / karaoke
    └── transcribe.py  # Whisper (testo/srt) e basic-pitch (MIDI)
```

## Note

- Demucs e Whisper sono lenti su CPU: su brani lunghi possono servire diversi minuti. Con una GPU NVIDIA vanno molto più veloci.
- I tool operano **solo** dentro `workspace/`: i percorsi fuori da quella cartella vengono rifiutati.
- Usa l'agente solo su contenuti che hai il diritto di scaricare ed elaborare.
