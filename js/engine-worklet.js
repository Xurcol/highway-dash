import { EngineDSP } from "./engine-dsp.js?v=muew3v7x";

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new EngineDSP(sampleRate);
    this.port.onmessage = (e) => this.dsp.message(e.data);
    this.since = 99;
  }
  process(_inputs, outputs) {
    // two exhaust pipes -> left and right; a mono output gets the sum
    const ch = outputs[0];
    this.dsp.process(ch[0], ch.length > 1 ? ch[1] : undefined);
    for (let c = 2; c < ch.length; c++) ch[c].set(ch[0]);
    // pops that started this block go back to the main thread for the exhaust flames - at most one
    // message every 4 blocks (~11 ms), carrying the loudest, so anti-lag's stream of pops can't flood it
    const d = this.dsp;
    if (++this.since >= 4 && d.fireA > 0) { this.port.postMessage({ t: "fire", a: d.fireA, big: d.fireBig }); d.fireA = 0; d.fireBig = 0; this.since = 0; }
    return true;
  }
}
registerProcessor("engine-processor", EngineProcessor);
