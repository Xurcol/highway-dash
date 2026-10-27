// Hero mode camera: a third-person orbit you steer with the mouse, that behaves like a camera operator
// following an athlete. It trails a little and pulls back as the speed builds (with a wider lens),
// swings round behind the direction of travel when you leave the mouse alone, tips down to look where
// a dive is heading, frames the fight in combat, kicks on landings and hits, sways a touch at speed,
// and never goes through a wall.
import * as THREE from "three";

const V = THREE.Vector3;
const OPTIONS = {};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
// smooth 1D noise for the sway
const noise = (t, s) => Math.sin(t * 1.7 + s) * .55 + Math.sin(t * 2.9 + s * 2.1) * .3 + Math.sin(t * 5.3 + s * 3.7) * .15;

export class HeroCam {
  constructor(camera, world) {
    this.cam = camera; this.W = world;
    this.yaw = 0; this.pitch = -.12;
    this.dist = 4.6; this.fov = 66; this.trauma = 0; this.kick = new V();
    this.pivot = new V(); this.pos = new V(); this.look = new V(0, 0, -1);
    this.idle = 0; this.t = 0; this.roll = 0;
    this.sens = .0022; this.invertY = false; this.autoFollow = true;
    this.combat = null;      // { x, y, z } a point to keep in frame
    this.snapNext = true;
    this.wallK = 0; this.speed = 0;
    this.wallGrace = 0;
    this.probeT = 0;
    this.contacts = { contacts: [] };
  }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  punch(x, y, z) { this.kick.set(x, y, z); }
  // where the camera looks, flattened onto the ground: what "forward" means for the move keys
  get heading() { return this.yaw; }

  update(dt, H, inp, o = OPTIONS) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    this.t += dt;
    const p = H.p, v = H.v, sp = v.length(), hs = Math.hypot(v.x, v.z), snap = this.snapNext;
    this.wallGrace = H.state === "wall" ? 1 : snap ? 0 : Math.max(0, this.wallGrace - dt);
    if (snap) { this.idle = 0; this.speed = sp; this.roll = this.trauma = 0; this.kick.set(0, 0, 0); }
    else this.speed += (sp - this.speed) * ease(dt, 5);
    // ---- the player's mouse ----
    const mdx = inp?.mdx || 0, mdy = inp?.mdy || 0;
    if (Math.abs(mdx) + Math.abs(mdy) > .01) this.idle = 0; else this.idle += dt;
    if (this.wallGrace > 0) this.idle = 0;
    this.yaw -= mdx * this.sens;
    this.pitch -= mdy * this.sens * (this.invertY ? -1 : 1);
    // ---- following on its own when left alone: swing round behind the direction of travel ----
    const moving = (H.state === "swing" || H.state === "air" || H.state === "zip") && hs > 9 || H.state === "ground" && hs > 12 || H.state === "wall" && sp > 3;
    // A wall is a deliberate camera state: never auto-orbit while attached, because that makes
    // the surface feel like it is dragging the player's view around.
    if (this.autoFollow && !this.firstPerson && H.state !== "wall" && this.idle > 1.1 && moving && !this.combat && !o.aim && !o.tricking) {
      const wx = v.x, wz = v.z;
      const want = Math.atan2(-wx, -wz), d = wrapA(want - this.yaw);
      // Ease into following after mouse input, even when the hero reverses direction.
      const follow = clamp((this.idle - 1.1) / .7, 0, 1);
      this.yaw += clamp(d, -1.8, 1.8) * ease(dt, (H.state === "swing" || H.state === "zip" ? 1.8 : 1.2) * follow);
      // and level out towards a slightly downward look, lower in a dive
      const wantP = H.dive ? -.55 : v.y < -15 ? -.35 : -.14;
      this.pitch += (wantP - this.pitch) * ease(dt, 1.2 * follow);
    }
    this.pitch = clamp(this.pitch, -1.38, 1.15);
    this.yaw = wrapA(this.yaw);

