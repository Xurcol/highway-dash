// Deterministic engine + tuning simulation.
//
// Every performance number in the game comes from this file: the torque curve is built from
// displacement, volumetric efficiency, boost pressure, ignition timing and AFR, then scaled by one
// constant per car so that a STOCK tune reproduces exactly the peak torque in that car's spec.
// Nothing here is random - the same tune always produces the same curve, and every parameter has a
// monotonic, explainable effect (more boost -> more pressure -> more torque -> more heat and stress).
import { CARS, specOf } from "./cars.js";
const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const ATM = 14.696; // psi

// ---------------------------------------------------------------- engine catalog
// disp: litres. induction: na | turbo | super. stockBoost: psi at the stock wastegate setting.
// spool: rpm where boost starts to build. peak: rpm where target boost is reached.
// taper: rpm where the stock compressor runs out. maxRev: highest rev limit the block will take.
export const ENGINES = {
  b58:     { label: "BMW B58 3.0T I6", disp: 3.0, cyl: 6, induction: "turbo", turbos: 1, stockBoost: 17, spool: 1450, peak: 4800, taper: 6200, maxRev: 7400, comp: 11.0, tqPeak: 3500, burbleRpm: 2800, character: "b58" },
  s58:     { label: "BMW S58 3.0TT I6", disp: 3.0, cyl: 6, induction: "turbo", turbos: 2, stockBoost: 24, spool: 1600, peak: 5200, taper: 6600, maxRev: 7800, comp: 9.3, tqPeak: 4000, burbleRpm: 3000, character: "b58" },
  s63:     { label: "BMW S63 4.4TT V8", disp: 4.4, cyl: 8, induction: "turbo", turbos: 2, stockBoost: 21, spool: 1650, peak: 4800, taper: 6000, maxRev: 7300, comp: 10.0, tqPeak: 3600, burbleRpm: 2600 },
  vr30:    { label: "Nissan VR30 3.0TT V6", disp: 3.0, cyl: 6, induction: "turbo", turbos: 2, stockBoost: 15, spool: 1600, peak: 5000, taper: 6200, maxRev: 7300, comp: 10.3, tqPeak: 3600, burbleRpm: 3000 },
  vr38:    { label: "Nissan VR38 3.8TT V6", disp: 3.8, cyl: 6, induction: "turbo", turbos: 2, stockBoost: 15, spool: 1900, peak: 5200, taper: 6500, maxRev: 7400, comp: 9.0, tqPeak: 3600, burbleRpm: 3200 },
  amg:     { label: "AMG M177 4.0TT V8", disp: 4.0, cyl: 8, induction: "turbo", turbos: 2, stockBoost: 19, spool: 1700, peak: 5000, taper: 6200, maxRev: 7300, comp: 10.5, tqPeak: 3500, burbleRpm: 2500 },
  i5:      { label: "Audi DAZA 2.5T I5", disp: 2.5, cyl: 5, induction: "turbo", turbos: 1, stockBoost: 20, spool: 1550, peak: 5400, taper: 6600, maxRev: 7500, comp: 10.0, tqPeak: 3800, burbleRpm: 3000 },
  i4:      { label: "2.0T I4", disp: 2.0, cyl: 4, induction: "turbo", turbos: 1, stockBoost: 20, spool: 1650, peak: 5100, taper: 6300, maxRev: 7500, comp: 10.2, tqPeak: 3600, burbleRpm: 3000 },
  hellcat: { label: "Supercharged 6.2 HEMI V8", disp: 6.2, cyl: 8, induction: "super", stockBoost: 11.6, spool: 1000, peak: 6000, taper: 6200, maxRev: 6600, comp: 9.5, tqPeak: 4800, burbleRpm: 2600 },
  lt2:     { label: "Chevy LT2 6.2 V8", disp: 6.2, cyl: 8, induction: "na", maxRev: 6800, comp: 11.5, tqPeak: 5000, burbleRpm: 3400 },
  v6:      { label: "3.5 V6", disp: 3.5, cyl: 6, induction: "na", maxRev: 7000, comp: 11.0, tqPeak: 4600, burbleRpm: 3600 },
  v8x:     { label: "Muscle 5.0 V8", disp: 5.0, cyl: 8, induction: "na", maxRev: 7300, comp: 11.5, tqPeak: 4700, burbleRpm: 3200 },
  f6:      { label: "Flat-6 4.0", disp: 4.0, cyl: 6, induction: "na", maxRev: 9200, comp: 13.0, tqPeak: 6300, burbleRpm: 4200 },
  v10:     { label: "5.2 V10", disp: 5.2, cyl: 10, induction: "na", maxRev: 8900, comp: 12.7, tqPeak: 6500, burbleRpm: 4200 },
  svj:     { label: "Lamborghini 6.5 V12", disp: 6.5, cyl: 12, induction: "na", maxRev: 8900, comp: 11.8, tqPeak: 6750, burbleRpm: 4000 },
  v12:     { label: "6.5 V12", disp: 6.5, cyl: 12, induction: "na", maxRev: 9400, comp: 12.0, tqPeak: 6500, burbleRpm: 4200 },
};
// recorded-sample sounds map onto the engine they were recorded from
export const ENGINE_ALIAS = { s58real: "s58" };
export const engineKey = (sound) => ENGINE_ALIAS[sound] || sound;
export const engineOf = (car) => ENGINES[engineKey(car.sound || specOf(car).sound || "i4")] || ENGINES.i4;
export const isBoosted = (e) => e.induction !== "na";

