/**
 * Test della policy BTC ciclica, senza dipendenze: `node test/btc-cycle.js`
 */

'use strict';

const assert = require('assert');
const btc = require('../lib/btc-cycle');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    results.push(`✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

check('le soglie sono quelle della specifica', () => {
  assert.deepStrictEqual(btc.THRESHOLDS, {
    trigger: 84000, confirmation: 98000, warning: 62300, invalidation: 57800,
  });
});

check('gli stati 1-3 non sono definiti e non vengono indovinati', () => {
  const undef = btc.STATES.filter((s) => !s.defined).map((s) => s.id);
  assert.deepStrictEqual(undef, [1, 2, 3]);
  const r = btc.classify({ price: 90000, weeklyClose: 90000, positionOpen: false });
  assert.strictEqual(r.state, null);
  assert.match(r.reason, /non sono definiti/);
});

check('una chiusura settimanale sopra 84k autorizza l\'analisi ma non l\'esecuzione', () => {
  const r = btc.classify({ price: 86000, weeklyClose: 85000, positionOpen: false });
  assert.strictEqual(r.gates.trigger84k, true);
  assert.strictEqual(r.authorizesAnalysis, true);
  assert.strictEqual(r.authorizesExecution, false);
});

check('sotto 62.3k scatta il warning, sotto 57.8k l\'invalidazione', () => {
  assert.strictEqual(btc.classify({ price: 60000, weeklyClose: 85000 }).state, 5);
  assert.strictEqual(btc.classify({ price: 57000, weeklyClose: 85000 }).state, 6);
  // l'invalidazione ha precedenza sul warning
  assert.strictEqual(btc.classify({ price: 50000, weeklyClose: 85000 }).label, 'THESIS INVALIDATED');
});

check('con posizione aperta e nessun allarme lo stato è POSITION ACTIVE', () => {
  const r = btc.classify({ price: 90000, weeklyClose: 90000, positionOpen: true });
  assert.strictEqual(r.state, 4);
  assert.strictEqual(r.label, 'POSITION ACTIVE');
});

check('il dimensionamento riporta entrambe le leve, distinte', () => {
  // 10 contratti × 100 azioni × $60 = $60.000 di notional su $100.000 di portafoglio
  const s = btc.sizing({
    contracts: 10, multiplier: 100, underlyingPrice: 60, delta: 0.4,
    premiumPerContract: 3, portfolioValue: 100000, btcPerUnderlyingUnit: 0.0005,
  });
  assert.strictEqual(s.notionalExposure, 60000);
  assert.strictEqual(s.notionalLeverage, 0.6);
  assert.strictEqual(s.deltaExposure, 24000);
  assert.ok(Math.abs(s.deltaAdjustedLeverage - 0.24) < 1e-9);
  // le due leve devono differire: è il punto della sezione 9
  assert.notStrictEqual(s.notionalLeverage, s.deltaAdjustedLeverage);
  assert.strictEqual(s.maxPremiumAtRisk, 3000);
  assert.ok(Math.abs(s.maxPortfolioLossPct - 3) < 1e-9);
  assert.ok(Math.abs(s.btcEquivalent - 0.2) < 1e-9); // 1000 unità × 0.4 × 0.0005
  assert.deepStrictEqual(s.missing, []);
});

check('i dati mancanti non vengono stimati: escono in missing', () => {
  const s = btc.sizing({ contracts: 10, multiplier: 100 });
  assert.strictEqual(s.notionalExposure, null);
  assert.strictEqual(s.deltaAdjustedLeverage, null);
  assert.ok(s.missing.includes('underlyingPrice'));
  assert.ok(s.missing.includes('delta'));
});

check('una long senza perdita massima definita è una violazione', () => {
  assert.strictEqual(btc.guards({ side: 'long', maxLoss: 3000 }).length, 0);
  assert.match(btc.guards({ side: 'long' })[0], /perdita massima/);
});

check('lo short nudo richiede autorizzazione esplicita', () => {
  assert.match(btc.guards({ side: 'short', nakedShort: true })[0], /autorizzazione separata/);
  assert.strictEqual(btc.guards({ side: 'short', nakedShort: true, nakedShortAuthorized: true }).length, 0);
});

check('il report emette l\'intestazione obbligatoria nell\'ordine imposto', () => {
  const r = btc.renderReport({ market: { price: 90000, weeklyClose: 88000, positionOpen: true } });
  const head = r.text.split('\n').slice(0, 7).map((l) => l.split(':')[0]);
  assert.deepStrictEqual(head, [
    'BTC PRICE', 'WEEKLY CLOSE', 'CYCLICAL STATE',
    '84K TRIGGER', '98K CONFIRMATION', '62.3K WARNING', '57.8K INVALIDATION',
  ]);
});

check('la sezione "what would prove this trade wrong" è obbligatoria', () => {
  const senza = btc.renderReport({ market: { price: 90000, weeklyClose: 88000, positionOpen: true } });
  assert.ok(senza.text.includes('WHAT WOULD PROVE THIS TRADE WRONG?'));
  assert.ok(senza.missing.some((m) => m.startsWith('invalidation')));
  assert.strictEqual(senza.valid, false);
});

check('un report senza dati non è mai valido e lo dichiara', () => {
  const r = btc.renderReport({});
  assert.strictEqual(r.valid, false);
  assert.ok(r.text.includes('DATI MANCANTI'));
  assert.ok(r.text.includes('n/d'));
  // nessun numero inventato al posto dei dati mancanti
  assert.ok(!/\$\d/.test(r.text.split('DATI MANCANTI')[0].split('BTC PRICE:')[1].split('\n')[0]));
});

check('le violazioni di policy compaiono nel report', () => {
  const r = btc.renderReport({
    market: { price: 90000, weeklyClose: 88000, positionOpen: true },
    position: { side: 'long' },
    invalidation: 'chiusura settimanale sotto 57.8k',
  });
  assert.ok(r.text.includes('VIOLAZIONI DI POLICY'));
  assert.strictEqual(r.valid, false);
});

check('i sette criteri di uscita A-G ci sono tutti', () => {
  assert.deepStrictEqual(btc.EXIT_CRITERIA.map((c) => c.id), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.strictEqual(btc.DEEP_ITM_CHOICES.length, 5);
});

console.log(results.join('\n'));
console.log(process.exitCode ? '\nalcuni test non passano' : `\n${results.length} test superati`);
