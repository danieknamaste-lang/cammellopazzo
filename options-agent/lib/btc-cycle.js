/**
 * Policy BTC ciclica: macchina a stati, dimensionamento, uscite, report.
 *
 * Implementa la specifica operativa fornita dall'utente (sezioni 9, 10, 11 e
 * gli stati 4-6). È deterministica e senza dipendenze: nessun dato di mercato
 * viene inventato: ciò che non arriva in input esce come `n/d` e finisce in
 * `missing`, perché un report con numeri inventati è peggio di nessun report.
 *
 * ATTENZIONE — la specifica ricevuta è troncata: gli STATE 1, 2 e 3 sono
 * citati ma mai definiti. Qui sono dichiarati `defined: false` e la
 * classificazione si rifiuta di restituirli invece di indovinarli.
 */

'use strict';

/** Soglie di prezzo, in dollari. Dalla sezione 11 della specifica. */
const THRESHOLDS = {
  trigger: 84000, // chiusura settimanale > 84k → autorizza ANALISI (non esecuzione)
  confirmation: 98000,
  warning: 62300,
  invalidation: 57800,
};

const STATES = [
  { id: 1, label: 'STATE 1', defined: false },
  { id: 2, label: 'STATE 2', defined: false },
  { id: 3, label: 'STATE 3', defined: false },
  { id: 4, label: 'POSITION ACTIVE', defined: true },
  { id: 5, label: 'THESIS WARNING', defined: true },
  { id: 6, label: 'THESIS INVALIDATED', defined: true },
];

const ACTIONS = ['NO TRADE', 'WATCH', 'ENTER', 'REDUCE', 'EXIT', 'ROLL'];

/** Criteri di uscita A-G della sezione 10. Nessuno è opzionale in fase di review. */
const EXIT_CRITERIA = [
  { id: 'A', label: 'deterioramento della tesi ciclica' },
  { id: 'B', label: 'invalidazione di prezzo' },
  { id: 'C', label: 'delta dell\'opzione diventato eccessivamente alto' },
  { id: 'D', label: 'DTE residui' },
  { id: 'E', label: 'espansione della IV' },
  { id: 'F', label: 'raggiungimento del target BTC atteso' },
  { id: 'G', label: 'deterioramento del rapporto rischio/rendimento' },
];

/** Alternative da confrontare quando una long call va profondamente ITM (sez. 10). */
const DEEP_ITM_CHOICES = ['hold', 'roll_up', 'roll_forward', 'convert_to_spread', 'take_partial_profit'];

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fmt(value, digits = 2) {
  return value === null ? 'n/d' : Number(value).toFixed(digits);
}

/**
 * Importi in dollari. I centesimi restano solo dove contano davvero: un premio
 * per azione arrotondato all'intero sposta il break-even, un notional no.
 */
