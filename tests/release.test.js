// Tests: Veröffentlichung – passen Versionsnummern, Offline-Liste (sw.js), Manifest und Startseite zusammen?
// Die Dateien werden als Text gelesen und geprüft (kein Browser nötig).
import { test, assert, loadText, loadJSON } from './harness.js';

// Diese Dateien braucht die App mindestens offline (siehe Bauplan).
const REQUIRED = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/navigation.js',
  'js/storage.js',
  'js/wakelock.js',
  'js/text.js',
  'js/normalize.js',
  'js/matcher.js',
  'js/speech.js',
  'js/audio-worklet.js',
  'js/resampler.js',
  'js/asr-worker.js',
  'lib/vosk-wasm.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Elemente, auf die js/app.js angewiesen ist
const REQUIRED_IDS = [
  'viewPrep', 'viewPresent', 'script', 'counts', 'saveState', 'btnImport', 'fileImport', 'btnExport', 'exportNotice',
  'fontSize', 'fontSizeValue', 'fontPreview', 'optRecognition', 'optAutoAdvance', 'asrStatus', 'asrStatusText', 'asrPercent',
  'asrProgress', 'asrHint', 'btnRetry', 'btnMicTest', 'micTestPanel', 'micTestLevel', 'micTestOut', 'btnStart',
  'btnResume', 'startMessage', 'installTip', 'wakeTip', 'offlineState', 'offlineText', 'updateNotice', 'btnReload',
  'appVersion', 'btnBack', 'counter', 'micStatus', 'micStatusText', 'text', 'textInner', 'hintOverlay',
  'hintMic', 'toast',
];

const cache = new Map();
/** Liest eine Datei relativ zum Projektordner (einmal, danach aus dem Zwischenspeicher). */
function read(path) {
  if (!cache.has(path)) cache.set(path, loadText('../' + path));
  return cache.get(path);
}

async function precacheList() {
  const sw = await read('sw.js');
  const match = sw.match(/const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'PRECACHE-Liste in sw.js nicht gefunden');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Löst eine relative Adresse auf, als stünde sie in der Datei `from` (Ergebnis relativ zum Projektordner). */
function resolvePath(from, ref) {
  const url = new URL(ref, 'https://mitleser.invalid/' + from);
  return decodeURIComponent(url.pathname.slice(1));
}

/** Alle Dateien, die ein Skript selbst nachlädt (import, new URL(…, import.meta.url), importScripts, …). */
function referencedFiles(path, source) {
  const refs = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
    /new\s+(?:Shared)?Worker\(\s*['"]([^'"]+)['"]/g,
    /\.addModule\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const m of source.matchAll(pattern)) refs.push(m[1]);
  }
  for (const m of source.matchAll(/importScripts\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) refs.push(s[1]);
  }
  return refs.map((ref) => resolvePath(path, ref));
}

// ---------------------------------------------------------------------------------------------------------

