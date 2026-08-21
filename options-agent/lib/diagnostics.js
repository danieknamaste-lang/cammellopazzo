/**
 * Diagnostica: un colpo d'occhio su configurazione, collegamento, storage e
 * ultimi errori. Serve a farsi mandare lo stato dal telefono senza dover
 * leggere i log del container. Non espone segreti: solo "presente / assente".
 */

'use strict';

const os = require('os');

const MAX_ERRORS = 20;
const errors = [];
const startedAt = Date.now();

/** Registra un errore per la diagnostica (server o client). */
function record(where, message, extra) {
  errors.unshift({
    at: new Date().toISOString(),
    where: String(where || 'sconosciuto').slice(0, 60),
    message: String(message || '').slice(0, 500),
    extra: extra ? String(extra).slice(0, 300) : undefined,
  });
  errors.length = Math.min(errors.length, MAX_ERRORS);
}

function recent() {
  return errors.slice();
}

/** Quali variabili d'ambiente sono impostate (mai il loro valore). */
function envPresence() {
  const keys = [
    'MULTIAGENT_URL', 'MULTIAGENT_MODE', 'MULTIAGENT_PATH', 'MULTIAGENT_MODEL', 'MULTIAGENT_TOKEN',
    'PLANNER', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'OLLAMA_URL', 'APP_TOKEN', 'DATA_DIR', 'PORT',
  ];
  const out = {};
  for (const key of keys) {
    const value = process.env[key];
    const secret = /KEY|TOKEN/.test(key);
    out[key] = value === undefined || value === '' ? null : secret ? '(impostata)' : value;
  }
  return out;
}

async function build({ config, connector, storage, llm }) {
  let planner = { provider: null, model: null, error: null };
  try {
    const resolved = await llm.resolveProvider();
    if (resolved) planner = { provider: resolved.name, model: resolved.model, error: null };
    else planner.error = 'nessun provider disponibile: si usano le regole locali';
  } catch (err) {
    planner.error = err.message;
  }

  return {
    generato: new Date().toISOString(),
    app: {
      versione: require('../package.json').version,
      node: process.version,
      piattaforma: `${os.platform()} ${os.arch()}`,
      utente_uid: typeof process.getuid === 'function' ? process.getuid() : null,
      attiva_da_s: Math.round((Date.now() - startedAt) / 1000),
    },
    configurazione: config,
    collegamento: connector,
    storage,
    pianificatore: planner,
    ambiente: envPresence(),
    errori_recenti: recent(),
  };
}

module.exports = { record, recent, build };
