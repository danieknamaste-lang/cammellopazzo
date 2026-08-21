/**
 * Persistenza su file JSON in DATA_DIR (volume Umbrel).
 *
 * Storico, preset e impostazioni vivono sul server e non nel browser: così la
 * stessa cronologia si ritrova dal telefono, dal portatile o dal mini.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { current, applySettings } = require('./config');

const HISTORY_LIMIT = 200;
const files = {
  history: 'history.json',
  presets: 'presets.json',
  settings: 'settings.json',
};

// Se la cartella dati non è scrivibile (bind mount di root, disco pieno, volume
// in sola lettura) l'app non deve morire: si ripiega su una cartella temporanea
// e lo dichiara alla UI, invece di andare in crash loop.
let storage = { ok: true, dir: null, reason: null, persistent: true };

function filePath(name) {
  return path.join(storage.dir || current.dataDir, files[name] || name);
}

async function probe(dir) {
  await fsp.mkdir(dir, { recursive: true });
  const token = path.join(dir, `.write-test-${process.pid}`);
  await fsp.writeFile(token, 'ok');
  await fsp.unlink(token);
}

async function ensureDir() {
  try {
    await probe(current.dataDir);
    storage = { ok: true, dir: current.dataDir, reason: null, persistent: true };
    return storage;
  } catch (err) {
    const fallback = path.join(os.tmpdir(), 'options-agent-data');
    console.error(
      `Cartella dati non scrivibile (${current.dataDir}): ${err.code || err.message}. ` +
        'Su Umbrel di solito è la proprietà del volume: prova ' +
        '`sudo chown -R 1000:1000 ~/umbrel/app-data/cammellopazzo-options-agent/data`.'
    );
    try {
      await probe(fallback);
      storage = {
        ok: true,
        dir: fallback,
        persistent: false,
        reason: `${current.dataDir} non è scrivibile (${err.code || err.message}): storico e preset restano in ${fallback} e si perdono al riavvio.`,
      };
      console.error(`Uso la cartella temporanea ${fallback}: i dati non sopravvivono al riavvio.`);
    } catch (fallbackErr) {
      storage = {
        ok: false,
        dir: current.dataDir,
        persistent: false,
        reason: `Nessuna cartella scrivibile (${err.code || err.message}): storico e preset non vengono salvati.`,
      };
    }
    return storage;
  }
}

function storageStatus() {
  return Object.assign({}, storage);
}

async function read(name, fallback) {
  try {
    const raw = await fsp.readFile(filePath(name), 'utf8');
    const data = JSON.parse(raw);
    return data === null || data === undefined ? fallback : data;
  } catch {
    return fallback;
  }
}

async function write(name, data) {
  if (!storage.dir) await ensureDir();
  if (!storage.ok) return data; // nessuna cartella scrivibile: si continua senza salvare
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, target);
  } catch (err) {
    storage.ok = false;
    storage.reason = `Scrittura fallita in ${target} (${err.code || err.message}): storico e preset non vengono salvati.`;
    console.error(storage.reason);
  }
  return data;
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------------
// Storico
// ---------------------------------------------------------------------------

async function listHistory() {
  const items = await read('history', []);
  return Array.isArray(items) ? items : [];
}

async function addHistory(entry) {
  const items = await listHistory();
  const record = Object.assign({ id: newId(), created_at: new Date().toISOString() }, entry);
  items.unshift(record);
  await write('history', items.slice(0, HISTORY_LIMIT));
  return record;
}

async function getHistory(id) {
  const items = await listHistory();
  return items.find((item) => item.id === id) || null;
}

async function deleteHistory(id) {
  const items = await listHistory();
  const next = id === 'all' ? [] : items.filter((item) => item.id !== id);
  await write('history', next);
  return next.length;
}

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

async function listPresets() {
  const items = await read('presets', []);
  return Array.isArray(items) ? items : [];
}

async function addPreset(name, query) {
  const items = await listPresets();
  const record = { id: newId(), name: String(name || 'Senza nome').slice(0, 80), query, created_at: new Date().toISOString() };
  items.unshift(record);
  await write('presets', items.slice(0, 60));
  return record;
}

async function deletePreset(id) {
  const items = await listPresets();
  await write('presets', items.filter((item) => item.id !== id));
}

// ---------------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------------

async function loadSettings() {
  const saved = await read('settings', null);
  if (saved) applySettings(saved);
  return saved;
}

async function saveSettings(settings) {
  const stored = (await read('settings', {})) || {};
  const merged = {
    multiagent: Object.assign({}, stored.multiagent || {}, settings.multiagent || {}),
    planner: settings.planner || stored.planner,
  };
  // Il token vuoto non cancella quello d'ambiente: si azzera solo con null esplicito.
  if (settings.multiagent && settings.multiagent.token === '') delete merged.multiagent.token;
  applySettings(merged);
  await write('settings', merged);
  return merged;
}

module.exports = {
  ensureDir,
  storageStatus,
  listHistory,
  addHistory,
  getHistory,
  deleteHistory,
  listPresets,
  addPreset,
  deletePreset,
  loadSettings,
  saveSettings,
};
