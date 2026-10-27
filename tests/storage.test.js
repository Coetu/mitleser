// Tests: Speichern auf dem Gerät (js/storage.js)
// Statt des echten localStorage wird ein kleiner Ersatzspeicher übergeben.
import { test, assert } from './harness.js';
import {
  KEYS,
  DEFAULT_SETTINGS,
  loadText,
  saveText,
  loadSettings,
  saveSettings,
  normalizeSettings,
  clampFontSize,
  loadResume,
  saveResume,
  clearResume,
  decodeTextFile,
} from '../js/storage.js';

/** Ersatz für localStorage: speichert in einer Map (wie im Browser nur Texte). */
class FakeStore {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

/** Speicher, der bei jedem Zugriff eine Ausnahme wirft (privater Modus, gesperrter Speicher). */
class BrokenStore {
  getItem() {
    throw new Error('SecurityError');
  }
  setItem() {
    throw new Error('QuotaExceededError');
  }
  removeItem() {
    throw new Error('SecurityError');
  }
}

test('Die Schlüssel heißen wie vereinbart', () => {
  assert.equal(KEYS.text, 'mitleser.text');
  assert.equal(KEYS.settings, 'mitleser.settings');
  assert.equal(KEYS.resume, 'mitleser.resume');
});

test('Text: leer, wenn nichts gespeichert ist; Speichern und Laden mit Umlauten', () => {
  const store = new FakeStore();
  assert.equal(loadText(store), '');
  const text = 'Grüße an alle!\n\nÄußerst wichtig: 3 ½ Punkte – ß.';
  assert.equal(saveText(text, store), true);
  assert.equal(store.getItem('mitleser.text'), text);
  assert.equal(loadText(store), text);
  assert.equal(saveText(null, store), true);
  assert.equal(loadText(store), '', 'null wird als leerer Text gespeichert');
});

test('Einstellungen: Standardwerte, wenn nichts gespeichert ist', () => {
  assert.deepEqual(loadSettings(new FakeStore()), { fontSize: 48, recognition: true, autoAdvance: false });
  assert.deepEqual(DEFAULT_SETTINGS, { fontSize: 48, recognition: true, autoAdvance: false });
});

test('Einstellungen: Speichern und Laden', () => {
  const store = new FakeStore();
  const settings = { fontSize: 72, recognition: false, autoAdvance: true };
  assert.equal(saveSettings(settings, store), true);
  assert.deepEqual(JSON.parse(store.getItem('mitleser.settings')), settings);
  assert.deepEqual(loadSettings(store), settings);
});

test('Einstellungen: Schriftgröße wird auf 24–120 begrenzt', () => {
  const tooSmall = new FakeStore({ 'mitleser.settings': JSON.stringify({ fontSize: 10 }) });
  assert.equal(loadSettings(tooSmall).fontSize, 24);
  const tooBig = new FakeStore({ 'mitleser.settings': JSON.stringify({ fontSize: 500 }) });
  assert.equal(loadSettings(tooBig).fontSize, 120);
  assert.equal(clampFontSize(24), 24);
  assert.equal(clampFontSize(120), 120);
  assert.equal(clampFontSize(61.6), 62, 'wird gerundet');
  assert.equal(clampFontSize('60'), 60, 'Zahl als Text (Wert eines Schiebereglers)');
  assert.equal(clampFontSize('groß'), 48, 'Unsinn -> Standard');
  assert.equal(clampFontSize(''), 48);
  assert.equal(clampFontSize(null), 48);
  assert.equal(clampFontSize(true), 48);
  assert.equal(clampFontSize(NaN), 48);
});

test('Einstellungen: kaputtes JSON und falsche Typen werden ignoriert', () => {
  const garbage = new FakeStore({ 'mitleser.settings': '{kaputt' });
  assert.deepEqual(loadSettings(garbage), DEFAULT_SETTINGS);
  for (const raw of ['null', '5', '"text"', '[1,2]', 'true']) {
    const store = new FakeStore({ 'mitleser.settings': raw });
    assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS, raw);
  }
  const wrongTypes = new FakeStore({
    'mitleser.settings': JSON.stringify({ fontSize: 'riesig', recognition: 'ja', autoAdvance: 1 }),
  });
  assert.deepEqual(loadSettings(wrongTypes), DEFAULT_SETTINGS);
});

test('Einstellungen: fehlende Werte werden ergänzt, unbekannte weggelassen', () => {
  const partial = new FakeStore({ 'mitleser.settings': JSON.stringify({ autoAdvance: true, foo: 1 }) });
  assert.deepEqual(loadSettings(partial), { fontSize: 48, recognition: true, autoAdvance: true });
  assert.deepEqual(normalizeSettings({ fontSize: 30, recognition: false }), {
    fontSize: 30,
    recognition: false,
    autoAdvance: false,
  });
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
});

test('Einstellungen: beim Speichern werden ungültige Werte korrigiert', () => {
  const store = new FakeStore();
  saveSettings({ fontSize: 999, recognition: 'nein' }, store);
  assert.deepEqual(JSON.parse(store.getItem('mitleser.settings')), {
    fontSize: 120,
    recognition: true,
    autoAdvance: false,
  });
});

