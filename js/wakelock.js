// Mitleser – Bildschirm während der Präsentation anlassen
//
//   keepAwake(true)    Bildschirm bleibt an
//   keepAwake(false)   wieder normales Verhalten (Bildschirm darf sich abschalten)
//
// Benutzt die Screen Wake Lock API (Safari ab iPadOS 16.4). Safari gibt die Sperre selbst frei, sobald die App
// in den Hintergrund geht; beim Zurückkommen wird sie hier automatisch neu angefordert.
//
// Grenzen auf dem iPad:
// - In der Home-Bildschirm-App wirkt die API erst ab iPadOS 18.4. Davor gibt es navigator.wakeLock und
//   request() klappt scheinbar, der Bildschirm geht trotzdem aus. Erkennen lässt sich das nur an der
//   Version (isWebAppWakeLockBroken); die App zeigt dann einen Hinweis („Automatische Sperre › Nie“).
// - Ein stummes, endlos laufendes Video hält den Bildschirm bei aktuellem WebKit NICHT an, und Ton würde
//   sich mit dem Mikrofon stören. Deshalb ist bewusst kein Ersatzverfahren eingesteckt.
// setFallback() bleibt trotzdem, falls später ein Ersatz gebraucht wird. Keine Funktion wirft eine Ausnahme.

let wanted = false; // Soll der Bildschirm gerade wach bleiben?
let lock = null; // WakeLockSentinel der Wake-Lock-API (null = keine Sperre aktiv)
let pending = null; // laufende Anforderung (Promise)
let fallback = null; // eingestecktes Ersatzverfahren { start(), stop() }
let fallbackAlways = false; // Ersatz zusätzlich zur API benutzen?
let fallbackActive = false;
let listening = false;

function hasWakeLockApi() {
  try {
    return typeof navigator !== 'undefined' && !!navigator.wakeLock && typeof navigator.wakeLock.request === 'function';
  } catch (e) {
    return false;
  }
}

function isVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function safeRelease(sentinel) {
  try {
    const result = sentinel.release();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (e) {
    /* schon freigegeben */
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ersatzverfahren

function runFallbackStart() {
  try {
    const result = fallback.start();
    if (result && typeof result.then === 'function') {
      result.then(
        (ok) => {
          if (ok === false) fallbackActive = false;
        },
        () => {
          fallbackActive = false;
        },
      );
    }
  } catch (e) {
    fallbackActive = false;
  }
}

function startFallback() {
  if (!fallback || fallbackActive) return;
  fallbackActive = true;
  runFallbackStart();
}

function stopFallback() {
  if (!fallback || !fallbackActive) return;
  fallbackActive = false;
  try {
    fallback.stop();
  } catch (e) {
    /* egal */
  }
}

// ---------------------------------------------------------------------------------------------------------
// Wake-Lock-API

/** Fordert die Sperre an (falls nötig). Liefert ein Promise mit true, wenn die API-Sperre aktiv ist. */
function requestLock() {
  if (!wanted || !hasWakeLockApi() || !isVisible()) return Promise.resolve(!!lock);
  if (lock) return Promise.resolve(true);
  if (pending) return pending;
  let request;
  try {
    // Direkt (synchron) anfordern, damit der Aufruf noch zur Nutzer-Geste gehört.
    request = navigator.wakeLock.request('screen');
  } catch (e) {
    return Promise.resolve(false);
  }
  pending = Promise.resolve(request)
    .then((sentinel) => {
      if (!wanted) {
        // keepAwake(false) kam, während die Anforderung lief
        safeRelease(sentinel);
        return false;
      }
      lock = sentinel;
      const onRelease = () => {
        if (lock === sentinel) lock = null;
      };
      if (typeof sentinel.addEventListener === 'function') sentinel.addEventListener('release', onRelease);
      else sentinel.onrelease = onRelease;
      if (!fallbackAlways) stopFallback();
      return true;
    })
    .catch(() => false)
    .then((ok) => {
      pending = null;
      return ok;
    });
  return pending;
}

function onVisibilityChange() {
  if (!wanted || !isVisible()) return;
  // Zurück im Vordergrund: Sperre neu anfordern; ein laufender Ersatz wird zur Sicherheit neu angestoßen.
  if (fallbackActive) runFallbackStart();
  requestLock().then((ok) => {
    if (!ok && wanted) startFallback();
  });
}

function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  try {
    document.addEventListener('visibilitychange', onVisibilityChange);
  } catch (e) {
    /* egal */
  }
}

// ---------------------------------------------------------------------------------------------------------
// Öffentliche Funktionen

/**
 * Bildschirm wach halten (true) oder wieder freigeben (false).
 * Liefert ein Promise mit true, wenn der Bildschirm (vermutlich) wach bleibt. Wirft nie.
 */
export function keepAwake(on) {
  try {
    wanted = !!on;
    listen();
    if (!wanted) {
      const current = lock;
      lock = null;
      if (current) safeRelease(current);
      stopFallback();
      return Promise.resolve(false);
    }
    // Ein Ersatz wird sofort (synchron) gestartet, damit er noch innerhalb der Nutzer-Geste läuft.
    if (fallback && (fallbackAlways || !hasWakeLockApi())) startFallback();
    return requestLock()
      .then((ok) => {
        if (!ok && wanted) startFallback();
        return ok || fallbackActive;
      })
      .catch(() => false);
  } catch (e) {
    return Promise.resolve(false);
  }
}

/**
 * Ersatzverfahren einstecken (oder mit null entfernen). Zurzeit wird keins benutzt (siehe oben).
 *   impl = { start() {…}, stop() {…} }   start() darf ein Promise liefern (false/Fehler = hat nicht geklappt)
 *                                         und wird beim Zurückkommen in den Vordergrund erneut aufgerufen.
 *   options.always = true                 Ersatz zusätzlich zur Wake-Lock-API benutzen
 *                                         (für Fälle, in denen die API vorhanden ist, aber nicht wirkt).
 */
export function setFallback(impl, { always = false } = {}) {
  stopFallback();
  fallback = impl && typeof impl.start === 'function' && typeof impl.stop === 'function' ? impl : null;
  fallbackAlways = !!always;
  if (wanted && fallback && (fallbackAlways || !lock)) startFallback();
}

/** Gibt es die Wake-Lock-API in diesem Browser? */
export function isWakeLockSupported() {
  return hasWakeLockApi();
}

/**
 * iPadOS-/iOS-Version aus der Browserkennung (navigator.userAgent), z. B. { major: 17, minor: 4 }.
 * null, wenn keine Version drinsteht (die Home-Bildschirm-App auf dem iPad nennt oft keine).
 */
export function appleOsVersion(userAgent) {
  const ua = String(userAgent || '');
  const match = ua.match(/OS (\d+)_(\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/**
 * Wirkt die Wake-Lock-API in einer Home-Bildschirm-App auf diesem iPad/iPhone NICHT (iPadOS/iOS älter als 18.4)?
 * Nur sinnvoll für die Home-Bildschirm-App auf Apple-Geräten. Unbekannte Version: false (lieber kein Hinweis).
 */
export function isWebAppWakeLockBroken(userAgent) {
  const v = appleOsVersion(userAgent);
  return !!v && (v.major < 18 || (v.major === 18 && v.minor < 4));
}

/** Aktueller Zustand (für Tests und Fehlersuche). */
export function getWakeState() {
  return { wanted, native: !!lock, fallback: fallbackActive, supported: hasWakeLockApi() };
}
