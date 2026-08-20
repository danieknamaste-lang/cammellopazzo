/**
 * Interfaccia + agente per il sistema multiagentico di opzioni.
 *
 * Server HTTP senza dipendenze (solo Node ≥ 20): serve la UI statica ed espone
 * le API che pianificano, inviano e archiviano le query verso il sistema che
 * gira sul mini. Pensato per essere installato su Umbrel come container.
 *
 * Variabili d'ambiente principali:
 *   PORT                  porta del server (default 3100)
 *   MULTIAGENT_URL        indirizzo del sistema multiagentico (es. http://10.0.0.12:8000)
 *   MULTIAGENT_MODE       auto | openai | json | sse | ollama | mock (default auto)
 *   MULTIAGENT_PATH       percorso da usare, se l'autorilevamento sbaglia
 *   MULTIAGENT_TOKEN      bearer token del sistema remoto (opzionale)
 *   MULTIAGENT_MODEL      nome del modello/agente da passare al sistema remoto
 *   PLANNER               auto | anthropic | deepseek | ollama | rules
 *   ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / OLLAMA_URL  provider del pianificatore
 *   APP_TOKEN             se impostato, le API richiedono questo token
 *   DATA_DIR              cartella dei dati persistenti (default ./data)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const config = require('./lib/config');
const schema = require('./lib/schema');
const planner = require('./lib/planner');
const connector = require('./lib/connector');
const store = require('./lib/store');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Utilità HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Corpo della richiesta troppo grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('JSON non valido nel corpo della richiesta'));
      }
    });
    req.on('error', reject);
  });
}

function authorized(req, url) {
  const expected = config.current.appToken;
  if (!expected) return true;
  const header = req.headers['x-app-token'];
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const supplied = header || bearer || url.searchParams.get('token') || '';
  return supplied === expected;
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Vietato');
    return;
  }
  try {
    const data = await fsp.readFile(target);
    res.writeHead(200, {
      'content-type': MIME[path.extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Non trovato');
  }
}

// ---------------------------------------------------------------------------
// Stream SSE verso il browser
// ---------------------------------------------------------------------------

function openStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': stream aperto\n\n');
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  return {
    send(event) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      clearInterval(keepAlive);
      res.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Agente: pianifica → interroga → (eventuale) approfondimento
// ---------------------------------------------------------------------------

async function handleRun(req, res) {
  const body = await readBody(req);
  const stream = openStream(res);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const started = Date.now();
  const steps = [];
  let answer = '';

  try {
    let query;
    let planInfo = null;

    if (body.query && typeof body.query === 'object') {
      query = schema.normalizeQuery(body.query);
      if (body.text && !query.prompt) query.prompt = String(body.text).slice(0, 2000);
    } else {
      stream.send({ type: 'status', text: 'Pianifico la query…' });
      planInfo = await planner.plan(body.text || '', {});
      query = planInfo.query;
    }

    stream.send({
      type: 'query',
      query,
      summary: schema.describeQuery(query),
      source: planInfo ? planInfo.source : 'manual',
      provider: planInfo ? planInfo.provider : null,
      note: planInfo ? planInfo.note : null,
      prompt: schema.queryToPrompt(query),
    });

    const first = await connector.run(query, { emit: stream.send, signal: controller.signal });
    answer = first.text;
    steps.push({ query, answer: first.text, mode: first.mode, path: first.path });

    const wantRefine = body.refine === true && config.current.maxSteps > 1;
    if (wantRefine && !controller.signal.aborted) {
      stream.send({ type: 'status', text: 'Valuto se serve un approfondimento…' });
      const verdict = await planner.refine(query, answer);
      if (verdict.followUp) {
        stream.send({
          type: 'followup',
          query: verdict.query,
          reason: verdict.reason,
          summary: schema.describeQuery(verdict.query),
        });
        const second = await connector.run(verdict.query, { emit: stream.send, signal: controller.signal });
        answer += `\n\n---\n\n${second.text}`;
        steps.push({ query: verdict.query, answer: second.text, mode: second.mode, reason: verdict.reason });
      } else {
        stream.send({ type: 'status', text: `Nessun approfondimento: ${verdict.reason}` });
      }
    }

    const record = await store.addHistory({
      query: steps[0].query,
      summary: schema.describeQuery(steps[0].query),
      answer,
      mode: steps[0].mode,
      steps: steps.length,
      elapsed_ms: Date.now() - started,
    });

    stream.send({ type: 'done', id: record.id, elapsed_ms: Date.now() - started, steps: steps.length });
  } catch (err) {
    stream.send({ type: 'error', message: err.message || String(err) });
  } finally {
    stream.close();
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routes = {
  'GET /api/config': async (req, res) => {
    const status = await connector.status();
    sendJson(res, 200, {
      config: config.publicView(),
      connector: status,
      schema: {
        objectives: schema.OBJECTIVES,
        strategies: schema.STRATEGIES,
        metrics: schema.METRICS,
        agents: schema.AGENTS,
        sides: schema.SIDES,
        types: schema.TYPES,
        defaults: schema.DEFAULT_QUERY,
      },
    });
  },

  'GET /api/status': async (req, res, url) => {
    sendJson(res, 200, await connector.status(url.searchParams.get('refresh') === '1'));
  },

  'POST /api/plan': async (req, res) => {
    const body = await readBody(req);
    const result = await planner.plan(body.text || '', { base: body.base });
    sendJson(res, 200, {
      query: result.query,
      summary: schema.describeQuery(result.query),
      prompt: schema.queryToPrompt(result.query),
      source: result.source,
      provider: result.provider,
      model: result.model || null,
      note: result.note,
    });
  },

  'POST /api/preview': async (req, res) => {
    const body = await readBody(req);
    const query = schema.normalizeQuery(body.query);
    sendJson(res, 200, { query, summary: schema.describeQuery(query), prompt: schema.queryToPrompt(query) });
  },

  'POST /api/run': handleRun,

  'GET /api/history': async (req, res) => {
    const items = await store.listHistory();
    sendJson(res, 200, {
      items: items.map((item) => ({
        id: item.id,
        created_at: item.created_at,
        summary: item.summary,
        mode: item.mode,
        steps: item.steps,
        preview: String(item.answer || '').replace(/\s+/g, ' ').slice(0, 160),
      })),
    });
  },

  'GET /api/history/:id': async (req, res, url, params) => {
    const item = await store.getHistory(params.id);
    if (!item) return sendJson(res, 404, { error: 'Voce non trovata' });
    sendJson(res, 200, item);
  },

  'DELETE /api/history/:id': async (req, res, url, params) => {
    const left = await store.deleteHistory(params.id);
    sendJson(res, 200, { ok: true, left });
  },

  'GET /api/presets': async (req, res) => {
    sendJson(res, 200, { items: await store.listPresets() });
  },

  'POST /api/presets': async (req, res) => {
    const body = await readBody(req);
    const record = await store.addPreset(body.name, schema.normalizeQuery(body.query));
    sendJson(res, 200, record);
  },

  'DELETE /api/presets/:id': async (req, res, url, params) => {
    await store.deletePreset(params.id);
    sendJson(res, 200, { ok: true });
  },

  'POST /api/settings': async (req, res) => {
    const body = await readBody(req);
    await store.saveSettings(body);
    const status = await connector.status(true);
    sendJson(res, 200, { config: config.publicView(), connector: status });
  },
};

function matchRoute(method, pathname) {
  const key = `${method} ${pathname}`;
  if (routes[key]) return { handler: routes[key], params: {} };

  for (const route of Object.keys(routes)) {
    const [routeMethod, routePath] = route.split(' ');
    if (routeMethod !== method || !routePath.includes(':')) continue;
    const routeParts = routePath.split('/');
    const pathParts = pathname.split('/');
    if (routeParts.length !== pathParts.length) continue;
    const params = {};
    const ok = routeParts.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        return true;
      }
      return part === pathParts[i];
    });
    if (ok) return { handler: routes[route], params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  if (!authorized(req, url)) return sendJson(res, 401, { error: 'Token applicativo mancante o errato' });

  const match = matchRoute(req.method, pathname);
  if (!match) return sendJson(res, 404, { error: 'Endpoint sconosciuto' });

  try {
    await match.handler(req, res, url, match.params);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message || String(err) });
    else res.end();
  }
});

async function start() {
  await store.ensureDir();
  await store.loadSettings();
  await new Promise((resolve) => {
    server.listen(config.current.port, config.current.host, () => {
      const status = config.current.multiagent.url || 'non configurato (modalità simulazione)';
      console.log(`Agente opzioni in ascolto su http://${config.current.host}:${server.address().port}`);
      console.log(`Sistema multiagentico: ${status}`);
      console.log(`Dati persistenti in: ${config.current.dataDir}`);
      resolve();
    });
  });
  return server;
}

if (require.main === module) start();

module.exports = { server, start };
