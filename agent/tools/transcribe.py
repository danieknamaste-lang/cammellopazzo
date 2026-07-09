"""Trascrizione fedele di audio/video.

Backend disponibili:
- "whisper_locale"  -> faster-whisper sul proprio computer (gratuito, default)
- "openai_whisper"  -> API OpenAI, modello whisper-1 (testo + timestamp)
- "openai_gpt4o"    -> API OpenAI, modello gpt-4o-transcribe (solo testo)

In più: rifinitura della trascrizione con Claude (punteggiatura/paragrafi
senza alterare le parole) e trascrizione musicale in MIDI con basic-pitch.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from .common import errore, ok, rel, require_binary, resolve_path, run_command

# Dimensione massima per singola richiesta all'API OpenAI (limite reale: 25 MB)
_OPENAI_MAX_BYTES = 24 * 1024 * 1024
_OPENAI_CHUNK_SECONDS = 1200  # 20 minuti per spezzone

TOOLS = [
    {
        "name": "trascrivi_audio",
        "description": (
            "Trascrive fedelmente il parlato di un file audio o video, "
            "producendo testo (.txt) e sottotitoli con timestamp (.srt). "
            "Backend: 'whisper_locale' (faster-whisper, gratuito, default), "
            "'openai_whisper' (API OpenAI whisper-1, con timestamp), "
            "'openai_gpt4o' (API OpenAI gpt-4o-transcribe, solo testo; i "
            "backend openai richiedono la variabile OPENAI_API_KEY). "
            "Per la massima fedeltà in locale usare modello='large-v3' "
            "(più lento); 'small' è un buon compromesso. Con audio rumoroso "
            "o musica di sottofondo conviene prima isolare la voce con "
            "separa_stems in modalità karaoke."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file": {
                    "type": "string",
                    "description": "Percorso del file audio o video nel workspace",
                },
                "lingua": {
                    "type": "string",
                    "description": (
                        "Codice lingua ISO del parlato, es. 'en' per l'inglese, "
                        "'it' per l'italiano. Se omesso viene rilevata "
                        "automaticamente; indicarla migliora la fedeltà."
                    ),
                },
                "modello": {
                    "type": "string",
                    "enum": ["tiny", "base", "small", "medium", "large-v3"],
                    "description": (
                        "Solo per whisper_locale: più grande = più fedele ma "
                        "più lento (default 'small', massima fedeltà 'large-v3')."
                    ),
                },
                "backend": {
                    "type": "string",
                    "enum": ["whisper_locale", "openai_whisper", "openai_gpt4o"],
                    "description": "Motore di trascrizione (default 'whisper_locale').",
                },
            },
            "required": ["file"],
        },
    },
    {
        "name": "rifinisci_trascrizione",
        "description": (
            "Rifinisce una trascrizione .txt con Claude: corregge "
            "punteggiatura, maiuscole e va a capo in paragrafi, SENZA "
            "cambiare, aggiungere o togliere parole. Utile come ultimo "
            "passaggio dopo trascrivi_audio. Richiede ANTHROPIC_API_KEY "
            "(già presente se l'agente è in esecuzione)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_txt": {
                    "type": "string",
                    "description": "Percorso del file .txt della trascrizione nel workspace",
                },
            },
            "required": ["file_txt"],
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


# ---------------------------------------------------------------------------
# Utilità comuni
# ---------------------------------------------------------------------------

def _format_ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _salva_output(src: Path, segmenti: list[dict], testo: str) -> dict:
    """Scrive .txt (sempre) e .srt (se ci sono i timestamp). Restituisce i percorsi."""
    txt_path = src.with_suffix(".txt")
    txt_path.write_text(testo.strip() + "\n", encoding="utf-8")
    out = {"file_txt": rel(txt_path)}

    if segmenti:
        srt_lines = []
        for i, s in enumerate(segmenti, 1):
            srt_lines += [
                str(i),
                f"{_format_ts(s['inizio'])} --> {_format_ts(s['fine'])}",
                s["testo"].strip(),
                "",
            ]
        srt_path = src.with_suffix(".srt")
        srt_path.write_text("\n".join(srt_lines), encoding="utf-8")
        out["file_srt"] = rel(srt_path)
    return out


def _risultato(src: Path, segmenti: list[dict], testo: str, **extra) -> str:
    testo = testo.strip()
    return ok(
        **_salva_output(src, segmenti, testo),
        testo=testo[:4000],
        testo_troncato=len(testo) > 4000,
        **extra,
    )


# ---------------------------------------------------------------------------
# Backend 1: faster-whisper in locale
# ---------------------------------------------------------------------------

def _trascrivi_locale(src: Path, lingua: str | None, modello: str) -> str:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return errore("faster-whisper non è installato: esegui `pip install faster-whisper`.")

    try:
        model = WhisperModel(modello, device="auto", compute_type="auto")
        segments, info = model.transcribe(
            str(src),
            language=lingua,
            beam_size=5,          # ricerca più accurata = trascrizione più fedele
            vad_filter=True,      # salta i silenzi: meno allucinazioni di Whisper
        )
        segs = [
            {"inizio": s.start, "fine": s.end, "testo": s.text}
            for s in segments
        ]
    except Exception as e:
        return errore(f"Trascrizione locale fallita: {e}")

    testo = "\n".join(s["testo"].strip() for s in segs)
    return _risultato(
        src, segs, testo,
        backend="whisper_locale",
        modello=modello,
        lingua_rilevata=info.language,
    )


# ---------------------------------------------------------------------------
# Backend 2/3: API OpenAI (whisper-1 o gpt-4o-transcribe)
# ---------------------------------------------------------------------------

def _prepara_spezzoni_openai(src: Path) -> tuple[Path, list[Path]]:
    """Converte in mp3 mono 16 kHz e spezza in blocchi da 20 minuti.

    L'API OpenAI accetta al massimo 25 MB per richiesta: a 64 kbps mono ogni
    blocco da 20 minuti pesa ~10 MB, ampiamente nei limiti. Per file brevi
    il risultato è un singolo spezzone.
    """
    ffmpeg = require_binary("ffmpeg")
    tmp = Path(tempfile.mkdtemp(prefix="openai_chunks_"))
    proc = run_command([
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k",
        "-f", "segment", "-segment_time", str(_OPENAI_CHUNK_SECONDS),
        "-reset_timestamps", "1",
        str(tmp / "chunk_%04d.mp3"),
    ])
    if proc.returncode != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError(proc.stderr.strip()[-2000:] or "ffmpeg ha restituito un errore")
    chunks = sorted(tmp.glob("chunk_*.mp3"))
    if not chunks:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("Nessun audio prodotto dalla conversione.")
    oversize = [c for c in chunks if c.stat().st_size > _OPENAI_MAX_BYTES]
    if oversize:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("Uno spezzone supera il limite di 25 MB dell'API OpenAI.")
    return tmp, chunks


def _trascrivi_openai(src: Path, lingua: str | None, backend: str) -> str:
    if not os.environ.get("OPENAI_API_KEY"):
        return errore(
            "Backend OpenAI richiesto ma la variabile OPENAI_API_KEY non è "
            "impostata. In alternativa usa backend='whisper_locale'."
        )
    try:
        from openai import OpenAI
    except ImportError:
        return errore("Il pacchetto openai non è installato: esegui `pip install openai`.")

    modello_api = "whisper-1" if backend == "openai_whisper" else "gpt-4o-transcribe"
    con_timestamp = backend == "openai_whisper"

    try:
        tmp, chunks = _prepara_spezzoni_openai(src)
    except Exception as e:
        return errore(f"Preparazione dell'audio fallita: {e}")

    client = OpenAI()
    segmenti: list[dict] = []
    testi: list[str] = []
    try:
        for i, chunk in enumerate(chunks):
            offset = i * _OPENAI_CHUNK_SECONDS
            with open(chunk, "rb") as f:
                kwargs = {"model": modello_api, "file": f}
                if lingua:
                    kwargs["language"] = lingua
                if con_timestamp:
                    kwargs["response_format"] = "verbose_json"
                resp = client.audio.transcriptions.create(**kwargs)
            testi.append(resp.text.strip())
            if con_timestamp:
                for s in resp.segments or []:
                    segmenti.append({
                        "inizio": s.start + offset,
                        "fine": s.end + offset,
                        "testo": s.text,
                    })
    except Exception as e:
        return errore(f"Chiamata all'API OpenAI fallita: {e}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    testo = "\n".join(s["testo"].strip() for s in segmenti) if segmenti else "\n\n".join(testi)
    extra = {"backend": backend, "modello": modello_api, "spezzoni": len(chunks)}
    if not con_timestamp:
        extra["nota"] = "gpt-4o-transcribe restituisce solo testo: nessun file .srt."
    return _risultato(src, segmenti, testo, **extra)


# ---------------------------------------------------------------------------
# Tool esposti all'agente
# ---------------------------------------------------------------------------

def trascrivi_audio(
    file: str,
    lingua: str | None = None,
    modello: str = "small",
    backend: str = "whisper_locale",
) -> str:
    try:
        src = resolve_path(file)
    except Exception as e:
        return errore(str(e))

    if backend == "whisper_locale":
        return _trascrivi_locale(src, lingua, modello)
    if backend in ("openai_whisper", "openai_gpt4o"):
        return _trascrivi_openai(src, lingua, backend)
    return errore(f"Backend sconosciuto: {backend}")


_PROMPT_RIFINITURA = """Sei un correttore di trascrizioni. Ricevi il testo grezzo \
di una trascrizione automatica e devi restituirlo rifinito:
- correggi SOLO punteggiatura e maiuscole/minuscole;
- dividi il testo in paragrafi dove il discorso cambia argomento;
- NON cambiare, aggiungere, togliere o riordinare nessuna parola;
- NON tradurre e NON riassumere;
- rispondi esclusivamente con il testo rifinito, senza commenti."""


def rifinisci_trascrizione(file_txt: str) -> str:
    try:
        import anthropic
    except ImportError:
        return errore("Il pacchetto anthropic non è installato.")
    try:
        src = resolve_path(file_txt)
    except Exception as e:
        return errore(str(e))

    testo = src.read_text(encoding="utf-8")
    if not testo.strip():
        return errore("Il file di trascrizione è vuoto.")

    # Blocchi da ~12k caratteri, spezzati sui confini di riga
    blocchi: list[str] = []
    corrente: list[str] = []
    size = 0
    for riga in testo.splitlines():
        corrente.append(riga)
        size += len(riga) + 1
        if size >= 12000:
            blocchi.append("\n".join(corrente))
            corrente, size = [], 0
    if corrente:
        blocchi.append("\n".join(corrente))

    client = anthropic.Anthropic()
    rifiniti: list[str] = []
    try:
        for blocco in blocchi:
            resp = client.messages.create(
                model="claude-opus-4-8",
                max_tokens=16000,
                system=_PROMPT_RIFINITURA,
                messages=[{"role": "user", "content": blocco}],
            )
            if resp.stop_reason == "refusal":
                return errore("La rifinitura è stata rifiutata per motivi di sicurezza.")
            rifiniti.append(
                next((b.text for b in resp.content if b.type == "text"), "")
            )
    except Exception as e:
        return errore(f"Chiamata all'API Anthropic fallita: {e}")

    dst = src.with_name(f"{src.stem}_rifinita.txt")
    dst.write_text("\n\n".join(r.strip() for r in rifiniti) + "\n", encoding="utf-8")
    return ok(file_txt=rel(dst), blocchi_elaborati=len(blocchi))


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
    "rifinisci_trascrizione": rifinisci_trascrizione,
    "trascrivi_in_midi": trascrivi_in_midi,
}
