// Audio: engine voices, wind/road/rain beds and one-shot effects, all synthesized.
import { EngineDSP } from "./engine-dsp.js";

class EngineVoice {
  constructor(am, profile) {
    this.am = am;
    const ctx = am.ctx;
    this.out = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.out.connect(this.pan);
    this.pan.connect(am.engineBus);
    if (am.worklet) {
      this.node = new AudioWorkletNode(ctx, "engine-processor", { outputChannelCount: [1] });
      this.post = (m) => this.node.port.postMessage(m);
    } else {
      const dsp = new EngineDSP(ctx.sampleRate);
      this.node = ctx.createScriptProcessor(1024, 0, 1);
      this.node.onaudioprocess = (e) => dsp.process(e.outputBuffer.getChannelData(0));
      this.post = (m) => dsp.message(m);
    }
    this.node.connect(this.out);
    this.post({ type: "profile", name: profile });
  }
  setProfile(name) { this.post({ type: "profile", name }); }
  params(rpm, throttle, gain) { this.post({ type: "params", rpm, throttle, gain }); }
  event(type, v) { this.post({ type, v }); }
  tune(tune, mode) { this.post({ type: "tune", tune, mode }); }
  setPan(p, vol = 1) {
    const t = this.am.ctx.currentTime;
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), t, 0.05);
    this.out.gain.setTargetAtTime(vol, t, 0.05);
  }
  dispose() { this.node.disconnect(); this.pan.disconnect(); }
}

// ---------- recorded engine (sample banks, e.g. public/sounds/s58) ----------
const BANK_FOR = { s58real: "s58" };
const banks = new Map();
function loadBank(ctx, name) {
  if (!banks.has(name)) banks.set(name, (async () => {
    const r = await fetch(`/sounds/${name}/manifest.json`, { cache: "no-cache" });
    if (!r.ok) return null;
    const m = await r.json();
    const decode = async (e) => ({ ...e, buf: await ctx.decodeAudioData(await (await fetch(`/sounds/${name}/${e.file}`)).arrayBuffer()) });
    const out = {};
    for (const g of ["on", "off", "pops", "flutter", "shift"]) out[g] = await Promise.all((m[g] || []).map(decode));
    return out;
  })().catch(() => null));
  return banks.get(name);
}

