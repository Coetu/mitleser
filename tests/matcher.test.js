// Tests: Wortabgleich (js/matcher.js) mit künstlichen Erkennungsergebnissen
import { test, assert } from './harness.js';
import { tokenize } from '../js/text.js';
import { Tracker, editDistance, matchQuality } from '../js/matcher.js';

const TEXT = 'Zunächst ein kurzer Blick auf die Ausgangslage. Viele Getriebe fallen nicht wegen der Zahnräder aus, ' +
  'sondern wegen der Lagerung. Verschmutzung, Mangelschmierung und falsche Montage sind die häufigsten Ursachen. ' +
  'Deshalb haben wir die Dichtung komplett überarbeitet. Die neue Lippendichtung hält Partikel zuverlässig fern.';

/** Spricht einen Satz Wort für Wort (Teilergebnisse wie bei Vosk) und schließt ihn optional ab. */
function speak(tracker, sentence, final = true) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const positions = [];
  for (let k = 1; k <= words.length; k++) positions.push(tracker.update(words.slice(0, k), false));
  if (final) positions.push(tracker.update(words, true));
  return positions;
}

const indexAfter = (tokens, text) => tokens.findIndex((t) => t.text === text) + 1;

test('Hilfsfunktionen: Editierabstand und Trefferqualität', () => {
  assert.equal(editDistance('lager', 'lage', 3), 1);
  assert.equal(editDistance('abc', 'xyz', 1), 2, 'Abbruch über dem Limit liefert limit+1');
  assert.equal(matchQuality('laker', 'laker'), 1);
  assert.ok(matchQuality('laker', 'lake') > 0, 'ein Buchstabe Unterschied ist noch ein Treffer');
  assert.equal(matchQuality('un', 'in'), 0, 'sehr kurze Wörter müssen exakt passen');
});

test('Wörtlich vorgelesen: alles wird gefärbt, Wort für Wort', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  speak(tracker, 'zunächst ein kurzer blick auf die ausgangslage');
  assert.equal(tracker.position, indexAfter(tokens, 'Ausgangslage.'));
  speak(tracker, 'viele getriebe fallen nicht wegen der zahnräder aus sondern wegen der lagerung');
  speak(tracker, 'verschmutzung mangelschmierung und falsche montage sind die häufigsten ursachen');
  speak(tracker, 'deshalb haben wir die dichtung komplett überarbeitet');
  speak(tracker, 'die neue lippendichtung hält partikel zuverlässig fern');
  assert.equal(tracker.position, tokens.length);
  assert.ok(tracker.done);
});

test('Färbung läuft nur vorwärts, auch wenn Teilergebnisse sich ändern', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  const seen = [];
  for (const partial of ['zunächst ein kurzer blick', 'zunächst ein kurzer blick auf die ausgangs lage',
    'zunächst ein', 'zunächst ein kurzer blitz', 'zunächst ein kurzer blick auf die ausgangslage']) {
    seen.push(tracker.update(partial.split(' '), false));
  }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `Position ${seen.join(' → ')}`);
});

test('Füllwörter und Versprecher halten nicht auf (Abnahme 3, Teil „äh, also“)', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  speak(tracker, 'zunächst äh ein kurzer e blick auf die also die ausgangslage');
  assert.equal(tracker.position, indexAfter(tokens, 'Ausgangslage.'));
});

test('Ausgelassener Satz wird übersprungen und mitgefärbt (Abnahme 3)', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  speak(tracker, 'zunächst ein kurzer blick auf die ausgangslage viele getriebe fallen nicht wegen der zahnräder aus sondern wegen der lagerung');
  const before = tracker.position;
  speak(tracker, 'deshalb haben wir die dichtung komplett überarbeitet');
  assert.ok(before < indexAfter(tokens, 'Ursachen.'));
  assert.equal(tracker.position, indexAfter(tokens, 'überarbeitet.'));
});

test('Zusammengesetzte Wörter, die getrennt erkannt werden, passen trotzdem', () => {
  const tokens = tokenize('Die neue Lippendichtung und das Kegelrollenlager.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'die neue lippen dichtung und das kegel rollen lager');
  assert.equal(tracker.position, tokens.length);
});

test('Getrennt geschriebene Wörter, die zusammen erkannt werden („zu wenig“ → „zuwenig“)', () => {
  const tokens = tokenize('Zu wenig Spiel führt zu Überhitzung, direkt vor Ort.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'zuwenig spiel führt zu überhitzung direkt vorort');
  assert.equal(tracker.position, tokens.length);
});

test('Zahlen werden als Zahlwörter erkannt (Abnahme 4)', () => {
  const tokens = tokenize('Die Berechnung erfolgt nach DIN ISO 281. Bei 3,5 kN halten die Lager bis 2026.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'die berechnung erfolgt nach din iso zweihundert ein und achtzig');
  assert.equal(tracker.position, indexAfter(tokens, '281.'));
  speak(tracker, 'bei drei komma fünf kilo newton halten die lager bis zweitausendsechs und zwanzig');
  assert.equal(tracker.position, tokens.length);
});

test('Fremder Satz färbt höchstens ein Wort (Abnahme 5)', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  speak(tracker, 'bevor ich weitermache möchte ich mich noch kurz für die einladung bedanken');
  speak(tracker, 'das wetter ist heute ja wirklich herrlich und der kaffee war auch sehr gut');
  assert.atMost(tracker.position, 1);
});

test('Freie Rede mitten im Abschnitt färbt nicht weiter', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  speak(tracker, 'zunächst ein kurzer blick auf die ausgangslage');
  const pos = tracker.position;
  speak(tracker, 'das kennen sie sicher alle aus der eigenen werkstatt da muss ich nicht viel erzählen');
  speak(tracker, 'und die frage ist natürlich was das für sie bedeutet');
  assert.atMost(tracker.position - pos, 1);
});

test('Häufige kurze Wörter lösen keine Sprünge aus', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  speak(tracker, 'zunächst ein kurzer blick');
  const pos = tracker.position;
  speak(tracker, 'und die und der die das und die der');
  assert.atMost(tracker.position - pos, 1);
});

