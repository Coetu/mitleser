// Mitleser – Bedienoberfläche (Einstiegspunkt der App, wird von index.html geladen)
//
// Verbindet die Bausteine:
//   text.js        Vortragstext -> Abschnitte und Tokens (Wörter mit Satzzeichen)
//   matcher.js     Tracker: Welche Wörter des Abschnitts sind schon vorgelesen?
//   navigation.js  Blättern zwischen den Abschnitten
//   speech.js      Spracherkennung (Mikrofon + Vosk im Hintergrund, alles auf dem Gerät)
//   storage.js     Speichern auf dem Gerät (Text, Einstellungen, Fortsetzen-Punkt)
//   wakelock.js    Bildschirm während der Präsentation anlassen
//
// Zwei Ansichten: Vorbereitung (#viewPrep) und Präsentation (#viewPresent). Es wird nie neu geladen,
// nur umgeschaltet. Für automatische Tests im Browser gibt es window.mitleser (ganz unten).

import { parseScript, countScript } from './text.js';
import { Tracker } from './matcher.js';
import { Navigation } from './navigation.js';
import { Speech } from './speech.js';
import * as storage from './storage.js';
import { keepAwake, isWebAppWakeLockBroken } from './wakelock.js';

/** Versionsnummer – muss genau gleich VERSION in sw.js sein (tests/release.test.js prüft das). */
const APP_VERSION = '1.0.0';

const MODEL_URL = new URL('../models/vosk-model-small-de-0.15.tar.gz', import.meta.url);
const MODEL_BYTES = 46376422;
const MODEL_CACHE = 'mitleser-modell-v1'; // in diesem Cache legt speech.js das Sprachmodell ab

const COUNT_DELAY = 250; // ms: Wortzähler nach dem Tippen aktualisieren
const SAVE_DELAY = 400; // ms: Text nach dem Tippen speichern
const AUTO_ADVANCE_DELAY = 1500; // ms: automatisch weiterblättern am Abschnittsende
const TAP_MAX_MOVE = 12; // px: mehr Bewegung = Wischen, kein Tippen
const TAP_MAX_TIME = 700; // ms: länger gedrückt = kein Tippen
const SCROLL_STOP_GUARD = 200; // ms: Berührung so kurz nach eigenem Wischen stoppt nur den Schwung (kein Tippen)
const USER_SCROLL_PAUSE = 1500; // ms: so lange nach eigenem Wischen nicht automatisch mitscrollen
const FINGER_MAX_HOLD = 10000; // ms: so lange gilt ein aufgelegter Finger höchstens (falls touchend verloren geht)
const SCROLL_BAND_TOP = 0.18; // Das nächste Wort soll zwischen 18 % …
const SCROLL_BAND_BOTTOM = 0.55; // … und 55 % der Höhe stehen, sonst wird gescrollt,
const SCROLL_TARGET = 0.33; // und zwar so, dass es bei 33 % steht.
const HYPHENATE_FROM = 72; // px: ab dieser Schriftgröße lange Wörter mit Trennstrich umbrechen
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const EXPORT_NOTICE_MS = 12000; // ms: Hinweis nach dem Kopieren in die Zwischenablage
const WAKE_WARNING_MS = 6000; // ms: Warnung, wenn sich der Bildschirm abschalten könnte
const WAKE_WARNING =
  'Der Bildschirm kann sich abschalten – bitte in den iPad-Einstellungen „Automatische Sperre“ auf „Nie“ stellen.';

// ---------------------------------------------------------------------------------------------------------
// Elemente der Seite

const $ = (id) => document.getElementById(id);
const el = {
  viewPrep: $('viewPrep'),
  viewPresent: $('viewPresent'),
  // Vorbereitung
  script: $('script'),
  saveState: $('saveState'),
  counts: $('counts'),
  btnImport: $('btnImport'),
  fileImport: $('fileImport'),
  btnExport: $('btnExport'),
  exportNotice: $('exportNotice'),
  btnStart: $('btnStart'),
  btnResume: $('btnResume'),
  startMessage: $('startMessage'),
  optRecognition: $('optRecognition'),
  optAutoAdvance: $('optAutoAdvance'),
  asrStatus: $('asrStatus'),
  asrStatusText: $('asrStatusText'),
  asrPercent: $('asrPercent'),
  asrProgress: $('asrProgress'),
  asrHint: $('asrHint'),
  btnRetry: $('btnRetry'),
  btnMicTest: $('btnMicTest'),
  micTestPanel: $('micTestPanel'),
  micTestLevel: $('micTestLevel'),
  micTestOut: $('micTestOut'),
  fontSize: $('fontSize'),
  fontSizeValue: $('fontSizeValue'),
  installTip: $('installTip'),
  wakeTip: $('wakeTip'),
  offlineState: $('offlineState'),
  offlineText: $('offlineText'),
  updateNotice: $('updateNotice'),
  btnReload: $('btnReload'),
  appVersion: $('appVersion'),
  // Präsentation
  btnBack: $('btnBack'),
  counter: $('counter'),
  micStatus: $('micStatus'),
  micStatusText: $('micStatusText'),
  text: $('text'),
  textInner: $('textInner'),
  hintOverlay: $('hintOverlay'),
  hintMic: $('hintMic'),
  toast: $('toast'),
};

// ---------------------------------------------------------------------------------------------------------
// Zustand der App

