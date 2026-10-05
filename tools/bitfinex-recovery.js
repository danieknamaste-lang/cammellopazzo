#!/usr/bin/env node
/**
 * Confronto del recupero dei prezzi rispetto a Bitcoin, con dati Bitfinex.
 *
 * Per ogni simbolo scarica le candele giornaliere (API pubblica Bitfinex v2,
 * nessuna chiave richiesta) e calcola:
 *   - chiusura alla data di riferimento (default 31 agosto)
 *   - minimo intraday nella finestra "fine mese" (default ultimi 10 giorni di agosto)
 *   - ultima chiusura disponibile
 *   - variazione % dalla chiusura di riferimento e dal minimo
 * e infine ordina gli asset per performance, segnalando quelli saliti meno di BTC.
 *
 * Se una coppia non è quotata su Bitfinex (es. ASTER) prova CoinGecko.
 *
 * Uso:
 *   node tools/bitfinex-recovery.js
 *   node tools/bitfinex-recovery.js --from 2026-08-31 --symbols BTC,UNI,AAVE,XPL,ASTER
 *   node tools/bitfinex-recovery.js --from 2026-08-31 --low-from 2026-08-20 --json
 */

const BITFINEX = 'https://api-pub.bitfinex.com/v2';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const DAY = 86400000;

// id CoinGecko usati solo come ripiego quando Bitfinex non ha la coppia
const COINGECKO_IDS = {
  BTC: 'bitcoin',
  UNI: 'uniswap',
  AAVE: 'aave',
  XPL: 'plasma',
  ASTER: 'aster-2',
};

function parseArgs(argv) {
  const args = { from: null, lowFrom: null, symbols: ['BTC', 'UNI', 'AAVE', 'XPL', 'ASTER'], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--low-from') args.lowFrom = argv[++i];
    else if (a === '--symbols') args.symbols = argv[++i].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('node tools/bitfinex-recovery.js [--from YYYY-MM-DD] [--low-from YYYY-MM-DD] [--symbols BTC,UNI,...] [--json]');
      process.exit(0);
    }
  }
  const now = new Date();
  if (!args.from) {
    // default: 31 agosto dell'anno corrente (o dell'anno scorso se siamo prima di settembre)
    const y = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    args.from = `${y}-08-31`;
  }
  if (!args.lowFrom) {
    const d = new Date(`${args.from}T00:00:00Z`);
    args.lowFrom = new Date(d.getTime() - 10 * DAY).toISOString().slice(0, 10);
  }
  if (!args.symbols.includes('BTC')) args.symbols.unshift('BTC');
  return args;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

/** Candele giornaliere Bitfinex → [{ ts, open, close, high, low }] ordinate per data. */
async function bitfinexCandles(symbol, startMs) {
  const pair = `t${symbol}USD`;
  const url = `${BITFINEX}/candles/trade:1D:${pair}/hist?start=${startMs}&limit=400&sort=1`;
  const rows = await getJson(url);
  if (!Array.isArray(rows)) throw new Error(`risposta inattesa per ${pair}`);
  if (rows.length === 0) throw new Error(`nessuna candela per ${pair} (coppia non quotata?)`);
  return rows.map(([ts, open, close, high, low]) => ({ ts, open, close, high, low }));
}

/** Ripiego CoinGecko: prezzi giornalieri → stesse colonne (high/low approssimati con il prezzo). */
async function coingeckoCandles(symbol, startMs) {
  const id = COINGECKO_IDS[symbol];
  if (!id) throw new Error(`nessun id CoinGecko configurato per ${symbol}`);
  const from = Math.floor(startMs / 1000);
  const to = Math.floor(Date.now() / 1000);
  const data = await getJson(`${COINGECKO}/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`);
  const byDay = new Map();
  for (const [ts, price] of data.prices || []) {
    const day = Math.floor(ts / DAY) * DAY;
    const c = byDay.get(day) || { ts: day, open: price, close: price, high: price, low: price };
    c.close = price;
    c.high = Math.max(c.high, price);
    c.low = Math.min(c.low, price);
    byDay.set(day, c);
  }
  const out = [...byDay.values()].sort((a, b) => a.ts - b.ts);
  if (out.length === 0) throw new Error(`nessun prezzo CoinGecko per ${id}`);
  return out;
}

