#!/bin/sh
# Umbrel monta ${APP_DATA_DIR}/data su /data e la cartella nasce di root:root,
# mentre il server gira come utente "node": qui sistemiamo la proprietà e poi
# lasciamo i privilegi. Se non siamo root (compose con user: già impostato),
# si parte e basta.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" 2>/dev/null || echo "avviso: impossibile cambiare proprietario di $DATA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
