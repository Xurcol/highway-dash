// New Meridian, the hero city: what it has on top of the City Drive map. Pure data (no three.js),
// added through the hooks buildCity() offers ({ extras }): blocks it builds itself (two subway
// stations, construction sites), and a pass at the end for everything round them - the river round
// the island with a quay, a container port with gantry cranes and a moored ship, three bridges (two
// suspension, one cable-stayed), billboards, the lit screens of Meridian Square, fire escapes on the
// old brick blocks, and the subway tunnel between the stations. hero-extras.js draws it; hero-world.js
// turns it into solids.
export const RIVER = { inner: 1180, outer: 1480, y: -1.6 };
export const DECK = 18;          // bridge deck height
const STATION_BLOCKS = [[-4, 0, "WEST"], [3, 0, "EAST"]];
const SITE_BLOCKS = [[1, -3], [-3, -2], [2, 2], [-2, 3], [4, -2], [-5, 2], [0, 4]];
export const TUNNEL = { z0: 44, z1: 56, x0: -322, x1: 322, floor: -8, ceil: -2.5 };
export const ADS = [
  { t: "NOVA COLA", s: "taste the static", bg: "#d12a2f", fg: "#ffffff" },
  { t: "ZENITH 9", s: "the phone that thinks ahead", bg: "#101418", fg: "#7fe9ff" },
  { t: "AEROSTEP", s: "run the sky", bg: "#f2c230", fg: "#111111" },
  { t: "BYTE NEWS 24", s: "the city, live", bg: "#1f5fbf", fg: "#ffffff" },
  { t: "PULSE", s: "energy for the night shift", bg: "#141414", fg: "#3dff8a" },
  { t: "HALO AIR", s: "fly further for less", bg: "#e8e6e0", fg: "#1d3d6b" },
  { t: "MERIDIAN BANK", s: "built on bedrock", bg: "#0e2a24", fg: "#e8d9a8" },
  { t: "WAVE FM 101.5", s: "the sound of the city", bg: "#ff5a3c", fg: "#ffffff" },
  { t: "HERO OR MENACE?", s: "THE DAILY MERIDIAN investigates ARCLINE", bg: "#f4f1e8", fg: "#141414" },
  { t: "VORTEX GAMES", s: "play it loud", bg: "#5b2ecf", fg: "#ffffff" },
  { t: "LUMA", s: "glow different", bg: "#ff8ac8", fg: "#2a0f22" },
  { t: "STRATUS", s: "your data, above it all", bg: "#2b3440", fg: "#ffffff" },
  { t: "KAITO RAMEN", s: "open till 4am · 9th Ave", bg: "#1a1a1a", fg: "#ffb12a" },
  { t: "IRONLINE GYM", s: "train like a hero", bg: "#b81c1c", fg: "#f4f4f0" },
];

const hashOf = (H) => H.hash;
// a downtown block this module builds itself; returns true if it did
function block(M, i, j, x0, z0, x1, z1, H) {
  if (i === 1 && j === 1) { timesSquare(M, x0, z0, x1, z1, H); return true; }
  const st = STATION_BLOCKS.find(([a, b]) => a === i && b === j);
  if (st) { station(M, x0, z0, x1, z1, st[2], H); return true; }
  if (SITE_BLOCKS.some(([a, b]) => a === i && b === j)) { site(M, i, j, x0, z0, x1, z1, H); return true; }
  return false;
}

