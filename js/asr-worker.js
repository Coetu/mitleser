/* Mitleser – Spracherkennung im Hintergrund (Web Worker).
 *
 * Läuft komplett auf dem Gerät: Vosk (WebAssembly) mit dem deutschen Modell vosk-model-small-de-0.15.
 * Der Hauptthread schickt das Modellarchiv (ArrayBuffer) und danach Audio-Blöcke (Float32, -1…1).
 * Zurück kommen Teilergebnisse ("partial") und fertige Äußerungen ("final").
 * Die Audio-Blöcke kommen mit der Abtastrate des Geräts (meist 48 000 oder 44 100 pro Sekunde) und werden
 * hier mit resampler.js auf 16 000 umgerechnet – das ist die Rate des Modells und spart viel Rechenzeit.
 * Vosk selbst (WebAssembly) wird gleich beim Start des Workers geladen – parallel dazu liest der Hauptthread
 * das Modell aus dem Offline-Speicher oder lädt es herunter.
 *
 * Nachrichten an den Worker:
 *   {type:'load', archive}                 Modell laden (archive = .tar.gz als ArrayBuffer, wird übertragen)
 *   {type:'start', id, sampleRate}         neue Erkennungssitzung; alte Sitzung wird verworfen
 *   {type:'audio', id, seq, samples}       Audio-Block der Sitzung id (andere ids werden ignoriert)
 *   {type:'flush', id}                     aktuelle Äußerung sofort abschließen
 *   {type:'stop', id}                      Sitzung beenden
 * Nachrichten vom Worker:
 *   {type:'loaded', ms}  {type:'started', id}  {type:'partial', id, seq, text}
 *   {type:'final', id, seq, text, words}  {type:'tick', id, seq}  {type:'error', stage, message}
 */
'use strict';

importScripts('../lib/vosk-wasm.js', 'resampler.js');

const MODEL_DIR = '/modell';
const ARCHIVE_PATH = '/modell.tar.gz';
const TICK_EVERY = 6;
const MODEL_RATE = 16000; // Abtastrate, mit der Vosk gefüttert wird

let vosk = null;
let voskLoading = null; // Promise, solange Vosk geladen wird (siehe startVosk)
let model = null;
let recognizer = null;
let resampler = null;
let sessionId = 0;
let lastPartial = '';
let sinceReply = 0;
let heapPtr = 0;
let heapLen = 0;

function reply(message) {
  self.postMessage(message);
}

function fail(stage, error) {
  const message = error && error.message ? error.message : String(error);
  reply({ type: 'error', stage, message });
}

/** Fehlerausgabe von Vosk: nur echte Fehler in der Konsole zeigen, Hinweise und Warnungen verwerfen. */
function printVoskError(text) {
  const line = String(text);
  if (/error|abort|fail|exception|assert|memory/i.test(line)) console.warn('Vosk:', line);
}

/**
 * Lädt Vosk (übersetzt das WebAssembly) – nur einmal. Die vielen Zeilen, die Vosk beim Entpacken
 * des Modells ausgibt (Standardausgabe), werden verworfen.
 */
function startVosk() {
  if (!voskLoading) {
    voskLoading = Promise.resolve()
      .then(() => self.LoadVosk({ print() {}, printErr: printVoskError }))
      .then((instance) => {
        instance.SetLogLevel(-1);
        return instance;
      });
  }
  return voskLoading;
}

// Sofort beginnen: Das Übersetzen dauert auf dem iPad etwa eine Sekunde und läuft so parallel zum Lesen
// des Modells. Ein Fehler wird gemeldet, sobald das Modell kommt (load → {type:'error', stage:'load'}).
startVosk().catch(() => {});

function removeTree(path) {
  const FS = vosk.FS;
  for (const name of FS.readdir(path)) {
    if (name === '.' || name === '..') continue;
    const full = path + '/' + name;
    if (FS.isDir(FS.stat(full).mode)) removeTree(full);
    else FS.unlink(full);
  }
  FS.rmdir(path);
}

