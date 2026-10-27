// Kleines Test-Gerüst, das sowohl mit Node (`npm test`) als auch im Browser (tests/index.html) läuft.
// Keine Abhängigkeiten – damit die Tests ohne Installation und ohne Build-Schritt funktionieren.

const registry = [];
let currentFile = '';

export const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

export function setFile(name) {
  currentFile = name;
}

export function test(name, fn) {
  registry.push({ file: currentFile, name, fn });
}

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

function fmt(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function fail(message, detail) {
  throw new AssertionError(message ? `${message}: ${detail}` : detail);
}

export const assert = {
  ok(value, message) {
    if (!value) fail(message, `erwartet wahr, war ${fmt(value)}`);
  },
  equal(actual, expected, message) {
    if (actual !== expected) fail(message, `erwartet ${fmt(expected)}, war ${fmt(actual)}`);
  },
  notEqual(actual, unexpected, message) {
    if (actual === unexpected) fail(message, `erwartet etwas anderes als ${fmt(unexpected)}`);
  },
  deepEqual(actual, expected, message) {
    if (!deepEqual(actual, expected)) fail(message, `erwartet ${fmt(expected)}, war ${fmt(actual)}`);
  },
  atLeast(actual, min, message) {
    if (!(actual >= min)) fail(message, `erwartet mindestens ${min}, war ${fmt(actual)}`);
  },
  atMost(actual, max, message) {
    if (!(actual <= max)) fail(message, `erwartet höchstens ${max}, war ${fmt(actual)}`);
  },
  includes(haystack, needle, message) {
    if (!haystack || !haystack.includes(needle)) fail(message, `${fmt(haystack)} enthält nicht ${fmt(needle)}`);
  },
  throws(fn, message) {
    try {
      fn();
    } catch (e) {
      return e;
    }
    fail(message, 'erwartet eine Ausnahme');
  },
};

/** Liest eine Datei relativ zum Ordner tests/ (Node: Dateisystem, Browser: fetch). */
export async function loadText(relPath) {
  const url = new URL(relPath, import.meta.url);
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    return readFile(fileURLToPath(url), 'utf8');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status}`);
  return res.text();
}

export async function loadJSON(relPath) {
  return JSON.parse(await loadText(relPath));
}

/** Lädt ein klassisches Skript (z. B. für den Worker) und gibt das globale Objekt `globalName` zurück. */
export async function loadClassicScript(relPath, globalName) {
  if (isNode) {
    const vm = await import('node:vm');
    const source = await loadText(relPath);
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: relPath });
    return sandbox[globalName];
  }
  if (!window[globalName]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(relPath, import.meta.url).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${relPath} konnte nicht geladen werden`));
      document.head.appendChild(script);
    });
  }
  return window[globalName];
}

/** Führt alle registrierten Tests aus. `onResult` wird nach jedem Test aufgerufen. */
export async function run(onResult = () => {}) {
  const results = [];
  for (const t of registry) {
    const started = Date.now();
    let error = null;
    try {
      await t.fn();
    } catch (e) {
      error = e;
    }
    const result = { file: t.file, name: t.name, ok: !error, error, ms: Date.now() - started };
    results.push(result);
    onResult(result);
  }
  return {
    results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
