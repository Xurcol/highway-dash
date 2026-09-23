// Audio: engine voices, wind/road/rain beds and one-shot effects, all synthesized.
import { EngineDSP, burbleIntensity, DEFAULT_TUNE } from "./engine-dsp.js";

// Callers may pass a full engine state object or the old (rpm, throttle, gain) triple.
const asState = (a, b, c) => (typeof a === "object" && a !== null ? a : { rpm: a, throttle: b, gain: c });

class EngineVoice {
  constructor(am, profile) {
    this.am = am;
    const ctx = am.ctx;
    this.out = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.out.connect(this.pan);
    this.pan.connect(am.engineBus);
    if (am.worklet) {
      // stereo: the synth runs one pipe per side (see engine-dsp.js)
      this.node = new AudioWorkletNode(ctx, "engine-processor", { outputChannelCount: [2] });
      this.post = (m) => this.node.port.postMessage(m);
      this.node.port.onmessage = (e) => { if (e.data?.t === "fire") this.fire(e.data.a, e.data.big); };
    } else {
      const dsp = new EngineDSP(ctx.sampleRate);
      this.node = ctx.createScriptProcessor(1024, 0, 2);
      this.node.onaudioprocess = (e) => {
        dsp.process(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1));
        if (dsp.fireA > 0) { this.fire(dsp.fireA, dsp.fireBig); dsp.fireA = 0; dsp.fireBig = 0; }
      };
      this.post = (m) => dsp.message(m);
    }
    // distance: air takes the top off a far-away car (only remote voices ever move this)
    this.far = ctx.createBiquadFilter(); this.far.type = "lowpass"; this.far.frequency.value = 20000; this.far.Q.value = .5;
    this.node.connect(this.far).connect(this.out);
    this.post({ type: "profile", name: profile });
  }
  setDistance(d) { this.far.frequency.setTargetAtTime(distanceCutoff(d), this.am.ctx.currentTime, .08); }
  // a pop just left the synth: tell whoever draws the flames, as it reaches the speakers
  fire(amp, big) { if (this.onFire) fireLater(this.am.ctx, 0, () => this.onFire?.(amp, !!big)); }
  setProfile(name) { this.post({ type: "profile", name }); }
  params(a, b, c) { this.post({ type: "params", ...asState(a, b, c) }); }
  event(type, info) { this.post({ type, ...(info || {}) }); }
  tune(tune, mode) { this.post({ type: "tune", tune, mode }); }
  setPan(p, vol = 1) {
    const t = this.am.ctx.currentTime;
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), t, 0.05);
    this.out.gain.setTargetAtTime(vol, t, 0.05);
  }
  dispose() { this.node.disconnect(); this.far.disconnect(); this.pan.disconnect(); }
}
// Runs cb when a sound scheduled `delay` s from now is actually heard: the audio is computed ahead
// of the speakers by the output latency, and a flame that goes up before its bang looks wrong.
function fireLater(ctx, delay, cb) {
  const ms = (delay + (ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
  if (ms < 4) cb(); else setTimeout(cb, ms);
}
// Air absorbs treble with distance: full range up close, about 2.5 kHz at 140 m.
const distanceCutoff = (d) => Math.max(2500, Math.min(20000, 20000 * Math.exp(-Math.max(0, d - 8) / 64)));

// ---------- recorded engine (sample banks, e.g. public/sounds/s58) ----------
const BANK_FOR = { s58real: "s58", f458real: "f458", b58real: "b58" };
// the synthesized engine that plays until a bank has loaded, and forever when it is not shipped
const BANK_SYNTH = { s58real: "s58", f458real: "lt2", b58real: "b58" };
const banks = new Map();
function loadBank(ctx, name) {
  if (!banks.has(name)) banks.set(name, (async () => {
    const r = await fetch(`/sounds/${name}/manifest.json`, { cache: "no-cache" });
    if (!r.ok) return null;
    const m = await r.json();
    const decode = async (e) => ({ ...e, buf: await ctx.decodeAudioData(await (await fetch(`/sounds/${name}/${e.file}`)).arrayBuffer()) });
    const out = {};
    for (const g of ["on", "off", "pops", "flutter", "shift"]) out[g] = await Promise.all((m[g] || []).map(decode));
    // A bank whose own one-shots are unusable borrows them from a related engine rather than
    // shipping guesses: the S58 set's pops and shifts were picked out of an unnamed bank and did
    // not behave like one-shots, so it takes the named B58 bank's instead.
    if (m.oneShotsFrom && m.oneShotsFrom !== name) {
      const other = await loadBank(ctx, m.oneShotsFrom);
      if (other) for (const g of ["pops", "flutter", "shift"]) if (!out[g].length) out[g] = other[g] || [];
    }
    return out;
  })().catch(() => null));
  return banks.get(name);
}

// How far the recorded afterfire one-shots sit above the engine loops. Matches POP_GAIN in
// engine-dsp.js so the synth and the sampled engines bang at the same level.
const POP_GAIN = 1.85;

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
    this.far = ctx.createBiquadFilter(); this.far.type = "lowpass"; this.far.frequency.value = 20000; this.far.Q.value = .5;
    this.master.connect(this.tone).connect(this.far).connect(this.out).connect(this.pan).connect(am.engineBus);
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
    this.thr = 0; this.rpm = 900; this.peakThr = 0; this.load = 0; this.boostN = 0; this.gear = 1; this.warmth = 1;
    this.tuneState = { ...DEFAULT_TUNE };
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
  params(a, b, c) {
    const s = asState(a, b, c), t = this.ctx.currentTime, rpm = s.rpm;
    this.rpm = rpm; this.gear = s.gear || this.gear;
    if (s.warmth !== undefined) this.warmth = s.warmth;
    this.thr += ((s.throttle || 0) - this.thr) * .3;
    // blend the on/off-throttle ladders by real engine load so coasting at speed sounds like coasting
    const drive = Math.max(this.thr * .55, Math.min(1, s.load !== undefined ? s.load : this.thr));
    this.load += (drive - this.load) * .3;
    this.boostN += ((s.boostNorm || 0) - this.boostN) * .25;
    this.peakThr = Math.max(this.peakThr * .97, this.thr);
    const wOn = this.weights("on", rpm), wOff = this.weights("off", rpm);
    for (const l of this.layers) {
      const w = (l.kind === "on" ? wOn : wOff).get(l);
      const level = l.kind === "on" ? .25 + .75 * this.load : (1 - this.load) * 2.1;
      l.g.gain.setTargetAtTime(w * level, t, .04);
      if (w > 0) l.src.playbackRate.setTargetAtTime(Math.max(.55, Math.min(1.7, rpm / l.rpm)), t, .03);
    }
    const sport = this.mode === "sport";
    this.master.gain.setTargetAtTime((s.gain || 0) * .3 * this.tuneState.exhaust * (sport ? 1 : .65), t, .06);
    this.tone.frequency.setTargetAtTime(sport ? 6500 : 3800, t, .2);
  }
  // same decel-fuel-cut model the synth uses, so recorded and synthesised engines behave alike
  intensity(info = {}) {
    const T = this.tuneState;
    return burbleIntensity({
      rpm: info.rpm ?? this.rpm, load: info.load ?? this.load, release: info.release ?? 6,
      boost: info.boost ?? this.boostN, gear: info.gear ?? this.gear, warmth: this.warmth,
      redline: T.redline || 7000, burbleRpm: T.burbleRpm || 3000,
      burble: T.burble, crackle: 1, sport: this.mode === "sport",
    });
  }
  // An afterfire built from scratch, for a bank that ships loops but no one-shots (the 458 set).
  // A real pop is three things at once: a sharp crack of burning gas, the pipe ringing at its own
  // pitch, and a low thump of pressure leaving the tail. One noise blip does not read as any of
  // them, which is what made this sound wrong on the C8.
  synthPop(gain, delay = 0) {
    const ctx = this.ctx, t0 = ctx.currentTime + delay + Math.random() * .004;
    const g = gain * (.75 + Math.random() * .5);
    // 1. the crack: a very short noise burst, bright and band-limited
    const n = Math.floor(ctx.sampleRate * .18), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * .07));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const crack = ctx.createBiquadFilter(); crack.type = "bandpass";
    crack.frequency.value = 900 + Math.random() * 1400; crack.Q.value = .9;
    const cg = ctx.createGain(); cg.gain.value = g * .9;
    src.connect(crack).connect(cg).connect(this.out);
    // 2. the pipe ringing: the same burst through a high-Q peak, which gives the pop its pitch
    const ring = ctx.createBiquadFilter(); ring.type = "bandpass";
    ring.frequency.value = 160 + Math.random() * 120; ring.Q.value = 7;
    const rg = ctx.createGain(); rg.gain.value = g * 1.5;
    src.connect(ring).connect(rg).connect(this.out);
    // 3. the thump: a short falling sine, the pressure wave itself
    const o = ctx.createOscillator(), og = ctx.createGain();
    const f0 = 72 + Math.random() * 30;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f0 * .45, t0 + .11);
    og.gain.setValueAtTime(0, t0);
    og.gain.linearRampToValueAtTime(g * 1.1, t0 + .004);
    og.gain.exponentialRampToValueAtTime(.0001, t0 + .13);
    o.connect(og).connect(this.out);
    src.start(t0); o.start(t0); o.stop(t0 + .14);
  }
  shot(list, gain, delay = 0) {
    if (!list || !list.length) return this.synthPop(gain, delay);
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
  // one afterfire one-shot, and the flame that goes with it (gain ~.3-3 here lines up with the synth's pop levels at x1.6)
  pop(gain, delay, big = false) {
    this.shot(this.bank.pops, gain, delay);
    if (this.onFire) fireLater(this.ctx, delay, () => this.onFire?.(gain * 1.6, big));
  }
  // a varied train of real pops: count, level, spacing and pitch all come from the intensity model
  burst(count, amp, gap, spread) {
    // matches the synth: at the minimum burble length it is one bang, not a train
    if ((this.tuneState.decay ?? 1.1) <= .12) { const v = this.tuneState.burbleVol ?? 1; return this.pop(Math.min(POP_GAIN * v * 1.6, (amp * 4 + .5) * POP_GAIN * v), .01, true); }
    let at = .02 + Math.random() * .03;
    for (let i = 0; i < count; i++) {
      const k = i / Math.max(1, count - 1);
      const vol = this.tuneState.burbleVol ?? 1;
      this.pop(Math.min(POP_GAIN * vol, amp * 3 * POP_GAIN * vol * (.5 + Math.random() * .7) * (1 - k * .6)), at);
      at += (gap + Math.random() * spread) * (1 + k * .8);
      if (at > Math.max(.3, this.tuneState.decay) * 1.15) break;
    }
  }
  event(type, info = {}) {
    const T = this.tuneState, sport = this.mode === "sport", b = this.bank;
    if (type === "limiter") this.dip(.045, .45);
    else if (type === "upshift") {
      this.dip(.08, .3);
      const I = this.intensity({ ...info, release: 9 });
      if (sport && T.brap && Math.random() < Math.min(1, .3 + 1.1 * I)) this.burst(Math.min(5, 2 + Math.round(I * 4)), .5 * I + .16, .04, .035);
      if (b.shift?.length) this.shot(b.shift, .28);   // no synth fallback: guarded by the length check
    } else if (type === "downshift") {
      const I = Math.max(this.intensity({ ...info, release: 7 }), sport ? .12 : 0);
      if (I > .04) this.burst(2 + Math.round(I * 3), .4 * I + .1, .06, .045);
      if (b.shift?.length) this.shot(b.shift, .24);
    } else if (type === "lift") {
      const I = this.intensity(info);
      if (I > .05) this.burst(Math.min(10, 2 + Math.round(I * 9)), .3 * I, .06, .06);
      if (T.release !== "off" && (T.turbo > 0 || T.t51r) && this.boostN > .15 && b.flutter?.length) this.shot(b.flutter, Math.min(.4, .2 * (T.flutter || .7) + .12 * this.boostN), .02);
    }
  }
  tune(t, mode) { Object.assign(this.tuneState, t || {}); if (mode) this.mode = mode; }
  setPan(p, vol = 1) { const t = this.ctx.currentTime; this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), t, .05); this.out.gain.setTargetAtTime(vol, t, .05); }
  dispose() { for (const l of this.layers) { try { l.src.stop(); } catch (e) { /* already stopped */ } } this.pan.disconnect(); }
}

