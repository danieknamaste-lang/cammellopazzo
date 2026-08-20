/**
 * Pianificatore: è la parte "agente" del servizio.
 *
 *   1. plan()   → dal linguaggio naturale costruisce la query strutturata
 *   2. refine() → letta la risposta del sistema multiagentico, decide se serve
 *                 una seconda query di approfondimento e la scrive
 *
 * Se nessun LLM è configurato si ricade sull'estrattore a regole: l'agente
 * continua a funzionare, con meno finezza.
 */

'use strict';

const llm = require('./llm');
const rules = require('./rules');
const schema = require('./schema');

const SCHEMA_HINT = JSON.stringify(
  {
    objective: schema.OBJECTIVES.map((o) => o.id),
    underlyings: ['TICKER'],
    strategy: schema.STRATEGIES.map((s) => s.id),
    legs: [{ side: 'buy|sell', type: 'call|put|stock', strike: 'numero|null', expiry: 'YYYY-MM-DD|null', dte: 'numero|null', qty: 'numero', delta: 'numero|null' }],
    horizon: { dte: 'numero|null', expiry: 'YYYY-MM-DD|null' },
    scenarios: [{ label: 'testo', spot_change_pct: 'numero|null', iv_change_pct: 'numero|null', days_forward: 'numero|null', rate_change_bps: 'numero|null' }],
    metrics: schema.METRICS.map((m) => m.id),
    constraints: {
      max_risk: 'numero', max_capital: 'numero', min_credit: 'numero', max_debit: 'numero',
      min_pop: 'numero', target_delta: 'numero', min_open_interest: 'numero', max_bid_ask_pct: 'numero',
      currency: 'EUR|USD', delta_neutral: 'bool', defined_risk: 'bool', avoid_earnings: 'bool', extra: 'testo',
    },
    agents: schema.AGENTS.map((a) => a.id),
    risk_profile: 'conservativo|moderato|aggressivo',
    notes: 'testo',
  },
  null,
  1
);

const PLAN_SYSTEM =
  'Sei il pianificatore di un sistema multiagentico per il trading in opzioni. ' +
  "Trasformi la richiesta dell'utente in una query strutturata JSON. " +
  'Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo attorno. ' +
  'Compila solo i campi che la richiesta giustifica: non inventare strike, scadenze, ' +
  'prezzi o vincoli che l\'utente non ha indicato (usa null o ometti il campo). ' +
  'Se la richiesta è ambigua, elenca i dubbi nel campo "notes".\n\n' +
  `Schema dei valori ammessi:\n${SCHEMA_HINT}`;

const REFINE_SYSTEM =
  'Sei il supervisore di un agente che interroga un sistema multiagentico di opzioni. ' +
  'Hai la query inviata e la risposta ricevuta. Decidi se una seconda query mirata ' +
  'aggiungerebbe valore reale (dati mancanti, scenario non valutato, rischio non quantificato). ' +
  'Rispondi ESCLUSIVAMENTE in JSON: ' +
  '{"follow_up": true|false, "reason": "una frase", "query": { ...query completa come nello schema... }}. ' +
  'Se la risposta è già completa metti follow_up=false e ometti "query".';

/** Linguaggio naturale → query strutturata. */
async function plan(text, options = {}) {
  const fallback = rules.extract(text);
  const baseline = schema.normalizeQuery(
    rules.merge(options.base ? options.base : {}, fallback)
  );

  let result = null;
  let error = null;
  try {
    result = await llm.complete({
      system: PLAN_SYSTEM,
      prompt: `Richiesta dell'utente:\n"""${String(text || '').slice(0, 4000)}"""\n\nRestituisci la query JSON.`,
      json: true,
      maxTokens: 1200,
    });
  } catch (err) {
    error = err.message;
  }

  if (!result || !result.text) {
    return {
      query: baseline,
      source: 'rules',
      provider: null,
      note: error
        ? `Pianificatore LLM non disponibile (${error}): uso le regole locali.`
        : 'Nessun LLM configurato: query costruita dalle regole locali.',
    };
  }

  const parsed = llm.parseJson(result.text);
  if (!parsed) {
    return {
      query: baseline,
      source: 'rules',
      provider: result.provider,
      note: 'Il pianificatore non ha restituito JSON valido: uso le regole.',
    };
  }

  parsed.prompt = String(text || '').slice(0, 2000);
  const query = schema.normalizeQuery(rules.merge(parsed, fallback));
  return { query, source: 'llm', provider: result.provider, model: result.model, note: null };
}

/** Decide se serve un secondo giro e con quale query. */
async function refine(query, answer) {
  const trimmed = String(answer || '').slice(0, 12000);
  if (!trimmed.trim()) return { followUp: false, reason: 'Nessuna risposta da valutare.' };

  let result = null;
  try {
    result = await llm.complete({
      system: REFINE_SYSTEM,
      prompt:
        `Query inviata:\n${JSON.stringify(query, null, 1)}\n\n` +
        `Risposta del sistema multiagentico:\n"""${trimmed}"""`,
      json: true,
      maxTokens: 1200,
    });
  } catch (err) {
    return { followUp: false, reason: `Valutazione non disponibile: ${err.message}` };
  }

  if (!result || !result.text) return { followUp: false, reason: 'Nessun LLM per la valutazione.' };

  const parsed = llm.parseJson(result.text);
  if (!parsed || !parsed.follow_up || !parsed.query) {
    return { followUp: false, reason: parsed?.reason || 'Risposta già completa.' };
  }

  const next = schema.normalizeQuery(rules.merge(parsed.query, query));
  next.notes = [query.notes, parsed.reason].filter(Boolean).join(' — ').slice(0, 600);
  return { followUp: true, reason: parsed.reason || 'Approfondimento', query: next };
}

module.exports = { plan, refine };
