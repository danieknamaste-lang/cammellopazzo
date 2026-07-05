"""CLI interattiva dell'agente video/musica.

Uso:
    python -m agent.main                # sessione interattiva
    python -m agent.main "richiesta"    # esegue una singola richiesta
"""

from __future__ import annotations

import sys

import anthropic

from .agent import MODEL, turno
from .tools.common import ensure_workspace

BENVENUTO = """\
🎬🎵  Agente video & musica  (modello: {model})
Workspace: {workspace}

Esempi:
  - Scarica questo video: https://www.youtube.com/watch?v=...
  - Estrai la musica da video.mp4 e togli la voce
  - Trascrivi il testo di questa canzone: <url>
  - Trasforma in MIDI la melodia di brano.mp3

Scrivi 'esci' per uscire.
"""


def main() -> None:
    workspace = ensure_workspace()
    try:
        client = anthropic.Anthropic()
    except anthropic.AnthropicError as e:
        print(f"Impossibile inizializzare il client Anthropic: {e}")
        print("Imposta la variabile d'ambiente ANTHROPIC_API_KEY e riprova.")
        sys.exit(1)

    history: list[dict] = []

    # Modalità one-shot: richiesta passata come argomenti
    if len(sys.argv) > 1:
        turno(client, history, " ".join(sys.argv[1:]))
        return

    print(BENVENUTO.format(model=MODEL, workspace=workspace))
    while True:
        try:
            testo = input("\ntu> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nCiao!")
            break
        if not testo:
            continue
        if testo.lower() in {"esci", "exit", "quit"}:
            print("Ciao!")
            break
        try:
            turno(client, history, testo)
        except anthropic.RateLimitError:
            print("\n[Limite di richieste raggiunto: attendi qualche istante e riprova.]")
        except anthropic.APIConnectionError:
            print("\n[Errore di connessione: controlla la rete e riprova.]")
        except anthropic.APIStatusError as e:
            print(f"\n[Errore API ({e.status_code}): {e.message}]")


if __name__ == "__main__":
    main()
