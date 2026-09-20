// Procedural combustion-engine synth (pure DSP, runs in an AudioWorklet or ScriptProcessor).
//
// Model, per sample:
//   crank angle -> each cylinder fires a pressure pulse (fast rise, exponential decay) scaled by the
//   engine's real LOAD (not raw pedal), with cycle-to-cycle variation, per-cylinder strength and
//   runner delay
//   -> header pipe + main pipe (quarter-wave waveguides: negative-reflection combs, damped)
//   -> muffler (2-pole lowpass whose cutoff opens with load / sport mode)
//   -> three rpm-weighted resonators (chest rumble -> mid growl -> top-end bark) + sub rumble
//   -> intake: runner resonance gated by the same firing events, plus induction roar with boost
//   -> turbo whistle / compressor surge (T51R = deep, slow, loud) / blow-off, supercharger whine
//   -> afterfire burbles and crackles from the decel-fuel-cut model in burbleIntensity()
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
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// header/pipe: waveguide fundamentals (Hz); muffler: base lowpass (Hz); body/bark: [Hz, Q, gain]
// rough: combustion grit; var: cycle variation; sub: half-order rumble; turbo/blower: 0..1.2
// intake: [runner Hz, level]; top: top-end bark multiplier applied above ~65% of the rev range
export const ENGINE_PROFILES = {
  b58:     { label: "BMW B58 3.0 Turbo I6", cyl: 6, fire: even(6), amps: [1, .97, .99, .96, 1, .98], var: .04, header: 470, pipe: 104, fb: .55, muffler: 1250, body: [108, .8, 1.15], bark: [330, 1.2, .75], top: 1.35, intake: [220, .8], rough: .08, sub: .22, drive: 1.5, turbo: .9, turboPitch: 2600, crackle: 1, gain: 1 },
  s58:     { label: "BMW S58 3.0 Twin-Turbo I6", cyl: 6, fire: even(6), amps: [1, .96, .99, .95, 1, .97], var: .05, header: 520, pipe: 116, fb: .52, muffler: 1850, body: [118, .85, 1.05], bark: [410, 1.3, .95], top: 1.5, intake: [240, .9], rough: .14, sub: .2, drive: 1.7, turbo: 1, turboPitch: 2900, crackle: 1.1, gain: .95 },
  s63:     { label: "BMW S63 4.4 Twin-Turbo V8", cyl: 8, fire: even(8), amps: [1, .9, .93, 1, .92, .98, .9, .97], var: .05, header: 400, pipe: 84, fb: .56, muffler: 1000, body: [82, .8, 1.3], bark: [250, 1.1, .75], top: 1.2, intake: [190, .6], rough: .1, sub: .45, drive: 1.6, turbo: .7, turboPitch: 2300, crackle: .9, gain: 1 },
  vr30:    { label: "Nissan VR30 3.0 Twin-Turbo V6", cyl: 6, fire: even(6), amps: [1, .86, .95, .88, 1, .85], var: .06, header: 540, pipe: 124, fb: .52, muffler: 1950, body: [125, .9, .95], bark: [450, 1.4, 1], top: 1.4, intake: [250, .75], rough: .16, sub: .3, drive: 1.8, turbo: 1.1, turboPitch: 3000, crackle: 1.1, gain: .95 },
  vr38:    { label: "Nissan VR38 3.8 Twin-Turbo V6", cyl: 6, fire: even(6), amps: [1, .93, .97, .92, 1, .94], var: .05, header: 560, pipe: 138, fb: .5, muffler: 2100, body: [135, .9, .9], bark: [500, 1.4, .85], top: 1.35, intake: [260, .85], rough: .12, sub: .2, drive: 1.6, turbo: 1.2, turboPitch: 3600, crackle: .7, gain: .95 },
  amg:     { label: "AMG 4.0 Twin-Turbo V8", cyl: 8, fire: even(8), amps: [1, .8, .82, 1, .82, 1, .8, 1], var: .07, jitter: .012, header: 420, pipe: 86, fb: .58, muffler: 1400, body: [86, .8, 1.35], bark: [280, 1.2, 1.05], top: 1.25, intake: [200, .6], rough: .18, sub: .5, drive: 2, turbo: .5, turboPitch: 2400, crackle: 1.3, gain: .9 },
  hellcat: { label: "Supercharged 6.2 HEMI V8", cyl: 8, fire: even(8), amps: V8X, var: .08, jitter: .02, header: 360, pipe: 78, fb: .58, muffler: 1300, body: [76, .8, 1.45], bark: [255, 1.1, 1], top: 1.15, intake: [170, .5], rough: .16, sub: .65, drive: 2, blower: 1, crackle: .8, gain: .9 },
  lt2:     { label: "Chevy LT2 6.2 V8", cyl: 8, fire: even(8), amps: V8X, var: .07, jitter: .015, header: 400, pipe: 88, fb: .56, muffler: 1550, body: [84, .8, 1.35], bark: [300, 1.2, 1], top: 1.3, intake: [185, .7], rough: .15, sub: .55, drive: 1.9, crackle: .8, gain: .92 },
  i5:      { label: "Audi 2.5 TFSI I5", cyl: 5, fire: even(5), amps: [1, .9, .96, .88, .94], var: .05, header: 500, pipe: 114, fb: .55, muffler: 1800, body: [115, .9, 1.05], bark: [380, 1.3, .9], top: 1.4, intake: [230, .8], rough: .14, sub: .45, drive: 1.7, turbo: .8, turboPitch: 3000, crackle: 1, gain: .95 },
  b46:     { label: "BMW B46 2.0T I4", cyl: 4, fire: even(4), amps: [1, .96, .98, .94], var: .04, header: 500, pipe: 140, fb: .52, muffler: 1400, body: [130, .9, 1.0], bark: [390, 1.3, .7], top: 1.2, intake: [250, .8], rough: .1, sub: .2, drive: 1.4, turbo: .8, turboPitch: 3000, crackle: .7, gain: 1.05 },
  ea888:   { label: "Audi EA888 2.0T I4", cyl: 4, fire: even(4), amps: [1, .94, .98, .92], var: .05, header: 540, pipe: 156, fb: .5, muffler: 1700, body: [145, .9, .9], bark: [440, 1.3, .7], top: 1.3, intake: [270, .95], rough: .13, sub: .15, drive: 1.5, turbo: .9, turboPitch: 3300, crackle: .8, gain: 1.05 },
  m264:    { label: "Mercedes M264 2.0T I4", cyl: 4, fire: even(4), amps: [1, .97, .99, .95], var: .035, header: 480, pipe: 132, fb: .54, muffler: 1250, body: [125, .85, 1.05], bark: [360, 1.2, .6], top: 1.1, intake: [240, .7], rough: .08, sub: .22, drive: 1.3, turbo: .7, turboPitch: 2800, crackle: .6, gain: 1.05 },
  i4:      { label: "2.0 Turbo I4", cyl: 4, fire: even(4), amps: [1, .95, .98, .93], var: .05, header: 520, pipe: 150, fb: .5, muffler: 1600, body: [140, .9, .9], bark: [420, 1.3, .65], top: 1.3, intake: [265, .85], rough: .12, sub: .15, drive: 1.4, turbo: .8, turboPitch: 3200, crackle: .7, gain: 1.05 },
  v6:      { label: "3.5 V6", cyl: 6, fire: even(6), amps: [1, .84, .95, .87, 1, .82], var: .05, header: 500, pipe: 120, fb: .52, muffler: 1500, body: [120, .9, 1], bark: [400, 1.3, .7], top: 1.25, intake: [230, .5], rough: .12, sub: .3, drive: 1.5, turbo: .3, turboPitch: 2800, crackle: .6, gain: 1 },
  v8x:     { label: "Muscle 5.0 V8", cyl: 8, fire: even(8), amps: V8X, var: .08, jitter: .02, header: 380, pipe: 80, fb: .58, muffler: 1100, body: [80, .8, 1.3], bark: [240, 1.1, .9], top: 1.25, intake: [180, .65], rough: .14, sub: .6, drive: 1.8, crackle: .9, gain: .92 },
  f6:      { label: "Flat-6", cyl: 6, fire: even(6), amps: [1, .95, .98, .93, 1, .96], var: .04, header: 600, pipe: 150, fb: .5, muffler: 2600, body: [150, .9, .8], bark: [560, 1.4, .9], top: 1.6, intake: [300, .95], rough: .12, sub: .15, drive: 1.7, crackle: .5, gain: .95 },
  v10:     { label: "V10", cyl: 10, fire: even(10), amps: [1, .9, .95, .88, 1, .92, .97, .9, 1, .9], var: .04, header: 620, pipe: 160, fb: .5, muffler: 3000, body: [160, .9, .8], bark: [620, 1.5, 1], top: 1.7, intake: [320, 1], rough: .1, sub: .12, drive: 1.7, crackle: .7, gain: .92 },
  svj:     { label: "Lamborghini 6.5 V12 (SVJ)", cyl: 12, fire: even(12), amps: [1, .95, .98, .94, 1, .96, .99, .93, 1, .95, .97, .94], var: .035, header: 820, pipe: 205, fb: .5, muffler: 4000, body: [190, .9, .75], bark: [780, 1.6, 1.2], top: 2.3, intake: [380, 1.2], rough: .16, sub: .12, drive: 2.1, crackle: 1.6, gain: .88, scream: [1, .9, 1.4] },
  gt3:     { label: "Porsche 4.0 flat-six (GT3 RS)", cyl: 6, fire: even(6), amps: [1, .96, .99, .95, 1, .97], var: .03, header: 660, pipe: 172, fb: .48, muffler: 3400, body: [165, .9, .7], bark: [620, 1.6, 1.05], top: 2.1, intake: [340, 1.5], rough: .1, sub: .1, drive: 1.8, crackle: 1.1, gain: .92, scream: [2, .75, .9], mech: 1 },
  w16:     { label: "Bugatti 8.0 Quad-Turbo W16", cyl: 16, fire: even(16), amps: Array.from({ length: 16 }, (_, i) => [1, .96, .98, .95][i % 4]), var: .03, header: 760, pipe: 200, fb: .5, muffler: 2800, body: [170, .9, .8], bark: [640, 1.4, .9], top: 1.5, intake: [330, 1], rough: .1, sub: .2, drive: 1.8, turbo: 1.1, turboPitch: 3200, crackle: 1.1, gain: .9 },
  v12:     { label: "V12", cyl: 12, fire: even(12), amps: [1, .96, .98, .95, 1, .97, .99, .95, 1, .96, .98, .95], var: .03, header: 700, pipe: 185, fb: .48, muffler: 3300, body: [180, .9, .7], bark: [700, 1.5, .9], top: 1.7, intake: [340, .95], rough: .08, sub: .1, drive: 1.6, crackle: .5, gain: .92 },
};
export const SOUND_KEYS = Object.keys(ENGINE_PROFILES);
export const SOUND_LABELS = { s58real: "BMW S58 (real recording)", ...Object.fromEntries(Object.entries(ENGINE_PROFILES).map(([k, p]) => [k, p.label])) };
// audio side of a tune; tuning.js builds the real one from the car's parts
// which cars get a dual-clutch shift signature
const SHIFT_STYLE = { b58: "bmw", s58: "bmw", s63: "bmw", b46: "bmw", i5: "audi", ea888: "audi", amg: "merc", m264: "merc" };
export const DEFAULT_TUNE = { burble: .75, decay: 1.1, mix: .2, brap: true, turbo: .8, exhaust: .9, rasp: .7, release: "flutter", intake: .35, flutter: .7, lag: 1, t51r: false, redline: 7000, boostMax: 18, burbleRpm: 3000 };

