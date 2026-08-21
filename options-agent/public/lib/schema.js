/**
 * Schema della query per il sistema multiagentico di opzioni.
 *
 * È il contratto condiviso fra la UI (form + anteprima JSON), il pianificatore
 * (linguaggio naturale → JSON) e il connettore (JSON → prompt/payload verso il
 * sistema che gira sul mini).
 */

const OBJECTIVES = [
  { id: 'analyze', label: 'Analizza strategia' },
  { id: 'screen', label: 'Cerca opportunità' },
  { id: 'compare', label: 'Confronta alternative' },
  { id: 'backtest', label: 'Backtest storico' },
  { id: 'monitor', label: 'Monitora posizione' },
  { id: 'hedge', label: 'Copertura / hedge' },
  { id: 'explain', label: 'Spiega' },
];

const STRATEGIES = [
  { id: 'custom', label: 'Personalizzata (gambe manuali)' },
  { id: 'long_call', label: 'Long call' },
  { id: 'long_put', label: 'Long put' },
  { id: 'covered_call', label: 'Covered call' },
  { id: 'cash_secured_put', label: 'Cash secured put' },
  { id: 'bull_call_spread', label: 'Bull call spread (debito)' },
  { id: 'bull_put_spread', label: 'Bull put spread (credito)' },
  { id: 'bear_call_spread', label: 'Bear call spread (credito)' },
  { id: 'bear_put_spread', label: 'Bear put spread (debito)' },
  { id: 'iron_condor', label: 'Iron condor' },
  { id: 'iron_butterfly', label: 'Iron butterfly' },
  { id: 'straddle', label: 'Straddle' },
  { id: 'strangle', label: 'Strangle' },
  { id: 'calendar', label: 'Calendar spread' },
  { id: 'diagonal', label: 'Diagonal spread' },
  { id: 'ratio_spread', label: 'Ratio spread' },
  { id: 'collar', label: 'Collar' },
  { id: 'wheel', label: 'Wheel' },
];

const METRICS = [
  { id: 'greeks', label: 'Greche' },
  { id: 'pop', label: 'Probabilità di profitto' },
  { id: 'expected_value', label: 'Valore atteso' },
  { id: 'max_profit', label: 'Max profitto' },
  { id: 'max_loss', label: 'Max perdita' },
  { id: 'breakeven', label: 'Pareggio' },
  { id: 'risk_reward', label: 'Rischio/rendimento' },
  { id: 'margin', label: 'Margine richiesto' },
  { id: 'iv_rank', label: 'IV rank / percentile' },
  { id: 'liquidity', label: 'Liquidità (OI, spread)' },
  { id: 'earnings', label: 'Rischio earnings' },
];

const AGENTS = [
  { id: 'quant', label: 'Quant (pricing, greche)' },
  { id: 'risk', label: 'Risk manager' },
  { id: 'macro', label: 'Macro' },
  { id: 'news', label: 'News / sentiment' },
  { id: 'volatility', label: 'Volatilità' },
  { id: 'execution', label: 'Esecuzione' },
  { id: 'portfolio', label: 'Portafoglio' },
  { id: 'backtester', label: 'Backtester' },
];

const SIDES = ['buy', 'sell'];
const TYPES = ['call', 'put', 'stock'];

const DEFAULT_QUERY = {
  objective: 'analyze',
  underlyings: [],
  strategy: 'custom',
  legs: [],
  horizon: { dte: null, expiry: null },
  scenarios: [],
  metrics: ['greeks', 'pop', 'max_loss'],
  constraints: {},
  agents: [],
  risk_profile: 'moderato',
  notes: '',
  prompt: '',
};

function ids(list) {
  return list.map((x) => x.id);
}

function str(value, max = 400) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, max).trim();
}

function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function arr(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return String(value)
    .split(/[,\s]+/)
    .filter(Boolean);
}

function normalizeLeg(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = TYPES.includes(str(raw.type).toLowerCase()) ? str(raw.type).toLowerCase() : 'call';
  const side = SIDES.includes(str(raw.side).toLowerCase()) ? str(raw.side).toLowerCase() : 'buy';
  const leg = {
    side,
    type,
    strike: numOrNull(raw.strike),
    expiry: str(raw.expiry, 20) || null,
    dte: numOrNull(raw.dte),
    qty: numOrNull(raw.qty) || 1,
    delta: numOrNull(raw.delta),
  };
  if (leg.strike === null && leg.delta === null && type !== 'stock') {
    // gamba senza strike né delta: la lasciamo comunque, il sistema può sceglierli
    leg.strike = null;
  }
  return leg;
}

