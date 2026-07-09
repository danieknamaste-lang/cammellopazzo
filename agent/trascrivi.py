"""Pipeline diretta: video (URL o file) -> trascrizione fedele.

Non richiede ANTHROPIC_API_KEY: usa direttamente yt-dlp + Whisper
(o l'API OpenAI, se scelta come backend).

Uso:
    python -m agent.trascrivi <url-o-file> [opzioni]

Esempi:
    python -m agent.trascrivi "https://www.youtube.com/watch?v=..." --lingua en
    python -m agent.trascrivi video.mp4 --modello large-v3
    python -m agent.trascrivi lezione.mp4 --backend openai_whisper
"""

from __future__ import annotations

import argparse
import json
import sys

from .tools.download import scarica_media
from .tools.transcribe import trascrivi_audio
from .tools.common import WORKSPACE, ensure_workspace


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m agent.trascrivi",
        description="Trascrive fedelmente il parlato di un video o audio (URL o file locale).",
    )
    parser.add_argument("sorgente", help="URL (YouTube ecc.) oppure percorso di un file nel workspace")
    parser.add_argument("--lingua", default=None,
                        help="Codice lingua del parlato, es. 'en' (default: rilevata automaticamente)")
    parser.add_argument("--modello", default="small",
                        choices=["tiny", "base", "small", "medium", "large-v3"],
                        help="Modello Whisper locale (default: small; massima fedeltà: large-v3)")
    parser.add_argument("--backend", default="whisper_locale",
                        choices=["whisper_locale", "openai_whisper", "openai_gpt4o"],
                        help="Motore di trascrizione (default: whisper_locale)")
    args = parser.parse_args()

    ensure_workspace()
    sorgente = args.sorgente

    # 1. Se è un URL, scarica solo l'audio
    if sorgente.startswith(("http://", "https://")):
        print(f"Scarico l'audio da: {sorgente}")
        r = json.loads(scarica_media(sorgente, solo_audio=True, formato_audio="mp3"))
        if r["esito"] != "ok":
            print(f"Errore nel download: {r['messaggio']}", file=sys.stderr)
            sys.exit(1)
        sorgente = r["file"]
        print(f"Scaricato: {WORKSPACE / sorgente}")

    # 2. Trascrivi
    print(f"Trascrivo con {args.backend}"
          + (f" (modello {args.modello})" if args.backend == "whisper_locale" else "")
          + " — su file lunghi può volerci un po'...")
    r = json.loads(trascrivi_audio(
        sorgente, lingua=args.lingua, modello=args.modello, backend=args.backend,
    ))
    if r["esito"] != "ok":
        print(f"Errore nella trascrizione: {r['messaggio']}", file=sys.stderr)
        sys.exit(1)

    # 3. Riepilogo
    print("\n--- Trascrizione completata ---")
    if r.get("lingua_rilevata"):
        print(f"Lingua rilevata: {r['lingua_rilevata']}")
    print(f"Testo:        {WORKSPACE / r['file_txt']}")
    if r.get("file_srt"):
        print(f"Sottotitoli:  {WORKSPACE / r['file_srt']}")
    if r.get("nota"):
        print(f"Nota: {r['nota']}")
    anteprima = r.get("testo", "")
    print("\n--- Anteprima ---")
    print(anteprima[:1500] + ("\n[...]" if len(anteprima) > 1500 else ""))


if __name__ == "__main__":
    main()
