/**
 * Estrattore deterministico: linguaggio naturale → frammenti di query.
 *
 * Serve a due cose: far funzionare l'agente anche senza nessun LLM configurato
 * e riempire i campi che il pianificatore LLM ha lasciato vuoti.
 */

const STRATEGY_PATTERNS = [
  [/\biron\s*condor\b/i, 'iron_condor'],
  [/\biron\s*butterfly\b|\bfarfalla\s*di\s*ferro\b/i, 'iron_butterfly'],
  [/\bcovered\s*call\b|\bcall\s*coperta\b/i, 'covered_call'],
  [/\bcash[\s-]?secured\s*put\b|\bput\s*garantita\b/i, 'cash_secured_put'],
  [/\bbull\s*call\s*spread\b|\bcall\s*spread\s*rialzista\b/i, 'bull_call_spread'],
  [/\bbull\s*put\s*spread\b|\bput\s*spread\s*rialzista\b|\bput\s*spread[^.,;]{0,15}credit\w*\b/i, 'bull_put_spread'],
  [/\bbear\s*call\s*spread\b|\bcall\s*spread\s*ribassista\b|\bcall\s*spread[^.,;]{0,15}credit\w*\b/i, 'bear_call_spread'],
  [/\bbear\s*put\s*spread\b|\bput\s*spread\s*ribassista\b/i, 'bear_put_spread'],
  [/\bcalendar\b|\bcalendario\b/i, 'calendar'],
  [/\bdiagonal\w*\b/i, 'diagonal'],
  [/\bstraddle\b/i, 'straddle'],
  [/\bstrangle\b/i, 'strangle'],
  [/\bratio\s*spread\b/i, 'ratio_spread'],
  [/\bcollar\b/i, 'collar'],
  [/\bwheel\b|\bruota\b/i, 'wheel'],
  [/\blong\s*call\b/i, 'long_call'],
  [/\blong\s*put\b/i, 'long_put'],
];

