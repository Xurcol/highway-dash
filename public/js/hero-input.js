// Hero mode controls: keyboard and mouse (pointer lock for the camera), or a gamepad. Everything is
// read into one frame-sized snapshot - held buttons, presses and releases since the last frame, mouse
// travel - and the move keys are turned into a direction on the ground relative to the camera.
export const HERO_KEYS = [
  ["W A S D", "Move", "Left stick"],
  ["Mouse", "Camera", "Right stick"],
  ["Space", "Jump · wall jump · release-jump · point launch · hold to glide", "A"],
  ["Shift", "Sprint / parkour: vault, wall run, run up buildings", "L3"],
  ["Right mouse", "Web swing (hold; holding keeps swinging)", "RT"],
  ["E", "Web zip to the point you aim at (Space on arrival = point launch)", "LB"],
  ["Ctrl / C", "Crouch · slide · dive · drop off a wall · hold before Space = super jump", "B"],
  ["F + WASD", "Tricks (F alone spins; F + mouse sideways twists)", "RB + stick"],
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
    this.padPrev = [];
    const typing = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    addEventListener("keydown", (e) => {
      if (!this.active || typing()) return;
      if (e.repeat) return;
      this.keys.add(e.code); this.down.add(e.code);
      if (["Space", "Tab", "KeyF", "ControlLeft", "AltLeft"].includes(e.code) || /^Digit/.test(e.code) || e.code.startsWith("Arrow")) e.preventDefault();
    }, true);
    addEventListener("keyup", (e) => { if (!this.active) return; this.keys.delete(e.code); this.up.add(e.code); });
    addEventListener("blur", () => { this.keys.clear(); this.mb = 0; });
    canvas.addEventListener("mousedown", (e) => {
      if (!this.active) return;
      if (!this.locked && this.wantLock) this.lock();
      const bit = 1 << e.button;
      this.mb |= bit; this.mDown |= bit;
      e.preventDefault();
    });
    addEventListener("mouseup", (e) => { if (!this.active) return; const bit = 1 << e.button; this.mb &= ~bit; this.mUp |= bit; });
    addEventListener("mousemove", (e) => {
      if (!this.active) return;
      // with the pointer locked every movement turns the camera; without, dragging with any button does
      if (this.locked || this.mb) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; }
    });
    canvas.addEventListener("wheel", (e) => { if (this.active) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    document.addEventListener("pointerlockchange", () => { this.locked = document.pointerLockElement === canvas; });
  }
  activate(on) {
    this.active = on; this.wantLock = on;
    this.keys.clear(); this.down.clear(); this.up.clear(); this.mb = this.mDown = this.mUp = 0;
    if (!on && this.locked) document.exitPointerLock?.();
  }
  lock() { try { const r = this.canvas.requestPointerLock?.({ unadjustedMovement: true }); r?.catch?.(() => this.canvas.requestPointerLock?.()); } catch { try { this.canvas.requestPointerLock?.(); } catch { } } }
  unlock() { if (this.locked) document.exitPointerLock?.(); }
  held(...c) { return c.some((k) => this.keys.has(k)); }
  pressed(...c) { return c.some((k) => this.down.has(k)); }
  released(...c) { return c.some((k) => this.up.has(k)); }

  // the frame's snapshot. camYaw: the camera's heading (0 = looking towards -z)
  read(camYaw, look, camPos) {
    let ix = 0, iy = 0;
    for (const k of this.keys) { const m = MOVE[k]; if (m && !this.keys.has("KeyB")) { ix += m[0]; iy += m[1]; } }
    const pad = this.readPad();
    if (pad) { if (Math.hypot(pad.lx, pad.ly) > .18) { ix = pad.lx; iy = -pad.ly; } this.dx += pad.rx * 14 * this.sens; this.dy += pad.ry * 10 * this.sens; }
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
      sprint: this.held("ShiftLeft", "ShiftRight") || !!pb[10] || (pad && pad.lt > .5 && false),
      swing: b(4) || (pad ? pad.rt > .35 : false), swingDown: bd(4) || (pad ? pad.rt > .35 && !(this.prevRT > .35) : false), swingUp: bu(4),
      zip: this.pressed("KeyE") || pdn(4),
      crouch: this.held("ControlLeft", "ControlRight", "KeyC") || !!pb[1], crouchDown: this.pressed("ControlLeft", "ControlRight", "KeyC") || pdn(1),
      trick: this.held("KeyF") || !!pb[5], trickDown: this.pressed("KeyF") || pdn(5),
      attack: bd(1), attackHeld: b(1) || !!pb[2], attackDown: bd(1) || pdn(2), attackUp: bu(1) || pup(2),
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
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) {
      if (!p || !p.connected || p.mapping !== "standard") continue;
      const dz = (v) => (Math.abs(v) < .14 ? 0 : (v - Math.sign(v) * .14) / .86);
      return { lx: dz(p.axes[0]), ly: dz(p.axes[1]), rx: dz(p.axes[2]), ry: dz(p.axes[3]), lt: p.buttons[6]?.value || 0, rt: p.buttons[7]?.value || 0, b: p.buttons.map((x) => x.pressed) };
    }
    return null;
  }
}
