#!/bin/bash
# Test end-to-end del proxy GLM-5.3.
#
# Verifica in ordine: servizio launchd -> porta -> catalogo modelli ->
# vera chiamata di inferenza a GLM via Nous.
#
# Uso:  ./healthcheck.sh [host]      (default: 127.0.0.1)
# Exit: 0 = tutto ok, 1 = almeno un test fallito.

set -uo pipefail

GLM_HOME="${GLM_HOME:-$HOME/.glm-proxy}"
ENV_FILE="$GLM_HOME/env"
HOST="${1:-127.0.0.1}"
LABEL="com.glm.litellm"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; DIM='\033[2m'; NC='\033[0m'
FAILED=0

pass() { printf "${GREEN}  PASS${NC}  %s\n" "$1"; }
fail() { printf "${RED}  FAIL${NC}  %s\n" "$1"; FAILED=1; }
warn() { printf "${YELLOW}  WARN${NC}  %s\n" "$1"; }
info() { printf "${DIM}        %s${NC}\n" "$1"; }
step() { printf "\n%s\n" "$1"; }

if [[ -f "$ENV_FILE" ]]; then
    set -a; source "$ENV_FILE"; set +a
fi

GLM_PORT="${GLM_PORT:-4000}"
BASE="http://${HOST}:${GLM_PORT}"

printf "\n=== Healthcheck proxy GLM-5.3 — %s ===\n" "$BASE"

# ---------------------------------------------------------------- 1. launchd
step "1. Servizio launchd"
if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
    info "host remoto: salto il controllo launchd locale"
elif ! command -v launchctl >/dev/null 2>&1; then
    info "launchctl non disponibile (non sei su macOS): salto"
elif launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    pid=$(launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | awk '/^\tpid = /{print $3}')
    if [[ -n "$pid" ]]; then
        pass "servizio caricato e in esecuzione (pid $pid)"
    else
        fail "servizio caricato ma NON in esecuzione — vedi $GLM_HOME/logs/litellm.err.log"
    fi
else
    fail "servizio '$LABEL' non caricato in launchd — esegui install.sh"
fi

# ------------------------------------------------------------------- 2. porta
step "2. Porta $GLM_PORT raggiungibile"
if curl -fsS --max-time 5 "${BASE}/health/liveliness" >/dev/null 2>&1 \
   || curl -fsS --max-time 5 "${BASE}/health/readiness" >/dev/null 2>&1 \
   || curl -sS --max-time 5 -o /dev/null "${BASE}/" 2>/dev/null; then
    pass "il proxy risponde su ${BASE}"
else
    fail "nessuna risposta da ${BASE}"
    info "controlla i log: tail -f $GLM_HOME/logs/litellm.err.log"
    printf "\n${RED}Test interrotto: il proxy non risponde.${NC}\n\n"
    exit 1
fi

# ------------------------------------------------------------- 3. master key
step "3. Autenticazione e catalogo modelli"
if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
    fail "LITELLM_MASTER_KEY non trovata in $ENV_FILE"
else
    models_json=$(curl -sS --max-time 15 "${BASE}/v1/models" \
        -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" 2>/dev/null)

    if echo "$models_json" | grep -q '"glm-5.3"'; then
        pass "master key valida, modello 'glm-5.3' esposto"
    elif echo "$models_json" | grep -qi 'authentication\|invalid.*key\|401'; then
        fail "master key rifiutata dal proxy"
    else
        fail "modello 'glm-5.3' non presente nel catalogo del proxy"
        info "risposta: $(echo "$models_json" | head -c 300)"
    fi

    if echo "$models_json" | grep -q '"glm-5.3-flash"'; then
        pass "modello 'glm-5.3-flash' esposto (tier haiku economico)"
    else
        warn "'glm-5.3-flash' non esposto — i task di background useranno glm-5.3"
    fi
fi

# ------------------------------------------------- 4. vera inferenza Anthropic
step "4. Inferenza reale su GLM-5.3 (formato Anthropic /v1/messages)"
if [[ -n "${LITELLM_MASTER_KEY:-}" ]]; then
    resp=$(curl -sS --max-time 120 "${BASE}/v1/messages" \
        -H "x-api-key: ${LITELLM_MASTER_KEY}" \
        -H "anthropic-version: 2023-06-01" \
        -H "content-type: application/json" \
        -d '{
              "model": "glm-5.3",
              "max_tokens": 64,
              "messages": [
                {"role": "user", "content": "Rispondi esattamente con la parola: FUNZIONA"}
              ]
            }' 2>/dev/null)

    if echo "$resp" | grep -qi 'FUNZIONA'; then
        pass "GLM-5.3 ha risposto correttamente attraverso il proxy"
        info "catena verificata: Claude Code -> LiteLLM -> Nous -> GLM-5.3"
    elif echo "$resp" | grep -q '"content"'; then
        pass "GLM-5.3 ha risposto (testo diverso dall'atteso, ma la catena funziona)"
        info "risposta: $(echo "$resp" | head -c 300)"
    else
        fail "nessuna risposta valida dal modello"
        info "risposta: $(echo "$resp" | head -c 500)"
        info "causa tipica: NOUS_API_KEY errata, credito esaurito, o model ID sbagliato in config.yaml"
    fi
else
    fail "impossibile testare: manca la master key"
fi

# -------------------------------------------------------------------- esito
printf "\n"
if [[ $FAILED -eq 0 ]]; then
    printf "${GREEN}=== TUTTO OK — il proxy è operativo ===${NC}\n\n"
else
    printf "${RED}=== ALCUNI TEST FALLITI ===${NC}\n"
    printf "Log del servizio: %s/logs/litellm.err.log\n\n" "$GLM_HOME"
fi
exit $FAILED