    if (this.firstPerson) {
      // Keep the horizon under mouse control even during flips and wall traversal.
      const cp = Math.cos(this.pitch);
      this.look.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
      this.pos.copy(p); this.pos.y += .55;
      this.W.collide?.(this.pos, .2, this.contacts, 2);
      this.cam.position.copy(this.pos); this.cam.up.set(0, 1, 0);
      this.cam.lookAt(this.pos.x + this.look.x, this.pos.y + this.look.y, this.pos.z + this.look.z);
      const target = 78 + clamp((this.speed - 15) / (H.speedster ? 100 : 50), 0, 1) * (H.speedster ? 14 : 8);
      this.fov = snap ? target : this.fov + (target - this.fov) * ease(dt, 4);
      if (Math.abs(this.cam.fov - this.fov) > .05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
      this.snapNext = false;
      return;
    }

    // ---- how far back and how wide, from speed and what the body is doing ----
    let dist = 4.7 + clamp((this.speed - 8) / 46, 0, 1) * 2.9, fov = 65 + clamp((this.speed - 10) / 52, 0, 1) * 17, up = .65, side = .35;
    if (H.speedster) { fov += clamp((this.speed - 25) / 100, 0, 1) * 10; }
    if (H.state === "swing") { dist += .45; up = .8; }
    if (H.state === "zip") { dist += .25; up = .7; }
    if (H.state === "wall") { dist = 5.15; up = .45; side = 0; }
    if (H.state === "wall" && H.wallMode === "run") { dist += .35; fov += 4; }
    if (H.state === "perch") { dist = 4.6; up = .9; }
    if (H.state === "ledge") { dist = 4.2; up = .7; }
    if (H.dive) { fov += 8; dist += .6; }
    if (H.state === "air" && H.v.y < -18) { fov += 5; dist += .45; up = .5; }
    if (H.glide) { dist += 1.2; fov += 4; }
    if (o.dashing) { dist += .35; fov += 5; }
    // Keep the whole flip readable without orbiting the camera with the hero's rotation.
    if (o.tricking) { dist += 1.1; up = .55; side = .15; fov += 3; }
    if (H.state === "ground" && H.slideT > 0) { up = .2; dist = 3.8; }
    if (this.combat) { dist = Math.max(dist, 5.8 + Math.min(4, this.combat.d * .25)); up = 1.0; side = .15; fov = Math.max(fov, 66); }
    if (o.aim) { dist = 2.6; side = .7; up = .45; fov = 52; }
    this.dist = snap ? dist : this.dist + (dist - this.dist) * ease(dt, o.aim ? 8 : 4);
    this.fov = snap ? fov : this.fov + (fov - this.fov) * ease(dt, o.aim ? 8 : 4.5);

    // ---- the pivot trails the body a little, leading it slightly in the direction of travel ----
    const lead = o.aim || this.combat ? .025 : clamp(sp / 50, 0, 1) * .085;
    let tx = p.x + v.x * lead, ty = p.y + up + clamp(v.y * .025, -.7, .65), tz = p.z + v.z * lead;
    // on a wall the camera stands off it, so it looks at the hero rather than along the bricks
    const wall = H.state === "wall" && !H.ceiling ? 1 : 0;
    const wallK = this.wallK = snap ? wall : wall ? this.wallK + (1 - this.wallK) * ease(dt, 11) : this.wallK * (1 - ease(dt, 9));
    // Preserve the orbit pivot through contact and release. Collision probes pull the
    // camera closer instead of shifting it sideways when wall normals change at corners.
    // in combat, the pivot slides towards the middle of the fight
    if (this.combat) { const c = this.combat; tx += (c.x - p.x) * .25; tz += (c.z - p.z) * .25; }
    // Leading the hero must not move the camera's pivot through the next building.
    const lx = tx - p.x, ly = ty - (p.y + up), lz = tz - p.z, leadL = Math.hypot(lx, ly, lz);
    if (leadL > .05) {
      const hit = this.W.raycast(p.x, p.y + up, p.z, lx, ly, lz, leadL + .2, 2, _h);
      if (hit) { const k = clamp((hit.t - .25) / leadL, 0, 1); tx = p.x + lx * k; ty = p.y + up + ly * k; tz = p.z + lz * k; }
    }
    if (this.snapNext) { this.pivot.set(tx, ty, tz); }
    else {
      const kp = ease(dt, 20 + sp * .12);
      this.pivot.x += (tx - this.pivot.x) * kp; this.pivot.y += (ty - this.pivot.y) * ease(dt, 24 + sp * .12); this.pivot.z += (tz - this.pivot.z) * kp;
    }
    this.W.collide?.(this.pivot, .25, this.contacts, 2);

    // ---- orbit ----
    const cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    let fx = -Math.sin(this.yaw) * cp, fy = sp2, fz = -Math.cos(this.yaw) * cp;
    // Wall normals must never rewrite the viewing direction: the correction could
    // reverse a nearly head-on view as it faded in or out after a wall jump.
    this.look.set(fx, fy, fz);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);   // right of the view
    if (side > 0) {
      const shoulder = this.W.raycast(this.pivot.x, this.pivot.y, this.pivot.z, rx, 0, rz, side + .3, 2, _h);
      if (shoulder) side = Math.min(side, Math.max(0, shoulder.t - .3));
    }
    const ox = this.pivot.x + rx * side, oz = this.pivot.z + rz * side, oy = this.pivot.y;
    let want = this.dist;
    // Keep the centre ray current every frame; repeat edge rays more often beside a wall or during a fast orbit.
    this.probeT += dt;
    const edges = snap || this.probeT >= 1 / 30 || wallK > .01 || this.curDist < this.dist - .1 || Math.abs(mdx) + Math.abs(mdy) > 2;
    if (edges) this.probeT %= 1 / 30;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    for (let i = 0; i < (edges ? 5 : 1); i++) {
      const sx = i === 1 ? rx * .22 : i === 2 ? -rx * .22 : i === 3 ? ux * .22 : i === 4 ? -ux * .22 : 0;
      const sy = i === 3 ? uy * .22 : i === 4 ? -uy * .22 : 0;
      const sz = i === 1 ? rz * .22 : i === 2 ? -rz * .22 : i === 3 ? uz * .22 : i === 4 ? -uz * .22 : 0;
      const h = this.W.raycast(ox + sx, oy + sy, oz + sz, -fx, -fy, -fz, want + .3, 2, _h);
      if (h) want = Math.min(want, Math.max(.15, h.t - .3));
    }
    // Pull in immediately, then return slowly once the whole camera has cleared the obstacle.
    this.curDist = snap || this.curDist === undefined || want < this.curDist ? want : this.curDist + (want - this.curDist) * ease(dt, 3.5);
    const cx = ox - fx * this.curDist, cz = oz - fz * this.curDist;
    let cy = oy - fy * this.curDist;
    const floor = this.W.topAt(cx, cz, cy + .35);
    cy = Math.max(cy, floor + .3);
    this.pos.set(cx, cy, cz);
    this.snapNext = false;

