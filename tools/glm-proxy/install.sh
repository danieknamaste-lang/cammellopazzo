#!/bin/bash
# Installa il proxy GLM-5.3 (LiteLLM -> Nous Research) come servizio always-on
# su macOS tramite launchd, poi verifica end-to-end che funzioni.
#
# Uso:
#   ./install.sh
#   NOUS_API_KEY=xxx ./install.sh        # non interattivo
#
# Idempotente: rieseguirlo aggiorna la configurazione MANTENENDO la master key
# già in uso (così gli alias sui client non vanno rifatti).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GLM_HOME="${GLM_HOME:-$HOME/.glm-proxy}"
ENV_FILE="$GLM_HOME/env"
LABEL="com.glm.litellm"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
NOUS_API_BASE="${NOUS_API_BASE:-https://inference-api.nousresearch.com/v1}"
GLM_PORT="${GLM_PORT:-4000}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; DIM='\033[2m'; NC='\033[0m'

say()  { printf "${BLUE}==>${NC} %s\n" "$1"; }
ok()   { printf "${GREEN}  ok${NC}  %s\n" "$1"; }
warn() { printf "${YELLOW}  !!${NC}  %s\n" "$1"; }
die()  { printf "${RED} ERR${NC}  %s\n" "$1" >&2; exit 1; }
info() { printf "${DIM}      %s${NC}\n" "$1"; }

printf "\n${BLUE}### Installazione proxy GLM-5.3 (Nous Research) ###${NC}\n\n"

# ------------------------------------------------------------- 1. preflight
say "Controllo prerequisiti"

[[ "$(uname -s)" == "Darwin" ]] || die "Questo installer è per macOS (launchd). Sistema rilevato: $(uname -s)"
ok "macOS rilevato"

command -v curl >/dev/null 2>&1 || die "curl non trovato"
command -v python3 >/dev/null 2>&1 || die "python3 non trovato — installa gli Xcode Command Line Tools: xcode-select --install"
ok "curl e python3 presenti"

# ------------------------------------------------------ 2. binario litellm
say "Cerco il binario litellm"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LITELLM_BIN="$(command -v litellm || true)"

if [[ -z "$LITELLM_BIN" ]]; then
    warn "litellm non trovato"
    if command -v uv >/dev/null 2>&1; then
        say "Installo litellm con uv..."
        uv tool install 'litellm[proxy]' || die "installazione con uv fallita"
    elif command -v pip3 >/dev/null 2>&1; then
        say "Installo litellm con pip3..."
        pip3 install --user 'litellm[proxy]' || die "installazione con pip3 fallita"
    else
        die "Né uv né pip3 disponibili. Installa uv:  curl -LsSf https://astral.sh/uv/install.sh | sh"
    fi
    hash -r
    LITELLM_BIN="$(command -v litellm || true)"
    [[ -n "$LITELLM_BIN" ]] || die "litellm ancora non trovato nel PATH dopo l'installazione"
fi
ok "litellm: $LITELLM_BIN"

# --------------------------------------------------------- 3. cartelle
say "Preparo $GLM_HOME"
mkdir -p "$GLM_HOME/logs"
chmod 700 "$GLM_HOME"
ok "cartella pronta"

# ------------------------------------------------- 4. segreti (idempotente)
say "Configuro le chiavi"

EXISTING_MASTER_KEY=""
EXISTING_NOUS_KEY=""
if [[ -f "$ENV_FILE" ]]; then
    EXISTING_MASTER_KEY="$(grep -E '^LITELLM_MASTER_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
    EXISTING_NOUS_KEY="$(grep -E '^NOUS_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi

# Chiave Nous: variabile d'ambiente > file esistente > prompt
NOUS_KEY="${NOUS_API_KEY:-$EXISTING_NOUS_KEY}"
if [[ -z "$NOUS_KEY" ]]; then
    printf "    Incolla la tua chiave API Nous Research (input nascosto): "
    read -r -s NOUS_KEY
    printf "\n"
    [[ -n "$NOUS_KEY" ]] || die "chiave Nous vuota"
    ok "chiave Nous acquisita"
elif [[ -n "${NOUS_API_KEY:-}" ]]; then
    ok "chiave Nous presa dall'ambiente"
else
    ok "chiave Nous riutilizzata da $ENV_FILE"
fi

