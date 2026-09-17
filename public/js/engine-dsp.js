// Procedural combustion-engine synth (pure DSP, runs in an AudioWorklet or ScriptProcessor).
//
// Model, per sample:
//   crank angle -> each cylinder fires a pressure pulse (fast rise, exponential decay) with
//   cycle-to-cycle variation, per-cylinder strength and runner delay
//   -> header pipe + main pipe (quarter-wave waveguides: negative-reflection combs, damped)
//   -> muffler (2-pole lowpass whose cutoff opens with load / sport mode)
//   -> body + bark resonances, sub rumble, tonal induction growl
//   -> turbo whistle / flutter / blow-off, supercharger whine, afterfire burbles & crackles
//   -> gentle saturation -> DC block
// Noise only ever appears gated by combustion events, never as a continuous bed.

function biquad(type, f, q, sr) {
  const w = (2 * Math.PI * Math.min(f, sr * .45)) / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), n = 1 + a;
  if (type === "bp") return { b0: a / n, b1: 0, b2: -a / n, a1: (-2 * c) / n, a2: (1 - a) / n, x1: 0, x2: 0, y1: 0, y2: 0 };
  return { b0: (1 - c) / 2 / n, b1: (1 - c) / n, b2: (1 - c) / 2 / n, a1: (-2 * c) / n, a2: (1 - a) / n, x1: 0, x2: 0, y1: 0, y2: 0 }; // lp
}
function setLP(s, f, q, sr) { const t = biquad("lp", f, q, sr); s.b0 = t.b0; s.b1 = t.b1; s.b2 = t.b2; s.a1 = t.a1; s.a2 = t.a2; }
function run(s, x) {
  const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
  s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
  return y;
}
const even = (n) => Array.from({ length: n }, (_, i) => (720 / n) * i);
const V8X = [1, .7, .74, 1, .76, 1, .72, 1];

