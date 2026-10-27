// Tests für js/resampler.js (Umrechnung der Mikrofon-Abtastrate auf 16 kHz für die Spracherkennung).
import { test, assert, loadClassicScript } from './harness.js';

let library = null;
async function resamplerLib() {
  if (!library) library = await loadClassicScript('../js/resampler.js', 'MitleserResampler');
  return library;
}

const RATES = [48000, 44100, 32000, 24000, 22050];

/** Sinuston: rate Werte pro Sekunde, freq in Hz, Dauer in Sekunden. */
function sine(rate, freq, seconds, amplitude = 1) {
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate);
  return x;
}

/** Reproduzierbares Rauschen (einfacher Zufallsgenerator mit festem Startwert). */
function noise(n, seed = 12345) {
  const x = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[i] = s / 2147483648 - 1;
  }
  return x;
}

/** Verarbeitet das Signal in Blöcken (Größen werden der Reihe nach wiederholt) und fügt die Ausgabe zusammen. */
function processInChunks(resampler, input, sizes = [4096]) {
  const parts = [];
  let total = 0;
  let k = 0;
  for (let i = 0; i < input.length; k++) {
    const size = sizes[k % sizes.length];
    const out = resampler.process(input.subarray(i, i + size));
    parts.push(out);
    total += out.length;
    i += size;
  }
  const result = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Effektivwert, ohne die Ein- und Ausschwingzeit an den Rändern. */
function rms(x, skip = 200) {
  let sum = 0;
  let n = 0;
  for (let i = skip; i < x.length - skip; i++) {
    sum += x[i] * x[i];
    n++;
  }
  return Math.sqrt(sum / n);
}

test('Ausgabelänge passt zum Verhältnis der Abtastraten (blockweise Aufrufe)', async () => {
  const R = await resamplerLib();
  for (const rate of RATES) {
    const input = sine(rate, 440, 2, 0.5);
    const out = processInChunks(R.create(rate, 16000), input, [4096]);
    const expected = (input.length * 16000) / rate; // 32 000
    // Der Filter hält am Ende höchstens 32 Werte (2 ms) zurück, bis neue Eingangswerte kommen.
    assert.atMost(out.length, expected, `${rate} Hz: zu viele Werte`);
    assert.atLeast(out.length, expected - 34, `${rate} Hz: zu wenige Werte`);
  }
});

test('Standard-Zielrate ist 16 000', async () => {
  const R = await resamplerLib();
  const r = R.create(48000);
  assert.equal(r.toRate, 16000);
  const out = processInChunks(r, sine(48000, 440, 1), [4096]);
  assert.atLeast(out.length, 16000 - 34, 'Länge');
  assert.atMost(out.length, 16000, 'Länge');
});

test('1-kHz-Ton behält seine Lautstärke (±10 %)', async () => {
  const R = await resamplerLib();
  for (const rate of RATES) {
    const out = processInChunks(R.create(rate), sine(rate, 1000, 1, 0.5), [4096]);
    const amplitude = rms(out) * Math.SQRT2;
    assert.atLeast(amplitude, 0.45, `${rate} Hz: Amplitude zu klein`);
    assert.atMost(amplitude, 0.55, `${rate} Hz: Amplitude zu groß`);
    // Tatsächlich ist der Durchlassbereich viel genauer als ±10 %:
    assert.atMost(Math.abs(amplitude - 0.5), 0.005, `${rate} Hz: Amplitude ${amplitude}`);
  }
});

test('12-kHz-Ton bei 48 kHz wird um mehr als 30 dB gedämpft', async () => {
  const R = await resamplerLib();
  const input = sine(48000, 12000, 1, 1);
  const out = processInChunks(R.create(48000), input, [4096]);
  const db = 20 * Math.log10(rms(out) / rms(input));
  assert.atMost(db, -30, '12 kHz');
});

test('Töne über 8 kHz werden bei allen Raten stark gedämpft (kein Aliasing)', async () => {
  const R = await resamplerLib();
  for (const rate of RATES) {
    for (const freq of [8500, 10000]) {
      if (freq >= rate / 2) continue;
      const input = sine(rate, freq, 0.5, 1);
      const out = processInChunks(R.create(rate), input, [4096]);
      const db = 20 * Math.log10(rms(out) / rms(input));
      assert.atMost(db, -60, `${rate} Hz, Ton ${freq} Hz`);
    }
  }
});

test('Blockweise Verarbeitung ergibt dasselbe wie ein einziger Aufruf', async () => {
  const R = await resamplerLib();
  const input = noise(30000);
  for (const rate of [48000, 44100, 22050]) {
    const whole = R.create(rate).process(input);
    const chunked = processInChunks(R.create(rate), input, [1, 7, 4096, 0, 333, 2, 1000, 128]);
    assert.equal(chunked.length, whole.length, `${rate} Hz: Länge`);
    let maxDiff = 0;
    for (let i = 0; i < whole.length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - chunked[i]));
    assert.atMost(maxDiff, 1e-5, `${rate} Hz: größte Abweichung`);
  }
});

test('Gleichanteil und Stille bleiben erhalten', async () => {
  const R = await resamplerLib();
  const silent = processInChunks(R.create(44100), new Float32Array(10000), [4096]);
  assert.ok(silent.length > 0, 'Ausgabe vorhanden');
  assert.ok(silent.every((v) => v === 0), 'Stille bleibt Stille');
  const constant = processInChunks(R.create(48000), new Float32Array(20000).fill(0.25), [4096]);
  for (let i = 100; i < constant.length; i++) {
    assert.atMost(Math.abs(constant[i] - 0.25), 1e-3, `Gleichanteil bei ${i}`);
  }
});

test('Gleiche Raten: Werte werden unverändert durchgereicht', async () => {
  const R = await resamplerLib();
  const input = noise(5000, 7);
  for (const r of [R.create(16000), R.create(16000, 16000)]) {
    const out = r.process(input);
    assert.equal(out.length, input.length, 'Länge');
    for (let i = 0; i < input.length; i++) {
      if (out[i] !== input[i]) assert.equal(out[i], input[i], `Wert ${i}`);
    }
  }
});

test('Hochrechnen (z. B. 8 kHz → 16 kHz) funktioniert ebenfalls', async () => {
  const R = await resamplerLib();
  const out = processInChunks(R.create(8000), sine(8000, 1000, 1, 0.5), [4096]);
  assert.atLeast(out.length, 16000 - 70, 'Länge');
  assert.atMost(out.length, 16000, 'Länge');
  const amplitude = rms(out) * Math.SQRT2;
  assert.atMost(Math.abs(amplitude - 0.5), 0.01, `Amplitude ${amplitude}`);
});

test('Ungültige Abtastraten werden abgelehnt', async () => {
  const R = await resamplerLib();
  assert.throws(() => R.create(0), 'Rate 0');
  assert.throws(() => R.create(NaN), 'Rate NaN');
  assert.throws(() => R.create(-44100), 'negative Rate');
  assert.throws(() => R.create(48000, 0), 'Zielrate 0');
});

test('Schnell genug: 10 s Audio bei 48 kHz in deutlich unter 2 s', async () => {
  const R = await resamplerLib();
  const input = sine(48000, 440, 10, 0.5);
  const started = Date.now();
  processInChunks(R.create(48000), input, [4096]);
  // Üblich sind ca. 0,1 s; die großzügige Grenze fängt nur grobe Fehler ab (z. B. quadratischer Aufwand).
  assert.atMost(Date.now() - started, 2000, 'Millisekunden');
});