    // ---- shake, kicks, sway at speed ----
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const tr = this.trauma * this.trauma, spd = clamp((this.speed - 28) / 42, 0, 1);
    const sx = (tr > 0 ? noise(this.t * 12, 1) * tr * .23 : 0) + (spd > 0 ? noise(this.t * 1.3, 4) * spd * .035 : 0);
    const sy = (tr > 0 ? noise(this.t * 12, 7) * tr * .2 : 0) + (spd > 0 ? noise(this.t * 1.1, 9) * spd * .025 : 0);
    this.kick.multiplyScalar(Math.exp(-dt * 7));
    const C = this.cam;
    C.position.set(this.pos.x + rx * sx + this.kick.x, this.pos.y + sy + this.kick.y, this.pos.z + rz * sx + this.kick.z);
    // One sphere correction after shake also covers the unshaken boom endpoint.
    this.W.collide?.(C.position, .28, this.contacts, 2);
    C.position.y = Math.max(C.position.y, this.W.topAt(C.position.x, C.position.z, C.position.y + .3) + .25);
    C.up.set(0, 1, 0);
    C.lookAt(C.position.x + fx, C.position.y + fy, C.position.z + fz);
    // a little roll into hard turns at speed, and with the trauma
    const turn = H.turnRate || 0;
    const turnRoll = this.wallGrace > 0 ? 0 : clamp(-turn * .025 * clamp(hs / 35, 0, 1), -.055, .055);
    this.roll += (turnRoll - this.roll) * ease(dt, 4.5);
    C.rotateZ(this.roll + (tr > 0 ? noise(this.t * 14, 3) * tr * .035 : 0));
    if (Math.abs(C.fov - this.fov) > .05) { C.fov = this.fov; C.updateProjectionMatrix(); }
  }
}
const _h = {};
