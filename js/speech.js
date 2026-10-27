// Mitleser – Steuerung der Spracherkennung im Hauptthread: Sprachmodell, Mikrofon und Erkennungs-Worker.
//
// So läuft es ab:
//   1. loadModel(): Das Sprachmodell (ca. 46 MB) kommt aus dem Offline-Speicher des Browsers (Cache Storage)
//      oder wird einmalig heruntergeladen, geprüft und dort abgelegt. Danach bekommt es der Worker
//      (asr-worker.js), der es entpackt und Vosk damit startet.
//   2. start(): Mikrofon einschalten. Auf dem iPad muss der Audio-Kontext direkt in der Tipp-/Klick-Geste
//      entstehen – deshalb passiert das ganz am Anfang von start(), noch vor jedem "await".
//   3. Ein AudioWorklet-Knoten (audio-worklet.js) liefert das Mikrofonsignal in Blöcken zu 4096 Werten.
//      Die Blöcke gehen an den Worker; der rechnet sie auf 16 kHz um und erkennt die Wörter.
//   4. Erkannte Wörter kommen als Ereignis 'words', der Zustand als Ereignis 'status', der Pegel als 'level'.
//
// Sitzungen: Jede Sitzung hat eine Nummer (speech.session). Eine neue Sitzung verwirft das bisher Gesagte
// (z. B. beim Blättern); Ergebnisse älterer Sitzungen werden ignoriert. Nach jedem Sitzungswechsel kommt
// kurz darauf ein leeres 'words'-Ereignis {words: [], final: true} für die neue Sitzung – so weiß der
// Wortabgleich sicher, dass eine neue Äußerung beginnt (auch nach Pause oder interner Neusynchronisierung).
//
// Diese Datei ist eigenständig: Sie importiert keine anderen Module der App.

const DEFAULTS = {
  workerUrl: new URL('./asr-worker.js', import.meta.url),
  workletUrl: new URL('./audio-worklet.js', import.meta.url),
  modelUrl: new URL('../models/vosk-model-small-de-0.15.tar.gz', import.meta.url),
  modelBytes: 46376422,
};

const MODEL_CACHE = 'mitleser-modell-v1'; // Name des Offline-Speichers für das Modell (sw.js löscht ihn nie)
const CHUNK_FRAMES = 4096;               // Blockgröße des Mikrofon-Abgriffs
const MAX_IN_FLIGHT = 12;                // so viele Blöcke dürfen unbestätigt beim Worker liegen (ca. 1 s)
const LAG_WARN_SECONDS = 2.5;            // ab so viel unverarbeitetem Audio: status.lagging = true
const LAG_CLEAR_SECONDS = 1;             // unter diesem Rückstand wieder lagging = false
const LAG_RESET_SECONDS = 8;             // ab so viel Rückstand: neue Sitzung, damit die Erkennung aufholt
const WORKER_SILENT_MS = 20000;          // trotz Rückstand so lange keine Antwort: Worker gilt als ausgefallen
const DOWNLOAD_STALL_MS = 30000;         // Download abbrechen, wenn so lange keine Daten mehr kommen
const WORKER_LOAD_TIMEOUT_MS = 180000;   // so lange darf das Vorbereiten des Modells höchstens dauern
const RESUME_WAIT_MS = 2000;             // so lange warten, bis ein Audio-Kontext wieder läuft
const UNMUTE_WAIT_MS = 1500;             // so lange auf eine stummgeschaltete Mikrofonspur warten
const MUTE_REPAIR_GAP_MS = 30000;        // höchstens so oft ohne Tippen eine neue Spur holen, weil die alte stumm bleibt
const WORKLET_TIMEOUT_MS = 5000;         // so lange darf das Laden von audio-worklet.js dauern
const VISIBLE_SETTLE_MS = 400;           // nach dem Zurückkehren in die App kurz warten, dann prüfen
const NO_AUDIO_MS = 3000;                // so lange keine Mikrofondaten: Reparatur versuchen

const TEXT = {
  offline: 'Das Sprachmodell wurde noch nicht geladen. Bitte die App einmal mit Internetverbindung öffnen.',
  httpError: (status) => `Das Sprachmodell konnte nicht geladen werden (HTTP-Fehler ${status}).`,
  downloadBroken: 'Der Download des Sprachmodells wurde unterbrochen. Bitte die Internetverbindung prüfen und erneut versuchen.',
  invalidModel: 'Das Sprachmodell ist unvollständig oder beschädigt. Bitte erneut versuchen.',
  quota: 'Nicht genug Speicherplatz für das Sprachmodell (ca. 50 MB).',
  quotaOnlineOnly: 'Nicht genug Speicherplatz für das Sprachmodell (ca. 50 MB). Die Spracherkennung läuft jetzt, ist aber nicht offline verfügbar.',
  notCached: 'Das Sprachmodell konnte nicht offline gespeichert werden und wird beim nächsten Start erneut geladen.',
  memory: 'Nicht genug Arbeitsspeicher für die Spracherkennung. Bitte andere Apps und Tabs schließen und erneut versuchen.',
  workerFailed: (detail) => `Die Spracherkennung konnte nicht gestartet werden (Worker/WebAssembly${detail ? ': ' + detail : ''}).`,
  workerCrashed: (detail) => `Die Spracherkennung ist abgestürzt${detail ? ' (' + detail + ')' : ''}. Bitte erneut versuchen.`,
  workerTimeout: 'Die Spracherkennung reagiert nicht (Zeitüberschreitung beim Vorbereiten des Sprachmodells). Bitte erneut versuchen.',
  workerSilent: 'Die Spracherkennung reagiert nicht mehr. Bitte erneut versuchen.',
  noWorker: 'Dieser Browser unterstützt keine Web Worker – Spracherkennung nicht möglich.',
  noWasm: 'Dieser Browser unterstützt kein WebAssembly – Spracherkennung nicht möglich.',
  micDenied: 'Mikrofon nicht erlaubt. Bitte in den iPad-Einstellungen unter Apps › Safari › Mikrofon „Erlauben“ wählen und die App neu öffnen.',
  micMissing: 'Kein Mikrofon gefunden.',
  micBusy: 'Das Mikrofon wird gerade von einer anderen App benutzt.',
  micInsecure: 'Mikrofon nur über https:// verfügbar.',
  micRetry: 'Das Mikrofon konnte gerade nicht gestartet werden. Bitte erneut versuchen.',
  micFailed: (detail) => `Das Mikrofon konnte nicht gestartet werden${detail ? ' (' + detail + ')' : ''}.`,
  noWebAudio: 'Dieser Browser unterstützt keine Audioaufnahme (Web Audio fehlt).',
  audioFailed: (detail) => `Die Audioverarbeitung konnte nicht gestartet werden${detail ? ' (' + detail + ')' : ''}.`,
  interrupted: 'Mikrofon unterbrochen – zum Fortsetzen Mitte tippen',
};

