// Hero mode: the city as the hero touches it. Built from the City Drive map (city-map.js) - the same
// towers, ring expressway, houses and tanks the cars drive past - plus the hero-only structures from
// hero-extras.js, as solids in a 16 m grid: what the hero stands on, runs up, swings from, zips to and
// bumps into. Pure JS (no three.js), so the movement can be stepped and tested under plain Node.
//
// Solids are axis-aligned boxes, vertical cylinders, boxes turned about y (the ring deck's corners,
// pier caps), pitched house roofs, and spheres (tree crowns - webs stick to them, the hero passes
// through). Every solid keeps its axis-aligned bounds in x0..x1, y0..y1, z0..z1.
import { heightAt, surfaceAt, DECK_Y, DECK_HW, DECK_T, LAKE, CURB, EDGE, hash, groundAt } from "./city-map.js";
import { RIVER, TUNNEL, deckY } from "./hero-extras-map.js";

export const BOX = 0, CYL = 1, OBB = 2, PRISM = 3, SPHERE = 4;
const CELL = 16;
const key = (i, j) => (i + 2048) * 4096 + (j + 2048);

export class HeroWorld {
  constructor(M) {
    this.M = M;
    this.solids = []; this.grid = new Map(); this.stamp = 0;
    this.perches = []; this.pgrid = new Map();
    this.water = [];          // { kind: "ellipse", x, z, rx, rz, y } | { kind: "rect", x0, z0, x1, z1, y }
    this.bound = EDGE + 380;  // the hero is kept inside this square
    this.hits = [];           // scratch
    this.dyn = [];            // moving solids (traffic, trains): rebuilt every frame, not in the grid
    this.build();
  }

