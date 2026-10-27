// Regressionstests: Fälle, die eine gezielte Angriffsprüfung des Wortabgleichs und der Textaufbereitung
// gefunden hat. Jeder Test beschreibt eine reale Vortragssituation, die früher hängen blieb oder falsch färbte.
import { test, assert } from './harness.js';
import { splitSections, tokenize, countScript, nextWordIndex } from '../js/text.js';
import { spokenForms, numberToWords, phoneticKey } from '../js/normalize.js';
import { Tracker } from '../js/matcher.js';

const NARROW_NBSP = String.fromCharCode(0x202f);
const ZWSP = String.fromCharCode(0x200b);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** Spricht einen Satz Wort für Wort (Teilergebnisse wie bei Vosk) und schließt ihn optional ab. */
function speak(tracker, sentence, final = true) {
  const words = sentence.split(/\s+/).filter(Boolean);
  for (let k = 1; k <= words.length; k++) tracker.update(words.slice(0, k), false);
  if (final) tracker.update(words, true);
  return tracker.position;
}

/** Spielt eine Folge von Teilergebnissen ab (jedes Element = ganze bisherige Äußerung). */
function partials(tracker, list, finalText) {
  for (const p of list) tracker.update(p.split(' '), false);
  if (finalText) tracker.update(finalText.split(' '), true);
  return tracker.position;
}

// ---------------------------------------------------------------------------------------------------------
// Abschnitte und Tokens

test('Trennzeilen, die iPad oder Word verändert haben („—“, „—-“, „–––“, „***“), trennen ebenfalls', () => {
  for (const sep of ['—', '—-', '–––', '***', '___', '- - -', '----']) {
    assert.equal(splitSections(`A eins.\n${sep}\nB zwei.`).length, 2, `Trennzeile ${sep}`);
  }
  assert.equal(splitSections('A eins.\n–\nB zwei.').length, 1, 'ein einzelner Halbgeviertstrich trennt nicht');
  assert.equal(splitSections('A eins.\n- Punkt\nB zwei.').length, 1, 'Aufzählung trennt nicht');
});

test('Zeilen nur mit unsichtbaren Zeichen gelten als Leerzeile', () => {
  assert.equal(splitSections(`A eins.\n${ZWSP}\nB zwei.`).length, 2);
  assert.equal(splitSections(`A eins.${PARAGRAPH_SEPARATOR}B zwei.`).length, 2, 'Absatztrenner U+2029');
});

test('Regieanweisungen in eckigen Klammern werden nicht gesprochen', () => {
  const tokens = tokenize('Weiter geht es [Folie 12] mit der Montage.');
  assert.deepEqual(tokens.filter((t) => t.cue).map((t) => t.text), ['[Folie', '12]']);
  assert.ok(tokens.filter((t) => t.cue).every((t) => t.forms.length === 0));
  assert.equal(nextWordIndex(tokens, 3), 5, 'das nächste gesprochene Wort ist „mit“');
});

test('Einschübe in runden Klammern sind markiert', () => {
  const tokens = tokenize('Die Lager (Typ 32008 X) laufen.');
  assert.deepEqual(tokens.map((t) => t.aside), [false, false, true, true, true, false]);
});

test('Aufzählungsnummern am Zeilenanfang dürfen ausgelassen werden', () => {
  const tokens = tokenize('Drei Punkte:\n1. Sicherheit\n2. Qualität');
  assert.deepEqual(tokens.filter((t) => t.optional).map((t) => t.text), ['1.', '2.']);
  assert.equal(nextWordIndex(tokens, 2), 3, 'die Nummer wird beim „nächsten Wort“ übersprungen');
});

test('„Uhr“ nach einer Uhrzeit und „€“ nach einem Betrag dürfen ausgelassen werden', () => {
  const tokens = tokenize('Beginn 10:30 Uhr, Preis 3,50 €.');
  assert.deepEqual(tokens.filter((t) => t.optional).map((t) => t.text), ['Uhr,', '€.']);
  assert.includes(tokens[4].forms, 'dreieurofünfzig');
});

