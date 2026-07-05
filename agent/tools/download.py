"""Tool di download: YouTube e le altre piattaforme supportate da yt-dlp."""

from __future__ import annotations

from pathlib import Path

from .common import WORKSPACE, ensure_workspace, errore, ok, rel

TOOLS = [
    {
        "name": "scarica_media",
        "description": (
            "Scarica un video o solo l'audio da un URL (YouTube, Vimeo, "
            "SoundCloud, TikTok, Instagram e migliaia di altre piattaforme "
            "supportate da yt-dlp). Il file viene salvato nel workspace e il "
            "risultato include il percorso del file scaricato. Usa "
            "solo_audio=true quando serve soltanto la traccia musicale."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL del video o del brano"},
                "solo_audio": {
                    "type": "boolean",
                    "description": "Se true scarica solo l'audio (default false)",
                },
                "formato_audio": {
                    "type": "string",
                    "enum": ["mp3", "wav", "m4a", "flac", "opus"],
                    "description": "Formato audio quando solo_audio=true (default mp3)",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "info_media_online",
        "description": (
            "Recupera i metadati di un video/brano online senza scaricarlo: "
            "titolo, durata, autore, formati disponibili."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL del contenuto"},
            },
            "required": ["url"],
        },
    },
    {
        "name": "cerca_youtube",
        "description": (
            "Cerca video su YouTube e restituisce titolo, URL, durata e canale "
            "dei primi risultati. Utile quando l'utente indica un brano o un "
            "video per nome invece che per URL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Testo da cercare"},
                "max_risultati": {
                    "type": "integer",
                    "description": "Numero di risultati (default 5, max 15)",
                },
            },
            "required": ["query"],
        },
    },
]


def _ydl_opts(extra: dict | None = None) -> dict:
    ensure_workspace()
    opts = {
        "outtmpl": str(WORKSPACE / "%(title).120B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": False,
    }
    if extra:
        opts.update(extra)
    return opts


def scarica_media(url: str, solo_audio: bool = False, formato_audio: str = "mp3") -> str:
    try:
        import yt_dlp
    except ImportError:
        return errore("yt-dlp non è installato: esegui `pip install yt-dlp`.")

    if solo_audio:
        extra = {
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": formato_audio,
                "preferredquality": "0",
            }],
        }
    else:
        extra = {"format": "bestvideo*+bestaudio/best", "merge_output_format": "mp4"}

    try:
        with yt_dlp.YoutubeDL(_ydl_opts(extra)) as ydl:
            info = ydl.extract_info(url, download=True)
            path = ydl.prepare_filename(info)
            if solo_audio:
                path = str(Path(path).with_suffix(f".{formato_audio}"))
    except Exception as e:  # yt-dlp solleva DownloadError e simili
        return errore(f"Download fallito: {e}")

    return ok(
        file=rel(Path(path)),
        titolo=info.get("title"),
        durata_secondi=info.get("duration"),
        piattaforma=info.get("extractor_key"),
    )


def info_media_online(url: str) -> str:
    try:
        import yt_dlp
    except ImportError:
        return errore("yt-dlp non è installato: esegui `pip install yt-dlp`.")
    try:
        with yt_dlp.YoutubeDL(_ydl_opts({"skip_download": True})) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        return errore(f"Impossibile leggere i metadati: {e}")
    return ok(
        titolo=info.get("title"),
        canale=info.get("uploader") or info.get("channel"),
        durata_secondi=info.get("duration"),
        data=info.get("upload_date"),
        piattaforma=info.get("extractor_key"),
        visualizzazioni=info.get("view_count"),
        descrizione=(info.get("description") or "")[:500],
    )


def cerca_youtube(query: str, max_risultati: int = 5) -> str:
    try:
        import yt_dlp
    except ImportError:
        return errore("yt-dlp non è installato: esegui `pip install yt-dlp`.")
    n = max(1, min(int(max_risultati), 15))
    try:
        opts = _ydl_opts({"skip_download": True, "extract_flat": "in_playlist"})
        opts["noplaylist"] = False  # ytsearch restituisce una "playlist" di risultati
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    except Exception as e:
        return errore(f"Ricerca fallita: {e}")
    risultati = [
        {
            "titolo": e.get("title"),
            "url": e.get("url") or f"https://www.youtube.com/watch?v={e.get('id')}",
            "canale": e.get("uploader") or e.get("channel"),
            "durata_secondi": e.get("duration"),
        }
        for e in (info.get("entries") or [])
    ]
    return ok(risultati=risultati)


HANDLERS = {
    "scarica_media": scarica_media,
    "info_media_online": info_media_online,
    "cerca_youtube": cerca_youtube,
}