// ---------------------------------------------------------------- parts
// Every part is a fixed, published multiplier - no hidden randomness.
export const PARTS = {
  intake: {
    label: "Intake", opts: {
      stock: { label: "Stock airbox", flow: 1, spool: 1, sound: .35 },
      panel: { label: "Panel filter", flow: 1.012, spool: .995, sound: .6 },
      open: { label: "Open cone intake", flow: 1.03, spool: .985, sound: 1 },
    },
  },
  exhaust: {
    label: "Exhaust", opts: {
      stock: { label: "Stock", flow: 1, spool: 1, loud: .75, burble: .35, rasp: .4 },
      catback: { label: "Cat-back", flow: 1.015, spool: .99, loud: 1, burble: .8, rasp: .7 },
      downpipe: { label: "Downpipe + cat-back", flow: 1.045, spool: .955, loud: 1.25, burble: 1.25, rasp: 1 },
    },
  },
  catalyst: {
    label: "Catalyst", opts: {
      stock: { label: "OEM cats", flow: 1, burble: .6, egt: 0 },
      sports: { label: "Sports cats", flow: 1.012, burble: 1, egt: 15 },
      deleted: { label: "Cat delete", flow: 1.025, burble: 1.45, egt: 35 },
    },
  },
  turbo: {
    label: "Turbo", boostedOnly: true, opts: {
      stock: { label: "Stock turbo(s)", maxBoost: 6, spool: 1, taper: 1, whistle: .55, flutter: .7, lag: 1 },
      upgraded: { label: "Upgraded hybrid", maxBoost: 11, spool: 1.16, taper: .6, whistle: .9, flutter: 1, lag: 1.25 },
      t51r: { label: "T51R single turbo", maxBoost: 20, spool: 1.55, taper: .25, whistle: 1.5, flutter: 1.6, lag: 1.9, t51r: true },
    },
  },
  intercooler: {
    label: "Intercooler", boostedOnly: true, opts: {
      stock: { label: "Stock", eff: .68 },
      upgraded: { label: "Front-mount", eff: .86 },
      race: { label: "Race FMIC + meth", eff: .96 },
    },
  },
};
export const partOpt = (kind, key) => PARTS[kind].opts[key] || PARTS[kind].opts[Object.keys(PARTS[kind].opts)[0]];

// ---------------------------------------------------------------- tune schema
// Each entry: [min, max, step, unit]. Defaults come from the car, not from a global constant.
export const TUNE_RANGE = {
  boost: [4, 40, .5, "psi"],
  wastegate: [0, 1, .05, ""],
  timing: [-6, 8, .5, "deg"],
  afr: [10.4, 14.7, .1, ":1"],
  revLimit: [3000, 9500, 50, "rpm"],
  final: [2.2, 5.6, .01, ""],
  gearing: [.82, 1.2, .01, "x"],
  burble: [0, 2, .05, ""],
  decay: [.2, 3, .05, "s"],
  mix: [0, 1, .05, ""],
  engineBrake: [0, 2, .05, ""],
};