// A walkable theater plaza off the junction; surrounding traffic lanes remain open.
function timesSquare(M, x0, z0, x1, z1, H) {
  const hx = M.hx, cx = (x0 + x1) / 2;
  H.slab(x0, z0, x1, z1, "walk");
  // The narrow screen tower and theater also provide solid swing anchors.
  H.addBuilding(M, x1 - 23, z1 - 27, x1 - 4, z1 - 4, .15, 115, 1, 0x35475c);
  H.addBuilding(M, x1 - 22, z0 + 5, x1 - 4, z0 + 32, .15, 26, 3, 0x6c4545);
  for (let i = 0; i < 8; i++) {
    const z = z1 - 29 + i * 1.5, h = .15 + (i + 1) * .3;
    H.addBuilding(M, x0 + 9, z, x0 + 29, z + 1.5, .15, h, 4, 0xb82239);
    M.roofs.push({x:x0 + 19,y:h,z:z + .75,sx:20,sy:.08,sz:1.5,col:0xdf2946});
  }
  for (let i = 0; i < 4; i++) {
    M.furniture.benches.push({x:x0 + 5,z:z0 + 12 + i * 11,fx:1,fz:0});
    M.trees.push({x:cx + 5,z:z0 + 10 + i * 10,s:.6});
  }
  hx.signs.push({x:x1 - 22.1,y:8,z:z0 + 18,fx:-1,fz:0,w:20,h:3,text:"BROADWAY",sub:"THE NIGHT IS YOURS · LIVE TONIGHT",kind:"theater"});
  hx.signs.push({x:cx,y:5,z:z1 - 28,fx:0,fz:-1,w:17,h:2.4,text:"TIMES SQUARE",sub:"NEW MERIDIAN · DOWNTOWN",kind:"theater"});
  for (let i = 0; i < 4; i++) {
    hx.screens.push({x:x1 - 23.3,y:19 + i * 23,z:z1 - 15.5,fx:-1,fz:0,w:20,h:21,seed:i});
    hx.screens.push({x:x1 - 13.5,y:19 + i * 23,z:z1 - 27.3,fx:0,fz:-1,w:17,h:21,seed:i + 4});
  }
  hx.screens.push({x:x1 - 22.3,y:13,z:z0 + 18,fx:-1,fz:0,w:25,h:2.5,seed:108,ticker:true});
}

// ---------------------------------------------------------------- subway stations
// A sunken plaza in the middle of the block: stairs down one side to the platforms, the tracks in a
// trench along the middle running into the tunnel at both ends, a ticket hall and canopies on top.
function station(M, x0, z0, x1, z1, name, H) {
  const hx = M.hx, cx = (x0 + x1) / 2, P = { x0: cx - 28, x1: cx + 28, z0: 22, z1: 78 };
  const W = 4.5;   // sidewalk
  // the ground round the pit
  H.slab(x0, z0, x1, P.z0, "walk"); H.slab(x0, P.z1, x1, z1, "walk");
  H.slab(x0, P.z0, P.x0, P.z1, "walk"); H.slab(P.x1, P.z0, x1, P.z1, "walk");
  hx.pits.push({ ...P, floor: TUNNEL.floor, name, cx, cz: 50 });
  hx.under.push({ ...P, floor: TUNNEL.floor, open: true });
  // a ticket hall on the plaza and a canopy over each stair head
  H.addBuilding(M, x0 + W, z0 + W, x0 + W + 22, P.z0 - 2, .15, 6.5, 1, 0xd8dee4);
  hx.signs.push({ x: x0 + W + 11, y: 5.2, z: P.z0 - 2 + .1, fx: 0, fz: 1, w: 14, h: 1.6, text: `${name} STATION`, sub: "MERIDIAN TRANSIT", kind: "transit" });
  hx.canopies.push({ x0: P.x1 - 18, z0: P.z0 - .5, x1: P.x1 - 2, z1: P.z0 + 6.5, y: 3.4 });
  // the stairs: a ramp down the north side of the pit, from the plaza to the platform
  const ramp = [{ x: P.x1 - 2, y: .15, z: P.z0 + 3 }, { x: P.x1 - 40, y: TUNNEL.floor + 1, z: P.z0 + 3 }];
  hx.stairs.push({ a: ramp[0], b: ramp[1], hw: 3 });
  H.addSurface(M, interp(ramp[0], ramp[1], 2), 3, "stairs");
  // platforms either side of the trench (1 m above the track bed)
  hx.platforms.push({ x0: P.x0, x1: P.x1, z0: P.z0, z1: TUNNEL.z0, y: TUNNEL.floor + 1 }, { x0: P.x0, x1: P.x1, z0: TUNNEL.z1, z1: P.z1, y: TUNNEL.floor + 1 });
  for (let k = 0; k < 4; k++) M.trees.push({ x: P.x0 - 6 + (k % 2) * 0, z: P.z0 + 8 + k * 13, s: .8 });
  for (let k = 0; k < 3; k++) M.furniture.benches.push({ x: P.x1 + 4, z: P.z0 + 12 + k * 14, fx: -1, fz: 0 });
}
const interp = (a, b, step) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step)), out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }); } return out; };

