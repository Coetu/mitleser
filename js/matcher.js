// Mitleser – Wortabgleich: Wo im Abschnitt ist die vortragende Person gerade?
//
// Verwendung:
//   const tracker = new Tracker(section.tokens);
//   tracker.update(words, isFinal)  -> Position (Anzahl gefärbter Tokens; wächst nur, springt nie zurück)
//   tracker.reset()                 -> wieder ungefärbt, alles Gesprochene vergessen
//
// Idee: Die zuletzt erkannten Wörter (ein gleitendes Fenster) werden per dynamischer Programmierung gegen den
// Text ausgerichtet. Erlaubt sind dabei:
//   - Treffer: ein Textwort passt (unscharf, über Lautschlüssel) zu einem erkannten Wort, oder zu mehreren
//     aufeinanderfolgenden erkannten Wörtern ("kegel rollen lager", "zwei tausend sechs und zwanzig"),
//     oder mehrere Textwörter zu einem erkannten Wort ("zu wenig" -> "zuwenig");
//   - Fehlerkennungen: ein Textwort wurde gesprochen, aber als anderes Wort erkannt (kleiner Preis);
//   - erkannte Wörter ohne Gegenstück (Füllwörter, Versprecher, freie Rede) kosten etwas;
//   - ausgelassene Textwörter kosten etwas; ein ganzer ausgelassener Satz kostet einen festen Sprungpreis.
//
// Die Entscheidung läuft in zwei Schritten:
//   1. Anschluss: Wurde das zuletzt gefärbte Wort gerade eben gesprochen? (Ausrichtung bis zur aktuellen Position)
//   2. Neuer Beleg: Wie gut belegen die neuen Wörter eine Position hinter der aktuellen? Gezählt werden nur
//      Treffer, Fehlerkennungen, Auslassungen und unerklärte Wörter ab der aktuellen Position.
// Weitergefärbt wird nur bei genug neuem Beleg. Häufige kurze Wörter ("und", "die") bringen wenig Beleg, lange
// seltene Wörter viel. Wer direkt weiterliest (Anschluss), braucht wenig Beleg; Sprünge brauchen viel.
// Wörter, die schon eine Färbung belegt haben, zählen kein zweites Mal.

import { phoneticKey, STOPWORDS, FILLERS, cardinalForms, digitsToWords } from './normalize.js';
import { nextWordIndex } from './text.js';

export const DEFAULTS = {
  windowWords: 14, // so viele zuletzt erkannte Wörter werden betrachtet
  backTokens: 12, // so weit vor der aktuellen Position darf der Anschluss gesucht werden (Wiederholungen)
  insCost: 0.35, // erkanntes Wort ohne Gegenstück
  fillerCost: 0.06, // Füllwort ("äh" kommt meist als "e" an)
  delCost: 0.35, // nicht erkanntes Textwort
  delCostStop: 0.18, // nicht erkanntes kurzes Funktionswort
  delCostAside: 0.12, // Wort in einer Klammer (Einschübe werden oft weggelassen)
  subCost: 0.3, // Textwort gesprochen, aber als anderes Wort erkannt (Fehlerkennung)
  subCostPerExtra: 0.1, // … als mehrere falsche Wörter ("Software-Update" -> "soft wer apdeit")
  jumpCost: 2.0, // Sprung über ausgelassenen Text (ab jumpMin Tokens) mitten in einen Satz
  jumpCostSentence: 1.2, // … an einen Satzanfang (ganze Sätze auszulassen ist der übliche Fall)
  jumpMin: 5,
  minGain: 0.8, // nötiger neuer Beleg, um weiterzufärben
  minGainAttached: 0.45, // … wenn direkt an das zuletzt gefärbte Wort angeschlossen wird
  minGainAttachedFinal: 0.25, // … und die Äußerung abgeschlossen ist (z. B. kurzes letztes Wort im Satz)
  minGainGap: 0.65, // angeschlossen, aber mit ausgelassenem oder falsch erkanntem Wort dazwischen
  minGainGapFinal: 0.45, // … am Ende der Äußerung bis zum Abschnittsende
  gainPerDoubling: 0.25, // zusätzlicher Beleg je Verdopplung der Sprungweite (über 3 Tokens hinaus)
  maxMergeSpeech: 4, // ein Textwort = bis zu so vielen erkannten Wörtern
  maxMergeSpeechNumber: 7, // bei Zahlen ("ein tausend fünf hundert …")
  maxMergeText: 3, // so viele Textwörter = ein erkanntes Wort
  mergePenalty: 0.94, // Faktor je zusätzlich zusammengefasstem Wort
  stopWeight: 0.3, // Beleg eines exakt erkannten Funktionsworts
  prefixBonus: 0.5, // die letzten Wörter sind der Anfang eines langen Wortes ("kegel" von "Kegelrollenlager")
  prefixMinChars: 4,
  prefixMinTokenChars: 8,
  shortFirstSentence: 3, // so kurze erste Sätze ("Fragen?", "Und jetzt?") dürfen mit Anschluss-Schwelle starten
  cacheLimit: 250000, // so viele zwischengespeicherte Vergleiche, dann wird aufgeräumt
};