export function defaultTune(car) {
  const s = specOf(car), e = engineOf(car);
  return {
    boost: isBoosted(e) ? e.stockBoost : 0,
    wastegate: .5,
    timing: 0,
    afr: isBoosted(e) ? 11.8 : 12.9,
    revLimit: s.redline,
    final: s.final,
    gearing: 1,
    intake: "stock", exhaust: "stock", catalyst: "stock", turbo: "stock", intercooler: "stock",
    burble: .75, decay: 1.1, mix: .2, brap: true, release: "flutter", engineBrake: 1,
  };
}
// A stored tune may be older than the current schema or out of range: fold it onto the defaults.
export function normalizeTune(car, stored) {
  const d = defaultTune(car), e = engineOf(car), s = specOf(car), t = { ...d, ...(stored || {}) };
  for (const [k, [lo, hi]] of Object.entries(TUNE_RANGE)) t[k] = clamp(Number.isFinite(+t[k]) ? +t[k] : d[k], lo, hi);
  for (const kind of ["intake", "exhaust", "catalyst", "turbo", "intercooler"]) {
    if (!PARTS[kind].opts[t[kind]]) t[kind] = d[kind];
    if (PARTS[kind].boostedOnly && !isBoosted(e)) t[kind] = d[kind];
  }
  if (e.induction === "super" && t.turbo !== "stock") t.turbo = "stock"; // no T51R on a blower
  t.revLimit = clamp(t.revLimit, s.redline * .8, e.maxRev || s.redline);
  t.boost = isBoosted(e) ? clamp(t.boost, 4, maxBoostFor(e, t)) : 0;
  t.brap = !!t.brap;
  if (!["flutter", "bov", "off"].includes(t.release)) t.release = d.release;
  return t;
}
export const maxBoostFor = (e, tune) => (isBoosted(e) ? e.stockBoost + partOpt("turbo", tune.turbo).maxBoost : 0);

// ---------------------------------------------------------------- the model
// Normalised volumetric efficiency: a smooth hump around the engine's torque peak. Boosted engines
// are flatter because the compressor, not the head, decides the shape.
function ve(e, rpm, revLimit) {
  const peak = e.tqPeak || revLimit * .62;
  const x = rpm / peak;
  const a = isBoosted(e) ? (x < 1 ? .30 : .26) : (x < 1 ? .42 : .34);
  return clamp(1 - a * (x - 1) * (x - 1), .3, 1.02) * (rpm < 1200 ? .82 + .18 * (rpm / 1200) : 1);
}

// Steady-state boost at full throttle, in psi. Wastegate duty moves spool, overshoot and hold.
export function boostCurve(e, tune, rpm) {
  if (!isBoosted(e)) return 0;
  const kit = partOpt("turbo", tune.turbo), ex = partOpt("exhaust", tune.exhaust), inn = partOpt("intake", tune.intake);
  const target = clamp(tune.boost, 0, maxBoostFor(e, tune));
  if (e.induction === "super") { // belt driven: boost follows rpm, no lag, falls off at the top
    const k = clamp((rpm - 800) / (e.peak - 800), 0, 1);
    return target * (.25 + .75 * smooth(k)) * (rpm > e.taper ? clamp(1 - (rpm - e.taper) / 4000, .75, 1) : 1);
  }
  const wg = clamp(tune.wastegate, 0, 1);
  const spool = e.spool * kit.spool * ex.spool * inn.spool * (1.1 - .2 * wg);
  const peak = lerp(e.peak, e.peak * 1.18, (kit.spool - 1) * 2) * (1.06 - .12 * wg);
  const k = clamp((rpm - spool) / Math.max(400, peak - spool), 0, 1);
  let b = target * smooth(k);
  b += target * (.02 + .12 * wg) * Math.exp(-Math.pow((rpm - peak * 1.02) / (peak * .28), 2)); // wastegate creep near peak
  const taper = e.taper * (1 + (kit.spool - 1) * .8);
  if (rpm > taper) b *= 1 - clamp((rpm - taper) / 3500, 0, .45) * kit.taper * (1.25 - .5 * wg) / ex.flow;
  return Math.max(0, b);
}

