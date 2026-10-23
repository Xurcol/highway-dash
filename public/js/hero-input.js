// Hero mode controls: keyboard and mouse (pointer lock for the camera), or a gamepad. Everything is
// read into one frame-sized snapshot - held buttons, presses and releases since the last frame, mouse
// travel - and the move keys are turned into a direction on the ground relative to the camera.
export const HERO_KEYS = [
  ["W A S D / arrows", "Move", "Left stick"],
  ["Mouse", "Camera", "Right stick"],
  ["Space", "Jump · wall jump · swing launch · airborne forward zip", "Cross / A"],
  ["Shift", "Web swing / parkour (hold; release to let go)", "R2 / RT"],
  ["Alt", "Sprint / parkour; L3 also dives/perches in the air", "L3"],
  ["Right mouse", "Hold to swing; aim at surfaces in first person", "R2 / RT"],
  ["P", "Toggle first-person camera", "Keyboard shortcut"],
  ["C", "Web zip to the point you aim at", "L2 + R2 / LT + RT"],
  ["Ctrl", "Crouch · slide · dive · drop off a wall · hold before Space = super jump", "B"],
  ["Hold X + direction", "Repeat flips, side rolls and diagonal corkscrews; change direction to blend into the next trick", "Air: hold Square + left stick"],
  ["X + Alt / Ctrl", "Layout / barrel variations, or pike / scissor variations", "Keyboard shortcut"],
  ["Left mouse", "Attack chain (hold = launcher, in the air = air combo)", "X"],
  ["R", "Dodge / air dash · perfect dodge opens a counter", "Circle / B"],
  ["V", "Parry - block just before a blow lands, then counter", "L1 / LB"],
  ["Right mouse + Space", "Slingshot - pull back on two lines and fling yourself where you look", "Hold LB + RB"],
  ["7 · 8 · 9", "Arc abilities: Arc Burst · Tether Storm · Overcharge", "RB + X / Y / R3"],
  ["F", "Web Wings in the air / web strike - zip-kick the target", "Triangle / Y"],
  ["E / 1 - 6", "Web shooter and gadgets", "R1 / RB + D-pad"],
  ["Q", "Web throw - hurl an object or a stunned enemy", "R3"],
  ["Z", "Finisher (tap) · heal (hold)", "-"],
  ["Wheel / middle mouse", "Next target / lock target", "-"],
  ["B (hold) + 1-8", "Emotes", "-"],
  ["Tab / M", "World map · click a spot to fast travel", "View"],
  ["O", "Photo mode", "-"],
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
    const digit = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => this.pressed("Digit" + n, "Numpad" + n));
    // L1 held turns the face buttons into abilities; R1 held selects gadgets.
    const lb = !!pb[4], rb = !!pb[5];
    const padAbility = lb ? (pdn(2) ? 1 : pdn(3) ? 2 : pdn(11) ? 3 : 0) : 0;
    const padGadget = rb ? (pdn(2) ? 1 : pdn(3) ? 2 : pdn(1) ? 3 : pdn(0) ? 4 : 0) : 0;
    const padFinisher = !!pb[1] && !!pb[3] && !(this.padPrev[1] && this.padPrev[3]);
    // Spider-Man 2 reserves D-pad down for healing; left/right stay available as gadget shortcuts.
    const dpad = pdn(14) ? 3 : pdn(15) ? 4 : 0;
    const emoteHeld = this.held("KeyB");
    const inp = {
      mx: fx * iy + rx * ix, mz: fz * iy + rz * ix, ix, iy,
      look, camPos, viewToggle: this.pressed("KeyP"),
      jump: this.pressed("Space") || pdn(0), jumpHeld: this.held("Space") || !!pb[0],
      sprint: this.held("ShiftLeft", "AltLeft", "AltRight") || !!pb[10],
      swing: this.held("ShiftLeft", "ShiftRight") || b(4) || (pad ? pad.rt > .35 : false),
      swingDown: this.pressed("ShiftLeft", "ShiftRight") || bd(4) || (pad ? pad.rt > .35 && !(this.prevRT > .35) : false),
      swingUp: this.released("ShiftLeft", "ShiftRight") || bu(4) || (!(pad?.rt > .35) && this.prevRT > .35),
      zip: this.pressed("KeyC") || (!!pad && pad.lt > .35 && pad.rt > .35 && !(this.prevLT > .35 && this.prevRT > .35)),
      sling: b(4) && this.held("Space"), wings: this.pressed("KeyF"),
      parry: this.pressed("KeyV") || pdn(4) && !padAbility, parryKey: this.pressed("KeyV"),
      ability: emoteHeld ? 0 : digit && digit >= 7 ? digit - 6 : padAbility,
      crouch: this.held("ControlLeft", "ControlRight"), crouchDown: this.pressed("ControlLeft", "ControlRight"),
      trick: this.held("KeyX", "KeyT"), trickDown: this.pressed("KeyX", "KeyT"),
      trickX: ix, trickY: iy,
      trickStyle: this.held("ControlLeft", "ControlRight", "KeyC") ? "pike" : this.held("AltLeft", "AltRight") ? "layout" : "base",
      attack: bd(1) || pdn(2) && !lb && !rb, attackHeld: b(1) || !!pb[2] && !lb && !rb, attackDown: bd(1) || pdn(2) && !lb && !rb, attackUp: bu(1) || pup(2),
      dodge: this.pressed("KeyR") || pdn(1) && !padFinisher && !padGadget,
      strike: this.pressed("KeyF") || pdn(3) && !lb && !rb && !padFinisher,
      gadget: emoteHeld ? 0 : this.pressed("KeyE") ? 1 : digit && digit <= 6 ? digit : padGadget || dpad || (pdn(5) ? 1 : 0),
      emote: emoteHeld && digit && digit <= 8 ? digit : 0, emoteMenu: emoteHeld,
      throwObj: this.pressed("KeyQ", "KeyG") || pdn(11) && !rb,
      finisher: this.pressed("KeyZ") || padFinisher, finisherHeld: this.held("KeyZ") || !!pb[13],
      cycle: this.wheel ? Math.sign(this.wheel) : 0, lockTarget: bd(2) || pdn(11),
      map: this.pressed("Tab", "KeyM") || pdn(8), activities: this.pressed("KeyK"), help: this.pressed("KeyH"), photo: this.pressed("KeyO"),
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