const state = {
  view: 'prep', // 'prep' | 'present'
  settings: storage.loadSettings(),
  sectionCount: 0, // laut Zähler in der Vorbereitung
  resumeIndex: null, // Fortsetzen-Punkt (auch ohne funktionierenden Speicher im Gedächtnis)
  textDirty: false, // Text geändert, aber noch nicht gespeichert
  // Präsentation
  script: null, // Ergebnis von parseScript() beim Start
  nav: null, // Navigation
  tracker: null, // Tracker des aktuellen Abschnitts
  tokenEls: [], // <span class="tok"> des aktuellen Abschnitts
  shownColored: 0, // so viele Tokens tragen gerade die Klasse .read
  shownNext: -1, // dieses Token trägt gerade die Klasse .next (-1 = keins)
  wordsSession: -1, // Sitzung der zuletzt verarbeiteten Wörter
  wordsFinal: true, // war das zuletzt verarbeitete Ergebnis eine abgeschlossene Äußerung?
  autoTimer: 0,
  lastMicUi: 'off', // zuletzt angezeigter Mikrofon-Zustand (für kurze Meldungen bei Wechseln)
  lastBehind: false, // kam die Erkennung zuletzt nicht hinterher?
  prepScrollY: 0,
  presentRun: 0, // zählt jeden Präsentationsstart (für verspätete Rückmeldungen)
  // Scrollen von Hand erkennen (siehe onTextScroll); Zeitpunkte in ms (performance.now())
  panAt: 0, // zuletzt begann ein Wischen mit dem Finger
  autoScrollAt: 0, // zuletzt hat die App selbst gescrollt
  userScrollAt: 0, // letztes Scroll-Ereignis vom eigenen Wischen (auch vom Schwung danach)
  fingers: 0, // so viele Finger liegen gerade auf dem Text
  fingerAt: 0, // wann zuletzt ein Finger aufgesetzt wurde
  // Mikrofontest
  micTest: false,
  testFinal: [], // abgeschlossene Äußerungen
  testPartial: '', // laufende Äußerung
  // Offline
  modelCached: null, // liegt das Sprachmodell im Cache? null = noch unbekannt, sonst true/false
  modelState: '', // zuletzt gemeldeter Zustand des Sprachmodells
  cacheCheckRun: 0, // zählt die Cache-Prüfungen; nur das Ergebnis der neuesten zählt
};

// ---------------------------------------------------------------------------------------------------------
// Kleine Helfer

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

/** Ruft fn auf und fängt Fehler ab – auch spätere Fehler eines zurückgegebenen Promise. */
function safely(fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') result.then(undefined, (error) => console.warn(error));
    return result;
  } catch (error) {
    console.warn(error);
    return undefined;
  }
}

/** Verzögert fn, bis ms lang kein neuer Aufruf kam. flush() führt einen ausstehenden Aufruf sofort aus. */
function debounce(fn, ms) {
  let timer = 0;
  const run = () => {
    timer = 0;
    fn();
  };
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  return debounced;
}