const OBJECTIVE_PATTERNS = [
  [/\bbacktest\w*\b|\bstoric\w+\b|\bnegli ultimi\b/i, 'backtest'],
  [/\bcerca\b|\btrova\b|\bscreen\w*\b|\bopportunit[àa]\w*|\bquali\s+(titoli|sottostanti)\b/i, 'screen'],
  [/\bconfront\w+\b|\bmeglio\b|\bvs\b|\bcontro\b|\balternativ\w+\b/i, 'compare'],
  [/\bmonitor\w+\b|\bsorvegl\w+\b|\bposizione\s+aperta\b|\bavvis\w+\b/i, 'monitor'],
  [/\bcopertur\w+\b|\bhedg\w+\b|\bproteg\w+\b|\bprotezion\w+\b/i, 'hedge'],
  [/\bspiega\w*\b|\bcos['’]?è|\bcome funziona\b|\bperch[ée]/i, 'explain'],
];

const METRIC_PATTERNS = [
  [/\bgrech\w+\b|\bgreeks?\b|\bdelta\b|\bgamma\b|\btheta\b|\bvega\b/i, 'greeks'],
  [/\bprobabilit[àa]\w*|\bpop\b|\bchance\b/i, 'pop'],
  [/\bvalore\s+atteso\b|\bexpected\s+value\b|\bev\b/i, 'expected_value'],
  [/\bmax\w*\s+(profitt\w+|guadagn\w+)\b/i, 'max_profit'],
  [/\bmax\w*\s+(perdit\w+|loss)\b|\brischio\s+massimo\b/i, 'max_loss'],
  [/\bpareggio\b|\bbreak\s*even\b/i, 'breakeven'],
  [/\brischio\s*\/?\s*rendimento\b|\brisk\s*reward\b/i, 'risk_reward'],
  [/\bmargin\w+\b/i, 'margin'],
  [/\biv\s*rank\b|\bpercentile\b|\bvolatilit[àa]\s+implicit\w*\b/i, 'iv_rank'],
  [/\bliquidit[àa]\w*|\bopen\s*interest\b|\bspread\s+denaro\b/i, 'liquidity'],
  [/\bearning\w*\b|\btrimestral\w+\b|\butili\b/i, 'earnings'],
];

const AGENT_PATTERNS = [
  [/\bquant\w*\b/i, 'quant'],
  [/\brisk\b|\brischio\s+manager\b/i, 'risk'],
  [/\bmacro\b/i, 'macro'],
  [/\bnews\b|\bnotizi\w+\b|\bsentiment\b/i, 'news'],
  [/\bvolatilit[àa]\w*|\bvolatility\b/i, 'volatility'],
  [/\besecuzion\w+\b|\bexecution\b|\bordine\b/i, 'execution'],
  [/\bportafogli\w+\b|\bportfolio\b/i, 'portfolio'],
  [/\bbacktest\w*\b/i, 'backtester'],
];

// Parole tutte maiuscole che non sono ticker.
const NOT_TICKERS = new Set([
  'IV', 'DTE', 'ATM', 'OTM', 'ITM', 'PUT', 'CALL', 'EUR', 'USD', 'ETF', 'PMI', 'PIL',
  'AI', 'IA', 'CPI', 'FED', 'BCE', 'EV', 'POP', 'OI', 'ROI', 'PL', 'PNL', 'API', 'OK',
]);

// Parole che possono seguire una preposizione senza essere un sottostante.
const COMMON_WORDS = new Set([
  'UN', 'UNO', 'UNA', 'IL', 'LO', 'LA', 'LE', 'GLI', 'DEI', 'DEL', 'DELLA', 'DELLE', 'DEGLI',
  'QUESTO', 'QUESTA', 'QUEL', 'QUELLA', 'MIO', 'MIA', 'TUTTO', 'TUTTI', 'OGNI', 'ALTRO', 'ALTRA',
  'CUI', 'CHE', 'CHI', 'COSA', 'COME', 'DOVE', 'QUALE', 'QUALI', 'MENO', 'PIU',
  'TITOLO', 'TITOLI', 'INDICE', 'INDICI', 'AZIONE', 'AZIONI', 'MERCATO', 'BORSA', 'ETF', 'FUTURE',
  'OPZIONE', 'OPZION', 'STRIKE', 'SPREAD', 'CALL', 'PUT', 'CREDITO', 'DEBITO', 'RISCHIO', 'RISK',
  'DELTA', 'GAMMA', 'THETA', 'VEGA', 'RHO', 'VOL', 'IV', 'DTE', 'ATM', 'OTM', 'ITM',
  'WHEEL', 'CONDOR', 'STRADDLE', 'STRANGLE', 'COLLAR', 'BUTTERFLY', 'CALENDAR', 'RATIO', 'DIAGONAL',
  'GIORNO', 'GIORNI', 'MESE', 'MESI', 'ANNO', 'ANNI', 'OGGI', 'DOMANI', 'ORA', 'SUBITO',
  'SCADENZA', 'POSIZIONE', 'PORTAFOGLIO', 'STRATEGIA', 'CAPITALE', 'EURO', 'DOLLARI', 'BASSO',
  'ALTO', 'MEDIO', 'BASSA', 'ALTA', 'MEDIA', 'BUON', 'BUONA', 'MEGLIO', 'PEGGIO', 'CIRCA',
  'ME', 'TE', 'NOI', 'VOI', 'LORO', 'SE', 'NON', 'ANCHE', 'SOLO', 'GIA', 'MAI', 'POI',
]);

const KNOWN_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'SPX', 'NDX', 'VIX', 'DAX', 'FTSEMIB', 'ESTX50',
  'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'AMD', 'NFLX',
  'INTC', 'MU', 'COIN', 'MSTR', 'PLTR', 'BABA', 'ENI', 'ISP', 'UCG', 'STLA', 'RACE',
];

function extractUnderlyings(text) {
  const found = new Set();
  for (const t of KNOWN_TICKERS) {
    if (new RegExp(`\\b${t}\\b`, 'i').test(text)) found.add(t);
  }
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) {
    const word = m[0];
    if (!NOT_TICKERS.has(word)) found.add(word);
  }
  for (const m of text.matchAll(/\$([A-Za-z]{1,6})\b/g)) found.add(m[1].toUpperCase());

  // Ticker scritti in minuscolo dopo una preposizione ("su nvda", "per spcx"):
  // si accettano solo parole che non sono termini comuni o gergo di opzioni.
  for (const m of text.matchAll(/\b(?:su|sul|sullo|sulla|sugli|sulle|per|on|di)\s+([a-zA-Z]{2,6})\b/g)) {
    const word = m[1].toUpperCase();
    if (!NOT_TICKERS.has(word) && !COMMON_WORDS.has(word)) found.add(word);
  }
  return [...found].slice(0, 6);
}

