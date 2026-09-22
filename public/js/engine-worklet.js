import { EngineDSP } from "./engine-dsp.js";

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new EngineDSP(sampleRate);
    this.port.onmessage = (e) => this.dsp.message(e.data);
  }
  process(_inputs, outputs) {
    // two exhaust pipes -> left and right; a mono output gets the sum
    const ch = outputs[0];
    this.dsp.process(ch[0], ch.length > 1 ? ch[1] : undefined);
    for (let c = 2; c < ch.length; c++) ch[c].set(ch[0]);
    return true;
  }
}
registerProcessor("engine-processor", EngineProcessor);