function plural(n, one, many) {
  return `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
}

/** "3 Abschnitte · 245 Wörter" (Einzahl: "1 Abschnitt", "1 Wort"). */
function formatCounts(counts) {
  return `${plural(counts.sections, 'Abschnitt', 'Abschnitte')} · ${plural(counts.words, 'Wort', 'Wörter')}`;
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function isAppleTouchDevice() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

function isStandalone() {
  return navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

// ---------------------------------------------------------------------------------------------------------
// Spracherkennung

/** Ersatz, falls speech.js nicht starten kann: gleiche Schnittstelle, meldet nur den Fehler. */
class SpeechUnavailable extends EventTarget {
  constructor(message) {
    super();
    this.session = 0;
    this.status = {
      model: { state: 'error', progress: null, message: 'Spracherkennung nicht verfügbar: ' + message },
      mic: { state: 'off', message: '' },
      lagging: false,
    };
  }
  loadModel() {
    return Promise.reject(new Error(this.status.model.message));
  }
  start() {
    return Promise.resolve();
  }
  newSession() {}
  pause() {}
  resume() {
    return Promise.resolve();
  }
  stop() {}
}

function createSpeech() {
  try {
    return new Speech({
      workerUrl: new URL('./asr-worker.js', import.meta.url),
      workletUrl: new URL('./audio-worklet.js', import.meta.url),
      modelUrl: MODEL_URL,
      modelBytes: MODEL_BYTES,
    });
  } catch (error) {
    console.error('Spracherkennung konnte nicht gestartet werden:', error);
    return new SpeechUnavailable(messageOf(error));
  }
}

const speech = createSpeech();

/** Aktueller Status der Spracherkennung, immer vollständig (fehlende Teile mit Standardwerten). */
function speechStatus() {
  const st = (speech && speech.status) || {};
  return {
    model: st.model || { state: 'idle', progress: null, message: '' },
    mic: st.mic || { state: 'off', message: '' },
    lagging: !!st.lagging,
  };
}

/**
 * Mikrofon einschalten. MUSS synchron in einer Tipp-/Klick-Geste aufgerufen werden (iOS erlaubt Ton und
 * Mikrofon nur dann). Läuft das Mikrofon schon (z. B. vom Mikrofontest), beginnt nur eine neue Sitzung.
 */
function startListening() {
  safely(() => speech.start());
}

/** Neue Sitzung nach Blättern/Zurücksetzen: Was vorher gesagt wurde, zählt nicht mehr. */
function newSpeechSession() {
  if (state.settings.recognition) safely(() => speech.newSession());
}

speech.addEventListener('status', () => {
  // Für die Offline-Anzeige: Was liegt nach einem Wechsel des Modell-Zustands wirklich auf dem Gerät?
  const modelState = speechStatus().model.state;
  if (modelState !== state.modelState) {
    state.modelState = modelState;
    if (modelState === 'loading') {
      // Es wird heruntergeladen, also liegt kein brauchbares Modell auf dem Gerät (fehlt oder war kaputt).
      state.modelCached = false;
      state.cacheCheckRun++; // eine noch laufende Prüfung zählt nicht mehr
    } else if (modelState === 'ready' || modelState === 'error') {
      checkModelCache();
    }
  }
  renderSpeechStatus();
});

speech.addEventListener('words', (event) => {
  const detail = event.detail || {};
  if (detail.session !== speech.session) return; // veraltetes Ergebnis einer früheren Sitzung
  const words = Array.isArray(detail.words) ? detail.words : [];
  const final = !!detail.final;
  if (state.view === 'prep') {
    if (state.micTest) showTestWords(words, final);
    return;
  }
  onPresentationWords(detail.session, words, final);
});

speech.addEventListener('level', (event) => {
  const level = Math.max(0, Math.min(1, Number(event.detail && event.detail.level) || 0));
  if (state.view === 'present') {
    // Pegel nur bei „hört zu“ zeigen (nicht bei „lädt …“ oder „pausiert“)
    if (micUiState() === 'listening') el.micStatus.style.setProperty('--level', level.toFixed(2));
  } else if (state.micTest) {
    // Im Mikrofontest auch schon, während das Modell noch lädt: Man sieht, dass das Mikrofon Ton liefert.
    el.micTestLevel.style.transform = `scaleX(${level.toFixed(3)})`;
  }
});

// ---------------------------------------------------------------------------------------------------------
// Vorbereitung: Text, Zähler, automatisches Speichern

function updateCounts() {
  const counts = countScript(el.script.value);
  state.sectionCount = counts.sections;
  el.counts.textContent = formatCounts(counts);
  updateStartButtons();
}

const scheduleCounts = debounce(updateCounts, COUNT_DELAY);

function saveTextNow() {
  if (!state.textDirty) return;
  state.textDirty = false;
  showSaveState(storage.saveText(el.script.value));
}

const scheduleSave = debounce(saveTextNow, SAVE_DELAY);

function showSaveState(ok) {
  el.saveState.textContent = ok ? 'gespeichert' : 'Speichern nicht möglich (Speicher voll oder gesperrt)';
  el.saveState.classList.toggle('failed', !ok);
}

function onScriptInput() {
  state.textDirty = true;
  el.saveState.textContent = '';
  scheduleSave();
  scheduleCounts();
}

/** Text sofort speichern (beim Verlassen des Feldes, der Seite oder vor dem Start). */
function flushText() {
  scheduleSave.flush();
  saveTextNow();
}

// ---------------------------------------------------------------------------------------------------------
// Vorbereitung: Starten / Fortsetzen

function rememberResume(index) {
  state.resumeIndex = index;
  storage.saveResume(index);
}

function forgetResume() {
  state.resumeIndex = null;
  storage.clearResume();
}

function updateStartButtons() {
  const count = state.sectionCount;
  const empty = count === 0;
  el.btnStart.disabled = empty;
  el.btnResume.disabled = empty;
  el.startMessage.hidden = !empty;
  const r = state.resumeIndex;
  const canResume = r !== null && r > 0 && r < count;
  el.btnResume.hidden = !canResume;
  if (canResume) el.btnResume.textContent = `Bei Abschnitt ${r + 1} fortsetzen`;
}

// ---------------------------------------------------------------------------------------------------------
// Vorbereitung: Import und Export

async function importFile(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    alert('Die Datei ist zu groß für einen Vortragstext (höchstens 5 MB).');
    return;
  }
  let text;
  try {
    text = storage.decodeTextFile(await file.arrayBuffer());
  } catch (error) {
    alert('Die Datei konnte nicht gelesen werden: ' + messageOf(error));
    return;
  }
  if (el.script.value.trim() !== '' && !confirm(`Den vorhandenen Vortragstext durch den Inhalt von „${file.name}“ ersetzen?`)) {
    return;
  }
  el.script.value = text;
  el.script.scrollTop = 0;
  state.textDirty = true;
  saveTextNow();
  forgetResume(); // neuer Text: der alte Fortsetzen-Punkt passt nicht mehr
  updateCounts();
}

function onFileChosen() {
  const file = el.fileImport.files && el.fileImport.files[0];
  if (!file) return;
  importFile(file)
    .catch((error) => alert('Import fehlgeschlagen: ' + messageOf(error)))
    .then(() => {
      el.fileImport.value = ''; // damit dieselbe Datei erneut gewählt werden kann
    });
}

/** Teilen-Menü nur auf iPad/iPhone/Android – am Computer ist ein normaler Download praktischer. */
function canShareFile(file) {
  if (!navigator.share || !navigator.canShare) return false;
  if (!isAppleTouchDevice() && !/Android/.test(navigator.userAgent || '')) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch (error) {
    return false;
  }
}

function downloadBlob(blob, name) {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    console.warn('Download fehlgeschlagen:', error);
  }
}

let exportNoticeTimer = 0;

/** Kurzer Hinweis unter den Knöpfen Importieren/Exportieren (verschwindet von selbst). */
function showExportNotice(message) {
  el.exportNotice.textContent = message;
  el.exportNotice.hidden = false;
  clearTimeout(exportNoticeTimer);
  exportNoticeTimer = setTimeout(() => {
    el.exportNotice.hidden = true;
  }, EXPORT_NOTICE_MS);
}

/**
 * Ersatz fürs Herunterladen in der Home-Bildschirm-App: den Text in die Zwischenablage kopieren.
 * Klappt auch das nicht, bleibt nur das Kopieren von Hand.
 */
function copyForExport(text) {
  const askToCopyByHand = () =>
    alert(
      'Der Vortragstext konnte nicht exportiert werden. Bitte den Text im Feld „Vortragstext“ markieren, ' +
        'kopieren und z. B. in der Dateien- oder Notizen-App einfügen.',
    );
  let copying = null;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) copying = navigator.clipboard.writeText(text);
  } catch (error) {
    copying = null;
  }
  if (!copying) {
    askToCopyByHand();
    return;
  }
  Promise.resolve(copying).then(
    () => showExportNotice('Der Vortragstext wurde in die Zwischenablage kopiert – z. B. in der Dateien- oder Notizen-App einfügen.'),
    askToCopyByHand,
  );
}

/** Öffnet das Teilen-Menü für die Datei. Liefert ein Promise (auch wenn share() sofort einen Fehler wirft). */
function shareFile(file) {
  try {
    return Promise.resolve(navigator.share({ files: [file], title: file.name }));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Exportiert den Text als "Vortrag.txt" (iPad: Teilen-Menü mit „In Dateien sichern“). Wirft nie. */
function exportText() {
  try {
    flushText();
    const text = el.script.value;
    const name = storage.EXPORT_FILE_NAME;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    let file = null;
    try {
      file = new File([blob], name, { type: 'text/plain' });
    } catch (error) {
      file = null;
    }
    // In der Home-Bildschirm-App auf iPad/iPhone NIE herunterladen: Ein Download kann die App dort
    // blockieren (WebKit-Fehler 290847, hilft nur noch Beenden der App). Stattdessen Zwischenablage.
    const fallback = isStandalone() && isAppleTouchDevice() ? () => copyForExport(text) : () => downloadBlob(blob, name);
    if (file && canShareFile(file)) {
      // Direkt in der Klick-Geste aufrufen, sonst verweigert Safari das Teilen.
      shareFile(file).catch((error) => {
        if (!error || error.name !== 'AbortError') fallback(); // Abbrechen = nichts tun
      });
      return;
    }
    fallback();
  } catch (error) {
    console.warn('Export fehlgeschlagen:', error);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Vorbereitung: Einstellungen

function saveSettingsNow() {
  storage.saveSettings(state.settings);
}

const scheduleSettingsSave = debounce(saveSettingsNow, SAVE_DELAY);

function applyFontSize(px) {
  document.documentElement.style.setProperty('--font-size', px + 'px');
  el.fontSizeValue.textContent = px + ' px';
  const fill = ((px - storage.FONT_SIZE_MIN) / (storage.FONT_SIZE_MAX - storage.FONT_SIZE_MIN)) * 100;
  el.fontSize.style.setProperty('--fill', fill.toFixed(1) + '%');
  el.textInner.classList.toggle('hyphenate', px >= HYPHENATE_FROM);
}

function applySettingsToUi() {
  const s = state.settings;
  el.fontSize.value = String(s.fontSize);
  s.fontSize = storage.clampFontSize(el.fontSize.value); // der Regler rastet auf gerade Werte ein
  el.optRecognition.checked = s.recognition;
  el.optAutoAdvance.checked = s.autoAdvance;
  applyFontSize(s.fontSize);
}

function onFontSizeInput() {
  state.settings.fontSize = storage.clampFontSize(el.fontSize.value);
  applyFontSize(state.settings.fontSize);
  scheduleSettingsSave();
}

function onRecognitionChange() {
  state.settings.recognition = el.optRecognition.checked;
  saveSettingsNow();
  if (state.settings.recognition) {
    safely(() => speech.loadModel());
  } else {
    // Ausgeschaltet: kein Mikrofon mehr (das geladene Modell bleibt im Speicher, falls es wieder gebraucht wird)
    state.micTest = false;
    safely(() => speech.stop());
  }
  renderSpeechStatus();
}

function onAutoAdvanceChange() {
  state.settings.autoAdvance = el.optAutoAdvance.checked;
  saveSettingsNow();
}

// ---------------------------------------------------------------------------------------------------------
// Vorbereitung: Anzeige des Sprachstatus

function renderSpeechStatus() {
  renderAsrStatus();
  renderMicStatus();
  renderMicTest();
  renderOffline();
}

function renderAsrStatus() {
  const { model, mic, lagging } = speechStatus();
  let ui = 'off';
  let text = 'Spracherkennung aus';
  let percent = ''; // " 37 %" – eigenes Element, damit Bildschirmleser nicht jedes Prozent vorlesen
  let progress = null; // null = kein Balken, 'unknown' = Balken ohne Prozentangabe, sonst 0 … 1
  let retry = false;
  let hint = ''; // zusätzliche Zeile unter dem Status
  if (state.settings.recognition) {
    if (model.state === 'ready') {
      ui = 'ready';
      text = 'Spracherkennung bereit';
      hint = model.message || ''; // z. B. "… konnte nicht offline gespeichert werden …"
    } else if (model.state === 'preparing') {
      ui = 'loading';
      text = 'Sprachmodell wird vorbereitet …';
      progress = 'unknown';
    } else if (model.state === 'error') {
      ui = 'error';
      text = 'Fehler: ' + (model.message || 'Das Sprachmodell konnte nicht geladen werden.');
      retry = true;
    } else {
      // 'idle' (gleich geht es los) oder 'loading'
      const p = model.state === 'loading' && typeof model.progress === 'number' ? model.progress : null;
      ui = 'loading';
      text = 'Sprachmodell wird geladen …';
      if (p !== null) percent = ` ${Math.round(p * 100)} %`;
      progress = p !== null ? p : 'unknown';
      // 'loading' heißt: Es wird heruntergeladen (aus dem Offline-Speicher kommt es ohne diesen Schritt).
      if (model.state === 'loading') hint = 'Einmalig ca. 46 MB – danach offline verfügbar';
    }
    if (mic.state === 'error' && ui !== 'error') {
      ui = 'error';
      text = 'Fehler: ' + (mic.message || 'Das Mikrofon ist nicht verfügbar.');
    }
    // Mikrofontest hängt (Fehler oder von iPadOS unterbrochen): „Erneut versuchen“ startet das Mikrofon neu.
    if (state.micTest && (mic.state === 'error' || mic.state === 'paused')) retry = true;
    if (!hint && lagging && mic.state === 'listening') hint = 'Erkennung kommt nicht hinterher – andere Apps schließen hilft.';
  }
  el.asrStatus.dataset.state = ui;
  el.asrStatusText.textContent = text;
  el.asrPercent.textContent = percent;
  el.asrProgress.hidden = progress === null;
  el.asrProgress.classList.toggle('indeterminate', progress === 'unknown');
  const bar = el.asrProgress.firstElementChild;
  if (bar) bar.style.width = typeof progress === 'number' ? `${Math.round(progress * 100)}%` : '';
  el.asrHint.textContent = hint;
  el.asrHint.hidden = !hint;
  el.btnRetry.hidden = !retry;
}

/** Offline-Anzeige: Service Worker steuert die Seite UND das Sprachmodell liegt auf dem Gerät. */
function renderOffline() {
  const controlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  const { model } = speechStatus();
  // Liegt das Sprachmodell auf dem Gerät? Während eines Downloads sicher nicht. Ist es bereit, weiß es
  // speech.js genau (model.cached). Sonst zählt das Ergebnis der Cache-Prüfung.
  let modelOk = state.modelCached === true;
  if (model.state === 'loading') modelOk = false;
  else if (model.state === 'ready' && typeof model.cached === 'boolean') modelOk = model.cached;
  let ready = false;
  let text = 'Noch nicht offline verfügbar';
  if (controlled && modelOk) {
    ready = true;
    text = 'Offline bereit';
  } else if (controlled && !state.settings.recognition) {
    ready = true;
    text = 'Offline bereit (ohne Spracherkennung)';
  }
  el.offlineState.dataset.state = ready ? 'yes' : 'no';
  el.offlineText.textContent = text;
}

/** Prüft (im Hintergrund), ob speech.js das Sprachmodell im Cache abgelegt hat. */
async function checkModelCache() {
  const run = ++state.cacheCheckRun;
  let cached = false;
  try {
    if (typeof caches !== 'undefined' && (await caches.has(MODEL_CACHE))) {
      const cache = await caches.open(MODEL_CACHE);
      cached = !!(await cache.match(MODEL_URL.href));
    }
  } catch (error) {
    cached = false;
  }
  if (run !== state.cacheCheckRun) return; // inzwischen gab es eine neuere Prüfung oder einen Download
  state.modelCached = cached;
  renderOffline();
}

// ---------------------------------------------------------------------------------------------------------
// Vorbereitung: Mikrofontest

function startMicTest() {
  if (!state.settings.recognition) return;
  state.micTest = true;
  state.testFinal = [];
  state.testPartial = '';
  startListening(); // synchron in der Klick-Geste
  renderMicTest();
}

function stopMicTest() {
  if (!state.micTest) return;
  state.micTest = false;
  safely(() => speech.stop());
  renderMicTest();
}

/**
 * „Erneut versuchen“: Läuft der Mikrofontest, wird alles neu gestartet (Mikrofon und, falls nötig, Modell) –
 * synchron in der Klick-Geste, denn iOS gibt das Mikrofon nur dann frei. Sonst nur das Modell neu laden.
 */
function retrySpeech() {
  if (state.micTest) startListening();
  else safely(() => speech.loadModel());
}

function renderMicTest() {
  const active = state.micTest;
  el.btnMicTest.textContent = active ? 'Test beenden' : 'Mikrofon testen';
  el.btnMicTest.classList.toggle('active', active);
  el.btnMicTest.disabled = !state.settings.recognition;
  el.micTestPanel.hidden = !active;
  if (active) renderTestWords();
  else el.micTestLevel.style.transform = 'scaleX(0)';
}

const TEST_INTERRUPTED = 'Mikrofon unterbrochen – zum Fortsetzen „Erneut versuchen“ tippen.';

function testPlaceholder() {
  const { model, mic } = speechStatus();
  if (model.state === 'error') return 'Das Sprachmodell ist nicht verfügbar – siehe Meldung oben.';
  if (mic.state === 'error') return 'Das Mikrofon ist nicht verfügbar – siehe Meldung oben.';
  if (model.state !== 'ready') return 'Das Sprachmodell wird noch geladen – die Wörter erscheinen, sobald es bereit ist.';
  if (mic.state !== 'listening') return 'Mikrofon wird gestartet …';
  return 'Bitte etwas sagen – die erkannten Wörter erscheinen hier.';
}

function renderTestWords() {
  const out = el.micTestOut;
  const finalText = state.testFinal.join(' ');
  out.textContent = '';
  // Unterbrochen (z. B. nach einem App-Wechsel): Das ist wichtiger als die zuletzt erkannten Wörter.
  const interrupted = speechStatus().mic.state === 'paused';
  if (interrupted || (!finalText && !state.testPartial)) {
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = interrupted ? TEST_INTERRUPTED : testPlaceholder();
    out.appendChild(span);
    return;
  }
  if (finalText) out.appendChild(document.createTextNode(finalText + ' '));
  if (state.testPartial) {
    const span = document.createElement('span');
    span.className = 'partial';
    span.textContent = state.testPartial;
    out.appendChild(span);
  }
}

function showTestWords(words, final) {
  const text = words.join(' ');
  if (final) {
    if (text) state.testFinal.push(text);
    while (state.testFinal.length > 1 && state.testFinal.join(' ').length > 240) state.testFinal.shift();
    state.testPartial = '';
  } else {
    state.testPartial = text;
  }
  renderTestWords();
}

// ---------------------------------------------------------------------------------------------------------
// Ansicht umschalten

function setView(view) {
  state.view = view;
  document.documentElement.dataset.view = view;
  el.viewPrep.hidden = view !== 'prep';
  el.viewPresent.hidden = view !== 'present';
}

/** Präsentation starten. Läuft komplett synchron in der Klick-Geste (wichtig für Mikrofon und Wake Lock). */
function startPresentation(fromIndex) {
  const script = parseScript(el.script.value);
  if (!script.sections.length) {
    updateCounts();
    return;
  }
  // Mikrofon so früh wie möglich einschalten, synchron in der Geste (iOS!). Ein laufender Mikrofontest endet
  // hier; sein Mikrofon wird für die Präsentation weiterbenutzt.
  const wasTesting = state.micTest;
  state.micTest = false;
  if (state.settings.recognition) startListening();
  else if (wasTesting) safely(() => speech.stop());
  renderMicTest();

  flushText();
  state.script = script;
  state.nav = new Navigation(script.sections.length, fromIndex);
  state.prepScrollY = window.scrollY || 0;
  if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();

  setView('present');
  const run = ++state.presentRun;
  // Bildschirm anlassen. Klappt das nicht (keine Wake-Lock-API oder abgelehnt), warnen – nach einer evtl.
  // gerade sichtbaren Meldung und nur, wenn diese Präsentation dann noch läuft.
  Promise.resolve(keepAwake(true)).then((awake) => {
    if (!awake) showToastLater(WAKE_WARNING, WAKE_WARNING_MS, () => state.view === 'present' && state.presentRun === run);
  });
  showSection();
  showHintOverlay();
  state.lastMicUi = micUiState();
  renderMicStatus();
  if (state.lastMicUi === 'error') showToast('Spracherkennung nicht verfügbar – oben rechts tippen für Details', 4500);
  try {
    el.text.focus({ preventScroll: true });
  } catch (error) {
    /* egal */
  }
}

/** Präsentation beenden: Mikrofon freigeben, Bildschirm darf wieder aus, zurück zur Vorbereitung. */
function leavePresentation() {
  if (state.view !== 'present') return;
  clearAutoAdvance();
  safely(() => speech.stop());
  keepAwake(false);
  if (state.nav) rememberResume(state.nav.index);
  hideToast();
  el.hintOverlay.classList.remove('show');
  state.tracker = null;
  state.tokenEls = [];
  el.textInner.textContent = '';
  setView('prep');
  updateCounts();
  renderSpeechStatus();
  window.scrollTo(0, state.prepScrollY);
  const target = el.btnResume.hidden ? el.btnStart : el.btnResume;
  try {
    target.focus({ preventScroll: true });
  } catch (error) {
    /* egal */
  }
}

// ---------------------------------------------------------------------------------------------------------
// Präsentation: Abschnitt anzeigen und einfärben

function currentSection() {
  return state.script.sections[state.nav.index];
}

/**
 * Baut den Text des Abschnitts auf: <span class="tok" data-i="N">, Absätze als <p>, Zeilenumbrüche als <br>.
 * Regieanweisungen wie „[Folie 12]“ (token.cue) bekommen zusätzlich die Klasse "cue": nicht vorlesen.
 */
function renderSection() {
  const section = currentSection();
  const fragment = document.createDocumentFragment();
  const tokenEls = [];
  let para = null;
  section.tokens.forEach((token, i) => {
    if (!para || token.brk === 2) {
      para = document.createElement('p');
      para.className = 'para';
      fragment.appendChild(para);
    } else if (token.brk === 1) {
      para.appendChild(document.createElement('br'));
    } else {
      para.appendChild(document.createTextNode(' '));
    }
    const span = document.createElement('span');
    span.className = token.cue === true ? 'tok cue' : 'tok';
    span.dataset.i = String(i);
    span.textContent = token.text;
    para.appendChild(span);
    tokenEls.push(span);
  });
  el.textInner.textContent = '';
  el.textInner.appendChild(fragment);
  state.tokenEls = tokenEls;
  state.shownColored = 0;
  state.shownNext = -1;
  el.counter.textContent = `${state.nav.index + 1} / ${state.nav.count}`;
}

/** Frischer Tracker für den aktuellen Abschnitt (alles ungefärbt, Gesagtes vergessen). */
function freshTracker() {
  clearAutoAdvance();
  state.tracker = new Tracker(currentSection().tokens);
  state.wordsSession = -1;
  state.wordsFinal = true;
}

/** Neuer Abschnitt: aufbauen, nach oben, Fortsetzen-Punkt merken. */
function showSection() {
  freshTracker();
  renderSection();
  renderColoring();
  scrollTextTo(0);
  rememberResume(state.nav.index);
}

/** Färbung aktualisieren – nur die geänderten Tokens bekommen andere Klassen (kein Neuaufbau). */
function renderColoring() {
  const els = state.tokenEls;
  const colored = Math.min(state.nav ? state.nav.colored : 0, els.length);
  for (let i = state.shownColored; i < colored; i++) els[i].classList.add('read');
  for (let i = colored; i < state.shownColored; i++) els[i].classList.remove('read');
  state.shownColored = colored;

  let next = -1;
  if (state.settings.recognition && state.tracker) {
    const i = state.tracker.nextIndex;
    if (i >= 0 && i < els.length) next = i;
  }
  if (next !== state.shownNext) {
    if (state.shownNext >= 0 && els[state.shownNext]) els[state.shownNext].classList.remove('next');
    if (next >= 0) els[next].classList.add('next');
    state.shownNext = next;
  }
}

/** Erkannte Wörter während der Präsentation. */
function onPresentationWords(session, words, final) {
  if (state.view !== 'present' || !state.tracker || !state.nav || !state.settings.recognition) return;
  if (speechStatus().mic.state === 'paused') return; // pausiert: nichts einfärben
  // Neue Sitzung (z. B. nach Pause oder wenn die Erkennung aufholen musste): vorige Äußerung abschließen.
  if (session !== state.wordsSession) {
    if (!state.wordsFinal) state.tracker.update([], true);
    state.wordsSession = session;
  }
  state.wordsFinal = final;
  const position = state.tracker.update(words, final);
  if (state.nav.setColored(position)) {
    renderColoring();
    // Nicht gegen das eigene Wischen anscrollen; kurz danach scrollt der Text wieder mit.
    if (!userScrolledWithin(USER_SCROLL_PAUSE) && !fingerOnText()) keepNextVisible();
    scheduleAutoAdvance();
  } else if (state.tracker.nextIndex !== state.shownNext) {
    renderColoring();
  }
}

/** Scrollt den Text von der App aus (zählt nicht als Wischen des Nutzers, siehe onTextScroll). */
function scrollTextTo(top, smooth = false) {
  state.autoScrollAt = performance.now();
  if (smooth) el.text.scrollTo({ top, behavior: 'smooth' });
  else el.text.scrollTop = top;
}

/**
 * Hält das nächste Wort sichtbar: Steht seine Zeile außerhalb von 18–55 % der Texthöhe, wird so gescrollt,
 * dass sie bei etwa 33 % steht.
 */
function keepNextVisible(instant = false) {
  const els = state.tokenEls;
  if (!els.length || !state.tracker) return;
  let i = state.tracker.nextIndex;
  if (i >= els.length) i = Math.max(0, Math.min(els.length, state.nav.colored) - 1); // fertig: letztes Wort
  const target = els[Math.min(i, els.length - 1)];
  const height = el.text.clientHeight;
  if (!target || !height) return;
  const rects = target.getClientRects(); // bei getrennten Wörtern: erster Teil
  const rect = rects.length ? rects[0] : target.getBoundingClientRect();
  const top = rect.top - el.text.getBoundingClientRect().top;
  if (top >= height * SCROLL_BAND_TOP && top <= height * SCROLL_BAND_BOTTOM) return;
  const goal = Math.max(0, el.text.scrollTop + top - height * SCROLL_TARGET);
  if (Math.abs(goal - el.text.scrollTop) < 2) return;
  scrollTextTo(goal, !instant && !prefersReducedMotion());
}

// ---------------------------------------------------------------------------------------------------------
// Präsentation: Blättern, Mikrofon, automatisches Weiterblättern

function goNext() {
  if (!state.nav || state.view !== 'present') return;
  if (state.nav.next() === 'none') return; // letzter Abschnitt: nichts passiert
  newSpeechSession();
  showSection();
}

function goBack() {
  if (!state.nav || state.view !== 'present') return;
  const result = state.nav.back();
  if (result === 'none') return; // erster Abschnitt, nichts gefärbt
  newSpeechSession();
  if (result === 'reset') {
    freshTracker(); // gleicher Abschnitt, Färbung weg
    renderColoring();
    scrollTextTo(0);
  } else {
    showSection(); // vorheriger Abschnitt, ungefärbt
  }
}

/** Mitte / Taste M: Mikrofon pausieren oder fortsetzen (muss in der Geste laufen). */
function toggleMic() {
  if (state.view !== 'present') return;
  if (!state.settings.recognition) {
    showToast('Die Spracherkennung ist ausgeschaltet (in der Vorbereitung einschalten).', 2600);
    return;
  }
  const { mic } = speechStatus();
  if (mic.state === 'listening' || mic.state === 'starting') safely(() => speech.pause());
  else if (mic.state === 'paused') safely(() => speech.resume());
  else startListening(); // aus oder Fehler: alles neu versuchen
}

function scheduleAutoAdvance() {
  if (!state.settings.autoAdvance || state.autoTimer) return;
  const nav = state.nav;
  const tracker = state.tracker;
  if (!nav || !tracker || !tracker.done || nav.isLast) return;
  const index = nav.index;
  state.autoTimer = setTimeout(() => {
    state.autoTimer = 0;
    // Nur wenn noch derselbe Abschnitt, immer noch fertig und nicht der letzte
    if (state.view === 'present' && state.nav === nav && nav.index === index && state.tracker === tracker && tracker.done && !nav.isLast) {
      goNext();
    }
  }, AUTO_ADVANCE_DELAY);
}

function clearAutoAdvance() {
  clearTimeout(state.autoTimer);
  state.autoTimer = 0;
}

// ---------------------------------------------------------------------------------------------------------
// Präsentation: Mikrofon-Anzeige oben rechts, Hinweis, Meldungen

const MIC_TEXT = { off: 'aus', loading: 'lädt …', listening: 'hört zu', paused: 'pausiert', error: 'Fehler' };

/** Zustand für die Anzeige: 'off' | 'loading' | 'listening' | 'paused' | 'error'. */
function micUiState() {
  if (!state.settings.recognition) return 'off';
  const { model, mic } = speechStatus();
  if (mic.state === 'error' || model.state === 'error') return 'error';
  if (mic.state === 'paused') return 'paused';
  if (mic.state !== 'starting' && mic.state !== 'listening') return 'off';
  if (mic.state === 'starting' || model.state !== 'ready') return 'loading';
  return 'listening';
}

function micErrorMessage() {
  const { model, mic } = speechStatus();
  if (mic.state === 'error') return mic.message || 'Das Mikrofon ist nicht verfügbar.';
  if (model.state === 'error') return model.message || 'Das Sprachmodell konnte nicht geladen werden.';
  return '';
}

function renderMicStatus() {
  const ui = micUiState();
  const { mic, lagging } = speechStatus();
  el.micStatus.dataset.state = ui;
  el.micStatusText.textContent = MIC_TEXT[ui];
  el.micStatus.setAttribute('aria-label', 'Mikrofon: ' + MIC_TEXT[ui]);
  const behind = ui === 'listening' && lagging; // Erkennung kommt mit dem Audio nicht hinterher
  el.micStatus.title = ui === 'error' ? micErrorMessage() : behind ? 'Erkennung kommt nicht hinterher' : '';
  el.micStatus.classList.toggle('lagging', behind);
  if (ui !== 'listening') el.micStatus.style.setProperty('--level', '0');
  if (state.view === 'present') {
    // Kurze Rückmeldung, denn beim Vortragen schaut man nicht in die Ecke
    if (ui !== state.lastMicUi) {
      if (ui === 'paused') showToast(mic.message || 'Mikrofon pausiert', mic.message ? 6000 : 1600);
      else if (ui === 'listening' && state.lastMicUi === 'paused') showToast('Mikrofon an', 1200);
      else if (ui === 'error') showToast('Fehler bei der Spracherkennung – oben rechts tippen für Details', 4500);
    }
    if (behind && !state.lastBehind) showToast('Erkennung kommt nicht hinterher', 3500);
  }
  state.lastMicUi = ui;
  state.lastBehind = behind;
}

function onMicStatusClick() {
  if (micUiState() === 'error') {
    alert(micErrorMessage());
    return;
  }
  toggleMic();
}

function showHintOverlay() {
  el.hintMic.textContent = state.settings.recognition ? 'Mikrofon an/aus' : 'Spracherkennung aus';
  el.hintOverlay.classList.remove('show');
  void el.hintOverlay.offsetWidth; // Animation neu starten
  el.hintOverlay.classList.add('show');
}

let toastTimer = 0;
let toastUntil = 0; // bis wann die aktuelle Meldung zu sehen ist (Date.now())

function showToast(message, ms = 2200) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
  toastUntil = Date.now() + ms;
}

function hideToast() {
  clearTimeout(toastTimer);
  toastUntil = 0;
  el.toast.classList.remove('show');
}

/** Zeigt die Meldung, sobald die gerade sichtbare abgelaufen ist – wenn stillValid() dann noch zutrifft. */
function showToastLater(message, ms, stillValid) {
  setTimeout(() => {
    if (stillValid()) showToast(message, ms);
  }, Math.max(0, toastUntil - Date.now()));
}

// ---------------------------------------------------------------------------------------------------------
// Präsentation: Tippen (links / Mitte / rechts) und Tastatur

const activePointers = new Set();
let tapStart = null; // { id, x, y, time }

/**
 * Scroll-Ereignis im Text. Wurde nach dem letzten Scrollen der App mit dem Finger gewischt, stammt die
 * Bewegung vom Nutzer (auch der Schwung, mit dem der Text nach dem Loslassen weitergleitet).
 */
function onTextScroll() {
  if (state.panAt > state.autoScrollAt) state.userScrollAt = performance.now();
}

/** Liegt gerade ein Finger auf dem Text? (Geht ein touchend verloren, gilt der Finger nach 10 s als weg.) */
function fingerOnText() {
  return state.fingers > 0 && performance.now() - state.fingerAt < FINGER_MAX_HOLD;
}

function onTouchStart(event) {
  state.fingers = event.touches ? event.touches.length : state.fingers + 1;
  state.fingerAt = performance.now();
}

function onTouchEnd(event) {
  state.fingers = event.touches ? event.touches.length : Math.max(0, state.fingers - 1);
}

/** Mausrad oder Trackpad (iPad mit Tastatur, Computer): zählt als eigenes Scrollen. */
function onWheel() {
  state.panAt = performance.now();
  state.userScrollAt = state.panAt;
}

/** Hat der Nutzer den Text in den letzten ms Millisekunden selbst gescrollt? */
function userScrolledWithin(ms) {
  return performance.now() - state.userScrollAt < ms;
}

function onPointerDown(event) {
  // Ein "primärer" Zeiger bedeutet: kein anderer Finger liegt auf. Alte Einträge (falls ein pointerup
  // verloren ging) werden dann vergessen, damit das Tippen nie dauerhaft blockiert.
  if (event.isPrimary) activePointers.clear();
  activePointers.add(event.pointerId);
  const isMouse = event.pointerType === 'mouse';
  // Nur ein einzelner Finger (bzw. die linke Maustaste) zählt als Tippen
  if (activePointers.size > 1 || !event.isPrimary || (isMouse && event.button !== 0)) {
    tapStart = null;
    return;
  }
  // Gleitet der Text noch vom eigenen Wischen, hält dieser Finger nur den Schwung an – das ist kein Tippen
  // (iOS meldet dabei pointerdown und pointerup ohne Bewegung). Beim automatischen Mitscrollen zählt Tippen.
  if (userScrolledWithin(SCROLL_STOP_GUARD)) {
    tapStart = null;
    return;
  }
  tapStart = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
}

function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  const start = tapStart;
  if (!start || start.id !== event.pointerId) return;
  tapStart = null;
  const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  if (moved > TAP_MAX_MOVE || Date.now() - start.time > TAP_MAX_TIME) return; // Wischen oder langes Drücken
  if (state.view === 'present') onTap(event.clientX);
}

function onPointerCancel(event) {
  // Der Browser hat die Berührung übernommen – meist, weil mit dem Finger gescrollt (gewischt) wird.
  if (activePointers.delete(event.pointerId)) state.panAt = performance.now();
  if (tapStart && tapStart.id === event.pointerId) tapStart = null;
}

function onTap(x) {
  const rect = el.text.getBoundingClientRect();
  if (!rect.width || x > rect.left + el.text.clientWidth) return; // z. B. Klick auf eine Bildlaufleiste
  const part = (x - rect.left) / rect.width;
  if (part < 1 / 3) goBack();
  else if (part < 2 / 3) toggleMic();
  else goNext();
}

// Tastatur und Bluetooth-Presenter (die meisten Presenter senden Bild↑/Bild↓)
const KEY_ACTIONS = new Map([
  ['ArrowRight', goNext],
  ['PageDown', goNext],
  [' ', goNext],
  ['ArrowLeft', goBack],
  ['PageUp', goBack],
  ['m', toggleMic],
  ['M', toggleMic],
]);

function onKeyDown(event) {
  if (state.view !== 'present' || event.ctrlKey || event.altKey || event.metaKey) return;
  const action = KEY_ACTIONS.get(event.key);
  if (!action) return;
  event.preventDefault(); // kein Scrollen, kein Auslösen von Knöpfen
  if (event.repeat) return; // gedrückt halten blättert nicht durch
  action();
}

function onKeyUp(event) {
  // Manche Browser lösen einen fokussierten Knopf erst beim Loslassen der Leertaste aus.
  if (state.view === 'present' && event.key === ' ') event.preventDefault();
}

// ---------------------------------------------------------------------------------------------------------
// Offline: Service Worker

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) el.updateNotice.hidden = false; // eine neue Version wurde im Hintergrund installiert
    renderOffline();
  });
  // Relativer Pfad – funktioniert auch unter https://NAME.github.io/mitleser/
  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.info('Service Worker nicht verfügbar (z. B. ohne https):', messageOf(error));
  });
}

// ---------------------------------------------------------------------------------------------------------
// Start der App

function wireEvents() {
  // Vorbereitung
  el.script.addEventListener('input', onScriptInput);
  el.script.addEventListener('blur', flushText);
  el.btnImport.addEventListener('click', () => el.fileImport.click());
  el.fileImport.addEventListener('change', onFileChosen);
  el.btnExport.addEventListener('click', exportText);
  el.btnStart.addEventListener('click', () => startPresentation(0));
  el.btnResume.addEventListener('click', () => startPresentation(state.resumeIndex || 0));
  el.fontSize.addEventListener('input', onFontSizeInput);
  el.fontSize.addEventListener('change', () => {
    onFontSizeInput();
    scheduleSettingsSave.flush();
  });
  el.optRecognition.addEventListener('change', onRecognitionChange);
  el.optAutoAdvance.addEventListener('change', onAutoAdvanceChange);
  el.btnRetry.addEventListener('click', retrySpeech);
  el.btnMicTest.addEventListener('click', () => (state.micTest ? stopMicTest() : startMicTest()));
  el.btnReload.addEventListener('click', () => location.reload());

  // Präsentation
  el.btnBack.addEventListener('click', leavePresentation);
  el.micStatus.addEventListener('click', onMicStatusClick);
  el.text.addEventListener('pointerdown', onPointerDown);
  el.text.addEventListener('scroll', onTextScroll, { passive: true });
  // Touch-Ereignisse laufen auch während des Wischens weiter (Pointer-Ereignisse enden mit pointercancel).
  el.text.addEventListener('touchstart', onTouchStart, { passive: true });
  el.text.addEventListener('touchend', onTouchEnd, { passive: true });
  el.text.addEventListener('touchcancel', onTouchEnd, { passive: true });
  el.text.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener(
    'resize',
    debounce(() => {
      if (state.view === 'present') keepNextVisible(true); // z. B. nach dem Drehen des iPads
    }, 150),
  );

  // Nichts verlieren, wenn die App in den Hintergrund geht oder geschlossen wird
  const saveAll = () => {
    flushText();
    scheduleSettingsSave.flush();
    if (state.view === 'present' && state.nav) rememberResume(state.nav.index);
  };
  window.addEventListener('pagehide', saveAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveAll();
    else if (state.view === 'present') renderMicStatus();
  });
}

function init() {
  el.appVersion.textContent = APP_VERSION;
  el.script.value = storage.loadText();
  state.resumeIndex = storage.loadResume();
  applySettingsToUi();
  updateCounts();
  const appleTouch = isAppleTouchDevice();
  const standalone = isStandalone();
  el.installTip.hidden = !(appleTouch && !standalone);
  // Home-Bildschirm-App auf iPadOS älter als 18.4: Wake Lock wirkt dort nicht (ohne dass es sich erkennen lässt)
  el.wakeTip.hidden = !(appleTouch && standalone && isWebAppWakeLockBroken(navigator.userAgent));
  wireEvents();
  renderSpeechStatus();
  registerServiceWorker();
  checkModelCache();
  if (state.settings.recognition) safely(() => speech.loadModel()); // im Hintergrund; Fehler zeigt der Status
}

// Für automatische Tests im Browser (und zur Fehlersuche in der Konsole)
window.mitleser = {
  version: APP_VERSION,
  speech,
  getState() {
    const presenting = state.view === 'present' && state.nav;
    return {
      view: state.view,
      index: presenting ? state.nav.index : 0,
      count: presenting ? state.nav.count : state.sectionCount,
      colored: presenting ? state.nav.colored : 0,
      nextIndex: presenting && state.tracker ? state.tracker.nextIndex : -1,
      micState: micUiState(),
    };
  },
  next: goNext,
  back: goBack,
  toggleMic,
};

init();
