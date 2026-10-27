// Mitleser – Blättern zwischen den Abschnitten (reine Logik, ohne Bildschirm/DOM, deshalb gut testbar)
//
// Merkt sich, welcher Abschnitt gerade gezeigt wird und wie viele Tokens darin schon eingefärbt sind.
//   const nav = new Navigation(12, 0);   // 12 Abschnitte, Start bei Abschnitt 1 (Index 0)
//   nav.next()          -> 'next' (nächster Abschnitt, ungefärbt) oder 'none' (schon beim letzten)
//   nav.back()          -> 'reset' (Färbung im Abschnitt löschen), 'prev' (vorheriger Abschnitt) oder 'none'
//   nav.setColored(n)   -> true, wenn die Färbung gewachsen ist (sie wächst nur; zurück geht es nur mit back())

/** Macht aus einer beliebigen Eingabe eine ganze Zahl >= 0 (ungültig -> 0). */
function toCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export class Navigation {
  /**
   * @param {number} sectionCount Anzahl der Abschnitte (0 ist erlaubt: dann passiert beim Blättern nichts)
   * @param {number} startIndex   Startabschnitt (wird in den gültigen Bereich geschoben)
   */
  constructor(sectionCount, startIndex = 0) {
    this._count = toCount(sectionCount);
    const last = Math.max(0, this._count - 1);
    const start = Math.floor(Number(startIndex));
    this._index = Number.isFinite(start) ? Math.min(Math.max(start, 0), last) : 0;
    this._colored = 0;
  }

  /** Aktueller Abschnitt (0 = erster). */
  get index() {
    return this._index;
  }

  /** Anzahl der Abschnitte. */
  get count() {
    return this._count;
  }

  /** Anzahl der eingefärbten Tokens im aktuellen Abschnitt. */
  get colored() {
    return this._colored;
  }

  get isFirst() {
    return this._index === 0;
  }

  get isLast() {
    return this._index >= this._count - 1;
  }

  /** Weiter: nächster Abschnitt (ungefärbt). Beim letzten Abschnitt passiert nichts. */
  next() {
    if (this._index >= this._count - 1) return 'none';
    this._index += 1;
    this._colored = 0;
    return 'next';
  }

  /**
   * Zurück: Ist im Abschnitt schon etwas eingefärbt, wird nur die Färbung gelöscht ('reset').
   * Sonst geht es zum vorherigen Abschnitt ('prev'). Beim ersten, ungefärbten Abschnitt passiert nichts.
   */
  back() {
    if (this._colored > 0) {
      this._colored = 0;
      return 'reset';
    }
    if (this._index > 0) {
      this._index -= 1;
      return 'prev';
    }
    return 'none';
  }

  /** Neue Färbung melden. Nur Fortschritt zählt: kleinere oder gleiche Werte werden ignoriert. */
  setColored(n) {
    const value = Math.floor(Number(n));
    if (this._count === 0 || !Number.isFinite(value) || value <= this._colored) return false;
    this._colored = value;
    return true;
  }
}