// ---------------------------------------------------------------- the burble model
// How much unburnt fuel reaches the exhaust when the throttle shuts. Everything that matters is an
// input: revs, how hard the engine was pulling, how fast the pedal came up, trapped boost, gear,
// exhaust/catalyst (folded into tune.burble by tuning.js), engine temperature and drive mode.
export function burbleIntensity(o) {
  const rpmN = clamp01((o.rpm - o.burbleRpm) / Math.max(800, o.redline * .82 - o.burbleRpm));
  const rel = clamp01(o.release / 5.5);                 // pedal units per second: a snap lift is ~10
  const loadF = .28 + .72 * clamp01(o.load);
  const boostF = .45 + .55 * clamp01(o.boost);
  const gearF = Math.max(.55, 1 - .07 * Math.max(0, (o.gear || 1) - 1));
  const temp = .6 + .4 * clamp01(o.warmth ?? 1);
  return 1.6 * rpmN * (.4 + .6 * rpmN) * (.35 + .65 * rel) * loadF * boostF * gearF * temp * o.burble * o.crackle * (o.sport ? 1 : .16);
}

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
    this.load = 0; this.tLoad = 0;
    this.boostN = 0; this.tBoost = 0;
    this.gain = 0; this.tGain = 0;
    this.gear = 1; this.warmth = 1; this.overrun = false;
    this.crank = 0;
    this.cut = 0; this.crackle = 0; this.blip = 0;
    this.pulses = []; this.pops = []; this.chirps = []; this.thumps = [];
    this.seed = (Math.random() * 1e9) | 0;
    this.header = new Delay(1024); this.main = new Delay(4096);
    this.dc = 0; this.dcIn = 0; this.rumble = 0;
    this.whistle = 0; this.bov = 0;
    this.flutter = 0; this.flutterT = 0; this.nextChirp = 0;
    this.blowerPh = 0; this.intakePh = 0; this.als = 0; this.alsNext = 0; this.launchHold = 0;
    this.tune = { ...DEFAULT_TUNE }; this.mode = "sport";
    this.lockSport = true;
    this.setProfile("b58");
  }
  rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  setProfile(name) {
    const p = ENGINE_PROFILES[name] || ENGINE_PROFILES.b58, sr = this.sr;
    this.p = p; this.pname = name;
    this.fireFrac = p.fire.map((d) => d / 720);
    this.runner = p.fire.map((_, i) => ((i * 7919) % 13) / 13 * .0009); // 0..0.9 ms runner length spread
    this.header.len = Math.max(4, Math.round(sr / (2 * p.header)));
    this.main.len = Math.max(8, Math.min(4000, Math.round(sr / (2 * p.pipe))));
    this.muff = biquad("lp", p.muffler, .7, sr);
    this.muff2 = biquad("lp", p.muffler * 1.4, .6, sr);
    this.bodyF = biquad("bp", p.body[0], p.body[1], sr);
    this.barkF = biquad("bp", p.bark[0], p.bark[1], sr);
    this.topF = biquad("bp", p.bark[0] * 1.85, 1.6, sr);
    this.inductF = biquad("bp", p.bark[0] * 1.6, 1.5, sr);
    this.intakeF = biquad("bp", (p.intake ? p.intake[0] : 240) * 2, 1.4, sr);
    this.roarF = biquad("bp", 520, .8, sr);
    this.crackF = biquad("bp", 1700, 1.1, sr);
    this.soft = biquad("lp", 4000, .6, sr);
    this.soft2 = biquad("lp", 6500, .5, sr);
    this.raspLP = biquad("lp", 850, .7, sr);
    this.chirpF = biquad("bp", 1500, 1.8, sr);
    this.bovF = biquad("bp", 3400, .9, sr);
  }
  message(m) {
    const t = this.tune;
    switch (m.type) {
      case "params":
        this.tRpm = m.rpm; this.tThr = m.throttle; this.tGain = m.gain;
        if (m.load !== undefined) this.tLoad = m.load;
        if (m.boostNorm !== undefined) this.tBoost = m.boostNorm;
        if (m.gear) this.gear = m.gear;
        if (m.warmth !== undefined) this.warmth = m.warmth;
        if (m.overrun !== undefined) this.overrun = m.overrun;
        break;
      case "profile": this.setProfile(m.name); break;
      case "tune": Object.assign(t, m.tune || {}); this.mode = "sport"; break;
      case "upshift": this.onUpshift(m); break;
      case "downshift": this.onDownshift(m); break;
      case "limiter": this.cut = .03; break;
      case "lift": this.onLift(m); break;
      case "pop": this.addPop(m.v ?? .8, .05); break;
      case "launchArm": this.launchHold = 1; break;
      case "launch": this.launchHold = 0; break;
    }
  }
  // all four event handlers share one intensity model, so nothing fires "randomly"
  intensity(m) {
    const t = this.tune;
    return burbleIntensity({
      rpm: m.rpm ?? this.rpm, load: m.load ?? this.load, release: m.release ?? 6,
      boost: m.boost ?? this.boostN, gear: m.gear ?? this.gear, warmth: this.warmth,
      redline: t.redline || 7000, burbleRpm: t.burbleRpm || 3000,
      burble: t.burble, crackle: this.p.crackle, sport: this.mode === "sport",
    });
  }
  onUpshift(m) {
    const t = this.tune, sport = this.mode === "sport";
    const dsg = SHIFT_STYLE[this.pname];
    this.cut = dsg ? .035 : sport ? .07 : .03;      // dual-clutch cars swap gears almost instantly
    const I = this.intensity({ ...m, release: 9 });
    if (dsg && sport && (m.load ?? this.load) > .25) this.dsgShift(dsg, clamp01(.35 + I));
    // a shift fart needs revs AND load: it does not happen on every single gearchange
    if (sport && t.brap && this.rand() < clamp01(.15 + 1.1 * I)) this.burst(Math.min(3, 1 + Math.round(I * 3)), I * 1.35, .035, .05);
    if (this.boostN > .25) this.release(.45);
  }
  // dual-clutch shift signatures: BMW = deep thud, Audi = punchy "thunt" with a crack, Mercedes = a quick brap
  dsgShift(style, k) {
    if (style === "bmw") this.thumps.push({ t: 0, f: 62, amp: .9 * k, dur: .06 });
    else if (style === "audi") { this.thumps.push({ t: 0, f: 88, amp: 1 * k, dur: .045 }); this.addPop(1.1 * k, .01, .012, true, 1.2); this.addPop(.8 * k, .012, .06, true, .9); }
    else if (style === "merc") this.burst(3 + Math.round(k * 2), 1.5 * k, .02, .025, true);
  }
  onDownshift(m) {
    const sport = this.mode === "sport";
    this.blip = sport ? .15 : .08;                     // rev-match throttle blip
    const I = Math.max(this.intensity({ ...m, release: 7 }), sport ? .12 : 0);
    if (I > .04) this.burst(1 + Math.round(I * 3), I * 1.1, .07, .075);
  }
  onLift(m) {
    const t = this.tune, I = this.intensity(m);
    if (I > .04) {
      this.crackle = Math.min(1.6, this.crackle + I * 1.4);       // trailing overrun crackle
      this.burst(Math.min(14, 3 + Math.round(I * 11)), Math.min(1.6, I * 1.5), .06, .05);
    }
    // anti-lag: ignition retarded into the manifold keeps the turbo lit and fires the exhaust
    if (t.antilag && (m.rpm ?? this.rpm) > 3500 && this.boostN > .3) { this.als = .9 + this.rand() * .4; this.alsNext = .03; }
    if (this.boostN > .15) this.release(1);
  }
  // a train of pops with varied pitch, level, length and spacing - never a machine gun
  burst(count, amp, spread, gap, allSharp = false) {
    const t = this.tune, span = Math.max(.25, t.decay);
    let at = .02 + this.rand() * .03;
    for (let i = 0; i < count; i++) {
      const k = i / Math.max(1, count - 1);
      const sharp = allSharp || this.rand() < t.mix;
      this.addPop(amp * (.45 + this.rand() * .75) * (1 - k * .65), sharp ? .005 + this.rand() * .012 : .018 + this.rand() * .04, at, sharp, .75 + this.rand() * .7);
      at += (gap + this.rand() * spread) * (1 + k * .9) * Math.min(2, span);
      if (at > span * 1.1 + .1) break;
    }
  }
  release(k) {
    const t = this.tune;
    if (!(this.p.turbo || t.t51r) || t.turbo <= 0 || t.release === "off") return;
    const amt = this.boostN * (t.turbo || .5) * k;
    if (t.release === "bov" || t.bov) this.bov = Math.max(this.bov, amt * .9);
    if (t.release !== "bov") { this.flutter = Math.max(this.flutter, amt * (t.flutter || .7)); this.flutterT = 0; this.nextChirp = .01; }
  }
  addPop(amp, dur, delay = 0, sharp = false, pitch = 1) {
    if (this.pops.length > 16 || amp < .015) return;
    this.pops.push({ t: -delay, dur: dur * (.7 + this.rand() * .6), amp, sharp, pitch, f: biquad("bp", (sharp ? 2200 : 900) * pitch, sharp ? 1.4 : 1.1, this.sr) });
  }
  process(out) {
    const n = out.length, sr = this.sr, p = this.p, t = this.tune, dt = 1 / sr;
    const sport = this.mode === "sport";
    const kR = 1 - Math.exp(-1 / (sr * .045));
    const kT = 1 - Math.exp(-1 / (sr * .03));
    const kG = 1 - Math.exp(-1 / (sr * .08));
    const kL = 1 - Math.exp(-1 / (sr * .05));
    // muffler opens with load; comfort keeps the valves shut
    const open = (sport ? 1.5 : .75) * (.55 + .45 * this.load) * (.9 + .4 * Math.min(1, this.rpm / 7000)) * (.8 + .2 * t.exhaust);
    setLP(this.muff, p.muffler * open, .75, sr);
    setLP(this.muff2, p.muffler * open * 2.6, .6, sr);
    const outGain = p.gain * t.exhaust * (sport ? .75 : .5);
    setLP(this.soft, sport ? 4200 : 2800, .6, sr); // ear-friendly top end
    const rev = t.redline || 7000;
    const turboAmt = (p.turbo || 0) * (t.turbo ?? .8);
    if (this.als > 0) { // anti-lag bangs and a turbo that refuses to spool down
      const blk = n / sr;
      this.als -= blk; this.alsNext -= blk;
      this.tBoost = Math.max(this.tBoost, .55);
      if (this.alsNext <= 0 && this.tThr < .2) {
        this.addPop(.9 + this.rand() * .9, this.rand() < .5 ? .012 : .035, this.rand() * .01, this.rand() < .45, .6 + this.rand() * .6);
        this.alsNext = .055 + this.rand() * .09;
      }
      if (this.tThr > .3) this.als = 0;
    }
    if (this.launchHold) { this.tBoost = Math.max(this.tBoost, .45); if (this.rand() < .15) this.addPop(.5, .02, 0, false, .8); }
    const t51 = !!t.t51r;

    for (let i = 0; i < n; i++) {
      let target = this.tRpm;
      if (this.blip > 0) { this.blip -= dt; target = Math.max(target, this.tRpm * 1.15); }
      this.rpm += (target - this.rpm) * (this.blip > 0 ? kR * 3 : kR);
      this.thr += ((this.blip > 0 ? .85 : this.tThr) - this.thr) * kT;
      this.load += ((this.blip > 0 ? .6 : this.tLoad) - this.load) * kL;
      this.boostN += (this.tBoost - this.boostN) * kL;
      this.gain += (this.tGain - this.gain) * kG;
      if (this.cut > 0) this.cut -= dt;
      const rpm = this.rpm, thr = this.thr, load = this.load, rn = Math.min(1.25, rpm / 7000);
      const revN = clamp01(rpm / rev);

      // ---- combustion ----
      const prev = this.crank;
      this.crank += rpm / 120 / sr;
      const wrapped = this.crank >= 1;
      if (wrapped) this.crank -= 1;
      const fireHz = (rpm / 120) * p.cyl;
      const tau = Math.min(.0055, Math.max(.0007, .3 / fireHz));
      let fired = 0;
      for (let c = 0; c < this.fireFrac.length; c++) {
        const f = this.fireFrac[c];
        if (!(wrapped ? (f >= prev || f < this.crank) : (f >= prev && f < this.crank))) continue;
        fired++;
        // cylinder pressure follows engine LOAD, not the pedal: same pedal at 2000 and 6000 rpm
        // in different gears is a completely different amount of air
        const cyl = this.cut > 0 ? .13 : .15 + .85 * Math.max(load, thr * .35);
        const cold = 1 + (1 - this.warmth) * .35 * (this.rand() - .5) * 2;
        const lope = p.jitter ? (this.rand() - .5) * p.jitter * .06 * Math.max(0, 1 - rpm / 3000) : 0;
        const a = p.amps[c] * cyl * cold * (1 + (this.rand() - .5) * 2 * p.var) * (1 + lope * 20);
        if (this.pulses.length < 10) this.pulses.push({ t: -(this.runner[c] + Math.max(0, lope)), a, tau });
        if (this.crackle > .02 && thr < .12 && rpm > 1800 && this.rand() < this.crackle * .22) {
          const sharp = this.rand() < t.mix;
          this.addPop((.2 + this.rand() * .7) * this.crackle * Math.min(1.6, t.burble + .2), sharp ? .006 + this.rand() * .01 : .02 + this.rand() * .035, this.rand() * .004, sharp, .8 + this.rand() * .6);
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
      exc += nz * env * p.rough * (sport ? 1 : .6) * (this.overrun ? 1.35 : 1);

      // afterfire: pressure pops go through the exhaust, sharp cracks bypass the muffler
      let crack = 0, pk = 0;
      for (let k = this.pops.length - 1; k >= 0; k--) {
        const P = this.pops[k];
        P.t += dt;
        if (P.t < 0) continue;
        if (P.t > P.dur * 4) { this.pops.splice(k, 1); continue; }
        const e = Math.exp(-P.t / (P.dur * .25));
        const body = P.amp * 1.3 * (e - Math.exp(-P.t / .0008)) + nz * e * P.amp * .3;
        if (P.sharp) crack += run(P.f, nz * e * P.amp * 1.6);
        else { const v = run(P.f, body); exc += v * .55 + body * .5; pk += v * 2.4; }
      }

      // ---- exhaust system ----
      let y = this.header.pipe(exc, .35, .5);
      y = this.main.pipe(y, p.fb, .32);
      const drive = p.drive * .72 * (.7 + .5 * load) * (sport ? 1 : .8);
      y = Math.tanh(y * drive) / Math.tanh(drive);
      const muffled = run(this.muff2, run(this.muff, y));
      // three rpm-weighted voices: chest rumble low down, growl through the mid, bark up top
      const wLow = 1 - .55 * clamp01((revN - .25) / .5);
      const wMid = .35 + .65 * clamp01((revN - .2) / .45);
      const wTop = clamp01((revN - .55) / .35);
      let o = muffled * .9
        + run(this.bodyF, y) * p.body[2] * (.9 - .2 * load) * wLow
        + run(this.barkF, y) * p.bark[2] * (.25 + .75 * load) * (sport ? 1.15 : .45) * wMid
        + run(this.topF, y) * p.bark[2] * (p.top || 1.3) * .45 * wTop * (.3 + .7 * load);
      this.rumble += (y - this.rumble) * .004;
      o += this.rumble * p.sub * 2.2;
      o += (y - run(this.raspLP, y)) * (.2 + .6 * load) * (sport ? .35 : .12) * (.3 + p.rough * 4) * (t.rasp ?? .7) * (this.overrun ? 1.3 : 1);
      o += run(this.inductF, exc) * load * rn * .35; // tonal induction growl
      o += run(this.crackF, crack) * 3.2 + pk;   // pops and cracks sit above the exhaust note
      for (let k = this.thumps.length - 1; k >= 0; k--) {
        const Th = this.thumps[k]; Th.t += dt;
        if (Th.t > Th.dur * 5) { this.thumps.splice(k, 1); continue; }
        o += Math.sin(Th.t * Th.f * 6.2832) * Math.exp(-Th.t / Th.dur) * Th.amp * .9;
      }
      // engine-specific harmonic scream that builds with revs (SVJ V12, GT3 flat-six)
      if (p.scream) {
        this.scrPh = (this.scrPh || 0) + fireHz * p.scream[0] * dt;
        const sw = wTop * wTop * (.25 + .75 * load) * p.scream[2];
        o += (Math.sin(this.scrPh * 6.2832) * .6 + Math.sin(this.scrPh * 12.566) * .3 * p.scream[1] + Math.sin(this.scrPh * 18.85) * .12) * sw * .09;
      }
      if (p.mech) o += run(this.topF, nz * env) * .06 * revN * p.mech; // valvetrain / gear-driven mechanical rasp

      // ---- intake: runner resonance gated by the firing events + induction roar with boost ----
      const intakeLvl = (p.intake ? p.intake[1] : .6) * (t.intake ?? .35);
      if (intakeLvl > .01) {
        if (fired) this.intakePh = 1;
        this.intakePh *= 1 - dt * 90;
        const gatedNz = nz * this.intakePh * (.2 + .8 * thr);
        o += run(this.intakeF, gatedNz) * intakeLvl * (.25 + .75 * revN) * .5;
        if (this.boostN > .02) o += run(this.roarF, nz) * this.boostN * this.boostN * intakeLvl * .16 * (.3 + .7 * thr);
      }

      // ---- forced induction ----
      if (turboAmt > 0 || t51) {
        const b = this.boostN, b2 = b * b;
        // a big single spools slower and whistles lower; the stock twins are higher and thinner
        const pitchMul = t51 ? .62 : 1;
        this.whistle += ((p.turboPitch || 2600) * pitchMul + b * 3800 * pitchMul + rpm * .12) * dt;
        const wl = t51 ? .011 : .006;
        o += Math.sin(this.whistle * 6.2832) * b2 * wl * Math.max(turboAmt, t51 ? 1.2 : 0);
        o += Math.sin(this.whistle * 12.566 + 1) * b2 * wl * .25 * Math.max(turboAmt, t51 ? 1.2 : 0);
        if (this.flutter > .004) { // compressor surge: T51R is the deep, slow, loud one
          this.flutterT += dt; this.nextChirp -= dt;
          if (this.nextChirp <= 0) {
            this.chirps.push({ t: 0, dur: (t51 ? .028 : .011) + this.rand() * (t51 ? .016 : .007), amp: this.flutter * (.7 + this.rand() * .3), f: t51 ? 95 + this.rand() * 40 : 190 });
            this.nextChirp = (t51 ? .055 : .03) + this.flutterT * (t51 ? .05 : .07) + this.rand() * .008;
            this.flutter *= t51 ? .9 : .83;
            if (this.flutterT > (t51 ? 1.4 : .9)) this.flutter = 0;
          }
        }
        if (this.bov > .003) { o += run(this.bovF, nz) * this.bov * .6; this.bov *= 1 - dt / .2; }
      }
      if (this.chirps.length) {
        let ch = 0;
        for (let k = this.chirps.length - 1; k >= 0; k--) {
          const C = this.chirps[k];
          C.t += dt;
          if (C.t > C.dur) { this.chirps.splice(k, 1); continue; }
          const e = Math.sin(Math.PI * C.t / C.dur);
          ch += (nz * .8 + Math.sin(C.t * 6.2832 * C.f) * .6) * e * C.amp;
        }
        o += run(this.chirpF, ch) * (t51 ? .85 : .55) + ch * (t51 ? .06 : .02);
      }
      if (p.blower || t.blower) {
        this.blowerPh += (rpm / 60) * 38 * dt;
        o += (Math.sin(this.blowerPh * 6.2832) * .6 + Math.sin(this.blowerPh * 12.566) * .25) * (p.blower || 1) * (.15 + .85 * load) * rn * .005 * (t.turbo ?? .8);
      }

      const dcOut = o - this.dcIn + .996 * this.dc;
      this.dcIn = o; this.dc = dcOut;
      out[i] = Math.tanh(run(this.soft2, run(this.soft, dcOut)) * .9) * this.gain * outGain;
    }
    const decay = Math.max(.15, t.decay) * (sport ? 1 : .4);
    this.crackle *= Math.exp(-n / sr / decay);
  }
}
