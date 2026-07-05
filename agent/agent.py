"""Loop agentico: Claude + tool per video, musica e trascrizioni."""

from __future__ import annotations

import json

import anthropic

from .tools import ALL_HANDLERS, ALL_TOOLS
from .tools.common import WORKSPACE

MODEL = "claude-opus-4-8"
MAX_TOKENS = 16000
MAX_ITERAZIONI = 25  # limite di sicurezza per un singolo turno

SYSTEM_PROMPT = f"""Sei un agente esperto di video e musica. Parli in italiano \
(o nella lingua dell'utente) e lavori sui file dentro il workspace: {WORKSPACE}

Cosa sai fare con i tool a disposizione:
- scaricare video o solo audio da YouTube e da migliaia di altre piattaforme;
- cercare video su YouTube quando l'utente indica un titolo invece di un URL;
- estrarre l'audio da un video, togliere l'audio, tagliare, convertire, \
sostituire la traccia audio;
- separare la musica nelle sue sorgenti con Demucs (voce, batteria, basso, \
altro) o in modalità karaoke (voce + base strumentale);
- trascrivere parlato e testi cantati con Whisper (testo + sottotitoli .srt);
- trascrivere le note musicali in MIDI con basic-pitch.

Linee guida:
- Concatena i tool da solo quando serve (es. "dammi il testo di questa \
canzone da YouTube" = scarica solo audio -> separa voce in modalità karaoke \
-> trascrivi la voce). Non chiedere conferma per i passi intermedi ovvi.
- I file di lavoro restano nel workspace: alla fine indica sempre i percorsi \
dei file prodotti.
- Le operazioni di separazione e trascrizione possono essere lente: avvisa \
l'utente prima di lanciarle su file lunghi.
- Se un tool fallisce, leggi il messaggio di errore e prova un'alternativa \
ragionevole o spiega chiaramente cosa manca (es. dipendenza non installata).
- Rispetta il copyright: aiuta l'utente su contenuti che ha il diritto di \
usare; per richieste chiaramente illecite, spiega i limiti."""


def _esegui_tool(name: str, args: dict) -> tuple[str, bool]:
    """Esegue un tool e restituisce (risultato, is_error)."""
    handler = ALL_HANDLERS.get(name)
    if handler is None:
        return f"Tool sconosciuto: {name}", True
    try:
        result = handler(**args)
    except TypeError as e:
        return f"Parametri non validi per {name}: {e}", True
    except Exception as e:  # i tool gestiscono già i propri errori: qui solo imprevisti
        return f"Errore imprevisto in {name}: {e}", True
    try:
        is_error = json.loads(result).get("esito") == "errore"
    except (json.JSONDecodeError, AttributeError):
        is_error = False
    return result, is_error


def turno(client: anthropic.Anthropic, history: list[dict], testo_utente: str) -> str:
    """Esegue un turno completo: messaggio utente -> tool -> risposta finale.

    Aggiorna `history` sul posto e restituisce il testo finale dell'assistente.
    Il testo viene anche stampato in streaming man mano che arriva.
    """
    history.append({"role": "user", "content": testo_utente})

    for _ in range(MAX_ITERAZIONI):
        with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            thinking={"type": "adaptive"},
            tools=ALL_TOOLS,
            messages=history,
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
            response = stream.get_final_message()

        if response.stop_reason == "refusal":
            msg = "\n[La richiesta è stata rifiutata per motivi di sicurezza.]"
            print(msg)
            history.append({"role": "assistant", "content": "Richiesta rifiutata."})
            return msg

        history.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "pause_turn":
            continue  # il server riprende da solo alla richiesta successiva

        if response.stop_reason != "tool_use":
            break

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            print(f"\n[tool: {block.name}] ", end="", flush=True)
            result, is_error = _esegui_tool(block.name, dict(block.input))
            print("errore" if is_error else "ok", flush=True)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result,
                "is_error": is_error,
            })
        history.append({"role": "user", "content": tool_results})
    else:
        avviso = "\n[Interrotto: raggiunto il numero massimo di passi per questo turno.]"
        print(avviso)
        return avviso

    print()
    return next((b.text for b in response.content if b.type == "text"), "")
