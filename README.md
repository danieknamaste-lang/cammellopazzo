# Cammellopazzo — Studio Musicale IA

Progetto per un agente IA "direttore artistico di studio di registrazione", con strumenti pratici per lavorare sui brani musicali.

## Contenuto del progetto

| File | Descrizione |
|---|---|
| `direttore-studio-prompt.md` | Il prompt di sistema che definisce la personalità e le competenze dell'agente (arrangiamento, testi, traduzioni, teoria musicale). |
| `separa_voce.py` | Script che **elimina la traccia voce** da un brano, producendo la base strumentale (karaoke) e la voce isolata. |
| `requirements.txt` | Le dipendenze Python dello script. |

## Separare la voce da un brano

Lo script usa [Demucs](https://github.com/facebookresearch/demucs) (Meta AI), uno dei migliori sistemi open source di separazione delle sorgenti audio.

### Requisiti

- **Python 3.9 o superiore**
- **ffmpeg** installato sul sistema:
  - Debian/Ubuntu: `sudo apt install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: [ffmpeg.org/download.html](https://ffmpeg.org/download.html)

### Installazione

Consigliato: usa un ambiente virtuale. Su Debian/Ubuntu è praticamente obbligatorio, perché il setuptools di sistema ha un bug (`AttributeError: install_layout`) che fa fallire la compilazione di Demucs.

```bash
python3 -m venv .venv
source .venv/bin/activate        # su Windows: .venv\Scripts\activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

Nota: l'installazione include PyTorch, quindi può scaricare qualche gigabyte. Alla prima esecuzione Demucs scarica anche il modello (~80–300 MB), che poi resta in cache.

### Uso

```bash
# Caso base: crea la cartella ./separati con canzone_base.wav e canzone_voce.wav
python separa_voce.py canzone.mp3

# Output in mp3 320kbps, in una cartella a scelta
python separa_voce.py canzone.mp3 --output risultati --mp3

# Più brani insieme, con il modello di qualità più alta (più lento)
python separa_voce.py brano1.mp3 brano2.wav --modello htdemucs_ft
```

Per ogni brano ottieni due file:

- `<nome>_base` — la base strumentale **senza voce** (per karaoke, remix, cover)
- `<nome>_voce` — la **voce isolata** (a cappella)

### Modelli disponibili

| Modello | Caratteristiche |
|---|---|
| `htdemucs` | Standard, buon compromesso qualità/velocità (default) |
| `htdemucs_ft` | Fine-tuned, qualità migliore ma circa 4 volte più lento |
| `mdx_extra` | Alternativo, a volte migliore su voci molto presenti |

### Note

- La separazione è molto buona ma non perfetta al 100%: su mix molto densi possono restare lievi residui di voce nella base.
- Se hai una GPU NVIDIA con CUDA, Demucs la usa automaticamente ed è molto più veloce; senza GPU funziona comunque, solo più lentamente.
- Usa lo script solo su brani di cui hai il diritto di elaborazione (brani tuoi, licenze, uso personale consentito).
