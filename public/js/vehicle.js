// Longitudinal drivetrain model: torque curve, gears, DCT-style shifts, rev limiter.
const G = 9.81;

export class Drivetrain {
  constructor(spec) {
    this.s = spec;
    this.v = 0;          // m/s
    this.gear = 1;
    this.rpm = spec.idle;
    this.manual = false;
    this.mode = "sport";
    this.engineBrake = 1;  // tuning multiplier
    this.ebForce = 0;      // last engine-braking force (N), for HUD/sound
    this.shiftT = 0;     // remaining shift time
    this.lastShift = 0;
    this.limiterT = 0;
    this.prevThr = 0;
    this.events = [];
  }
  ratio(g = this.gear) { return this.s.ratios[g - 1] * this.s.final; }
  rpmFor(v, g = this.gear) { return (v / (2 * Math.PI * this.s.tire)) * 60 * this.ratio(g); }
  torqueCurve(rpm) {
    const t = Math.min(1.05, rpm / this.s.redline);
    return Math.max(0.35, 0.58 + 0.95 * t - 0.62 * t * t);
  }
  shiftUp(auto = false) {
    if (this.gear >= this.s.ratios.length || this.shiftT > 0.02) return false;
    this.gear++; this.shiftT = this.s.shiftTime * (this.mode === "sport" ? .75 : 1.6); this.lastShift = 0;
    this.events.push(auto ? "autoUp" : "upshift");
    return true;
  }
  shiftDown(auto = false) {
    if (this.gear <= 1 || this.shiftT > 0.02) return false;
    if (this.rpmFor(this.v, this.gear - 1) > this.s.redline * 1.03) { this.events.push("deny"); return false; }
    this.gear--; this.shiftT = this.s.shiftTime * (this.mode === "sport" ? .6 : 1.3); this.lastShift = 0;
    this.events.push(auto ? "autoDown" : "downshift");
    return true;
  }
  update(dt, throttle, brake) {
    const s = this.s;
    this.lastShift += dt;
    if (this.shiftT > 0) this.shiftT -= dt;

    // engine speed (clutch slips in 1st at low speed so launches rev up)
    let rpm = this.rpmFor(this.v);
    if (this.gear === 1 && this.v < 9) rpm = Math.max(rpm, s.idle + throttle * s.redline * 0.45 * (1 - this.v / 9));
    rpm = Math.max(s.idle, rpm);

    let thr = throttle;
    if (s.vmax && this.v * 3.6 >= s.vmax) thr = 0;
    if (rpm >= s.redline) {
      thr = 0;
      this.limiterT -= dt;
      if (throttle > 0.3 && this.limiterT <= 0) { this.events.push("limiter"); this.limiterT = 0.075; }
    }
    this.rpm = Math.min(rpm, s.redline * 1.04);

    const wheelMul = this.ratio() / s.tire * 0.9;
    let F = thr * s.torque * this.torqueCurve(this.rpm) * wheelMul;
    if (this.shiftT > 0) F *= 0.2;
    F = Math.min(F, s.mass * G * s.grip);
    // engine braking: friction + pumping losses grow with rpm and are multiplied by the gear,
    // so a downshift slows the car harder. Clutch is open mid-shift and while slipping in 1st.
    this.ebForce = 0;
    if (throttle < 0.05 && this.shiftT <= 0 && !(this.gear === 1 && this.v < 9)) {
      const x = Math.min(1.05, this.rpm / s.redline);
      this.ebForce = s.torque * (0.07 + 0.24 * Math.pow(x, 1.3)) * wheelMul * this.engineBrake * (this.mode === "sport" ? 1.15 : .85);
      F -= this.ebForce;
    }
    F -= 0.5 * 1.2 * s.cda * this.v * this.v + 0.013 * s.mass * G;
    F -= brake * s.mass * G * 1.05;
    this.v = Math.max(0, this.v + (F / s.mass) * dt);


    if (!this.manual && this.shiftT <= 0 && this.lastShift > 0.35) {
      const sport = this.mode === "sport";
      const up = s.redline * (sport ? .72 + .24 * throttle : .42 + .3 * throttle);
      if (this.rpm > up && this.gear < s.ratios.length) this.shiftUp(true);
      else if (this.gear > 1) {
        const lower = this.rpmFor(this.v, this.gear - 1);
        const floor = sport ? (brake > .2 ? .55 : .42) : .26;
        if ((this.rpm < s.redline * floor || (throttle > 0.9 && this.rpm < s.redline * (sport ? .62 : .5))) && lower < s.redline * (sport ? .9 : .7)) this.shiftDown(true);
      }
    }
    const ev = this.events; this.events = [];
    return ev;
  }
}