const NEG = -1e9;
const OP_START = 0;
const OP_EXTRA = 1; // erkanntes Wort ohne Gegenstück
const OP_SKIP = 2; // Textwort ausgelassen oder falsch erkannt
const OP_MATCH = 3;
const OP_PREFIX = 4; // Anfang eines langen Textwortes (das Wort selbst wird noch nicht gefärbt)

const SENTENCE_END = /[.!?:;…]["“”»’)\]]*$/;
const ASIDE_END = /[)\]]["“”»’]*[,;:]?$/;

/** Erlaubte Bearbeitungen (Levenshtein) je nach Länge des Lautschlüssels. */
function allowedEdits(len) {
  if (len <= 2) return 0;
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  if (len <= 10) return 3;
  return Math.floor(len * 0.3);
}

/** Levenshtein-Abstand mit Abbruch, sobald `limit` sicher überschritten ist (dann limit + 1). */
export function editDistance(a, b, limit) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > limit) return limit + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j - 1] + cost;
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[lb];
}

/** Ähnlichkeit zweier Lautschlüssel als Qualität 0 (kein Treffer) … 1 (identisch). */
export function matchQuality(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const len = Math.max(a.length, b.length);
  const limit = allowedEdits(len);
  if (limit === 0) return 0;
  const d = editDistance(a, b, limit);
  if (d > limit) return 0;
  return 1 - (0.8 * d) / limit;
}

/** Beleg eines Treffers abhängig von der Länge des Lautschlüssels: lange Wörter zählen mehr. */
function keyWeight(len) {
  return Math.max(0.55, Math.min(1.5, 0.4 + 0.08 * len));
}

function charLength(words) {
  let n = 0;
  for (const w of words) n += w.length;
  return n;
}

