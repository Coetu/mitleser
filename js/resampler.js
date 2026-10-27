/* Mitleser – Abtastraten-Wandler (Resampler) für die Spracherkennung.
 *
 * Das Mikrofon liefert je nach Gerät 48 000 oder 44 100 Werte pro Sekunde (manchmal auch andere Raten).
 * Vosk arbeitet mit 16 000 Werten pro Sekunde und braucht etwa doppelt so lange, wenn es selbst umrechnen
 * muss. Darum rechnen wir hier vorher um – schnell und in guter Qualität:
 *
 *   1. Tiefpass: Töne über ca. 7,2 kHz werden entfernt. Bei 16 kHz lassen sich nur Töne bis 8 kHz
 *      darstellen; höhere würden sonst als Störgeräusch in den Sprachbereich "zurückgespiegelt" (Aliasing).
 *   2. Neue Zeitpunkte: Für jeden Ausgabewert wird der Wert an seiner (meist krummen) Position im
 *      Eingangssignal berechnet.
 *
 * Beides erledigt ein einziger gefensterter Sinc-Filter (Kaiser-Fenster, ca. 90 dB Dämpfung). Seine Form
 * steht einmalig in einer fein aufgelösten Tabelle; Zwischenwerte werden linear interpoliert.
 *
 * Klassisches Skript (kein ES-Modul), damit der Web Worker es per importScripts() laden kann.
 * Benutzung:
 *   const resampler = self.MitleserResampler.create(48000);   // Ziel: 16000 (Standard)
 *   const out = resampler.process(block);                      // Float32Array rein, Float32Array raus
 * process() darf mit beliebig großen Blöcken aufgerufen werden; der Zustand bleibt zwischen den Aufrufen
 * erhalten, d. h. blockweise Verarbeitung ergibt genau dasselbe wie ein einziger großer Aufruf.
 * Die Ausgabe hinkt dabei um 32 Werte (2 ms) hinterher, weil der Filter etwas "Zukunft" braucht.
 */
