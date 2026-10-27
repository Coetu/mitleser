/* Mitleser – Mikrofon-Abgriff im Audio-Thread (AudioWorkletProcessor 'mitleser-capture').
 *
 * Der Browser ruft process() im Audio-Thread mit kleinen Häppchen auf (meist 128 Werte).
 * Wir sammeln die Werte von Kanal 0 in Blöcken zu je 4096 Werten und schicken jeden vollen Block
 * an den Hauptthread (speech.js), der ihn an die Spracherkennung weitergibt. Der Block wird dabei
 * übertragen statt kopiert (Transfer) – danach legen wir einen neuen an.
 *
 * Ausgegeben wird nur Stille. Der Knoten hängt lediglich (über Lautstärke 0) am Lautsprecher-Ausgang,
 * damit der Browser ihn regelmäßig aufruft.
 *
 * Baut speech.js den Audio-Graphen ab, schickt es die Nachricht 'stop'. Dann gibt process() false zurück:
 * Der Browser ruft den Prozessor nicht mehr auf und darf ihn aufräumen.
 */
const CHUNK_FRAMES = 4096;

class MitleserCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(CHUNK_FRAMES);
    this.filled = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this.stopped = true;
    };
  }

  process(inputs, outputs) {
    if (this.stopped) return false; // abgebaut: nichts mehr senden, nicht mehr aufrufen

    // Ohne verbundenes Mikrofon (oder ganz am Anfang) ist inputs[0] leer – dann einfach weiterlaufen.
    const input = inputs && inputs[0];
    const channel = input && input.length > 0 ? input[0] : null;
    if (channel && channel.length > 0) {
      let offset = 0;
      while (offset < channel.length) {
        const count = Math.min(CHUNK_FRAMES - this.filled, channel.length - offset);
        this.chunk.set(channel.subarray(offset, offset + count), this.filled);
        this.filled += count;
        offset += count;
        if (this.filled === CHUNK_FRAMES) {
          const full = this.chunk;
          this.port.postMessage(full, [full.buffer]);
          this.chunk = new Float32Array(CHUNK_FRAMES);
          this.filled = 0;
        }
      }
    }

    // Stille ausgeben.
    const output = outputs && outputs[0];
    if (output) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
    }
    return true; // weiterlaufen, auch wenn gerade kein Eingang anliegt
  }
}

registerProcessor('mitleser-capture', MitleserCapture);
