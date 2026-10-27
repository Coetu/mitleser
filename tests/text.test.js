// Tests: Vortragstext in Abschnitte und Tokens zerlegen (js/text.js)
import { test, assert } from './harness.js';
import { splitSections, tokenize, parseScript, countScript, nextWordIndex } from '../js/text.js';

const THREE = `Guten Morgen und herzlich willkommen.
Heute geht es um Wälzlager.

Zunächst ein Blick auf die Ausgangslage.

Zum Schluss: Fragen?`;

test('Abnahme 1: drei Abschnitte, durch Leerzeilen getrennt, werden gezählt', () => {
  const { sections, wordCount } = parseScript(THREE);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].text, 'Guten Morgen und herzlich willkommen.\nHeute geht es um Wälzlager.');
  assert.equal(wordCount, 10 + 6 + 3);
  assert.deepEqual(countScript(THREE), { sections: 3, words: 19 });
});

test('Mehrere Leerzeilen und Zeilen nur mit Leerzeichen trennen genau einmal', () => {
  const text = 'Eins zwei.\n\n\n   \nDrei vier.\n\t\nFünf.';
  assert.deepEqual(splitSections(text), ['Eins zwei.', 'Drei vier.', 'Fünf.']);
});

test('Windows-Zeilenenden (CRLF) werden wie normale Zeilenumbrüche behandelt', () => {
  assert.deepEqual(splitSections('A b.\r\n\r\nC d.\r\nE f.'), ['A b.', 'C d.\nE f.']);
});

test('Leerer Text ergibt null Abschnitte', () => {
  assert.equal(parseScript('').sections.length, 0);
  assert.equal(parseScript('   \n\n  ').sections.length, 0);
  assert.equal(parseScript(null).sections.length, 0);
  assert.deepEqual(countScript(''), { sections: 0, words: 0 });
});

test('Mit „---“ trennen nur noch die Trennzeilen, Leerzeilen werden zu Absätzen', () => {
  const text = 'Teil eins, Absatz eins.\n\nTeil eins, Absatz zwei.\n---\nTeil zwei.\n\n---\n\nTeil drei.';
  const sections = splitSections(text);
  assert.equal(sections.length, 3);
  assert.equal(sections[0], 'Teil eins, Absatz eins.\n\nTeil eins, Absatz zwei.');
  const tokens = tokenize(sections[0]);
  const absatz = tokens.findIndex((t, i) => i > 0 && t.brk === 2);
  assert.equal(tokens[absatz].text, 'Teil');
  assert.equal(absatz, 4);
});

test('Trennzeile darf Leerzeichen und mehr als drei Striche haben, „--“ trennt nicht', () => {
  assert.equal(splitSections('A\n  ----  \nB').length, 2);
  assert.equal(splitSections('A\n--\nB').length, 1);
});

test('Leere Abschnitte zwischen Trennzeilen fallen weg', () => {
  assert.deepEqual(splitSections('---\nA\n---\n---\n\nB\n---'), ['A', 'B']);
});

test('Tokens behalten Satzzeichen für die Anzeige, Zeilenumbrüche werden markiert', () => {
  const tokens = tokenize('Hallo, Welt!\nNeue Zeile.');
  assert.deepEqual(tokens.map((t) => t.text), ['Hallo,', 'Welt!', 'Neue', 'Zeile.']);
  assert.deepEqual(tokens.map((t) => t.brk), [0, 0, 1, 0]);
  assert.deepEqual(tokens[0].forms, ['hallo']);
});

test('Gedankenstriche werden angezeigt, aber nicht als Wort gezählt oder gesprochen', () => {
  const tokens = tokenize('Lager – und Dichtung');
  assert.equal(tokens.length, 4);
  assert.equal(tokens[1].isWord, false);
  assert.deepEqual(tokens[1].forms, []);
  assert.equal(countScript('Lager – und Dichtung').words, 3);
});

test('Zahlen zählen als Wörter und haben Sprechformen', () => {
  const tokens = tokenize('Seit 2026 gilt DIN ISO 281.');
  assert.equal(tokens.filter((t) => t.isWord).length, 6);
  assert.includes(tokens[1].forms, 'zweitausendsechsundzwanzig');
});

test('nextWordIndex überspringt nicht gesprochene Zeichen', () => {
  const tokens = tokenize('Eins – zwei');
  assert.equal(nextWordIndex(tokens, 0), 0);
  assert.equal(nextWordIndex(tokens, 1), 2);
  assert.equal(nextWordIndex(tokens, 3), 3);
});

test('countScript liefert dieselben Zahlen wie parseScript', () => {
  const text = 'Erstens: 3,5 kN!\n\nZweitens – „Zitat“ (Klammer).\n\nDrittens z. B. 80 °C';
  const parsed = parseScript(text);
  const counted = countScript(text);
  assert.equal(counted.sections, parsed.sections.length);
  assert.equal(counted.words, parsed.wordCount);
});
