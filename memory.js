/**
 * Memoria locale dell'agente — persistenza su file JSON, nessun database.
 *
 * I ricordi sono fatti brevi sull'utente o sulle conversazioni passate
 * (es. "L'utente si chiama Daniele", "Preferisce risposte concise").
 * Vengono salvati in data/memory.json e iniettati nel prompt di sistema
 * a ogni conversazione, così l'agente "ricorda" tra una sessione e l'altra.
 *
 * Variabili d'ambiente:
 *   MEMORY_DIR  cartella dei dati (default ./data)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.MEMORY_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'memory.json');
const MAX_ENTRIES = 200;

let entries = null; // [{id, text, createdAt}]

function load() {
  if (entries) return entries;
  try {
    entries = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  return entries;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(entries, null, 2));
}

function list() {
  return load().slice();
}

function add(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  load();
  // Evita duplicati esatti
  const existing = entries.find((e) => e.text === clean);
  if (existing) return existing;
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: clean,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  persist();
  return entry;
}

function remove(id) {
  load();
  const before = entries.length;
  entries = entries.filter((e) => e.id !== id);
  if (entries.length !== before) {
    persist();
    return true;
  }
  return false;
}

function clear() {
  entries = [];
  persist();
}

// Testo pronto da iniettare nel prompt di sistema
function asPromptText() {
  const all = load();
  if (all.length === 0) return '';
  const lines = all.map((e) => `- [${e.id}] ${e.text}`).join('\n');
  return (
    `\n\n## Memoria locale\n` +
    `Fatti che hai memorizzato nelle conversazioni precedenti con questo utente:\n${lines}\n` +
    `Usali quando sono pertinenti, senza elencarli se non richiesto.`
  );
}

module.exports = { list, add, remove, clear, asPromptText };
