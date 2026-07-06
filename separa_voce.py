#!/usr/bin/env python3
"""Separa la voce dalla base strumentale di un brano musicale.

Usa Demucs (Meta AI) per la separazione delle sorgenti audio.
Per ogni brano produce due file:
  - <nome>_base.<ext>  : la base strumentale senza voce (karaoke)
  - <nome>_voce.<ext>  : la voce isolata (a cappella)

Esempi:
  python separa_voce.py canzone.mp3
  python separa_voce.py canzone.mp3 --output risultati --mp3
  python separa_voce.py *.wav --modello htdemucs_ft
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

MODELLI = {
    "htdemucs": "modello standard, buon compromesso qualità/velocità",
    "htdemucs_ft": "versione fine-tuned, qualità migliore ma ~4 volte più lento",
    "mdx_extra": "modello alternativo, a volte migliore su voci molto presenti",
}

FORMATI_SUPPORTATI = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".wma"}


def verifica_dipendenze() -> None:
    """Controlla che demucs e ffmpeg siano installati, altrimenti spiega come fare."""
    errori = []
    try:
        import demucs  # noqa: F401
    except ImportError:
        errori.append(
            "Demucs non è installato. Installalo con:\n"
            "    pip install -r requirements.txt\n"
            "  oppure:\n"
            "    pip install demucs"
        )
    if shutil.which("ffmpeg") is None:
        errori.append(
            "ffmpeg non è installato (serve per leggere/scrivere mp3 e altri formati).\n"
            "  Su Debian/Ubuntu:  sudo apt install ffmpeg\n"
            "  Su macOS:          brew install ffmpeg\n"
            "  Su Windows:        https://ffmpeg.org/download.html"
        )
    if errori:
        print("ERRORE — mancano delle dipendenze:\n", file=sys.stderr)
        for e in errori:
            print("• " + e + "\n", file=sys.stderr)
        sys.exit(1)


def separa_brano(brano: Path, cartella_output: Path, modello: str, mp3: bool) -> bool:
    """Esegue Demucs su un brano e rinomina i risultati in _base/_voce.

    Ritorna True se la separazione è andata a buon fine.
    """
    print(f"\n🎵 Elaboro: {brano.name} (modello: {modello})")
    print("   La prima esecuzione scarica il modello (~80-300 MB), poi resta in cache.")

    comando = [
        sys.executable, "-m", "demucs",
        "--two-stems", "vocals",
        "-n", modello,
        "-o", str(cartella_output),
    ]
    if mp3:
        comando += ["--mp3", "--mp3-bitrate", "320"]
    comando.append(str(brano))

    risultato = subprocess.run(comando)
    if risultato.returncode != 0:
        print(f"   ✗ Demucs ha fallito su {brano.name}", file=sys.stderr)
        return False

    # Demucs scrive in <output>/<modello>/<nome brano>/{vocals,no_vocals}.<ext>
    ext = "mp3" if mp3 else "wav"
    cartella_demucs = cartella_output / modello / brano.stem
    base = cartella_demucs / f"no_vocals.{ext}"
    voce = cartella_demucs / f"vocals.{ext}"
    if not base.exists() or not voce.exists():
        print(f"   ✗ Output di Demucs non trovato in {cartella_demucs}", file=sys.stderr)
        return False

    dest_base = cartella_output / f"{brano.stem}_base.{ext}"
    dest_voce = cartella_output / f"{brano.stem}_voce.{ext}"
    shutil.move(str(base), dest_base)
    shutil.move(str(voce), dest_voce)
    shutil.rmtree(cartella_output / modello, ignore_errors=True)

    print(f"   ✓ Base strumentale: {dest_base}")
    print(f"   ✓ Voce isolata:     {dest_voce}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Elimina la traccia voce da un brano musicale usando Demucs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Modelli disponibili:\n"
        + "\n".join(f"  {nome:<12} {desc}" for nome, desc in MODELLI.items()),
    )
    parser.add_argument("brani", nargs="+", type=Path,
                        help="uno o più file audio (mp3, wav, flac, ...)")
    parser.add_argument("-o", "--output", type=Path, default=Path("separati"),
                        help="cartella di destinazione (default: ./separati)")
    parser.add_argument("-m", "--modello", choices=sorted(MODELLI), default="htdemucs",
                        help="modello Demucs da usare (default: htdemucs)")
    parser.add_argument("--mp3", action="store_true",
                        help="salva i risultati in mp3 320kbps invece che wav")
    args = parser.parse_args()

    verifica_dipendenze()

    validi = []
    for brano in args.brani:
        if not brano.exists():
            print(f"⚠ File non trovato, lo salto: {brano}", file=sys.stderr)
        elif brano.suffix.lower() not in FORMATI_SUPPORTATI:
            print(f"⚠ Formato non supportato, lo salto: {brano}", file=sys.stderr)
        else:
            validi.append(brano)
    if not validi:
        print("Nessun file audio valido da elaborare.", file=sys.stderr)
        sys.exit(1)

    args.output.mkdir(parents=True, exist_ok=True)
    riusciti = sum(separa_brano(b, args.output, args.modello, args.mp3) for b in validi)

    print(f"\nFatto: {riusciti}/{len(validi)} brani separati con successo.")
    if riusciti < len(validi):
        sys.exit(1)


if __name__ == "__main__":
    main()