function extractHorizon(text) {
  const horizon = { dte: null, expiry: null };

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) horizon.expiry = iso[1];

  const dte = text.match(/\b(\d{1,3})\s*(?:dte|giorni|gg|days?)\b/i);
  if (dte) horizon.dte = Number(dte[1]);

  if (horizon.dte === null) {
    const weeks = text.match(/\b(\d{1,2})\s*(?:settiman\w+|weeks?|w)\b/i);
    if (weeks) horizon.dte = Number(weeks[1]) * 7;
  }
  if (horizon.dte === null) {
    const months = text.match(/\b(\d{1,2})\s*(?:mes\w+|months?)\b/i);
    if (months) horizon.dte = Number(months[1]) * 30;
  }
  if (horizon.dte === null && /\bsettiman\w+\s+prossim\w+|\bnext\s+week\b/i.test(text)) horizon.dte = 7;
  if (horizon.dte === null && /\bmensil\w+\b|\bmonthly\b/i.test(text)) horizon.dte = 30;
  if (horizon.dte === null && /\bsettimanal\w+\b|\bweekly\b/i.test(text)) horizon.dte = 7;

  return horizon;
}

function extractScenarios(text) {
  const scenarios = [];

  const ivDown = text.match(/(?:vol\w*|iv)[^.,;]{0,30}?(?:scend\w+|cal\w+|-|giù|crolla\w*)[^.,;]{0,12}?(\d{1,3})\s*%/i);
  const ivUp = text.match(/(?:vol\w*|iv)[^.,;]{0,30}?(?:sal\w+|aument\w+|esplod\w+|\+)[^.,;]{0,12}?(\d{1,3})\s*%/i);
  const spotMove = text.match(/(?:sottostante|spot|titolo|prezzo)[^.,;]{0,30}?([+-]?\d{1,3})\s*%/i);
  const spotDown = text.match(/(?:sottostante|spot|titolo|prezzo)[^.,;]{0,30}?(?:scend\w+|cal\w+|perd\w+)[^.,;]{0,12}?(\d{1,3})\s*%/i);
  const spotUp = text.match(/(?:sottostante|spot|titolo|prezzo)[^.,;]{0,30}?(?:sal\w+|guadagn\w+|cresc\w+)[^.,;]{0,12}?(\d{1,3})\s*%/i);

  const scenario = { label: null, spot_change_pct: null, iv_change_pct: null, days_forward: null, rate_change_bps: null };
  if (ivDown) scenario.iv_change_pct = -Number(ivDown[1]);
  else if (ivUp) scenario.iv_change_pct = Number(ivUp[1]);
  if (spotDown) scenario.spot_change_pct = -Number(spotDown[1]);
  else if (spotUp) scenario.spot_change_pct = Number(spotUp[1]);
  else if (spotMove) scenario.spot_change_pct = Number(spotMove[1]);

  const forward = text.match(/\btra\s+(\d{1,3})\s*(?:giorni|gg)\b|\bfra\s+(\d{1,3})\s*(?:giorni|gg)\b/i);
  if (forward) scenario.days_forward = Number(forward[1] || forward[2]);

  if (scenario.iv_change_pct !== null || scenario.spot_change_pct !== null || scenario.days_forward !== null) {
    scenario.label = 'scenario richiesto';
    scenarios.push(scenario);
  }
  return scenarios;
}