# Master key locale: NON rigenerarla se esiste già, altrimenti si rompono i client
if [[ -n "$EXISTING_MASTER_KEY" ]]; then
    MASTER_KEY="$EXISTING_MASTER_KEY"
    ok "master key esistente conservata (i client restano validi)"
else
    MASTER_KEY="sk-glm-$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
    ok "nuova master key generata"
fi

# -------------------------------------------- 5. rilevo i model ID su Nous
say "Interrogo il catalogo Nous per gli ID reali di GLM-5.3"

GLM_MAIN="glm-5.3"
GLM_FLASH="glm-5.3-flash"

models_raw="$(curl -sS --max-time 20 "${NOUS_API_BASE}/models" \
    -H "Authorization: Bearer ${NOUS_KEY}" 2>/dev/null || true)"

if [[ -z "$models_raw" ]]; then
    warn "catalogo non raggiungibile — uso gli ID di default ($GLM_MAIN / $GLM_FLASH)"
else
    detected="$(printf '%s' "$models_raw" | python3 -c '
import json, sys, re
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
items = data.get("data", data if isinstance(data, list) else [])
ids = [m.get("id", "") for m in items if isinstance(m, dict)]
glm = [i for i in ids if re.search(r"glm[-_]?5[._]3", i, re.I)]
flash = [i for i in glm if re.search(r"flash", i, re.I)]
main  = [i for i in glm if not re.search(r"flash", i, re.I)]
print((main[0] if main else "") + "|" + (flash[0] if flash else ""))
' 2>/dev/null || true)"

    if [[ -n "$detected" ]]; then
        d_main="${detected%%|*}"; d_flash="${detected##*|}"
        [[ -n "$d_main"  ]] && GLM_MAIN="$d_main"
        [[ -n "$d_flash" ]] && GLM_FLASH="$d_flash"
    fi

    if [[ "$detected" == "|" || -z "$detected" ]]; then
        warn "nessun modello GLM-5.3 trovato nel catalogo Nous"
        info "modelli disponibili (primi 15):"
        printf '%s' "$models_raw" | python3 -c '
import json,sys
try: data=json.load(sys.stdin)
except Exception: sys.exit(0)
items=data.get("data", data if isinstance(data,list) else [])
for m in items[:15]:
    if isinstance(m,dict): print("        -", m.get("id",""))
' 2>/dev/null || true
        info "procedo comunque con i default; se sbagliati, correggi $GLM_HOME/config.yaml"
    else
        ok "modello principale: $GLM_MAIN"
        if [[ "$GLM_FLASH" == "glm-5.3-flash" && "$detected" == *"|" ]]; then
            warn "variante flash non trovata su Nous — mappo il tier haiku su $GLM_MAIN"
            GLM_FLASH="$GLM_MAIN"
        else
            ok "modello flash: $GLM_FLASH"
        fi
    fi
fi

# ------------------------------------------------------- 6. scrivo i file
say "Scrivo configurazione e segreti"

sed -e "s|__GLM_MAIN__|${GLM_MAIN}|g" \
    -e "s|__GLM_FLASH__|${GLM_FLASH}|g" \
    -e "s|__NOUS_API_BASE__|${NOUS_API_BASE}|g" \
    "$SCRIPT_DIR/config.yaml.template" > "$GLM_HOME/config.yaml"
ok "config.yaml generato"

umask 077
cat > "$ENV_FILE" <<EOF
# Generato da install.sh — NON committare questo file.
NOUS_API_KEY=${NOUS_KEY}
LITELLM_MASTER_KEY=${MASTER_KEY}
LITELLM_BIN=${LITELLM_BIN}
GLM_HOST=0.0.0.0
GLM_PORT=${GLM_PORT}

# Obbligatorio: forza /v1/messages su /v1/chat/completions invece che sul
# Responses API, che Nous non espone. Senza, ogni richiesta fallisce.
LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES=True
EOF
chmod 600 "$ENV_FILE"
ok "env scritto con permessi 600"

cp "$SCRIPT_DIR/run.sh" "$GLM_HOME/run.sh"
cp "$SCRIPT_DIR/healthcheck.sh" "$GLM_HOME/healthcheck.sh"
chmod +x "$GLM_HOME/run.sh" "$GLM_HOME/healthcheck.sh"
ok "script copiati"

# ------------------------------------------------------ 7. servizio launchd
say "Installo il servizio launchd"

mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__GLM_HOME__|${GLM_HOME}|g" \
    "$SCRIPT_DIR/com.glm.litellm.plist.template" > "$PLIST_DEST"
ok "plist installato in $PLIST_DEST"

# Scarico un'eventuale istanza precedente (ignora errori se non caricata)
launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
sleep 1

if launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null; then
    ok "servizio avviato (bootstrap)"
elif launchctl load -w "$PLIST_DEST" 2>/dev/null; then
    ok "servizio avviato (load legacy)"
else
    die "impossibile caricare il servizio in launchd"
fi

launchctl enable "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true

# ------------------------------------------------------ 8. attendo l'avvio
say "Attendo che il proxy risponda (max 90s)"
ready=0
for i in $(seq 1 45); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${GLM_PORT}/health/liveliness" >/dev/null 2>&1 \
       || curl -sS --max-time 3 -o /dev/null "http://127.0.0.1:${GLM_PORT}/" 2>/dev/null; then
        ready=1; break
    fi
    printf "."
    sleep 2
done
printf "\n"

if [[ $ready -eq 1 ]]; then
    ok "proxy attivo su porta ${GLM_PORT}"
else
    warn "il proxy non risponde ancora"
    info "ultimi errori:"
    tail -n 20 "$GLM_HOME/logs/litellm.err.log" 2>/dev/null | sed 's/^/      /' || true
fi

# --------------------------------------------------------- 9. healthcheck
printf "\n${BLUE}### Verifica end-to-end ###${NC}\n"
set +e
bash "$GLM_HOME/healthcheck.sh" 127.0.0.1
HEALTH_RC=$?
set -e

# ------------------------------------------------- 10. istruzioni client
LAN_IP=""
for iface in en0 en1 en2; do
    LAN_IP="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [[ -n "$LAN_IP" ]] && break
done
[[ -n "$LAN_IP" ]] || LAN_IP="IP-DEL-MINI"
HOSTNAME_LOCAL="$(scutil --get LocalHostName 2>/dev/null || echo mini).local"

printf "\n${BLUE}### Configurazione client ###${NC}\n\n"
cat <<EOF
Sul MINI il servizio è già attivo e riparte da solo al riavvio.

Per usarlo da QUESTO Mini, aggiungi a ~/.zshrc:

  export LITELLM_MASTER_KEY="${MASTER_KEY}"
  claude-glm() {
    env ANTHROPIC_BASE_URL="http://127.0.0.1:${GLM_PORT}" \\
        ANTHROPIC_AUTH_TOKEN="\$LITELLM_MASTER_KEY" \\
        ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.3" \\
        ANTHROPIC_DEFAULT_SONNET_MODEL="glm-5.3" \\
        ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-5.3-flash" \\
        claude "\$@"
  }

Per usarlo dal PORTATILE (stessa LAN), aggiungi al suo ~/.zshrc:

  export LITELLM_MASTER_KEY="${MASTER_KEY}"
  claude-glm() {
    env ANTHROPIC_BASE_URL="http://${LAN_IP}:${GLM_PORT}" \\
        ANTHROPIC_AUTH_TOKEN="\$LITELLM_MASTER_KEY" \\
        ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.3" \\
        ANTHROPIC_DEFAULT_SONNET_MODEL="glm-5.3" \\
        ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-5.3-flash" \\
        claude "\$@"
  }

  (se l'IP cambia, usa: http://${HOSTNAME_LOCAL}:${GLM_PORT})

Comandi utili:
  Log in tempo reale   tail -f ${GLM_HOME}/logs/litellm.err.log
  Ritestare            ${GLM_HOME}/healthcheck.sh
  Test dal portatile   ${GLM_HOME}/healthcheck.sh ${LAN_IP}
  Riavviare            launchctl kickstart -k gui/\$(id -u)/${LABEL}
  Disinstallare        ${SCRIPT_DIR}/uninstall.sh

SICUREZZA: il proxy ascolta sulla LAN. NON aprire la porta ${GLM_PORT} sul router.
EOF

printf "\n"
if [[ $HEALTH_RC -eq 0 ]]; then
    printf "${GREEN}### Installazione completata e verificata ###${NC}\n\n"
else
    printf "${YELLOW}### Installato, ma alcuni test sono falliti — vedi sopra ###${NC}\n\n"
fi
exit $HEALTH_RC
