/**
 * Configurazione dell'agente opzioni.
 *
 * I valori arrivano dalle variabili d'ambiente (impostate da Umbrel al deploy) e
 * possono essere sovrascritti a caldo dalle impostazioni salvate in DATA_DIR:
 * così l'endpoint del sistema multiagentico si può cambiare dal telefono senza
 * riavviare il container.
 */

'use strict';

const path = require('path');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== undefined ? n : fallback;
}

function clean(value) {
  return String(value || '').trim();
}

const MODES = ['auto', 'openai', 'json', 'sse', 'ollama', 'mock'];

const env = {
  port: num(process.env.PORT, 3100),
  host: clean(process.env.HOST) || '0.0.0.0',
  dataDir: clean(process.env.DATA_DIR) || path.join(__dirname, '..', 'data'),
  appToken: clean(process.env.APP_TOKEN),
  maxSteps: Math.max(1, Math.min(4, num(process.env.AGENT_MAX_STEPS, 2))),
  multiagent: {
    url: clean(process.env.MULTIAGENT_URL).replace(/\/+$/, ''),
    mode: (clean(process.env.MULTIAGENT_MODE) || 'auto').toLowerCase(),
    path: clean(process.env.MULTIAGENT_PATH),
    token: clean(process.env.MULTIAGENT_TOKEN),
    model: clean(process.env.MULTIAGENT_MODEL),
    timeoutMs: num(process.env.MULTIAGENT_TIMEOUT_MS, 180000),
  },
  planner: {
    mode: (clean(process.env.PLANNER) || 'auto').toLowerCase(),
    anthropicKey: clean(process.env.ANTHROPIC_API_KEY),
    anthropicModel: clean(process.env.CLAUDE_MODEL) || 'claude-sonnet-5',
    deepseekKey: clean(process.env.DEEPSEEK_API_KEY),
    deepseekModel: clean(process.env.DEEPSEEK_MODEL) || 'deepseek-chat',
    deepseekUrl: clean(process.env.DEEPSEEK_API_URL) || 'https://api.deepseek.com/chat/completions',
    ollamaUrl: (clean(process.env.OLLAMA_URL) || 'http://localhost:11434').replace(/\/+$/, ''),
    ollamaModel: clean(process.env.OLLAMA_MODEL),
  },
};

// Copia mutabile: le impostazioni salvate dalla UI si applicano qui sopra.
const current = JSON.parse(JSON.stringify(env));

/** Sovrascrive i campi modificabili dalla UI (gli altri restano quelli d'ambiente). */
function applySettings(settings) {
  if (!settings || typeof settings !== 'object') return current;
  const ma = settings.multiagent || {};
  if (typeof ma.url === 'string') current.multiagent.url = ma.url.trim().replace(/\/+$/, '');
  if (typeof ma.mode === 'string' && MODES.includes(ma.mode)) current.multiagent.mode = ma.mode;
  if (typeof ma.path === 'string') current.multiagent.path = ma.path.trim();
  if (typeof ma.model === 'string') current.multiagent.model = ma.model.trim();
  if (typeof ma.token === 'string' && ma.token) current.multiagent.token = ma.token;
  if (ma.token === null) current.multiagent.token = env.multiagent.token;
  if (typeof settings.planner === 'string') current.planner.mode = settings.planner.toLowerCase();
  return current;
}

/** Vista pubblica: nessun segreto esce verso il browser. */
function publicView() {
  return {
    multiagent: {
      url: current.multiagent.url,
      mode: current.multiagent.mode,
      path: current.multiagent.path,
      model: current.multiagent.model,
      hasToken: Boolean(current.multiagent.token),
      timeoutMs: current.multiagent.timeoutMs,
    },
    planner: {
      mode: current.planner.mode,
      available: plannerCandidates(),
    },
    maxSteps: current.maxSteps,
    protectedByToken: Boolean(current.appToken),
  };
}

/** Provider utilizzabili dal pianificatore, in ordine di preferenza. */
function plannerCandidates() {
  const list = [];
  if (current.planner.anthropicKey) list.push('anthropic');
  if (current.planner.deepseekKey) list.push('deepseek');
  if (current.planner.ollamaUrl) list.push('ollama');
  list.push('rules');
  return list;
}

module.exports = { env, current, MODES, applySettings, publicView, plannerCandidates };