test('Versionsnummer: APP_VERSION in js/app.js ist gleich VERSION in sw.js', async () => {
  const app = await read('js/app.js');
  const sw = await read('sw.js');
  const appVersion = (app.match(/const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const swVersion = (sw.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  assert.ok(appVersion, 'APP_VERSION in js/app.js nicht gefunden');
  assert.ok(swVersion, 'VERSION in sw.js nicht gefunden');
  assert.equal(appVersion, swVersion, 'Bitte beide Versionsnummern gleich setzen');
  assert.ok(/^\d+\.\d+\.\d+$/.test(swVersion), `Version im Format 1.2.3 erwartet, war ${swVersion}`);
});

test('Service Worker: Cache-Name aus „mitleser-app-“ und Version, Modell-Cache wird nie gelöscht', async () => {
  const sw = await read('sw.js');
  const direct = /const\s+CACHE\s*=\s*['"]mitleser-app-['"]\s*\+\s*VERSION/.test(sw);
  const viaPrefix =
    /const\s+CACHE_PREFIX\s*=\s*['"]mitleser-app-['"]/.test(sw) && /const\s+CACHE\s*=\s*CACHE_PREFIX\s*\+\s*VERSION/.test(sw);
  assert.ok(direct || viaPrefix, "CACHE = 'mitleser-app-' + VERSION erwartet");
  assert.ok(/startsWith\(\s*(?:CACHE_PREFIX|['"]mitleser-app-['"])\s*\)/.test(sw), 'nur alte mitleser-app-Caches löschen');
  assert.ok(!/mitleser-modell[^'"]*['"]\s*\)/.test(sw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'sw.js darf den Modell-Cache nicht anfassen');
  assert.includes(sw, "cache: 'reload'", 'Vorab-Laden ohne HTTP-Cache');
  assert.includes(sw, 'skipWaiting', 'neue Version sofort aktivieren');
  assert.includes(sw, 'clients.claim', 'offene Seiten übernehmen');
  assert.includes(sw, "'models/'", 'Anfragen nach models/ dürfen nicht abgefangen werden');
});

test('Offline-Liste: enthält alle App-Dateien, keine doppelt', async () => {
  const list = await precacheList();
  for (const file of REQUIRED) assert.includes(list, file, 'fehlt in PRECACHE (sw.js)');
  assert.equal(new Set(list).size, list.length, 'doppelte Einträge in PRECACHE');
});

test('Offline-Liste: nur relative Pfade, kein Sprachmodell, keine Tests oder Werkzeuge', async () => {
  for (const entry of await precacheList()) {
    assert.ok(!entry.startsWith('/'), `${entry}: Pfad muss relativ sein (GitHub-Pages-Projektseite)`);
    assert.ok(!/^[a-z]+:/i.test(entry), `${entry}: keine externen Adressen`);
    assert.ok(!/^(\.\/)?(models|tests|tools)\//.test(entry), `${entry}: gehört nicht in den App-Cache`);
  }
});

test('Offline-Liste: jede Datei existiert', async () => {
  for (const entry of await precacheList()) {
    const path = entry === './' ? 'index.html' : entry;
    let ok = true;
    try {
      await read(path);
    } catch (error) {
      ok = false;
    }
    assert.ok(ok, `${path} fehlt – sonst schlägt die Installation des Service Workers fehl`);
  }
});

test('Offline-Liste: alles, was die App-Skripte nachladen, ist enthalten (außer dem Sprachmodell)', async () => {
  const list = new Set(await precacheList());
  for (const entry of list) {
    if (!entry.endsWith('.js') || entry.startsWith('lib/')) continue; // lib/vosk-wasm.js: fremder, fertiger Code
    const source = await read(entry);
    for (const file of referencedFiles(entry, source)) {
      if (file.startsWith('models/')) continue; // das Modell speichert speech.js selbst
      assert.ok(list.has(file), `${entry} lädt ${file}, das fehlt in PRECACHE (sw.js)`);
    }
  }
});

test('Startseite: alle Dateien, auf die index.html verweist, sind relativ und offline verfügbar', async () => {
  const html = await read('index.html');
  const list = new Set(await precacheList());
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.atLeast(refs.length, 4, 'Verweise in index.html');
  for (const ref of refs) {
    assert.ok(!ref.startsWith('/'), `${ref}: Pfad muss relativ sein`);
    assert.ok(!/^[a-z]+:/i.test(ref), `${ref}: keine externen Quellen (offline!)`);
    assert.ok(list.has(resolvePath('index.html', ref)), `${ref} fehlt in PRECACHE (sw.js)`);
  }
});

test('Startseite: Kopfbereich für iPad und Home-Bildschirm', async () => {
  const html = await read('index.html');
  assert.ok(/<html[^>]*\blang="de"/.test(html), 'lang="de"');
  assert.ok(/<meta\s+charset="utf-8"/i.test(html), 'Zeichensatz');
  const viewport = (html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/) || [])[1] || '';
  for (const part of ['width=device-width', 'initial-scale=1', 'viewport-fit=cover']) assert.includes(viewport, part, 'viewport');
  assert.ok(/<meta\s+name="theme-color"\s+content="#000000"/.test(html), 'theme-color');
  assert.ok(/<link\s+rel="manifest"\s+href="manifest\.webmanifest"/.test(html), 'Manifest-Verweis');
  assert.ok(/<link\s+rel="apple-touch-icon"\s+href="icons\/apple-touch-icon\.png"/.test(html), 'apple-touch-icon');
  assert.ok(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/.test(html), 'apple-mobile-web-app-capable');
  assert.ok(/<meta\s+name="mobile-web-app-capable"\s+content="yes"/.test(html), 'mobile-web-app-capable');
  assert.ok(/<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/.test(html), 'Statusleiste');
  assert.ok(/<meta\s+name="apple-mobile-web-app-title"\s+content="Mitleser"/.test(html), 'Name auf dem Home-Bildschirm');
  assert.ok(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/.test(html), 'Hinweis ohne JavaScript');
  assert.ok(/<script\s+type="module"\s+src="js\/app\.js"><\/script>/.test(html), 'App als Modul laden');
});

test('Startseite: alle Elemente, die js/app.js braucht, sind vorhanden (und nur einmal)', async () => {
  const html = await read('index.html');
  for (const id of REQUIRED_IDS) {
    const count = html.split(`id="${id}"`).length - 1;
    assert.equal(count, 1, `id="${id}"`);
  }
  const app = await read('js/app.js');
  for (const m of app.matchAll(/\$\('([^']+)'\)/g)) assert.includes(REQUIRED_IDS, m[1], 'Liste REQUIRED_IDS ergänzen');
});

test('Manifest: Name, Sprache, Start, Anzeige, Farben und Symbole', async () => {
  const manifest = await loadJSON('../manifest.webmanifest');
  assert.equal(manifest.name, 'Mitleser');
  assert.equal(manifest.short_name, 'Mitleser');
  assert.equal(manifest.lang, 'de');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#000000');
  assert.equal(manifest.theme_color, '#000000');
  const icons = manifest.icons || [];
  const find = (sizes, purpose) => icons.find((i) => i.sizes === sizes && (i.purpose || 'any').split(' ').includes(purpose));
  assert.ok(find('192x192', 'any'), 'Symbol 192 px');
  assert.ok(find('512x512', 'any'), 'Symbol 512 px');
  assert.ok(find('512x512', 'maskable'), 'maskierbares Symbol 512 px');
  const list = new Set(await precacheList());
  for (const icon of icons) {
    assert.ok(!icon.src.startsWith('/'), `${icon.src}: Pfad muss relativ sein`);
    assert.equal(icon.type, 'image/png');
    assert.ok(list.has(icon.src), `${icon.src} fehlt in PRECACHE (sw.js)`);
  }
});

test('Symbole sind PNG-Dateien', async () => {
  for (const file of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
    const text = await read('icons/' + file);
    // Eine PNG-Datei beginnt mit den Bytes 89 50 4E 47 ("‰PNG"); als Text gelesen wird 89 zum Ersatzzeichen.
    assert.equal(text.slice(1, 4), 'PNG', file);
  }
});

test('Keine externen Quellen und keine absoluten Pfade in den App-Dateien', async () => {
  const list = await precacheList();
  const textFiles = list.filter((f) => /\.(js|css|html|webmanifest)$/.test(f) && !f.startsWith('lib/'));
  // Netzwerkzugriffe auf fremde Server (CDNs) würden offline scheitern und Daten nach außen schicken.
  const external = [
    /\b(?:src|href)\s*=\s*["']https?:/i,
    /url\(\s*["']?https?:/i,
    /@import\s+(?:url\()?["']?https?:/i,
    /\bfrom\s*["']https?:/,
    /\bimport\s*\(\s*["']https?:/,
    /\bfetch\(\s*["'`]https?:/,
    /importScripts\([^)]*["']https?:/,
    /new\s+(?:Shared)?Worker\(\s*["']https?:/,
  ];
  for (const file of textFiles) {
    const source = await read(file);
    for (const pattern of external) assert.ok(!pattern.test(source), `${file}: externe Quelle (${pattern})`);
  }
  // Absolute Pfade ("/…") gehen auf einer GitHub-Pages-Projektseite (…github.io/mitleser/) ins Leere.
  for (const file of ['index.html', 'css/app.css', 'js/app.js', 'sw.js']) {
    const source = await read(file);
    assert.ok(!/\b(?:src|href)\s*=\s*["']\/(?!\/)/.test(source), `${file}: absoluter Pfad in src/href`);
    assert.ok(!/url\(\s*["']?\/(?!\/)/.test(source), `${file}: absoluter Pfad in url()`);
  }
});

test('Service Worker wird mit relativem Pfad registriert', async () => {
  const app = await read('js/app.js');
  assert.ok(/serviceWorker\.register\(\s*['"](\.\/)?sw\.js['"]/.test(app), "navigator.serviceWorker.register('sw.js')");
});

test('Datei .nojekyll ist vorhanden (GitHub Pages)', async () => {
  let ok = true;
  try {
    await read('.nojekyll');
  } catch (error) {
    ok = false;
  }
  assert.ok(ok, '.nojekyll fehlt');
});
