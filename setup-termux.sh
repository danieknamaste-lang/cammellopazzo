#!/usr/bin/env bash
#
# setup-termux.sh — prepara Termux (Android) con Codex CLI + Claude Code + il bridge.
# Da eseguire dentro Termux: bash setup-termux.sh
#
set -euo pipefail

echo "==> Aggiorno i pacchetti Termux..."
pkg update -y
pkg install -y nodejs-lts git ripgrep

echo "==> Installo Claude Code..."
npm install -g @anthropic-ai/claude-code

if ! command -v codex >/dev/null 2>&1; then
  echo "==> Installo Codex CLI..."
  npm install -g @openai/codex || {
    echo "!! Installazione di Codex CLI fallita." >&2
    echo "!! Il binario nativo di Codex a volte non gira su Termux 'puro' (bionic libc)." >&2
    echo "!! In quel caso usa un Linux completo dentro Termux:" >&2
    echo "!!   pkg install proot-distro && proot-distro install ubuntu && proot-distro login ubuntu" >&2
    echo "!! e rilancia questo script lì dentro." >&2
  }
fi

echo "==> Aggiungo gli script del bridge al PATH..."
HERE="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$HERE/bin/claude-review" "$HERE/bin/codex-claude-bridge" "$HERE/hooks/post-commit"

PROFILE="$HOME/.bashrc"
LINE="export PATH=\"$HERE/bin:\$PATH\""
if ! grep -qsF "$LINE" "$PROFILE"; then
  echo "$LINE" >>"$PROFILE"
  echo "   Aggiunto al PATH in $PROFILE (riapri la shell o esegui: source $PROFILE)"
fi

echo ""
echo "==> Fatto! Prossimi passi:"
echo "   1. claude          # primo avvio: fai il login con il tuo account Anthropic"
echo "   2. codex           # primo avvio: fai il login con il tuo account OpenAI"
echo "   3. cd <tuo-progetto> && claude-review   # prova il bridge"
