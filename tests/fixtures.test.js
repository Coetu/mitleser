// Tests mit echten Erkennungsergebnissen (tests/fixtures/*.json).
//
// Die Aufnahmen wurden mit der Windows-Sprachausgabe "Microsoft Hedda" gesprochen und mit genau der Vosk-Version
// und dem Modell dieser App erkannt (im Browser, 16 kHz). Jede Datei enthält den Abschnittstext, das tatsächlich
// Gesprochene, die zeitgestempelten Teil- und Endergebnisse der Erkennung und die Wort-Startzeiten der Sprachausgabe.
// Varianten: "clean" (sauber), "mild" (Raumhall + leises Rauschen), "noisy" (starker Hall + Rauschen).
import { test, assert, loadJSON } from './harness.js';
import { tokenize } from '../js/text.js';
import { Tracker } from '../js/matcher.js';

const index = await loadJSON('fixtures/index.json');
const fixtures = [];
for (const file of index) fixtures.push(await loadJSON(`fixtures/${file}`));
const byName = Object.fromEntries(fixtures.map((f) => [f.name, f]));

/** Spielt alle Erkennungsereignisse ab. `transform` kann die Wörter verändern (Störungstests). */
function replay(fx, transform = (words) => words) {
  const tokens = tokenize(fx.section);
  const tracker = new Tracker(tokens);
  const timeline = [];
  let utterance = 0;
  for (const [t, type, text] of fx.events) {
    const words = transform(text.split(' ').filter(Boolean), utterance);
    const pos = tracker.update(words, type === 'f');
    timeline.push({ t, pos });
    if (type === 'f') utterance++;
  }
  return { tokens, tracker, timeline, final: tracker.position };
}

/** Startzeit (Sekunden) jedes Tokens, wenn wörtlich vorgelesen wurde (gesprochen === Abschnitt). */
function tokenStartTimes(fx, tokens) {
  const starts = [];
  let from = 0;
  const ranges = tokens.map((t) => {
    const at = fx.section.indexOf(t.text, from);
    from = at + t.text.length;
    return [at, from];
  });
  for (const [a, b] of ranges) {
    let best = Infinity;
    // Die Sprachausgabe meldet manchmal mehrere Wörter in einem Ereignis ("von 1.500 Umdrehungen").
    for (const [time, pos, len] of fx.spokenWords) {
      const covers = (pos >= a && pos < b) || (a >= pos && a < pos + len);
      if (covers && time < best) best = time;
    }
    starts.push(best);
  }
  for (let i = starts.length - 2; i >= 0; i--) if (starts[i] === Infinity) starts[i] = starts[i + 1];
  return starts;
}

/** Prüft, dass nie ein Wort gefärbt wird, bevor es gesprochen wurde. */
function assertNeverAhead(fx, run) {
  const starts = tokenStartTimes(fx, run.tokens);
  for (const { t, pos } of run.timeline) {
    if (pos === 0) continue;
    assert.ok(starts[pos - 1] <= t + 0.05,
      `${fx.name}: „${run.tokens[pos - 1].text}“ bei ${t} s gefärbt, gesprochen erst bei ${starts[pos - 1]} s`);
  }
}

const isVerbatim = (fx) => fx.spoken === fx.section;

test('Testdaten sind vollständig vorhanden', () => {
  assert.atLeast(fixtures.length, 20);
  for (const fx of fixtures) {
    assert.ok(fx.section && fx.events.length, fx.name);
  }
});

test('Abnahme 2: Abschnitt wörtlich vorgelesen → alle Wörter gefärbt', () => {
  for (const name of ['s1_verbatim', 's1_fast', 's1_slow', 's2_verbatim', 's5_verbatim', 's4_long']) {
    const run = replay(byName[name]);
    assert.equal(run.final, run.tokens.length, name);
  }
});

test('Abnahme 3: Satz ausgelassen und „äh, also“ eingestreut → am Ende vollständig gefärbt', () => {
  for (const name of ['s2_skip_filler', 's2_skip_filler_mild']) {
    const run = replay(byName[name]);
    assert.equal(run.final, run.tokens.length, name);
  }
});

test('Abnahme 4: Abschnitt mit Zahlen („DIN ISO 281“, „3,5 kN“, „2026“) → Färbung bleibt dran', () => {
  for (const name of ['s3_numbers_spoken', 's3_numbers_raw', 's3_numbers_spoken_mild']) {
    const run = replay(byName[name]);
    assert.equal(run.final, run.tokens.length, name);
  }
});

test('Abnahme 5: fremder Satz, der nicht im Text steht → höchstens ein Wort gefärbt', () => {
  for (const name of ['foreign_only', 'foreign_only_mild', 'foreign_only_noisy']) {
    assert.atMost(replay(byName[name]).final, 1, name);
  }
});