// Knock model. Cylinder pressure, ignition advance, charge temperature and a lean mixture all push
// detonation up; fuel, intercooling and boost you didn't add pull it down. It is measured RELATIVE
// to what the engine ships with, so a stock tune always sits at a safe 0.80 whatever the engine is,
// and a high-compression NA motor is just as fussy about timing as a big-boost turbo.
// Past 1.0 the ECU pulls timing, so an over-aggressive tune deterministically makes LESS power.
const iatOf = (e, tune, boost) => 25 + (boost / ATM) * 105 * (1 - (isBoosted(e) ? partOpt("intercooler", tune.intercooler).eff : .9));
function knockRaw(e, tune, boost, iat) {
  const afrMargin = clamp((12.6 - tune.afr) / 1.6, -1, 1);           // richer = safer
  return ((boost + ATM) / ATM) * (1 + .085 * tune.timing) * (1 + iat / 260) * (1 - .22 * afrMargin);
}
const refCache = new Map();
function knockRef(e) {
  if (refCache.has(e)) return refCache.get(e);
  const stock = { boost: isBoosted(e) ? e.stockBoost : 0, timing: 0, afr: isBoosted(e) ? 11.8 : 12.9, intercooler: "stock" };
  const v = knockRaw(e, stock, stock.boost, iatOf(e, stock, stock.boost));
  refCache.set(e, v);
  return v;
}
function knockAndTiming(e, tune, rpm, boost) {
  const iat = iatOf(e, tune, boost);
  const rel = knockRaw(e, tune, boost, iat) / knockRef(e);
  const knock = .8 * (1 + (rel - 1) * (e.comp / 10.4));              // compression sets the sensitivity
  const pulled = Math.min(tune.timing + 6, Math.max(0, knock - 1) * 26); // degrees the ECU takes back
  return { iat, knock, pulled, timing: tune.timing - pulled };
}

function afrFactor(e, afr) {
  const best = isBoosted(e) ? 11.9 : 12.8;
  const d = (afr - best) / best;
  return clamp(1 - (d > 0 ? 3.1 : 1.5) * d * d, .72, 1.02);
}

// Crank torque in Nm at wide-open throttle. `cal` is the per-car calibration constant.
function rawTorque(e, tune, rpm, cal) {
  const boost = boostCurve(e, tune, rpm);
  const { timing, iat } = knockAndTiming(e, tune, rpm, boost);
  const parts = partOpt("intake", tune.intake).flow * partOpt("exhaust", tune.exhaust).flow * partOpt("catalyst", tune.catalyst).flow;
  const dens = 1 - clamp((iat - 25) / 900, 0, .16);                  // hot charge = less mass
  const pr = 1 + boost / ATM;
  const over = Math.max(0, rpm - tune.revLimit) / 400;               // torque dies past the limiter
  return cal * e.disp * ve(e, rpm, tune.revLimit) * pr * dens * parts * (1 + .016 * timing) * afrFactor(e, tune.afr) * Math.exp(-over * over);
}

// One constant per car, solved so that the STOCK tune peaks at exactly the car's spec torque.
const calCache = new Map();
export function calibration(car) {
  if (calCache.has(car.id)) return calCache.get(car.id);
  const e = engineOf(car), s = specOf(car), stock = defaultTune(car);
  let peak = 0;
  for (let rpm = 1000; rpm <= stock.revLimit; rpm += 50) peak = Math.max(peak, rawTorque(e, stock, rpm, 1));
  const cal = s.torque / Math.max(1e-6, peak);
  calCache.set(car.id, cal);
  return cal;
}

// Public: absolute crank torque (Nm) at an rpm for a given car + tune.
export function torqueAt(car, tune, rpm) { return rawTorque(engineOf(car), tune, rpm, calibration(car)); }
export const hpFromNm = (nm, rpm) => (nm * rpm) / 7127;              // Nm at rpm -> metric hp

