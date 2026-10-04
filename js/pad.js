// Steering wheels and gamepads, through the browser's Gamepad API.
//
// An Xbox or PlayStation pad has a standard layout, so it works the moment it is plugged in: left
// stick steers, the triggers are throttle and brake. A wheel - Logitech G29 / G920 / G923,
// Thrustmaster, Fanatec, Moza - reports its axes in whatever order its driver, the OS and the browser
// settle on, so it is set up once: turn it left and right, press each pedal, pull each paddle. That
// is saved per device (settings.pads[id]).
//
// Every frame poll() leaves steer (-1..1, + right), throttle and brake (0..1) in `state`, and turns
// button presses into the game's own key codes (shift up = KeyE, handbrake = ShiftLeft, ...), so every
// key action works from the wheel or pad without the game knowing which it was.
//
// Browsers cannot drive a wheel's force-feedback motor, so there is no road feel through the rim.
// Pads that can rumble do (rumble()).

// the standard (Xbox / PlayStation) layout: button index -> key code
const STD_BUTTONS = { 5: "KeyE", 4: "KeyQ", 0: "ShiftLeft", 1: "Space", 2: "KeyH", 3: "KeyC", 9: "Start", 8: "KeyN", 12: "KeyM", 14: "KeyZ", 15: "KeyX" };
// what a wheel's buttons can do, in the order the setup asks for them (required ones first)
export const WHEEL_BUTTONS = [
  ["KeyE", "Pull the RIGHT paddle (shift up)", true],
  ["KeyQ", "Pull the LEFT paddle (shift down)", true],
  ["ShiftLeft", "Press the button for the HANDBRAKE"],
  ["KeyH", "Press the button for the HORN"],
  ["KeyC", "Press the button to change CAMERA"],
  ["Space", "Press the button to LOOK BACK"],
  ["Start", "Press the button to START / PAUSE"],
  ["KeyN", "Press the button for SPORT / COMFORT"],
];
export const ACTION_NAMES = { KeyE: "Shift up", KeyQ: "Shift down", ShiftLeft: "Handbrake", KeyH: "Horn", KeyC: "Camera", Space: "Look back", Start: "Start / pause", KeyN: "Sport / comfort", KeyM: "Manual / auto", KeyZ: "Left signal", KeyX: "Right signal" };
const WHEEL_ID = /wheel|g29|g920|g923|g27|g25|driving force|thrustmaster|t300|t150|t248|tmx|t-gt|fanatec|csl|clubsport|podium|moza|simagic|simucube/i;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Pads {
  // settings(): the live settings object; events: { down(code), up(code), save(), connected(info) }
  constructor(settings, events) {
    this.settings = settings; this.ev = events;
    this.state = { steer: 0, throttle: 0, brake: 0, active: false, wheel: false, steering: false, configured: false, name: "", id: "" };
    this.cur = -1; this.last = new Map(); this.held = new Set(); this.seen = new Map(); this.setup = null;
    addEventListener("gamepadconnected", (e) => {
      const gp = e.gamepad, wheel = this.isWheel(gp);
      this.ev.connected?.({ name: shortName(gp.id), wheel, configured: !wheel || !!this.conf(gp) });
    });
  }
  list() { try { return [...(navigator.getGamepads?.() || [])].filter((g) => g && g.connected !== false); } catch { return []; } }
  isWheel(gp) { return gp.mapping !== "standard" || WHEEL_ID.test(gp.id); }
  conf(gp) { return this.settings().pads?.[gp.id] || null; }
  current() { const l = this.list(); return l.find((g) => g.index === this.cur) || l[0] || null; }
  // An axis that has never moved reads 0 on some browsers, even a pedal whose rest is -1 or +1. Until
  // an axis has reported anything else it counts as "at rest", so an untouched pedal isn't half pressed.
  axis(gp, i) {
    const v = gp.axes[i] ?? 0;
    let s = this.seen.get(gp.index);
    if (!s) this.seen.set(gp.index, (s = new Set()));
    if (v !== 0) s.add(i);
    return s.has(i) ? v : null;
  }
  pedal(gp, p) {
    if (!p) return 0;
    const v = this.axis(gp, p.axis);
    if (v === null) return 0;
    const t = clamp((v - p.rest) / ((p.full - p.rest) || 1), 0, 1);
    return t < .03 ? 0 : t;
  }
  poll(dt = .016) {
    const pads = this.list();
    // the device in use is whichever moved last (a wheel and a pad can both be plugged in)
    for (const gp of pads) {
      const prev = this.last.get(gp.index), now = gp.axes.map((a) => a), btn = gp.buttons.some((b) => b.pressed);
      if (btn || (prev && now.some((v, i) => Math.abs(v - (prev[i] ?? v)) > .2))) this.cur = gp.index;
      this.last.set(gp.index, now);
    }
    const gp = pads.find((g) => g.index === this.cur) || pads[0] || null, st = this.state, S = this.settings();
    if (!gp) {
      Object.assign(st, { steer: 0, throttle: 0, brake: 0, active: false, wheel: false, steering: false, configured: false, name: "", id: "" });
      for (const k of this.held) this.ev.up(k.split("@")[0]);
      this.held.clear();
      return st;
    }
    for (let i = 0; i < gp.axes.length; i++) this.axis(gp, i);   // note every axis that has reported anything
    if (this.setup) this.tickSetup(gp, dt);
    const wheel = this.isWheel(gp), c = this.conf(gp), dead = S.padDead ?? .08;
    let steer = 0, thr = 0, brk = 0;
    if (c) {
      if (c.steer) { const v = this.axis(gp, c.steer.axis), half = (c.steer.right - c.steer.left) / 2; steer = v === null || !half ? 0 : (v - c.steer.mid) / half; }
      thr = this.pedal(gp, c.throttle); brk = this.pedal(gp, c.brake);
    } else if (!wheel) {
      steer = gp.axes[0] || 0; thr = gp.buttons[7]?.value || 0; brk = gp.buttons[6]?.value || 0;
    } else steer = this.axis(gp, 0) || 0;   // a wheel not set up yet still steers: every wheel puts the rim on its first axis
    // A wheel reaches full lock well before the end of its travel (a 900 degree wheel would otherwise
    // need two and a half turns); a stick gets a deadzone round the centre, then the rest of its travel.
    if (wheel) steer = clamp(steer / (S.padLock ?? .45), -1, 1);
    else steer = Math.abs(steer) < dead ? 0 : Math.sign(steer) * (Math.abs(steer) - dead) / (1 - dead);
    Object.assign(st, {
      steer: clamp(steer, -1, 1), throttle: thr < .03 ? 0 : thr, brake: brk < .03 ? 0 : brk,
      active: true, wheel, steering: wheel || steer !== 0, configured: !wheel || !!c, name: shortName(gp.id), id: gp.id,
    });
    // buttons, as key presses and releases (not while the setup is listening for them)
    const map = c?.buttons || (wheel ? {} : STD_BUTTONS);
    for (const [idx, code] of Object.entries(map)) {
      const key = code + "@" + idx, down = !!gp.buttons[idx]?.pressed;
      if (down && !this.held.has(key)) { this.held.add(key); if (!this.setup) this.ev.down(code); }
      else if (!down && this.held.has(key)) { this.held.delete(key); this.ev.up(code); }
    }
    return st;
  }
  rumble(strong, weak = strong, ms = 200) {
    const gp = this.current();
    try { gp?.vibrationActuator?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) })?.catch?.(() => {}); } catch { /* not supported */ }
  }

  // ---------------------------------------------------------------- setup
  // A short guided capture: the rim's axis and its two ends, each pedal's axis with its rest and fully
  // pressed values (so inverted or combined pedals don't matter), then a button for each action.
  startSetup() {
    const gp = this.current();
    if (!gp) return false;
    this.setup = { id: gp.id, index: gp.index, step: 0, conf: { buttons: {} }, base: null, ext: null, t: 0, msg: "", done: false };
    this.beginStep(gp);
    return true;
  }
  steps() {
    return [
      { kind: "steerL", text: "Turn the wheel all the way LEFT and hold it there" },
      { kind: "steerR", text: "Now all the way RIGHT, and hold it" },
      { kind: "center", text: "Let it come back to the middle" },
      { kind: "pedalDown", key: "throttle", text: "Press the THROTTLE pedal all the way down and hold it" },
      { kind: "pedalUp", key: "throttle", text: "...and let go of the throttle" },
      { kind: "pedalDown", key: "brake", text: "Press the BRAKE pedal all the way down and hold it" },
      { kind: "pedalUp", key: "brake", text: "...and let go of the brake" },
      ...WHEEL_BUTTONS.map(([code, text, req]) => ({ kind: "button", code, text, optional: !req })),
    ];
  }
  get step() { return this.setup ? this.steps()[this.setup.step] : null; }
  beginStep(gp) {
    const S = this.setup;
    S.base = gp.axes.map((a) => a); S.ext = gp.axes.map((a) => a); S.t = 0; S.pressedAtStart = gp.buttons.map((b) => b.pressed); S.armed = false;
    S.cand = -1; S.candV = undefined;
  }
  skipStep() {
    if (!this.setup) return;
    if (this.step?.kind === "pedalDown") this.setup.step++;   // skipping a pedal skips its "let go" too
    this.nextStep(this.list().find((g) => g.index === this.setup.index));
  }
  cancelSetup() { this.setup = null; }
  nextStep(gp) {
    const S = this.setup;
    S.step++;
    if (S.step >= this.steps().length) return this.finishSetup();
    if (gp) this.beginStep(gp);
  }
  finishSetup() {
    const S = this.setup, all = this.settings();
    (all.pads ||= {})[S.id] = S.conf;
    this.setup = null;
    this.ev.save?.();
  }
  tickSetup(gp, dt) {
    const S = this.setup;
    if (gp.index !== S.index) return;
    const step = this.step, c = S.conf, used = new Set([c.steer?.axis, c.throttle?.axis, c.brake?.axis].filter((v) => v !== undefined));
    if (step.kind === "steerL" || step.kind === "steerR") {
      // the axis that has moved furthest from where it started, held there a moment
      let best = -1, bd = 0;
      gp.axes.forEach((v, i) => { const d = Math.abs(v - S.base[i]); if (d > bd && (step.kind === "steerL" || i === c.steer.axis)) { bd = d; best = i; } });
      if (step.kind === "steerL" && bd > .35) S.t += dt; else if (step.kind === "steerR" && best === c.steer?.axis && Math.abs(gp.axes[best] - c.steer.mid) > .35 && Math.sign(gp.axes[best] - c.steer.mid) !== Math.sign(c.steer.left - c.steer.mid)) S.t += dt; else S.t = 0;
      if (S.t > .5) {
        if (step.kind === "steerL") c.steer = { axis: best, left: gp.axes[best], mid: S.base[best], right: 2 * S.base[best] - gp.axes[best] };
        else c.steer.right = gp.axes[c.steer.axis];
        this.nextStep(gp);
      }
    } else if (step.kind === "center") {
      if (Math.abs(gp.axes[c.steer.axis] - c.steer.mid) < .12 || (S.t += dt) > 3) this.nextStep(gp);
    } else if (step.kind === "pedalDown") {
      // the axis that has moved furthest, held steady there: that is the pedal, fully pressed
      let best = -1, bd = 0;
      gp.axes.forEach((v, i) => { const d = Math.abs(v - S.base[i]); if (!used.has(i) && d > bd) { bd = d; best = i; } });
      if (best >= 0 && bd > .5 && best === S.cand && Math.abs(gp.axes[best] - S.candV) < .04) S.t += dt;
      else { S.t = 0; S.cand = best; S.candV = gp.axes[best]; }
      if (S.t > .4) { c[step.key] = { axis: best, full: gp.axes[best], rest: S.base[best] }; this.nextStep(gp); }
    } else if (step.kind === "pedalUp") {
      // and where it settles once released is its rest (measured, since an untouched axis can read 0)
      const p = c[step.key];
      if (!p) return this.nextStep(gp);
      const v = gp.axes[p.axis];
      if (Math.abs(v - p.full) > .5 && Math.abs(v - (S.candV ?? v)) < .04) S.t += dt;
      else { S.t = 0; S.candV = v; }
      if (S.t > .3) { p.rest = v; this.nextStep(gp); }
    } else if (step.kind === "button") {
      const i = gp.buttons.findIndex((b, k) => b.pressed && !S.pressedAtStart[k]);
      if (i >= 0 && !S.armed) { S.armed = i; }
      if (S.armed !== false && !gp.buttons[S.armed]?.pressed) {
        for (const [k, v] of Object.entries(c.buttons)) if (v === step.code || +k === S.armed) delete c.buttons[k];
        c.buttons[S.armed] = step.code;
        this.nextStep(gp);
      }
    }
  }
  forget() { const gp = this.current(), all = this.settings(); if (gp && all.pads) { delete all.pads[gp.id]; this.ev.save?.(); } }
}
// "Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)" -> "Logitech G29 Driving Force Racing Wheel"
const shortName = (id) => String(id || "").replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor:.*$/i, "").replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "").trim() || "Controller";