/**
 * Calcola le metriche di recupero per una serie di candele.
 * fromMs: inizio del giorno di riferimento (UTC); lowFromMs: inizio finestra per il minimo.
 */
function analyze(candles, fromMs, lowFromMs) {
  const ref = candles.find((c) => c.ts >= fromMs);
  if (!ref) throw new Error('nessuna candela alla data di riferimento');
  const window = candles.filter((c) => c.ts >= lowFromMs && c.ts <= fromMs);
  const lowCandle = window.reduce((m, c) => (!m || c.low < m.low ? c : m), null) || ref;
  const last = candles[candles.length - 1];
  const pct = (a, b) => ((b - a) / a) * 100;
  return {
    refDate: new Date(ref.ts).toISOString().slice(0, 10),
    refClose: ref.close,
    lowDate: new Date(lowCandle.ts).toISOString().slice(0, 10),
    low: lowCandle.low,
    lastDate: new Date(last.ts).toISOString().slice(0, 10),
    lastClose: last.close,
    fromRefPct: pct(ref.close, last.close),
    fromLowPct: pct(lowCandle.low, last.close),
  };
}

/** Ordina per performance e aggiunge il confronto con BTC. */
function compare(results) {
  const btc = results.find((r) => r.symbol === 'BTC' && !r.error);
  const ok = results.filter((r) => !r.error);
  for (const r of ok) {
    r.vsBtcPct = btc ? r.fromRefPct - btc.fromRefPct : null;
    r.slowerThanBtc = btc ? r.fromRefPct < btc.fromRefPct : null;
  }
  ok.sort((a, b) => b.fromRefPct - a.fromRefPct);
  return { btc, ranked: ok, failed: results.filter((r) => r.error) };
}

function fmtPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
const fmtPct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromMs = Date.parse(`${args.from}T00:00:00Z`);
  const lowFromMs = Date.parse(`${args.lowFrom}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(lowFromMs)) {
    console.error('Date non valide: usa il formato YYYY-MM-DD');
    process.exit(1);
  }

  const results = await Promise.all(
    args.symbols.map(async (symbol) => {
      try {
        let source = 'Bitfinex';
        let candles;
        try {
          candles = await bitfinexCandles(symbol, lowFromMs);
        } catch (err) {
          source = 'CoinGecko';
          candles = await coingeckoCandles(symbol, lowFromMs).catch((e2) => {
            throw new Error(`Bitfinex: ${err.message}; CoinGecko: ${e2.message}`);
          });
        }
        return { symbol, source, ...analyze(candles, fromMs, lowFromMs) };
      } catch (err) {
        return { symbol, error: String(err.message || err) };
      }
    })
  );

  const out = compare(results);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`Recupero dei prezzi dal ${args.from} (minimo cercato dal ${args.lowFrom}) ad oggi\n`);
  const head = ['Asset', 'Fonte', `Chiusura ${args.from}`, 'Minimo (data)', 'Ultimo', 'Da chiusura', 'Da minimo', 'vs BTC'];
  const rows = out.ranked.map((r) => [
    r.symbol,
    r.source,
    fmtPrice(r.refClose),
    `${fmtPrice(r.low)} (${r.lowDate})`,
    `${fmtPrice(r.lastClose)} (${r.lastDate})`,
    fmtPct(r.fromRefPct),
    fmtPct(r.fromLowPct),
    r.vsBtcPct == null ? '-' : fmtPct(r.vsBtcPct),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  rows.forEach((r) => console.log(line(r)));

  const slower = out.ranked.filter((r) => r.slowerThanBtc);
  console.log();
  if (!out.btc) console.log('BTC non disponibile: impossibile fare il confronto.');
  else if (slower.length === 0) console.log('Tutti gli asset sono saliti più di BTC.');
  else console.log(`Saliti meno di BTC: ${slower.map((r) => `${r.symbol} (${fmtPct(r.fromRefPct)})`).join(', ')}.`);
  for (const f of out.failed) console.log(`⚠ ${f.symbol}: ${f.error}`);
}

module.exports = { analyze, compare, parseArgs };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
