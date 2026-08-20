# Immagine dell'agente opzioni: nessuna dipendenza npm, solo Node.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3100 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3100
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