test('Zahlen mit geschütztem Leerzeichen bleiben ein Token', () => {
  const text = `Über 20${NARROW_NBSP}000 Stunden`;
  const tokens = tokenize(text);
  assert.equal(tokens.length, 3);
  assert.includes(tokens[1].forms, 'zwanzigtausend');
  assert.equal(countScript(text).words, 3);
});

// ---------------------------------------------------------------------------------------------------------
// Sprechformen

test('Umgangssprachliche Dezimalzahlen: „zweieinhalb“, „anderthalb“, „einhalb“', () => {
  assert.includes(spokenForms('2,5'), 'zweieinhalb');
  assert.includes(spokenForms('1,5'), 'eineinhalb');
  assert.includes(spokenForms('1,5'), 'anderthalb');
  assert.includes(spokenForms('0,5'), 'einhalb');
  assert.includes(spokenForms('3,75'), 'dreidreiviertel');
});

test('Vorzeichen, Währung vorne und „49,-“', () => {
  assert.includes(spokenForms('−3,5'), 'minusdreikommafünf');
  assert.includes(spokenForms('-20'), 'minuszwanzig');
  assert.includes(spokenForms('+3,5'), 'plusdreikommafünf');
  assert.includes(spokenForms('±0,5'), 'plusminusnullkommafünf');
  assert.includes(spokenForms('€3,50'), 'dreieurofünfzig');
  assert.includes(spokenForms('49,-'), 'neunundvierzig');
});

test('Brüche, Schrägstriche und Verhältnisse', () => {
  assert.includes(spokenForms('½'), 'einhalb');
  assert.includes(spokenForms('1½'), 'anderthalb');
  assert.includes(spokenForms('3/4'), 'dreiviertel');
  assert.includes(spokenForms('24/7'), 'vierundzwanzigsieben');
  assert.includes(spokenForms('2024/25'), 'zweitausendvierundzwanzigfünfundzwanzig');
  assert.includes(spokenForms('1:1'), 'einszueins');
  assert.includes(spokenForms('16:9'), 'sechzehnzuneun');
});

test('Uhrzeiten umgangssprachlich: „halb elf“, „viertel nach zehn“, „viertel vor elf“', () => {
  assert.includes(spokenForms('10:30'), 'halbelf');
  assert.includes(spokenForms('10:15'), 'viertelnachzehn');
  assert.includes(spokenForms('10:45'), 'viertelvorelf');
  assert.includes(spokenForms('12:30'), 'halbeins');
});

test('Datum ohne Jahr und Versionsnummern', () => {
  assert.includes(spokenForms('27.10.'), 'siebenundzwanzigstenoktober');
  assert.includes(spokenForms('1.2.3'), 'einspunktzweipunktdrei');
});

test('Abkürzungen ohne Leerzeichen, ohne Punkt und weitere gängige', () => {
  const cases = {
    'z.B.': 'zumbeispiel', 'i.d.R.': 'inderregel', 'u.a.': 'unteranderem', 'd.h.': 'dasheißt', usw: 'undsoweiter',
    bzw: 'beziehungsweise', 'bzgl.': 'bezüglich', 'zzgl.': 'zuzüglich', 'MwSt.': 'mehrwertsteuer', 'ggü.': 'gegenüber',
    'vs.': 'versus', 'Abs.': 'absatz',
  };
  for (const [abbr, form] of Object.entries(cases)) assert.includes(spokenForms(abbr), form, abbr);
  assert.equal(spokenForms('h.')[0], 'heißt', '„h.“ in „d. h.“ zuerst als „heißt“, nicht als Stunden');
  assert.includes(spokenForms('s.'), 'siehe');
});

