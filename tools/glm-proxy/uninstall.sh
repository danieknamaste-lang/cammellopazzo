#!/bin/bash
# Rimuove il servizio proxy GLM-5.3.
#
# Uso:
#   ./uninstall.sh          ferma e scarica il servizio, lascia ~/.glm-proxy
#   ./uninstall.sh --purge  rimuove anche ~/.glm-proxy (chiavi comprese)

set -euo pipefail

LABEL="com.glm.litellm"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
GLM_HOME="${GLM_HOME:-$HOME/.glm-proxy}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
say() { printf "${BLUE}==>${NC} %s\n" "$1"; }
ok()  { printf "${GREEN}  ok${NC}  %s\n" "$1"; }

say "Fermo il servizio"
launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 \
    || launchctl unload -w "$PLIST_DEST" >/dev/null 2>&1 \
    || true
ok "servizio fermato"

if [[ -f "$PLIST_DEST" ]]; then
    rm -f "$PLIST_DEST"
    ok "plist rimosso"
fi

if [[ "${1:-}" == "--purge" ]]; then
    rm -rf "$GLM_HOME"
    ok "rimossa $GLM_HOME (chiavi incluse)"
else
    ok "conservata $GLM_HOME — usa --purge per eliminarla"
fi

printf "\n${GREEN}Disinstallazione completata.${NC}\n\n"