function usd(value) {
  if (value === null) return 'n/d';
  const n = Number(value);
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * Stato ciclico e gate delle soglie.
 *
 * Il gate degli 84k è deliberatamente separato dall'esecuzione: una chiusura
 * settimanale sopra 84k autorizza l'ANALISI, non l'ingresso.
 */
function classify(input = {}) {
  const price = num(input.price);
  const weeklyClose = num(input.weeklyClose);
  const positionOpen = input.positionOpen === true;

  const gates = {
    trigger84k: weeklyClose === null ? null : weeklyClose > THRESHOLDS.trigger,
    confirmation98k: weeklyClose === null ? null : weeklyClose > THRESHOLDS.confirmation,
    warning62_3k: price === null ? null : price < THRESHOLDS.warning,
    invalidation57_8k: price === null ? null : price < THRESHOLDS.invalidation,
  };

  let state = null;
  let reason = '';
  if (gates.invalidation57_8k === true) {
    state = 6;
    reason = `prezzo ${usd(price)} sotto invalidazione ${usd(THRESHOLDS.invalidation)}`;
  } else if (gates.warning62_3k === true) {
    state = 5;
    reason = `prezzo ${usd(price)} sotto warning ${usd(THRESHOLDS.warning)}`;
  } else if (positionOpen) {
    state = 4;
    reason = 'posizione aperta, nessuna soglia di allarme violata';
  } else {
    reason = 'gli stati 1-3 non sono definiti nella specifica ricevuta: impossibile classificare senza posizione aperta';
  }

  return {
    state,
    label: state ? STATES.find((s) => s.id === state).label : 'NON DETERMINABILE',
    reason,
    gates,
    // Il gate 84k autorizza l'analisi, mai da solo l'esecuzione.
    authorizesAnalysis: gates.trigger84k === true,
    authorizesExecution: false,
    missing: [price === null && 'price', weeklyClose === null && 'weeklyClose'].filter(Boolean),
  };
}

/**
 * Dimensionamento in termini di portafoglio (sezione 9).
 *
 * Riporta SEMPRE entrambe le leve: notional e delta-adjusted. Descrivere la
 * leva con il solo notional dell'opzione è vietato dalla specifica.
 */
function sizing(input = {}) {
  const contracts = num(input.contracts);
  const multiplier = num(input.multiplier); // unità di sottostante per contratto
  const underlyingPrice = num(input.underlyingPrice);
  const delta = num(input.delta); // delta per unità di sottostante, 0..1
  const premiumPerContract = num(input.premiumPerContract);
  const portfolioValue = num(input.portfolioValue);
  const btcPerUnit = num(input.btcPerUnderlyingUnit); // es. quanti BTC vale 1 azione dell'ETF
  const btcPrice = num(input.btcPrice);

  const units = contracts !== null && multiplier !== null ? contracts * multiplier : null;

  const maxPremiumAtRisk = contracts !== null && premiumPerContract !== null && multiplier !== null
    ? contracts * premiumPerContract * multiplier
    : null;

  // Per una struttura a rischio definito la perdita massima è il premio pagato,
  // salvo che il chiamante ne dichiari una diversa (es. spread in debito).
  const maxLoss = num(input.maxLoss) !== null ? num(input.maxLoss) : maxPremiumAtRisk;

  const maxPortfolioLossPct = maxLoss !== null && portfolioValue
    ? (maxLoss / portfolioValue) * 100
    : null;

  const notionalExposure = units !== null && underlyingPrice !== null ? units * underlyingPrice : null;
  const deltaExposure = notionalExposure !== null && delta !== null ? notionalExposure * delta : null;

  // Esposizione equivalente in BTC, delta-adjusted.
  let btcEquivalent = null;
  if (units !== null && delta !== null && btcPerUnit !== null) {
    btcEquivalent = units * delta * btcPerUnit;
  } else if (deltaExposure !== null && btcPrice) {
    btcEquivalent = deltaExposure / btcPrice;
  }

  const notionalLeverage = notionalExposure !== null && portfolioValue ? notionalExposure / portfolioValue : null;
  const deltaAdjustedLeverage = deltaExposure !== null && portfolioValue ? deltaExposure / portfolioValue : null;

  const missing = [];
  if (contracts === null) missing.push('contracts');
  if (multiplier === null) missing.push('multiplier');
  if (underlyingPrice === null) missing.push('underlyingPrice');
  if (delta === null) missing.push('delta');
  if (premiumPerContract === null) missing.push('premiumPerContract');
  if (portfolioValue === null) missing.push('portfolioValue');
  if (btcEquivalent === null) missing.push('btcPerUnderlyingUnit oppure btcPrice');

  return {
    maxPremiumAtRisk,
    maxLoss,
    maxPortfolioLossPct,
    notionalExposure,
    deltaExposure,
    btcEquivalent,
    notionalLeverage,
    deltaAdjustedLeverage,
    missing,
  };
}

/**
 * Vincoli non negoziabili della sezione 9.
 * Restituisce la lista delle violazioni: vuota significa struttura ammissibile.
 */
function guards(structure = {}) {
  const violations = [];
  const side = String(structure.side || '').toLowerCase();
  const isLongOption = side === 'long' || side === 'debit';
  const isNakedShort = structure.nakedShort === true;

  if (isLongOption && num(structure.maxLoss) === null) {
    violations.push('una posizione long su opzioni deve avere una perdita massima esplicitamente definita');
  }
  if (isNakedShort && structure.nakedShortAuthorized !== true) {
    violations.push('esposizione short nuda su opzioni: richiede autorizzazione separata ed esplicita');
  }
  return violations;
}

/** Il report della sezione 11, nell'ordine imposto. Campi assenti → `n/d`. */
function renderReport(input = {}) {
  const cls = classify(input.market || {});
  const size = sizing(input.position || {});
  const violations = guards(input.position || {});
  const s = input.structure || {};
  const cases = input.cases || {};

  const bool = (v) => (v === null ? 'n/d' : v ? 'SÌ' : 'NO');
  const action = ACTIONS.includes(input.action) ? input.action : 'NO TRADE';

  const lines = [
    `BTC PRICE: ${usd(num((input.market || {}).price))}`,
    `WEEKLY CLOSE: ${usd(num((input.market || {}).weeklyClose))}`,
    `CYCLICAL STATE: ${cls.label}${cls.reason ? ` — ${cls.reason}` : ''}`,
    `84K TRIGGER: ${bool(cls.gates.trigger84k)}`,
    `98K CONFIRMATION: ${bool(cls.gates.confirmation98k)}`,
    `62.3K WARNING: ${bool(cls.gates.warning62_3k)}`,
    `57.8K INVALIDATION: ${bool(cls.gates.invalidation57_8k)}`,
    '',
    `RECOMMENDED ACTION: ${action}`,
    '',
    `BEST UNDERLYING: ${s.underlying || 'n/d'}`,
    `BEST EXPIRATION: ${s.expiration || 'n/d'}`,
    `STRUCTURE: ${s.structure || 'n/d'}`,
    `STRIKES: ${s.strikes || 'n/d'}`,
    `PREMIUM: ${usd(num(s.premium))}`,
    `MAX LOSS: ${usd(size.maxLoss)}`,
    `MAX PROFIT: ${s.maxProfit === 'unlimited' ? 'illimitato (teorico)' : usd(num(s.maxProfit))}`,
    `BREAK-EVEN: ${usd(num(s.breakEven))}`,
    `DELTA: ${fmt(num((input.position || {}).delta), 3)}`,
    `THETA: ${fmt(num(s.theta))}`,
    `VEGA: ${fmt(num(s.vega))}`,
    `EFFECTIVE LEVERAGE: notional ${fmt(size.notionalLeverage)}x · delta-adjusted ${fmt(size.deltaAdjustedLeverage)}x`,
    `BTC EQUIVALENT EXPOSURE: ${fmt(size.btcEquivalent, 4)} BTC`,
    '',
    `BULL CASE: ${cases.bull || 'n/d'}`,
    `BASE CASE: ${cases.base || 'n/d'}`,
    `BEAR CASE: ${cases.bear || 'n/d'}`,
    '',
    'WHAT WOULD PROVE THIS TRADE WRONG?',
    input.invalidation || 'n/d — sezione obbligatoria, il report non è valido senza.',
  ];

  const missing = [...cls.missing, ...size.missing];
  if (!input.invalidation) missing.push('invalidation (sezione obbligatoria)');
  if (missing.length) {
    lines.push('', `DATI MANCANTI (non stimati): ${missing.join(', ')}`);
  }
  if (violations.length) {
    lines.push('', `VIOLAZIONI DI POLICY: ${violations.join(' · ')}`);
  }

  return {
    text: lines.join('\n'),
    state: cls,
    sizing: size,
    violations,
    missing,
    valid: missing.length === 0 && violations.length === 0,
  };
}

module.exports = {
  THRESHOLDS,
  STATES,
  ACTIONS,
  EXIT_CRITERIA,
  DEEP_ITM_CHOICES,
  classify,
  sizing,
  guards,
  renderReport,
};