  // ------------------------------------------------------------------ building
  add(s) {
    s.id = this.solids.length;
    s.q = 0;
    if (s.solid === undefined) s.solid = true;
    if (s.web === undefined) s.web = true;
    this.solids.push(s);
    for (let i = Math.floor(s.x0 / CELL); i <= Math.floor(s.x1 / CELL); i++) for (let j = Math.floor(s.z0 / CELL); j <= Math.floor(s.z1 / CELL); j++) {
      const k = key(i, j);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(s);
    }
    return s;
  }
  box(x0, y0, z0, x1, y1, z1, kind, o = {}) { return this.add({ t: BOX, x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), kind, ...o }); }
  cyl(cx, cz, r, y0, y1, kind, o = {}) { return this.add({ t: CYL, cx, cz, r, x0: cx - r, x1: cx + r, z0: cz - r, z1: cz + r, y0, y1, kind, ...o }); }
  // a box of half-size hx (along its own x) by hz, turned by yaw about y (local x = (cos, -sin) in world xz)
  obb(cx, cz, hx, hz, yaw, y0, y1, kind, o = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw), ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    return this.add({ t: OBB, cx, cz, hx, hz, c, s, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y0, y1, kind, ...o });
  }
  // a pitched roof: eaves at y0, ridge at y1, ridge running along x (alongX) or z
  prism(cx, cz, sx, sz, y0, y1, alongX, kind, o = {}) {
    return this.add({ t: PRISM, cx, cz, alongX, half: (alongX ? sz : sx) / 2, x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2, y0, y1, kind, ...o });
  }
  sphere(cx, cy, cz, r, kind, o = {}) { return this.add({ t: SPHERE, cx, cy, cz, r, x0: cx - r, x1: cx + r, z0: cz - r, z1: cz + r, y0: cy - r, y1: cy + r, kind, solid: false, ...o }); }
  perch(x, y, z, nx, nz, kind) {
    const p = { x, y, z, nx, nz, kind };
    this.perches.push(p);
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    let a = this.pgrid.get(k);
    if (!a) this.pgrid.set(k, (a = []));
    a.push(p);
  }

  build() {
    const M = this.M;
    // towers, podiums, houses, stores, sheds; the step-backs that stand on other buildings too
    for (const b of M.buildings) this.box(b.x0, b.y0 - (b.y0 < .3 ? 1 : 0), b.z0, b.x1, b.y1, b.z1, "bldg", { b });
    // roof plant, parapets, masts
    for (const r of M.roofs) {
      const kind = r.sy > 6 && r.sx < 1.2 ? "mast" : r.sx < .6 || r.sz < .6 ? "parapet" : "roof";
      this.box(r.x - r.sx / 2, r.y, r.z - r.sz / 2, r.x + r.sx / 2, r.y + r.sy, r.z + r.sz / 2, kind);
    }
    for (const r of M.rounds) this.cyl(r.x, r.z, r.r, r.y0, r.y0 + r.h, "round");
    for (const t of M.tanks) this.cyl(t.x, t.z, t.r, t.y, t.y + t.h, t.stack ? "stack" : "tank");
    for (const w of M.waterTowers) this.cyl(w.x, w.z, w.r, w.y + 3.2, w.y + 3.2 + w.h + 1.6, "watertank");
    for (const p of M.pillars) this.cyl(p.x, p.z, p.r, -1, p.y1, "pier");
    for (const c of M.caps) this.obb(c.x, c.z, c.sx / 2, c.sz / 2, c.rotY, c.y - c.sy, c.y, "cap");
    for (const p of M.prisms) this.prism(p.x, p.z, p.rotY ? p.sz : p.sx, p.rotY ? p.sx : p.sz, p.y, p.y + p.sy, !p.rotY, "houseroof");
    for (const p of M.parts) if (p.y1 - p.y0 > .2) this.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, p.mat === "canopy" || p.mat === "band" ? "canopy" : "prop");
    for (const p of M.parked) this.box(p.x - .95, 0, p.z - 2.35, p.x + .95, 1.45, p.z + 2.35, "car");
    for (const sh of M.furniture.shelters) this.box(sh.x - 2.2, CURB, sh.z - 2.2, sh.x + 2.2, CURB + 2.6, sh.z + 2.2, "shelter", { web: true, solid: false });
    for (const b of M.furniture.benches) this.box(b.x - .9, CURB, b.z - .9, b.x + .9, CURB + .8, b.z + .9, "bench", { solid: false, web: false });
    // the ring deck: runs of the centre line merged where it runs straight, each a turned slab
    const C = M.ring;
    let i0 = 0;
    for (let i = 1; i < C.length; i++) {
      const a = C[i0], b = C[i], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const nxt = C[i + 1];
      const straight = nxt && Math.abs((nxt.x - b.x) * dz - (nxt.z - b.z) * dx) < 1e-3 * L * Math.hypot(nxt.x - b.x, nxt.z - b.z) && L < 120;
      if (straight) continue;
      if (L > .1) this.obb((a.x + b.x) / 2, (a.z + b.z) / 2, L / 2 + .6, DECK_HW, Math.atan2(-dz, dx), DECK_Y - DECK_T, DECK_Y, "deck");
      i0 = i;
    }
    // lamps, signal poles and masts: the tops to perch on, the heads to web
    for (const L of M.lamps) {
      const base = L.base || 0;
      this.perch(L.x, L.y + .15, L.z, L.ax, L.az, "lamp");
      this.sphere(L.x + L.ax * 1.2, L.y - .1, L.z + L.az * 1.2, .9, "lamphead");
      L.hbase = base;
    }
    for (const p of M.props) {
      if (p.y === 0 && p.sy > 3) this.perch(p.x, p.sy + .1, p.z, 0, 0, "pole");
      else if (p.y > 3) this.box(p.x - p.sx / 2, p.y - .15, p.z - p.sz / 2, p.x + p.sx / 2, p.y + .15, p.z + p.sz / 2, "mastarm", { solid: false });
    }
    // trees: webs stick in the crowns (the parks would be dead ground otherwise)
    for (const t of M.trees) {
      const y = groundAt(M, t.x, t.z), th = 2.2 + t.s * 1.4;
      this.sphere(t.x, y + th + 1.3 * t.s, t.z, 2.3 * t.s, "tree");
      this.perch(t.x, y + th + 4 * t.s - .3, t.z, 0, 0, "tree");
    }
    // the low wall round the old edge of the map (the drawn one is 5.5 m; the 60 m one is only for cars)
    const W = EDGE - 3;
    for (const [x0, z0, x1, z1] of [[-W, -W - .2, W, -W + .2], [-W, W - .2, W, W + .2], [-W - .2, -W, -W + .2, W], [W - .2, -W, W + .2, W]]) this.box(x0, -1, z0, x1, M.hx ? 1.1 : 5.5, z1, "edgewall");
    if (M.hx) this.buildExtras(M.hx);
    if (M.lake) this.water.push({ kind: "ellipse", x: LAKE.x, z: LAKE.z, rx: LAKE.rx, rz: LAKE.rz, y: CURB + .12 });
    // perches on every building: the four roof corners, and points along the long edges
    for (const s of this.solids) {
      if (s.kind !== "bldg" || s.x1 - s.x0 < 3 || s.z1 - s.z0 < 3) continue;
      const corner = (x, z, nx, nz) => { const y = this.topAt(x - nx * .25, z - nz * .25, s.y1 + 3); if (y > s.y1 - .5) this.perch(x - nx * .25, y, z - nz * .25, nx, nz, "corner"); };
      corner(s.x0, s.z0, -.707, -.707); corner(s.x1, s.z0, .707, -.707); corner(s.x0, s.z1, -.707, .707); corner(s.x1, s.z1, .707, .707);
      const edge = (ax, az, bx, bz, nx, nz) => {
        const L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / 18);
        for (let k = 1; k < n; k++) { const t = k / n, x = ax + (bx - ax) * t - nx * .25, z = az + (bz - az) * t - nz * .25, y = this.topAt(x, z, s.y1 + 3); if (y > s.y1 - .5) this.perch(x, y, z, nx, nz, "ledge"); }
      };
      edge(s.x0, s.z0, s.x1, s.z0, 0, -1); edge(s.x0, s.z1, s.x1, s.z1, 0, 1); edge(s.x0, s.z0, s.x0, s.z1, -1, 0); edge(s.x1, s.z0, s.x1, s.z1, 1, 0);
    }
    for (const w of M.waterTowers) this.perch(w.x, w.y + 3.2 + w.h + 1.7, w.z, 0, 0, "watertank");
    for (const r of M.rounds) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; this.perch(r.x + Math.cos(a) * (r.r - .4), r.y0 + r.h, r.z + Math.sin(a) * (r.r - .4), Math.cos(a), Math.sin(a), "corner"); }
  }

  // New Meridian's own structures (hero-extras-map.js)
  buildExtras(hx) {
    const web = { solid: false };
    for (const w of hx.water) this.water.push({ kind: "rect", ...w, y: RIVER.y });
    this.bound = RIVER.outer + 140;
    // quay walls on both banks
    const E = RIVER.inner, O = RIVER.outer;
    for (const [x0, z0, x1, z1] of [[-E, -E - 1, E, -E], [-E, E, E, E + 1], [-E - 1, -E, -E, E], [E, -E, E + 1, E]]) this.box(x0, -7, z0, x1, .15, z1, "quay");
    for (const [x0, z0, x1, z1] of [[-O, -O, O, -O + 1], [-O, O - 1, O, O], [-O, -O, -O + 1, O], [O - 1, -O, O, O]]) this.box(x0, -7, z0, x1, .15, z1, "quay");
    // ---- subway ----
    const T = TUNNEL;
    for (const P of hx.pits) {
      this.box(P.x0 - .5, T.floor - .8, P.z0 - .5, P.x1 + .5, .15, P.z0, "pitwall");
      this.box(P.x0 - .5, T.floor - .8, P.z1, P.x1 + .5, .15, P.z1 + .5, "pitwall");
      for (const [xa, xb] of [[P.x0 - .5, P.x0], [P.x1, P.x1 + .5]]) { this.box(xa, T.floor - .8, P.z0, xb, .15, T.z0, "pitwall"); this.box(xa, T.floor - .8, T.z1, xb, .15, P.z1, "pitwall"); this.box(xa, T.ceil, T.z0, xb, .15, T.z1, "pitwall"); }
      this.box(P.x0, T.floor - .6, T.z0, P.x1, T.floor, T.z1, "trackbed");
    }
    for (const p of hx.platforms) this.box(p.x0, T.floor - .6, p.z0, p.x1, p.y, p.z1, "platform");
    this.box(T.x0, T.floor - .6, T.z0, T.x1, T.floor, T.z1, "trackbed");
    this.box(T.x0, T.floor - .6, T.z0 - .6, T.x1, -.25, T.z0, "tunnelwall");
    this.box(T.x0, T.floor - .6, T.z1, T.x1, -.25, T.z1 + .6, "tunnelwall");
    this.box(T.x0, T.ceil, T.z0, T.x1, -.25, T.z1, "tunnelroof");
    for (const c of hx.canopies) { this.box(c.x0, c.y, c.z0, c.x1, c.y + .25, c.z1, "canopy"); for (const [x, z] of [[c.x0 + .5, c.z0 + .5], [c.x1 - .5, c.z0 + .5], [c.x0 + .5, c.z1 - .5], [c.x1 - .5, c.z1 - .5]]) this.cyl(x, z, .12, 0, c.y, "post", web); }
    // ---- construction sites ----
    for (const f of hx.fences) { const t = .08; this.box(Math.min(f.ax, f.bx) - t, 0, Math.min(f.az, f.bz) - t, Math.max(f.ax, f.bx) + t, f.h, Math.max(f.az, f.bz) + t, "fence"); }
    for (const f of hx.frames) {
      for (let y = f.y0 + f.fh; y <= f.y1 + .01; y += f.fh) this.box(f.x0, y - .32, f.z0, f.x1, y, f.z1, "slab");
      for (const c of f.cols) this.box(c.x - .32, f.y0 - .5, c.z - .32, c.x + .32, f.y1, c.z + .32, "column");
      for (const [x, z, nx, nz] of [[f.x0, f.z0, -.7, -.7], [f.x1, f.z0, .7, -.7], [f.x0, f.z1, -.7, .7], [f.x1, f.z1, .7, .7]]) this.perch(x - nx * .4, f.y1, z - nz * .4, nx, nz, "corner");
    }
    for (const c of hx.cranes) {
      const ux = Math.cos(c.ang), uz = Math.sin(c.ang);
      this.box(c.x - 1, 0, c.z - 1, c.x + 1, c.h, c.z + 1, "crane");
      this.obb(c.x + ux * (c.jib / 2), c.z + uz * (c.jib / 2), c.jib / 2 + 1, .9, -c.ang, c.h, c.h + 1.8, "crane");
      this.obb(c.x - ux * (c.counter / 2), c.z - uz * (c.counter / 2), c.counter / 2 + 1, 1.1, -c.ang, c.h, c.h + 1.6, "crane");
      const cwx = c.x - ux * (c.counter - 3), cwz = c.z - uz * (c.counter - 3);
      this.box(cwx - 2, c.h - 3.2, cwz - 2, cwx + 2, c.h, cwz + 2, "crane");
      this.box(c.x - .4, c.h + 1.8, c.z - .4, c.x + .4, c.h + 11, c.z + .4, "crane", web);
      const hxp = c.x + ux * (c.jib * .7), hzp = c.z + uz * (c.jib * .7);
      this.box(hxp - .1, c.h - c.hook, hzp - .1, hxp + .1, c.h, hzp + .1, "cable", web);
      this.box(hxp - 3, c.h - c.hook - 1, hzp - .4, hxp + 3, c.h - c.hook, hzp + .4, "load");
      this.perch(c.x + ux * (c.jib + .5), c.h + 1.8, c.z + uz * (c.jib + .5), ux, uz, "crane");
      this.perch(c.x, c.h + 11.2, c.z, 0, 0, "crane");
      this.perch(cwx, c.h + .1, cwz, -ux, -uz, "crane");
    }
    for (const s of hx.stacks) { const [hw, hd] = s.rot ? [s.d / 2, s.w / 2] : [s.w / 2, s.d / 2]; this.box(s.x - hw, .15, s.z - hd, s.x + hw, .15 + s.h, s.z + hd, "stack"); }
    // ---- the port ----
    for (const p of hx.piers) this.box(p.x0, -6, p.z0, p.x1, p.y, p.z1, "pier");
    for (const c of hx.containers) this.box(c.x - c.sx / 2, c.y, c.z - c.sz / 2, c.x + c.sx / 2, c.y + c.sy, c.z + c.sz / 2, "container");
    for (const g of hx.gantries) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(g.x + sx * g.span / 2 - .9, 1.2, g.z + sz * 7 - .9, g.x + sx * g.span / 2 + .9, g.h, g.z + sz * 7 + .9, "gantry");
      for (const sz of [-1, 1]) this.box(g.x - g.span / 2 - .9, g.h - 3, g.z + sz * 7 - .9, g.x + g.span / 2 + .9, g.h, g.z + sz * 7 + .9, "gantry");
      this.box(g.x - 1.6, g.h - 5, g.z - g.boom, g.x + 1.6, g.h - 3, g.z + g.back, "gantry");
      this.perch(g.x, g.h - 3 + .1, g.z - g.boom + 1, 0, -1, "crane");
    }
    for (const s of hx.ships) {
      this.box(s.x - s.w / 2, s.y0, s.z - s.L / 2, s.x + s.w / 2, s.y1, s.z + s.L / 2, "ship");
      const b = s.bridge;
      this.box(s.x - s.w / 2 + 2, s.y1, b.z1 - b.L, s.x + s.w / 2 - 2, s.y1 + b.h, b.z1, "ship");
      this.perch(s.x, s.y1 + b.h, b.z1 - b.L / 2, 0, 0, "ship");
    }
    // ---- bridges ----
    for (const b of hx.bridges) {
      const along = (u0, u1, w0, w1, y0, y1, kind, o) => {
        const ax = b.ox + b.dx * u0 - b.dz * w0, az = b.oz + b.dz * u0 + b.dx * w0, bx = b.ox + b.dx * u1 - b.dz * w1, bz = b.oz + b.dz * u1 + b.dx * w1;
        return this.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), kind, o);
      };
      // the deck slab, in steps that stay just under the drivable ribbon
      for (let u = b.u0; u < b.u1; u += 8) {
        const y = Math.min(deckY(u), deckY(u + 8));
        if (y < .5) continue;
        along(u, u + 8, -b.hw, b.hw, y - 2.2, y - .25, "bridgedeck");
      }
      for (const t of b.towers) {
        if (t.a) {
          // the A-pylon: legs leaning in, in steps
          for (let k = 0; k < 12; k++) { const y0 = -6 + k * (t.top + 6) / 12, y1 = y0 + (t.top + 6) / 12, w = 12 * (1 - (k + .5) / 12); for (const s of [-1, 1]) along(t.u - 2, t.u + 2, s * w - 2, s * w + 2, y0, y1, "tower"); }
          this.perch(b.ox + b.dx * t.u, t.top + .2, b.oz + b.dz * t.u, 0, 0, "tower");
        } else {
          for (const s of [-1, 1]) { along(t.u - 1.7, t.u + 1.7, s * 11.5 - 1.7, s * 11.5 + 1.7, -6, t.top, "tower"); const px = b.ox + b.dx * t.u - b.dz * s * 11.5, pz = b.oz + b.dz * t.u + b.dx * s * 11.5; this.perch(px, t.top + .1, pz, 0, 0, "tower"); }
          for (const y of [DECK_UNDER, 72, t.top - 4]) along(t.u - 1.5, t.u + 1.5, -11.5, 11.5, y, y + 3, "tower");
        }
      }
      for (const c of b.cables) for (let i = 0; i < c.length; i += 2) this.sphere(c[i].x, c[i].y, c[i].z, 1.3, "cable");
      for (const h of b.hangers) this.box(h.a.x - .15, h.b.y, h.a.z - .15, h.a.x + .15, h.a.y, h.a.z + .15, "hanger", web);
      for (const s of b.stays) for (const k of [.25, .5, .75]) this.sphere(s.a.x + (s.b.x - s.a.x) * k, s.a.y + (s.b.y - s.a.y) * k, s.a.z + (s.b.z - s.a.z) * k, 1.2, "cable");
    }
    // ---- billboards, screens, fire escapes ----
    const panel = (o, d, kind) => { const ex = o.fx ? d : o.w / 2, ez = o.fx ? o.w / 2 : d; return this.box(o.x - ex, o.y - o.h / 2, o.z - ez, o.x + ex, o.y + o.h / 2, o.z + ez, kind); };
    for (const b of hx.boards) {
      panel(b, .25, "billboard");
      this.perch(b.x, b.y + b.h / 2 + .1, b.z, b.fx, b.fz, "board");
      if (b.legs !== undefined) for (const s of [-.4, .4]) this.cyl(b.x - b.fz * b.w * s, b.z + b.fx * b.w * s, .2, b.legs, b.y - b.h / 2, "post");
    }
    for (const s of hx.screens) panel(s, .3, "screen");
    for (const e of hx.escapes) {
      const ex = e.nx ? e.d / 2 : e.w / 2, ez = e.nx ? e.w / 2 : e.d / 2;
      for (let y = e.y0; y <= e.y1; y += 3.4) this.box(e.x - ex, y - .12, e.z - ez, e.x + ex, y, e.z + ez, "escape");
    }
  }

  // ------------------------------------------------------------------ queries
  cellList(x0, z0, x1, z1, out) {
    out.length = 0;
    const q = ++this.stamp;
    const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL), j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.grid.get(key(i, j));
      if (a) for (let n = 0; n < a.length; n++) { const s = a[n]; if (s.q !== q) { s.q = q; out.push(s); } }
    }
    return out;
  }
  // height of the top surface of solid s at (x, z), or -Infinity if (x, z) is not over it
  topOf(s, x, z) {
    switch (s.t) {
      case BOX: return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 ? s.y1 : -Infinity;
      case CYL: return (x - s.cx) ** 2 + (z - s.cz) ** 2 <= s.r * s.r ? s.y1 : -Infinity;
      case OBB: { const dx = x - s.cx, dz = z - s.cz, lx = dx * s.c - dz * s.s, lz = dx * s.s + dz * s.c; return Math.abs(lx) <= s.hx && Math.abs(lz) <= s.hz ? s.y1 : -Infinity; }
      case PRISM: {
        if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return -Infinity;
        const u = s.alongX ? Math.abs(z - s.cz) : Math.abs(x - s.cx);
        return s.y0 + (s.y1 - s.y0) * Math.max(0, 1 - u / s.half);
      }
      default: return -Infinity;
    }
  }
  // the highest solid top at (x, z) that is below yRef (roofs, decks, the ground, curbs, ramps)
  // the subway's pits and tunnel: below them there is no street level to stand on
  underAt(x, z) {
    const U = this.M.hx?.under;
    if (U) for (const u of U) if (x > u.x0 && x < u.x1 && z > u.z0 && z < u.z1) return u;
    return null;
  }
  topAt(x, z, yRef) {
    const u = this.M.hx ? this.underAt(x, z) : null;
    // over water there is no street: only bridges (and whatever stands in it); the bed is deep
    const wy = this.water.length ? this.waterAt(x, z) : -Infinity;
    let best = wy > -Infinity ? Math.max(wy - 3, surfaceAt(this.M, x, z, yRef)) : u && (u.open || yRef < -.3) ? surfaceAt(this.M, x, z, yRef) : heightAt(this.M, x, z, yRef);
    this.topSolid = null;
    for (const s of this.cellList(x, z, x, z, this.hits)) {
      if (!s.solid || s.y1 > yRef + 1e-3 || s.y1 <= best) continue;
      const y = this.topOf(s, x, z);
      if (y <= yRef + 1e-3 && y > best) { best = y; this.topSolid = s; }
    }
    for (const s of this.dyn) {
      if (s.y1 > yRef + 1e-3 || s.y1 <= best || x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const y = this.topOf(s, x, z);
      if (y <= yRef + 1e-3 && y > best) { best = y; this.topSolid = s; }
    }
    return best;
  }
  // the ground under a body of radius r at (x, y, z): the highest top within stepping reach below y,
  // checked at the centre and at a ring of points so the hero can stand on a ledge right to its lip
  groundUnder(x, y, z, r = .3, step = .55) {
    let best = this.topAt(x, z, y + step), solid = this.topSolid;
    if (r > 0) for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + .785, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const h = this.topAt(px, pz, y + step);
      if (h > best) { best = h; solid = this.topSolid; }
    }
    this.underFoot = solid;
    return best;
  }
  waterAt(x, z) {
    for (const w of this.water) {
      if (w.kind === "ellipse" ? ((x - w.x) / w.rx) ** 2 + ((z - w.z) / w.rz) ** 2 < 1 : x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1) {
        if (w.hole && w.hole(x, z)) continue;
        return w.y;
      }
    }
    return -Infinity;
  }

  // Ray against the city. Returns { t, x, y, z, nx, ny, nz, s } or null (s is null for the ground).
  // opts.web: only what a web can stick to; opts.solid: only what blocks movement.
  raycast(ox, oy, oz, dx, dy, dz, maxT, opts = 0, out = {}) {
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    let best = maxT, hit = null;
    // the ground (and anything standing on it is in the grid)
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t > 0 && t < best && !(this.M.hx && this.underAt(ox + dx * t, oz + dz * t)?.open)) { best = t; hit = GROUND; }
    }
    const q = ++this.stamp;
    // walk the cells the ray's shadow crosses, nearest first
    let i = Math.floor(ox / CELL), j = Math.floor(oz / CELL);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
    let tx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (i + 1) * CELL - ox : ox - i * CELL) / Math.abs(dx)) : Infinity;
    let tz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (j + 1) * CELL - oz : oz - j * CELL) / Math.abs(dz)) : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      const a = this.grid.get(key(i, j));
      if (a) for (let n = 0; n < a.length; n++) {
        const s = a[n];
        if (s.q === q) continue;
        s.q = q;
        if (opts === 1 && !s.web) continue;
        if (opts === 2 && !s.solid) continue;
        const t = rayHit(s, ox, oy, oz, dx, dy, dz, best, _n);
        if (t < best) { best = t; hit = s; out.nx = _n.x; out.ny = _n.y; out.nz = _n.z; }
      }
      const tNext = Math.min(tx, tz);
      if (best <= tNext || tNext > maxT) break;
      if (tx < tz) { tx += tdx; i += si; } else { tz += tdz; j += sj; }
    }
    for (const s of this.dyn) {
      if (opts === 1 && !s.web) continue;
      const t = rayHit(s, ox, oy, oz, dx, dy, dz, best, _n);
      if (t < best) { best = t; hit = s; out.nx = _n.x; out.ny = _n.y; out.nz = _n.z; }
    }
    if (!hit) return null;
    out.t = best; out.x = ox + dx * best; out.y = oy + dy * best; out.z = oz + dz * best;
    if (hit === GROUND) { out.nx = 0; out.ny = 1; out.nz = 0; out.s = null; out.kind = "ground"; }
    else { out.s = hit; out.kind = hit.kind; }
    return out;
  }
  // is the straight line a -> b clear of anything solid (for webs: of anything a web would catch on)?
  clear(ax, ay, az, bx, by, bz, opts = 2, slack = .3) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return true;
    return !this.raycast(ax, ay, az, dx, dy, dz, L - slack, opts, _r2);
  }

  // Push a sphere out of every solid it overlaps. Fills res.contacts with { nx, ny, nz, d, s } (deepest
  // first) and returns the number of contacts; the position in p is corrected in place.
  collide(p, r, res, iters = 3) {
    const C = res.contacts || (res.contacts = []);
    C.length = 0;
    for (let it = 0; it < iters; it++) {
      let deepest = null, dd = 0, nx = 0, ny = 0, nz = 0;
      for (const s of this.cellList(p.x - r, p.z - r, p.x + r, p.z + r, this.hits)) {
        if (!s.solid || p.y + r < s.y0 || p.y - r > s.y1) continue;
        const d = sphereHit(this, s, p.x, p.y, p.z, r, _n);
        if (d > dd) { dd = d; deepest = s; nx = _n.x; ny = _n.y; nz = _n.z; }
      }
      for (const s of this.dyn) {
        if (p.y + r < s.y0 || p.y - r > s.y1 || p.x + r < s.x0 || p.x - r > s.x1 || p.z + r < s.z0 || p.z - r > s.z1) continue;
        const d = sphereHit(this, s, p.x, p.y, p.z, r, _n);
        if (d > dd) { dd = d; deepest = s; nx = _n.x; ny = _n.y; nz = _n.z; }
      }
      if (!deepest) break;
      p.x += nx * dd; p.y += ny * dd; p.z += nz * dd;
      let merged = false;
      for (const c of C) if (c.s === deepest) { c.nx = nx; c.ny = ny; c.nz = nz; c.d += dd; merged = true; }
      if (!merged && C.length < 6) C.push({ nx, ny, nz, d: dd, s: deepest });
    }
    return C.length;
  }

  // The best perch near an aim ray: angle off the ray (radians) weighs most, then distance.
  // from = where the hero is; it must have a clear line to the point.
  perchNear(ox, oy, oz, dx, dy, dz, maxD, cone, from, skip) {
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    let best = null, bs = Infinity;
    const cosC = Math.cos(cone), seen = new Set();
    for (let d = 0; d <= maxD; d += CELL * .75) {
      const cx = ox + dx * d, cz = oz + dz * d, rr = 4 + d * Math.tan(cone);
      const i0 = Math.floor((cx - rr) / CELL), i1 = Math.floor((cx + rr) / CELL), j0 = Math.floor((cz - rr) / CELL), j1 = Math.floor((cz + rr) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        if (seen.has(k)) continue;
        seen.add(k);
        const a = this.pgrid.get(k);
        if (!a) continue;
        for (const p of a) {
          if (p === skip) continue;
          const vx = p.x - ox, vy = p.y - oy, vz = p.z - oz, vd = Math.hypot(vx, vy, vz);
          if (vd < 3 || vd > maxD) continue;
          const c = (vx * dx + vy * dy + vz * dz) / vd;
          if (c < cosC) continue;
          const hd = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
          if (hd < 4 || hd > maxD) continue;
          const score = Math.acos(Math.min(1, c)) * 60 + vd * .05 - (p.kind === "corner" ? 1.5 : 0) + (p.kind === "tree" ? 3 : 0);
          if (score >= bs) continue;
          if (!this.clear(from.x, from.y + .8, from.z, p.x, p.y + .4, p.z, 2, .6)) continue;
          bs = score; best = p;
        }
      }
    }
    return best;
  }
}