// Full sampled curve for the charts and for the summary numbers.
export function dyno(car, tune, step = 100) {
  const e = engineOf(car), cal = calibration(car);
  const out = [];
  const top = Math.min((e.maxRev || tune.revLimit) + 300, tune.revLimit + 400);
  for (let rpm = 900; rpm <= top; rpm += step) {
    const boost = boostCurve(e, tune, rpm);
    const kt = knockAndTiming(e, tune, rpm, boost);
    const nm = rawTorque(e, tune, rpm, cal);
    const load = clamp(nm / Math.max(1, specOf(car).torque), 0, 2);
    const egt = 620 + (tune.afr - 11.9) * 58 + boost * 5.5 + kt.pulled * 12 + partOpt("catalyst", tune.catalyst).egt + rpm / 120;
    out.push({
      rpm, nm, hp: hpFromNm(nm, rpm), boost, target: isBoosted(e) ? clamp(tune.boost, 0, maxBoostFor(e, tune)) : 0,
      afr: tune.afr + (rpm < 1800 ? .8 : 0), timing: kt.timing, knock: kt.knock, iat: kt.iat, pulled: kt.pulled,
      egt: Math.max(300, egt), coolant: 88 + load * 22 + boost * .5, oil: 95 + load * 32 + boost * .8,
      spool: isBoosted(e) ? clamp(boost / Math.max(1, tune.boost), 0, 1.1) : 0, load,
    });
  }
  return out;
}

// Acceleration / top speed from the tuned curve, integrated with the car's own gearbox.
export function performance(car, tune) {
  const s = specOf(car), ratios = s.ratios.map((r) => r * tune.gearing), final = tune.final;
  const wheel = (g) => (ratios[g] * final) / s.tire;
  const rpmAt = (v, g) => (v / (2 * Math.PI * s.tire)) * 60 * ratios[g] * final;
  let v = 0, g = 0, t = 0, t100 = null;
  const dt = .02;
  for (let i = 0; i < 4000 && v * 3.6 < (s.vmax || 400); i++) {
    const rpm = clamp(rpmAt(v, g), s.idle, tune.revLimit);
    if (rpm >= tune.revLimit - 20 && g < ratios.length - 1) { g++; t += s.shiftTime; continue; }
    const F = torqueAt(car, tune, rpm) * wheel(g) * .9 - .5 * 1.2 * s.cda * v * v - .013 * s.mass * 9.81;
    v = Math.max(0, v + (Math.min(F, s.mass * 9.81 * s.grip) / s.mass) * dt);
    t += dt;
    if (t100 === null && v * 3.6 >= 100) t100 = t;
    if (F < 1 && v > 20) break;
  }
  // top speed solved per gear (rev limit vs the speed where thrust equals drag) rather than read off
  // the integration, so it doesn't wobble with the step size
  let best = 0;
  for (let g = 0; g < ratios.length; g++) {
    const vRev = (tune.revLimit / 60 / (ratios[g] * final)) * 2 * Math.PI * s.tire;
    for (let u = vRev; u > 5; u -= .1) {
      const rpm = rpmAt(u, g);
      if (rpm < s.idle) break;
      if (torqueAt(car, tune, rpm) * wheel(g) * .9 - .5 * 1.2 * s.cda * u * u - .013 * s.mass * 9.81 >= 0) { best = Math.max(best, u); break; }
    }
  }
  return { topKmh: Math.min(s.vmax || 999, best * 3.6), zeroTo100: t100 || 99 };
}

// Peak power the car leaves the factory with - the yardstick for "how far past stock is this?"
const stockHpCache = new Map();
export function stockPeakHp(car) {
  if (!stockHpCache.has(car.id)) stockHpCache.set(car.id, dyno(car, defaultTune(car), 100).reduce((a, p) => Math.max(a, p.hp), 0));
  return stockHpCache.get(car.id);
}