// Loops are pitched to the current rpm and equal-power crossfaded with their neighbours;
// on-throttle and off-throttle ladders are blended by throttle. Pops and flutter are real one-shots.
class SampleVoice {
  constructor(am, bank) {
    const ctx = (this.ctx = am.ctx);
    this.am = am; this.bank = bank;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.tone = ctx.createBiquadFilter(); this.tone.type = "lowpass"; this.tone.frequency.value = 6500; this.tone.Q.value = .5;
    this.pan = ctx.createStereoPanner();
    this.out = ctx.createGain();
    this.master.connect(this.tone).connect(this.out).connect(this.pan).connect(am.engineBus);
    this.layers = [];
    for (const [set, kind] of [[bank.on, "on"], [bank.off, "off"]]) {
      for (const e of set) {
        const src = ctx.createBufferSource(); src.buffer = e.buf; src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(g).connect(this.master);
        src.start(0, Math.random() * e.buf.duration);
        this.layers.push({ src, g, rpm: e.rpm, kind });
      }
    }
    this.thr = 0; this.rpm = 900; this.peakThr = 0;
    this.tuneState = { burble: .75, decay: 1.1, turbo: .8, exhaust: .9, brap: true, release: "flutter" };
    this.mode = "sport";
  }
  weights(kind, rpm) {
    const L = this.layers.filter((l) => l.kind === kind), w = new Map(L.map((l) => [l, 0]));
    if (rpm <= L[0].rpm) w.set(L[0], 1);
    else if (rpm >= L[L.length - 1].rpm) w.set(L[L.length - 1], 1);
    else for (let i = 0; i < L.length - 1; i++) if (rpm >= L[i].rpm && rpm <= L[i + 1].rpm) {
      const t = (rpm - L[i].rpm) / (L[i + 1].rpm - L[i].rpm);
      w.set(L[i], Math.cos((t * Math.PI) / 2)); w.set(L[i + 1], Math.sin((t * Math.PI) / 2));
    }
    return w;
  }
  params(rpm, throttle, gain) {
    const t = this.ctx.currentTime;
    this.rpm = rpm;
    this.thr += (throttle - this.thr) * .3;
    this.peakThr = Math.max(this.peakThr * .97, this.thr);
    const wOn = this.weights("on", rpm), wOff = this.weights("off", rpm);
    for (const l of this.layers) {
      const w = (l.kind === "on" ? wOn : wOff).get(l);
      const level = l.kind === "on" ? .25 + .75 * this.thr : (1 - this.thr) * 2.1;
      l.g.gain.setTargetAtTime(w * level, t, .04);
      if (w > 0) l.src.playbackRate.setTargetAtTime(Math.max(.55, Math.min(1.7, rpm / l.rpm)), t, .03);
    }
    const sport = this.mode === "sport";
    this.master.gain.setTargetAtTime(gain * .3 * this.tuneState.exhaust * (sport ? 1 : .65), t, .06);
    this.tone.frequency.setTargetAtTime(sport ? 6500 : 3800, t, .2);
  }
  shot(list, gain, delay = 0) {
    if (!list || !list.length) return;
    const e = list[(Math.random() * list.length) | 0];
    const src = this.ctx.createBufferSource(); src.buffer = e.buf; src.playbackRate.value = .92 + Math.random() * .16;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.out);
    src.start(this.ctx.currentTime + delay);
  }
  dip(dur, depth) {
    const t = this.ctx.currentTime, g = this.master.gain, v = g.value;
    g.cancelScheduledValues(t); g.setValueAtTime(v, t);
    g.linearRampToValueAtTime(v * depth, t + .01); g.linearRampToValueAtTime(v, t + dur);
  }
  event(type) {
    const T = this.tuneState, sport = this.mode === "sport", b = this.bank;
    if (type === "limiter") this.dip(.045, .45);
    else if (type === "upshift") { this.dip(.08, .3); if (sport && T.brap) this.shot(b.pops, .22 * T.burble, .03); }
    else if (type === "downshift") { const n = sport ? 2 + ((Math.random() * 2) | 0) : 1; for (let i = 0; i < n; i++) this.shot(b.pops, .18 * T.burble, .08 + i * .09); }
    else if (type === "lift") {
      if (this.rpm > 2600) {
        const n = Math.round((2 + 7 * T.burble) * (sport ? 1 : .25));
        for (let i = 0; i < n; i++) { const k = i / Math.max(1, n); this.shot(b.pops, .2 * T.burble * (1 - k * .8), .12 + k * T.decay * (.6 + Math.random() * .4)); }
      }
      if (T.release !== "off" && T.turbo > 0 && this.peakThr > .5 && this.rpm > 3000) this.shot(b.flutter, .22 * T.turbo, .02);
    }
  }
  tune(t, mode) { Object.assign(this.tuneState, t || {}); if (mode) this.mode = mode; }
  setPan(p, vol = 1) { const t = this.ctx.currentTime; this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), t, .05); this.out.gain.setTargetAtTime(vol, t, .05); }
  dispose() { for (const l of this.layers) { try { l.src.stop(); } catch (e) { /* already stopped */ } } this.pan.disconnect(); }
}

// Engine voice facade: the recorded bank when the sound has one and it loaded, synthesized otherwise.
class SmartEngine {
  constructor(am, profile) { this.am = am; this.voice = null; this.name = null; this.state = {}; this.setProfile(profile); }
  use(voice) {
    if (this.voice) this.voice.dispose();
    this.voice = voice;
    const s = this.state;
    if (s.tune) voice.tune(s.tune, s.mode);
    if (s.pan) voice.setPan(s.pan[0], s.pan[1]);
    if (s.params) voice.params(s.params[0], s.params[1], s.params[2]);
  }
  setProfile(name) {
    if (name === this.name) return;
    this.name = name;
    const bankName = BANK_FOR[name];
    const synthName = bankName ? "s58" : name;
    if (this.voice instanceof EngineVoice) this.voice.setProfile(synthName); else this.use(new EngineVoice(this.am, synthName));
    if (bankName) loadBank(this.am.ctx, bankName).then((bank) => { if (bank && this.name === name) this.use(new SampleVoice(this.am, bank)); });
  }
  params(rpm, throttle, gain) { this.state.params = [rpm, throttle, gain]; this.voice.params(rpm, throttle, gain); }
  event(type, v) { this.voice.event(type, v); }
  tune(tune, mode) { this.state.tune = tune; this.state.mode = mode; this.voice.tune(tune, mode); }
  setPan(p, vol) { this.state.pan = [p, vol]; this.voice.setPan(p, vol); }
  dispose() { if (this.voice) this.voice.dispose(); }
}

export class AudioManager {
  constructor() { this.ctx = null; this.ready = false; this.vol = { master: 0.8, engine: 0.9, fx: 0.9, wind: 0.35 }; }

