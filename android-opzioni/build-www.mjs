/**
 * Prepara la cartella www/ per Capacitor: interfaccia + moduli condivisi.
 *
 * L'app Android non ha un server Node dietro, quindi porta con sé lo schema e
 * le regole (gli stessi file usati dal server) e parla direttamente con il
 * sistema multiagentico sul mac.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sorgente = path.join(here, '..', 'options-agent');
const destinazione = path.join(here, 'www');

// public/ contiene già i moduli condivisi (public/lib): basta copiarla.
fs.rmSync(destinazione, { recursive: true, force: true });
fs.mkdirSync(destinazione, { recursive: true });
fs.cpSync(path.join(sorgente, 'public'), destinazione, { recursive: true });

// Nell'app non esiste un server dell'applicazione: niente probe inutile all'avvio.
const indice = path.join(destinazione, 'index.html');
fs.writeFileSync(
  indice,
  fs
    .readFileSync(indice, 'utf8')
    .replace('<script type="module" src="app.js">', '<script>window.OPZIONI_STANDALONE = true;</script>\n    <script type="module" src="app.js">')
);

const conteggio = fs.readdirSync(destinazione, { recursive: true }).length;
console.log(`www pronta in ${destinazione} (${conteggio} voci)`);
