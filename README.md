# Mitleser

**Präsentationshilfe fürs iPad:** Mitleser zeigt deinen Vortragstext abschnittsweise in großer Schrift an. Während du laut
vorliest, hört das iPad mit und färbt die schon gelesenen Wörter ein. So verlierst du nie die Stelle.

- Spracherkennung **komplett auf dem iPad** (Vosk, deutsches Modell) – kein Internet nötig, nichts verlässt das Gerät.
- Läuft als **Web-App vom Home-Bildschirm**, nach dem ersten Laden auch im **Flugmodus**.
- Verträgt Versprecher, „äh“, ausgelassene Sätze, Fachbegriffe, zusammengesetzte Wörter und Zahlen
  („DIN ISO 281“, „3,5 kN“, „2026“).
- Bedienung per Tippen (links/Mitte/rechts) oder mit Bluetooth-Presenter/Tastatur.
- Reine statische Webseite auf **GitHub Pages** – kostenlos, kein eigener Server, kein Build-Schritt.

---

## Inhalt

1. [Voraussetzungen](#voraussetzungen)
2. [Schritt 1: Ordner an seinen Platz legen](#schritt-1-ordner-an-seinen-platz-legen)
3. [Schritt 2: Repository mit GitHub Desktop veröffentlichen](#schritt-2-repository-mit-github-desktop-veröffentlichen)
4. [Schritt 3: GitHub Pages einschalten](#schritt-3-github-pages-einschalten)
5. [Schritt 4: Auf dem iPad einrichten](#schritt-4-auf-dem-ipad-einrichten)
6. [Schritt 5: Generalprobe vor dem Vortrag](#schritt-5-generalprobe-vor-dem-vortrag)
7. [Bedienung](#bedienung)
8. [Typische Fehler und Lösungen](#typische-fehler-und-lösungen)
9. [Änderungen veröffentlichen](#änderungen-veröffentlichen)
10. [Am PC ausprobieren und testen](#am-pc-ausprobieren-und-testen)
11. [Wie es funktioniert](#wie-es-funktioniert)
12. [Datenschutz](#datenschutz)
13. [Lizenzen](#lizenzen)

---

## Voraussetzungen

| Was | Hinweis |
|---|---|
| iPad mit **iPadOS 18.4 oder neuer** | Ab 18.4 bleibt der Bildschirm in der Home-Bildschirm-App zuverlässig an. Ältere Versionen gehen auch, dann aber in den iPad-Einstellungen *Anzeige & Helligkeit › Automatische Sperre › Nie* einstellen. Je neuer das iPad, desto flüssiger die Erkennung (empfohlen: ab ca. 2018). |
| ca. **150 MB freier Speicher** auf dem iPad | Das Sprachmodell ist 46 MB groß und wird einmalig geladen. |
| Kostenloses **GitHub-Konto** | <https://github.com> – die E-Mail-Adresse muss bestätigt sein. |
| **GitHub Desktop** für Windows | <https://desktop.github.com> |

> **Wichtig:** Bei einem kostenlosen GitHub-Konto muss das Repository **öffentlich** sein, damit GitHub Pages funktioniert.
> Deine Vortragstexte gehören deshalb **nicht** ins Repository – sie bleiben nur auf dem iPad (dort werden sie automatisch
> gespeichert, Import/Export als .txt ist eingebaut).

---

## Schritt 1: Ordner an seinen Platz legen

1. Verschiebe den Ordner `mitleser` dorthin, wo deine GitHub-Projekte liegen sollen, z. B. `Dokumente\GitHub\mitleser`.
2. Lass den Ordnernamen **klein geschrieben** (`mitleser`) – er wird Teil der Internetadresse, und GitHub Pages
   unterscheidet Groß- und Kleinschreibung.
3. Lege **keine weiteren Dateien** in den Ordner (keine Vortragstexte, keine Aufnahmen). Alles in diesem Ordner wird
   veröffentlicht.

Der Ordner ist bereits ein (leeres) Git-Repository – es gibt noch keinen Commit. Das erledigst du in Schritt 2.

---

## Schritt 2: Repository mit GitHub Desktop veröffentlichen

1. **GitHub Desktop** starten und anmelden: *File › Options… › Accounts › Sign in* (öffnet den Browser).
2. *File › Add local repository…* (Strg+O) › **Choose…** › den Ordner `mitleser` wählen › **Add repository**.
3. Links unter **Changes** stehen jetzt alle Dateien (gut 70, darunter `models/vosk-model-small-de-0.15.tar.gz` mit 46 MB).
4. Unten links die Commit-Nachricht aus der Datei `COMMIT_MESSAGE.txt` (liegt im Ordner, wird selbst nicht hochgeladen)
   eintragen:
   - erste Zeile in **Summary**,
   - den Rest in **Description**.
5. **Commit to main** klicken.
6. Oben **Publish repository** klicken:
   - Name: `mitleser`
   - **Haken bei „Keep this code private“ ENTFERNEN** (er ist standardmäßig gesetzt – mit Haken funktioniert GitHub Pages
     im kostenlosen Konto nicht).
   - **Publish repository** klicken. Das Hochladen dauert wegen des Sprachmodells je nach Leitung 1–5 Minuten.

> Nicht die Upload-Funktion auf github.com benutzen: Dort sind nur Dateien bis 25 MB erlaubt, das Sprachmodell ist größer.
> Git LFS wird **nicht** gebraucht und darf auch nicht benutzt werden (GitHub Pages liefert LFS-Dateien nicht aus).

---

## Schritt 3: GitHub Pages einschalten

1. In GitHub Desktop *Repository › View on GitHub* (Strg+Umschalt+G) – das Repository öffnet sich im Browser.
2. Oben **Settings** › links im Bereich *Code and automation* auf **Pages**.
3. Unter **Build and deployment**:
   - *Source*: **Deploy from a branch**
   - *Branch*: **main** und **/ (root)** › **Save**.
4. Warten, bis oben im Reiter **Actions** der Lauf *pages build and deployment* einen grünen Haken hat (meist 1–2 Minuten,
   höchstens etwa 10).
5. Unter *Settings › Pages* steht dann **Your site is live at** `https://DEIN-NAME.github.io/mitleser/`.

Die Adresse immer **mit dem Schrägstrich am Ende** verwenden: `https://DEIN-NAME.github.io/mitleser/`

---

## Schritt 4: Auf dem iPad einrichten

1. Auf dem iPad **Safari** öffnen und `https://DEIN-NAME.github.io/mitleser/` aufrufen.
2. **Teilen**-Symbol (Quadrat mit Pfeil nach oben; bei neuerem Safari ggf. im Menü „…“) › **Zum Home-Bildschirm**.
3. Den Schalter **„Als Web-App öffnen“ eingeschaltet lassen** › **Hinzufügen**.
4. Safari schließen und Mitleser **über das neue Symbol auf dem Home-Bildschirm** öffnen.
   > Die Home-Bildschirm-App hat einen **eigenen Speicher**, getrennt von Safari. Alles, was du vorher im Safari-Tab gemacht
   > hast (Text, Sprachmodell), ist dort nicht vorhanden. Richte deshalb alles in der App vom Home-Bildschirm ein.
5. Mit Internetverbindung warten, bis unter **Spracherkennung** „bereit“ steht (einmalig ca. 46 MB) und unten
   **„Offline bereit“** erscheint.
6. **Mikrofon testen** tippen › beim Hinweis **Erlauben** › ein paar Sätze sprechen. Die erkannten Wörter erscheinen.
7. Vortragstext einfügen (oder per **Importieren** eine .txt-Datei aus der Dateien-App laden).

---

## Schritt 5: Generalprobe vor dem Vortrag

- [ ] App **vom Home-Bildschirm** öffnen, nicht im Safari-Tab.
- [ ] **Flugmodus einschalten**, App im App-Umschalter ganz schließen und neu öffnen: Text ist da, „Spracherkennung bereit“.
- [ ] Präsentation starten, Mikrofon **erlauben** (das iPad fragt bei jedem Neustart der App einmal – das ist bei
      Home-Bildschirm-Apps auf dem iPad so vorgesehen).
- [ ] Einen Abschnitt laut vorlesen – die Wörter färben sich.
- [ ] Bildschirm geht nicht aus (bei iPadOS älter als 18.4: *Automatische Sperre › Nie*).
- [ ] Presenter/Tastatur testen: Pfeil rechts/links bzw. Bild ab/auf.
- [ ] iPad-Benachrichtigungen ausschalten (Fokus „Nicht stören“), damit nichts dazwischenkommt.

---

## Bedienung

### Vorbereitung

| Element | Funktion |
|---|---|
| Textfeld | Vortragstext. **Eine Leerzeile beginnt einen neuen Abschnitt.** Alternativ Abschnitte mit einer Zeile, die nur `---` enthält, trennen – dann dürfen Abschnitte auch Leerzeilen (Absätze) enthalten. (Macht das iPad aus `---` automatisch einen langen Strich „—“, funktioniert das genauso.) |
| Zähler | Zeigt Anzahl der Abschnitte und Wörter. |
| Speichern | Passiert automatisch auf dem iPad. |
| Importieren / Exportieren | .txt-Datei laden bzw. über das Teilen-Menü sichern („In Dateien sichern“). Geht das Teilen nicht, wird der Text in die Zwischenablage kopiert. |
| Schriftgröße | Schieberegler mit Vorschau. |
| Spracherkennung an/aus | Aus = reine Anzeige mit Blättern, ohne Mikrofon. |
| Automatisch weiterblättern | Springt am Abschnittsende von selbst zum nächsten Abschnitt (Standard: aus). |
| Mikrofon testen | Zeigt live, was erkannt wird. |
| Präsentation starten / Bei Abschnitt X fortsetzen | Startet von vorne bzw. dort, wo du zuletzt aufgehört hast. |

### Präsentation

```
┌──────────────┬──────────────┬──────────────┐
│              │              │              │
│  links:      │  Mitte:      │  rechts:     │
│  Färbung     │  Mikrofon    │  nächster    │
│  zurück-     │  pausieren / │  Abschnitt   │
│  setzen,     │  fortsetzen  │              │
│  dann        │              │              │
│  vorheriger  │              │              │
│  Abschnitt   │              │              │
└──────────────┴──────────────┴──────────────┘
```

- **Rechts tippen:** nächster Abschnitt (ungefärbt). Im letzten Abschnitt passiert nichts.
- **Links tippen:** Färbung des aktuellen Abschnitts zurücksetzen. Ist noch nichts gefärbt: vorheriger Abschnitt.
- **Mitte tippen:** Mikrofon pausieren/fortsetzen, z. B. bei Fragen aus dem Publikum. Pausiert färbt nichts.
- Oben: **‹ Vorbereitung**, Abschnittszähler (z. B. „3 / 12“) und Mikrofon-Status.
- Beim Start wird kurz eingeblendet, welcher Bereich was tut.
- Gelesene Wörter werden umgefärbt, das nächste erwartete Wort ist dezent markiert. Lange Abschnitte scrollen mit.

### Was im Text nicht vorgelesen werden muss

- **Regieanweisungen in eckigen Klammern** wie `[Folie 12]` oder `[Pause]` werden schräg und blasser angezeigt und nie
  erwartet.
- **Einschübe in runden Klammern** `(Typ 32008 X, Baujahr 2019)` darfst du weglassen – die App findet danach sofort weiter.
- **Aufzählungsnummern** am Zeilenanfang (`1.`, `a)`, `•`) müssen nicht mitgesprochen werden.
- **„Uhr“** nach einer Uhrzeit und **„€“** nach einem Betrag: „10:30 Uhr“ darf auch „halb elf“ heißen, „3,50 €“ auch
  „drei Euro fünfzig“.
- Abkürzungen wie „z. B.“, „z.B.“, „bzw.“, „ca.“, „d. h.“ werden ausgesprochen erwartet („zum Beispiel“ …).

### Bluetooth-Presenter und Tastatur

| Taste | Funktion |
|---|---|
| Pfeil rechts, Bild ab, Leertaste | weiter |
| Pfeil links, Bild auf | zurücksetzen bzw. zurück |
| M | Mikrofon an/aus |

Die meisten Presenter senden „Bild ab/Bild auf“ oder Pfeiltasten. Tasten wie „Bildschirm schwarz“ oder F5 werden ignoriert.

### Tipps für gute Erkennung

- Normal und deutlich sprechen, nicht schreien. Das iPad-Mikrofon reicht aus ca. 1 m Abstand.
- Die Färbung läuft nur vorwärts. Wenn du einen Satz auslässt, findet die App die Stelle nach wenigen Wörtern wieder.
- Freie Zwischenbemerkungen färben nichts ein.
- Zahlen kannst du ganz normal sprechen („zweitausendsechsundzwanzig“, „drei Komma fünf Kilonewton“ oder
  „dreieinhalb Kilonewton“, „fünfzehnhundert“).
- Englische Begriffe („Team“, „Update“) und Fachwörter, die die Erkennung nicht kennt, sind kein Problem: Die Färbung
  holt nach ein, zwei Wörtern auf.
- Bei sehr vielen Fehlerkennungen hilft es, das iPad näher zu stellen oder Störgeräusche zu vermeiden. Notfalls einfach
  rechts tippen.

---

## Typische Fehler und Lösungen

| Problem | Ursache und Lösung |
|---|---|
| github.io zeigt „404 – There isn't a GitHub Pages site here“ | Repository ist privat (Haken „Keep this code private“) → auf github.com *Settings › General › Danger Zone › Change visibility › Public*. Oder Pages noch nicht eingeschaltet bzw. erster Lauf noch nicht fertig (Reiter *Actions* prüfen). Adresse genau prüfen: klein geschrieben und mit `/` am Ende. |
| „Sprachmodell konnte nicht geladen werden“ | Beim allerersten Öffnen ist Internet nötig. Mit WLAN erneut öffnen und **Erneut versuchen** tippen. |
| „Nicht genug Speicherplatz“ | Auf dem iPad Speicher freigeben (*Einstellungen › Allgemein › iPad-Speicher*). |
| Mikrofon-Abfrage bei jedem Start | Bei Home-Bildschirm-Apps fragt iPadOS nach jedem Neustart der App einmal (und wenn das Mikrofon länger als etwa 10 Minuten aus war). **Erlauben** tippen – am besten kurz vor dem Vortrag „Mikrofon testen“ oder die Präsentation schon starten. |
| „Mikrofon nicht erlaubt“ | Einmal „Nicht erlauben“ getippt? App im App-Umschalter schließen und neu öffnen, dann **Erlauben**. Hilft das nicht: *Einstellungen › Apps › Safari › Mikrofon* auf „Fragen“ oder „Erlauben“ stellen. |
| Mikrofon nach Anruf/Sperrbildschirm weg | iPadOS beendet das Mikrofon, wenn die App in den Hintergrund geht. Zurück in der App **Mitte tippen**, dann läuft es wieder. |
| Bildschirm geht aus | iPadOS älter als 18.4 (die App zeigt dann einen Hinweis) oder Stromsparmodus: *Einstellungen › Anzeige & Helligkeit › Automatische Sperre › Nie*. |
| Abschnitte werden nicht getrennt | Zwischen den Abschnitten muss eine wirklich leere Zeile stehen. Steht irgendwo im Text eine Zeile nur mit `---` (oder „—“), trennen **nur noch** solche Zeilen – dann eine Trennzeile zwischen alle Abschnitte setzen oder die eine entfernen. Der Zähler zeigt sofort, wie viele Abschnitte erkannt werden. |
| Färbung hängt hinterher, Hinweis „Erkennung kommt nicht hinterher“ | Älteres iPad: andere Apps schließen, Stromsparmodus aus. Notfalls Spracherkennung aus und per Tippen blättern. |
| Es wird nichts gefärbt | Mikrofon-Status oben prüfen (pausiert? Fehler?). Spricht man Text, der nicht im Abschnitt steht, färbt sich bewusst nichts. Mit „Mikrofon testen“ prüfen, ob überhaupt Wörter erkannt werden. |
| Offline geht nichts | Die App wurde im Safari-Tab statt vom Home-Bildschirm eingerichtet, oder „Offline bereit“ war noch nicht zu sehen. App vom Home-Bildschirm einmal mit Internet öffnen und warten. |
| Nach einem Update ist noch die alte Version da | GitHub hält Dateien bis zu 10 Minuten im Zwischenspeicher. Danach die App im App-Umschalter schließen und **zweimal** neu öffnen. Die Versionsnummer steht unten in der Vorbereitung. |
| Umlaute nach dem Import kaputt | Die App erkennt UTF-8 und alte Windows-Dateien (ANSI) automatisch. Notfalls die Datei im Editor mit „Speichern unter… › Codierung: UTF-8“ neu speichern. |
| Export | Exportieren öffnet das Teilen-Menü → **In Dateien sichern**. Steht das Teilen nicht zur Verfügung, kopiert die App den Text in die Zwischenablage (dann z. B. in der Notizen- oder Dateien-App einfügen). Direkte Downloads können Home-Bildschirm-Apps auf dem iPad blockieren und werden dort deshalb nicht benutzt. |
| Push in GitHub Desktop schlägt fehl („file size“) | Kann mit den mitgelieferten Dateien nicht passieren (größte Datei 46 MB, Grenze 100 MB). Wenn doch: zusätzlich hineinkopierte große Dateien entfernen. |
| „WebAssembly/Audio nicht verfügbar“ | Der **Blockierungsmodus** (Lockdown Mode) des iPads schaltet die nötigen Funktionen ab. Die Seite dort als Ausnahme eintragen oder den Modus ausschalten. |

---

## Änderungen veröffentlichen

1. Dateien im Ordner ändern.
2. **Wichtig bei jeder Änderung:** in `sw.js` die Zeile `const VERSION = '…'` hochzählen (z. B. `1.0.1`) und in
   `js/app.js` die gleiche Nummer bei `APP_VERSION` eintragen. Nur dann lädt das iPad die neuen Dateien.
3. In GitHub Desktop: Summary eintragen › **Commit to main** › **Push origin**.
4. Nach ein paar Minuten auf dem iPad die App schließen und zweimal neu öffnen.

Das Sprachmodell wird dabei **nicht** neu geladen – es bleibt auf dem iPad gespeichert.

---

## Am PC ausprobieren und testen

**App lokal starten** (Python ist vorhanden):

```bash
python -m http.server 8000
```

im Ordner `mitleser` ausführen und im Browser <http://localhost:8000/> öffnen (Chrome oder Edge; das Mikrofon funktioniert
auf `localhost` auch ohne https). Auf `localhost` lädt die App immer die neuesten Dateien (der Service Worker fragt dort
zuerst den Server), offline geht sie trotzdem.

**Automatische Tests** – entweder

- im Browser: <http://localhost:8000/tests/> (bzw. nach dem Veröffentlichen `https://DEIN-NAME.github.io/mitleser/tests/`), oder
- mit Node.js (<https://nodejs.org>, LTS-Version) im Ordner:

```bash
node tests/run-node.js
```

Die Tests prüfen die Abschnitts-Zerlegung, Zahlwörter, den Wortabgleich, die Navigation, das Speichern und die
Audio-Umrechnung. Für den Wortabgleich liegen in `tests/fixtures/` echte Erkennungsergebnisse (deutsche Sprachausgabe,
von genau dieser Vosk-Version erkannt), darunter alle sprachbezogenen Abnahmetests: wörtlich vorgelesen, Satz ausgelassen
mit „äh, also“, Zahlen, fremder Satz. `tests/regressions.test.js` enthält Fälle aus einer gezielten Angriffsprüfung
(lange Abschnitte, Lehnwörter, Uhrzeiten, Klammern, Regieanweisungen …). `tests/release.test.js` prüft vor jeder
Veröffentlichung, dass Versionsnummern zusammenpassen und alle Dateien in der Offline-Liste stehen.

---

## Wie es funktioniert

```
Mikrofon ─▶ AudioWorklet ─▶ Worker: Umrechnen auf 16 kHz ─▶ Vosk (WebAssembly) ─▶ erkannte Wörter
                                                                                      │
Vortragstext ─▶ Abschnitte ─▶ Wörter + Sprechformen ("2026" → "zweitausendsechsundzwanzig")
                                                                                      ▼
                                              Wortabgleich (dynamische Programmierung) ─▶ Färbung
```

- **Spracherkennung:** [Vosk](https://alphacephei.com/vosk/) als WebAssembly aus dem Projekt
  [vosk-browser](https://github.com/ccoreilly/vosk-browser) mit dem deutschen Modell `vosk-model-small-de-0.15`. Läuft in
  einem eigenen Hintergrund-Thread (Web Worker), damit die Anzeige flüssig bleibt.
- **Wortabgleich** (`js/matcher.js`): vergleicht die zuletzt erkannten Wörter unscharf mit dem Text (über einen
  Lautschlüssel, sodass z. B. „weltlage“ zu „Wälzlager“ passt), setzt zerlegte Wörter wieder zusammen
  („kegel rollen lager“), überspringt Füllwörter und ausgelassene Sätze und färbt erst weiter, wenn genug Belege vorliegen.
  Kurze Allerweltswörter („und“, „die“) zählen wenig, lange seltene Wörter viel.
- **Offline:** Ein Service Worker speichert die App-Dateien, das Sprachmodell liegt im Cache-Speicher des Browsers.

| Datei/Ordner | Inhalt |
|---|---|
| `index.html`, `css/app.css`, `js/app.js` | Oberfläche |
| `js/text.js` | Text in Abschnitte und Wörter zerlegen |
| `js/normalize.js` | Zahlen, Einheiten, Abkürzungen, Lautschlüssel |
| `js/matcher.js` | Wortabgleich |
| `js/navigation.js` | Blättern/Zurücksetzen |
| `js/speech.js`, `js/audio-worklet.js`, `js/asr-worker.js`, `js/resampler.js` | Mikrofon und Spracherkennung |
| `js/storage.js`, `js/wakelock.js` | Speichern, Bildschirm anlassen |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline-Fähigkeit und Home-Bildschirm-App |
| `lib/vosk-wasm.js` | Vosk (WebAssembly), unverändert aus vosk-browser 0.0.8 |
| `models/` | deutsches Sprachmodell |
| `tests/` | automatische Tests und Testdaten |
| `tools/` | Hilfsskripte (Icons erzeugen, Vosk-Datei herauslösen) |

---

## Warum so gebaut?

- **Vosk statt Safari-Spracherkennung:** Die eingebaute Erkennung von Safari funktioniert in Home-Bildschirm-Apps nicht
  und braucht Internet. Vosk läuft als WebAssembly komplett auf dem iPad, braucht keine besonderen Server-Einstellungen
  (die GitHub Pages nicht erlaubt) und liefert schon während des Sprechens Zwischenergebnisse – daher die geringe
  Verzögerung.
- **Freie Erkennung statt Wortliste:** Vosk könnte man auf die Wörter des Vortrags beschränken. Dann würde aber auch freie
  Rede in Vortragswörter „übersetzt“ und könnte fälschlich einfärben. Deshalb erkennt Vosk frei, und der Wortabgleich ist
  dafür sehr fehlertolerant.
- **Eigener Hintergrund-Thread:** Das Sprachmodell wird im Hauptprogramm geladen (mit Fortschrittsanzeige), im
  Offline-Speicher abgelegt und an den Worker übergeben. Das Audio wird vorher auf 16 kHz umgerechnet, das halbiert die
  Rechenzeit.
- **Kein Build-Schritt:** Alles sind normale Dateien, die GitHub Pages direkt ausliefert; die Tests laufen ohne
  Installation im Browser oder mit Node.js.

## Datenschutz

- Der Vortragstext wird nur im Speicher des iPads (localStorage) abgelegt.
- Das Mikrofon wird nur während der Präsentation bzw. des Mikrofontests benutzt; das Audio wird direkt auf dem iPad
  ausgewertet und nirgends gespeichert oder verschickt.
- Die App lädt ausschließlich ihre eigenen Dateien von GitHub Pages (beim ersten Öffnen und bei Updates). Es gibt keine
  Statistik, keine Werbung, keine fremden Server.

---

## Lizenzen

- **Vosk / vosk-browser** (Apache-2.0): `lib/vosk-wasm.js`, Lizenztext in `lib/LICENSE-vosk-browser.txt`. Enthält außerdem
  Kaldi (Apache-2.0), OpenFst (Apache-2.0), CLAPACK (BSD), libarchive (BSD) und zlib.
- **Sprachmodell vosk-model-small-de-0.15** © Alpha Cephei Inc. (Apache-2.0): `models/LICENSE-vosk-model-small-de-0.15.txt`.
- Der übrige Code dieses Projekts gehört dir.
