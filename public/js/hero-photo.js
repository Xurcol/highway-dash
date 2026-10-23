// Hero mode photo mode (O): the hero and the street freeze, the HUD goes away, and a free camera flies
// round the scene (WASD, Q/PageUp for down and up, drag to look, wheel for the lens) within reach of the
// hero. Filters, a vignette, letterbox frames, the time of day (when playing alone) and the hero's
// visibility can be changed, and Take Photo saves a PNG with the filter and frame baked in.
import * as THREE from "three";

const FILTERS = {
  none: { name: "None", css: "" },
  noir: { name: "Noir", css: "grayscale(1) contrast(1.25) brightness(1.02)" },
  vivid: { name: "Vivid", css: "saturate(1.45) contrast(1.08)" },
  warm: { name: "Golden", css: "sepia(.35) saturate(1.25) hue-rotate(-8deg) brightness(1.04)" },
  cool: { name: "Night City", css: "saturate(1.2) hue-rotate(18deg) contrast(1.1) brightness(.96)" },
  faded: { name: "Faded", css: "contrast(.85) saturate(.75) brightness(1.08)" },
  comic: { name: "Ink", css: "contrast(1.6) saturate(1.6) brightness(1.05)" },
};
const REACH = 45;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export class PhotoMode {
  constructor(hero) {
    this.hero = hero; this.on = false;
    this.keys = new Set(); this.drag = false; this.yaw = 0; this.pitch = 0;
    this.opt = { fov: 60, roll: 0, filter: "none", vignette: .35, frame: false, hideHero: false, hour: null };
    this.pos = new THREE.Vector3(); this.savedFov = 66;
    this.onKey = (e) => {
      if (!this.on || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) && e.code !== "Escape") return;
      if (e.type === "keydown") {
        if (e.code === "Escape" || e.code === "KeyO") { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
        if (e.code === "KeyE" || e.code === "Space" || e.code === "Enter") { e.preventDefault(); this.capture(); return; }
        if (e.code === "KeyH") { this.el.classList.toggle("hidden-ui"); return; }
        this.keys.add(e.code);
      } else this.keys.delete(e.code);
      e.stopImmediatePropagation();
    };
  }
  get ctx() { return this.hero.ctx; }
  toggle() { return this.on ? this.close() : this.open(); }
  open() {
    const h = this.hero, cam = this.ctx.camera;
    if (!h.on || this.on) return;
    if (h.combat.downT > 0) return;
    this.on = true;
    h.input.unlock(); h.input.wantLock = false;
    this.pos.copy(cam.position);
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    this.savedFov = cam.fov; this.opt.fov = Math.round(cam.fov); this.opt.roll = 0;
    this.opt.hour = this.ctx.sky.hour;
    this.build();
    this.el.hidden = false; this.el.classList.remove("hidden-ui");
    document.body.classList.add("photo-mode");
    addEventListener("keydown", this.onKey, true); addEventListener("keyup", this.onKey, true);
    this.render();
  }
  close() {
    if (!this.on) return;
    const h = this.hero, cam = this.ctx.camera;
    this.on = false; this.keys.clear(); this.drag = false;
    removeEventListener("keydown", this.onKey, true); removeEventListener("keyup", this.onKey, true);
    this.el.hidden = true;
    document.body.classList.remove("photo-mode");
    this.ctx.renderer.domElement.style.filter = "";
    cam.fov = this.savedFov; cam.up.set(0, 1, 0); cam.updateProjectionMatrix();
    h.rig.group.visible = true;
    h.input.clear(); h.input.wantLock = true; h.cam.snapNext = true;
  }
  build() {
    if (this.el) return;
    const el = this.el = document.createElement("div");
    el.className = "photo"; el.hidden = true;
    el.innerHTML = `<div class="photo-vig"></div><div class="photo-frame"><i></i><i></i></div>
      <aside class="photo-panel">
        <header><small>NEW MERIDIAN</small><b>PHOTO MODE</b></header>
        <label>Lens <output data-o="fov"></output><input type="range" min="18" max="100" step="1" data-k="fov"></label>
        <label>Roll <output data-o="roll"></output><input type="range" min="-35" max="35" step="1" data-k="roll"></label>
        <label>Vignette <output data-o="vignette"></output><input type="range" min="0" max="1" step=".05" data-k="vignette"></label>
        <label class="photo-hour">Time of day <output data-o="hour"></output><input type="range" min="0" max="23.9" step=".1" data-k="hour"></label>
        <div class="photo-filters">${Object.entries(FILTERS).map(([id, f]) => `<button data-f="${id}">${esc(f.name)}</button>`).join("")}</div>
        <div class="photo-toggles"><button data-t="frame">Letterbox</button><button data-t="hideHero">Hide hero</button></div>
        <button class="btn photo-shot" data-act="shot">TAKE PHOTO · SPACE</button>
        <button class="btn gray" data-act="exit">EXIT · O</button>
        <p>WASD move · Q / E down / up · drag to look · wheel lens · H hide panel</p>
      </aside>`;
    (document.getElementById("hud")?.parentNode || document.body).appendChild(el);
    el.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      this.opt[k] = Number(e.target.value);
      if (k === "hour" && !this.hero.online) { this.ctx.sky.hour = this.opt.hour; this.ctx.sky.flow = false; }
      this.render();
    });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.f) this.opt.filter = b.dataset.f;
      if (b.dataset.t) this.opt[b.dataset.t] = !this.opt[b.dataset.t];
      if (b.dataset.act === "shot") return this.capture();
      if (b.dataset.act === "exit") return this.close();
      this.render();
    });
    // looking round: drag anywhere off the panel
    const canvas = this.ctx.renderer.domElement;
    canvas.addEventListener("mousedown", (e) => { if (this.on) { this.drag = true; e.preventDefault(); } });
    addEventListener("mouseup", () => { this.drag = false; });
    addEventListener("mousemove", (e) => {
      if (!this.on || !this.drag) return;
      this.yaw -= e.movementX * .0035; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * .0035));
    });
    canvas.addEventListener("wheel", (e) => { if (!this.on) return; this.opt.fov = Math.max(18, Math.min(100, this.opt.fov + Math.sign(e.deltaY) * 3)); this.render(); e.preventDefault(); }, { passive: false });
  }
  render() {
    const o = this.opt, el = this.el;
    for (const inp of el.querySelectorAll("input[data-k]")) if (document.activeElement !== inp) inp.value = o[inp.dataset.k];
    const fmt = { fov: `${o.fov}°`, roll: `${o.roll}°`, vignette: `${Math.round(o.vignette * 100)}%`, hour: `${String(Math.floor(o.hour)).padStart(2, "0")}:${String(Math.floor(o.hour % 1 * 60)).padStart(2, "0")}` };
    for (const out of el.querySelectorAll("output[data-o]")) out.textContent = fmt[out.dataset.o];
    for (const b of el.querySelectorAll("[data-f]")) b.classList.toggle("on", b.dataset.f === o.filter);
    for (const b of el.querySelectorAll("[data-t]")) b.classList.toggle("on", !!o[b.dataset.t]);
    el.querySelector(".photo-hour").hidden = this.hero.online;
    el.querySelector(".photo-vig").style.opacity = o.vignette;
    el.querySelector(".photo-frame").hidden = !o.frame;
    this.ctx.renderer.domElement.style.filter = FILTERS[o.filter].css;
  }
  // the free camera, every frame while open
  update(dt) {
    const cam = this.ctx.camera, H = this.hero.H, k = this.keys;
    const sp = (k.has("ShiftLeft") || k.has("ShiftRight") ? 16 : 6) * dt;
    const fx = -Math.sin(this.yaw) * Math.cos(this.pitch), fy = Math.sin(this.pitch), fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = 0, my = 0, mz = 0;
    if (k.has("KeyW")) { mx += fx; my += fy; mz += fz; }
    if (k.has("KeyS")) { mx -= fx; my -= fy; mz -= fz; }
    if (k.has("KeyD")) { mx += rx; mz += rz; }
    if (k.has("KeyA")) { mx -= rx; mz -= rz; }
    if (k.has("PageUp")) my += 1;
    if (k.has("KeyQ")) my -= 1;
    this.pos.x += mx * sp; this.pos.y += my * sp; this.pos.z += mz * sp;
    // stay near the hero and out of the walls
    const dx = this.pos.x - H.p.x, dy = this.pos.y - H.p.y, dz = this.pos.z - H.p.z, d = Math.hypot(dx, dy, dz);
    if (d > REACH) this.pos.set(H.p.x + dx / d * REACH, H.p.y + dy / d * REACH, H.p.z + dz / d * REACH);
    const W = this.hero.W, res = this.res || (this.res = { contacts: [] });
    W.collide(this.pos, .25, res);
    this.pos.y = Math.max(this.pos.y, .3);
    cam.position.copy(this.pos);
    cam.up.set(Math.sin(this.opt.roll * Math.PI / 180) * Math.cos(this.yaw), Math.cos(this.opt.roll * Math.PI / 180), -Math.sin(this.opt.roll * Math.PI / 180) * Math.sin(this.yaw));
    cam.lookAt(this.pos.x + fx, this.pos.y + fy, this.pos.z + fz);
    if (cam.fov !== this.opt.fov) { cam.fov = this.opt.fov; cam.updateProjectionMatrix(); }
    this.hero.rig.group.visible = !this.opt.hideHero;
  }
  // a PNG of the current view, with the filter, vignette and letterbox drawn into it
  capture() {
    const renderer = this.ctx.renderer, src = renderer.domElement, o = this.opt;
    this.ctx.renderFrame?.();
    const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
    const g = c.getContext("2d");
    g.filter = FILTERS[o.filter].css || "none";
    g.drawImage(src, 0, 0);
    g.filter = "none";
    if (o.vignette > 0) {
      const r = Math.hypot(c.width, c.height) / 2, grad = g.createRadialGradient(c.width / 2, c.height / 2, r * .35, c.width / 2, c.height / 2, r);
      grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, `rgba(0,0,0,${(o.vignette * .85).toFixed(2)})`);
      g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
    }
    if (o.frame) { const bar = Math.round(c.height * .11); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, bar); g.fillRect(0, c.height - bar, c.width, bar); }
    g.font = `700 ${Math.round(c.height * .018)}px sans-serif`; g.fillStyle = "rgba(255,255,255,.7)"; g.textAlign = "right";
    g.fillText("ARCLINE · NEW MERIDIAN", c.width - c.height * .03, c.height - c.height * (o.frame ? .14 : .03));
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a"), stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      a.href = URL.createObjectURL(blob); a.download = `arcline-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
    this.el.classList.add("flash"); setTimeout(() => this.el.classList.remove("flash"), 220);
    this.ctx.ui?.toast("Photo saved to your downloads.", [], "success");
  }
}