test('Themennahe Wörter in anderer Reihenfolge springen nicht nach vorne', () => {
  const tokens = tokenize(TEXT);
  const tracker = new Tracker(tokens);
  speak(tracker, 'die dichtung und die montage und die lagerung sind wichtig für die getriebe');
  assert.atMost(tracker.position, 1);
});

test('Nach Zurücksetzen fließt nichts vom vorher Gesprochenen ein', () => {
  const tokens = tokenize('Die Lager laufen sehr ruhig und halten lange.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'die lager laufen sehr ruhig');
  assert.equal(tracker.position, 5);
  tracker.reset();
  assert.equal(tracker.position, 0);
  // Ohne Zurücksetzen würde "und halten" direkt anschließen und färben – danach nicht mehr.
  speak(tracker, 'und halten', false);
  assert.equal(tracker.position, 0);
});

test('Nach Mikrofon-Pause geht es mit den ersten neuen Wörtern sofort weiter', () => {
  const tokens = tokenize('Die Lager laufen sehr ruhig und halten lange.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'die lager laufen sehr ruhig', false); // Teilergebnis, dann Pause (Sitzung abgebrochen)
  assert.equal(tracker.position, 5);
  tracker.update([], true); // neue Sitzung: leeres Endergebnis
  speak(tracker, 'und halten lange', false);
  assert.equal(tracker.position, tokens.length);
});

test('Wiederholte Sätze im Text: es wird die nächstliegende Stelle gefärbt', () => {
  const tokens = tokenize('Das Lager ist gut. Das Lager ist gut. Und jetzt das Ende.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'das lager ist gut');
  assert.equal(tracker.position, 4);
  speak(tracker, 'das lager ist gut');
  assert.equal(tracker.position, 8);
});

test('Stottern und Wiederholungen bringen den Abgleich nicht durcheinander', () => {
  const tokens = tokenize('Guten Morgen und herzlich willkommen zu unserem Vortrag über die neue Generation.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'guten morgen und herzlich willkommen herzlich willkommen zu unserem vortrag über die äh die neue generation');
  assert.equal(tracker.position, tokens.length);
});

test('Schwach erkanntes letztes Wort wird bei direktem Anschluss noch gefärbt', () => {
  const tokens = tokenize('Wichtig ist, dass der Innenring vollständig an der Wellenschulter anliegt.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'wichtig ist dass der innen ring vollständig an der wellen schulter anlegt');
  assert.equal(tracker.position, tokens.length);
});

test('Am Abschnittsende bleibt die Position stehen, weiteres Sprechen schadet nicht', () => {
  const tokens = tokenize('Vielen Dank für Ihre Aufmerksamkeit.');
  const tracker = new Tracker(tokens);
  speak(tracker, 'vielen dank für ihre aufmerksamkeit');
  assert.equal(tracker.position, tokens.length);
  speak(tracker, 'gibt es noch fragen vielen dank');
  assert.equal(tracker.position, tokens.length);
});

test('Leere Erkennung und leere Abschnitte sind harmlos', () => {
  const tracker = new Tracker(tokenize('Ein Satz.'));
  assert.equal(tracker.update([], false), 0);
  assert.equal(tracker.update([], true), 0);
  assert.equal(tracker.update(['', '  '], false), 0);
  const empty = new Tracker([]);
  assert.equal(empty.update(['hallo'], true), 0);
  assert.ok(empty.done);
  const dashes = new Tracker(tokenize('– –'));
  assert.ok(dashes.done, 'Abschnitt ohne gesprochene Wörter gilt als fertig');
});

test('Langer Abschnitt: jede Aktualisierung bleibt schnell', () => {
  const sentence = 'Die Messung erfolgt mit einer Messuhr die direkt am Gehäuse befestigt wird und anschließend geprüft wird.';
  const tokens = tokenize(Array.from({ length: 50 }, () => sentence).join(' '));
  const tracker = new Tracker(tokens);
  const words = sentence.toLowerCase().replace(/[.,]/g, '').split(' ');
  const started = Date.now();
  let updates = 0;
  for (let rep = 0; rep < 12; rep++) {
    for (let k = 1; k <= words.length; k++) {
      tracker.update(words.slice(0, k), false);
      updates++;
    }
    tracker.update(words, true);
    updates++;
  }
  const perUpdate = (Date.now() - started) / updates;
  assert.atLeast(tokens.length, 800);
  assert.equal(tracker.position, words.length * 12, 'zwölf Sätze gelesen, zwölf Sätze gefärbt');
  assert.atMost(perUpdate, 25, 'Millisekunden pro Aktualisierung');
});