// Typische Meldungen bei zu wenig Arbeitsspeicher (Safari, Chrome, Firefox, Emscripten/Vosk).
const OUT_OF_MEMORY = /out of memory|\bOOM\b|bad_alloc|enlarge memory|memory size exceeded|allocation failed|Memory\.grow/i;

/** Fehler mit fertiger deutscher Meldung. */
class SpeechError extends Error {
  constructor(message, code = '') {
    super(message);
    this.name = 'SpeechError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Kleine Hilfsfunktionen
// ---------------------------------------------------------------------------------------------------------

function absoluteUrl(value) {
  const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : import.meta.url;
  return new URL(String(value), base).href;
}

function copyStatus(status) {
  return { model: { ...status.model }, mic: { ...status.mic }, lagging: status.lagging };
}

function isVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function errorDetail(error) {
  if (!error) return '';
  const text = error.message ? String(error.message) : String(error);
  return text.replace(/^Uncaught\s+/, '').slice(0, 200);
}

function isQuotaError(error) {
  return !!error && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014 || /quota/i.test(String(error.message)));
}

/** Spur(en) des Mikrofons noch aktiv? */
function streamLive(stream) {
  return !!stream && stream.getAudioTracks().some((track) => track.readyState === 'live');
}

/** Spur stummgeschaltet (iOS: Anruf, Siri, eine andere App nimmt das Mikrofon)? Dann kommen nur noch Nullen an. */
function streamMuted(stream) {
  const track = stream && stream.getAudioTracks()[0];
  return !!track && track.muted;
}

function stopTracks(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.onended = null;
    try { track.stop(); } catch (e) { /* schon beendet */ }
  }
}

function closeContext(ctx) {
  if (!ctx) return;
  ctx.onstatechange = null;
  try {
    const closing = ctx.close();
    if (closing && closing.catch) closing.catch(() => {});
  } catch (e) { /* schon geschlossen */ }
}

/** Versucht, den Audio-Kontext fortzusetzen, und wartet höchstens timeoutMs auf den Zustand 'running'. */
function waitForRunning(ctx, timeoutMs) {
  if (!ctx || ctx.state === 'closed') return Promise.resolve(false);
  if (ctx.state === 'running') return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(ctx.state === 'running');
    };
    const timer = setTimeout(finish, timeoutMs);
    // Abfragen statt nur auf 'statechange' zu hören: Safari meldet nicht jeden Wechsel zuverlässig.
    const poll = setInterval(() => {
      if (ctx.state === 'running' || ctx.state === 'closed') finish();
    }, 50);
    try {
      const resumed = ctx.resume();
      if (resumed && resumed.then) resumed.then(() => { if (ctx.state === 'running') finish(); }, () => {});
    } catch (e) { /* ohne Geste nicht erlaubt – dann bleibt es beim Warten */ }
  });
}

/** Wartet bei einer stummgeschalteten Mikrofonspur (iOS nach Unterbrechungen) kurz auf das Wieder-Einschalten. */
function waitForUnmute(stream, timeoutMs) {
  const track = stream && stream.getAudioTracks()[0];
  if (!track || !track.muted) return Promise.resolve(!!track);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      track.removeEventListener('unmute', finish);
      resolve(track.readyState === 'live' && !track.muted);
    };
    const timer = setTimeout(finish, timeoutMs);
    track.addEventListener('unmute', finish);
  });
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/** Deutsche Meldung für Fehler beim Einschalten des Mikrofons. */
function micErrorMessage(error) {
  if (error instanceof SpeechError) return error.message;
  switch (error && error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return TEXT.micDenied;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return TEXT.micMissing;
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError': // Safari: Aufnahme kann gerade nicht starten (Anruf, andere App, Seite nicht aktiv)
      return TEXT.micBusy;
    case 'InvalidStateError':
      return TEXT.micRetry;
    default:
      return TEXT.micFailed(error && error.name && error.name !== 'Error' ? error.name : errorDetail(error));
  }
}

/** Deutsche Meldung für Fehler aus dem Worker (beim Laden: phase 'load', später: 'run'). */
function workerErrorMessage(raw, phase) {
  const detail = errorDetail(raw);
  if (OUT_OF_MEMORY.test(detail)) return TEXT.memory;
  if (/entpackt/i.test(detail)) return TEXT.invalidModel; // asr-worker.js: "Modellarchiv kann nicht entpackt werden"
  return phase === 'load' ? TEXT.workerFailed(detail) : TEXT.workerCrashed(detail);
}

/** Deutsche Meldung für beliebige Fehler beim Laden des Modells. */
function modelErrorMessage(error) {
  if (error instanceof SpeechError) return error.message;
  if (error && (error.name === 'RangeError' || OUT_OF_MEMORY.test(errorDetail(error)))) return TEXT.memory;
  if (isQuotaError(error)) return TEXT.quota;
  return TEXT.workerFailed(errorDetail(error));
}

// ---------------------------------------------------------------------------------------------------------
// Sprachmodell: Offline-Speicher und Download
// ---------------------------------------------------------------------------------------------------------

/** Gültig = erwartete Größe (falls bekannt) und gzip-Kennung 1f 8b am Anfang. */
function isValidArchive(buffer, expectedBytes) {
  if (!buffer || buffer.byteLength < 2) return false;
  if (expectedBytes && buffer.byteLength !== expectedBytes) return false;
  const head = new Uint8Array(buffer, 0, 2);
  return head[0] === 0x1f && head[1] === 0x8b;
}

async function openModelCache() {
  // Ohne Cache Storage (z. B. http:// im Heimnetz, manche private Fenster) geht es auch – nur nicht offline.
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(MODEL_CACHE);
  } catch (error) {
    return null;
  }
}

/**
 * Liest das Modell aus dem Offline-Speicher. Ungültige Einträge werden gelöscht.
 * onFound() wird aufgerufen, sobald ein Eintrag gefunden ist – noch bevor die 46 MB eingelesen sind.
 */
async function readCachedArchive(cache, key, expectedBytes, onFound) {
  let response = null;
  try {
    response = await cache.match(key);
  } catch (error) {
    return null;
  }
  if (!response) return null;
  onFound();
  let buffer = null;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    if (error && (error.name === 'RangeError' || OUT_OF_MEMORY.test(errorDetail(error)))) {
      throw new SpeechError(TEXT.memory, 'memory');
    }
    buffer = null;
  }
  if (isValidArchive(buffer, expectedBytes)) return buffer;
  try { await cache.delete(key); } catch (error) { /* egal */ }
  return null;
}

/**
 * Lädt das Modell herunter und meldet den Fortschritt (0…1). Gibt einen ArrayBuffer zurück.
 * onStart() wird aufgerufen, sobald der Server die Datei liefert – vor dem eigentlichen Herunterladen.
 * Wirft SpeechError mit deutscher Meldung (offline, HTTP-Fehler, Abbruch, falsche Größe).
 */