function extract(archivePath, targetDir) {
  return new Promise((resolve, reject) => {
    const helper = vosk.ArchiveHelper.implement({
      onsuccess: () => resolve(),
      onerror: (msg) => reject(new Error('Modellarchiv kann nicht entpackt werden: ' + msg)),
    });
    helper.Extract(archivePath, targetDir, true);
  });
}

async function load(archive) {
  const started = Date.now();
  if (!vosk) vosk = await startVosk(); // läuft meist schon fertig
  if (model) return Date.now() - started;
  vosk.FS.writeFile(ARCHIVE_PATH, new Uint8Array(archive), { canOwn: true });
  try {
    await extract(ARCHIVE_PATH, MODEL_DIR);
  } finally {
    vosk.FS.unlink(ARCHIVE_PATH);
  }
  model = new vosk.Model(MODEL_DIR);
  // Vosk hat alle Dateien eingelesen; die entpackten Kopien kosten nur noch Arbeitsspeicher.
  removeTree(MODEL_DIR);
  return Date.now() - started;
}

function dropRecognizer() {
  if (recognizer) {
    try { recognizer.delete(); } catch (e) { /* schon freigegeben */ }
  }
  recognizer = null;
  resampler = null;
  lastPartial = '';
}

function start(id, sampleRate) {
  if (!model) throw new Error('Das Sprachmodell ist noch nicht geladen.');
  dropRecognizer();
  // Neuer Umrechner je Sitzung (die Geräte-Abtastrate kann sich nach einem Neustart des Mikrofons ändern).
  const converter = self.MitleserResampler.create(sampleRate, MODEL_RATE);
  recognizer = new vosk.Recognizer(model, MODEL_RATE);
  recognizer.SetWords(true);
  resampler = converter;
  sessionId = id;
  sinceReply = 0;
}

function ensureHeap(length) {
  if (heapLen >= length) return;
  if (heapPtr) vosk._free(heapPtr);
  heapPtr = vosk._malloc(length * 4);
  heapLen = length;
}

function finalMessage(json, seq) {
  const result = JSON.parse(json);
  lastPartial = '';
  sinceReply = 0;
  return {
    type: 'final',
    id: sessionId,
    seq,
    text: result.text || '',
    words: (result.result || []).map((w) => ({ word: w.word, conf: w.conf, start: w.start, end: w.end })),
  };
}

function feed(pcm) {
  const n = pcm.length;
  ensureHeap(n);
  // Vosk erwartet Werte im Bereich von 16-Bit-Ganzzahlen.
  const heap = vosk.HEAPF32;
  const base = heapPtr >> 2;
  for (let i = 0; i < n; i++) heap[base + i] = pcm[i] * 32768;
  return recognizer.AcceptWaveform(heapPtr, n);
}

function audio(seq, samples) {
  // Auf 16 kHz umrechnen. Ganz am Anfang einer Sitzung kann ein sehr kleiner Block noch leer ausgehen.
  const pcm = resampler.process(samples);
  if (pcm.length > 0 && feed(pcm)) {
    reply(finalMessage(recognizer.Result(), seq));
    return;
  }
  const partial = JSON.parse(recognizer.PartialResult()).partial || '';
  if (partial !== lastPartial) {
    lastPartial = partial;
    sinceReply = 0;
    reply({ type: 'partial', id: sessionId, seq, text: partial });
  } else if (++sinceReply >= TICK_EVERY) {
    sinceReply = 0;
    reply({ type: 'tick', id: sessionId, seq });
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'load': {
        const ms = await load(msg.archive);
        reply({ type: 'loaded', ms });
        break;
      }
      case 'start':
        start(msg.id, msg.sampleRate);
        reply({ type: 'started', id: msg.id });
        break;
      case 'audio':
        if (recognizer && msg.id === sessionId) audio(msg.seq, msg.samples);
        break;
      case 'flush':
        if (recognizer && msg.id === sessionId) reply(finalMessage(recognizer.FinalResult(), -1));
        break;
      case 'stop':
        if (msg.id === sessionId) {
          dropRecognizer();
          sessionId = 0;
        }
        break;
      default:
        break;
    }
  } catch (error) {
    fail(msg && msg.type, error);
  }
};
