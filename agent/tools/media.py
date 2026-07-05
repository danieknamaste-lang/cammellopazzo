"""Tool basati su ffmpeg: estrazione audio, taglio, conversione, ispezione."""

from __future__ import annotations

import json

from .common import (
    WORKSPACE,
    ensure_workspace,
    errore,
    ok,
    rel,
    require_binary,
    resolve_path,
    run_command,
)

TOOLS = [
    {
        "name": "estrai_audio",
        "description": (
            "Estrae la traccia audio da un file video già presente nel "
            "workspace e la salva in un file audio separato (questa è la "
            "'separazione della musica dal video' di base). Per separare la "
            "voce dagli strumenti usare invece separa_stems."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_video": {"type": "string", "description": "Percorso del video nel workspace"},
                "formato": {
                    "type": "string",
                    "enum": ["mp3", "wav", "flac", "m4a"],
                    "description": "Formato del file audio (default mp3; usare wav per demucs/whisper di qualità)",
                },
            },
            "required": ["file_video"],
        },
    },
    {
        "name": "rimuovi_audio",
        "description": (
            "Crea una copia di un video SENZA la traccia audio (video muto). "
            "Utile insieme a estrai_audio per ottenere video e musica in due "
            "file distinti."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_video": {"type": "string", "description": "Percorso del video nel workspace"},
            },
            "required": ["file_video"],
        },
    },
    {
        "name": "taglia_media",
        "description": (
            "Taglia un file audio o video tra due istanti (formato HH:MM:SS o "
            "secondi) e salva il risultato in un nuovo file."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Percorso del file nel workspace"},
                "inizio": {"type": "string", "description": "Istante iniziale, es. '00:01:30' o '90'"},
                "fine": {"type": "string", "description": "Istante finale, es. '00:02:00' o '120'"},
            },
            "required": ["file", "inizio", "fine"],
        },
    },
    {
        "name": "converti_media",
        "description": "Converte un file audio o video in un altro formato (es. mkv -> mp4, wav -> mp3).",
        "input_schema": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Percorso del file nel workspace"},
                "formato": {"type": "string", "description": "Estensione di destinazione, es. 'mp4', 'mp3', 'wav'"},
            },
            "required": ["file", "formato"],
        },
    },
    {
        "name": "sostituisci_audio",
        "description": (
            "Sostituisce la traccia audio di un video con un altro file audio "
            "(es. rimettere nel video la base strumentale dopo aver tolto la voce)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_video": {"type": "string", "description": "Video di partenza nel workspace"},
                "file_audio": {"type": "string", "description": "Audio da inserire nel video"},
            },
            "required": ["file_video", "file_audio"],
        },
    },
    {
        "name": "info_file_media",
        "description": "Legge con ffprobe le informazioni di un file locale: durata, codec, risoluzione, tracce.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Percorso del file nel workspace"},
            },
            "required": ["file"],
        },
    },
    {
        "name": "lista_file",
        "description": "Elenca i file presenti nel workspace dell'agente (ricorsivo), con dimensioni.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


def _ffmpeg(args: list[str]) -> None:
    ffmpeg = require_binary("ffmpeg")
    proc = run_command([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", *args])
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[-2000:] or "ffmpeg ha restituito un errore")


def estrai_audio(file_video: str, formato: str = "mp3") -> str:
    try:
        src = resolve_path(file_video)
        dst = src.with_name(f"{src.stem}_audio.{formato}")
        codec = {"mp3": ["-c:a", "libmp3lame", "-q:a", "0"],
                 "wav": ["-c:a", "pcm_s16le"],
                 "flac": ["-c:a", "flac"],
                 "m4a": ["-c:a", "aac", "-b:a", "256k"]}[formato]
        _ffmpeg(["-i", str(src), "-vn", *codec, str(dst)])
        return ok(file_audio=rel(dst))
    except Exception as e:
        return errore(str(e))


def rimuovi_audio(file_video: str) -> str:
    try:
        src = resolve_path(file_video)
        dst = src.with_name(f"{src.stem}_muto{src.suffix}")
        _ffmpeg(["-i", str(src), "-an", "-c:v", "copy", str(dst)])
        return ok(file_video_muto=rel(dst))
    except Exception as e:
        return errore(str(e))


def taglia_media(file: str, inizio: str, fine: str) -> str:
    try:
        src = resolve_path(file)
        dst = src.with_name(f"{src.stem}_taglio{src.suffix}")
        _ffmpeg(["-i", str(src), "-ss", inizio, "-to", fine, str(dst)])
        return ok(file=rel(dst), inizio=inizio, fine=fine)
    except Exception as e:
        return errore(str(e))


def converti_media(file: str, formato: str) -> str:
    try:
        src = resolve_path(file)
        formato = formato.lstrip(".").lower()
        if not formato.isalnum():
            return errore(f"Formato non valido: {formato}")
        dst = src.with_suffix(f".{formato}")
        if dst == src:
            return errore("Il file è già in quel formato.")
        _ffmpeg(["-i", str(src), str(dst)])
        return ok(file=rel(dst))
    except Exception as e:
        return errore(str(e))


def sostituisci_audio(file_video: str, file_audio: str) -> str:
    try:
        video = resolve_path(file_video)
        audio = resolve_path(file_audio)
        dst = video.with_name(f"{video.stem}_nuovo_audio{video.suffix}")
        _ffmpeg([
            "-i", str(video), "-i", str(audio),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-shortest", str(dst),
        ])
        return ok(file=rel(dst))
    except Exception as e:
        return errore(str(e))


def info_file_media(file: str) -> str:
    try:
        src = resolve_path(file)
        ffprobe = require_binary("ffprobe")
        proc = run_command([
            ffprobe, "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", str(src),
        ])
        if proc.returncode != 0:
            return errore(proc.stderr.strip()[-1000:])
        data = json.loads(proc.stdout)
        fmt = data.get("format", {})
        streams = [
            {
                "tipo": s.get("codec_type"),
                "codec": s.get("codec_name"),
                "risoluzione": f"{s.get('width')}x{s.get('height')}" if s.get("width") else None,
                "canali": s.get("channels"),
                "sample_rate": s.get("sample_rate"),
            }
            for s in data.get("streams", [])
        ]
        return ok(
            file=rel(src),
            durata_secondi=float(fmt["duration"]) if fmt.get("duration") else None,
            dimensione_bytes=int(fmt["size"]) if fmt.get("size") else None,
            formato=fmt.get("format_name"),
            tracce=streams,
        )
    except Exception as e:
        return errore(str(e))


def lista_file() -> str:
    ensure_workspace()
    files = [
        {
            "file": rel(p),
            "dimensione_mb": round(p.stat().st_size / 1_048_576, 2),
        }
        for p in sorted(WORKSPACE.rglob("*"))
        if p.is_file()
    ]
    return ok(workspace=str(WORKSPACE), file=files)


HANDLERS = {
    "estrai_audio": estrai_audio,
    "rimuovi_audio": rimuovi_audio,
    "taglia_media": taglia_media,
    "converti_media": converti_media,
    "sostituisci_audio": sostituisci_audio,
    "info_file_media": info_file_media,
    "lista_file": lista_file,
}
