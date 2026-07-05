"""Trascrizione: testo/parlato con faster-whisper, note musicali in MIDI con basic-pitch."""

from __future__ import annotations

import shutil

from .common import errore, ok, rel, resolve_path, run_command

TOOLS = [
    {
        "name": "trascrivi_audio",
        "description": (
            "Trascrive il parlato o il testo cantato di un file audio/video "
            "con Whisper. Salva la trascrizione in .txt e i sottotitoli in "
            ".srt con i timestamp, e restituisce il testo. Per il testo di "
            "una canzone conviene prima isolare la voce con separa_stems in "
            "modalità karaoke."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Percorso del file audio o video nel workspace"},
                "lingua": {
                    "type": "string",
                    "description": "Codice lingua ISO (es. 'it', 'en'). Se omesso viene rilevata automaticamente.",
                },
                "modello": {
                    "type": "string",
                    "enum": ["tiny", "base", "small", "medium", "large-v3"],
                    "description": "Modello Whisper: più grande = più preciso ma più lento (default 'small').",
                },
            },
            "required": ["file"],
        },
    },
    {
        "name": "trascrivi_in_midi",
        "description": (
            "Trascrive la MUSICA (le note suonate) di un file audio in un file "
            "MIDI usando basic-pitch di Spotify. Utile per ottenere lo spartito/"
            "le note di una melodia. Funziona meglio su tracce isolate (un solo "
            "strumento): se serve, separare prima con separa_stems."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_audio": {"type": "string", "description": "Percorso del file audio nel workspace"},
            },
            "required": ["file_audio"],
        },
    },
]


def _format_ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def trascrivi_audio(file: str, lingua: str | None = None, modello: str = "small") -> str:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return errore("faster-whisper non è installato: esegui `pip install faster-whisper`.")
    try:
        src = resolve_path(file)
    except Exception as e:
        return errore(str(e))

    try:
        model = WhisperModel(modello, device="auto", compute_type="auto")
        segments, info = model.transcribe(str(src), language=lingua)
        segs = list(segments)
    except Exception as e:
        return errore(f"Trascrizione fallita: {e}")

    testo = "\n".join(s.text.strip() for s in segs)
    txt_path = src.with_suffix(".txt")
    txt_path.write_text(testo + "\n", encoding="utf-8")

    srt_lines = []
    for i, s in enumerate(segs, 1):
        srt_lines += [str(i), f"{_format_ts(s.start)} --> {_format_ts(s.end)}", s.text.strip(), ""]
    srt_path = src.with_suffix(".srt")
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")

    return ok(
        lingua_rilevata=info.language,
        testo=testo[:4000],
        testo_troncato=len(testo) > 4000,
        file_txt=rel(txt_path),
        file_srt=rel(srt_path),
    )


def trascrivi_in_midi(file_audio: str) -> str:
    if shutil.which("basic-pitch") is None:
        return errore(
            "basic-pitch non è installato. Esegui `pip install -r requirements-full.txt` "
            "(oppure `pip install basic-pitch`)."
        )
    try:
        src = resolve_path(file_audio)
    except Exception as e:
        return errore(str(e))

    out_dir = src.parent / f"{src.stem}_midi"
    out_dir.mkdir(exist_ok=True)
    proc = run_command(["basic-pitch", str(out_dir), str(src)], timeout=3600)
    if proc.returncode != 0:
        return errore(f"basic-pitch è fallito: {(proc.stderr or proc.stdout)[-2000:]}")

    midi_files = sorted(rel(p) for p in out_dir.glob("*.mid"))
    if not midi_files:
        return errore("basic-pitch è terminato ma non ha prodotto file MIDI.")
    return ok(file_midi=midi_files)


HANDLERS = {
    "trascrivi_audio": trascrivi_audio,
    "trascrivi_in_midi": trascrivi_in_midi,
}
