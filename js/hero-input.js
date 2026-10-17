// Hero mode controls: keyboard and mouse (pointer lock for the camera), or a gamepad. Everything is
// read into one frame-sized snapshot - held buttons, presses and releases since the last frame, mouse
// travel - and the move keys are turned into a direction on the ground relative to the camera.
export const HERO_KEYS = [
  ["W A S D / arrows", "Move", "Left stick"],
  ["Mouse", "Camera", "Right stick"],
  ["Space", "Jump · wall jump · release-jump · point launch · hold to glide", "A"],
  ["Shift", "Sprint / parkour: vault, wall run, run up buildings", "L3"],
  ["Right mouse", "Web swing (hold; holding keeps swinging)", "RT"],
  ["E", "Web zip to the point you aim at (Space on arrival = point launch)", "LB"],
  ["Ctrl / C", "Crouch · slide · dive · drop off a wall · hold before Space = super jump", "B"],
  ["Hold T + direction", "Repeat flips, side rolls and diagonal corkscrews; change direction to blend into the next trick", "Hold RB + stick"],
  ["T + Shift / Ctrl", "Layout / barrel variations, or pike / scissor variations (F also works)", "RB + L3 / B"],
  ["Left mouse", "Attack (hold = launcher, in the air = air combo)", "X"],
  ["Q", "Dodge / air dash", "LT"],
  ["R", "Web strike - zip-kick the target", "Y"],
  ["1 - 6", "Web shot · pull/disarm · launch · bomb · trap · impact web", "D-pad"],
  ["G", "Web throw - hurl an object or a stunned enemy", "R3"],
  ["Z", "Finisher (tap) · heal (hold)", "-"],
  ["Wheel / middle mouse", "Next target / lock target", "-"],
  ["B (hold) + 1-8", "Emotes", "-"],
  ["M", "City map", "View"],
  ["K", "Activities: races, trick attack, crimes", "-"],
  ["H", "Show / hide these controls", "-"],
];
const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export class HeroInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.down = new Set(); this.up = new Set();
    this.mb = 0; this.mDown = 0; this.mUp = 0;
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.active = false; this.locked = false; this.drag = false;
    this.sens = 1;
    this.padPrev = []; this.prevRT = this.prevLT = 0;
    this.focused = true;
    this.typing = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || !!document.activeElement?.isContentEditable;
    addEventListener("keydown", (e) => {
      if (!this.active || !this.wantLock || this.typing()) return;
      if (e.repeat) return;
      this.keys.add(e.code); this.down.add(e.code);
      if (["Space", "Tab", "KeyT", "KeyF", "ControlLeft", "ControlRight", "AltLeft"].includes(e.code) || /^Digit/.test(e.code) || e.code.startsWith("Arrow")) e.preventDefault();
    }, true);
    addEventListener("keyup", (e) => { if (!this.active) return; this.keys.delete(e.code); this.up.add(e.code); });
    addEventListener("blur", () => { this.focused = false; this.clear(); });
    addEventListener("focus", () => { this.focused = true; });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.clear(); });
    document.addEventListener("focusin", () => { if (this.typing()) this.clear(); });
    canvas.addEventListener("mousedown", (e) => {
      if (!this.active || !this.wantLock || this.typing()) return;
      if (!this.locked && this.wantLock) this.lock();
      const bit = 1 << e.button;
      this.mb |= bit; this.mDown |= bit;
      e.preventDefault();
    });
    addEventListener("mouseup", (e) => { if (!this.active) return; const bit = 1 << e.button; this.mb &= ~bit; this.mUp |= bit; });
    addEventListener("mousemove", (e) => {
      if (!this.active || !this.wantLock || !this.focused || this.typing()) return;
      // with the pointer locked every movement turns the camera; without, dragging with any button does
      if (this.locked || this.mb) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; }
    });
    canvas.addEventListener("wheel", (e) => { if (this.active && this.wantLock && !this.typing()) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener("contextmenu", (e) => { if (this.active && this.wantLock) e.preventDefault(); });
    document.addEventListener("pointerlockchange", () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (this.locked && (!this.active || !this.wantLock)) document.exitPointerLock?.();
      if (wasLocked && !this.locked) this.clear();
    });
  }
  clear() {
    this.keys.clear(); this.down.clear(); this.up.clear();
    this.mb = this.mDown = this.mUp = 0;
    this.dx = this.dy = this.wheel = 0;
    this.padPrev = []; this.prevRT = this.prevLT = 0;
  }
  activate(on) {
    this.active = on; this.wantLock = on;
    this.clear();
    if (!on && this.locked) document.exitPointerLock?.();
  }
  lock() {
    if (!this.active || !this.wantLock || this.lockPending || !this.canvas.requestPointerLock) return;
    this.lockPending = true;
    // Some browsers reject raw input; their normal pointer lock still gives usable controls.
    let request;
    try { request = this.canvas.requestPointerLock({ unadjustedMovement: true }); }
    catch { request = Promise.reject(); }
    Promise.resolve(request).catch(() => {
      if (this.active && this.wantLock && this.focused && !document.hidden && !this.typing()) return this.canvas.requestPointerLock();
    }).catch(() => {}).finally(() => { this.lockPending = false; });
  }
  unlock() { this.clear(); if (this.locked) document.exitPointerLock?.(); }
  held(...c) { return c.some((k) => this.keys.has(k)); }
  pressed(...c) { return c.some((k) => this.down.has(k)); }
  released(...c) { return c.some((k) => this.up.has(k)); }

  // the frame's snapshot. camYaw: the camera's heading (0 = looking towards -z)
  read(camYaw, look, camPos, dt = 1 / 60) {
    const enabled = this.active && this.wantLock && this.focused && !document.hidden && !this.typing();
    if (!enabled) this.clear();
    let ix = 0, iy = 0;
    for (const k of this.keys) { const m = MOVE[k]; if (m && !this.keys.has("KeyB")) { ix += m[0]; iy += m[1]; } }
    const pad = enabled ? this.readPad() : null;
    if (pad) {
      if (Math.hypot(pad.lx, pad.ly) > 0) { ix = pad.lx; iy = -pad.ly; }
      // Mouse deltas already cover a frame; stick deflection must be integrated over time.
      const step = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 1 / 60));
      this.dx += pad.rx * 840 * step * this.sens; this.dy += pad.ry * 600 * step * this.sens;
    }
    const L = Math.hypot(ix, iy), k = L > 1 ? 1 / L : 1;
    ix *= k; iy *= k;
    // camera-relative: forward is where the camera looks (on the ground), right is to its right
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = -fz, rz = fx;
    const b = (bit) => !!(this.mb & bit), bd = (bit) => !!(this.mDown & bit), bu = (bit) => !!(this.mUp & bit);
    const pb = pad?.b || [], pp = this.padPrev, pdn = (i) => !!pb[i] && !pp[i], pup = (i) => !pb[i] && !!pp[i];
    const digit = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => this.pressed("Digit" + n, "Numpad" + n));
    const dpad = pdn(12) ? 1 : pdn(15) ? 2 : pdn(14) ? 3 : pdn(13) ? 4 : 0;
    const emoteHeld = this.held("KeyB");
    const inp = {
      mx: fx * iy + rx * ix, mz: fz * iy + rz * ix, ix, iy,
      look, camPos,
      jump: this.pressed("Space") || pdn(0), jumpHeld: this.held("Space") || !!pb[0],
      sprint: this.held("ShiftLeft", "ShiftRight") || !!pb[10],
      swing: b(4) || (pad ? pad.rt > .35 : false), swingDown: bd(4) || (pad ? pad.rt > .35 && !(this.prevRT > .35) : false), swingUp: bu(4) || (!(pad?.rt > .35) && this.prevRT > .35),
      zip: this.pressed("KeyE") || pdn(4),
      crouch: this.held("ControlLeft", "ControlRight", "KeyC") || !!pb[1], crouchDown: this.pressed("ControlLeft", "ControlRight", "KeyC") || pdn(1),
      trick: this.held("KeyT", "KeyF") || !!pb[5], trickDown: this.pressed("KeyT", "KeyF") || pdn(5),
      trickX: ix, trickY: iy,
      trickStyle: this.held("ControlLeft", "ControlRight", "KeyC") || !!pb[1] ? "pike" : this.held("ShiftLeft", "ShiftRight") || !!pb[10] ? "layout" : "base",
      attack: bd(1) || pdn(2), attackHeld: b(1) || !!pb[2], attackDown: bd(1) || pdn(2), attackUp: bu(1) || pup(2),
      dodge: this.pressed("KeyQ") || (pad ? pad.lt > .5 && !(this.prevLT > .5) : false),
      strike: this.pressed("KeyR") || pdn(3),
      gadget: emoteHeld ? 0 : digit && digit <= 6 ? digit : dpad,
      emote: emoteHeld && digit ? digit : 0, emoteMenu: emoteHeld,
      throwObj: this.pressed("KeyG") || pdn(11),
      finisher: this.pressed("KeyZ"), finisherHeld: this.held("KeyZ"),
      cycle: this.wheel ? Math.sign(this.wheel) : 0, lockTarget: bd(2),
      map: this.pressed("KeyM") || pdn(8), activities: this.pressed("KeyK"), help: this.pressed("KeyH"),
      mdx: this.dx, mdy: this.dy,
      pad: !!pad,
    };
    this.prevRT = pad?.rt || 0; this.prevLT = pad?.lt || 0; this.padPrev = pb.slice();
    this.dx = this.dy = 0; this.wheel = 0;
    this.down.clear(); this.up.clear(); this.mDown = this.mUp = 0;
    return inp;
  }
  readPad() {
    let pads;
    try { pads = navigator.getGamepads?.() || []; } catch { return null; }
    for (const p of pads) {
      if (!p || !p.connected || p.mapping !== "standard") continue;
      // A circular dead zone preserves diagonal direction and gives small movements useful range.
      const stick = (i) => {
        const x = p.axes[i] || 0, y = p.axes[i + 1] || 0, length = Math.hypot(x, y);
        const scale = length > .16 ? Math.min(1, (length - .16) / .84) / length : 0;
        return [x * scale, y * scale];
      };
      const [lx, ly] = stick(0), [rx, ry] = stick(2);
      return { lx, ly, rx, ry, lt: p.buttons[6]?.value || 0, rt: p.buttons[7]?.value || 0, b: p.buttons.map((x) => x.pressed) };
    }
    return null;
  }
}