// Engine voice facade: the recorded bank when the sound has one and it loaded, synthesized otherwise.
class SmartEngine {
  setDistance(d) { this.state.dist = d; this.voice.setDistance?.(d); }
  constructor(am, profile) { this.am = am; this.voice = null; this.name = null; this.state = {}; this.setProfile(profile); }
  use(voice) {
    if (this.voice) this.voice.dispose();
    this.voice = voice;
    voice.onFire = (amp, big) => this.onFire?.(amp, big);   // set onFire on this facade to see every pop
    const s = this.state;
    if (s.tune) voice.tune(s.tune, s.mode);
    if (s.pan) voice.setPan(s.pan[0], s.pan[1]);
    if (s.params) voice.params(s.params);
    if (s.dist !== undefined) voice.setDistance?.(s.dist);
    if (s.view) voice.event("view", s.view);
  }
  setProfile(name) {
    if (name === this.name) return;
    this.name = name;
    const bankName = BANK_FOR[name];
    const synthName = bankName ? BANK_SYNTH[name] || "b58" : name;
    if (this.voice instanceof EngineVoice) this.voice.setProfile(synthName); else this.use(new EngineVoice(this.am, synthName));
    if (bankName) loadBank(this.am.ctx, bankName).then((bank) => { if (bank && this.name === name) this.use(new SampleVoice(this.am, bank)); });
  }
  params(a, b, c) { const s = asState(a, b, c); this.state.params = s; this.voice.params(s); }
  event(type, info) { if (type === "view") this.state.view = info; this.voice.event(type, info); }
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
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.25;
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
    this.tunnelVerb.buffer = this.tunnelImpulse();
    this.tunnelSend = ctx.createGain(); this.tunnelSend.gain.value = 0;
    const tlp = ctx.createBiquadFilter(); tlp.type = "lowpass"; tlp.frequency.value = 5600; // bare concrete keeps more bite
    this.engineBus.connect(this.tunnelSend); this.fx.connect(this.tunnelSend);
    this.tunnelSend.connect(tlp).connect(this.tunnelVerb).connect(this.master);
    this.echo = ctx.createDelay(1); this.echo.delayTime.value = .09;
    const efb = ctx.createGain(); efb.gain.value = .52;
    const elp = ctx.createBiquadFilter(); elp.type = "lowpass"; elp.frequency.value = 2400;
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0;
    this.engineBus.connect(this.echoSend);
    this.echoSend.connect(this.echo); this.echo.connect(elp); elp.connect(efb).connect(this.echo); elp.connect(this.master);
    // Slap-back off the surroundings: a building face ~20 m away returns the engine ~120 ms later, a
    // little later on the far side, so each ear gets its own reflection; the low highway barriers
    // return a weaker, earlier one. Concrete and glass dull the top of it.
    this.slapSend = ctx.createGain(); this.slapSend.gain.value = 0;
    const slapLP = ctx.createBiquadFilter(); slapLP.type = "lowpass"; slapLP.frequency.value = 3200;
    this.engineBus.connect(this.slapSend); this.fx.connect(this.slapSend); this.slapSend.connect(slapLP);
    this.slap = [-1, 1].map((side) => {
      const d = ctx.createDelay(.4), p = ctx.createStereoPanner(); p.pan.value = side * .85;
      slapLP.connect(d).connect(p).connect(this.master);
      return d;
    });
    this.applyVolumes();