// ---------------------------------------------------------------- construction sites
// A fenced lot of packed dirt, a tower going up (glass on the lower floors, bare floor slabs and
// columns above), a tower crane beside it, and stacks of material on the ground.
function site(M, i, j, x0, z0, x1, z1, H) {
  const hx = M.hx, r = (n) => H.hash(i + 70, j + 70, n), W = 4.5;
  H.slab(x0, z0, x1, z1, "walk");
  const lx0 = x0 + W, lz0 = z0 + W, lx1 = x1 - W, lz1 = z1 - W;
  hx.dirt.push({ x0: lx0, z0: lz0, x1: lx1, z1: lz1 });
  // the fence, with a gate on one side
  const fence = (ax, az, bx, bz) => hx.fences.push({ ax, az, bx, bz, h: 2.4 });
  fence(lx0, lz0, lx1, lz0); fence(lx0, lz1, lx1, lz1); fence(lx0, lz0, lx0, lz1);
  const gz = (lz0 + lz1) / 2;
  fence(lx1, lz0, lx1, gz - 6); fence(lx1, gz + 6, lx1, lz1);
  // the tower
  const cx = (lx0 + lx1) / 2 - 4, cz = (lz0 + lz1) / 2, hw = 21, hd = 17;
  const floors = 18 + Math.floor(r(1) * 20), fh = 3.8, top = floors * fh;
  const clad = Math.floor(floors * (.3 + r(2) * .35)) * fh;
  H.addBuilding(M, cx - hw, cz - hd, cx + hw, cz + hd, .15, clad, 1, [0x5c6f82, 0x44566a, 0x6d8196][Math.floor(r(3) * 3)], false);
  const frame = { x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd, y0: clad + .15, y1: top + .15, fh, cols: [] };
  for (let gx = 0; gx <= 5; gx++) for (let gz2 = 0; gz2 <= 4; gz2++) frame.cols.push({ x: cx - hw + .4 + gx * (2 * hw - .8) / 5, z: cz - hd + .4 + gz2 * (2 * hd - .8) / 4 });
  hx.frames.push(frame);
  // the crane: mast beside the tower, jib out over it
  const mx = cx + hw + 8, mz = cz + (r(4) - .5) * 16, mh = top + 24;
  const ang = Math.PI + (r(5) - .5) * 1.2;   // pointing back over the tower
  hx.cranes.push({ x: mx, z: mz, h: mh, ang, jib: 58, counter: 18, hook: 18 + r(6) * 30 });
  // material on the ground
  for (let k = 0; k < 5; k++) hx.stacks.push({ x: lx0 + 6 + r(10 + k) * (lx1 - lx0 - 12), z: lz0 + 4 + r(20 + k) * 6, w: 9, d: 1.6, h: .5 + r(30 + k) * 1.1, kind: k % 2 ? "girders" : "pipes", rot: r(40 + k) < .5 ? 0 : Math.PI / 2 });
  hx.stacks.push({ x: lx1 - 8, z: lz1 - 5, w: 6, d: 2.4, h: 2.6, kind: "office", rot: 0 });
  H.addBuilding(M, lx1 - 11, lz1 - 6.2, lx1 - 5, lz1 - 3.8, .15, 2.6, 4, 0xe6c84a, false);
}

