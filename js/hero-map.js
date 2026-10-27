// Hero mode world map (M): the whole of New Meridian, north up, drawn from the city's own minimap
// image - with the hero, the other heroes, crimes and emergencies, Signal Caches, the wind currents
// and updrafts, and the district names. Wheel zooms, dragging pans, and clicking a spot fast travels
// there (onto the roof or street below it), unless the hero is in a fight, a race or carrying someone.
const LABELS = [
  ["DOWNTOWN", 0, 0], ["MIDTOWN", 0, 600], ["MIDTOWN", 600, 0], ["INDUSTRIAL DISTRICT", 900, -900], ["EASTGATE RETAIL", 900, 900],
  ["NORTHWEST HEIGHTS", -900, -900], ["WESTWOOD", -900, 300], ["LAKESIDE PARK", -900, 900], ["TIMES SQUARE", 140, 140],
];

export class WorldMap {
  constructor(hero) {
    this.hero = hero; this.on = false;
    this.zoom = 1; this.cx = 0; this.cz = 0; this.drag = null; this.hover = null;
  }
  get city() { return this.hero.ctx.city; }
  toggle() { return this.on ? this.close() : this.open(); }
  open() {
    const h = this.hero;
    if (!h.on || !this.city.mapCanvas) return;
    this.build();
    this.on = true; this.el.hidden = false;
    this.cx = h.H.p.x; this.cz = h.H.p.z; this.zoom = 1.6;
    h.input.unlock(); h.input.wantLock = false;
    this.draw();
  }
  close() {
    if (!this.on) return;
    this.on = false; this.el.hidden = true; this.drag = null;
    this.hero.input.clear(); this.hero.input.wantLock = true;
  }
  build() {
    if (this.el) return;
    const el = this.el = document.createElement("div");
    el.className = "wmap"; el.hidden = true;
    el.innerHTML = `<div class="wmap-card">
      <header><div><small>NEW MERIDIAN</small><b>WORLD MAP</b></div><span id="wmStats"></span><button class="btn gray" data-act="close">CLOSE · TAB / M</button></header>
      <canvas></canvas>
      <footer><span><i class="k-hero"></i>You</span><span><i class="k-crime"></i>Crime</span><span><i class="k-help"></i>Emergency</span><span><i class="k-cache"></i>Signal cache</span><span><i class="k-wind"></i>Wind current</span><span><i class="k-draft"></i>Updraft</span><em>Click to fast travel · wheel to zoom · drag to pan</em></footer>
    </div>`;
    (document.getElementById("hud") || document.body).appendChild(el);
    const cv = this.cv = el.querySelector("canvas");
    this.g = cv.getContext("2d");
    el.addEventListener("click", (e) => { if (e.target.closest("[data-act=close]")) this.close(); });
    addEventListener("keydown", (e) => {
      if (!this.on) return;
      if (e.code === "Escape" || e.code === "KeyM" || e.code === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    }, true);
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [wx, wz] = this.toWorld(e.offsetX, e.offsetY);
      this.zoom = Math.max(1, Math.min(8, this.zoom * (e.deltaY > 0 ? .85 : 1.18)));
      // keep the point under the cursor where it is
      const [nx, nz] = this.toWorld(e.offsetX, e.offsetY);
      this.cx += wx - nx; this.cz += wz - nz;
      this.draw();
    }, { passive: false });
    cv.addEventListener("mousedown", (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false }; });
    addEventListener("mousemove", (e) => {
      if (!this.on) return;
      if (this.drag) {
        const s = this.scale(), dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
        this.cx = this.drag.cx - dx / s; this.cz = this.drag.cz - dy / s; this.draw();
      } else if (e.target === this.cv) { this.hover = this.toWorld(e.offsetX, e.offsetY); this.draw(); }
    });
    addEventListener("mouseup", (e) => {
      if (!this.on || !this.drag) return;
      const d = this.drag; this.drag = null;
      if (!d.moved && e.target === this.cv) { const [x, z] = this.toWorld(e.offsetX, e.offsetY); this.travel(x, z); }
    });
  }
  ext() { return this.city.mapExt || this.city.mapCanvas.width / this.city.mapK / 2; }
  scale() { return this.cv.width / (this.ext() * 2) * this.zoom; }
  toWorld(px, py) { const s = this.scale(), r = this.cv.width / this.cv.clientWidth || 1; return [this.cx + (px * r - this.cv.width / 2) / s, this.cz + (py * r - this.cv.height / 2) / s]; }
  draw() {
    if (!this.on) return;
    const cv = this.cv, size = Math.round(Math.min(innerWidth * .9, innerHeight * .78) * Math.min(2, devicePixelRatio || 1));
    if (cv.width !== size) { cv.width = cv.height = size; }
    const g = this.g, city = this.city, h = this.hero, s = this.scale(), ext = this.ext(), k = city.mapK;
    const X = (x) => cv.width / 2 + (x - this.cx) * s, Z = (z) => cv.height / 2 + (z - this.cz) * s;
    g.fillStyle = "#0a0b0e"; g.fillRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(city.mapCanvas, X(-ext), Z(-ext), ext * 2 * s, ext * 2 * s);
    void k;
    const dot = (x, z, r, col, ring) => { g.beginPath(); g.arc(X(x), Z(z), r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); if (ring) { g.lineWidth = 2; g.strokeStyle = ring; g.stroke(); } };
    const px = Math.max(1, cv.width / 900);
    // the wind: currents as arrows, updrafts as rings
    const winds = h.winds;
    if (winds) {
      g.lineCap = "round";
      for (const w of winds.tunnels) {
        g.strokeStyle = "rgba(180,235,255,.55)"; g.lineWidth = Math.max(2, w.r * s * .6);
        g.beginPath(); g.moveTo(X(w.ax), Z(w.az)); g.lineTo(X(w.bx), Z(w.bz)); g.stroke();
        const mx = X(w.ax + (w.bx - w.ax) * .6), mz = Z(w.az + (w.bz - w.az) * .6), a = Math.atan2(w.dz, w.dx), L = 9 * px;
        g.fillStyle = "#dff6ff"; g.beginPath(); g.moveTo(mx + Math.cos(a) * L, mz + Math.sin(a) * L);
        g.lineTo(mx + Math.cos(a + 2.5) * L, mz + Math.sin(a + 2.5) * L); g.lineTo(mx + Math.cos(a - 2.5) * L, mz + Math.sin(a - 2.5) * L); g.fill();
      }
      for (const d of winds.drafts) { g.lineWidth = 2 * px; g.strokeStyle = "rgba(180,235,255,.8)"; g.beginPath(); g.arc(X(d.x), Z(d.z), 6 * px, 0, Math.PI * 2); g.stroke(); }
    }
    for (const c of h.caches?.list || []) if (!c.taken) { g.save(); g.translate(X(c.x), Z(c.z)); g.rotate(Math.PI / 4); g.fillStyle = "#ffc85a"; g.fillRect(-4 * px, -4 * px, 8 * px, 8 * px); g.restore(); }
    for (const e of h.events?.list || []) if (e.state !== "done" && e.state !== "failed") dot(e.x, e.z, 7 * px, h.eventColor(e), "#0a0b0e");
    for (const r of h.remoteHeroes()) dot(r.x, r.z, 6 * px, r.color || "#ffffff", "#0a0b0e");
    // labels
    g.textAlign = "center"; g.font = `700 ${Math.round(11 * px)}px sans-serif`; g.fillStyle = "rgba(220,226,235,.55)";
    for (const [n, x, z] of LABELS) g.fillText(n, X(x), Z(z));
    // you: an arrow the way the camera looks
    const H = h.H, yaw = Math.atan2(h.cam.look.x, -h.cam.look.z);
    g.save(); g.translate(X(H.p.x), Z(H.p.z)); g.rotate(yaw);
    g.fillStyle = "#ffffff"; g.strokeStyle = "#0a0b0e"; g.lineWidth = 2 * px;
    g.beginPath(); g.moveTo(0, -13 * px); g.lineTo(9 * px, 10 * px); g.lineTo(0, 5 * px); g.lineTo(-9 * px, 10 * px); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // where a click would land
    if (this.hover && !this.drag) {
      const [x, z] = this.hover;
      g.strokeStyle = "#7fe9ff"; g.lineWidth = 2 * px; g.beginPath(); g.arc(X(x), Z(z), 11 * px, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(X(x) - 16 * px, Z(z)); g.lineTo(X(x) + 16 * px, Z(z)); g.moveTo(X(x), Z(z) - 16 * px); g.lineTo(X(x), Z(z) + 16 * px); g.stroke();
    }
    const st = this.el.querySelector("#wmStats");
    const found = h.caches ? `${h.caches.count()}/${h.caches.list.length} signal caches` : "";
    if (st.textContent !== found) st.textContent = found;
  }
  // fast travel: onto whatever is under the point, a moment of fade, and the camera behind the hero
  travel(x, z) {
    const h = this.hero, H = h.H, W = h.W, ui = h.ctx.ui;
    if (h.inCombat) return ui?.toast("You can't fast travel in the middle of a fight.", [], "warn");
    if (h.carry) return ui?.toast("Set them down somewhere safe first.", [], "warn");
    if (h.activities.race) return ui?.toast("Finish the race first.", [], "warn");
    const lim = W.bound - 40;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return ui?.toast("That's beyond the edge of the city.", [], "warn");
    // over the river only a bridge, a pier or a ship will do
    const top = W.topAt(x, z, 600), wy = W.waterAt(x, z);
    if (wy > -Infinity && !(top > wy + .5)) return ui?.toast("Pick somewhere on land - that's the river.", [], "warn");
    const y = (Number.isFinite(top) ? Math.max(0, top) : 0) + 1;
    this.close();
    const fade = document.createElement("div"); fade.className = "wmap-fade"; document.body.appendChild(fade);
    setTimeout(() => {
      H.reset(x, y + .98, z); H.state = "ground";
      h.afterTeleport();
      h.cam.snapNext = true;
      h.hud.districtName = null;
      h.hud.center("FAST TRAVEL", "", 1.2, "small");
      setTimeout(() => fade.remove(), 600);
    }, 260);
  }
}
