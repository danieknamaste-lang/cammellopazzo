/**
 * Persistenza su file JSON in DATA_DIR (volume Umbrel).
 *
 * Storico, preset e impostazioni vivono sul server e non nel browser: così la
 * stessa cronologia si ritrova dal telefono, dal portatile o dal mini.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { current, applySettings } = require('./config');

const HISTORY_LIMIT = 200;
const files = {
  history: 'history.json',
  presets: 'presets.json',
  settings: 'settings.json',
};

function filePath(name) {
  return path.join(current.dataDir, files[name] || name);
}

async function ensureDir() {
  await fsp.mkdir(current.dataDir, { recursive: true });
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
  await ensureDir();
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, target);
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