// ---------------------------------------------------------------- the Controller settings pane
// Status, live bars for steering / throttle / brake, the setup, steering lock and deadzone, and what
// each button does. Redraws itself while it is on screen.
export function mountPadPane(el, pads, { save }) {
  if (!el) return;
  if (!el.dataset.built) {
    el.dataset.built = "1";
    el.innerHTML = `
      <h3>CONTROLLER <small>steering wheel or gamepad</small></h3>
      <div class="pad-status"><b data-p="name">No controller</b><small data-p="note"></small></div>
      <div class="pad-bars">
        <span>Steering</span><div class="pad-bar mid"><i data-p="steer"></i></div>
        <span>Throttle</span><div class="pad-bar"><i data-p="thr"></i></div>
        <span>Brake</span><div class="pad-bar"><i data-p="brk"></i></div>
      </div>
      <div class="pad-setup" data-p="setup" hidden>
        <p class="pad-step" data-p="step"></p>
        <div class="row"><button class="btn ghost" data-p="skip">SKIP</button><button class="btn ghost" data-p="cancel">CANCEL</button></div>
      </div>
      <button class="btn accent wide" data-p="go">SET UP WHEEL</button>
      <label class="slider">Steering lock <input type="range" data-p="lock" min="0.15" max="1" step="0.05"></label>
      <p class="muted small" data-p="lockNote"></p>
      <label class="slider">Stick deadzone <input type="range" data-p="dead" min="0" max="0.25" step="0.01"></label>
      <div class="pad-map" data-p="map"></div>
      <button class="btn ghost" data-p="forget" hidden>FORGET THIS WHEEL'S SETUP</button>
      <p class="muted small">No force feedback: browsers can't drive a wheel's motor. In Logitech G HUB, turn on the centering spring for games without force feedback so the wheel still springs back to the middle.</p>`;
    const q = (k) => el.querySelector(`[data-p="${k}"]`), S = () => pads.settings();
    q("go").onclick = () => { if (!pads.startSetup()) q("note").textContent = "Press any button on the wheel first, so the browser can see it."; };
    q("skip").onclick = () => pads.skipStep();
    q("cancel").onclick = () => pads.cancelSetup();
    q("forget").onclick = () => pads.forget();
    q("lock").oninput = (e) => { S().padLock = +e.target.value; save(); };
    q("dead").oninput = (e) => { S().padDead = +e.target.value; save(); };
  }
  const q = (k) => el.querySelector(`[data-p="${k}"]`);
  q("lock").value = pads.settings().padLock ?? .45;
  q("dead").value = pads.settings().padDead ?? .08;
  const draw = () => {
    if (!el.isConnected || !el.offsetParent) { el.dataset.loop = ""; return; }
    const st = pads.state, s = pads.setup, step = pads.step, S = pads.settings();
    q("name").textContent = st.active ? st.name : "No controller";
    q("note").textContent = !st.active ? "Plug in a wheel or gamepad, then press any button on it."
      : st.wheel ? (st.configured ? "Steering wheel - set up" : "Steering wheel - not set up yet: it steers, but the pedals and paddles need the setup below")
        : "Gamepad - left stick steers, RT throttle, LT brake";
    q("steer").style.cssText = `left:${50 + Math.min(0, st.steer) * 50}%;width:${Math.abs(st.steer) * 50}%`;
    q("thr").style.width = st.throttle * 100 + "%";
    q("brk").style.width = st.brake * 100 + "%";
    q("setup").hidden = !s;
    q("go").hidden = !!s || !st.active || !st.wheel;
    q("go").textContent = st.configured ? "SET UP AGAIN" : "SET UP WHEEL";
    if (s && step) {
      q("step").textContent = `${s.step + 1} / ${pads.steps().length} - ${step.text}`;
      q("skip").hidden = !(step.optional || step.kind === "pedalDown");
    }
    const lock = S.padLock ?? .45;
    q("lockNote").textContent = st.wheel || !st.active ? `How far you turn the wheel for full lock: about ${Math.round(lock * 450)} degrees each way on a 900 degree wheel.` : "Only used for steering wheels.";
    const c = pads.current() && pads.conf(pads.current());
    const map = st.wheel ? c?.buttons || {} : st.active ? STD_BUTTONS : {};
    const rows = Object.entries(map).map(([i, code]) => `<span>${ACTION_NAMES[code] || code}</span><b>${st.wheel ? "Button " + i : STD_NAMES[i] || "Button " + i}</b>`);
    q("map").innerHTML = rows.length ? rows.join("") : "";
    q("forget").hidden = !c || !!s;
    requestAnimationFrame(draw);
  };
  if (!el.dataset.loop) { el.dataset.loop = "1"; requestAnimationFrame(draw); }
}
const STD_NAMES = { 0: "A / Cross", 1: "B / Circle", 2: "X / Square", 3: "Y / Triangle", 4: "LB / L1", 5: "RB / R1", 8: "View / Share", 9: "Menu / Options", 12: "D-pad up", 14: "D-pad left", 15: "D-pad right" };