async function downloadArchive(url, expectedBytes, onProgress, onStart) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SpeechError(TEXT.offline, 'offline');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined });
  } catch (error) {
    throw new SpeechError(TEXT.offline, 'offline');
  }
  if (!response.ok) throw new SpeechError(TEXT.httpError(response.status), 'http');
  try {
    onStart();
  } catch (error) {
    if (controller) controller.abort(); // die Datei wird dann nicht mehr gebraucht
    throw error;
  }

  const header = Number(response.headers.get('Content-Length'));
  const total = header > 0 ? header : expectedBytes || 0;
  if (!response.body || typeof response.body.getReader !== 'function') {
    // Sehr alte Browser ohne Streaming: alles auf einmal, ohne Fortschrittsanzeige.
    onProgress(null);
    try {
      return await response.arrayBuffer();
    } catch (error) {
      throw new SpeechError(TEXT.downloadBroken, 'network');
    }
  }

  const reader = response.body.getReader();
  let bytes = new Uint8Array(expectedBytes || total || 4 * 1024 * 1024);
  let received = 0;
  let stalled = false;
  let stallTimer = null;
  const watchStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      if (controller) controller.abort();
      reader.cancel().catch(() => {});
    }, DOWNLOAD_STALL_MS);
  };
  try {
    watchStall();
    for (;;) {
      let result;
      try {
        result = await reader.read();
      } catch (error) {
        throw new SpeechError(TEXT.downloadBroken, 'network');
      }
      if (stalled) throw new SpeechError(TEXT.downloadBroken, 'network');
      if (result.done) break;
      watchStall();
      const chunk = result.value;
      if (expectedBytes && received + chunk.length > expectedBytes) {
        // Größer als erwartet: falsche Datei (z. B. eine Fehlerseite). Nicht weiter einlesen.
        reader.cancel().catch(() => {});
        throw new SpeechError(TEXT.invalidModel, 'invalid');
      }
      if (received + chunk.length > bytes.length) {
        const bigger = new Uint8Array(Math.max(bytes.length * 2, received + chunk.length));
        bigger.set(bytes.subarray(0, received));
        bytes = bigger;
      }
      bytes.set(chunk, received);
      received += chunk.length;
      onProgress(total ? Math.min(1, received / total) : null);
    }
  } finally {
    clearTimeout(stallTimer);
  }
  return received === bytes.length ? bytes.buffer : bytes.slice(0, received).buffer;
}

/** Legt das Modell im Offline-Speicher ab. Ergebnis: 'stored' | 'quota' | 'failed' | 'unavailable'. */
async function storeArchive(cache, key, buffer) {
  if (!cache) return 'unavailable';
  try {
    await cache.put(key, new Response(buffer, { headers: { 'Content-Type': 'application/gzip' } }));
    return 'stored';
  } catch (error) {
    return isQuotaError(error) ? 'quota' : 'failed';
  }
}

/** Bittet den Browser, den Offline-Speicher nicht automatisch zu löschen (freiwillig, ohne Garantie). */
function requestPersistence() {
  try {
    const asked = navigator.storage && navigator.storage.persist && navigator.storage.persist();
    if (asked && asked.catch) asked.catch(() => {});
  } catch (error) { /* nicht unterstützt */ }
}

// ---------------------------------------------------------------------------------------------------------
// Die Klasse Speech
// ---------------------------------------------------------------------------------------------------------