(function () {
  'use strict';

  // Filterbreite je Seite, gemessen in Abtastwerten der NIEDRIGEREN Rate.
  // Bei 48 kHz → 16 kHz sind das 32 × 3 = 96 Eingangswerte links und rechts von jedem Ausgabewert.
  const HALF_WIDTH = 32;
  // Tabellenpunkte je Abtastwert (feine Phasenauflösung); dazwischen wird linear interpoliert.
  const TABLE_RESOLUTION = 512;
  // Grenzfrequenz als Anteil der niedrigeren Rate: 0,45 × 16 000 Hz = 7 200 Hz.
  const CUTOFF = 0.45;
  // Form des Kaiser-Fensters: 9 ergibt rund 90 dB Dämpfung oberhalb von ca. 7,9 kHz.
  const KAISER_BETA = 9;

  let sharedTable = null;

  /** Modifizierte Bessel-Funktion 0. Ordnung (Reihenentwicklung) – nur für die Fensterform nötig. */
  function besselI0(x) {
    const quarter = (x * x) / 4;
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 100; k++) {
      term *= quarter / (k * k);
      sum += term;
      if (term < sum * 1e-16) break;
    }
    return sum;
  }

  /**
   * Filterform (eine Hälfte, symmetrisch) als Tabelle über den Abstand x = 0 … HALF_WIDTH,
   * gemessen in Abtastwerten der niedrigeren Rate. Hängt nicht von den konkreten Raten ab
   * und wird deshalb nur einmal berechnet und von allen Resamplern geteilt.
   */
  function kernelTable() {
    if (sharedTable) return sharedTable;
    const size = HALF_WIDTH * TABLE_RESOLUTION;
    const table = new Float64Array(size + 2); // +2: Endpunkt plus eine Null als Sicherheitsreserve
    const norm = besselI0(KAISER_BETA);
    for (let i = 0; i <= size; i++) {
      const x = i / TABLE_RESOLUTION;
      const r = x / HALF_WIDTH;
      const taper = besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - r * r))) / norm; // Kaiser-Fenster
      const a = 2 * Math.PI * CUTOFF * x;
      const sinc = i === 0 ? 1 : Math.sin(a) / a;
      table[i] = 2 * CUTOFF * sinc * taper;
    }
    sharedTable = table;
    return table;
  }

  function greatestCommonDivisor(a, b) {
    while (b) {
      const rest = a % b;
      a = b;
      b = rest;
    }
    return a;
  }

  function checkRate(value, label) {
    const rate = Math.round(Number(value));
    if (!Number.isFinite(rate) || rate < 1000 || rate > 1000000) {
      throw new RangeError('Ungültige Abtastrate (' + label + '): ' + value);
    }
    return rate;
  }

  /** Echter Wandler für zwei verschiedene Raten. */
  function createConverter(fromRate, toRate) {
    const table = kernelTable();
    const tableEnd = HALF_WIDTH * TABLE_RESOLUTION; // Tabellenpositionen ab hier liegen außerhalb des Filters

    // Schrittweite im Eingang je Ausgabewert als exakter Bruch stepNum/stepDen (z. B. 441/160 bei 44,1 kHz).
    // Mit ganzen Zahlen gerechnet, damit sich auch nach Stunden kein Rundungsfehler aufsummiert.
    const divisor = greatestCommonDivisor(fromRate, toRate);
    const stepNum = fromRate / divisor;
    const stepDen = toRate / divisor;
    const stepWhole = Math.floor(stepNum / stepDen);
    const stepRest = stepNum % stepDen;

    // Der Filter ist in Einheiten der niedrigeren Rate definiert. scale rechnet Eingangswerte darin um.
    const scale = Math.min(1, toRate / fromRate);
    const tableStep = scale * TABLE_RESOLUTION;      // Tabellenpositionen je Eingangswert
    const reach = Math.ceil(HALF_WIDTH / scale);     // Eingangswerte je Seite, die ein Ausgabewert braucht

    // Eingangspuffer: [Vorgeschichte | neue Werte]. Am Anfang steht Stille als Vorlauf, damit der erste
    // Ausgabewert genau beim ersten Eingangswert liegt.
    let buffer = new Float32Array(2 * reach + 8192);
    let length = reach;   // belegte Werte im Puffer
    let pos = reach;      // Pufferposition des nächsten Ausgabewerts (ganzzahliger Teil)
    let frac = 0;         // Bruchteil dieser Position als Zähler: frac / stepDen (0 … <1)

    function append(input) {
      const needed = length + input.length;
      if (needed > buffer.length) {
        const bigger = new Float32Array(Math.max(needed, buffer.length * 2));
        bigger.set(buffer.subarray(0, length));
        buffer = bigger;
      }
      buffer.set(input, length);
      length = needed;
    }

    /** Wie viele Ausgabewerte lassen sich berechnen? (Rechts müssen genug Eingangswerte vorhanden sein.) */
    function countOutputs() {
      let count = 0;
      let p = pos;
      let f = frac;
      while (p + reach < length) {
        count++;
        p += stepWhole;
        f += stepRest;
        if (f >= stepDen) {
          f -= stepDen;
          p++;
        }
      }
      return count;
    }

    function process(input) {
      if (input && input.length) append(input);
      const out = new Float32Array(countOutputs());
      for (let m = 0; m < out.length; m++) {
        const phase = frac / stepDen;
        let sum = 0;
        // Linke Seite: Eingangswerte im Abstand phase, 1 + phase, 2 + phase, … vor der Position.
        for (let j = 0; j <= reach; j++) {
          const t = (j + phase) * tableStep;
          if (t >= tableEnd) break;
          const i = t | 0;
          sum += buffer[pos - j] * (table[i] + (t - i) * (table[i + 1] - table[i]));
        }
        // Rechte Seite: Abstand 1 − phase, 2 − phase, … nach der Position.
        for (let j = 1; j <= reach; j++) {
          const t = (j - phase) * tableStep;
          if (t >= tableEnd) break;
          const i = t | 0;
          sum += buffer[pos + j] * (table[i] + (t - i) * (table[i + 1] - table[i]));
        }
        out[m] = sum * scale;
        // Zur nächsten Ausgabeposition weiterrücken.
        pos += stepWhole;
        frac += stepRest;
        if (frac >= stepDen) {
          frac -= stepDen;
          pos++;
        }
      }
      // Verbrauchte Werte vorne entfernen; nur so viel Vorgeschichte behalten, wie der Filter braucht.
      const drop = pos - reach;
      if (drop > 0) {
        buffer.copyWithin(0, drop, length);
        length -= drop;
        pos -= drop;
      }
      return out;
    }

    return { fromRate, toRate, process };
  }

  /**
   * Erzeugt einen Wandler von fromRate auf toRate (Standard 16 000).
   * Bei gleichen Raten werden die Blöcke unverändert durchgereicht.
   */
  function create(fromRate, toRate = 16000) {
    const from = checkRate(fromRate, 'Eingang');
    const to = checkRate(toRate, 'Ziel');
    if (from === to) {
      return { fromRate: from, toRate: to, process: (input) => input };
    }
    return createConverter(from, to);
  }

  self.MitleserResampler = { create };
})();
