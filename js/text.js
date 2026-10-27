// Mitleser – Vortragstext in Abschnitte und Tokens zerlegen
//
// Abschnitte: Normalerweise trennt eine Leerzeile. Sobald irgendwo eine Zeile steht, die nur aus "---"
// besteht, trennen ausschließlich diese Zeilen – dann dürfen Abschnitte auch Leerzeilen (Absätze) enthalten.
// Weil iPad und Textprogramme "---" gern automatisch in einen Gedankenstrich verwandeln, zählen auch Zeilen
// wie "—", "—-", "–––", "***" oder "___" als Trennzeile.
//
// Token: ein Wort so, wie es angezeigt wird, inklusive anhängender Satzzeichen ("Lager," / "281." / "z.").
//   { text, brk, isWord, forms, cue, aside, optional }
//   brk      Umbruch vor dem Token: 0 = Leerzeichen, 1 = neue Zeile, 2 = neuer Absatz
//   isWord   enthält Buchstaben oder Ziffern (zählt als Wort)
//   forms    Sprechformen für den Abgleich (siehe normalize.js); leer = wird nicht gesprochen (z. B. "–")
//   cue      Regieanweisung in eckigen Klammern ("[Folie 12]") – wird nicht vorgelesen
//   aside    steht in runden Klammern – wird beim Vortrag oft weggelassen
//   optional darf ausgelassen werden, ohne dass es auffällt (Aufzählungsnummer am Zeilenanfang,
//            "Uhr" nach einer Uhrzeit, "€" nach einem Betrag)

import { spokenForms, numberToWords } from './normalize.js';

const SEPARATOR = /^\s*(?:(?:[-‐‑‒–—―−]\s*){3,}|[—―]\s*[-‐‑‒–—―−]?|(?:[*_=]\s*){3,})\s*$/;
const WORDLIKE = /[\p{L}\p{N}]/u;
const BLANK = /^[\s\u200B-\u200D\u2060\uFEFF]*$/;
// Leerraum, an dem getrennt wird – nicht an geschützten Leerzeichen (fest, schmal, dünn), z. B. "20 000".
const SPLIT = /[ \t\u1680\u2000-\u2008\u200A\u205F\u3000]+/;
const LIST_MARKER = /^(?:\d{1,2}[.)]|[a-zA-Z][.)]|[IVXivx]{1,4}[.)]|[•◦▪▫‣·*+-]|[–—])$/;
const TIME = /^\d{1,2}[:.]\d{2}$/;
const CURRENCY = /^(?:€|EUR|Euro|\$|USD|Dollar|CHF|Franken)[.,;:!?]?$/;
const NUMBER = /^[+\-−–±]?\d[\d.,'’\u00A0\u202F\u2009]*$/;

function normalizeNewlines(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\u2029/g, '\n\n').replace(/\u2028/g, '\n');
}

function isBlank(line) {
  return BLANK.test(line);
}

/** Teilt den Vortragstext in Abschnitte (Array von Strings, ohne leere Abschnitte). */
export function splitSections(text) {
  const lines = normalizeNewlines(text).split('\n');
  const useSeparator = lines.some((line) => SEPARATOR.test(line));
  const sections = [];
  let current = [];
  const flush = () => {
    while (current.length && isBlank(current[0])) current.shift();
    while (current.length && isBlank(current[current.length - 1])) current.pop();
    if (current.length) sections.push(current.join('\n'));
    current = [];
  };
  for (const line of lines) {
    const isBreak = useSeparator ? SEPARATOR.test(line) : isBlank(line);
    if (isBreak) flush();
    else current.push(line.replace(/\s+$/, ''));
  }
  flush();
  return sections;
}

function makeToken(text, brk, withForms) {
  return {
    text,
    brk,
    isWord: WORDLIKE.test(text),
    forms: withForms ? spokenForms(text) : [],
    cue: false,
    aside: false,
    optional: false,
  };
}