// header/pipe: waveguide fundamentals (Hz); muffler: base lowpass (Hz); body/bark: [Hz, Q, gain]
// rough: combustion grit; var: cycle variation; sub: half-order rumble; turbo/blower: 0..1.2
export const ENGINE_PROFILES = {
  b58:     { label: "BMW B58 3.0 Turbo I6", cyl: 6, fire: even(6), amps: [1, .97, .99, .96, 1, .98], var: .04, header: 470, pipe: 104, fb: .55, muffler: 1250, body: [108, .8, 1.15], bark: [330, 1.2, .75], rough: .08, sub: .22, drive: 1.5, turbo: .9, turboPitch: 2600, crackle: 1, gain: 1 },
  s58:     { label: "BMW S58 3.0 Twin-Turbo I6", cyl: 6, fire: even(6), amps: [1, .96, .99, .95, 1, .97], var: .05, header: 520, pipe: 116, fb: .52, muffler: 1850, body: [118, .85, 1.05], bark: [410, 1.3, .95], rough: .14, sub: .2, drive: 1.7, turbo: 1, turboPitch: 2900, crackle: 1.1, gain: .95 },
  s63:     { label: "BMW S63 4.4 Twin-Turbo V8", cyl: 8, fire: even(8), amps: [1, .9, .93, 1, .92, .98, .9, .97], var: .05, header: 400, pipe: 84, fb: .56, muffler: 1000, body: [82, .8, 1.3], bark: [250, 1.1, .75], rough: .1, sub: .45, drive: 1.6, turbo: .7, turboPitch: 2300, crackle: .9, gain: 1 },
  vr30:    { label: "Nissan VR30 3.0 Twin-Turbo V6", cyl: 6, fire: even(6), amps: [1, .86, .95, .88, 1, .85], var: .06, header: 540, pipe: 124, fb: .52, muffler: 1950, body: [125, .9, .95], bark: [450, 1.4, 1], rough: .16, sub: .3, drive: 1.8, turbo: 1.1, turboPitch: 3000, crackle: 1.1, gain: .95 },
  vr38:    { label: "Nissan VR38 3.8 Twin-Turbo V6", cyl: 6, fire: even(6), amps: [1, .93, .97, .92, 1, .94], var: .05, header: 560, pipe: 138, fb: .5, muffler: 2100, body: [135, .9, .9], bark: [500, 1.4, .85], rough: .12, sub: .2, drive: 1.6, turbo: 1.2, turboPitch: 3600, crackle: .7, gain: .95 },
  amg:     { label: "AMG 4.0 Twin-Turbo V8", cyl: 8, fire: even(8), amps: [1, .8, .82, 1, .82, 1, .8, 1], var: .07, jitter: .012, header: 420, pipe: 86, fb: .58, muffler: 1400, body: [86, .8, 1.35], bark: [280, 1.2, 1.05], rough: .18, sub: .5, drive: 2, turbo: .5, turboPitch: 2400, crackle: 1.3, gain: .9 },
  hellcat: { label: "Supercharged 6.2 HEMI V8", cyl: 8, fire: even(8), amps: V8X, var: .08, jitter: .02, header: 360, pipe: 78, fb: .58, muffler: 1300, body: [76, .8, 1.45], bark: [255, 1.1, 1], rough: .16, sub: .65, drive: 2, blower: 1, crackle: .8, gain: .9 },
  lt2:     { label: "Chevy LT2 6.2 V8", cyl: 8, fire: even(8), amps: V8X, var: .07, jitter: .015, header: 400, pipe: 88, fb: .56, muffler: 1550, body: [84, .8, 1.35], bark: [300, 1.2, 1], rough: .15, sub: .55, drive: 1.9, crackle: .8, gain: .92 },
  i5:      { label: "Audi 2.5 TFSI I5", cyl: 5, fire: even(5), amps: [1, .9, .96, .88, .94], var: .05, header: 500, pipe: 114, fb: .55, muffler: 1800, body: [115, .9, 1.05], bark: [380, 1.3, .9], rough: .14, sub: .45, drive: 1.7, turbo: .8, turboPitch: 3000, crackle: 1, gain: .95 },
  i4:      { label: "2.0 Turbo I4", cyl: 4, fire: even(4), amps: [1, .95, .98, .93], var: .05, header: 520, pipe: 150, fb: .5, muffler: 1600, body: [140, .9, .9], bark: [420, 1.3, .65], rough: .12, sub: .15, drive: 1.4, turbo: .8, turboPitch: 3200, crackle: .7, gain: 1.05 },
  v6:      { label: "3.5 V6", cyl: 6, fire: even(6), amps: [1, .84, .95, .87, 1, .82], var: .05, header: 500, pipe: 120, fb: .52, muffler: 1500, body: [120, .9, 1], bark: [400, 1.3, .7], rough: .12, sub: .3, drive: 1.5, turbo: .3, turboPitch: 2800, crackle: .6, gain: 1 },
  v8x:     { label: "Muscle 5.0 V8", cyl: 8, fire: even(8), amps: V8X, var: .08, jitter: .02, header: 380, pipe: 80, fb: .58, muffler: 1100, body: [80, .8, 1.3], bark: [240, 1.1, .9], rough: .14, sub: .6, drive: 1.8, crackle: .9, gain: .92 },
  f6:      { label: "Flat-6", cyl: 6, fire: even(6), amps: [1, .95, .98, .93, 1, .96], var: .04, header: 600, pipe: 150, fb: .5, muffler: 2600, body: [150, .9, .8], bark: [560, 1.4, .9], rough: .12, sub: .15, drive: 1.7, crackle: .5, gain: .95 },
  v10:     { label: "V10", cyl: 10, fire: even(10), amps: [1, .9, .95, .88, 1, .92, .97, .9, 1, .9], var: .04, header: 620, pipe: 160, fb: .5, muffler: 3000, body: [160, .9, .8], bark: [620, 1.5, 1], rough: .1, sub: .12, drive: 1.7, crackle: .7, gain: .92 },
  svj:     { label: "Lamborghini 6.5 V12 (SVJ)", cyl: 12, fire: even(12), amps: [1, .95, .98, .94, 1, .96, .99, .93, 1, .95, .97, .94], var: .035, header: 780, pipe: 198, fb: .5, muffler: 3700, body: [190, .9, .8], bark: [760, 1.5, 1.1], rough: .14, sub: .14, drive: 1.95, crackle: 1.25, gain: .9 },
  v12:     { label: "V12", cyl: 12, fire: even(12), amps: [1, .96, .98, .95, 1, .97, .99, .95, 1, .96, .98, .95], var: .03, header: 700, pipe: 185, fb: .48, muffler: 3300, body: [180, .9, .7], bark: [700, 1.5, .9], rough: .08, sub: .1, drive: 1.6, crackle: .5, gain: .92 },
};
export const SOUND_KEYS = Object.keys(ENGINE_PROFILES);
export const DEFAULT_TUNE = { burble: 1, decay: 1.1, mix: .35, brap: true, turbo: 1, exhaust: 1, rasp: 1, release: "flutter" };

