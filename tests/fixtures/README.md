# Testdaten: echte Erkennungsergebnisse

Jede `.json`-Datei ist eine aufgezeichnete Erkennung eines Abschnitts:

| Feld | Inhalt |
|---|---|
| `section` | Abschnittstext, wie er in der App steht |
| `spoken` | was tatsächlich gesprochen wurde (mit Füllwörtern, ausgelassenen Sätzen, fremden Sätzen …) |
| `expect` | Erwartung: `full` (alles gefärbt), `maxColored` (höchstens so viele Wörter), `partialUpTo` (bis zu diesem Wort) |
| `variant` | `clean` (sauber), `mild` (leichter Raumhall + Rauschen), `noisy` (starker Hall + Rauschen) |
| `events` | Erkennungsergebnisse: `[Sekunde, "p" = Teilergebnis / "f" = Endergebnis, erkannter Text]` |
| `spokenWords` | Startzeiten der gesprochenen Wörter: `[Sekunde, Zeichenposition in spoken, Länge]` |

So sind sie entstanden:

1. Der gesprochene Text wurde mit der Windows-Sprachausgabe „Microsoft Hedda“ (Deutsch) als 16-kHz-WAV erzeugt –
   in verschiedenen Sprechtempi, für `mild`/`noisy` zusätzlich mit künstlichem Raumhall und Rauschen.
2. Die WAV-Dateien liefen im Browser durch genau den Web Worker dieser App (`js/asr-worker.js`, Vosk-WASM,
   `vosk-model-small-de-0.15`), in Blöcken von 85 ms wie beim Mikrofon.
3. Jedes Teil- und Endergebnis wurde mit seinem Zeitpunkt gespeichert.

Die Tests in `tests/fixtures.test.js` spielen diese Ergebnisse durch den Wortabgleich und prüfen u. a. die
Abnahmetests 2 bis 5, dass nie etwas vor dem Sprechen gefärbt wird und wie groß die Verzögerung ist.