function normalizeScenario(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = {
    label: str(raw.label, 60) || null,
    spot_change_pct: numOrNull(raw.spot_change_pct),
    iv_change_pct: numOrNull(raw.iv_change_pct),
    days_forward: numOrNull(raw.days_forward),
    rate_change_bps: numOrNull(raw.rate_change_bps),
  };
  const hasAny = ['spot_change_pct', 'iv_change_pct', 'days_forward', 'rate_change_bps'].some(
    (k) => s[k] !== null
  );
  return hasAny || s.label ? s : null;
}

function normalizeConstraints(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const numericKeys = [
    'max_risk',
    'max_capital',
    'min_credit',
    'max_debit',
    'min_pop',
    'target_delta',
    'min_open_interest',
    'max_bid_ask_pct',
  ];
  for (const key of numericKeys) {
    const v = numOrNull(c[key]);
    if (v !== null) out[key] = v;
  }
  const currency = str(c.currency, 8).toUpperCase();
  if (currency) out.currency = currency;
  if (c.delta_neutral === true) out.delta_neutral = true;
  if (c.defined_risk === true) out.defined_risk = true;
  if (c.avoid_earnings === true) out.avoid_earnings = true;
  const extra = str(c.extra, 300);
  if (extra) out.extra = extra;
  return out;
}

/** Ripulisce e completa una query proveniente dalla UI o dal pianificatore. */
function normalizeQuery(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const objective = ids(OBJECTIVES).includes(str(q.objective)) ? str(q.objective) : 'analyze';
  const strategy = ids(STRATEGIES).includes(str(q.strategy)) ? str(q.strategy) : 'custom';

  const underlyings = arr(q.underlyings ?? q.underlying ?? q.tickers)
    .map((u) => str(u, 12).toUpperCase())
    .filter(Boolean)
    .slice(0, 10);

  const legs = arr(q.legs).map(normalizeLeg).filter(Boolean).slice(0, 12);
  const scenarios = arr(q.scenarios).map(normalizeScenario).filter(Boolean).slice(0, 8);

  const metrics = arr(q.metrics)
    .map((m) => str(m, 30).toLowerCase())
    .filter((m) => ids(METRICS).includes(m))
    .slice(0, METRICS.length);

  const agents = arr(q.agents)
    .map((a) => str(a, 30).toLowerCase())
    .filter(Boolean)
    .slice(0, 8);

  const horizon = q.horizon && typeof q.horizon === 'object' ? q.horizon : {};

  return {
    objective,
    underlyings,
    strategy,
    legs,
    horizon: {
      dte: numOrNull(horizon.dte),
      expiry: str(horizon.expiry, 20) || null,
    },
    scenarios,
    metrics: metrics.length ? metrics : DEFAULT_QUERY.metrics.slice(),
    constraints: normalizeConstraints(q.constraints),
    agents,
    risk_profile: str(q.risk_profile, 30) || 'moderato',
    notes: str(q.notes, 600),
    prompt: str(q.prompt, 2000),
  };
}

function labelOf(list, id) {
  const found = list.find((x) => x.id === id);
  return found ? found.label : id;
}

function legToText(leg) {
  if (leg.type === 'stock') {
    return `${leg.side === 'buy' ? 'compra' : 'vendi'} ${leg.qty} sottostante`;
  }
  const parts = [leg.side === 'buy' ? 'compra' : 'vendi', `${leg.qty}x`, leg.type];
  if (leg.strike !== null) parts.push(`strike ${leg.strike}`);
  if (leg.delta !== null) parts.push(`delta ${leg.delta}`);
  if (leg.expiry) parts.push(`scad. ${leg.expiry}`);
  else if (leg.dte !== null) parts.push(`${leg.dte} DTE`);
  return parts.join(' ');
}

function scenarioToText(s) {
  const parts = [];
  if (s.spot_change_pct !== null) parts.push(`spot ${s.spot_change_pct > 0 ? '+' : ''}${s.spot_change_pct}%`);
  if (s.iv_change_pct !== null) parts.push(`IV ${s.iv_change_pct > 0 ? '+' : ''}${s.iv_change_pct}%`);
  if (s.days_forward !== null) parts.push(`+${s.days_forward} giorni`);
  if (s.rate_change_bps !== null) parts.push(`tassi ${s.rate_change_bps > 0 ? '+' : ''}${s.rate_change_bps}bps`);
  return `${s.label ? `${s.label}: ` : ''}${parts.join(', ') || 'scenario base'}`;
}