class Delay {
  constructor(n) { this.b = new Float32Array(n); this.w = 0; this.lp = 0; this.len = 16; }
  // quarter-wave pipe: open end reflects inverted, losses via lowpass in the loop
  pipe(x, fb, damp) {
    const b = this.b, L = b.length;
    const r = b[(this.w - this.len + L) % L];
    this.lp += (r - this.lp) * damp;
    const y = x - this.lp * fb;
    b[this.w] = y; this.w = (this.w + 1) % L;
    return y;
  }
}

export class EngineDSP {
  constructor(sr) {
    this.sr = sr;
    this.rpm = 900; this.tRpm = 900;
    this.thr = 0; this.tThr = 0;
    this.gain = 0; this.tGain = 0;
    this.crank = 0;
    this.cut = 0; this.crackle = 0; this.blip = 0;
    this.pulses = []; this.pops = []; this.chirps = [];
    this.seed = (Math.random() * 1e9) | 0;
    this.header = new Delay(1024); this.main = new Delay(4096);
    this.dc = 0; this.dcIn = 0; this.rumble = 0;
    this.boost = 0; this.whistle = 0; this.bov = 0;
    this.flutter = 0; this.flutterT = 0; this.nextChirp = 0;
    this.blowerPh = 0;
    this.tune = { ...DEFAULT_TUNE }; this.mode = "sport";
    this.setProfile("b58");
  }
  rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  setProfile(name) {
    const p = ENGINE_PROFILES[name] || ENGINE_PROFILES.b58, sr = this.sr;
    this.p = p;
    this.fireFrac = p.fire.map((d) => d / 720);
    this.runner = p.fire.map((_, i) => ((i * 7919) % 13) / 13 * .0009); // 0..0.9 ms runner length spread
    this.header.len = Math.max(4, Math.round(sr / (2 * p.header)));
    this.main.len = Math.max(8, Math.min(4000, Math.round(sr / (2 * p.pipe))));
    this.muff = biquad("lp", p.muffler, .7, sr);
    this.muff2 = biquad("lp", p.muffler * 1.4, .6, sr);
    this.bodyF = biquad("bp", p.body[0], p.body[1], sr);
    this.barkF = biquad("bp", p.bark[0], p.bark[1], sr);
    this.inductF = biquad("bp", p.bark[0] * 1.6, 1.5, sr);
    this.crackF = biquad("bp", 2800, 1.3, sr);
    this.raspLP = biquad("lp", 850, .7, sr);
    this.chirpF = biquad("bp", 2100, 2.2, sr);
    this.bovF = biquad("bp", 3400, .9, sr);
  }
  message(m) {
    const t = this.tune, sport = this.mode === "sport";
    switch (m.type) {
      case "params": this.tRpm = m.rpm; this.tThr = m.throttle; this.tGain = m.gain; break;
      case "profile": this.setProfile(m.name); break;
      case "tune": Object.assign(t, m.tune || {}); if (m.mode) this.mode = m.mode; break;
      case "upshift":
        this.cut = sport ? .07 : .03;
        if (sport && t.brap) { this.addPop(1.2 * Math.min(1.5, t.burble + .3), .05); this.addPop(.5, .03, .05, true); }
        if (this.boost > .3) this.release(.45);
        break;
      case "downshift":
        this.blip = sport ? .15 : .08;
        this.crackle = Math.min(1.2, this.crackle + (sport ? .95 : .15) * p0(this));
        break;
      case "limiter": this.cut = .045; break;
      case "lift":
        this.crackle = Math.min(1.2, this.crackle + (sport ? .5 : .06) * p0(this));
        if (this.boost > .2) this.release(1);
        break;
      case "pop": this.addPop(m.v ?? .8, .05); break;
    }
  }
  release(k) {
    const p = this.p, t = this.tune;
    if (!p.turbo || t.turbo <= 0 || t.release === "off") return;
    const amt = this.boost * p.turbo * t.turbo * k;
    if (t.release === "bov") this.bov = Math.max(this.bov, amt);
    else { this.flutter = Math.max(this.flutter, amt); this.flutterT = 0; this.nextChirp = .01; }
  }
  addPop(amp, dur, delay = 0, sharp = false) {
    if (this.pops.length > 14) return;
    this.pops.push({ t: -delay, dur: dur * (.7 + this.rand() * .6), amp, sharp });
  }
  process(out) {
    const n = out.length, sr = this.sr, p = this.p, t = this.tune, dt = 1 / sr;
    const sport = this.mode === "sport";
    const kR = 1 - Math.exp(-1 / (sr * .045));
    const kT = 1 - Math.exp(-1 / (sr * .03));
    const kG = 1 - Math.exp(-1 / (sr * .08));
    // muffler opens with load; comfort keeps the valves shut
    const open = (sport ? 1.5 : .75) * (.55 + .45 * this.thr) * (.9 + .4 * Math.min(1, this.rpm / 7000)) * (.8 + .2 * t.exhaust);
    setLP(this.muff, p.muffler * open, .75, sr);
    setLP(this.muff2, p.muffler * open * 2.6, .6, sr);
    const eager = p.crackle * t.burble * (sport ? 1 : .12);
    const outGain = p.gain * t.exhaust * (sport ? 1 : .62);
    if (sport && this.tThr < .08 && this.tRpm > 2400) this.crackle = Math.max(this.crackle, .16 * t.burble * p.crackle);

    for (let i = 0; i < n; i++) {
      let target = this.tRpm;
      if (this.blip > 0) { this.blip -= dt; target = Math.max(target, this.tRpm * 1.15); }
      this.rpm += (target - this.rpm) * (this.blip > 0 ? kR * 3 : kR);
      this.thr += ((this.blip > 0 ? .85 : this.tThr) - this.thr) * kT;
      this.gain += (this.tGain - this.gain) * kG;
      if (this.cut > 0) this.cut -= dt;
      const rpm = this.rpm, thr = this.thr, rn = Math.min(1.2, rpm / 7000);

      // ---- combustion ----
      const prev = this.crank;
      this.crank += rpm / 120 / sr;
      const wrapped = this.crank >= 1;
      if (wrapped) this.crank -= 1;
      const fireHz = (rpm / 120) * p.cyl;
      const tau = Math.min(.0055, Math.max(.0007, .3 / fireHz));
      for (let c = 0; c < this.fireFrac.length; c++) {
        const f = this.fireFrac[c];
        if (!(wrapped ? (f >= prev || f < this.crank) : (f >= prev && f < this.crank))) continue;
        const load = this.cut > 0 ? .02 : .16 + .84 * thr;
        const lope = p.jitter ? (this.rand() - .5) * p.jitter * .06 * Math.max(0, 1 - rpm / 3000) : 0;
        const a = p.amps[c] * load * (1 + (this.rand() - .5) * 2 * p.var) * (1 + lope * 20);
        if (this.pulses.length < 8) this.pulses.push({ t: -(this.runner[c] + Math.max(0, lope)), a, tau });
        if (thr < .12 && rpm > 2000 && this.crackle > .02 && this.rand() < this.crackle * .3 * eager) {
          const sharp = this.rand() < t.mix;
          this.addPop((.25 + this.rand() * .9) * Math.min(1.6, t.burble + .2) * this.crackle, sharp ? .006 + this.rand() * .01 : .02 + this.rand() * .035, this.rand() * .004, sharp);
        }
      }
      let exc = 0, env = 0;
      for (let k = this.pulses.length - 1; k >= 0; k--) {
        const P = this.pulses[k];
        P.t += dt;
        if (P.t < 0) continue;
        const e = Math.exp(-P.t / P.tau) - Math.exp(-P.t / (P.tau * .06));
        exc += P.a * e; env += P.a * Math.exp(-P.t / P.tau);
        if (P.t > P.tau * 7) this.pulses.splice(k, 1);
      }
      const nz = this.rand() * 2 - 1;
      exc += nz * env * p.rough * (sport ? 1 : .6);

      // afterfire: pressure pops go through the exhaust, sharp cracks bypass the muffler
      let crack = 0;
      for (let k = this.pops.length - 1; k >= 0; k--) {
        const P = this.pops[k];
        P.t += dt;
        if (P.t < 0) continue;
        if (P.t > P.dur) { this.pops.splice(k, 1); continue; }
        const e = Math.exp(-P.t / (P.dur * .25));
        if (P.sharp) crack += nz * e * P.amp;
        else exc += P.amp * 2.2 * (e - Math.exp(-P.t / .0006)) + nz * e * P.amp * .5;
      }

      // ---- exhaust system ----
      let y = this.header.pipe(exc, .35, .5);
      y = this.main.pipe(y, p.fb, .32);
      const drive = p.drive * (.7 + .5 * thr) * (sport ? 1 : .8);
      y = Math.tanh(y * drive) / Math.tanh(drive);
      const muffled = run(this.muff2, run(this.muff, y));
      let o = muffled * .9
        + run(this.bodyF, y) * p.body[2] * (.9 - .2 * thr)
        + run(this.barkF, y) * p.bark[2] * (.25 + .75 * thr) * (sport ? 1.15 : .45);
      this.rumble += (y - this.rumble) * .004;
      o += this.rumble * p.sub * 2.2;
      o += (y - run(this.raspLP, y)) * (.25 + thr) * (sport ? .8 : .2) * (.3 + p.rough * 4) * t.rasp;
      o += run(this.inductF, exc) * thr * rn * .35; // tonal induction growl
      o += run(this.crackF, crack) * 2.4;

      // ---- forced induction ----
      if (p.turbo) {
        const want = thr > .25 ? thr * Math.max(0, Math.min(1, (rpm - 1500) / 2600)) : 0;
        this.boost += (want - this.boost) * (want > this.boost ? dt / .8 : dt / .55);
        const b2 = this.boost * this.boost;
        this.whistle += (p.turboPitch + this.boost * 3800 + rpm * .12) * dt;
        o += Math.sin(this.whistle * 6.2832) * b2 * .014 * p.turbo * t.turbo;
        o += Math.sin(this.whistle * 12.566 + 1) * b2 * .004 * p.turbo * t.turbo;
        if (this.flutter > .004) { // compressor surge: slowing train of chirps
          this.flutterT += dt; this.nextChirp -= dt;
          if (this.nextChirp <= 0) {
            this.chirps.push({ t: 0, dur: .011 + this.rand() * .007, amp: this.flutter * (.7 + this.rand() * .3) });
            this.nextChirp = .03 + this.flutterT * .07 + this.rand() * .006;
            this.flutter *= .83;
            if (this.flutterT > .9) this.flutter = 0;
          }
        }
        if (this.bov > .003) { o += run(this.bovF, nz) * this.bov * .5; this.bov *= 1 - dt / .16; }
      }
      if (this.chirps.length) {
        let ch = 0;
        for (let k = this.chirps.length - 1; k >= 0; k--) {
          const C = this.chirps[k];
          C.t += dt;
          if (C.t > C.dur) { this.chirps.splice(k, 1); continue; }
          const e = Math.sin(Math.PI * C.t / C.dur);
          ch += (nz * .8 + Math.sin(C.t * 6.2832 * 190) * .6) * e * C.amp;
        }
        o += run(this.chirpF, ch) * 1.6 + ch * .08;
      }
      if (p.blower) {
        this.blowerPh += (rpm / 60) * 38 * dt;
        o += (Math.sin(this.blowerPh * 6.2832) * .6 + Math.sin(this.blowerPh * 12.566) * .25) * p.blower * (.15 + .85 * thr) * rn * .012 * t.turbo;
      }

      const dcOut = o - this.dcIn + .996 * this.dc;
      this.dcIn = o; this.dc = dcOut;
      out[i] = Math.tanh(dcOut * .9) * this.gain * outGain;
    }
    const decay = Math.max(.15, t.decay) * (sport ? 1 : .4);
    this.crackle *= Math.exp(-n / sr / decay);
  }
}
function p0(dsp) { return Math.min(2, dsp.tune.burble) * dsp.p.crackle; }
