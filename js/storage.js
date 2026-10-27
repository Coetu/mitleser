// Mitleser – Speichern auf dem Gerät (localStorage) und Hilfen für Textdateien
//
// Alles bleibt im Browser des iPads, nichts wird verschickt. Jede Funktion fängt Fehler ab (z. B. privater
// Modus, voller Speicher, gesperrter Speicher) und wirft nie eine Ausnahme.
// Für Tests kann als letztes Argument ein eigener Speicher übergeben werden: ein Objekt mit
// getItem/setItem/removeItem wie localStorage. Ohne Angabe wird window.localStorage benutzt (falls vorhanden),
// mit `null` wird gar nichts gespeichert.

export const KEYS = Object.freeze({
  text: 'mitleser.text',
  settings: 'mitleser.settings',
  resume: 'mitleser.resume',
});

export const FONT_SIZE_MIN = 24;
export const FONT_SIZE_MAX = 120;

export const DEFAULT_SETTINGS = Object.freeze({
  fontSize: 48,
  recognition: true,
  autoAdvance: false,
});

/** Dateiname beim Exportieren. */
export const EXPORT_FILE_NAME = 'Vortrag.txt';

// ---------------------------------------------------------------------------------------------------------
// Zugriff auf den Speicher (immer mit try/catch)

function resolveStore(store) {
  if (store !== undefined) return store;
  try {
    // Schon der Zugriff auf window.localStorage kann in manchen Browsern eine Ausnahme auslösen.
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (e) {
    return null;
  }
}

function read(key, store) {
  const s = resolveStore(store);
  if (!s) return null;
  try {
    const value = s.getItem(key);
    return typeof value === 'string' ? value : null;
  } catch (e) {
    return null;
  }
}

function write(key, value, store) {
  const s = resolveStore(store);
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch (e) {
    return false; // z. B. Speicher voll (QuotaExceededError) oder privater Modus
  }
}

function remove(key, store) {
  const s = resolveStore(store);
  if (!s) return false;
  try {
    s.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

function readJSON(key, store) {
  const raw = read(key, store);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null; // kaputter Inhalt wird ignoriert
  }
}

// ---------------------------------------------------------------------------------------------------------
// Vortragstext

/** Gespeicherter Vortragstext ('' wenn keiner da ist). */
export function loadText(store) {
  const text = read(KEYS.text, store);
  return text === null ? '' : text;
}

/** Speichert den Vortragstext. Gibt zurück, ob es geklappt hat. */
export function saveText(text, store) {
  return write(KEYS.text, text == null ? '' : String(text), store);
}

// ---------------------------------------------------------------------------------------------------------
// Einstellungen

/** Schriftgröße in den erlaubten Bereich bringen (24–120 px, ganze Zahl; Unsinn -> Standard 48). */
export function clampFontSize(value) {
  let n = NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));
}

/** Prüft Einstellungen und ergänzt fehlende oder ungültige Werte mit den Standardwerten. */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    fontSize: clampFontSize(s.fontSize),
    recognition: typeof s.recognition === 'boolean' ? s.recognition : DEFAULT_SETTINGS.recognition,
    autoAdvance: typeof s.autoAdvance === 'boolean' ? s.autoAdvance : DEFAULT_SETTINGS.autoAdvance,
  };
}

/** Gespeicherte Einstellungen {fontSize, recognition, autoAdvance} – immer vollständig und gültig. */
export function loadSettings(store) {
  return normalizeSettings(readJSON(KEYS.settings, store));
}

/** Speichert die Einstellungen (vorher geprüft). Gibt zurück, ob es geklappt hat. */
export function saveSettings(settings, store) {
  return write(KEYS.settings, JSON.stringify(normalizeSettings(settings)), store);
}

// ---------------------------------------------------------------------------------------------------------
// Fortsetzen-Punkt (zuletzt gezeigter Abschnitt)

/** Gespeicherter Abschnitt-Index (ganze Zahl >= 0) oder null. */
export function loadResume(store) {
  const value = readJSON(KEYS.resume, store);
  const index = value && typeof value === 'object' ? value.index : undefined;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Merkt sich den Abschnitt-Index. Ungültige Werte werden nicht gespeichert (Rückgabe false). */
export function saveResume(index, store) {
  if (!Number.isInteger(index) || index < 0) return false;
  return write(KEYS.resume, JSON.stringify({ index }), store);
}

/** Vergisst den Fortsetzen-Punkt. */
export function clearResume(store) {
  return remove(KEYS.resume, store);
}

// ---------------------------------------------------------------------------------------------------------
// Textdateien importieren

function decodeWith(label, bytes, fatal = false) {
  return new TextDecoder(label, { fatal }).decode(bytes);
}

/**
 * Wandelt den Inhalt einer Textdatei (ArrayBuffer oder Uint8Array) in Text um.
 * Reihenfolge: UTF-16 mit Kennung (Windows-Editor „Unicode“), dann UTF-8 (Kennung/BOM wird entfernt),
 * und wenn das nicht passt, Windows-1252 (alte Windows-„ANSI“-Dateien mit ä, ö, ü, ß).
 * Zeilenenden werden zu "\n" vereinheitlicht.
 */
export function decodeTextFile(data) {
  let bytes;
  try {
    bytes = data instanceof Uint8Array ? data : new Uint8Array(data || 0);
  } catch (e) {
    return '';
  }
  let text = null;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) text = decodeWith('utf-16le', bytes);
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) text = decodeWith('utf-16be', bytes);
  } catch (e) {
    text = null;
  }
  if (text === null) {
    try {
      text = decodeWith('utf-8', bytes, true);
    } catch (e) {
      text = null; // kein gültiges UTF-8
    }
  }
  if (text === null) {
    try {
      text = decodeWith('windows-1252', bytes);
    } catch (e) {
      // Notlösung, falls der Browser Windows-1252 nicht kennt: Byte = Zeichen (ISO-8859-1)
      text = '';
      for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    }
  }
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