/** Riassunto leggibile della query, usato nelle card della UI e nello storico. */
function describeQuery(query) {
  const q = normalizeQuery(query);
  const bits = [labelOf(OBJECTIVES, q.objective)];
  if (q.underlyings.length) bits.push(q.underlyings.join(', '));
  if (q.strategy !== 'custom') bits.push(labelOf(STRATEGIES, q.strategy));
  if (q.horizon.expiry) bits.push(q.horizon.expiry);
  else if (q.horizon.dte !== null) bits.push(`${q.horizon.dte} DTE`);
  return bits.join(' · ');
}

/**
 * Traduce la query strutturata nel prompt inviato al sistema multiagentico.
 * Il JSON viene allegato in coda: i sistemi che sanno leggerlo lo usano, gli
 * altri lavorano comunque sul testo.
 */
function queryToPrompt(query) {
  const q = normalizeQuery(query);
  const lines = [];

  lines.push(`Obiettivo: ${labelOf(OBJECTIVES, q.objective)}.`);
  if (q.underlyings.length) lines.push(`Sottostanti: ${q.underlyings.join(', ')}.`);
  if (q.strategy !== 'custom') lines.push(`Strategia: ${labelOf(STRATEGIES, q.strategy)}.`);
  if (q.legs.length) lines.push(`Gambe: ${q.legs.map(legToText).join(' | ')}.`);
  if (q.horizon.expiry) lines.push(`Scadenza: ${q.horizon.expiry}.`);
  else if (q.horizon.dte !== null) lines.push(`Orizzonte: ${q.horizon.dte} giorni alla scadenza.`);
  if (q.scenarios.length) lines.push(`Scenari da valutare: ${q.scenarios.map(scenarioToText).join(' | ')}.`);
  if (q.metrics.length) {
    lines.push(`Metriche richieste: ${q.metrics.map((m) => labelOf(METRICS, m)).join(', ')}.`);
  }

  const c = q.constraints;
  const constraintText = [];
  if (c.max_risk !== undefined) constraintText.push(`perdita massima ${c.max_risk}${c.currency ? ' ' + c.currency : ''}`);
  if (c.max_capital !== undefined) constraintText.push(`capitale impiegato max ${c.max_capital}${c.currency ? ' ' + c.currency : ''}`);
  if (c.min_credit !== undefined) constraintText.push(`credito minimo ${c.min_credit}`);
  if (c.max_debit !== undefined) constraintText.push(`debito massimo ${c.max_debit}`);
  if (c.min_pop !== undefined) constraintText.push(`probabilità di profitto ≥ ${c.min_pop}%`);
  if (c.target_delta !== undefined) constraintText.push(`delta obiettivo ${c.target_delta}`);
  if (c.min_open_interest !== undefined) constraintText.push(`open interest ≥ ${c.min_open_interest}`);
  if (c.max_bid_ask_pct !== undefined) constraintText.push(`spread denaro/lettera ≤ ${c.max_bid_ask_pct}%`);
  if (c.delta_neutral) constraintText.push('posizione delta neutrale');
  if (c.defined_risk) constraintText.push('solo strategie a rischio definito');
  if (c.avoid_earnings) constraintText.push('evita scadenze a cavallo degli earnings');
  if (c.extra) constraintText.push(c.extra);
  if (constraintText.length) lines.push(`Vincoli: ${constraintText.join('; ')}.`);

  lines.push(`Profilo di rischio: ${q.risk_profile}.`);
  if (q.agents.length) lines.push(`Agenti da coinvolgere: ${q.agents.join(', ')}.`);
  if (q.notes) lines.push(`Note: ${q.notes}`);
  if (q.prompt) lines.push(`Richiesta originale dell'utente: "${q.prompt}"`);

  lines.push('');
  lines.push(
    'Rispondi in italiano. Riporta il contributo dei singoli agenti (prefissando le sezioni ' +
      'con [nome-agente]), poi una sintesi operativa con numeri, rischi e condizioni di uscita. ' +
      'Se mancano dati di mercato, dillo esplicitamente invece di inventarli.'
  );
  lines.push('');
  lines.push('Query strutturata (JSON):');
  lines.push('```json');
  lines.push(JSON.stringify(q, null, 2));
  lines.push('```');

  return lines.join('\n');
}

export {
  OBJECTIVES,
  STRATEGIES,
  METRICS,
  AGENTS,
  SIDES,
  TYPES,
  DEFAULT_QUERY,
  normalizeQuery,
  describeQuery,
  queryToPrompt,
};
