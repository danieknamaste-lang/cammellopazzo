"""Utility condivise dai tool: workspace e validazione dei percorsi."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

WORKSPACE = Path(os.environ.get("AGENT_WORKSPACE", "workspace")).resolve()


def ensure_workspace() -> Path:
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    return WORKSPACE


def resolve_path(percorso: str, must_exist: bool = True) -> Path:
    """Risolve un percorso dentro il workspace.

    I percorsi relativi sono interpretati rispetto al workspace; quelli
    assoluti sono accettati solo se restano dentro il workspace, per evitare
    che il modello legga o scriva file arbitrari sul sistema.
    """
    ensure_workspace()
    p = Path(percorso)
    if not p.is_absolute():
        p = WORKSPACE / p
    p = p.resolve()
    if not p.is_relative_to(WORKSPACE):
        raise ValueError(
            f"Percorso fuori dal workspace ({WORKSPACE}): {percorso}"
        )
    if must_exist and not p.exists():
        raise FileNotFoundError(f"File non trovato: {p.relative_to(WORKSPACE)}")
    return p


def rel(p: Path) -> str:
    """Percorso relativo al workspace, per output leggibili."""
    try:
        return str(p.relative_to(WORKSPACE))
    except ValueError:
        return str(p)


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(
            f"Il programma '{name}' non è installato o non è nel PATH. "
            f"Installalo per usare questo strumento."
        )
    return path


def run_command(cmd: list[str], timeout: int = 3600) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, check=False
    )


def ok(**payload) -> str:
    return json.dumps({"esito": "ok", **payload}, ensure_ascii=False)


def errore(messaggio: str) -> str:
    return json.dumps({"esito": "errore", "messaggio": messaggio}, ensure_ascii=False)