function extractConstraints(text) {
  const c = {};
  const risk = text.match(/(?:rischi\w*|perdit\w*|perdere|max(?:imo)?)[^.,;]{0,25}?([\d.]{2,9})\s*(€|eur|euro|\$|usd|dollar\w*)?/i);
  if (risk) {
    const value = Number(risk[1].replace(/\.(?=\d{3}\b)/g, ''));
    if (Number.isFinite(value) && value >= 10) {
      c.max_risk = value;
      c.currency = /\$|usd|dollar/i.test(risk[2] || '') ? 'USD' : 'EUR';
    }
  }
  const credit = text.match(/credito[^.,;]{0,20}?([\d.,]+)/i);
  if (credit) {
    const value = Number(credit[1].replace(',', '.'));
    if (Number.isFinite(value)) c.min_credit = value;
  }
  const pop = text.match(/probabilit[àa]\w*[^.,;]{0,25}?(\d{1,3})\s*%/i);
  if (pop) c.min_pop = Number(pop[1]);
  if (/\bdelta\s*neutr\w+\b/i.test(text)) c.delta_neutral = true;
  if (/\brischio\s+definit\w+\b|\bdefined\s+risk\b/i.test(text)) c.defined_risk = true;
  if (/\bevit\w+[^.,;]{0,20}earning\w*|\bfuori\s+dagli\s+earning/i.test(text)) c.avoid_earnings = true;
  return c;
}

function firstMatch(patterns, text) {
  for (const [re, id] of patterns) {
    if (re.test(text)) return id;
  }
  return null;
}

function allMatches(patterns, text) {
  const out = [];
  for (const [re, id] of patterns) {
    if (re.test(text) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Ricava una query parziale dal testo libero. */
function extract(text) {
  const input = String(text || '');
  const strategy = firstMatch(STRATEGY_PATTERNS, input);
  const objective = firstMatch(OBJECTIVE_PATTERNS, input);
  const metrics = allMatches(METRIC_PATTERNS, input);
  const agents = allMatches(AGENT_PATTERNS, input);

  const query = {
    prompt: input.slice(0, 2000),
    underlyings: extractUnderlyings(input),
    horizon: extractHorizon(input),
    scenarios: extractScenarios(input),
    constraints: extractConstraints(input),
    metrics,
    agents,
  };
  if (strategy) query.strategy = strategy;
  if (objective) query.objective = objective;
  if (
    /\bconservativ\w+|\bprudent\w+/i.test(input) ||
    /\b(?:basso|poco|minimo|contenuto|ridotto|bassa|limitato)\s+rischi\w*/i.test(input) ||
    /\brischi\w*\s+(?:basso|contenuto|ridotto|minimo|limitato)\b/i.test(input) ||
    /\bsenza\s+(?:troppo\s+)?rischi\w*/i.test(input)
  ) {
    query.risk_profile = 'conservativo';
  } else if (
    /\baggressiv\w+|\bspeculativ\w+/i.test(input) ||
    /\b(?:alto|elevato|massimo)\s+rischi\w*/i.test(input) ||
    /\brischi\w*\s+(?:alto|elevato)\b/i.test(input)
  ) {
    query.risk_profile = 'aggressivo';
  }

  return query;
}

/** Unisce i frammenti dell'LLM con quelli delle regole (l'LLM ha priorità). */
function merge(primary, fallback) {
  const out = Object.assign({}, fallback, primary);
  out.horizon = Object.assign({}, fallback.horizon || {}, primary.horizon || {});
  if (out.horizon.dte === undefined || out.horizon.dte === null) {
    out.horizon.dte = (fallback.horizon || {}).dte ?? null;
  }
  out.constraints = Object.assign({}, fallback.constraints || {}, primary.constraints || {});
  for (const key of ['underlyings', 'metrics', 'agents', 'scenarios', 'legs']) {
    const p = Array.isArray(primary[key]) ? primary[key] : [];
    const f = Array.isArray(fallback[key]) ? fallback[key] : [];
    out[key] = p.length ? p : f;
  }
  return out;
}

export { extract, merge };