test('Zusammengesetzte Einheiten', () => {
  const cases = {
    'km²': 'quadratkilometer', 'm³/h': 'kubikmeterprostunde', 'N/mm²': 'newtonproquadratmillimeter', m2: 'quadratmeter',
    qm: 'quadratmeter', '100%ig': 'hundertprozentig', '2x': 'zweimal', '10–20%': 'zehnbiszwanzigprozent',
  };
  for (const [unit, form] of Object.entries(cases)) assert.includes(spokenForms(unit), form, unit);
});

test('Markdown-Zeichen, Klammern und Anführungszeichen vor dem Satzpunkt stören Zahlen nicht', () => {
  assert.includes(spokenForms('**2026**'), 'zweitausendsechsundzwanzig');
  assert.includes(spokenForms('`2026`'), 'zweitausendsechsundzwanzig');
  assert.includes(spokenForms('*50%*'), 'fünfzigprozent');
  assert.deepEqual(spokenForms('3).'), ['drei']);
  assert.includes(spokenForms('2026“.'), 'zweitausendsechsundzwanzig');
});

test('Internet- und E-Mail-Adressen', () => {
  assert.includes(spokenForms('www.coetu.tv'), 'wwwpunktcoetupunkttv');
  assert.includes(spokenForms('info@coetu.tv'), 'infoatcoetupunkttv');
});

test('Englische Lehnwörter, auch in Zusammensetzungen', () => {
  assert.includes(spokenForms('Team'), 'tim');
  assert.includes(spokenForms('Software-Update'), 'softwerapdeit');
  assert.includes(spokenForms('Kundenservice'), 'kundensörwis');
  assert.includes(spokenForms('Teamleiter'), 'timleiter');
});

test('Zahlen mit „ein“ in Zusammensetzungen und geschütztem Leerzeichen', () => {
  assert.equal(numberToWords(101000), 'einhunderteintausend');
  assert.equal(numberToWords(201000), 'zweihunderteintausend');
  assert.includes(spokenForms(`20${NARROW_NBSP}000`), 'zwanzigtausend');
});

test('Lautschlüssel hält „für“/„vier“ und „schön“/„schon“ auseinander', () => {
  assert.notEqual(phoneticKey('für'), phoneticKey('vier'));
  assert.notEqual(phoneticKey('schön'), phoneticKey('schon'));
});

// ---------------------------------------------------------------------------------------------------------
// Wortabgleich

test('Langer Abschnitt (über 320 Wörter): nach Zurücksetzen wird die Stelle weit hinten gefunden', () => {
  const filler = 'Die Messung erfolgt mit einer Messuhr direkt am Gehäuse und wird danach sorgfältig dokumentiert.';
  const ending = 'Zum Schluss fassen wir die wichtigsten Ergebnisse zusammen. Vielen Dank für Ihre Aufmerksamkeit.';
  const tokens = tokenize(Array.from({ length: 26 }, () => filler).join(' ') + ' ' + ending);
  assert.atLeast(tokens.length, 340);
  const tracker = new Tracker(tokens);
  tracker.reset();
  speak(tracker, 'zum schluss fassen wir die wichtigsten ergebnisse zusammen');
  speak(tracker, 'vielen dank für ihre aufmerksamkeit');
  assert.equal(tracker.position, tokens.length);
});

test('Neu zerlegtes Wort zwischen Teilergebnissen blockiert das letzte Wort nicht', () => {
  const tokens = tokenize('Danach stellen wir das Axialspiel ein.');
  const tracker = new Tracker(tokens);
  partials(tracker, ['danach', 'danach stellen', 'danach stellen wir', 'danach stellen wir das', 'danach stellen wir das axial',
    'danach stellen wir das axial spiel', 'danach stellen wir das axialspiel ein'], 'danach stellen wir das axialspiel ein');
  assert.ok(tracker.done);
});

test('Zusammengezogene Wörter im laufenden Teilergebnis („zu viel“ → „zuviel“) halten nicht auf', () => {
  const tokens = tokenize('Zu viel Spiel verursacht Geräusche.');
  const tracker = new Tracker(tokens);
  partials(tracker, ['zu', 'zu viel', 'zuviel spiel', 'zuviel spiel verursacht', 'zuviel spiel verursacht geräusche'],
    'zuviel spiel verursacht geräusche');
  assert.ok(tracker.done);
});