const GROUND = { kind: "ground" };
const DECK_UNDER = 13;
const _n = { x: 0, y: 0, z: 0 }, _r2 = {};

// ray (unit direction) vs one solid; returns t of entry (or Infinity) and the surface normal in n
function rayHit(s, ox, oy, oz, dx, dy, dz, maxT, n) {
  switch (s.t) {
    case BOX: return rayBox(ox, oy, oz, dx, dy, dz, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, maxT, n);
    case PRISM: {
      // the box up to the eaves, then the two roof planes
      let t = rayBox(ox, oy, oz, dx, dy, dz, s.x0, s.y0 - 6, s.z0, s.x1, s.y0, s.z1, maxT, n);
      const tb = rayBox(ox, oy, oz, dx, dy, dz, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, Math.min(t, maxT), _nb);
      if (tb < t) {
        // march the roof box for the first point under the roof line
        for (let k = 0, tt = tb; k < 24 && tt < t; k++, tt += .25) {
          const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
          const u = s.alongX ? z - s.cz : x - s.cx, roof = s.y0 + (s.y1 - s.y0) * Math.max(0, 1 - Math.abs(u) / s.half);
          if (y <= roof + 1e-3) {
            const sl = (s.y1 - s.y0) / s.half, sg = Math.sign(u) || 1, len = Math.hypot(sl, 1);
            if (s.alongX) { n.x = 0; n.y = 1 / len; n.z = sg * sl / len; } else { n.x = sg * sl / len; n.y = 1 / len; n.z = 0; }
            if (k === 0) { n.x = _nb.x; n.y = _nb.y; n.z = _nb.z; }
            return tt;
          }
        }
      }
      return t;
    }
    case CYL: {
      const fx = ox - s.cx, fz = oz - s.cz, a = dx * dx + dz * dz;
      let best = Infinity;
      if (a > 1e-9) {
        const b = fx * dx + fz * dz, c = fx * fx + fz * fz - s.r * s.r, disc = b * b - a * c;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / a;
          if (t >= 0 && t < maxT) { const y = oy + dy * t; if (y >= s.y0 && y <= s.y1) { best = t; n.x = (fx + dx * t) / s.r; n.y = 0; n.z = (fz + dz * t) / s.r; } }
        }
      }
      // caps
      if (Math.abs(dy) > 1e-9) for (const [yc, ny] of [[s.y1, 1], [s.y0, -1]]) {
        const t = (yc - oy) / dy;
        if (t >= 0 && t < best && t < maxT && (dy < 0) === (ny > 0)) {
          const x = fx + dx * t, z = fz + dz * t;
          if (x * x + z * z <= s.r * s.r) { best = t; n.x = 0; n.y = ny; n.z = 0; }
        }
      }
      return best;
    }
    case OBB: {
      const rx = ox - s.cx, rz = oz - s.cz;
      const lox = rx * s.c - rz * s.s, loz = rx * s.s + rz * s.c, ldx = dx * s.c - dz * s.s, ldz = dx * s.s + dz * s.c;
      const t = rayBox(lox, oy, loz, ldx, dy, ldz, -s.hx, s.y0, -s.hz, s.hx, s.y1, s.hz, maxT, n);
      if (t < Infinity) { const nx = n.x, nz = n.z; n.x = nx * s.c + nz * s.s; n.z = -nx * s.s + nz * s.c; }
      return t;
    }
    case SPHERE: {
      const fx = ox - s.cx, fy = oy - s.cy, fz = oz - s.cz, b = fx * dx + fy * dy + fz * dz, c = fx * fx + fy * fy + fz * fz - s.r * s.r, disc = b * b - c;
      if (disc < 0) return Infinity;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t >= maxT) return Infinity;
      n.x = (fx + dx * t) / s.r; n.y = (fy + dy * t) / s.r; n.z = (fz + dz * t) / s.r;
      return t;
    }
  }
  return Infinity;
}
const _nb = { x: 0, y: 0, z: 0 };
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT, n) {
  let tmin = 0, tmax = maxT, ax = -1;
  for (let k = 0; k < 3; k++) {
    const o = k === 0 ? ox : k === 1 ? oy : oz, d = k === 0 ? dx : k === 1 ? dy : dz, lo = k === 0 ? x0 : k === 1 ? y0 : z0, hi = k === 0 ? x1 : k === 1 ? y1 : z1;
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return Infinity; continue; }
    let t0 = (lo - o) / d, t1 = (hi - o) / d;
    if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
    if (t0 > tmin) { tmin = t0; ax = k; }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  if (ax < 0) return Infinity;   // starts inside
  n.x = n.y = n.z = 0;
  if (ax === 0) n.x = dx > 0 ? -1 : 1; else if (ax === 1) n.y = dy > 0 ? -1 : 1; else n.z = dz > 0 ? -1 : 1;
  return tmin;
}

