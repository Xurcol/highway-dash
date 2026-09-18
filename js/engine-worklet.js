import { EngineDSP } from "./engine-dsp.js?v=mu6adgwj";

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new EngineDSP(sampleRate);
    this.port.onmessage = (e) => this.dsp.message(e.data);
  }
  process(_inputs, outputs) {
    const ch = outputs[0];
    this.dsp.process(ch[0]);
    for (let c = 1; c < ch.length; c++) ch[c].set(ch[0]);
    return true;
  }
}
registerProcessor("engine-processor", EngineProcessor);