test('Nicht erkanntes Wort kurz vor dem Abschnittsende: das letzte Wort wird trotzdem gefärbt', () => {
  const cases = [
    ['Wir haben das Software-Update gesammelt.', 'wir haben das soft wer apdeit gesammelt'],
    ['Das ist der Ein-/Ausbau.', 'das ist der ein und ausbau'],
    ['Danke an unser ganzes Team.', 'danke an unser ganzes tim'],
  ];
  for (const [text, spoken] of cases) {
    const tracker = new Tracker(tokenize(text));
    speak(tracker, spoken);
    assert.ok(tracker.done, text);
  }
});

test('Sehr kurze Abschnitte („Fragen?“, „Hallo!“, „Und jetzt?“) werden fertig', () => {
  const cases = [['Fragen?', 'frage'], ['Hallo!', 'hallo'], ['Ende.', 'ende'], ['Und jetzt?', 'und jetzt'], ['Pause.', 'pausen']];
  for (const [text, spoken] of cases) {
    const tracker = new Tracker(tokenize(text));
    speak(tracker, spoken);
    assert.ok(tracker.done, `${text} gehört als „${spoken}“`);
  }
});

test('Funktionswörter in freier Rede färben keine gleich klingenden Inhaltswörter („für“ ≠ „vier“)', () => {
  const tokens = tokenize('Wir bieten vier Varianten für Kunden an.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'wir bieten');
  const before = tracker.position;
  speak(tracker, 'das ist für die kunden da');
  assert.atMost(tracker.position - before, 1);
});

test('Ausgelassener Klammer-Einschub: der Rest des Satzes wird gefärbt', () => {
  const tokens = tokenize('Die Lager (Typ 32008 X, Baujahr 2019) laufen seit Jahren ruhig.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'die lager laufen seit jahren ruhig');
  assert.ok(tracker.done);
});

test('„10:30 Uhr“ als „halb elf“ und „2,5 Stunden“ als „zweieinhalb Stunden“ am Abschnittsende', () => {
  const t1 = new Tracker(tokenize('Die Pause endet um 10:30 Uhr.'));
  speak(t1, 'die pause endet um halb elf');
  assert.ok(t1.done, 'halb elf');
  const t2 = new Tracker(tokenize('Die Pause endet um 10:30 Uhr.'));
  speak(t2, 'die pause endet um zehn uhr dreißig');
  assert.ok(t2.done, 'zehn uhr dreißig');
  const t3 = new Tracker(tokenize('Der Test dauert 2,5 Stunden.'));
  speak(t3, 'der test dauert zweieinhalb stunden');
  assert.ok(t3.done, 'zweieinhalb');
});

test('Nicht vorgelesene Aufzählungsnummern und Regieanweisungen blockieren nicht', () => {
  const list = new Tracker(tokenize('Drei Punkte sind wichtig:\n1. Sicherheit\n2. Qualität\n3. Kosten'));
  speak(list, 'drei punkte sind wichtig sicherheit qualität kosten');
  assert.ok(list.done, 'Aufzählung');
  const cue = new Tracker(tokenize('Damit komme ich zum Ende [Folie 12] meines Vortrags.'));
  speak(cue, 'damit komme ich zum ende meines vortrags');
  assert.ok(cue.done, 'Regieanweisung');
});

test('Erkannte Wörter mit Ziffern („co2“) passen zum Text („CO2“)', () => {
  const tracker = new Tracker(tokenize('Wir sparen damit viel CO2.'));
  speak(tracker, 'wir sparen damit viel co2');
  assert.ok(tracker.done);
});

test('Abkürzung ohne Leerzeichen im Satz („z.B.“) hält nicht auf', () => {
  const tokens = tokenize('Wir prüfen z.B. die Dichtung und das Lager.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'wir prüfen zum beispiel die dichtung', false);
  assert.atLeast(tracker.position, 4);
});