export class Tracker {
  constructor(tokens, options = {}) {
    this.tokens = tokens;
    this.opt = { ...DEFAULTS, ...options };
    const o = this.opt;
    this.info = tokens.map((t) => {
      const keys = [...new Set(t.forms.map((f) => phoneticKey(f)).filter(Boolean))];
      const isStop = keys.length > 0 && STOPWORDS.has(t.forms[0]);
      const weights = keys.map((k) => (isStop ? o.stopWeight : keyWeight(k.length)));
      let del = 0;
      if (keys.length && !t.optional) del = t.aside ? o.delCostAside : isStop ? o.delCostStop : o.delCost;
      const longest = keys.reduce((n, k) => Math.max(n, k.length), 0);
      return {
        keys,
        weights,
        weight: weights.length ? Math.max(...weights) : 0,
        isStop,
        numeric: /\d/.test(t.text),
        del,
        // Wörter, die die Erkennung gern in mehrere falsche Wörter zerlegt (lang, Zahl, Bindestrich, Schrägstrich)
        hard: keys.length > 0 && (longest >= 8 || /[\d/-]/.test(t.text)),
      };
    });
    // Sprungpreis je Landeposition: an Satz-, Zeilen- und Klammer-Enden billiger.
    this.jumpTo = tokens.map((t, i) => {
      if (i === 0 || t.brk > 0 || t.cue) return o.jumpCostSentence;
      const prev = tokens[i - 1].text;
      return SENTENCE_END.test(prev) || ASIDE_END.test(prev) ? o.jumpCostSentence : o.jumpCost;
    });
    this.jumpTo.push(o.jumpCostSentence);
    // Erster Satz: Ende und Zahl der gesprochenen Wörter (für sehr kurze Abschnitte wie "Fragen?")
    let firstEnd = tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      if (i > 0 && tokens[i].brk > 0) {
        firstEnd = i;
        break;
      }
      if (SENTENCE_END.test(tokens[i].text)) {
        firstEnd = i + 1;
        break;
      }
    }
    this._firstEnd = firstEnd;
    this._firstSpoken = tokens.slice(0, firstEnd).filter((t) => t.forms.length).length;
    this._keyCache = new Map();
    this._clearCaches();
    this.reset();
  }

  reset() {
    this._position = 0;
    this._history = []; // Wörter der letzten abgeschlossenen Äußerungen (für den Anschluss)
    this._streamChars = 0; // Buchstaben aller abgeschlossenen Äußerungen seit dem Start (fortlaufend gezählt)
    this._consumedChars = 0; // erkannter Text bis zu dieser Stelle hat die bisherige Färbung schon belegt
    this._commits = 0;
    this.lastDebug = null;
  }

  get position() {
    return this._position;
  }

  get nextIndex() {
    return nextWordIndex(this.tokens, this._position);
  }

  get done() {
    return this.nextIndex >= this.tokens.length;
  }

  /**
   * Neue Erkennung verarbeiten.
   * @param {string[]} words  Wörter der aktuellen Äußerung (bei Teilergebnissen: alles bisher Erkannte)
   * @param {boolean} isFinal Äußerung abgeschlossen (danach beginnt eine neue)
   * @returns {number} Position nach dem Abgleich
   */
  update(words, isFinal = false) {
    const clean = (words || []).map((w) => String(w).toLowerCase().trim()).filter(Boolean);
    if (!clean.length && !isFinal) return this._position;
    const all = this._history.concat(clean);
    const windowWords = all.slice(-this.opt.windowWords);
    // Fortlaufende Buchstaben-Positionen statt Wortnummern: Zerlegt die Erkennung ein Wort im nächsten
    // Teilergebnis anders ("zu viel" -> "zuviel"), bleibt die Grenze zum schon Verbrauchten an derselben Stelle.
    let pos = this._streamChars - charLength(this._history);
    for (let k = 0; k < all.length - windowWords.length; k++) pos += all[k].length;
    const starts = new Array(windowWords.length + 1);
    for (let k = 0; k < windowWords.length; k++) {
      starts[k] = pos;
      pos += windowWords[k].length;
    }
    starts[windowWords.length] = pos;
    if (clean.length && this._position < this.tokens.length) this._align(windowWords, starts, isFinal);
    if (isFinal) {
      // Wörter eines abgebrochenen oder verkürzten Teilergebnisses gibt es nicht mehr (z. B. nach Pause):
      // die nächste Äußerung beginnt direkt nach dem Endergebnis und zählt wieder als neu.
      const chars = charLength(clean);
      this._consumedChars = Math.min(this._consumedChars, this._streamChars + chars);
      this._streamChars += chars;
      this._history = windowWords;
    }
    return this._position;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Vergleiche (zwischengespeichert)

  _clearCaches() {
    this._ids = new Map(); // Lautschlüssel eines erkannten Wortstücks -> kleine Nummer
    this._pts = []; // je Token: Map(Nummer -> Beleg)
    this._pre = []; // je Token: Map(Nummer -> Anfangs-Qualität)
    this._multi = new Map(); // "i,l" -> Map(Nummer -> Beleg)
    this._joined = new Map(); // "i,l" -> zusammengesetzter Lautschlüssel mehrerer Tokens
    this._cacheSize = 0;
  }

  _speechKey(text) {
    let k = this._keyCache.get(text);
    if (k === undefined) {
      // Wörter mit Ziffern aus dem Wortschatz der Erkennung ("co2", "mp3") wie im Text aussprechen.
      const spoken = /\d/.test(text)
        ? text.replace(/\d+/g, (d) => (d.length <= 6 ? cardinalForms(Number(d))[0] : '') || digitsToWords(d))
        : text;
      k = phoneticKey(spoken);
      if (this._keyCache.size > 20000) this._keyCache.clear();
      this._keyCache.set(text, k);
    }
    return k;
  }

  _id(key) {
    let id = this._ids.get(key);
    if (id === undefined) {
      id = this._ids.size;
      this._ids.set(key, id);
    }
    return id;
  }

  _lookup(store, slot, id, compute) {
    let map = store[slot];
    if (!map) {
      map = new Map();
      store[slot] = map;
    }
    let v = map.get(id);
    if (v === undefined) {
      v = compute();
      map.set(id, v);
      this._cacheSize++;
    }
    return v;
  }

  /** Beleg (Qualität × Gewicht) von Token i gegen ein erkanntes Wortstück. */
  _points(i, key, id) {
    return this._lookup(this._pts, i, id, () => {
      const info = this.info[i];
      let best = 0;
      for (let k = 0; k < info.keys.length; k++) {
        const q = matchQuality(info.keys[k], key);
        if (q > 0) best = Math.max(best, q * info.weights[k]);
      }
      return best;
    });
  }

  /** Passt das erkannte Stück zum Anfang von Token i? (Für lange Wörter, die gerade gesprochen werden.) */
  _prefixQuality(i, key, id) {
    const o = this.opt;
    if (key.length < o.prefixMinChars) return 0;
    return this._lookup(this._pre, i, id, () => {
      let q = 0;
      for (const k of this.info[i].keys) {
        if (k.length < o.prefixMinTokenChars || key.length > k.length - 3) continue;
        q = Math.max(q, matchQuality(k.slice(0, key.length), key));
      }
      return q;
    });
  }

  /** Lautschlüssel mehrerer Textwörter am Stück (aus den Sprechformen, nicht aus den Schlüsseln). */
  _joinedKey(i, l) {
    const slot = i + ',' + l;
    let k = this._joined.get(slot);
    if (k === undefined) {
      const parts = [];
      for (let t = i; t < i + l; t++) {
        if (!this.tokens[t].forms.length) {
          parts.length = 0;
          break;
        }
        parts.push(this.tokens[t].forms[0]);
      }
      k = parts.length ? phoneticKey(parts.join('')) : '';
      this._joined.set(slot, k);
    }
    return k;
  }

  /** Beleg mehrerer Textwörter (i … i+l-1) gegen ein erkanntes Wort. */
  _multiPoints(i, l, key, id) {
    const slot = i + ',' + l;
    let map = this._multi.get(slot);
    if (!map) {
      map = new Map();
      this._multi.set(slot, map);
    }
    let v = map.get(id);
    if (v === undefined) {
      v = 0;
      const joined = this._joinedKey(i, l);
      // Das erkannte Wort muss alle Textwörter abdecken (nicht kürzer sein), sonst würde z. B. "wird"
      // auch noch das folgende "Die" mitfärben.
      if (joined && key.length >= joined.length) {
        const q = matchQuality(joined, key);
        if (q > 0) {
          let w = 0;
          for (let t = i; t < i + l; t++) w += this.info[t].weight;
          v = w * q * Math.pow(this.opt.mergePenalty, l - 1);
        }
      }
      map.set(id, v);
      this._cacheSize++;
    }
    return v;
  }

  /** Alle Treffer, die bei Wort j und Token i beginnen: emit(zielZeile, zielToken, beleg). */
  _matches(j, i, m, hi, S, emit) {
    const o = this.opt;
    const info = this.info[i];
    if (i >= hi || !info.keys.length) return;
    const kMax = Math.min(info.numeric ? o.maxMergeSpeechNumber : o.maxMergeSpeech, m - j);
    for (let k = 1; k <= kMax; k++) {
      let pts = this._points(i, S.keys[j][k], S.ids[j][k]);
      if (pts <= 0) continue;
      // Ein erkanntes Funktionswort ("für", "mehr") belegt ein inhaltsreiches Textwort ("vier", "Meer") nur schwach.
      if (k === 1 && S.stop[j] && !info.isStop) pts = Math.min(pts, o.stopWeight);
      emit(j + k, i + 1, pts * Math.pow(o.mergePenalty, k - 1));
    }
    for (let l = 2; l <= o.maxMergeText && i + l <= hi; l++) {
      const pts = this._multiPoints(i, l, S.keys[j][1], S.ids[j][1]);
      if (pts > 0) emit(j + 1, i + l, pts);
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Ausrichtung und Entscheidung

  _align(words, starts, isFinal) {
    const o = this.opt;
    const info = this.info;
    const c = this._position;
    const n = this.tokens.length;
    const m = words.length;
    const lo = Math.max(0, c - o.backTokens);
    const hi = n; // ganzer restlicher Abschnitt (weite Sprünge brauchen ohnehin viel Beleg)
    if (this._cacheSize > o.cacheLimit) this._clearCaches();

    // Lautschlüssel aller Wortfolgen words[j .. j+k-1]
    const maxK = Math.max(o.maxMergeSpeech, o.maxMergeSpeechNumber);
    const S = { keys: [], ids: [], stop: [] };
    for (let j = 0; j < m; j++) {
      const keys = [null];
      const ids = [-1];
      for (let k = 1; k <= maxK && j + k <= m; k++) {
        const key = this._speechKey(k === 1 ? words[j] : words.slice(j, j + k).join(''));
        keys.push(key);
        ids.push(this._id(key));
      }
      S.keys.push(keys);
      S.ids.push(ids);
      S.stop.push(STOPWORDS.has(words[j]));
    }
    const insCost = words.map((w) => (FILLERS.has(w) ? o.fillerCost : o.insCost));
    const canSub = words.map((w) => !FILLERS.has(w));
    // Erstes Wort, das noch keine Färbung belegt hat
    let firstFresh = m;
    for (let j = 0; j < m; j++) {
      if (starts[j] >= this._consumedChars) {
        firstFresh = j;
        break;
      }
    }

    // ---- Schritt 1: Anschluss. Ausrichtung auf die Positionen lo … c. attached[j] = das zuletzt gefärbte
    // Wort wurde direkt vor Wort j getroffen (kein unerklärtes Wort dazwischen).
    const attached = new Uint8Array(m + 1);
    if (c > 0) {
      const wa = c - lo + 1;
      const A = new Float64Array((m + 1) * wa).fill(NEG);
      const viaMatch = new Uint8Array((m + 1) * wa);
      const set = (cell, value, isMatch) => {
        if (value > A[cell]) {
          A[cell] = value;
          viaMatch[cell] = isMatch ? 1 : 0;
        }
      };
      for (let j = 0; j <= m; j++) {
        const row = j * wa;
        for (let x = 0; x < wa; x++) set(row + x, 0, false); // Ausrichtung darf hier beginnen
        for (let x = 0; x + 1 < wa; x++) set(row + x + 1, A[row + x] - info[lo + x].del, false);
        attached[j] = viaMatch[row + wa - 1];
        if (j === m) break;
        for (let x = 0; x < wa; x++) {
          const h = A[row + x];
          set(row + wa + x, h - insCost[j], false);
          if (x + 1 < wa && info[lo + x].keys.length && canSub[j]) set(row + wa + x + 1, h - o.subCost, false);
          this._matches(j, lo + x, m, c, S, (j2, i2, pts) => set(j2 * wa + (i2 - lo), h + pts, true));
        }
      }
    }

    // ---- Schritt 2: neuer Beleg hinter c. Drei Ebenen: 0 = frei, 1 = sauber angeschlossen (nur Treffer seit
    // dem Anschluss), 2 = angeschlossen, aber mit ausgelassenem oder falsch erkanntem Wort dazwischen.
    // Jede Zeile darf an der aktuellen Position mit 0 beginnen (frühere Wörter zählen hier nicht mit);
    // direkt nach einem Anschluss-Treffer beginnt sie in der Ebene "sauber angeschlossen".
    const width = hi - c + 1;
    const layer = (m + 1) * width;
    const G = new Float64Array(3 * layer).fill(NEG);
    const from = new Int32Array(3 * layer).fill(-1);
    const op = new Uint8Array(3 * layer);
    const cellOf = (L, j, i) => L * layer + j * width + (i - c);
    const relax = (cell, value, prev, how) => {
      if (value > G[cell]) {
        G[cell] = value;
        from[cell] = prev;
        op[cell] = how;
      }
    };

    for (let j = 0; j <= m; j++) {
      relax(cellOf(0, j, c), 0, -1, OP_START);
      if (attached[j]) relax(cellOf(1, j, c), 0, -1, OP_START);
      // Ebenen 1 und 2: einzelne Textwörter auslassen bleibt "angeschlossen", aber mit Lücke (Ebene 2).
      const row1 = cellOf(1, j, c);
      const row2 = cellOf(2, j, c);
      for (let i = c; i < hi; i++) {
        const c1 = row1 + (i - c);
        const c2 = row2 + (i - c);
        if (G[c1] > NEG / 2) relax(c2 + 1, G[c1] - info[i].del, c1, OP_SKIP);
        if (G[c2] > NEG / 2) relax(c2 + 1, G[c2] - info[i].del, c2, OP_SKIP);
      }
      // Ebene 0: auslassen und Sprünge (ein Sprung beendet den Anschluss).
      const row0 = cellOf(0, j, c);
      let best = NEG;
      let bestCell = -1;
      for (let i = c; i <= hi; i++) {
        const cell = row0 + (i - c);
        if (i - o.jumpMin >= c) {
          const off = i - o.jumpMin - c;
          if (G[row0 + off] > best) {
            best = G[row0 + off];
            bestCell = row0 + off;
          }
          for (const r of [row1, row2]) {
            if (G[r + off] > best) {
              best = G[r + off];
              bestCell = r + off;
            }
          }
          relax(cell, best - this.jumpTo[i], bestCell, OP_SKIP);
        }
        if (i < hi && G[cell] > NEG / 2) relax(cell + 1, G[cell] - info[i].del, cell, OP_SKIP);
      }
      if (j === m) break;
      const fresh = j >= firstFresh;
      for (let L = 0; L < 3; L++) {
        const gapLayer = L === 0 ? 0 : 2; // Lücke im Anschluss: weiter in Ebene 2
        for (let i = c; i <= hi; i++) {
          const cell = cellOf(L, j, i);
          const g = G[cell];
          if (g <= NEG / 2) continue;
          relax(cellOf(L === 1 && i > c ? 2 : L, j + 1, i), g - insCost[j], cell, OP_EXTRA);
          if (!fresh || i >= hi || !info[i].keys.length) continue;
          // Fehlerkennung: Textwort i wurde als ein (bei schwierigen Wörtern: bis zu drei) andere(s) Wort(e) erkannt.
          if (canSub[j]) {
            relax(cellOf(gapLayer, j + 1, i + 1), g - o.subCost, cell, OP_SKIP);
            if (info[i].hard) {
              for (let k = 2; k <= 3 && j + k <= m; k++) {
                relax(cellOf(gapLayer, j + k, i + 1), g - o.subCost - o.subCostPerExtra * (k - 1), cell, OP_SKIP);
              }
            }
          }
          this._matches(j, i, m, hi, S, (j2, i2, pts) => relax(cellOf(L, j2, i2), g + pts, cell, OP_MATCH));
          if (i > c && m - j <= o.maxMergeSpeech) {
            const q = this._prefixQuality(i, S.keys[j][m - j], S.ids[j][m - j]);
            if (q > 0) relax(cellOf(L, m, i), g + o.prefixBonus * q, cell, OP_PREFIX);
          }
        }
      }
    }

    // ---- Entscheidung: die Position mit dem größten Überschuss an Beleg (falls es einen gibt).
    const shortStart = c === 0 && this._commits === 0 && this._firstSpoken <= o.shortFirstSentence;
    let bestCell = -1;
    let bestMargin = 0;
    let bestPos = c;
    for (let L = 0; L < 3; L++) {
      for (let i = c + 1; i <= hi; i++) {
        const cell = cellOf(L, m, i);
        if (G[cell] <= NEG / 2) continue;
        // Am Ende einer Äußerung genügt bei sauberem Anschluss wenig Beleg (letztes Wort im Satz). Mit Lücke
        // gilt die niedrigere Schwelle nur, wenn damit der Abschnitt fertig wird – sonst bringt der nächste Satz Beleg.
        const closing = isFinal && nextWordIndex(this.tokens, i) >= n;
        const clean = isFinal ? o.minGainAttachedFinal : o.minGainAttached;
        const gap = closing ? o.minGainGapFinal : o.minGainGap;
        let base = L === 1 ? clean : L === 2 ? gap : o.minGain;
        // Sehr kurzer erster Satz (Abschnitt "Fragen?"): wie mit Anschluss, die Vortragende beginnt oben.
        if (L === 0 && shortStart && i <= this._firstEnd) base = clean;
        const advance = i - c;
        // Weite Sprünge brauchen mehr Beleg. Angeschlossene Pfade springen nie, jedes ausgelassene Wort kostet dort einzeln.
        const needed = base + (L === 0 && advance > 3 ? o.gainPerDoubling * Math.log2(advance / 3) : 0);
        const margin = G[cell] - needed;
        if (margin >= 0 && (bestCell < 0 || margin > bestMargin + 1e-9 || (Math.abs(margin - bestMargin) <= 1e-9 && i > bestPos))) {
          bestCell = cell;
          bestMargin = margin;
          bestPos = i;
        }
      }
    }
    this.lastDebug = { words, position: c, candidate: bestPos, margin: bestMargin, committed: false };
    if (bestCell < 0) return;

    // Letzten Treffer auf dem Pfad suchen: der erkannte Text bis dorthin gilt als verbraucht.
    let lastMatchRow = -1;
    for (let cell = bestCell; cell >= 0; cell = from[cell]) {
      if (op[cell] === OP_MATCH) {
        lastMatchRow = Math.floor((cell % layer) / width);
        break;
      }
    }
    // Folgen bis zum Abschnittsende nur noch auslassbare Tokens ("Uhr.", "[Folie 3]"), gleich mitfärben.
    this._position = nextWordIndex(this.tokens, bestPos) >= n ? n : bestPos;
    this._commits++;
    if (lastMatchRow >= 0) this._consumedChars = Math.max(this._consumedChars, starts[lastMatchRow]);
    this.lastDebug.committed = true;
    this.lastDebug.attached = bestCell >= layer;
    this.lastDebug.gap = bestCell >= 2 * layer;
  }
}
