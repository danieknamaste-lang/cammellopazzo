"""Separazione delle sorgenti audio con Demucs (voce, batteria, basso, altro)."""

from __future__ import annotations

import sys

from .common import WORKSPACE, errore, ok, rel, resolve_path, run_command

TOOLS = [
    {
        "name": "separa_stems",
        "description": (
            "Separa un file audio (o la traccia audio di un brano) nelle sue "
            "sorgenti con Demucs: voce, batteria, basso e altri strumenti. "
            "Con modalita='karaoke' produce solo due file: voce e base "
            "strumentale (utile per karaoke o per isolare la musica). "
            "Se si parte da un video, estrarre prima l'audio con estrai_audio. "
            "Operazione lenta: può richiedere alcuni minuti."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_audio": {
                    "type": "string",
                    "description": "Percorso del file audio nel workspace",
                },
                "modalita": {
                    "type": "string",
                    "enum": ["completa", "karaoke"],
                    "description": (
                        "'completa' = 4 stems (voce, batteria, basso, altro); "
                        "'karaoke' = 2 stems (voce, strumentale). Default 'completa'."
                    ),
                },
            },
            "required": ["file_audio"],
        },
    },
]


def separa_stems(file_audio: str, modalita: str = "completa") -> str:
    try:
        import demucs  # noqa: F401 — verifica solo la presenza del pacchetto
    except ImportError:
        return errore(
            "Demucs non è installato. Esegui `pip install -r requirements-full.txt` "
            "(scarica anche PyTorch, ~2 GB)."
        )
    try:
        src = resolve_path(file_audio)
    except Exception as e:
        return errore(str(e))

    out_dir = WORKSPACE / "separati"
    cmd = [sys.executable, "-m", "demucs", "--mp3", "-o", str(out_dir)]
    if modalita == "karaoke":
        cmd += ["--two-stems", "vocals"]
    cmd.append(str(src))

    proc = run_command(cmd, timeout=7200)
    if proc.returncode != 0:
        return errore(f"Demucs è fallito: {(proc.stderr or proc.stdout)[-2000:]}")

    # Demucs scrive in <out_dir>/<modello>/<nome file>/
    stems = sorted(
        rel(p)
        for p in out_dir.rglob("*.mp3")
        if p.parent.name == src.stem
    )
    if not stems:
        return errore("Demucs è terminato ma non sono stati trovati i file separati.")
    note = (
        "no_vocals = base strumentale (musica senza voce)"
        if modalita == "karaoke"
        else "stems: vocals (voce), drums (batteria), bass (basso), other (altro)"
    )
    return ok(stems=stems, nota=note)


HANDLERS = {"separa_stems": separa_stems}