/** Kennzeichnet Regieanweisungen, Einschübe und auslassbare Tokens (siehe oben). */
function markStructure(tokens) {
  let square = 0;
  let round = 0;
  for (const t of tokens) {
    const opens = (t.text.match(/\[/g) || []).length;
    const closes = (t.text.match(/\]/g) || []).length;
    const ropen = (t.text.match(/\(/g) || []).length;
    const rclose = (t.text.match(/\)/g) || []).length;
    if (square > 0 || opens > 0) t.cue = true;
    if (round > 0 || ropen > 0) t.aside = true;
    square = Math.max(0, square + opens - closes);
    round = Math.max(0, round + ropen - rclose);
    if (t.cue) t.forms = [];
  }
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    // Aufzählungszeichen und -nummern am Zeilenanfang ("1.", "a)", "•") werden oft nicht vorgelesen.
    if ((i === 0 || t.brk > 0) && LIST_MARKER.test(t.text) && tokens[i + 1] && tokens[i + 1].brk === 0) t.optional = true;
    if (!prev) return;
    // "10:30 Uhr" wird auch "halb elf" gesprochen; "3,50 €" auch "drei Euro fünfzig".
    if (/^Uhr\b/i.test(t.text) && (TIME.test(prev.text) || NUMBER.test(prev.text))) t.optional = true;
    if (CURRENCY.test(t.text) && NUMBER.test(prev.text)) {
      t.optional = true;
      const cents = /^(\d+),(\d{2})$/.exec(prev.text.replace(/[.,;:!?]$/, ''));
      if (cents) {
        const euro = Number(cents[1]) === 1 ? 'ein' : numberToWords(Number(cents[1]));
        const unit = t.forms[0] || 'euro';
        prev.forms = [...new Set([...prev.forms, euro + unit + numberToWords(Number(cents[2]))])];
      }
    }
  });
  return tokens;
}

/** Zerlegt einen Abschnitt in Tokens. */
export function tokenize(sectionText, { withForms = true } = {}) {
  const tokens = [];
  let pendingBreak = 0;
  for (const line of normalizeNewlines(sectionText).split('\n')) {
    if (isBlank(line)) {
      if (tokens.length) pendingBreak = 2;
      continue;
    }
    const parts = line.trim().split(SPLIT).filter((p) => p && !isBlank(p));
    parts.forEach((part, k) => {
      const brk = tokens.length === 0 || k > 0 ? 0 : pendingBreak;
      tokens.push(makeToken(part, brk, withForms));
    });
    pendingBreak = 1;
  }
  return withForms ? markStructure(tokens) : tokens;
}

/**
 * Zerlegt den ganzen Vortrag.
 * @returns {{sections: {index:number, text:string, tokens:object[], wordCount:number}[], wordCount:number}}
 */
export function parseScript(text) {
  const sections = splitSections(text).map((sectionText, index) => {
    const tokens = tokenize(sectionText);
    return { index, text: sectionText, tokens, wordCount: tokens.filter((t) => t.isWord).length };
  });
  return { sections, wordCount: sections.reduce((sum, s) => sum + s.wordCount, 0) };
}

/** Schnelle Zählung für die Anzeige in der Vorbereitung (ohne Sprechformen). */
export function countScript(text) {
  const sections = splitSections(text);
  let words = 0;
  for (const s of sections) {
    for (const line of s.split('\n')) for (const part of line.split(SPLIT)) if (WORDLIKE.test(part)) words++;
  }
  return { sections: sections.length, words };
}

/** Index des ersten gesprochenen Wortes ab Position `from` (oder tokens.length, wenn keins mehr kommt). */
export function nextWordIndex(tokens, from) {
  for (let i = Math.max(0, from); i < tokens.length; i++) if (tokens[i].forms.length && !tokens[i].optional) return i;
  return tokens.length;
}
