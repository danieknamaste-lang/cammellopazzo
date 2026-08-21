/**
 * Modalità autonoma: l'agente gira dentro la pagina, senza server Node.
 *
 * È quello che usa l'app Android — il telefono parla direttamente con il
 * sistema multiagentico sul mac (via Tailscale), senza passare da Umbrel.
 * Espone la stessa superficie del server, così l'interfaccia non cambia.
 *
 * Il pianificatore qui è quello a regole: nessuna chiave API viene salvata sul
 * telefono. Il ragionamento vero lo fanno gli agenti sul mac.
 */

import * as schema from '../lib/schema.js';
import * as rules from '../lib/rules.js';
import * as connector from './connector-client.js';

const CHIAVI = {
  impostazioni: 'opzioni.settings',
  storico: 'opzioni.history',
  preset: 'opzioni.presets',
};

const LIMITE_STORICO = 100;

function leggi(chiave, fallback) {
  try {
    const grezzo = localStorage.getItem(chiave);
    return grezzo ? JSON.parse(grezzo) : fallback;
  } catch {
    return fallback;
  }
}

function scrivi(chiave, valore) {
  try {
    localStorage.setItem(chiave, JSON.stringify(valore));
    return true;
  } catch {
    return false; // spazio esaurito o storage negato: si continua senza salvare
  }
}

function id() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function impostazioni() {
  return Object.assign(
    { url: '', mode: 'auto', path: '', model: '', token: '', timeoutMs: 180000 },
    leggi(CHIAVI.impostazioni, {})
  );
}

function salvaImpostazioni(parziali) {
  const unite = Object.assign(impostazioni(), parziali);
  scrivi(CHIAVI.impostazioni, unite);
  return unite;
}

function vistaConfig() {
  const s = impostazioni();
  return {
    multiagent: {
      url: s.url, mode: s.mode, path: s.path, model: s.model,
      hasToken: Boolean(s.token), timeoutMs: s.timeoutMs,
    },
    planner: { mode: 'rules', available: ['rules'] },
    maxSteps: 1,
    protectedByToken: false,
    standalone: true,
  };
}

function statoStorage() {
  const prova = scrivi('opzioni.test', Date.now());
  return {
    ok: prova,
    dir: 'memoria del telefono',
    persistent: prova,
    reason: prova ? null : 'Il browser non consente di salvare: storico e preset non vengono conservati.',
  };
}

function storico() {
  const voci = leggi(CHIAVI.storico, []);
  return Array.isArray(voci) ? voci : [];
}

function preset() {
  const voci = leggi(CHIAVI.preset, []);
  return Array.isArray(voci) ? voci : [];
}