  async init() {
    if (this.ctx) { if (this.ctx.state !== "running") await this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }));
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.6, 2.5);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.12;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.engineBus = ctx.createGain();
    this.engineBus.connect(this.master); this.engineBus.connect(this.reverbSend);
    this.fx = ctx.createGain();
    this.fx.connect(this.master); this.fx.connect(this.reverbSend);
    this.windBus = ctx.createGain();
    this.windBus.connect(this.master);
    // tunnel acoustics: long bright reverb + slap-back echo off the walls
    this.tunnelVerb = ctx.createConvolver();
    this.tunnelVerb.buffer = this.impulse(2.6, 1.7);
    this.tunnelSend = ctx.createGain(); this.tunnelSend.gain.value = 0;
    const tlp = ctx.createBiquadFilter(); tlp.type = "lowpass"; tlp.frequency.value = 4200;
    this.engineBus.connect(this.tunnelSend); this.fx.connect(this.tunnelSend);
    this.tunnelSend.connect(tlp).connect(this.tunnelVerb).connect(this.master);
    this.echo = ctx.createDelay(1); this.echo.delayTime.value = .09;
    const efb = ctx.createGain(); efb.gain.value = .4;
    const elp = ctx.createBiquadFilter(); elp.type = "lowpass"; elp.frequency.value = 2400;
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0;
    this.engineBus.connect(this.echoSend);
    this.echoSend.connect(this.echo); this.echo.connect(elp); elp.connect(efb).connect(this.echo); elp.connect(this.master);
    this.applyVolumes();

    this.noiseBuf = this.makeNoise(3);
    this.brownBuf = this.makeNoise(3, true);
    this.wind = this.loop(this.noiseBuf, "bandpass", 500, 0.6, this.windBus);
    this.road = this.loop(this.brownBuf, "lowpass", 160, 0.7, this.windBus);
    this.rain = this.loop(this.noiseBuf, "highpass", 1800, 0.5, this.windBus);
    this.rainLow = this.loop(this.brownBuf, "lowpass", 600, 0.5, this.windBus);
    this.scrape = this.loop(this.noiseBuf, "bandpass", 2400, 3);

    try {
      await ctx.audioWorklet.addModule(new URL("./engine-worklet.js", import.meta.url));
      this.worklet = true;
    } catch { this.worklet = false; }
    this.ready = true;
  }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.vol.engine * .7, t, 0.05);
    this.fx.gain.setTargetAtTime(this.vol.fx, t, 0.05);
    this.windBus.gain.setTargetAtTime(this.vol.wind ?? .35, t, 0.05);
  }
  setTunnel(f) {
    if (!this.ctx) return;
    this.set(this.tunnelSend.gain, f * .8, .25);
    this.set(this.echoSend.gain, f * .38, .25);
  }
  setReverb(amount) { if (this.ctx) this.reverbSend.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.5); }
  engine(profile) { return new SmartEngine(this, profile); }

  makeNoise(sec, brown = false) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  impulse(sec, decay) {
    const sr = this.ctx.sampleRate, b = this.ctx.createBuffer(2, sr * sec, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    }
    return b;
  }
  loop(buf, type, freq, q, dest) {
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(dest || this.fx); src.start();
    return { f, g };
  }
  set(node, v, tc = 0.1) { node.setTargetAtTime(v, this.ctx.currentTime, tc); }

  // continuous beds
  update(speedKmh, rainAmt, scraping) {
    if (!this.ready) return;
    const s = Math.min(1, speedKmh / 320);
    this.set(this.wind.g.gain, s * s * 0.12);
    this.set(this.wind.f.frequency, 300 + s * 900);
    this.set(this.road.g.gain, Math.min(1, speedKmh / 120) * 0.16);
    this.set(this.rain.g.gain, rainAmt * 0.16, 0.8);
    this.set(this.rainLow.g.gain, rainAmt * 0.25, 0.8);
    this.set(this.scrape.g.gain, scraping ? 0.25 : 0, 0.03);
  }

  // ---------- one shots ----------
  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  noiseShot({ type = "bandpass", f0 = 1000, f1 = f0, q = 1, a = 0.005, d = 0.3, peak = 0.5, pan = 0, delay = 0, buf }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = buf || this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
    this.env(g, t, a, peak, d);
    src.connect(f).connect(g).connect(p).connect(this.fx);
    src.start(t, Math.random() * 2); src.stop(t + a + d + 0.05);
  }
  tone({ type = "sine", f0, f1 = f0, a = 0.005, d = 0.2, peak = 0.3, delay = 0, pan = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
    this.env(g, t, a, peak, d);
    o.connect(g).connect(p).connect(this.fx);
    o.start(t); o.stop(t + a + d + 0.05);
  }
  whoosh(pan, big = false) {
    if (!this.ready) return;
    this.noiseShot({ f0: 350, f1: big ? 1600 : 1100, q: 0.9, a: 0.1, d: 0.3, peak: big ? 0.28 : 0.16, pan });
    this.noiseShot({ type: "lowpass", f0: 260, f1: 80, q: 0.5, a: 0.05, d: 0.35, peak: big ? 0.4 : 0.22, pan, buf: this.brownBuf });
  }
  closeCall(combo) {
    if (!this.ready) return;
    const base = 660 * Math.pow(2, Math.min(combo - 1, 12) / 12);
    this.tone({ type: "triangle", f0: base, d: 0.12, peak: 0.16 });
    this.tone({ type: "triangle", f0: base * 1.5, d: 0.25, peak: 0.14, delay: 0.07 });
  }
  tick(on) {
    if (!this.ready) return;
    this.noiseShot({ type: "bandpass", f0: on ? 3200 : 2200, q: 6, a: 0.001, d: 0.025, peak: 0.35 });
    this.tone({ type: "square", f0: on ? 1400 : 1000, d: 0.012, peak: 0.04 });
  }
  shiftClunk(up) {
    if (!this.ready) return;
    this.tone({ f0: up ? 90 : 110, f1: 45, a: 0.002, d: 0.06, peak: 0.25 });
    this.noiseShot({ type: "bandpass", f0: 1800, q: 4, a: 0.001, d: 0.03, peak: 0.12 });
  }
  deny() { if (this.ready) this.tone({ type: "square", f0: 220, f1: 180, d: 0.12, peak: 0.08 }); }
  ui() { if (this.ready) this.tone({ type: "triangle", f0: 880, f1: 1200, d: 0.06, peak: 0.12 }); }
  coin() { if (this.ready) { this.tone({ type: "square", f0: 988, d: 0.07, peak: 0.08 }); this.tone({ type: "square", f0: 1319, d: 0.2, peak: 0.08, delay: 0.07 }); } }
  horn(on) {
    if (!this.ready) return;
    if (on && !this.hornNodes) {
      const g = this.ctx.createGain(); g.gain.value = 0;
      const lp = this.ctx.createBiquadFilter(); lp.frequency.value = 1800;
      const oscs = [415, 523].map((f) => { const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      lp.connect(g).connect(this.fx);
      this.set(g.gain, 0.12, 0.01);
      this.hornNodes = { g, oscs };
    } else if (!on && this.hornNodes) {
      const { g, oscs } = this.hornNodes; this.hornNodes = null;
      this.set(g.gain, 0, 0.02);
      oscs.forEach((o) => o.stop(this.ctx.currentTime + 0.2));
    }
  }
  truckHorn(pan) {
    if (!this.ready) return;
    [185, 233].forEach((f) => this.tone({ type: "sawtooth", f0: f, f1: f * 0.97, a: 0.02, d: 0.7, peak: 0.07, pan }));
  }
  crash(power = 1) {
    if (!this.ready) return;
    const P = Math.min(1, 0.5 + power * 0.5);
    this.noiseShot({ type: "lowpass", f0: 2500, f1: 120, q: 0.7, a: 0.002, d: 0.9, peak: 1.0 * P, buf: this.brownBuf });
    this.noiseShot({ type: "bandpass", f0: 1400, f1: 400, q: 0.8, a: 0.002, d: 0.5, peak: 0.9 * P });
    this.tone({ f0: 70, f1: 30, a: 0.002, d: 0.5, peak: 0.8 * P });
    [410, 623, 1130, 1587].forEach((f, i) => this.tone({ type: "triangle", f0: f, f1: f * 0.92, a: 0.002, d: 0.6 + i * 0.15, peak: 0.08 * P }));
    for (let i = 0; i < 10; i++) // glass
      this.noiseShot({ type: "highpass", f0: 5000 + Math.random() * 4000, q: 2, a: 0.001, d: 0.04 + Math.random() * 0.08, peak: 0.12 * P, delay: 0.03 + Math.random() * 0.5, pan: Math.random() * 2 - 1 });
    this.noiseShot({ type: "bandpass", f0: 700, f1: 300, q: 1, a: 0.01, d: 0.5, peak: 0.35 * P, delay: 0.45 }); // landing
  }
  thunder(delay = 0) {
    if (!this.ready) return;
    this.noiseShot({ type: "lowpass", f0: 900, f1: 60, q: 0.5, a: 0.05, d: 3.5, peak: 0.9, delay, buf: this.brownBuf });
    this.noiseShot({ type: "lowpass", f0: 300, f1: 40, q: 0.5, a: 0.3, d: 4, peak: 0.6, delay: delay + 0.4, buf: this.brownBuf });
  }
}