// ---------------------------------------------------------------- the pass at the end
function finish(M, H) {
  const hx = M.hx, { hash, roadAt } = H, E = RIVER.inner, O = RIVER.outer;
  // ---- the river: a band of water all the way round the island, quays on both banks ----
  hx.water.push({ x0: -O, z0: -O, x1: O, z1: -E }, { x0: -O, z0: E, x1: O, z1: O }, { x0: -O, z0: -E, x1: -E, z1: E }, { x0: E, z0: -E, x1: O, z1: E });
  // the old 60 m sound wall is for cars only; the hero's city has a railing on the quay instead
  // ---- bridges ----
  // suspension: east (along z = 0) and south (along x = 0); cable-stayed: west (along z = 300)
  for (const [dir, off, kind] of [[[1, 0], 0, "suspension"], [[0, 1], 0, "suspension"], [[-1, 0], 300, "stayed"]]) bridge(M, H, dir, off, kind);
  // no trees growing through a bridge ramp
  M.trees = M.trees.filter((t) => !hx.bridges.some((b) => onBridge(b, t.x, t.z, 4)));
  // ---- the container port, on the north bank ----
  for (const px of [-780, -380, 380, 780]) pier(M, H, px);
  ship(M, H, 380 + 25 + 13, -1300);
  // ---- the mainland across the river: a quay, warehouses along it ----
  for (let k = 0; k < 4; k++) for (let u = -O + 60; u < O - 60; u += 75) {
    if (Math.abs(u) < 40 || (k === 3 && Math.abs(u - 300) < 40)) continue;   // where the bridges land
    const r = hash(k * 31 + 9, Math.round(u), 911);
    if (r < .25) continue;
    const L = 36 + r * 28, D = 22 + hash(k, Math.round(u), 912) * 14, h = 9 + hash(k, Math.round(u), 913) * 14;
    const [cx, cz] = rotQ(k, u, -(O + 20 + D / 2));
    const [ex, ez] = k % 2 ? [D / 2, L / 2] : [L / 2, D / 2];
    H.addBuilding(M, cx - ex, cz - ez, cx + ex, cz + ez, .15, h, 4, [0xb8b4aa, 0x8f8a86, 0xa89f94, 0x7d7a76][Math.floor(r * 4)]);
  }
  // ---- billboards on the mid-rise stone and brick blocks, and on low roofs ----
  let ad = 0;
  for (const b of M.buildings) {
    if (b.y0 > .3 || b.v > 3) continue;
    const h = b.y1 - b.y0, r = hash(Math.round(b.x0 * 3), Math.round(b.z0 * 3), 501);
    if (h > 16 && r < (b.v === 0 || b.v === 3 ? .3 : .14)) {
      const f = streetFace(b, roadAt, M);
      if (!f) continue;
      const w = Math.min(18, f.len * .62), bh = w * .48;
      hx.boards.push({ x: f.x + f.nx * .25, y: Math.min(b.y1 - bh / 2 - 2.5, 14 + bh / 2 + hash(Math.round(b.x1), Math.round(b.z1), 503) * 30), z: f.z + f.nz * .25, fx: f.nx, fz: f.nz, w, h: bh, ad: ad++ % ADS.length, wall: true });
    } else if (h > 9 && h < 34 && r > .9) {
      const f = streetFace(b, roadAt, M);
      if (!f) continue;
      const cx = (b.x0 + b.x1) / 2 - f.nx * 3, cz = (b.z0 + b.z1) / 2 - f.nz * 3;
      hx.boards.push({ x: cx, y: b.y1 + 4 + 3, z: cz, fx: f.nx, fz: f.nz, w: 14, h: 6, ad: ad++ % ADS.length, legs: b.y1 });
    }
  }
  // ---- Times Square: downtown plaza and surrounding screen-lined junction ----
  const SX = 100, SZ = 100;
  for (const b of M.buildings) {
    if (hx.screens.length >= 30 || b.y0 > 16 || b.y1 - b.y0 < 14) continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const qx = Math.max(b.x0, Math.min(b.x1, SX)), qz = Math.max(b.z0, Math.min(b.z1, SZ));
    if (Math.hypot(qx - SX, qz - SZ) > 90) continue;
    // the face nearest the junction
    const faces = [[b.x1, cz, 1, 0, b.z1 - b.z0], [b.x0, cz, -1, 0, b.z1 - b.z0], [cx, b.z1, 0, 1, b.x1 - b.x0], [cx, b.z0, 0, -1, b.x1 - b.x0]];
    const f = faces.filter((q) => (SX - q[0]) * q[2] + (SZ - q[1]) * q[3] > 0).sort((p, q) => Math.hypot(p[0] - SX, p[1] - SZ) - Math.hypot(q[0] - SX, q[1] - SZ))[0];
    if (!f) continue;
    // slide the screen towards the corner nearest the junction
    const ax = f[3] !== 0 ? 1 : 0, along = ax ? Math.max(-f[4] / 2 + 8, Math.min(f[4] / 2 - 8, SX - f[0])) : Math.max(-f[4] / 2 + 8, Math.min(f[4] / 2 - 8, SZ - f[1]));
    const x = f[0] + (ax ? along : 0) + f[2] * .3, z = f[1] + (ax ? 0 : along) + f[3] * .3;
    hx.screens.push({ x, y: b.y0 + Math.min(b.y1 - b.y0 - 12, 22), z, fx: f[2], fz: f[3], w: 13, h: 20, seed: hx.screens.length });
    if (b.y0 < .3) hx.screens.push({ x, y: 9.5, z, fx: f[2], fz: f[3], w: Math.min(26, f[4] * .8), h: 2.4, seed: 100 + hx.screens.length, ticker: true });
  }
  // ---- fire escapes on the old brick blocks ----
  for (const b of M.buildings) {
    if (b.v !== 3 || b.y0 > .3) continue;
    const h = b.y1 - b.y0;
    if (h < 14 || h > 90) continue;
    const sides = [[b.x0, (b.z0 + b.z1) / 2, -1, 0, b.z1 - b.z0], [b.x1, (b.z0 + b.z1) / 2, 1, 0, b.z1 - b.z0], [(b.x0 + b.x1) / 2, b.z0, 0, -1, b.x1 - b.x0], [(b.x0 + b.x1) / 2, b.z1, 0, 1, b.x1 - b.x0]];
    for (const [fx, fz, nx, nz, len] of sides) {
      const r = hash(Math.round(fx * 7), Math.round(fz * 7), 601);
      if (r > .5 || len < 12) continue;
      // something open in front of it (a street or an alley), not another building
      const px = fx + nx * 3, pz = fz + nz * 3;
      if (M.bg.query(px, pz, 0, []).some((q) => q !== b && px > q.x0 && px < q.x1 && pz > q.z0 && pz < q.z1)) continue;
      const along = (hash(Math.round(fx), Math.round(fz), 602) - .5) * (len - 8);
      const x = fx + (nz !== 0 ? along : 0) + nx * .68, z = fz + (nx !== 0 ? along : 0) + nz * .68;
      hx.escapes.push({ x, z, nx, nz, y0: 4.2, y1: b.y1 - 2, w: 3.4, d: 1.3 });
    }
  }
  // ---- the subway tunnel between the stations ----
  hx.under.push({ x0: TUNNEL.x0, x1: TUNNEL.x1, z0: TUNNEL.z0, z1: TUNNEL.z1, floor: TUNNEL.floor, open: false, ceil: TUNNEL.ceil });
}
const rotQ = (k, u, d) => (k === 0 ? [u, d] : k === 1 ? [-d, u] : k === 2 ? [-u, -d] : [d, -u]);
// the face of a building that looks onto a street, with its middle and length
function streetFace(b, roadAt, M) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const faces = [[b.x0, cz, -1, 0, b.z1 - b.z0], [b.x1, cz, 1, 0, b.z1 - b.z0], [cx, b.z0, 0, -1, b.x1 - b.x0], [cx, b.z1, 0, 1, b.x1 - b.x0]];
  for (const [x, z, nx, nz, len] of faces) if (len > 10 && roadAt(M, x + nx * 9, z + nz * 9)) return { x, z, nx, nz, len };
  return null;
}
export function onBridge(b, x, z, pad = 0) {
  const u = (x - b.ox) * b.dx + (z - b.oz) * b.dz, w = -(x - b.ox) * b.dz + (z - b.oz) * b.dx;
  return u > b.u0 - pad && u < b.u1 + pad && Math.abs(w) < b.hw + pad;
}
// Height of a bridge's deck along its run (u from the city's centre outwards): a ramp up from the
// boulevard, level over the river, a ramp down on the mainland.
export function deckY(u) {
  const E = RIVER.inner, O = RIVER.outer;
  if (u < 1115) return 0;
  if (u < E + 12) return DECK * smooth((u - 1115) / (E + 12 - 1115));
  if (u < O - 10) return DECK;
  if (u < O + 70) return DECK * (1 - smooth((u - (O - 10)) / 80));
  return 0;
}
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function bridge(M, H, dir, off, kind) {
  const hx = M.hx, [dx, dz] = dir, px = -dz, pz = dx;      // along the run, and across it
  const b = { kind, dx, dz, ox: px * off, oz: pz * off, u0: 1112, u1: RIVER.outer + 75, hw: 13, towers: [], cables: [], hangers: [], stays: [] };
  const at = (u, w = 0, y = 0) => ({ x: b.ox + dx * u + px * w, y, z: b.oz + dz * u + pz * w });
  // the deck: a drivable ribbon the hero walks on
  const pts = [];
  for (let u = b.u0; u <= b.u1; u += 4) pts.push(at(u, 0, deckY(u) + .15));
  H.addSurface(M, pts, b.hw, "bridge");
  b.pts = pts;
  if (kind === "suspension") {
    // two towers, the main cables hung between them in parabolas, hangers every 10 m
    const t1 = 1245, t2 = 1415, top = 112, sag = 30, anc0 = 1150, anc1 = RIVER.outer + 40;
    b.towers.push({ u: t1, top }, { u: t2, top });
    for (const w of [-12.5, 12.5]) {
      const c = [];
      const yAt = (u) => {
        if (u < t1) { const k = (u - anc0) / (t1 - anc0); return 20 + (top - 20) * k * k; }
        if (u <= t2) { const m = (t1 + t2) / 2, a = (u - m) / ((t2 - t1) / 2); return sag + (top - sag) * a * a; }
        const k = (anc1 - u) / (anc1 - t2); return 20 + (top - 20) * k * k;
      };
      for (let u = anc0; u <= anc1; u += 6) c.push(at(u, w, yAt(u)));
      b.cables.push(c);
      for (let u = anc0 + 10; u < anc1 - 4; u += 10) { if (Math.abs(u - t1) < 4 || Math.abs(u - t2) < 4) continue; const y = yAt(u), d = deckY(u) + 1; if (y - d > 2) b.hangers.push({ a: at(u, w, y), b: at(u, w, d) }); }
    }
  } else {
    // one A-shaped pylon in the middle of the river, stays fanning out to both halves of the deck
    const tu = (RIVER.inner + RIVER.outer) / 2, top = 150;
    b.towers.push({ u: tu, top, a: true });
    for (let k = 1; k <= 13; k++) for (const s of [-1, 1]) for (const w of [-12, 12]) {
      const du = k * 12;
      b.stays.push({ a: at(tu, w * .15, top - 6 - k * 3.2), b: at(tu + s * du, w, deckY(tu + s * du) + .8) });
    }
  }
  hx.bridges.push(b);
}

