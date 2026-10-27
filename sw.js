/* Mitleser – Service Worker: macht die App offline startfähig.
 *
 * Beim Installieren werden alle App-Dateien (PRECACHE) in den Cache 'mitleser-app-<VERSION>' geladen.
 * Danach kommen sie immer aus diesem Cache – auch im Flugmodus und beim Start vom Home-Bildschirm.
 *
 * NEUE VERSION VERÖFFENTLICHEN: VERSION hier UND APP_VERSION in js/app.js erhöhen (tests/release.test.js prüft,
 * dass beide gleich sind). Dann lädt der Browser alle Dateien neu und löscht den alten App-Cache.
 *
 * Das Sprachmodell (models/…) gehört NICHT hierher: js/speech.js speichert es selbst im Cache
 * 'mitleser-modell-v1'. Dieser Service Worker lässt Anfragen nach models/ unberührt und löscht diesen Cache nie.
 * Alle Pfade sind relativ (GitHub Pages: https://NAME.github.io/mitleser/).
 */
'use strict';

const VERSION = '1.0.0';
const CACHE_PREFIX = 'mitleser-app-';
const CACHE = CACHE_PREFIX + VERSION;

// Jede Datei, die die App braucht – genau diese Liste wird vorab gespeichert.
const PRECACHE = [
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

// Ordner, um die sich der Service Worker nicht kümmert (Anfragen gehen direkt ins Netz).
const BYPASS = ['models/', 'tests/', 'tools/'].map((dir) => new URL(dir, self.location).pathname);
const INDEX_URL = new URL('index.html', self.location).href;
const ROOT_URL = new URL('./', self.location).href;

// Auf dem eigenen Rechner (lokaler Testserver) zuerst das Netz fragen, damit Änderungen an den Dateien sofort
// sichtbar sind; nur ohne Server/Netz kommt der Cache. Im Internet (GitHub Pages) gilt immer: Cache zuerst.
const DEV_MODE = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

const isBypassed = (pathname) => BYPASS.some((path) => pathname.startsWith(path));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' umgeht den HTTP-Cache des Browsers, damit garantiert die neuen Dateien kommen.
      await cache.addAll(PRECACHE.map((path) => new Request(new URL(path, self.location), { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Nur alte App-Caches löschen – der Modell-Cache ('mitleser-modell-v1') bleibt unangetastet.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url.pathname)) return; // Sprachmodell, Tests, Werkzeuge: direkt ins Netz
  event.respondWith(respond(event));
});

async function respond(event) {
  const request = event.request;
  // Die Testseite (tests/index.html) soll immer die aktuellen Dateien prüfen, nie die gespeicherten.
  if (await fromTestPage(event)) return fetch(request);
  if (DEV_MODE) {
    try {
      return await fetch(request);
    } catch (error) {
      const cached = await fromCache(request);
      if (cached) return cached;
      throw error;
    }
  }
  return (await fromCache(request)) || fetch(request);
}

/**
 * Passende Datei aus dem Cache (oder undefined).
 * Seitenaufrufe bekommen immer die gespeicherte index.html (die App hat nur eine Seite);
 * bei anderen Dateien wird ein ?…-Zusatz in der Adresse ignoriert.
 */
async function fromCache(request) {
  const cache = await caches.open(CACHE);
  if (request.mode === 'navigate') {
    return (await cache.match(INDEX_URL, { ignoreVary: true })) || (await cache.match(ROOT_URL, { ignoreVary: true }));
  }
  return cache.match(request, { ignoreSearch: true, ignoreVary: true });
}

/** Kommt die Anfrage von einer Seite im Ordner tests/? */
async function fromTestPage(event) {
  if (!event.clientId) return false;
  try {
    const client = await self.clients.get(event.clientId);
    return !!client && isBypassed(new URL(client.url).pathname);
  } catch (error) {
    return false;
  }
}
