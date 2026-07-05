"""Registro dei tool dell'agente: schemi per l'API e funzioni di esecuzione."""

from . import download, media, separation, transcribe

ALL_TOOLS = [
    *download.TOOLS,
    *media.TOOLS,
    *separation.TOOLS,
    *transcribe.TOOLS,
]

ALL_HANDLERS = {
    **download.HANDLERS,
    **media.HANDLERS,
    **separation.HANDLERS,
    **transcribe.HANDLERS,
}