export class Speech extends EventTarget {
  constructor(options = {}) {
    super();
    const opts = { ...DEFAULTS, ...options };
    this._workerUrl = absoluteUrl(opts.workerUrl);
    this._workletUrl = absoluteUrl(opts.workletUrl);
    this._modelUrl = absoluteUrl(opts.modelUrl); // zugleich der Schlüssel im Offline-Speicher
    this._modelBytes = Number(opts.modelBytes) || 0;

    this._status = {
      model: { state: 'idle', progress: null, message: '', cached: false },
      mic: { state: 'off', message: '' },
      lagging: false,
    };
    this._session = 0;

    // Sprachmodell und Worker
    this._worker = null;           // { worker, failed, pending } – der aktuelle Worker
    this._modelReady = false;
    this._modelPromise = null;
    this._unsavedArchive = null;   // Modell, das wegen Speichermangel nicht gespeichert werden konnte
    this._quotaFailures = 0;

    // Erkennungssitzung im Worker
    this._workerSession = 0;       // Sitzung, die im Worker gerade läuft (0 = keine)
    this._lastStartedSession = 0;  // eine Sitzungsnummer wird nie zweimal im Worker gestartet
    this._seq = 0;                 // Nummer des zuletzt gesendeten Audio-Blocks
    this._ackSeq = 0;              // höchste vom Worker bestätigte Blocknummer
    this._queue = [];              // Blöcke, die noch auf das Senden warten
    this._chunkFrames = CHUNK_FRAMES;
    this._lastReplyAt = 0;

    // Mikrofon
    this._micWanted = false;       // zwischen start() und stop()
    this._userPaused = false;      // pause() aufgerufen
    this._interrupted = false;     // iOS hat unterbrochen; Fortsetzen braucht ein Tippen
    this._muteInterrupted = false; // Unterbrechung kam von einer stummen Spur (endet von selbst)
    this._micError = '';           // Fehlermeldung, solange das Mikrofon nicht laufen kann
    this._micErrorFromModel = false; // _micError kommt von einem Modellfehler (Mikrofon wurde deshalb freigegeben)
    this._ctx = null;              // AudioContext
    this._stream = null;           // MediaStream vom Mikrofon
    this._graph = null;            // { ctx, stream, source, node, mute, sampleRate }
    this._captureToken = 0;        // erhöht sich bei jedem neuen Versuch – alte Versuche brechen ab
    this._acquiring = false;
    this._recovering = false;
    this._recoveryId = 0;
    this._stallRepairs = 0;        // Reparaturen, seit zuletzt Mikrofondaten ankamen
    this._stallInterrupts = 0;     // so oft half bei Stillstand nur noch ein Tippen (bis wieder Daten kommen)
    this._forceScriptProcessor = false; // nach wiederholtem Stillstand: ScriptProcessor statt AudioWorklet (bis zum Neuladen)
    this._mutedSince = 0;          // seit wann die Spur stumm ist (0 = nicht stumm oder nicht beobachtet)
    this._lastMuteRepairAt = 0;    // wann zuletzt eine neue Spur geholt wurde, weil die alte stumm blieb
    this._lastAudioAt = 0;
    this._level = 0;
    this._watchdog = null;
    this._visibleTimer = null;
    this._recoverTimer = null;
    this._workletModules = new WeakMap(); // AudioContext -> Promise<boolean>

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._onVisible();
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) this._onVisible();
      });
    }
  }

  /** Aktueller Zustand (Kopie). */
  get status() {
    return copyStatus(this._status);
  }

  /** Nummer der aktuellen Sitzung. */
  get session() {
    return this._session;
  }

  // ------------------------------------------------------------------------------------------------------
  // Öffentliche Methoden
  // ------------------------------------------------------------------------------------------------------

  /** Lädt das Sprachmodell (mehrfacher Aufruf schadet nicht). Fehler: Error mit deutscher Meldung. */
  loadModel() {
    if (this._modelReady) return Promise.resolve();
    if (!this._modelPromise) {
      const attempt = this._loadModelOnce();
      this._modelPromise = attempt;
      attempt.catch(() => {
        if (this._modelPromise === attempt) this._modelPromise = null;
      });
    }
    return this._modelPromise;
  }

  /**
   * Mikrofon einschalten und eine neue Sitzung beginnen. Muss SYNCHRON in einer Benutzergeste aufgerufen
   * werden (click/pointerup/keydown). Das Ergebnis-Promise wird nie abgelehnt: true = hört zu, false = nicht
   * (Fehler, Pause oder gestoppt) – Einzelheiten stehen in status.mic.
   */
  start() {
    return this._activate();
  }

  /** Neue Sitzung: das bisher Gesagte wird verworfen, Ergebnisse alter Sitzungen werden ignoriert. */
  newSession() {
    this._nextSession();
    this._refresh();
    return this._session;
  }

  /** Pause: kein Audio mehr an die Erkennung, laufende Äußerung verwerfen. Das Mikrofon bleibt bereit. */
  pause() {
    if (!this._micWanted) return;
    this._userPaused = true;
    this._refresh();
    this._emitLevel(0);
  }

  /**
   * Fortsetzen (in einer Benutzergeste aufrufen): neue Sitzung; holt Mikrofon und Audio-Kontext neu,
   * falls iOS sie beendet hat. Nach einem Fehler wird alles neu versucht (auch das Modell).
   */
  resume() {
    return this._activate();
  }

  /** Mikrofon freigeben und Audio-Kontext schließen. Das Sprachmodell bleibt geladen. */
  stop() {
    this._micWanted = false;
    this._userPaused = false;
    this._interrupted = false;
    this._micError = '';
    this._micErrorFromModel = false;
    this._stallInterrupts = 0;
    this._abortCapture();
    this._refresh();
    this._emitLevel(0);
  }

  // ------------------------------------------------------------------------------------------------------
  // Status und Ereignisse
  // ------------------------------------------------------------------------------------------------------

  _dispatch(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _emitStatus() {
    this._dispatch('status', copyStatus(this._status));
  }

  _setModel(patch) {
    const model = this._status.model;
    let changed = false;
    for (const key of Object.keys(patch)) {
      if (model[key] !== patch[key]) {
        model[key] = patch[key];
        changed = true;
      }
    }
    if (changed) this._emitStatus();
  }

  _setMic(state, message) {
    const mic = this._status.mic;
    if (mic.state === state && mic.message === message) return;
    mic.state = state;
    mic.message = message;
    if (state !== 'listening') this._status.lagging = false;
    this._emitStatus();
  }

  _setLagging(value) {
    if (this._status.lagging === value) return;
    this._status.lagging = value;
    this._emitStatus();
  }

  _emitLevel(level) {
    this._level = level;
    this._dispatch('level', { level });
  }

  _emitWords(text, final) {
    const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    this._dispatch('words', { words, final, session: this._session });
  }

  /** Nächste Sitzungsnummer; kurz danach folgt ein leeres Abschluss-Ereignis für den Wortabgleich. */
  _nextSession() {
    this._session++;
    const session = this._session;
    // Bewusst etwas verzögert: Die App soll erst ihren eigenen Wechsel (z. B. neuer Tracker) abschließen.
    setTimeout(() => {
      if (session === this._session) this._dispatch('words', { words: [], final: true, session });
    }, 0);
    return session;
  }

  /**
   * Bringt alles in einen stimmigen Zustand: startet/stoppt die Erkennungssitzung im Worker
   * und leitet daraus den Mikrofon-Status ab. Wird nach jeder Änderung aufgerufen.
   */
  _refresh() {
    this._syncWorkerSession();
    let state = 'starting';
    let message = '';
    if (!this._micWanted) state = 'off';
    else if (this._micError) { state = 'error'; message = this._micError; }
    else if (this._userPaused) state = 'paused';
    else if (this._interrupted) { state = 'paused'; message = TEXT.interrupted; }
    else if (this._workerSession && this._workerSession === this._session) state = 'listening';
    this._setMic(state, message);
  }

  // ------------------------------------------------------------------------------------------------------
  // Sprachmodell laden
  // ------------------------------------------------------------------------------------------------------

  async _loadModelOnce() {
    if (this._micErrorFromModel) {
      // Neuer Versuch (z. B. "Erneut versuchen"): Der alte Modellfehler gilt nicht mehr fürs Mikrofon.
      // Das Mikrofon wurde damals freigegeben – weiter geht es mit einem Tippen (resume).
      this._micErrorFromModel = false;
      this._micError = '';
      this._interrupted = true;
      this._refresh();
    }
    // Der Worker entsteht erst, wenn feststeht, dass das Modell kommt (im Offline-Speicher gefunden oder
    // Download gestartet). Er lädt Vosk dann schon, während das Modell noch gelesen wird.
    let record = null;
    const startWorker = () => {
      if (!record) record = this._createWorker();
    };
    try {
      if (typeof Worker === 'undefined') throw new SpeechError(TEXT.noWorker, 'worker');
      if (typeof WebAssembly === 'undefined') throw new SpeechError(TEXT.noWasm, 'wasm');
      this._setModel({ state: 'preparing', progress: null, message: '' });
      const { buffer, cached, note } = await this._obtainArchive(startWorker);
      startWorker(); // (ist normalerweise schon geschehen)
      if (record.failed) throw new SpeechError(record.failed, 'worker');
      this._setModel({ state: 'preparing', progress: null, message: '', cached });
      await this._sendArchive(record, buffer);
      this._modelReady = true;
      this._quotaFailures = 0;
      this._setModel({ state: 'ready', progress: null, message: note, cached });
      this._refresh(); // falls das Mikrofon schon läuft: jetzt geht es los
    } catch (error) {
      const message = modelErrorMessage(error);
      if (error && error.deleteCache) await this._forgetCachedArchive();
      this._failModel(message);
      throw new Error(message);
    }
  }

  /**
   * Holt das Modell: aus dem Offline-Speicher oder per Download (dann wird es dort abgelegt).
   * onAvailable() wird aufgerufen, sobald feststeht, dass das Modell kommt.
   */
  async _obtainArchive(onAvailable) {
    const cache = await openModelCache();
    if (cache) {
      const buffer = await readCachedArchive(cache, this._modelUrl, this._modelBytes, onAvailable);
      if (buffer) return { buffer, cached: true, note: '' };
    }

    let buffer = this._unsavedArchive;
    if (buffer) {
      onAvailable(); // liegt noch vom letzten Versuch im Speicher (der Offline-Speicher war voll)
      this._unsavedArchive = null;
    } else {
      this._setModel({ state: 'loading', progress: 0, message: '', cached: false });
      const onProgress = (progress) => this._onDownloadProgress(progress);
      buffer = await downloadArchive(this._modelUrl, this._modelBytes, onProgress, onAvailable);
      // Nie eine unvollständige oder falsche Datei speichern.
      if (!isValidArchive(buffer, this._modelBytes)) throw new SpeechError(TEXT.invalidModel, 'invalid');
    }
    this._setModel({ state: 'preparing', progress: null, message: '' });

    const stored = await storeArchive(cache, this._modelUrl, buffer);
    if (stored === 'stored') {
      requestPersistence();
      return { buffer, cached: true, note: '' };
    }
    if (stored === 'quota') {
      // Beim ersten Mal als Fehler melden (Speicher freigeben, dann "Erneut versuchen" – ohne neuen Download).
      // Klappt es beim nächsten Versuch immer noch nicht, läuft die Erkennung wenigstens ohne Offline-Kopie.
      this._quotaFailures++;
      if (this._quotaFailures < 2) {
        this._unsavedArchive = buffer;
        throw new SpeechError(TEXT.quota, 'quota');
      }
      return { buffer, cached: false, note: TEXT.quotaOnlineOnly };
    }
    return { buffer, cached: false, note: TEXT.notCached };
  }

  _onDownloadProgress(progress) {
    const rounded = progress == null ? null : Math.floor(progress * 100) / 100;
    if (this._status.model.state === 'loading' && rounded !== this._status.model.progress) {
      this._setModel({ progress: rounded });
    }
  }

  async _forgetCachedArchive() {
    const cache = await openModelCache();
    if (cache) {
      try { await cache.delete(this._modelUrl); } catch (error) { /* egal */ }
    }
  }

  _createWorker() {
    let worker;
    try {
      worker = new Worker(this._workerUrl);
    } catch (error) {
      throw new SpeechError(TEXT.workerFailed(errorDetail(error)), 'worker');
    }
    const record = { worker, failed: '', pending: null };
    worker.onmessage = (event) => this._onWorkerMessage(record, event.data);
    worker.onerror = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      this._onWorkerFailure(record, (event && event.message) || '');
    };
    this._worker = record;
    return record;
  }

  /** Schickt das Archiv an den Worker (wird übertragen, nicht kopiert) und wartet auf 'loaded'. */
  _sendArchive(record, buffer) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        record.pending = null;
        reject(new SpeechError(TEXT.workerTimeout, 'timeout'));
      }, WORKER_LOAD_TIMEOUT_MS);
      record.pending = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      try {
        record.worker.postMessage({ type: 'load', archive: buffer }, [buffer]);
      } catch (error) {
        record.pending.reject(new SpeechError(workerErrorMessage(error, 'load'), 'worker'));
        record.pending = null;
      }
    });
  }

  /** Worker abgestürzt oder meldet einen Fehler. */
  _onWorkerFailure(record, raw) {
    if (record !== this._worker) return;
    const loading = !this._modelReady;
    const message = workerErrorMessage(raw, loading ? 'load' : 'run');
    record.failed = message;
    if (record.pending) {
      const error = new SpeechError(message, 'worker');
      error.deleteCache = message === TEXT.invalidModel; // Archiv ließ sich nicht entpacken → neu laden
      record.pending.reject(error);
      record.pending = null;
      return;
    }
    if (loading && this._modelPromise) return; // _loadModelOnce bemerkt record.failed nach dem Download
    this._failModel(message);
  }

  /** Modell nicht (mehr) nutzbar: Worker beenden, Fehler anzeigen. loadModel() startet später neu. */
  _failModel(message) {
    if (this._worker) {
      try { this._worker.worker.terminate(); } catch (error) { /* egal */ }
      this._worker = null;
    }
    this._modelReady = false;
    this._modelPromise = null;
    this._workerSession = 0;
    this._queue = [];
    this._setModel({ state: 'error', progress: null, message });
    if (this._micWanted && !this._userPaused && (!this._micError || this._micErrorFromModel)) {
      // Ohne Spracherkennung ist das Mikrofon nutzlos: freigeben. Tippen (resume) versucht alles neu;
      // ein neuer Ladeversuch (loadModel) nimmt die Meldung wieder weg.
      this._micError = message;
      this._micErrorFromModel = true;
      this._abortCapture();
      this._emitLevel(0);
    }
    this._refresh();
  }

  _onWorkerMessage(record, msg) {
    if (record !== this._worker || !msg) return;
    this._lastReplyAt = Date.now(); // jede Nachricht zeigt: der Worker lebt
    switch (msg.type) {
      case 'loaded':
        if (record.pending) {
          record.pending.resolve();
          record.pending = null;
        }
        break;
      case 'partial':
        this._acknowledge(msg);
        if (this._isCurrent(msg.id)) this._emitWords(msg.text, false);
        break;
      case 'final':
        this._acknowledge(msg);
        if (this._isCurrent(msg.id)) this._emitWords(msg.text, true);
        break;
      case 'tick':
        this._acknowledge(msg);
        break;
      case 'error':
        this._onWorkerFailure(record, msg.message);
        break;
      default:
        break; // 'started' u. a. brauchen keine Reaktion
    }
  }

  /** Ergebnis gehört zur aktuellen, laufenden Sitzung? */
  _isCurrent(id) {
    return id === this._workerSession && id === this._session && !this._userPaused && this._micWanted;
  }

  // ------------------------------------------------------------------------------------------------------
  // Erkennungssitzung im Worker und Rückstau
  // ------------------------------------------------------------------------------------------------------

  _captureLive() {
    const g = this._graph;
    return !!g && g.ctx === this._ctx && this._ctx.state === 'running' && g.stream === this._stream && streamLive(this._stream);
  }

  _syncWorkerSession() {
    const record = this._worker;
    const shouldRun = !!record && this._modelReady && this._micWanted && !this._userPaused && !this._interrupted &&
      !this._micError && this._captureLive();
    if (shouldRun) {
      if (this._workerSession !== this._session) {
        // Jede Erkennungssitzung bekommt eine frische Nummer – auch nach einer Unterbrechung.
        if (this._lastStartedSession === this._session) this._nextSession();
        if (!this._workerSession) this._lastReplyAt = Date.now();
        this._resetBacklog();
        record.worker.postMessage({ type: 'start', id: this._session, sampleRate: this._graph.sampleRate });
        this._workerSession = this._session;
        this._lastStartedSession = this._session;
      }
    } else if (this._workerSession) {
      if (record) record.worker.postMessage({ type: 'stop', id: this._workerSession });
      this._workerSession = 0;
      this._resetBacklog();
    }
  }

  _resetBacklog() {
    this._queue = [];
    this._seq = 0;
    this._ackSeq = 0;
    this._setLagging(false);
  }

  /** Neuer Audio-Block vom Mikrofon. */
  _onChunk(node, samples) {
    if (!this._graph || this._graph.node !== node || !samples || !samples.length) return;
    this._lastAudioAt = Date.now();
    this._stallRepairs = 0;
    this._stallInterrupts = 0; // es kommen wieder Daten: der Stillstand ist behoben
    // Pegel und Audio nur, wenn wirklich zugehört wird (nicht pausiert, unterbrochen oder im Fehler).
    if (!this._micWanted || this._userPaused || this._micError || this._interrupted) return;
    this._meter(samples);
    // Erst senden, wenn das Modell bereit ist und die Sitzung im Worker läuft.
    if (!this._workerSession || this._workerSession !== this._session) return;
    this._queue.push(samples);
    this._pump();
    this._checkBacklog();
  }

  /** Schickt wartende Blöcke an den Worker – höchstens MAX_IN_FLIGHT unbestätigte gleichzeitig. */
  _pump() {
    const record = this._worker;
    if (!record || !this._workerSession) return;
    while (this._queue.length && this._seq - this._ackSeq < MAX_IN_FLIGHT) {
      const samples = this._queue.shift();
      this._seq++;
      this._chunkFrames = samples.length;
      record.worker.postMessage({ type: 'audio', id: this._workerSession, seq: this._seq, samples }, [samples.buffer]);
    }
  }

  /** Antwort des Worker (partial/final/tick): bestätigt alle Blöcke bis msg.seq. */
  _acknowledge(msg) {
    if (msg.id !== this._workerSession || !(msg.seq >= 0)) return;
    this._lastReplyAt = Date.now();
    if (msg.seq > this._ackSeq) this._ackSeq = msg.seq;
    this._pump();
    this._checkBacklog();
  }

  /** Prüft, wie viel Audio noch auf die Erkennung wartet (gesendet + wartend). */
  _checkBacklog() {
    if (!this._workerSession || !this._graph) return;
    const chunks = this._seq - this._ackSeq + this._queue.length;
    const seconds = (chunks * this._chunkFrames) / this._graph.sampleRate;
    if (seconds > LAG_RESET_SECONDS) {
      if (Date.now() - this._lastReplyAt > WORKER_SILENT_MS) {
        this._failModel(TEXT.workerSilent);
        return;
      }
      // Die Erkennung kommt nicht hinterher: Rückstand verwerfen und mit einer neuen Sitzung aufholen.
      this._nextSession();
      this._refresh();
      return;
    }
    if (seconds > LAG_WARN_SECONDS) this._setLagging(true);
    else if (seconds < LAG_CLEAR_SECONDS) this._setLagging(false);
  }

  /** Pegel für Anzeigen (0…1, ca. 10-mal pro Sekunde): schnell hoch, langsam wieder runter. */
  _meter(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    const db = 20 * Math.log10(rms + 1e-9);
    const level = Math.min(1, Math.max(0, (db + 60) / 50)); // −60 dB → 0, −10 dB → 1
    this._emitLevel(Math.round(Math.max(level, this._level * 0.6) * 1000) / 1000);
  }

  // ------------------------------------------------------------------------------------------------------
  // Mikrofon und Audio-Kontext
  // ------------------------------------------------------------------------------------------------------

  /** Gemeinsamer Ablauf von start() und resume(). Alles bis zum ersten await läuft noch in der Geste. */
  _activate() {
    this._micWanted = true;
    this._userPaused = false;
    this._interrupted = false;
    this._micError = '';
    this._micErrorFromModel = false;
    this._stallRepairs = 0;
    let ctx;
    try {
      ctx = this._prepareContext(); // 1. Audio-Kontext anlegen/fortsetzen (synchron!)
    } catch (error) {
      this._micError = error instanceof SpeechError ? error.message : TEXT.audioFailed(errorDetail(error));
      this._abortCapture();
      this._refresh();
      this._emitLevel(0);
      return Promise.resolve(false);
    }
    this._nextSession();
    const capture = this._ensureCapture(ctx); // 2. Mikrofon (getUserMedia wird noch synchron aufgerufen)
    if (!this._modelReady) this.loadModel().catch(() => {}); // Fehler landen über _failModel im Status
    this._refresh();
    this._startWatchdog();
    return capture.then(() => this._whenSettled()).catch(() => false);
  }

  /** Legt den Audio-Kontext an bzw. setzt ihn fort. Muss synchron in der Benutzergeste laufen. */
  _prepareContext() {
    const AudioContextClass = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AudioContextClass) throw new SpeechError(TEXT.noWebAudio, 'webaudio');
    let ctx = this._ctx;
    if (ctx && (ctx.state !== 'running' || this._stallInterrupts > 0)) {
      // Unterbrochen ('interrupted' bei Safari), angehalten, geschlossen – oder er "läuft", liefert aber keine
      // Daten mehr (Stillstand): in der Geste lieber einen frischen Kontext anlegen – das klappt auf dem iPad
      // zuverlässiger als resume().
      this._teardownGraph();
      closeContext(ctx);
      ctx = null;
      this._ctx = null;
    }
    if (!ctx) {
      ctx = new AudioContextClass(); // Standard-Abtastrate des Geräts (meist 48 000 oder 44 100)
      this._ctx = ctx;
      ctx.onstatechange = () => this._onContextState(ctx);
      // Bewährter iOS-Trick: einen winzigen stillen Ton abspielen, damit der Kontext sicher freigeschaltet ist.
      try {
        const silence = ctx.createBufferSource();
        silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        silence.connect(ctx.destination);
        silence.start(0);
      } catch (error) { /* nicht nötig oder nicht möglich */ }
    }
    if (ctx.state !== 'running') {
      try {
        const resumed = ctx.resume();
        if (resumed && resumed.catch) resumed.catch(() => {});
      } catch (error) { /* wird beim Warten auf 'running' erkannt */ }
    }
    return ctx;
  }

  /** Mikrofon anfordern. Wirft/lehnt ab mit dem Originalfehler (wird von micErrorMessage übersetzt). */
  _requestStream() {
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!devices || typeof devices.getUserMedia !== 'function') {
      return Promise.reject(new SpeechError(TEXT.micInsecure, 'insecure'));
    }
    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    };
    let request;
    try {
      request = devices.getUserMedia(constraints);
    } catch (error) {
      return Promise.reject(error);
    }
    return request.catch((error) => {
      // Manche Geräte mögen die Wünsche nicht – dann ohne Sonderwünsche noch einmal.
      if (error && (error.name === 'OverconstrainedError' || error.name === 'TypeError')) {
        return devices.getUserMedia({ audio: true });
      }
      throw error;
    });
  }

  _adoptStream(stream) {
    this._stream = stream;
    this._mutedSince = 0;
    for (const track of stream.getAudioTracks()) {
      // iOS beendet die Spur z. B., wenn die App in den Hintergrund geht oder eine andere App das Mikrofon nimmt.
      track.onended = () => this._onTrackEnded(stream);
    }
  }

  _dropStream() {
    stopTracks(this._stream);
    this._stream = null;
  }

  /**
   * Lädt audio-worklet.js in den Kontext. Ergebnis: true = AudioWorklet nutzbar, false = Ersatzweg
   * (ScriptProcessor) – auch dann, wenn mit AudioWorklet wiederholt keine Daten mehr ankamen.
   */
  _loadWorkletModule(ctx) {
    if (this._forceScriptProcessor || !ctx.audioWorklet || typeof AudioWorkletNode !== 'function') {
      return Promise.resolve(false);
    }
    let loading = this._workletModules.get(ctx);
    if (!loading) {
      let started;
      try {
        started = ctx.audioWorklet.addModule(this._workletUrl).then(() => true);
      } catch (error) {
        started = Promise.resolve(false);
      }
      loading = withTimeout(started, WORKLET_TIMEOUT_MS, false);
      this._workletModules.set(ctx, loading);
    }
    return loading;
  }

  /** Baut den Audio-Graphen: Mikrofon → Abgriff (AudioWorklet oder ScriptProcessor) → Lautstärke 0 → Ausgang. */
  _buildGraph(ctx, stream, useWorklet) {
    this._teardownGraph();
    const source = ctx.createMediaStreamSource(stream);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    let node = null;
    if (useWorklet) {
      try {
        node = new AudioWorkletNode(ctx, 'mitleser-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        });
        const workletNode = node;
        node.port.onmessage = (event) => this._onChunk(workletNode, event.data);
      } catch (error) {
        node = null;
      }
    }
    if (!node) {
      // Ersatzweg für Browser ohne (funktionierendes) AudioWorklet.
      const processor = ctx.createScriptProcessor(CHUNK_FRAMES, 1, 1);
      processor.onaudioprocess = (event) => {
        this._onChunk(processor, new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      node = processor;
    }
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    this._graph = { ctx, stream, source, node, mute, sampleRate: ctx.sampleRate };
    this._lastAudioAt = Date.now();
  }

  _teardownGraph() {
    const g = this._graph;
    if (!g) return;
    this._graph = null;
    for (const audioNode of [g.source, g.node, g.mute]) {
      try { audioNode.disconnect(); } catch (error) { /* schon getrennt */ }
    }
    if (g.node.port) {
      // AudioWorklet: Prozessor beenden – sonst wird er bis zum Schließen des Kontexts weiter aufgerufen.
      g.node.port.onmessage = null;
      try { g.node.port.postMessage('stop'); } catch (error) { /* Kontext schon geschlossen */ }
    } else {
      g.node.onaudioprocess = null;
    }
  }

  /** Bricht laufende Mikrofon-Versuche ab und gibt Mikrofon und Audio-Kontext frei. */
  _abortCapture() {
    this._captureToken++;
    this._acquiring = false;
    this._recovering = false;
    this._recoveryId++; // eine noch laufende Reparatur gibt das Flag nicht mehr frei
    clearTimeout(this._visibleTimer);
    clearTimeout(this._recoverTimer);
    this._teardownGraph();
    this._dropStream();
    if (this._ctx) {
      closeContext(this._ctx);
      this._ctx = null;
    }
    if (this._watchdog && !this._micWanted) {
      clearInterval(this._watchdog);
      this._watchdog = null;
    }
  }

  /**
   * Sorgt dafür, dass Mikrofon und Audio-Graph für ctx laufen. getUserMedia wird dabei sofort (synchron)
   * aufgerufen, damit es noch zur Benutzergeste gehört. Ergebnis: Promise<boolean>.
   */
  _ensureCapture(ctx) {
    const token = ++this._captureToken;
    this._acquiring = true;
    let streamRequest;
    const current = this._stream;
    const usable = streamLive(current) && !streamMuted(current);
    if (usable) {
      streamRequest = Promise.resolve(current);
    } else {
      this._dropStream();
      streamRequest = this._requestStream();
    }
    const workletRequest = this._loadWorkletModule(ctx);
    const finish = (ok) => {
      if (token === this._captureToken) {
        this._acquiring = false;
        this._refresh();
      }
      return ok;
    };

    const fail = (message) => {
      this._micError = message;
      this._micErrorFromModel = false;
      this._abortCapture();
      this._refresh();
      this._emitLevel(0);
      return false;
    };

    return (async () => {
      let stream;
      try {
        stream = await streamRequest;
      } catch (error) {
        if (token !== this._captureToken) return false;
        return fail(micErrorMessage(error));
      }
      if (token !== this._captureToken || !this._micWanted) {
        if (stream !== this._stream) stopTracks(stream);
        return false;
      }
      if (stream !== this._stream) this._adoptStream(stream);

      if (!this._graph || this._graph.ctx !== ctx || this._graph.stream !== stream) {
        const useWorklet = await workletRequest;
        if (token !== this._captureToken || !this._micWanted) return false;
        try {
          this._buildGraph(ctx, stream, useWorklet);
        } catch (error) {
          return fail(TEXT.audioFailed(errorDetail(error)));
        }
      }

      // Nach der Mikrofonfreigabe ist der Kontext auf dem iPad manchmal noch angehalten.
      const running = await waitForRunning(ctx, RESUME_WAIT_MS);
      if (token !== this._captureToken) return false;
      if (!running) {
        this._interrupted = true; // ein Tippen (resume) legt den Kontext dann frisch an
        this._emitLevel(0);
      }
      this._lastAudioAt = Date.now();
      return finish(running);
    })();
  }

  /** Wartet, bis der Mikrofon-Status nicht mehr 'starting' ist. true = hört zu. */
  _whenSettled() {
    return new Promise((resolve) => {
      const check = () => {
        const state = this._status.mic.state;
        if (state === 'starting') return false;
        this.removeEventListener('status', check);
        resolve(state === 'listening');
        return true;
      };
      if (!check()) this.addEventListener('status', check);
    });
  }

  // ------------------------------------------------------------------------------------------------------
  // iOS-Robustheit: Unterbrechungen erkennen und reparieren
  // ------------------------------------------------------------------------------------------------------

  _canRecover() {
    return this._micWanted && !this._userPaused && !this._micError && !this._acquiring;
  }

  _onContextState(ctx) {
    if (ctx !== this._ctx) return;
    if (ctx.state === 'running' && this._interrupted && streamLive(this._stream) && this._graph && this._graph.ctx === ctx) {
      this._interrupted = false; // läuft von selbst wieder (z. B. nach einem Anruf)
    }
    this._refresh();
    if (ctx.state !== 'running' && this._canRecover()) this._scheduleRecover(300);
  }

  _onTrackEnded(stream) {
    if (stream !== this._stream) return;
    this._refresh();
    if (this._canRecover()) this._scheduleRecover(300);
  }

  _onVisible() {
    if (!this._canRecover()) return;
    clearTimeout(this._visibleTimer);
    this._visibleTimer = setTimeout(() => this._recover(true), VISIBLE_SETTLE_MS);
  }

  _scheduleRecover(delay) {
    clearTimeout(this._recoverTimer);
    this._recoverTimer = setTimeout(() => this._recover(false), delay);
  }

  _startWatchdog() {
    if (this._watchdog) return;
    this._watchdog = setInterval(() => {
      if (!this._micWanted) {
        clearInterval(this._watchdog);
        this._watchdog = null;
        return;
      }
      // Wegen Stummschaltung unterbrochen und die Spur ist von selbst wieder an (z. B. Siri vorbei): weiter ohne Tippen.
      if (this._muteInterrupted && this._interrupted && this._micWanted && !this._userPaused && !this._micError &&
        this._captureLive() && !streamMuted(this._stream)) {
        this._muteInterrupted = false;
        this._interrupted = false;
        this._lastAudioAt = Date.now();
        this._refresh();
      }
      if (!this._canRecover() || this._interrupted || this._recovering || !this._graph || !isVisible()) {
        this._mutedSince = 0; // Stummschaltung nur zählen, solange ununterbrochen zugehört wird
        return;
      }
      // Ist etwas ausgefallen, kommen keine Mikrofondaten mehr an oder bleibt die Spur stumm: reparieren.
      if (!this._captureLive()) this._recover(false, false);
      else if (Date.now() - this._lastAudioAt > NO_AUDIO_MS) this._recover(false, true);
      else this._checkMuted();
    }, 1000);
  }

  /**
   * Eine stummgeschaltete Spur liefert weiter Daten, aber nur Nullen (z. B. während eines Anrufs, mit Siri oder
   * wenn in Split View eine andere App das Mikrofon nimmt) – "hört zu" wäre dann falsch. Bleibt sie stumm,
   * repariert _recover: kurz auf das Wieder-Einschalten warten, sonst eine neue Spur holen. Ist auch die neue
   * Spur gleich wieder stumm, hilft neu Anfordern nicht – dann um ein Tippen bitten.
   * (Im Hintergrund schaltet iOS die Spur ebenfalls stumm – das erledigt _onVisible beim Zurückkehren.)
   */
  _checkMuted() {
    if (!streamMuted(this._stream)) {
      this._mutedSince = 0;
      return;
    }
    const now = Date.now();
    if (!this._mutedSince) this._mutedSince = now;
    if (now - this._mutedSince < UNMUTE_WAIT_MS) return;
    this._mutedSince = 0;
    if (now - this._lastMuteRepairAt < MUTE_REPAIR_GAP_MS) {
      this._markInterrupted();
      this._muteInterrupted = true; // hebt der Wachhund wieder auf, sobald die Spur von selbst wieder an ist
    } else this._recover(false);
  }

  /**
   * Repariert Audio-Kontext, Mikrofonspur und Graph ohne Benutzergeste, soweit iOS das erlaubt.
   * Klappt es nicht, heißt es "Mikrofon unterbrochen – zum Fortsetzen Mitte tippen" (dann hilft resume()).
   * freshSession: danach eine neue Sitzung beginnen (z. B. nach dem Zurückkehren in die App).
   * stalled: es kommen keine Daten mehr – erst den Graphen neu bauen, beim nächsten Mal auch die Spur
   * neu anfordern, danach um ein Tippen bitten (das Tippen legt dann auch den Audio-Kontext neu an).
   */
  async _recover(freshSession, stalled = false) {
    if (!this._canRecover() || this._recovering || !isVisible()) return;
    if (stalled && this._stallRepairs >= 2) {
      // Neuer Graph und neue Spur haben nicht geholfen. Ein "laufender" Kontext, der nichts mehr liefert,
      // lässt sich nur durch einen frischen ersetzen – das passiert beim Tippen (_prepareContext). Kommt es
      // danach wieder zum Stillstand, nehmen wir ab dann den ScriptProcessor statt AudioWorklet.
      this._stallInterrupts++;
      if (this._stallInterrupts >= 2) this._forceScriptProcessor = true;
      this._markInterrupted();
      return;
    }
    this._recovering = true;
    const attempt = ++this._recoveryId;
    const token = this._captureToken;
    const stillValid = () => token === this._captureToken && this._micWanted && !this._userPaused && !this._micError;
    if (stalled) this._stallRepairs++;
    try {
      // 1. Audio-Kontext
      let ctx = this._ctx;
      if (!ctx || ctx.state === 'closed') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this._teardownGraph();
        ctx = new AudioContextClass();
        this._ctx = ctx;
        ctx.onstatechange = () => this._onContextState(ctx);
      }
      if (!(await waitForRunning(ctx, RESUME_WAIT_MS))) {
        if (stillValid()) this._markInterrupted();
        return;
      }
      if (!stillValid()) return;

      // 2. Mikrofonspur (beendet, dauerhaft stummgeschaltet oder wiederholter Stillstand → neu anfordern)
      let renewStream = !streamLive(this._stream) || (stalled && this._stallRepairs > 1);
      if (!renewStream && !(await waitForUnmute(this._stream, UNMUTE_WAIT_MS))) {
        renewStream = true;
        this._lastMuteRepairAt = Date.now(); // ist auch die neue Spur stumm, hilft nur noch ein Tippen
      }
      if (!stillValid()) return;
      if (renewStream) {
        this._teardownGraph();
        this._dropStream();
        let stream;
        try {
          stream = await this._requestStream();
        } catch (error) {
          if (stillValid()) this._markInterrupted();
          return;
        }
        if (!stillValid()) {
          stopTracks(stream);
          return;
        }
        this._adoptStream(stream);
      }
      if (!stillValid()) return;

      // 3. Audio-Graph (bei Stillstand immer neu aufbauen)
      if (stalled || !this._graph || this._graph.ctx !== ctx || this._graph.stream !== this._stream) {
        const useWorklet = await this._loadWorkletModule(ctx);
        if (!stillValid()) return;
        this._buildGraph(ctx, this._stream, useWorklet);
      }

      this._interrupted = false;
      this._lastAudioAt = Date.now();
      if (freshSession && this._workerSession) this._nextSession();
      this._refresh();
    } catch (error) {
      if (stillValid()) this._markInterrupted();
    } finally {
      if (attempt === this._recoveryId) this._recovering = false;
    }
  }

  _markInterrupted() {
    this._muteInterrupted = false;
    this._interrupted = true;
    this._refresh();
    this._emitLevel(0);
  }
}