test('Fortsetzen: Speichern, Laden und Vergessen', () => {
  const store = new FakeStore();
  assert.equal(loadResume(store), null, 'nichts gespeichert');
  assert.equal(saveResume(3, store), true);
  assert.deepEqual(JSON.parse(store.getItem('mitleser.resume')), { index: 3 });
  assert.equal(loadResume(store), 3);
  assert.equal(saveResume(0, store), true);
  assert.equal(loadResume(store), 0);
  assert.equal(clearResume(store), true);
  assert.equal(loadResume(store), null);
  assert.equal(store.getItem('mitleser.resume'), null);
});

test('Fortsetzen: ungültige Werte werden weder gespeichert noch geladen', () => {
  const store = new FakeStore();
  assert.equal(saveResume(-1, store), false);
  assert.equal(saveResume(1.5, store), false);
  assert.equal(saveResume('2', store), false);
  assert.equal(saveResume(NaN, store), false);
  assert.equal(store.getItem('mitleser.resume'), null);
  for (const raw of ['{kaputt', '{"index":-2}', '{"index":1.5}', '{"index":"3"}', '{}', 'null', '4']) {
    assert.equal(loadResume(new FakeStore({ 'mitleser.resume': raw })), null, raw);
  }
});

test('Gesperrter Speicher: keine Ausnahme, Standardwerte und false', () => {
  const store = new BrokenStore();
  assert.equal(loadText(store), '');
  assert.equal(saveText('Hallo', store), false);
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);
  assert.equal(saveSettings({ fontSize: 60 }, store), false);
  assert.equal(loadResume(store), null);
  assert.equal(saveResume(2, store), false);
  assert.equal(clearResume(store), false);
});

test('Gar kein Speicher (null): keine Ausnahme, Standardwerte und false', () => {
  assert.equal(loadText(null), '');
  assert.equal(saveText('Hallo', null), false);
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
  assert.equal(saveSettings(DEFAULT_SETTINGS, null), false);
  assert.equal(loadResume(null), null);
  assert.equal(saveResume(1, null), false);
  assert.equal(clearResume(null), false);
});

test('Ohne Angabe eines Speichers (Browser: localStorage, Node: keiner) wirft nichts', () => {
  assert.equal(typeof loadText(), 'string');
  assert.deepEqual(Object.keys(loadSettings()).sort(), ['autoAdvance', 'fontSize', 'recognition']);
  const resume = loadResume();
  assert.ok(resume === null || Number.isInteger(resume));
});

test('Speicher voll: Speichern meldet false statt abzustürzen', () => {
  const store = new FakeStore();
  store.setItem = () => {
    const error = new Error('Der Speicher ist voll');
    error.name = 'QuotaExceededError';
    throw error;
  };
  assert.equal(saveText('x'.repeat(1000), store), false);
  assert.equal(saveSettings(DEFAULT_SETTINGS, store), false);
  assert.equal(saveResume(1, store), false);
});

// ---------------------------------------------------------------------------------------------------------
// Textdateien importieren

const bytes = (...values) => new Uint8Array(values);

test('Import: UTF-8 mit und ohne Kennung (BOM)', () => {
  const plain = bytes(0x47, 0x72, 0xc3, 0xbc, 0xc3, 0x9f, 0x65); // "Grüße"
  assert.equal(decodeTextFile(plain), 'Grüße');
  const withBom = bytes(0xef, 0xbb, 0xbf, 0x47, 0x72, 0xc3, 0xbc, 0xc3, 0x9f, 0x65);
  assert.equal(decodeTextFile(withBom), 'Grüße');
  assert.equal(decodeTextFile(withBom.buffer), 'Grüße', 'auch als ArrayBuffer');
});

test('Import: alte Windows-Datei (ANSI/Windows-1252) mit Umlauten und Euro', () => {
  const ansi = bytes(0x47, 0x72, 0xfc, 0xdf, 0x65, 0x20, 0x80, 0x20, 0xc4, 0xd6, 0xdc); // "Grüße € ÄÖÜ"
  assert.equal(decodeTextFile(ansi), 'Grüße € ÄÖÜ');
});

test('Import: UTF-16 aus dem Windows-Editor („Unicode“)', () => {
  const le = bytes(0xff, 0xfe, 0x48, 0x00, 0xe4, 0x00); // "Hä"
  assert.equal(decodeTextFile(le), 'Hä');
  const be = bytes(0xfe, 0xff, 0x00, 0x48, 0x00, 0xe4);
  assert.equal(decodeTextFile(be), 'Hä');
});

test('Import: Windows-Zeilenenden werden vereinheitlicht, leere Datei ergibt leeren Text', () => {
  const crlf = bytes(0x41, 0x0d, 0x0a, 0x0d, 0x0a, 0x42, 0x0d, 0x43);
  assert.equal(decodeTextFile(crlf), 'A\n\nB\nC');
  assert.equal(decodeTextFile(new Uint8Array(0)), '');
  assert.equal(decodeTextFile(null), '');
});