// sphere (centre x, y, z, radius r) vs one solid: penetration depth (0 if apart), push-out normal in n
function sphereHit(W, s, x, y, z, r, n) {
  switch (s.t) {
    case BOX: return sphereBox(x, y, z, r, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, n);
    case PRISM: {
      const top = W.topOf(s, x, z);
      return sphereBox(x, y, z, r, s.x0, s.y0 - 6, s.z0, s.x1, top > -Infinity ? top : s.y0, s.z1, n);
    }
    case CYL: {
      const dx = x - s.cx, dz = z - s.cz, d = Math.hypot(dx, dz);
      const below = y < s.y0, above = y > s.y1;
      if (!below && !above) {
        if (d >= s.r + r) return 0;
        const side = s.r + r - d, up = s.y1 + r - y, down = y - (s.y0 - r);
        if (up < side && up < down) { n.x = 0; n.y = 1; n.z = 0; return up; }
        if (down < side) { n.x = 0; n.y = -1; n.z = 0; return down; }
        if (d < 1e-6) { n.x = 1; n.y = 0; n.z = 0; return side; }
        n.x = dx / d; n.y = 0; n.z = dz / d; return side;
      }
      // above or below: against the cap disc or its rim
      const yc = above ? s.y1 : s.y0, k = d > s.r ? s.r / d : 1;
      const qx = s.cx + dx * k, qz = s.cz + dz * k, ex = x - qx, ey = y - yc, ez = z - qz, e = Math.hypot(ex, ey, ez);
      if (e >= r || e < 1e-9) return 0;
      n.x = ex / e; n.y = ey / e; n.z = ez / e; return r - e;
    }
    case OBB: {
      const rx = x - s.cx, rz = z - s.cz, lx = rx * s.c - rz * s.s, lz = rx * s.s + rz * s.c;
      const d = sphereBox(lx, y, lz, r, -s.hx, s.y0, -s.hz, s.hx, s.y1, s.hz, n);
      if (d > 0) { const nx = n.x, nz = n.z; n.x = nx * s.c + nz * s.s; n.z = -nx * s.s + nz * s.c; }
      return d;
    }
  }
  return 0;
}
function sphereBox(x, y, z, r, x0, y0, z0, x1, y1, z1, n) {
  const qx = x < x0 ? x0 : x > x1 ? x1 : x, qy = y < y0 ? y0 : y > y1 ? y1 : y, qz = z < z0 ? z0 : z > z1 ? z1 : z;
  const ex = x - qx, ey = y - qy, ez = z - qz, d2 = ex * ex + ey * ey + ez * ez;
  if (d2 > 1e-12) {
    if (d2 >= r * r) return 0;
    const d = Math.sqrt(d2);
    n.x = ex / d; n.y = ey / d; n.z = ez / d;
    return r - d;
  }
  // centre inside: out through the nearest face
  let best = x - x0, bx = -1, by = 0, bz = 0;
  if (x1 - x < best) { best = x1 - x; bx = 1; by = 0; bz = 0; }
  if (y - y0 < best) { best = y - y0; bx = 0; by = -1; bz = 0; }
  if (y1 - y < best) { best = y1 - y; bx = 0; by = 1; bz = 0; }
  if (z - z0 < best) { best = z - z0; bx = 0; by = 0; bz = -1; }
  if (z1 - z < best) { best = z1 - z; bx = 0; by = 0; bz = 1; }
  n.x = bx; n.y = by; n.z = bz;
  return best + r;
}
