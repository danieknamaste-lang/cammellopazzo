#!/bin/bash
# Wrapper avviato da launchd (com.glm.litellm).
#
# Perché esiste: launchd NON eredita l'ambiente della shell (niente PATH, niente
# export del .zshrc). Questo script carica i segreti da ~/.glm-proxy/env, che è
# l'unico file con permessi 600, ed esegue litellm con percorso assoluto.

set -euo pipefail

GLM_HOME="${GLM_HOME:-$HOME/.glm-proxy}"
ENV_FILE="$GLM_HOME/env"
CONFIG_FILE="$GLM_HOME/config.yaml"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [[ ! -f "$ENV_FILE" ]]; then
    log "ERRORE: manca $ENV_FILE. Esegui install.sh."
    exit 1
fi

# shellcheck source=/dev/null
set -a
source "$ENV_FILE"
set +a

if [[ -z "${NOUS_API_KEY:-}" ]]; then
    log "ERRORE: NOUS_API_KEY non impostata in $ENV_FILE."
    exit 1
fi

if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
    log "ERRORE: LITELLM_MASTER_KEY non impostata in $ENV_FILE."
    exit 1
fi

# Percorso del binario: quello salvato da install.sh, con fallback alla ricerca.
LITELLM_BIN="${LITELLM_BIN:-}"
if [[ -z "$LITELLM_BIN" || ! -x "$LITELLM_BIN" ]]; then
    export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
    LITELLM_BIN="$(command -v litellm || true)"
fi

if [[ -z "$LITELLM_BIN" ]]; then
    log "ERRORE: binario 'litellm' non trovato. Reinstalla con: uv tool install 'litellm[proxy]'"
    exit 1
fi

GLM_HOST="${GLM_HOST:-0.0.0.0}"
GLM_PORT="${GLM_PORT:-4000}"

# ATTENZIONE - NON RIMUOVERE.
# Senza questo flag LiteLLM instrada le richieste Anthropic /v1/messages verso
# /v1/responses (OpenAI Responses API) per qualunque modello con prefisso
# "openai/", perché _RESPONSES_API_PROVIDERS = {"openai"}. Nous espone solo
# /v1/chat/completions: il risultato è che OGNI richiesta fallisce.
# Verificato su LiteLLM 1.100.1.
#
# Nota: LiteLLM legge questa variabile con bool(os.getenv(...)), quindi
# QUALSIASI valore non vuoto la attiva — anche la stringa "False".
# Per disattivarla bisogna svuotarla o rimuoverla, non metterla a "False".
export LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES="${LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES:-True}"

log "Avvio LiteLLM ($LITELLM_BIN) su ${GLM_HOST}:${GLM_PORT} con $CONFIG_FILE"

exec "$LITELLM_BIN" \
    --config "$CONFIG_FILE" \
    --host "$GLM_HOST" \
    --port "$GLM_PORT"
