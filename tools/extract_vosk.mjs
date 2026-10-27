// Erzeugt lib/vosk-wasm.js aus dem npm-Paket vosk-browser 0.0.8 (dist/vosk.js).
//
// vosk-browser bettet seinen Web Worker als Base64-Text in dist/vosk.js ein. In diesem Worker steckt
// der Emscripten-Code von Vosk (inklusive WebAssembly als data:-URL). Mitleser benutzt einen eigenen
// Worker (js/asr-worker.js) und braucht davon nur die Fabrikfunktion `LoadVosk`. Dieses Skript schneidet
// genau diesen Teil unverändert heraus. Es führt den fremden Code nicht aus, es verarbeitet nur Text.
//
// Aufruf (einmalig, nur zum Nachvollziehen nötig):
//   npm pack vosk-browser@0.0.8 && tar -xzf vosk-browser-0.0.8.tgz
//   node tools/extract_vosk.mjs package/dist/vosk.js lib/vosk-wasm.js

import { readFileSync, writeFileSync } from 'node:fs';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('Aufruf: node tools/extract_vosk.mjs <vosk.js> <ziel.js>');
  process.exit(1);
}

const bundle = readFileSync(src, 'utf8');
const key = "createBase64WorkerFactory('";
const start = bundle.indexOf(key);
if (start < 0) throw new Error('Worker-Code nicht gefunden – andere vosk-browser-Version?');
const end = bundle.indexOf("'", start + key.length);
const worker = Buffer.from(bundle.slice(start + key.length, end), 'base64').toString('utf8');

const begin = worker.indexOf('var voskWasm = {exports: {}};');
const endMarker = 'var LoadVosk = voskWasm.exports;';
const stop = worker.indexOf(endMarker);
if (begin < 0 || stop < 0) throw new Error('LoadVosk-Abschnitt nicht gefunden');

const header = `/*
 * Vosk WebAssembly (Emscripten-Ausgabe), unverändert entnommen aus vosk-browser 0.0.8
 * (https://github.com/ccoreilly/vosk-browser, Lizenz Apache-2.0, siehe lib/LICENSE-vosk-browser.txt).
 * Enthält Vosk (Apache-2.0), Kaldi (Apache-2.0), OpenFst (Apache-2.0), CLAPACK (BSD), libarchive (BSD), zlib.
 * Herausgelöst mit tools/extract_vosk.mjs, damit Mitleser einen eigenen Web Worker benutzen kann.
 * Stellt die globale Funktion LoadVosk() bereit (für importScripts in einem Worker).
 */
`;
writeFileSync(dest, header + worker.slice(begin, stop + endMarker.length) + '\n');
console.log(`${dest} geschrieben (${(worker.slice(begin, stop).length / 1e6).toFixed(2)} MB)`);
