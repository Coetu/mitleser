// Tests: Sprechformen (Zahlen, Einheiten, Abkürzungen) und Lautschlüssel (js/normalize.js)
import { test, assert } from './harness.js';
import { numberToWords, cardinalForms, ordinalForms, spokenForms, phoneticKey } from '../js/normalize.js';

test('Zahlwörter: Grundformen', () => {
  const cases = {
    0: 'null', 1: 'eins', 7: 'sieben', 13: 'dreizehn', 21: 'einundzwanzig', 30: 'dreißig', 99: 'neunundneunzig',
    100: 'einhundert', 101: 'einhunderteins', 281: 'zweihunderteinundachtzig', 1000: 'eintausend',
    1001: 'eintausendeins', 2026: 'zweitausendsechsundzwanzig', 20000: 'zwanzigtausend', 1000000: 'einemillion',
    2500000: 'zweimillionenfünfhunderttausend',
  };
  for (const [n, words] of Object.entries(cases)) assert.equal(numberToWords(Number(n)), words, `Zahl ${n}`);
});

test('Zahlen haben mehrere übliche Aussprachen', () => {
  const f1500 = cardinalForms(1500);
  for (const w of ['eintausendfünfhundert', 'tausendfünfhundert', 'fünfzehnhundert']) assert.includes(f1500, w);
  assert.includes(cardinalForms(1984), 'neunzehnhundertvierundachtzig');
  assert.includes(cardinalForms(100), 'hundert');
  assert.includes(cardinalForms(6205), 'sechszweinullfünf', 'ziffernweise (Typenbezeichnung)');
});

test('Ordnungszahlen mit allen Endungen', () => {
  assert.includes(ordinalForms(1), 'ersten');
  assert.includes(ordinalForms(3), 'dritte');
  assert.includes(ordinalForms(7), 'siebten');
  assert.includes(ordinalForms(20), 'zwanzigsten');
  assert.includes(ordinalForms(21), 'einundzwanzigste');
});

test('Abnahme 4: „DIN ISO 281“, „3,5 kN“ und „2026“ haben die gesprochenen Formen', () => {
  assert.includes(spokenForms('DIN'), 'din');
  assert.includes(spokenForms('ISO'), 'iso');
  assert.includes(spokenForms('281'), 'zweihunderteinundachtzig');
  assert.includes(spokenForms('281.'), 'zweihunderteinundachtzig', 'Satzende-Punkt');
  assert.includes(spokenForms('3,5'), 'dreikommafünf');
  assert.includes(spokenForms('kN'), 'kilonewton');
  assert.includes(spokenForms('kN'), 'kaen', 'buchstabiert');
  assert.includes(spokenForms('2026'), 'zweitausendsechsundzwanzig');
});

test('Tausenderpunkte, Dezimalkomma, Prozent und Grad', () => {
  assert.includes(spokenForms('1.500'), 'tausendfünfhundert');
  assert.includes(spokenForms('20.000'), 'zwanzigtausend');
  assert.includes(spokenForms('0,05'), 'nullkommanullfünf');
  assert.includes(spokenForms('50%'), 'fünfzigprozent');
  assert.includes(spokenForms('80°C'), 'achtziggradcelsius');
  assert.includes(spokenForms('°C'), 'gradcelsius');
  assert.includes(spokenForms('%'), 'prozent');
});

test('Ordnungszahl oder Zahl am Satzende („3.“)', () => {
  const forms = spokenForms('3.');
  assert.includes(forms, 'dritten');
  assert.includes(forms, 'drei');
});

test('Uhrzeit, Datum und Bereiche', () => {
  assert.includes(spokenForms('9:30'), 'neunuhrdreißig');
  assert.includes(spokenForms('27.10.2026'), 'siebenundzwanzigstenoktoberzweitausendsechsundzwanzig');
  assert.includes(spokenForms('10–20'), 'zehnbiszwanzig');
});

test('Abkürzungen werden ausgeschrieben', () => {
  assert.includes(spokenForms('z.'), 'zum');
  assert.includes(spokenForms('B.'), 'beispiel');
  assert.includes(spokenForms('bzw.'), 'beziehungsweise');
  assert.includes(spokenForms('usw.'), 'undsoweiter');
  assert.includes(spokenForms('ca.'), 'circa');
  assert.includes(spokenForms('Nr.'), 'nummer');
});

test('Satzzeichen, Anführungszeichen und Bindestriche stören nicht', () => {
  assert.deepEqual(spokenForms('„Lager“,'), ['lager']);
  assert.deepEqual(spokenForms('(siehe'), ['siehe']);
  assert.deepEqual(spokenForms('Kegel-Rollenlager,'), ['kegelrollenlager']);
  assert.deepEqual(spokenForms('Straße.'), ['strasse']);
  assert.deepEqual(spokenForms('–'), []);
  assert.deepEqual(spokenForms('...'), []);
});

test('Abkürzungen in Großbuchstaben auch buchstabiert, Gendersternchen mit und ohne Endung', () => {
  assert.includes(spokenForms('KI'), 'kai');
  assert.includes(spokenForms('Mitarbeiter*innen'), 'mitarbeiterinnen');
  assert.includes(spokenForms('Mitarbeiter*innen'), 'mitarbeiter');
});

test('Typenbezeichnungen mit Ziffern und Buchstaben', () => {
  assert.includes(spokenForms('A4'), 'avier');
  assert.ok(spokenForms('6205-2RS').some((f) => f.startsWith('sechstausendzweihundertfünf')), '6205-2RS');
});

test('Lautschlüssel macht ähnliche Schreibweisen gleich', () => {
  assert.equal(phoneticKey('Vater'), phoneticKey('fater'));
  assert.equal(phoneticKey('Philosophie'), phoneticKey('filosofie'));
  assert.equal(phoneticKey('gehen'), phoneticKey('gehn'));
  assert.equal(phoneticKey('Stadt'), phoneticKey('statt'));
  assert.equal(phoneticKey('Kegel-Rollenlager'), phoneticKey('kegel rollen lager'));
  assert.equal(phoneticKey('Straße'), phoneticKey('strasse'));
});

test('Lautschlüssel bleibt für verschiedene Wörter verschieden', () => {
  assert.notEqual(phoneticKey('Lager'), phoneticKey('Dichtung'));
  assert.notEqual(phoneticKey('Montage'), phoneticKey('Messung'));
});