// Headline numbers for the tuning UI.
export function summary(car, tune) {
  const e = engineOf(car), curve = dyno(car, tune, 50);
  const inBand = curve.filter((p) => p.rpm <= tune.revLimit);
  const pk = (f) => inBand.reduce((a, b) => (f(b) > f(a) ? b : a), inBand[0]);
  const hpP = pk((p) => p.hp), tqP = pk((p) => p.nm), boP = pk((p) => p.boost);
  const at = (rpm) => inBand.reduce((a, b) => (Math.abs(b.rpm - rpm) < Math.abs(a.rpm - rpm) ? b : a), inBand[0]);
  const perf = performance(car, tune);
  // how far past standard this tune is pushing: detonation margin, revs, and outright power
  const stressRaw = clamp((pk((p) => p.knock).knock - .8) / .3, 0, 1.6)
    + clamp((tune.revLimit / (e.maxRev || tune.revLimit) - .92) / .12, 0, 1) * .35
    + clamp(hpP.hp / Math.max(1, stockPeakHp(car)) - 1, 0, .6) / .6 * .9;
  const stress = stressRaw < .3 ? "Low" : stressRaw < .8 ? "Medium" : stressRaw < 1.3 ? "High" : "Extreme";
  return {
    hp: Math.round(hpP.hp), hpRpm: hpP.rpm, nm: Math.round(tqP.nm), nmRpm: tqP.rpm,
    lbft: Math.round(tqP.nm * .7376), peakBoost: boP.boost, peakBoostRpm: boP.rpm,
    boost3: at(3000).boost, boost4: at(4000).boost, boost5: at(5000).boost,
    iat: Math.round(pk((p) => p.iat).iat), egt: Math.round(pk((p) => p.egt).egt),
    knock: pk((p) => p.knock).knock, pulled: Math.round(pk((p) => p.pulled).pulled),
    stress, stressRaw, topKmh: perf.topKmh, zeroTo100: perf.zeroTo100, curve,
  };
}

// What the audio engine needs to know about this car + tune. Purely derived - the player can not
// pick an unrelated engine sound, only change the character of the one the car actually has.
export function audioConfig(car, tune) {
  const e = engineOf(car), ex = partOpt("exhaust", tune.exhaust), cat = partOpt("catalyst", tune.catalyst);
  const kit = isBoosted(e) && e.induction !== "super" ? partOpt("turbo", tune.turbo) : null;
  return {
    engine: engineKey(car.sound || specOf(car).sound),
    exhaust: ex.loud, rasp: ex.rasp,
    burble: tune.burble * ex.burble * cat.burble,
    decay: tune.decay, mix: tune.mix, brap: tune.brap, release: tune.release,
    intake: partOpt("intake", tune.intake).sound,
    turbo: kit ? kit.whistle : 0, flutter: kit ? kit.flutter : 0, lag: kit ? kit.lag : 1,
    t51r: !!(kit && kit.t51r), blower: e.induction === "super" ? 1 : 0,
    redline: tune.revLimit, boostMax: maxBoostFor(e, tune) || 1, burbleRpm: e.burbleRpm || 3000,
    character: e.character || null, cyl: e.cyl,
  };
}

// summary() walks the whole curve; callers that only need the peak go through this cache.
const sumCache = new Map();
export function summaryCache(car, t) {
  const key = car.id + "|" + JSON.stringify(t);
  if (!sumCache.has(key)) { if (sumCache.size > 40) sumCache.clear(); sumCache.set(key, summary(car, t)); }
  return sumCache.get(key);
}

// Physics view of a tuned car, handed to the Drivetrain.
export function tunedSpec(carId, tune) {
  const car = carById(carId), s = specOf(car), e = engineOf(car);
  const t = normalizeTune(car, tune);
  return {
    ...s,
    ratios: s.ratios.map((r) => r * t.gearing),
    final: t.final,
    redline: t.revLimit,
    torqueAt: (rpm) => torqueAt(car, t, rpm),
    boostAt: (rpm) => boostCurve(e, t, rpm),
    peakTorque: summaryCache(car, t).nm,
    boostMax: maxBoostFor(e, t),
    turboLag: isBoosted(e) && e.induction !== "super" ? partOpt("turbo", t.turbo).lag : 0,
    induction: e.induction,
    engineBrakeTune: t.engineBrake,
  };
}
