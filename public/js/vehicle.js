// Longitudinal drivetrain model: tuned torque curve, boost dynamics, gears, DCT-style shifts,
// rev limiter, engine braking. Every number it uses comes from tuning.js - nothing is randomised.
const G = 9.81;
const N_SELECT = 2.2;        // m/s - neutral can only be selected below this speed

export class Drivetrain {
  constructor(spec) {
    this.s = spec;
    this.v = 0;          // m/s
    this.gear = 1;
    this.rpm = spec.idle;
    this.manual = false;
    this.mode = "sport";
    this.engineBrake = spec.engineBrakeTune ?? 1;
    this.ebForce = 0;      // last engine-braking force (N), for HUD/sound
    this.shiftT = 0;       // remaining shift time
    this.lastShift = 0;
    this.limiterT = 0;
    this.prevThr = 0;
    this.events = [];
    this.peak = spec.peakTorque || spec.torque;
    this.boost = 0;        // psi, with turbo lag
    this.load = 0;         // 0..1 fraction of peak torque actually being made
    this.accel = 0;        // m/s^2, smoothed
    this.overrun = false;  // closed throttle with the clutch engaged (engine braking)
    this.warmth = 0;       // 0 cold .. 1 at operating temperature
    this.assist = 1;       // catch-up multiplier (multiplayer only)
    this.baseVmax = spec.vmax;
    this.revMatch = 0;     // seconds left of a downshift throttle blip
    this.wheelspin = 0;    // 0 = hooked up, 1 = tyres lit up (smoothed)
    this.tcCut = 0;        // how much torque traction control is taking away right now
    this.launch = 0;       // 1 while launch control is holding the revs, >0 then counts the launch
    this.launchT = 0;
    this.drive = spec.drive || "rwd";
  }
  // gear 0 = neutral, 1..n = forward. There is no reverse: the road only runs one way.
  ratio(g = this.gear) {
    if (g === 0) return 0;
    return this.s.ratios[g - 1] * this.s.final;
  }
  rpmFor(v, g = this.gear) {
    if (g === 0) return this.s.idle;
    return (Math.abs(v) / (2 * Math.PI * this.s.tire)) * 60 * Math.abs(this.ratio(g));
  }
  // Selecting N is only legal at a near standstill, which is what stops a 200 km/h car being
  // dropped out of gear. Returns false (and a "deny" event) when the change is refused.
  selectGear(g) {
    if (g === this.gear || this.shiftT > 0.02) return false;
    if (g <= 0 && this.v > N_SELECT) { this.events.push("deny"); return false; }
    if (g >= 1 && g > this.s.ratios.length) return false;
    this.gear = g;
    this.shiftT = this.s.shiftTime * .8;
    this.lastShift = 0;
    this.events.push(g === 0 ? "neutral" : "upshift");
    return true;
  }
  // absolute crank torque (Nm) at an rpm - tuned curve when the car has one, old shape otherwise
  torque(rpm) {
    if (this.s.torqueAt) return this.s.torqueAt(rpm);
    const t = Math.min(1.05, rpm / this.s.redline);
    return this.s.torque * Math.max(0.35, 0.58 + 0.95 * t - 0.62 * t * t);
  }
  // Sequential shifter: N - 1 - 2 - ... Auto mode still manages 1..n on its own; the driver only
  // uses these to pick N or D, exactly like the lever in an automatic.
  shiftUp(auto = false) {
    if (this.shiftT > 0.02) return false;
    if (this.gear <= 0) return this.selectGear(this.gear + 1);
    if (this.gear >= this.s.ratios.length) return false;
    this.gear++; this.shiftT = this.s.shiftTime * .75; this.lastShift = 0;
    this.events.push(auto ? "autoUp" : "upshift");
    return true;
  }
  shiftDown(auto = false) {
    if (this.shiftT > 0.02) return false;
    if (this.gear <= 1) return this.selectGear(Math.max(0, this.gear - 1));
    if (this.rpmFor(this.v, this.gear - 1) > this.s.redline * 1.03) { this.events.push("deny"); return false; }
    this.gear--; this.shiftT = this.s.shiftTime * .6; this.lastShift = 0;
    this.revMatch = .22;
    this.events.push(auto ? "autoDown" : "downshift");
    return true;
  }
  update(dt, throttle, brake) {
    const s = this.s;
    this.lastShift += dt;
    if (this.shiftT > 0) this.shiftT -= dt;
    if (this.revMatch > 0) this.revMatch -= dt;
    this.warmth = Math.min(1, this.warmth + dt / 55);

    const fwd = this.gear >= 1, neutral = this.gear === 0;
    // engine speed (clutch slips in 1st at low speed so launches rev up)
    let rpm = this.rpmFor(this.v);
    if (neutral) {
      // Neutral: the engine is disconnected, so it revs on throttle alone and the car just rolls.
      this.freeRpm = (this.freeRpm ?? s.idle) + ((s.idle + throttle * (s.redline * .92 - s.idle)) - (this.freeRpm ?? s.idle)) * Math.min(1, dt * (throttle > .05 ? 3.4 : 1.8));
      rpm = this.freeRpm;
    } else {
      this.freeRpm = rpm;
      if (fwd && this.gear === 1 && this.v < 9) rpm = Math.max(rpm, s.idle + throttle * s.redline * 0.45 * (1 - this.v / 9));
    }
    rpm = Math.max(s.idle * (1 + .18 * (1 - this.warmth)), rpm); // fast idle while cold
    // ---- launch control: foot on the brake, floor the throttle at a standstill ----
    const armed = this.v < 1.2 && throttle > .85 && brake > .4 && this.gear === 1;
    if (armed) {
      if (!this.launch) this.events.push("launchArm");
      this.launch = 1;
      rpm = s.redline * (s.launchFrac || (this.drive === "awd" ? .62 : this.drive === "fwd" ? .45 : .5));
    } else if (this.launch === 1) {
      this.launch = 0;
      if (throttle > .85) { this.launchT = 2.2; this.events.push("launch"); }
    }
    if (this.launchT > 0) this.launchT -= dt;

    let thr = throttle;
    // no artificial speed cap: top speed comes from power, drag and gearing
    if (rpm >= s.redline) {
      thr = 0;
      this.limiterT -= dt;
      if (throttle > 0.3 && this.limiterT <= 0) { this.events.push("limiter"); this.limiterT = 0.075; }
    }
    this.rpm = Math.min(rpm, s.redline * 1.04);

    // ---- boost: spools towards the steady-state curve, bleeds off fast when the throttle shuts ----
    const clutched = this.shiftT <= 0;
    const want = s.boostAt ? s.boostAt(this.rpm) * Math.min(1, thr * 1.35) * (clutched ? 1 : .35) : 0;
    const lag = s.turboLag || 1;
    const tau = want > this.boost ? (s.induction === "super" ? .03 : .16 * lag) : (s.induction === "super" ? .03 : .10);
    this.boost += (want - this.boost) * Math.min(1, dt / tau);

    const wheelMul = Math.abs(this.ratio()) / s.tire * 0.97;
    const tq = this.torque(this.rpm);
    let F = neutral ? 0 : thr * tq * wheelMul * this.assist;
    if (this.shiftT > 0) F *= 0.2;
    // how much of the car's weight sits on the driven wheels (weight transfers rearward under power)
    const accelShare = Math.max(0, Math.min(.12, this.accel / G * .25));
    const onDriven = this.drive === "awd" ? 1 : this.drive === "fwd" ? .6 - accelShare : .56 + accelShare;
    const limit = s.mass * G * s.grip * onDriven * (this.surface ?? 1) * 1.45;
    // The tyres never slip: there is no wheelspin, so no smoke, no squeal and nothing for a traction
    // system to cut. The grip limit still caps how hard the car can pull, it just holds instead of spinning.
    this.wheelspin = 0;
    this.tcCut = 0;
    if (Math.abs(F) > limit) F = Math.sign(F) * limit * (this.launchT > 0 ? 1.04 : 1);
    if (this.launch === 1) F = 0;
    this.load = neutral ? 0 : Math.max(0, Math.min(1.2, (thr * tq) / Math.max(1, this.peak) * (this.shiftT > 0 ? .2 : 1)));
    // engine braking: friction + pumping losses grow with rpm and are multiplied by the gear,
    // so a downshift slows the car harder. Clutch is open mid-shift and while slipping in 1st.
    this.ebForce = 0;
    this.overrun = false;
    if (throttle < 0.05 && clutched && !neutral && !(this.gear === 1 && this.v < 9)) {
      const x = Math.min(1.05, this.rpm / s.redline);
      this.overrun = this.rpm > s.idle * 1.4;
      this.ebForce = this.peak * (0.07 + 0.24 * Math.pow(x, 1.3)) * wheelMul * this.engineBrake * (this.mode === "sport" ? 1.15 : .85);
      F -= this.ebForce;
    }
    // Everything below resists motion. The car never runs backwards, so "moving" is always forwards.
    const moving = 1;
    F -= 0.5 * 1.2 * s.cda * this.v * Math.abs(this.v) + moving * 0.013 * s.mass * G;
    // Braking is tyre-limited like acceleration is: the pads can always out-bite the contact
    // patch, so grip sets the ceiling and the brake kit sets how close to it you get.
    const brakeG = Math.min(1.85 * (s.brakeMul || 1), s.grip * 1.55 * (s.brakeMul || 1)) * (this.surface ?? 1);
    F -= moving * brake * s.mass * G * brakeG;
    const a = F / s.mass;
    this.accel += (a - this.accel) * Math.min(1, dt * 8);
    const v1 = this.v + (this.launch === 1 ? 0 : a) * dt;
    // braking and rolling drag must not drag the car backwards through zero
    this.v = (brake > .02 || throttle < .05) && Math.sign(v1) !== Math.sign(this.v) && this.v !== 0 ? 0 : v1;
    if (this.v < 0) this.v = 0;   // braking or drag can bring the car to rest, never push it backwards

    if (!this.manual && fwd && this.shiftT <= 0 && this.lastShift > 0.35) {
      const sport = true;
      const up = s.redline * (sport ? .72 + .24 * throttle : .42 + .3 * throttle);
      if (this.rpm > up && this.gear < s.ratios.length) this.shiftUp(true);
      else if (this.gear > 1) {
        const lower = this.rpmFor(this.v, this.gear - 1);
        const floor = sport ? (brake > .2 ? .55 : .42) : .26;
        if ((this.rpm < s.redline * floor || (throttle > 0.9 && this.rpm < s.redline * (sport ? .62 : .5))) && lower < s.redline * (sport ? .9 : .7)) this.shiftDown(true);
      }
    }
    this.prevThr = throttle;
    const ev = this.events; this.events = [];
    return ev;
  }
  // everything the audio layer needs to voice this engine, in one object
  audioState(throttle, gain) {
    const s = this.s;
    return {
      rpm: this.rpm, throttle, gain, load: this.load, boost: this.boost,
      boostNorm: s.boostMax ? Math.min(1.2, this.boost / s.boostMax) : 0,
      gear: Math.max(1, this.gear), speed: this.v, accel: this.accel, shifting: this.shiftT > 0,
      overrun: this.overrun, redline: s.redline, warmth: this.warmth, wheelspin: this.wheelspin, launch: this.launch,
    };
  }
}