/** Risponde come farebbe il server, ma tutto in locale. */
export async function handle(percorso, opzioni = {}) {
  const metodo = (opzioni.method || 'GET').toUpperCase();
  const corpo = opzioni.body ? JSON.parse(opzioni.body) : {};
  const [, , risorsa, parametro] = percorso.split('?')[0].split('/');

  if (risorsa === 'config') {
    return {
      config: vistaConfig(),
      connector: await connector.status(impostazioni()),
      storage: statoStorage(),
      schema: {
        objectives: schema.OBJECTIVES,
        strategies: schema.STRATEGIES,
        metrics: schema.METRICS,
        agents: schema.AGENTS,
        sides: schema.SIDES,
        types: schema.TYPES,
        defaults: schema.DEFAULT_QUERY,
      },
    };
  }

  if (risorsa === 'status') {
    return connector.status(impostazioni(), percorso.includes('refresh=1'));
  }

  if (risorsa === 'plan') {
    const query = schema.normalizeQuery(rules.extract(corpo.text || ''));
    return {
      query,
      summary: schema.describeQuery(query),
      prompt: schema.queryToPrompt(query),
      source: 'rules',
      provider: null,
      model: null,
      note: 'Query costruita dalle regole locali: il ragionamento lo fanno gli agenti sul mac.',
    };
  }

  if (risorsa === 'preview') {
    const query = schema.normalizeQuery(corpo.query);
    return { query, summary: schema.describeQuery(query), prompt: schema.queryToPrompt(query) };
  }

  if (risorsa === 'history') {
    if (metodo === 'DELETE') {
      scrivi(CHIAVI.storico, parametro === 'all' ? [] : storico().filter((v) => v.id !== parametro));
      return { ok: true };
    }
    if (parametro) {
      const voce = storico().find((v) => v.id === parametro);
      if (!voce) throw new Error('Voce non trovata');
      return voce;
    }
    return {
      items: storico().map((v) => ({
        id: v.id, created_at: v.created_at, summary: v.summary, mode: v.mode, steps: v.steps,
        preview: String(v.answer || '').replace(/\s+/g, ' ').slice(0, 160),
      })),
    };
  }

  if (risorsa === 'presets') {
    if (metodo === 'DELETE') {
      scrivi(CHIAVI.preset, preset().filter((v) => v.id !== parametro));
      return { ok: true };
    }
    if (metodo === 'POST') {
      const voce = {
        id: id(),
        name: String(corpo.name || 'Senza nome').slice(0, 80),
        query: schema.normalizeQuery(corpo.query),
        created_at: new Date().toISOString(),
      };
      scrivi(CHIAVI.preset, [voce, ...preset()].slice(0, 60));
      return voce;
    }
    return { items: preset() };
  }

  if (risorsa === 'settings') {
    const ma = corpo.multiagent || {};
    salvaImpostazioni({
      url: String(ma.url || '').trim().replace(/\/+$/, ''),
      mode: ma.mode || 'auto',
      path: String(ma.path || '').trim(),
      model: String(ma.model || '').trim(),
      ...(ma.token ? { token: ma.token } : {}),
    });
    return { config: vistaConfig(), connector: await connector.status(impostazioni(), true) };
  }

  if (risorsa === 'diagnostics') {
    return {
      generato: new Date().toISOString(),
      app: { versione: 'standalone', piattaforma: navigator.userAgent.slice(0, 120) },
      configurazione: vistaConfig(),
      collegamento: await connector.status(impostazioni(), true),
      storage: statoStorage(),
      pianificatore: { provider: null, model: null, error: 'modalità autonoma: si usano le regole locali' },
      errori_recenti: leggi('opzioni.errors', []),
    };
  }

  if (risorsa === 'client-error') {
    const elenco = leggi('opzioni.errors', []);
    elenco.unshift({ at: new Date().toISOString(), where: corpo.where, message: corpo.message });
    scrivi('opzioni.errors', elenco.slice(0, 20));
    return { ok: true };
  }

  throw new Error(`Endpoint ${percorso} non disponibile in modalità autonoma`);
}

/** Equivalente di POST /api/run: pianifica, interroga, salva nello storico. */
export async function run(payload, emit, signal) {
  const inizio = Date.now();
  let query;
  let info = null;

  if (payload.query && typeof payload.query === 'object') {
    query = schema.normalizeQuery(payload.query);
    if (payload.text && !query.prompt) query.prompt = String(payload.text).slice(0, 2000);
  } else {
    emit({ type: 'status', text: 'Pianifico la query…' });
    query = schema.normalizeQuery(rules.extract(payload.text || ''));
    info = { source: 'rules', note: 'Query costruita dalle regole locali.' };
  }

  emit({
    type: 'query',
    query,
    summary: schema.describeQuery(query),
    source: info ? info.source : 'manual',
    provider: null,
    note: info ? info.note : null,
    prompt: schema.queryToPrompt(query),
  });

  const esito = await connector.run(query, impostazioni(), { emit, signal });

  const voce = {
    id: id(),
    created_at: new Date().toISOString(),
    query,
    summary: schema.describeQuery(query),
    answer: esito.text,
    mode: esito.mode,
    steps: 1,
    elapsed_ms: Date.now() - inizio,
  };
  scrivi(CHIAVI.storico, [voce, ...storico()].slice(0, LIMITE_STORICO));

  emit({ type: 'done', id: voce.id, elapsed_ms: voce.elapsed_ms, steps: 1 });
}
