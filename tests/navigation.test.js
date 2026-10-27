// Tests: Blättern zwischen den Abschnitten (js/navigation.js)
import { test, assert } from './harness.js';
import { Navigation } from '../js/navigation.js';

test('Neue Navigation beginnt ungefärbt beim gewünschten Abschnitt', () => {
  const nav = new Navigation(5, 2);
  assert.equal(nav.index, 2);
  assert.equal(nav.count, 5);
  assert.equal(nav.colored, 0);
  assert.equal(nav.isFirst, false);
  assert.equal(nav.isLast, false);
  assert.equal(new Navigation(5).index, 0, 'ohne Startwert: erster Abschnitt');
});

test('Startabschnitt wird in den gültigen Bereich geschoben', () => {
  assert.equal(new Navigation(3, 7).index, 2, 'zu groß -> letzter Abschnitt');
  assert.equal(new Navigation(3, -4).index, 0, 'negativ -> erster Abschnitt');
  assert.equal(new Navigation(3, 1.8).index, 1, 'Bruchzahl wird abgerundet');
  assert.equal(new Navigation(3, NaN).index, 0, 'NaN -> erster Abschnitt');
  assert.equal(new Navigation(3, undefined).index, 0);
  assert.equal(new Navigation(3, '2').index, 2, 'Zahl als Text');
});

test('Weiter geht zum nächsten Abschnitt, ungefärbt', () => {
  const nav = new Navigation(3);
  nav.setColored(4);
  assert.equal(nav.next(), 'next');
  assert.equal(nav.index, 1);
  assert.equal(nav.colored, 0);
  assert.equal(nav.next(), 'next');
  assert.equal(nav.index, 2);
  assert.equal(nav.isLast, true);
});

test('Abnahme 7: Weiter beim letzten Abschnitt bewirkt nichts', () => {
  const nav = new Navigation(3, 2);
  nav.setColored(5);
  assert.equal(nav.next(), 'none');
  assert.equal(nav.index, 2, 'Abschnitt bleibt');
  assert.equal(nav.colored, 5, 'Färbung bleibt');
  assert.equal(nav.next(), 'none', 'auch beim zweiten Versuch');
  assert.equal(nav.index, 2);
});

test('Abnahme 6: Zurück mitten im Abschnitt löscht die Färbung, erneut zurück -> vorheriger Abschnitt', () => {
  const nav = new Navigation(4, 2);
  assert.equal(nav.setColored(7), true);
  assert.equal(nav.back(), 'reset');
  assert.equal(nav.index, 2, 'gleicher Abschnitt');
  assert.equal(nav.colored, 0, 'Färbung weg');
  assert.equal(nav.back(), 'prev');
  assert.equal(nav.index, 1, 'vorheriger Abschnitt');
  assert.equal(nav.colored, 0, 'vorheriger Abschnitt ist ungefärbt');
});

test('Zurück im ersten Abschnitt: erst Färbung löschen, danach passiert nichts', () => {
  const nav = new Navigation(3);
  assert.equal(nav.back(), 'none', 'ungefärbt im ersten Abschnitt');
  assert.equal(nav.index, 0);
  nav.setColored(2);
  assert.equal(nav.back(), 'reset');
  assert.equal(nav.colored, 0);
  assert.equal(nav.back(), 'none');
  assert.equal(nav.index, 0);
  assert.equal(nav.isFirst, true);
});

test('setColored zählt nur Fortschritt, die Färbung wird nie kleiner', () => {
  const nav = new Navigation(2);
  assert.equal(nav.setColored(3), true);
  assert.equal(nav.colored, 3);
  assert.equal(nav.setColored(3), false, 'gleicher Wert -> keine Änderung');
  assert.equal(nav.setColored(1), false, 'kleinerer Wert wird ignoriert');
  assert.equal(nav.colored, 3);
  assert.equal(nav.setColored(0), false);
  assert.equal(nav.setColored(-5), false);
  assert.equal(nav.setColored(NaN), false);
  assert.equal(nav.setColored(undefined), false);
  assert.equal(nav.colored, 3);
  assert.equal(nav.setColored(9), true);
  assert.equal(nav.colored, 9);
});

test('Nach dem Zurücksetzen darf die Färbung wieder von vorn wachsen', () => {
  const nav = new Navigation(2);
  nav.setColored(6);
  nav.back();
  assert.equal(nav.colored, 0);
  assert.equal(nav.setColored(2), true);
  assert.equal(nav.colored, 2);
});

test('Ein einziger Abschnitt: weiter und zurück blättern nie', () => {
  const nav = new Navigation(1, 5);
  assert.equal(nav.index, 0);
  assert.equal(nav.isFirst, true);
  assert.equal(nav.isLast, true);
  assert.equal(nav.next(), 'none');
  assert.equal(nav.back(), 'none');
  nav.setColored(4);
  assert.equal(nav.back(), 'reset');
  assert.equal(nav.back(), 'none');
  assert.equal(nav.index, 0);
});

test('Null Abschnitte: nichts passiert und nichts wird gefärbt', () => {
  const nav = new Navigation(0, 3);
  assert.equal(nav.count, 0);
  assert.equal(nav.index, 0);
  assert.equal(nav.isFirst, true);
  assert.equal(nav.isLast, true);
  assert.equal(nav.next(), 'none');
  assert.equal(nav.back(), 'none');
  assert.equal(nav.setColored(5), false);
  assert.equal(nav.colored, 0);
});

test('Ungültige Abschnittszahl gilt als 0, Bruchzahl wird abgerundet', () => {
  assert.equal(new Navigation(-2).count, 0);
  assert.equal(new Navigation(NaN).count, 0);
  assert.equal(new Navigation(undefined).count, 0);
  assert.equal(new Navigation(2.9).count, 2);
});

test('Ganzer Durchlauf: vor bis zum Ende, dann zurück bis zum Anfang', () => {
  const nav = new Navigation(3);
  const steps = [];
  for (let k = 0; k < 4; k++) steps.push(nav.next());
  assert.deepEqual(steps, ['next', 'next', 'none', 'none']);
  nav.setColored(1);
  const back = [];
  for (let k = 0; k < 5; k++) back.push(nav.back());
  assert.deepEqual(back, ['reset', 'prev', 'prev', 'none', 'none']);
  assert.equal(nav.index, 0);
});
