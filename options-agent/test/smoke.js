/**
 * Test di fumo, senza dipendenze: `node test/smoke.js`
 *
 * Avvia un finto sistema multiagentico, poi il server dell'agente, e verifica
 * il giro completo: rilevamento endpoint → pianificazione → invio → storico.
 */

'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'options-agent-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.MULTIAGENT_MODE = 'auto';

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(`✓ ${name}`))
    .catch((err) => {
      results.push(`✗ ${name}: ${err.message}`);
      process.exitCode = 1;
    });
}

// Finto sistema multiagentico: /openapi.json + POST /query in NDJSON.
const fake = http.createServer((req, res) => {
  if (req.url === '/openapi.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ paths: { '/query': {} } }));
  }
  if (req.url === '/query' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(JSON.stringify({ agent: 'quant', content: 'greche calcolate. ' }) + '\n');
      res.write(JSON.stringify({ answer: `ricevuto ${parsed.structured_query.underlyings.join(',')}` }) + '\n');
      res.end();
    });
    return;
  }
  res.writeHead(404).end();
});

async function main() {
  await new Promise((r) => fake.listen(0, r));
  process.env.MULTIAGENT_URL = `http://127.0.0.1:${fake.address().port}`;

  const schema = require('../lib/schema');
  const connector = require('../lib/connector');
  const planner = require('../lib/planner');
  const { server, start } = require('../server');

  await start();
  const base = `http://127.0.0.1:${server.address().port}`;

  await check('lo schema normalizza la query', () => {
    const query = schema.normalizeQuery({ underlying: 'nvda', horizon: { dte: '30' }, strategy: 'iron_condor' });
    assert.deepStrictEqual(query.underlyings, ['NVDA']);
    assert.strictEqual(query.horizon.dte, 30);
    assert.ok(schema.queryToPrompt(query).includes('Iron condor'));
  });

  await check('il connettore rileva l\'endpoint del sistema', async () => {
    const status = await connector.status(true);
    assert.strictEqual(status.mode, 'json');
    assert.strictEqual(status.path, '/query');
    assert.ok(status.ok);
  });

  await check('il pianificatore estrae i campi dal testo', async () => {
    const result = await planner.plan('iron condor su NVDA a 30 giorni, rischio massimo 500 euro');
    assert.deepStrictEqual(result.query.underlyings, ['NVDA']);
    assert.strictEqual(result.query.strategy, 'iron_condor');
    assert.strictEqual(result.query.horizon.dte, 30);
    assert.strictEqual(result.query.constraints.max_risk, 500);
  });

  await check('le regole leggono ticker minuscoli e livello di rischio', async () => {
    const rules = require('../lib/rules');
    const wheel = schema.normalizeQuery(rules.extract('Crea un wheel strategy per spcx con basso rischio'));
    assert.deepStrictEqual(wheel.underlyings, ['SPCX']);
    assert.strictEqual(wheel.strategy, 'wheel');
    assert.strictEqual(wheel.risk_profile, 'conservativo');

    const credito = schema.normalizeQuery(rules.extract('Cerca put spread in credito su SPY'));
    assert.strictEqual(credito.strategy, 'bull_put_spread');

    // le parole comuni dopo una preposizione non devono diventare sottostanti
    const generico = schema.normalizeQuery(rules.extract('una strategia su questo titolo con rischio contenuto'));
    assert.deepStrictEqual(generico.underlyings, []);
    assert.strictEqual(generico.risk_profile, 'conservativo');
  });

  await check('/api/config espone schema e stato', async () => {
    const data = await (await fetch(`${base}/api/config`)).json();
    assert.ok(data.schema.strategies.length > 5);
    assert.ok(data.connector.ok);
  });

  let historyId = null;
  await check('/api/run pianifica, interroga e trasmette', async () => {
    const res = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'iron condor su NVDA a 30 giorni' }),
    });
    const events = [];
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5)));
        }
      }
    }
    const types = events.map((e) => e.type);
    assert.ok(types.includes('query'), 'manca l\'evento query');
    assert.ok(types.includes('agent'), 'manca l\'evento agent');
    assert.ok(types.includes('done'), 'manca l\'evento done');
    const text = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
    assert.ok(text.includes('ricevuto NVDA'), `risposta inattesa: ${text}`);
    historyId = events.find((e) => e.type === 'done').id;
  });

  await check('lo storico conserva la query', async () => {
    const data = await (await fetch(`${base}/api/history/${historyId}`)).json();
    assert.strictEqual(data.query.strategy, 'iron_condor');
    assert.ok(data.answer.includes('ricevuto NVDA'));
  });

  await check('/api/diagnostics riassume stato ed errori', async () => {
    await fetch(`${base}/api/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where: 'test', message: 'errore finto' }),
    });
    const report = await (await fetch(`${base}/api/diagnostics`)).json();
    assert.ok(report.collegamento.ok, 'il collegamento doveva risultare ok');
    assert.ok(report.storage, 'manca lo stato dello storage');
    assert.ok(report.errori_recenti.some((e) => e.message === 'errore finto'), 'errore non registrato');
    assert.strictEqual(report.ambiente.ANTHROPIC_API_KEY, null);
    assert.ok(!JSON.stringify(report).includes(process.env.MULTIAGENT_TOKEN || '\u0000'), 'segreto trapelato');
  });

  await check('una cartella dati non scrivibile non fa morire l\'app', async () => {
    if (process.getuid && process.getuid() === 0) return; // da root i permessi non si applicano
    const locked = fs.mkdtempSync(path.join(os.tmpdir(), 'options-agent-locked-'));
    fs.chmodSync(locked, 0o555);
    const store = require('../lib/store');
    const { current } = require('../lib/config');
    const previous = current.dataDir;
    current.dataDir = locked;
    try {
      const status = await store.ensureDir();
      assert.ok(status.reason, 'doveva segnalare il problema');
      assert.strictEqual(status.persistent, false);
      await store.addHistory({ summary: 'prova', answer: 'ok' });
    } finally {
      current.dataDir = previous;
      await store.ensureDir();
      fs.chmodSync(locked, 0o755);
      fs.rmSync(locked, { recursive: true, force: true });
    }
  });

  await check('i preset si salvano e si rileggono', async () => {
    await fetch(`${base}/api/presets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test', query: { underlying: 'SPY' } }),
    });
    const data = await (await fetch(`${base}/api/presets`)).json();
    assert.strictEqual(data.items[0].name, 'test');
    assert.deepStrictEqual(data.items[0].query.underlyings, ['SPY']);
  });

  console.log(results.join('\n'));
  server.close();
  fake.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