test('Erwartungen aller Testaufnahmen (sauber, leicht und stark gestört)', () => {
  for (const fx of fixtures) {
    const run = replay(fx);
    const words = run.tokens.length;
    if (fx.expect.full && fx.variant === 'clean') assert.equal(run.final, words, `${fx.name} vollständig`);
    if (fx.expect.full && fx.variant === 'mild') assert.atLeast(run.final, Math.floor(words * 0.85), `${fx.name} fast vollständig`);
    if (fx.expect.maxColored !== undefined) assert.atMost(run.final, fx.expect.maxColored, fx.name);
    if (fx.expect.partialUpTo && fx.variant === 'clean') {
      assert.atLeast(run.final, run.tokens.findIndex((t) => t.text === fx.expect.partialUpTo) + 1, fx.name);
    }
  }
});

test('Es wird nie etwas gefärbt, das noch nicht gesprochen wurde (auch bei schlechter Erkennung)', () => {
  let checked = 0;
  for (const fx of fixtures.filter(isVerbatim)) {
    assertNeverAhead(fx, replay(fx));
    checked++;
  }
  assert.atLeast(checked, 8);
});

test('Abschweifen mitten im Abschnitt färbt nichts, danach geht es weiter', () => {
  const fx = byName.s4_digress;
  const run = replay(fx);
  const geschoben = run.tokens.findIndex((t) => t.text === 'geschoben.') + 1;
  const offset = (word) => fx.spoken.indexOf(word);
  const time = (pos) => Math.min(...fx.spokenWords.filter((w) => w[1] === pos).map((w) => w[0]));
  const digressStart = time(offset('Das kennen'));
  const resume = time(offset('Wichtig'));
  for (const { t, pos } of run.timeline) {
    if (t > digressStart && t < resume) assert.atMost(pos, geschoben + 1, `bei ${t} s`);
  }
  assert.equal(run.final, run.tokens.findIndex((t) => t.text === 'anliegt.') + 1);
});

test('Freie Rede vor dem Lesen und Einstieg mitten im Abschnitt', () => {
  const pre = replay(byName.foreign_then_read);
  assert.equal(pre.final, pre.tokens.length, 'erst freie Rede, dann gelesen');
  const mid = replay(byName.s2_midstart);
  assert.equal(mid.final, mid.tokens.length, 'Einstieg beim vierten Satz');
});

test('Verzögerung: die meisten Wörter sind nach weniger als einer Sekunde gefärbt', () => {
  const delays = [];
  for (const fx of fixtures.filter((f) => isVerbatim(f) && f.variant === 'clean')) {
    const run = replay(fx);
    const starts = tokenStartTimes(fx, run.tokens);
    let prev = 0;
    for (const { t, pos } of run.timeline) {
      for (let i = prev; i < pos; i++) {
        const spokenEnd = i + 1 < starts.length ? starts[i + 1] : starts[i] + 0.5;
        if (Number.isFinite(spokenEnd)) delays.push(t - spokenEnd);
      }
      prev = Math.max(prev, pos);
    }
  }
  delays.sort((a, b) => a - b);
  const median = delays[Math.floor(delays.length / 2)];
  const p80 = delays[Math.floor(delays.length * 0.8)];
  assert.atLeast(delays.length, 200);
  assert.atMost(median, 0.6, 'Median in Sekunden');
  assert.atMost(p80, 1.0, '80 % der Wörter in Sekunden');
});

// Künstlich verschlechterte Erkennung: Ersetzungen, ausgelassene Wörter, eingeschobene Füllwörter.
function corruption(rate, seed) {
  const noise = ['bitte', 'genau', 'wetter', 'kaffee', 'morgen', 'zeit', 'leute', 'frage', 'punkt', 'sache'];
  const rnd = (u, k, salt) => {
    let x = (u * 7919 + k * 104729 + salt * 1299709 + seed * 15485863) >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return (x % 10000) / 10000;
  };
  return (words, u) => {
    const out = [];
    words.forEach((w, k) => {
      const r = rnd(u, k, 1);
      if (r < rate * 0.25) out.push('äh');
      if (r < rate * 0.5) out.push(noise[Math.floor(rnd(u, k, 2) * noise.length)]);
      else if (r < rate * 0.75) { /* Wort fehlt */ } else out.push(w);
    });
    return out;
  };
}

test('Robust gegen zusätzliche Erkennungsfehler (20 % und 35 % der Wörter gestört)', () => {
  // [Störungsrate, Mindestanteil je Abschnitt, Mindestanteil im Mittel]
  for (const [rate, minShare, meanShare] of [[0.2, 0.9, 0.97], [0.35, 0.7, 0.9]]) {
    const shares = [];
    for (const name of ['s1_verbatim', 's2_verbatim', 's2_skip_filler', 's3_numbers_spoken', 's4_long', 's5_verbatim']) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const run = replay(byName[name], corruption(rate, seed));
        const share = run.final / run.tokens.length;
        shares.push(share);
        assert.atLeast(share, minShare, `${name}, Störung ${rate}, Variante ${seed}`);
      }
    }
    const mean = shares.reduce((a, x) => a + x, 0) / shares.length;
    assert.atLeast(mean, meanShare, `mittlerer Anteil bei Störung ${rate}`);
    for (const seed of [1, 2, 3, 4, 5]) assert.atMost(replay(byName.foreign_only, corruption(rate, seed)).final, 1, 'fremder Satz');
  }
});