    this.noiseBuf = this.makeNoise(3);
    this.brownBuf = this.makeNoise(3, true);
    this.wind = this.loop(this.noiseBuf, "bandpass", 500, 0.6, this.windBus);
    this.road = this.loop(this.brownBuf, "lowpass", 160, 0.7, this.windBus);
    this.rain = this.loop(this.noiseBuf, "highpass", 1800, 0.5, this.windBus);
    this.rainLow = this.loop(this.brownBuf, "lowpass", 600, 0.5, this.windBus);
    this.scrape = this.loop(this.noiseBuf, "bandpass", 2400, 3);
    // tyres: a resonant squeal for slides, a lower scrub for wheelspin, both driven from the physics
    this.squeal = this.loop(this.noiseBuf, "bandpass", 1150, 9);
    this.squeal2 = this.loop(this.noiseBuf, "bandpass", 2300, 12);
    this.scrub = this.loop(this.brownBuf, "bandpass", 420, 1.6);

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
    this.engineBus.gain.setTargetAtTime(this.vol.engine * .75, t, 0.05);
    this.fx.gain.setTargetAtTime(this.vol.fx, t, 0.05);
    this.windBus.gain.setTargetAtTime(this.vol.wind ?? .35, t, 0.05);
  }
  setTunnel(f) {
    if (!this.ctx) return;
    this.set(this.tunnelSend.gain, f * 2.35, .25);
    this.set(this.echoSend.gain, f * .72, .25);
  }
  setReverb(amount) { if (this.ctx) this.reverbSend.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.5); }
  // city 0..1: how built-up the roadside is (world.cityAt). Open highway still has its barriers.
  setEnv(city) {
    if (!this.slap) return;
    const t = this.ctx.currentTime;
    this.slapSend.gain.setTargetAtTime(.07 + city * .23, t, .4);
    this.slap[0].delayTime.setTargetAtTime(.07 + city * .048, t, .4);    // ~12 m barrier -> ~20 m building face
    this.slap[1].delayTime.setTargetAtTime(.078 + city * .058, t, .4);
  }
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
  // A tunnel is a long hard-walled tube: a short gap, a burst of discrete wall reflections, then a
  // dense tail that lasts a few seconds and loses its highs first (bare concrete absorbs treble
  // faster than bass). The old impulse was plain decaying noise, which just sounds like a fuzzy tail.
  tunnelImpulse() {
    const sr = this.ctx.sampleRate, sec = 3.4, len = Math.floor(sr * sec), b = this.ctx.createBuffer(2, len, sr);
    const early = [[.009, .9], [.017, .75], [.026, .8], [.038, .6], [.051, .55], [.069, .45], [.093, .38], [.121, .3]];
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // treble dies faster than bass: the low-pass gets heavier as the tail goes on
        const k = .55 - .5 * Math.min(1, t / 1.8);
        lp += (((Math.random() * 2 - 1)) - lp) * k;
        const gate = Math.min(1, Math.max(0, (t - .012) / .03));    // little pre-delay, then the tail swells in
        d[i] = lp * Math.exp(-t * 1.75) * gate * 2.5;
      }
      for (const [tt, amp] of early) {
        const i = Math.floor((tt + (c ? .0023 : 0)) * sr);   // slightly different times per ear = width
        if (i < len) d[i] += amp * (c ? -1 : 1) * .9;
      }
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

  // two-tone wail; level 0 silences it
  siren(level, pan = 0) {
    if (!this.ready) return;
    if (!this.sirenNodes && level > 0) {
      const o = this.ctx.createOscillator(), lfo = this.ctx.createOscillator(), depth = this.ctx.createGain(), g = this.ctx.createGain(), p = this.ctx.createStereoPanner();
      o.type = "square"; o.frequency.value = 900; lfo.frequency.value = .55; depth.gain.value = 320;
      const lp = this.ctx.createBiquadFilter(); lp.frequency.value = 2200;
      lfo.connect(depth).connect(o.frequency); o.connect(lp).connect(g).connect(p).connect(this.fx);
      g.gain.value = 0; o.start(); lfo.start();
      this.sirenNodes = { g, p };
    }
    if (this.sirenNodes) { this.set(this.sirenNodes.g.gain, level * .09, .2); this.set(this.sirenNodes.p.pan, pan, .2); }
  }
  // slide 0..1 (lateral), spin 0..1 (wheelspin), speed km/h
  tires(slide, spin, kmh) {
    if (!this.ready) return;
    const sq = Math.min(1, slide * 1.4 + spin * .9) * Math.min(1, .3 + kmh / 60);
    this.set(this.squeal.g.gain, sq * .22, .05);
    this.set(this.squeal.f.frequency, 950 + slide * 500 + spin * 300, .08);
    this.set(this.squeal2.g.gain, sq * sq * .08, .05);
    this.set(this.scrub.g.gain, Math.min(1, slide + spin) * .3, .06);
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
  // tier 0..3 = near miss .. insane: closer passes ring extra notes on top; a streak milestone
  // (x5, x10 ...) finishes with a quick rising run
  closeCall(combo, tier = 0, streak = false) {
    if (!this.ready) return;
    const base = 660 * Math.pow(2, Math.min(combo - 1, 12) / 12);
    this.tone({ type: "triangle", f0: base, d: 0.12, peak: 0.16 });
    this.tone({ type: "triangle", f0: base * 1.5, d: 0.25, peak: 0.14, delay: 0.07 });
    if (tier >= 2) this.tone({ type: "triangle", f0: base * 2, d: 0.3, peak: 0.1, delay: 0.14 });
    if (tier >= 3) this.tone({ type: "sine", f0: base * 3, d: 0.4, peak: 0.07, delay: 0.21 });
    if (streak) [1, 1.26, 1.5, 2].forEach((m, i) => this.tone({ type: "square", f0: base * m, d: 0.09, peak: 0.045, delay: 0.3 + i * 0.07 }));
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
  // Someone leaning on the horn at you: a car's two-tone horn (one long blast or two short ones,
  // each car its own pitch) or a truck's air horn. vol falls off with distance.
  honk(pan, heavy = false, vol = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime + .02;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    const lp = ctx.createBiquadFilter(); lp.frequency.value = heavy ? 1400 : 2200;
    const g = ctx.createGain(); g.gain.value = 0;
    lp.connect(g).connect(p).connect(this.fx);
    const pitch = .9 + Math.random() * .22;
    const freqs = heavy ? [185, 233, 277] : [415 * pitch, 523 * pitch];
    const beeps = heavy ? [[0, .9]] : Math.random() < .45 ? [[0, .45]] : [[0, .16], [.24, .2]];
    const peak = (heavy ? .075 : .06) * vol;
    for (const [at, len] of beeps) {
      g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(peak, t0 + at + .015);
      g.gain.setValueAtTime(peak, t0 + at + len); g.gain.linearRampToValueAtTime(0, t0 + at + len + .04);
    }
    const last = beeps[beeps.length - 1], end = t0 + last[0] + last[1] + .1;
    for (const f of freqs) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(lp); o.start(t0); o.stop(end); }
    setTimeout(() => p.disconnect(), (end - ctx.currentTime + .3) * 1000);
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