function pier(M, H, px) {
  const hx = M.hx, z0 = -RIVER.inner - 2, z1 = -RIVER.inner - 180, hw = 25;
  hx.piers.push({ x0: px - hw, x1: px + hw, z0: z1, z1: z0, y: 1.2 });
  // containers in rows down the pier, stacked one to four high
  const COLS = [0xb81c1c, 0x1f5fbf, 0x2e7d4f, 0xd6a22a, 0x5b6f86, 0xe8e6e0, 0x7a1f2b, 0x1d6b6b, 0xc8622a];
  for (let row = 0; row < 9; row++) for (let col = 0; col < 4; col++) {
    const r = H.hash(px, row * 7 + col, 701);
    if (r < .15) continue;
    const n = 1 + Math.floor(H.hash(px, row * 7 + col, 702) * 4);
    const x = px - 15 + col * 10, z = z0 - 12 - row * 15;
    for (let k = 0; k < n; k++) hx.containers.push({ x, y: 1.2 + k * 2.6, z, sx: 2.44, sy: 2.6, sz: 12.2, col: COLS[Math.floor(H.hash(px, row * 31 + col * 7 + k, 703) * COLS.length)] });
  }
  // a gantry crane at the seaward end: two legs on the pier edges, a girder across, a boom over the water
  hx.gantries.push({ x: px, z: z1 + 22, span: hw * 2 - 4, h: 42, boom: 46, back: 18 });
}
function ship(M, H, x, z) {
  M.hx.ships.push({ x, z, w: 24, L: 150, y0: -7, y1: 7.5, bridge: { z1: z + 75 - 4, L: 24, h: 22 } });
}

export const HERO_EXTRAS = {
  init(M) { M.hx = { pits: [], under: [], stairs: [], platforms: [], canopies: [], signs: [], dirt: [], fences: [], frames: [], cranes: [], stacks: [], water: [], bridges: [], piers: [], containers: [], gantries: [], ships: [], boards: [], screens: [], escapes: [] }; },
  block, finish,
};
