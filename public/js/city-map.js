// City Drive: the map, its traffic, and the questions the car asks of it (how high is the ground
// here, what am I about to hit). Pure JS - no three.js - so it can be built and stepped anywhere;
// city.js draws it and main.js drives on it.
//
// Metres; x runs east, z runs south, so north is -z - the way every car faces at yaw 0.
//  - Downtown: a 7 x 7 grid of streets 100 m apart (-300..300), two lanes each way. Every junction
//    with three or more arms has signals; sidewalks sit on 15 cm curbs; towers are tallest in the middle.
//  - The ring: an elevated six-lane expressway, 8 m up, round downtown - a square with rounded corners.
//  - An avenue leaves the middle of each side of downtown, runs under the ring and on to the outer
//    boulevard. Where it passes under the ring there is a diamond interchange: an off and an on ramp
//    for each carriageway, so you can merge onto the ring and leave it again on any side.
//  - The boulevard: a square road at 640 tying the four avenues together, so every lane leads somewhere.

export const LANE = 3.5, HALF = 7, WALK = 4.5, SETBACK = 11, CURB = .15;
export const DOWN = 300, PITCH = 100;
export const RING = 460, RC = 110, DECK_Y = 8, DECK_HW = 14, RAMP_HW = 3.6, RAMP_OFF = 18.5, DECK_T = 1.2;
export const BLVD = 640, EDGE = 700;
export const HW_OFF = [3.8, 7.4, 11];           // expressway lane centres, out from the median
const HW_SPEED = [33, 30, 27];                  // m/s: the fast lane is the one by the median
const ST_SPEED = 14, AVE_SPEED = 19, BLVD_SPEED = 20;

export function hash(a, b = 0, c = 0) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const P3 = (x, y, z) => ({ x, y, z });
// the four arms of a junction, as the way out along each: N E S W
export const AV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const armOf = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0);
// quarter turns about the centre: the map is the same on all four sides
export const rot = (k, x, z) => (k === 0 ? [x, z] : k === 1 ? [-z, x] : k === 2 ? [-x, -z] : [z, -x]);
// signed distance to the ring's centre line (a square of half-size RING with corners of radius RC)
export function ringSD(x, z) {
  const a = RING - RC, qx = Math.abs(x) - a, qz = Math.abs(z) - a;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - RC;
}

// ---------------------------------------------------------------- signals
// Four protected phases: north-south through (and right turns), north-south lefts, then the same
// east-west. Nothing that is green at the same time crosses anything else, so the traffic never has
// to judge a gap - it just obeys the lights. 0 green, 1 amber, 2 red.
const PHASES = [[0, false, 12], [0, true, 5], [1, false, 12], [1, true, 5]];
export const AMBER = 3, ALL_RED = 1;
export const CYCLE = PHASES.reduce((a, p) => a + p[2] + AMBER + ALL_RED, 0);
export function signalAt(node, axis, left, T) {
  let t = (((T + node.off) % CYCLE) + CYCLE) % CYCLE;
  for (const [ax, lf, g] of PHASES) {
    const len = g + AMBER + ALL_RED;
    if (t < len) return ax !== axis || lf !== left ? 2 : t < g ? 0 : t < g + AMBER ? 1 : 2;
    t -= len;
  }
  return 2;
}

// ---------------------------------------------------------------- spatial hash
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); this.q = 0; }
  key(i, j) { return (i + 4096) * 8192 + (j + 4096); }
  add(x0, z0, x1, z1, item) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = this.key(i, j);
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(item);
    }
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const q = ++this.q, c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      const a = this.map.get(this.key(i, j));
      if (a) for (const it of a) if (it._q !== q) { it._q = q; out.push(it); }
    }
    return out;
  }
}

// ---------------------------------------------------------------- polylines
function line(x0, z0, x1, z1, y0 = 0, y1 = y0, step = 4) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step)), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(P3(x0 + (x1 - x0) * t, y0 + (y1 - y0) * smooth(t), z0 + (z1 - z0) * t)); }
  return out;
}
// a lane easing sideways as it runs along x (the ramp templates run east-west)
function taper(x0, z0, x1, z1, y, step = 3) {
  const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / step)), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(P3(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * smooth(t))); }
  return out;
}
// a cubic from one heading to another - a quarter circle when the turn is square
function bez(x0, z0, h0x, h0z, x3, z3, h3x, h3z, y = 0, step = 1.5) {
  const ch = Math.hypot(x3 - x0, z3 - z0), k = ch * .39;
  const x1 = x0 + h0x * k, z1 = z0 + h0z * k, x2 = x3 - h3x * k, z2 = z3 - h3z * k;
  const n = Math.max(2, Math.ceil((ch * 1.25) / step)), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(P3(a * x0 + b * x1 + c * x2 + d * x3, y, a * z0 + b * z1 + c * z2 + d * z3));
  }
  return out;
}
const rotPts = (k, pts) => pts.map((p) => { const [x, z] = rot(k, p.x, p.z); return P3(x, p.y, z); });
const concat = (parts) => parts.reduce((a, p) => (a.length ? a.concat(p.slice(1)) : p.slice()), []);
// the same line moved sideways, + to the right of travel
export function offsetPts(pts, off, closed = false) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[i > 0 ? i - 1 : closed ? n - 2 : 0], b = pts[i < n - 1 ? i + 1 : closed ? 1 : n - 1];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    return P3(p.x - (dz / L) * off, p.y, p.z + (dx / L) * off);
  });
}
const dedupe = (pts) => pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z) > 1e-3);

// ---------------------------------------------------------------- lanes
// A link is one lane between two decision points: a polyline the traffic follows, with the links it
// can go on to. Junction connectors carry the signal that governs them; the lane feeding a signal
// ends on the stop line (stop = true).
function relen(l) {
  const c = [0];
  for (let i = 1; i < l.pts.length; i++) c.push(c[i - 1] + Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y, l.pts[i].z - l.pts[i - 1].z));
  l.cum = c; l.len = c[c.length - 1];
}
function mkLink(M, pts, o) {
  const l = { id: M.links.length, pts, cum: null, len: 0, next: [], prev: [], cars: [], speed: o.speed, kind: o.kind, lane: o.lane ?? 0, turn: o.turn || "S", sig: o.sig || null, stop: !!o.stop, bb: null };
  relen(l);
  M.links.push(l);
  return l;
}
const join = (a, b) => { a.next.push(b); b.prev.push(a); };
// cut a lane in two at s; the first part keeps its id and ends where the second begins
function splitAt(M, l, s) {
  const { pts, cum } = l;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], t = Math.max(0, Math.min(1, (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)));
  const p = P3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  const tail = mkLink(M, dedupe([p, ...pts.slice(i)]), { speed: l.speed, kind: l.kind, lane: l.lane, stop: l.stop });
  tail.next = l.next;
  for (const n of tail.next) n.prev[n.prev.indexOf(l)] = tail;
  l.pts = dedupe([...pts.slice(0, i), p]); relen(l);
  l.next = []; l.stop = false;
  join(l, tail);
  return tail;
}
// the lane of a kind that passes through (x, z), and how far along it that is
function locate(M, kind, x, z) {
  let best = null, bd = 1e9, bs = 0;
  for (const l of M.links) {
    if (l.kind !== kind) continue;
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d < bd) { bd = d; best = l; bs = l.cum[i - 1] + t * (l.cum[i] - l.cum[i - 1]); }
    }
  }
  if (bd > 1) throw new Error(`city: no ${kind} lane at ${x.toFixed(1)},${z.toFixed(1)}`);
  return { l: best, s: bs };
}
// a point on a lane: position, horizontal heading, grade
export function sampleLink(l, s, out) {
  const c = l.cum, n = c.length;
  let lo = 0, hi = n - 1;
  if (s <= 0) hi = 1;
  else if (s >= l.len) lo = n - 2;
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const a = l.pts[lo], b = l.pts[hi], seg = c[hi] - c[lo] || 1, t = Math.max(0, Math.min(1, (s - c[lo]) / seg));
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
  const dx = b.x - a.x, dz = b.z - a.z, h = Math.hypot(dx, dz) || 1;
  out.hx = dx / h; out.hz = dz / h; out.grade = (b.y - a.y) / h;
  return out;
}

// ---------------------------------------------------------------- build
export function buildCity() {
  const M = {
    nodes: [], roads: [], links: [], surfaces: [], walls: [], slabs: [], buildings: [], roofs: [], beacons: [],
    pillars: [], caps: [], barriers: [], lamps: [], trees: [], heads: [], props: [], marks: [], parked: [], gantries: [],
    ramps: [], ring: null, spawns: [],
    sg: new Grid(16), wg: new Grid(16), bg: new Grid(32), slg: new Grid(32), rg: new Grid(40),
  };

  // ---- junctions and roads ----
  const byKey = new Map();
  const node = (x, z) => {
    const k = `${Math.round(x)},${Math.round(z)}`;
    let n = byKey.get(k);
    if (!n) { n = { id: M.nodes.length, x, z, arms: [null, null, null, null], in: [[], [], [], []], out: [[], [], [], []], signal: false, off: 0 }; byKey.set(k, n); M.nodes.push(n); }
    return n;
  };
  const road = (a, b, speed, kind) => {
    const r = { a, b, ea: armOf(b.x - a.x, b.z - a.z), eb: armOf(a.x - b.x, a.z - b.z), speed, kind };
    a.arms[r.ea] = r; b.arms[r.eb] = r;
    M.roads.push(r);
    // the paved rectangle, run 7 m past both centres so every junction box is covered whatever its arms
    const x0 = Math.min(a.x, b.x) - HALF, x1 = Math.max(a.x, b.x) + HALF, z0 = Math.min(a.z, b.z) - HALF, z1 = Math.max(a.z, b.z) + HALF;
    r.rect = { x0, z0, x1, z1 };
    M.rg.add(x0, z0, x1, z1, r.rect);
  };
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    if (i < 3) road(node(i * PITCH, j * PITCH), node((i + 1) * PITCH, j * PITCH), ST_SPEED, "street");
    if (j < 3) road(node(i * PITCH, j * PITCH), node(i * PITCH, (j + 1) * PITCH), ST_SPEED, "street");
  }
  for (let k = 0; k < 4; k++) {
    const [ax, az] = rot(k, 0, -DOWN), [bx, bz] = rot(k, 0, -BLVD);
    road(node(ax, az), node(bx, bz), AVE_SPEED, "ave");
  }
  const blvd = [];
  for (let k = 0; k < 4; k++) blvd.push(rot(k, -BLVD, -BLVD), rot(k, 0, -BLVD));
  for (let i = 0; i < blvd.length; i++) { const a = blvd[i], b = blvd[(i + 1) % blvd.length]; road(node(a[0], a[1]), node(b[0], b[1]), BLVD_SPEED, "blvd"); }

  // two lanes each way on every road, from one junction's exit to the next one's stop line
  for (const r of M.roads) for (const dir of [1, -1]) for (let k = 0; k < 2; k++) {
    const [from, to, e0, e1] = dir > 0 ? [r.a, r.b, r.ea, r.eb] : [r.b, r.a, r.eb, r.ea];
    const [hx, hz] = AV[e0], off = (k + .5) * LANE, rx = -hz * off, rz = hx * off;
    const l = mkLink(M, [P3(from.x + hx * SETBACK + rx, 0, from.z + hz * SETBACK + rz), P3(to.x - hx * SETBACK + rx, 0, to.z - hz * SETBACK + rz)],
      { speed: r.speed, kind: r.kind, lane: k });
    from.out[e0][k] = l; to.in[e1][k] = l;
  }
  // junction connectors. The inside lane goes straight or left, the outside lane straight or right;
  // where a lane has neither (a corner), it takes whatever the junction allows, lane for lane.
  for (const n of M.nodes) {
    const arms = n.arms.filter(Boolean).length;
    n.signal = arms >= 3;
    n.off = hash(n.x + 5000, n.z + 5000, 7) * CYCLE;
    for (let a = 0; a < 4; a++) for (let k = 0; k < 2; k++) {
      const inL = n.in[a][k];
      if (!inL) continue;
      const moves = [["S", (a + 2) % 4], ["R", (a + 3) % 4], ["L", (a + 1) % 4]].filter(([, e]) => n.out[e][k]);
      const pref = k === 0 ? ["S", "L"] : ["S", "R"];
      let use = moves.filter(([m]) => pref.includes(m));
      if (!use.length) use = moves;
      for (const [m, e] of use) {
        const outL = n.out[e][k], p0 = inL.pts[inL.pts.length - 1], p3 = outL.pts[0];
        const h0 = AV[(a + 2) % 4], h3 = AV[e];
        const pts = m === "S" ? [P3(p0.x, 0, p0.z), P3(p3.x, 0, p3.z)] : bez(p0.x, p0.z, h0[0], h0[1], p3.x, p3.z, h3[0], h3[1]);
        const rad = Math.hypot(p3.x - p0.x, p3.z - p0.z) / Math.SQRT2;
        const c = mkLink(M, pts, { speed: m === "S" ? Math.min(inL.speed, outL.speed) : Math.min(inL.speed, Math.sqrt(3.4 * rad)), kind: "conn", lane: k, turn: m,
          sig: n.signal ? { n, axis: a % 2, left: m === "L" } : null });
        c.node = n;
        join(inL, c); join(c, outL);
      }
      inL.stop = n.signal;
      inL.node = n;
    }
  }

  // ---- the ring ----
  const a = RING - RC, C = [];
  for (let k = 0; k < 4; k++) {
    const side = [];
    for (let x = -a; x < a - 1e-6; x += 4) side.push([x, -RING]);
    const nA = Math.ceil((RC * Math.PI / 2) / 4);
    for (let i = 0; i < nA; i++) { const f = (i / nA) * Math.PI / 2; side.push([a + RC * Math.sin(f), -a - RC * Math.cos(f)]); }
    for (const [x, z] of side) { const [X, Z] = rot(k, x, z); C.push(P3(X, DECK_Y, Z)); }
  }
  C.push(P3(C[0].x, C[0].y, C[0].z));   // closed: clockwise on the map, east along the north side
  M.ring = C;
  // clockwise lanes sit on the inside of the loop (right of travel); anticlockwise ones outside, reversed
  for (let j = 0; j < 3; j++) {
    const cw = mkLink(M, offsetPts(C, HW_OFF[j], true), { speed: HW_SPEED[j], kind: "hwy", lane: j });
    const ccw = mkLink(M, offsetPts(C, -HW_OFF[j], true).reverse(), { speed: HW_SPEED[j], kind: "hwy", lane: j });
    join(cw, cw); join(ccw, ccw);
  }
  const deck = addSurface(M, C, DECK_HW, "deck");

  // ---- interchanges: the north one, turned to each side ----
  const zR = -RING, IN2 = zR + HW_OFF[2], OUT2 = zR - HW_OFF[2], zi = zR + RAMP_OFF, zo = zR - RAMP_OFF, J = 55, X1 = 240, X2 = 170, X3 = 50;
  const LX = LANE * 1.5;
  const curveSpeed = (p) => Math.min(20, Math.sqrt(3.4 * Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].z - p[0].z) / Math.SQRT2));
  const T = [
    // clockwise traffic (eastbound here) leaves before the avenue and drops into downtown
    { from: "hwy", at: [-X1, IN2], to: "ave", end: [-LX, zR + J], parts: [
      [taper(-X1, IN2, -X2, zi, DECK_Y), 25], [line(-X2, zi, -X3, zi, DECK_Y, 0), 21], [bez(-X3, zi, 1, 0, -LX, zR + J, 0, 1), 0]] },
    // ...and joins it again from the avenue's northbound side, after it
    { from: "ave", at: [LX, zR + J], to: "hwy", end: [X1, IN2], parts: [
      [bez(LX, zR + J, 0, -1, X3, zi, 1, 0), 0], [line(X3, zi, X2, zi, 0, DECK_Y), 21], [taper(X2, zi, X1, IN2, DECK_Y), 25]] },
    // anticlockwise traffic (westbound here) leaves on the outside, onto the avenue out to the boulevard
    { from: "hwy", at: [X1, OUT2], to: "ave", end: [LX, zR - J], parts: [
      [taper(X1, OUT2, X2, zo, DECK_Y), 25], [line(X2, zo, X3, zo, DECK_Y, 0), 21], [bez(X3, zo, -1, 0, LX, zR - J, 0, -1), 0]] },
    { from: "ave", at: [-LX, zR - J], to: "hwy", end: [-X1, OUT2], parts: [
      [bez(-LX, zR - J, 0, 1, -X3, zo, -1, 0), 0], [line(-X3, zo, -X2, zo, 0, DECK_Y), 21], [taper(-X2, zo, -X1, OUT2, DECK_Y), 25]] },
  ];
  for (let k = 0; k < 4; k++) for (const t of T) {
    const links = t.parts.map(([p, sp]) => { const pts = rotPts(k, p); return mkLink(M, pts, { speed: sp || curveSpeed(pts), kind: "ramp" }); });
    for (let i = 1; i < links.length; i++) join(links[i - 1], links[i]);
    const [fx, fz] = rot(k, t.at[0], t.at[1]), [ex, ez] = rot(k, t.end[0], t.end[1]);
    const f = locate(M, t.from, fx, fz);
    splitAt(M, f.l, f.s); join(f.l, links[0]);
    const e = locate(M, t.to, ex, ez);
    join(links[links.length - 1], splitAt(M, e.l, e.s));
    const pts = concat(links.map((l) => l.pts));
    M.ramps.push({ pts, surf: addSurface(M, pts, RAMP_HW, "ramp") });
  }

  // ---- barriers on everything elevated, with gaps where one carriageway runs into another ----
  const barrier = (pts, i, off, surf) => {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
    const ax = a.x + nx * off, az = a.z + nz * off, bx = b.x + nx * off, bz = b.z + nz * off;
    const y = (a.y + b.y) / 2;
    if (off !== 0) {
      if (y < .9) return;
      // a surface just past this edge at about this height: the two are one road here, so no wall
      const s = Math.sign(off), tx = (ax + bx) / 2 + nx * s * .85, tz = (az + bz) / 2 + nz * s * .85;
      if (surfaceAt(M, tx, tz, y + .5, surf, 0) > y - 1) return;
    }
    M.barriers.push({ ax, ay: a.y, az, bx, by: b.y, bz });
    const low = Math.min(a.y, b.y);
    addWall(M, ax, az, bx, bz, low > 5 ? low - .5 : -1, Math.max(a.y, b.y) + 1.1);
  };
  for (let i = 0; i < C.length - 1; i++) { barrier(C, i, DECK_HW - .3, deck.id); barrier(C, i, -(DECK_HW - .3), deck.id); barrier(C, i, 0, deck.id); }
  for (const r of M.ramps) for (let i = 0; i < r.pts.length - 1; i++) { barrier(r.pts, i, RAMP_HW - .3, r.surf.id); barrier(r.pts, i, -(RAMP_HW - .3), r.surf.id); }

  // ---- what holds it up: pier pairs with a cap every 32 m, clear of the avenues ----
  for (let i = 0; i < C.length - 1; i += 8) {
    const p = C[i], q = C[i + 1], dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    if (Math.min(Math.abs(p.x), Math.abs(p.z)) < 14) continue;
    M.caps.push({ x: p.x, y: DECK_Y - DECK_T - .45, z: p.z, sx: 1.6, sy: .9, sz: 24, rotY: Math.atan2(-uz, ux) });
    for (const o of [-8, 8]) addPillar(M, p.x - uz * o, p.z + ux * o, .85, DECK_Y - DECK_T - .9);
  }
  for (const r of M.ramps) {
    let run = 99;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const p = r.pts[i], q = r.pts[i + 1];
      run += Math.hypot(q.x - p.x, q.z - p.z);
      if (p.y < 5.2 || Math.abs(ringSD(p.x, p.z)) < DECK_HW + 1.2 || run < 22) continue;
      run = 0;
      addPillar(M, p.x, p.z, .7, p.y - DECK_T);
    }
  }

  // ---- sidewalks, lots, parks, parking ----
  const slab = (x0, z0, x1, z1, kind = "walk", h = CURB) => {
    const s = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h, kind };
    M.slabs.push(s); M.slg.add(s.x0, s.z0, s.x1, s.z1, s);
    return s;
  };
  const rslab = (k, x0, z0, x1, z1, kind) => { const [ax, az] = rot(k, x0, z0), [bx, bz] = rot(k, x1, z1); return slab(ax, az, bx, bz, kind); };
  // downtown blocks: kerb to kerb, buildings on the lot inside the sidewalk
  for (let i = -3; i < 3; i++) for (let j = -3; j < 3; j++) {
    const x0 = i * PITCH + HALF, x1 = (i + 1) * PITCH - HALF, z0 = j * PITCH + HALF, z1 = (j + 1) * PITCH - HALF;
    slab(x0, z0, x1, z1);
    downtownBlock(M, i, j, x0 + WALK, z0 + WALK, x1 - WALK, z1 - WALK);
  }
  const E0 = DOWN + HALF, E1 = E0 + WALK;
  for (let k = 0; k < 4; k++) {
    // the outer sidewalk of downtown's edge streets, open where the avenue leaves
    rslab(k, -E1, -E1, -HALF, -E0); rslab(k, HALF, -E1, E1, -E0);
    // the avenue's sidewalks, broken where a ramp comes down beside it
    for (const s of [-1, 1]) {
      let run = null;
      for (let z = -E0; z > -BLVD + HALF; z -= 4) {
        const cx = s * (HALF + WALK / 2), cz = z - 2, [wx, wz] = rot(k, cx, cz);
        const gap = M.ramps.some((r) => r.pts.some((p) => p.y < 1.5 && Math.hypot(p.x - wx, p.z - wz) < RAMP_HW + 4));
        if (!gap && !run) run = [z, z];
        if (!gap) run[1] = z - 4;
        if ((gap || z - 4 <= -BLVD + HALF) && run) { rslab(k, s * HALF, run[0], s * (HALF + WALK), run[1]); run = null; }
      }
    }
    // the boulevard's sidewalks, both sides
    const B0 = BLVD - HALF, B1 = B0 - WALK, O0 = BLVD + HALF, O1 = O0 + WALK;
    rslab(k, -B0, -B0, -HALF, -B1); rslab(k, HALF, -B0, B0, -B1);
    rslab(k, -O1, -O1, O1, -O0);
  }

  // ---- the land between downtown and the edge, on a 4 m raster of what is already taken ----
  const RES = 4, NR = Math.ceil((EDGE * 2) / RES), used = new Uint8Array(NR * NR);
  const cellOf = (v) => Math.floor((v + EDGE) / RES);
  const stamp = (x, z, r) => {
    for (let i = cellOf(x - r); i <= cellOf(x + r); i++) for (let j = cellOf(z - r); j <= cellOf(z + r); j++) if (i >= 0 && j >= 0 && i < NR && j < NR) used[i * NR + j] = 1;
  };
  for (let i = 0; i < NR; i++) for (let j = 0; j < NR; j++) {
    const x = -EDGE + (i + .5) * RES, z = -EDGE + (j + .5) * RES, m = Math.max(Math.abs(x), Math.abs(z));
    if (m < E1 + 3 || (Math.min(Math.abs(x), Math.abs(z)) < HALF + WALK + 3) || Math.abs(m - BLVD) < HALF + WALK + 3 || Math.abs(ringSD(x, z)) < DECK_HW + 6 || m > EDGE - 14) used[i * NR + j] = 1;
  }
  for (const r of M.ramps) for (const p of r.pts) stamp(p.x, p.z, RAMP_HW + 5);
  const free = (x0, z0, x1, z1) => {
    for (let i = cellOf(x0); i <= cellOf(x1 - .01); i++) for (let j = cellOf(z0); j <= cellOf(z1 - .01); j++) if (i < 0 || j < 0 || i >= NR || j >= NR || used[i * NR + j]) return false;
    return true;
  };
  const TILE = 40;
  let parkedN = 0;
  for (let tx = -EDGE; tx < EDGE; tx += TILE) for (let tz = -EDGE; tz < EDGE; tz += TILE) {
    if (!free(tx, tz, tx + TILE, tz + TILE)) continue;
    const x0 = tx + 3, z0 = tz + 3, x1 = tx + TILE - 3, z1 = tz + TILE - 3, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const m = Math.max(Math.abs(cx), Math.abs(cz)), r = hash(tx + 9000, tz + 9000, 3), r2 = hash(tx + 9000, tz + 9000, 4);
    const inner = m < RING;
    const kind = inner ? (r < .62 ? "bldg" : r < .84 ? "park" : "parking") : m < BLVD ? (r < .46 ? "shed" : r < .72 ? "parking" : "park") : "park";
    if (kind === "park") {
      slab(x0, z0, x1, z1, "park");
      const n = 3 + Math.floor(r2 * 6);
      for (let t = 0; t < n; t++) M.trees.push({ x: x0 + 3 + hash(tx, tz, 20 + t) * (x1 - x0 - 6), z: z0 + 3 + hash(tx, tz, 40 + t) * (z1 - z0 - 6), s: .8 + hash(tx, tz, 60 + t) * .6 });
    } else if (kind === "parking") {
      slab(x0, z0, x1, z1, "parking", .05);
      parkingLot(M, x0, z0, x1, z1, tx, tz, () => parkedN++ < 44);
    } else {
      slab(x0, z0, x1, z1, "lot");
      const ins = 2 + r2 * 4;
      if (kind === "shed") {
        const h = 8 + hash(tx, tz, 9) * 7;
        addBuilding(M, x0 + 2, z0 + 2, x1 - 2, z1 - 2, CURB, h, 4, PAL[4][Math.floor(hash(tx, tz, 10) * PAL[4].length)]);
        roofKit(M, x0 + 2, z0 + 2, x1 - 2, z1 - 2, CURB + h, tx, tz);
      } else {
        const near = Math.max(0, 1 - (m - DOWN) / (RING - DOWN)), h = 14 + hash(tx, tz, 9) * 26 + near * 22;
        const v = hash(tx, tz, 11) < .25 ? 3 : hash(tx, tz, 11) < .7 ? 0 : 1;
        addBuilding(M, x0 + ins, z0 + ins, x1 - ins, z1 - ins, CURB, h, v, PAL[v][Math.floor(hash(tx, tz, 10) * PAL[v].length)]);
        roofKit(M, x0 + ins, z0 + ins, x1 - ins, z1 - ins, CURB + h, tx, tz);
      }
    }
  }

  // ---- street lamps, trees and signals along every road ----
  for (const r of M.roads) {
    const ax = r.a.x, az = r.a.z, bx = r.b.x, bz = r.b.z, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
    for (const s of [-1, 1]) {
      for (let d = 17; d < L - 16; d += 29) {
        const px = ax + ux * d + nx * s * (HALF + .7), pz = az + uz * d + nz * s * (HALF + .7);
        if (r.kind === "ave" && groundAt(M, px, pz) < .1) continue;   // no sidewalk here: a ramp comes down
        if (Math.abs(ringSD(px, pz)) < DECK_HW + 3) continue;           // under the ring: its own lamps light it
        M.lamps.push({ x: px, z: pz, y: 8.4, ax: -nx * s, az: -nz * s });
      }
      for (let d = 31; d < L - 16; d += 29) {
        const px = ax + ux * d + nx * s * (HALF + 2.6), pz = az + uz * d + nz * s * (HALF + 2.6);
        if (groundAt(M, px, pz) < .1 || Math.abs(ringSD(px, pz)) < DECK_HW + 3) continue;
        M.trees.push({ x: px, z: pz, s: .7 + hash(px, pz, 5) * .35 });
      }
    }
  }
  for (let i = 0; i < C.length - 1; i += 12) M.lamps.push({ x: C[i].x, z: C[i].z, y: DECK_Y + 10, ax: 0, az: 0, twin: true, base: DECK_Y });
  for (const n of M.nodes) {
    if (!n.signal) continue;
    for (let a = 0; a < 4; a++) {
      if (!n.in[a][0]) continue;
      const [hx, hz] = AV[(a + 2) % 4], rx = -hz, rz = hx, bx = n.x + hx * (HALF + 2.4), bz = n.z + hz * (HALF + 2.4);
      const px = bx + rx * (HALF + 1.1), pz = bz + rz * (HALF + 1.1);
      M.props.push({ x: px, y: 0, z: pz, sx: .28, sy: 7, sz: .28, rotY: 0 });                                     // pole
      const armL = HALF + .3, mx = bx + rx * (HALF + 1.1 - armL / 2), mz = bz + rz * (HALF + 1.1 - armL / 2);
      M.props.push({ x: mx, y: 6.55, z: mz, sx: a % 2 ? .18 : armL, sy: .18, sz: a % 2 ? armL : .18, rotY: 0 });  // mast arm over the lanes
      const leftOK = n.out[(a + 1) % 4][0] && n.in[a][0].next.some((c) => c.turn === "L");
      for (let k = 0; k < 2; k++) {
        const off = (k + .5) * LANE;
        M.heads.push({ x: bx + rx * off, y: 5.75, z: bz + rz * off, fx: -hx, fz: -hz, n, axis: a % 2, left: k === 0 && !!leftOK });
      }
    }
  }

  // ---- overhead signs before every exit ----
  for (let k = 0; k < 4; k++) {
    for (const [x, off, text] of [[-330, 1, "down"], [330, -1, "out"]]) {
      const [gx, gz] = rot(k, x, zR);
      const [dx, dz] = rot(k, off, 0);        // direction of travel under this sign
      M.gantries.push({ x: gx, z: gz, dx, dz, side: off, text });
    }
  }

  // ---- the edge of the world: a sound wall, and trees in front of it ----
  const W = EDGE - 3;
  for (const [ax, az, bx, bz] of [[-W, -W, W, -W], [W, -W, W, W], [W, W, -W, W], [-W, W, -W, -W]]) addWall(M, ax, az, bx, bz, -10, 60);
  for (let i = 0; i < 240; i++) {
    const t = hash(i, 1, 77) * 4, k = Math.floor(t), u = (t - k) * 2 - 1, d = W - 5 - hash(i, 2, 77) * 30;
    const [x, z] = rot(k, u * (W - 6), -d);
    if (Math.abs(Math.abs(Math.max(Math.abs(x), Math.abs(z))) - BLVD) < HALF + WALK + 2) continue;
    M.trees.push({ x, z, s: 1 + hash(i, 3, 77) * .7 });
  }

  // ---- things on the sidewalk you can hit: lamp standards, signal poles, tree trunks, parked cars ----
  for (const L of M.lamps) addPost(M, L.x, L.z, .2, (L.base || 0) - .5, L.y);
  for (const p of M.props) if (p.sy > 3) addPost(M, p.x, p.z, .22, -1, p.sy);
  for (const t of M.trees) addPost(M, t.x, t.z, .2 + .12 * t.s, -1, 3);
  for (const p of M.parked) {
    const b = { x0: p.x - .98, z0: p.z - 2.4, x1: p.x + .98, z1: p.z + 2.4, y0: .05, y1: 1.5, solid: true };   // bays run north-south
    M.bg.add(b.x0, b.z0, b.x1, b.z1, b);
  }

  // ---- where a player starts: downtown, in lane, pointing along the street ----
  M.spawns = [
    { x: 5.25, z: 50, yaw: 0 }, { x: -5.25, z: -50, yaw: Math.PI }, { x: -50, z: 5.25, yaw: -Math.PI / 2 }, { x: 50, z: -5.25, yaw: Math.PI / 2 },
    { x: 1.75, z: 70, yaw: 0 }, { x: -1.75, z: -70, yaw: Math.PI }, { x: -70, z: 1.75, yaw: -Math.PI / 2 }, { x: 70, z: -1.75, yaw: Math.PI / 2 },
  ];

  // bounding boxes, for picking the lanes near someone
  for (const l of M.links) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of l.pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    l.bb = { x0, z0, x1, z1 };
  }
  buildMarks(M);
  return M;
}

// ---------------------------------------------------------------- building helpers
// facade looks: 0 stone, 1 blue glass, 2 bronze glass, 3 brick, 4 industrial panels
export const PAL = [
  [0xb8b0a2, 0xa89f94, 0xc2b8a8, 0x9aa6b0, 0x8f8a86, 0xd6cfc2, 0x7d7a76],
  [0x5c6f82, 0x44566a, 0x6d8196, 0x3b4a5a, 0x50606c],
  [0x5a4a3c, 0x6b5a48, 0x4a3e34, 0x3c3630],
  [0x8a4a36, 0x7a3f2e, 0x9c5a44, 0x6e3a2c, 0x8c5642],
  [0xc8c6c0, 0xb0b4b8, 0x9ea3a8, 0xd8d2c4, 0xa8a090],
];
function addBuilding(M, x0, z0, x1, z1, y0, h, v, col) {
  const b = { x0, z0, x1, z1, y0, y1: y0 + h, v, col, solid: y0 < .3 };
  M.buildings.push(b);
  if (b.solid) M.bg.add(x0, z0, x1, z1, b);
  return b;
}
// plant on the roof: fans, housings, a water tank
function roofKit(M, x0, z0, x1, z1, y, s1, s2) {
  const n = 1 + Math.floor(hash(s1, s2, 31) * 3);
  for (let i = 0; i < n; i++) {
    const w = Math.min(x1 - x0 - 4, 3 + hash(s1, s2, 32 + i) * 6), d = Math.min(z1 - z0 - 4, 3 + hash(s1, s2, 42 + i) * 6);
    if (w < 1.5 || d < 1.5) continue;
    const x = x0 + 2 + w / 2 + hash(s1, s2, 52 + i) * (x1 - x0 - 4 - w), z = z0 + 2 + d / 2 + hash(s1, s2, 62 + i) * (z1 - z0 - 4 - d);
    M.roofs.push({ x, y, z, sx: w, sy: 1.4 + hash(s1, s2, 72 + i) * 2.6, sz: d, col: [0x8d9096, 0x9fa2a6, 0x7a7d82, 0xb4b0a8][i % 4] });
  }
}
// one downtown block: a tower on a podium, a pair of slabs, four smaller buildings, or a tower and a plaza
function downtownBlock(M, gi, gj, x0, z0, x1, z1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, f = Math.max(0, 1 - Math.hypot(cx, cz) / 330);
  const r = (n) => hash(gi + 50, gj + 50, n);
  const pat = Math.floor(r(1) * 4);
  const look = (h, n) => (h > 95 ? (r(n) < .55 ? 1 : 2) : r(n) < .2 ? 1 : r(n) < .6 ? 0 : 3);
  const col = (v, n) => PAL[v][Math.floor(r(n) * PAL[v].length)];
  const tower = (bx0, bz0, bx1, bz1, y, h, n) => {
    const v = look(h, n), b = addBuilding(M, bx0, bz0, bx1, bz1, y, h, v, col(v, n + 1));
    let top = y + h, tx0 = bx0, tz0 = bz0, tx1 = bx1, tz1 = bz1;
    // tall ones step back near the top, and the tallest carry a mast with a warning light
    if (h > 110) {
      const s = 3 + r(n + 2) * 4;
      tx0 += s; tz0 += s; tx1 -= s; tz1 -= s;
      const h2 = 8 + r(n + 3) * 16;
      addBuilding(M, tx0, tz0, tx1, tz1, top, h2, v, col(v, n + 1));
      top += h2;
      if (h > 150) {
        const mh = 14 + r(n + 4) * 16, mx = (tx0 + tx1) / 2, mz = (tz0 + tz1) / 2;
        M.roofs.push({ x: mx, y: top, z: mz, sx: .7, sy: mh, sz: .7, col: 0x9aa0a6 });
        M.beacons.push({ x: mx, y: top + mh + .3, z: mz });
      }
    }
    roofKit(M, tx0, tz0, tx1, tz1, top, gi * 10 + n, gj * 10 + n);
    return b;
  };
  const W = x1 - x0, D = z1 - z0;
  if (pat === 0) {
    const ph = 9 + r(5) * 6, v = r(6) < .5 ? 0 : 3;
    addBuilding(M, x0, z0, x1, z1, CURB, ph, v, col(v, 7));
    const ins = 8 + r(8) * 7;
    tower(x0 + ins, z0 + ins, x1 - ins, z1 - ins, CURB + ph, 55 + 175 * f * f + r(9) * 40, 10);
  } else if (pat === 1) {
    const alongX = r(5) < .5, g = 2.5;
    for (const s of [0, 1]) {
      const h = 22 + 95 * f + r(20 + s) * 35;
      if (alongX) tower(x0 + (s ? W / 2 + g : 0), z0, s ? x1 : x0 + W / 2 - g, z1, CURB, h, 20 + s * 5);
      else tower(x0, z0 + (s ? D / 2 + g : 0), x1, s ? z1 : z0 + D / 2 - g, CURB, h, 20 + s * 5);
    }
  } else if (pat === 2) {
    const g = 2;
    for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const h = 16 + (60 * f + 20) * r(30 + sx + sz * 2) + 8;
      tower(sx ? x0 + W / 2 + g : x0, sz ? z0 + D / 2 + g : z0, sx ? x1 : x0 + W / 2 - g, sz ? z1 : z0 + D / 2 - g, CURB, h, 30 + sx * 3 + sz * 7);
    }
  } else {
    // a tower on one half, a low pavilion and trees on the plaza in front of it
    const side = Math.floor(r(5) * 4), h = 45 + 150 * f * f + r(6) * 30;
    const [tx0, tz0, tx1, tz1] = side === 0 ? [x0, z0, x1, z0 + D * .55] : side === 1 ? [x0 + W * .45, z0, x1, z1] : side === 2 ? [x0, z0 + D * .45, x1, z1] : [x0, z0, x1 - W * .45, z1];
    tower(tx0 + 2, tz0 + 2, tx1 - 2, tz1 - 2, CURB, h, 40);
    const [px0, pz0, px1, pz1] = side === 0 ? [x0, z0 + D * .55, x1, z1] : side === 1 ? [x0, z0, x0 + W * .45, z1] : side === 2 ? [x0, z0, x1, z0 + D * .45] : [x1 - W * .45, z0, x1, z1];
    for (let t = 0; t < 7; t++) M.trees.push({ x: px0 + 4 + r(50 + t) * (px1 - px0 - 8), z: pz0 + 4 + r(60 + t) * (pz1 - pz0 - 8), s: .75 + r(70 + t) * .4 });
    if (r(80) < .6) addBuilding(M, (px0 + px1) / 2 - 6, (pz0 + pz1) / 2 - 5, (px0 + px1) / 2 + 6, (pz0 + pz1) / 2 + 5, CURB, 5.5, 1, col(1, 81));
  }
}
// rows of bays, some of them taken
function parkingLot(M, x0, z0, x1, z1, s1, s2, room) {
  const bayW = 2.7, bayD = 5.4, aisle = 7;
  for (let rz = z0 + 1; rz + bayD * 2 + aisle <= z1; rz += bayD * 2 + aisle) {
    for (const [row, dir] of [[rz, 1], [rz + bayD + aisle + bayD, -1]]) {
      for (let x = x0 + 1; x + bayW <= x1 - 1; x += bayW) {
        M.marks.push({ ax: x, ay: .05, az: row, bx: x, by: .05, bz: row + dir * bayD, w: .12, c: 0 });
        if (hash(Math.round(x * 10), Math.round(row * 10), s1 * 7 + s2) < .42 && room()) {
          const bodies = ["sedan", "hatch", "suv", "sedan", "pickup", "van", "coupe", "suv"];
          const bi = Math.floor(hash(Math.round(x), Math.round(row), 3) * bodies.length);
          M.parked.push({ x: x + bayW / 2, z: row + dir * bayD / 2, yaw: dir > 0 ? Math.PI : 0, body: bodies[bi], ci: Math.floor(hash(Math.round(x), Math.round(row), 4) * 1e6) });
        }
      }
    }
  }
}
function addPillar(M, x, z, r, h) {
  const p = { x, z, r, y0: -1, y1: h, circle: true };
  M.pillars.push(p);
  M.wg.add(x - r, z - r, x + r, z + r, p);
}
// a post: solid for collisions, drawn by whatever it belongs to
function addPost(M, x, z, r, y0, y1) {
  const p = { x, z, r, y0, y1, circle: true };
  M.wg.add(x - r, z - r, x + r, z + r, p);
}
function addWall(M, ax, az, bx, bz, y0, y1) {
  const w = { ax, az, bx, bz, y0, y1 };
  M.walls.push(w);
  M.wg.add(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, w);
}
function addSurface(M, pts, hw, kind) {
  const s = { id: M.surfaces.length, pts, hw, kind };
  M.surfaces.push(s);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    M.sg.add(Math.min(a.x, b.x) - hw, Math.min(a.z, b.z) - hw, Math.max(a.x, b.x) + hw, Math.max(a.z, b.z) + hw, { a, b, ux: dx / L, uz: dz / L, L, hw, surf: s.id });
  }
  return s;
}

// ---------------------------------------------------------------- road markings
// Every line on the ground as a flat strip { a -> b, width, colour 0 white / 1 yellow }.
function buildMarks(M) {
  const mk = (ax, ay, az, bx, by, bz, w, c = 0) => M.marks.push({ ax, ay, az, bx, by, bz, w, c });
  const solid = (pts, w, c, skip) => { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (!skip || !skip(a, b)) mk(a.x, a.y, a.z, b.x, b.y, b.z, w, c); } };
  const dashed = (pts, on, off, w, c, skip) => {
    let ph = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      let s = 0;
      while (s < L - 1e-6) {
        const inOn = ph < on, step = Math.min(inOn ? on - ph : on + off - ph, L - s);
        if (inOn) {
          const t0 = s / L, t1 = (s + step) / L;
          const p = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0, z: a.z + (b.z - a.z) * t0 }, q = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1, z: a.z + (b.z - a.z) * t1 };
          if (!skip || !skip(p, q)) mk(p.x, p.y, p.z, q.x, q.y, q.z, w, c);
        }
        s += step; ph = (ph + step) % (on + off);
      }
    }
  };
  // streets: double yellow down the middle, dashed lane lines, stop lines, zebra crossings
  for (const r of M.roads) {
    const ax = r.a.x, az = r.a.z, bx = r.b.x, bz = r.b.z, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
    const s0 = SETBACK, s1 = L - SETBACK, P = (s, o) => [ax + ux * s + nx * o, az + uz * s + nz * o];
    for (const o of [-.2, .2]) { const [x0, z0] = P(s0, o), [x1, z1] = P(s1, o); mk(x0, 0, z0, x1, 0, z1, .12, 1); }
    for (const o of [-LANE, LANE]) { const [x0, z0] = P(s0, o), [x1, z1] = P(s1, o); dashed([{ x: x0, y: 0, z: z0 }, { x: x1, y: 0, z: z1 }], 3, 6, .12, 0); }
    // stop lines across the half of the road that arrives at each end
    { const [x0, z0] = P(s1 - .15, .35), [x1, z1] = P(s1 - .15, HALF - .2); mk(x0, 0, z0, x1, 0, z1, .45); }
    { const [x0, z0] = P(s0 + .15, -.35), [x1, z1] = P(s0 + .15, -HALF + .2); mk(x0, 0, z0, x1, 0, z1, .45); }
    // crossings at both ends
    for (const [sa, sb] of [[7.4, 10.4], [L - 10.4, L - 7.4]]) {
      for (let o = -HALF + .7; o <= HALF - .5; o += 1.2) { const [x0, z0] = P(sa, o), [x1, z1] = P(sb, o); mk(x0, 0, z0, x1, 0, z1, .6); }
    }
  }
  // the ring: yellow by the median, dashed lane lines, a white edge that breaks into dashes where a
  // ramp joins or leaves
  const C = M.ring, deckId = 0;
  const offRamp = (p, q, side) => { const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1; return surfaceAt(M, mx - dz / L * side * 1.4, mz + dx / L * side * 1.4, DECK_Y + .5, deckId) > DECK_Y - 1; };
  for (const side of [1, -1]) {
    solid(offsetPts(C, side * 2, true), .14, 1);
    for (const o of [5.6, 9.2]) dashed(offsetPts(C, side * o, true), 3, 9, .13, 0);
    const edge = offsetPts(C, side * 12.8, true);
    solid(edge, .16, 0, (p, q) => offRamp(p, q, side));
    dashed(edge, 1.2, 2, .3, 0, (p, q) => !offRamp(p, q, side));
  }
  // ramps: edge lines, except where they lie on the ring or the avenue
  const onRoad = (p) => Math.min(Math.abs(p.x), Math.abs(p.z)) < HALF + .3 && Math.max(Math.abs(p.x), Math.abs(p.z)) > DOWN;
  for (const r of M.ramps) for (const s of [-1, 1]) {
    solid(offsetPts(r.pts, s * (RAMP_HW - .5)), .14, 0, (p, q) => onRoad(p) || onRoad(q) || surfaceAt(M, p.x, p.z, p.y + .5, r.surf.id) > p.y - .8);
  }
}

// ---------------------------------------------------------------- queries
// the highest drivable surface at (x, z) that a car at height yRef could be standing on: an elevated
// deck or ramp within a step of it, else the ground (curbs included)
export function groundAt(M, x, z) {
  let h = 0;
  for (const s of M.slg.query(x, z, 0, _q)) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.h > h) h = s.h;
  return h;
}
const _q = [], _q2 = [];
// pad widens every ribbon a touch, so a car never drops through the seam where a ramp peels off
export function surfaceAt(M, x, z, yRef, skip = -1, pad = .5) {
  let best = -Infinity;
  for (const g of M.sg.query(x, z, pad, _q2)) {
    if (g.surf === skip) continue;
    const t = Math.max(0, Math.min(g.L, (x - g.a.x) * g.ux + (z - g.a.z) * g.uz));
    const px = g.a.x + g.ux * t, pz = g.a.z + g.uz * t;
    if ((x - px) ** 2 + (z - pz) ** 2 > (g.hw + pad) ** 2) continue;
    const y = g.a.y + (g.b.y - g.a.y) * (t / g.L);
    if (y <= yRef + 1.2 && y > best) best = y;
  }
  return best;
}
export function heightAt(M, x, z, yRef) {
  return Math.max(groundAt(M, x, z), surfaceAt(M, x, z, yRef));
}
// Push a circle (a slice of a car, at height y) out of everything solid. Returns the push and the
// normal of the deepest contact in res, or false when it touched nothing.
const _w = [], _b = [];
export function pushCircle(M, x, z, y, r, res) {
  res.x = 0; res.z = 0; res.nx = 0; res.nz = 0; res.d = 0;
  let hit = false;
  const top = y + 1.3;
  const take = (px, pz, d) => { res.x += px * d; res.z += pz * d; if (d > res.d) { res.d = d; res.nx = px; res.nz = pz; } hit = true; };
  for (const w of M.wg.query(x, z, r + 1, _w)) {
    if (top < w.y0 || y > w.y1) continue;
    if (w.circle) {
      const dx = x + res.x - w.x, dz = z + res.z - w.z, d = Math.hypot(dx, dz), m = r + w.r;
      if (d < m && d > 1e-6) take(dx / d, dz / d, m - d);
      continue;
    }
    const ex = w.bx - w.ax, ez = w.bz - w.az, L2 = ex * ex + ez * ez || 1;
    const cx = x + res.x, cz = z + res.z;
    const t = Math.max(0, Math.min(1, ((cx - w.ax) * ex + (cz - w.az) * ez) / L2));
    const dx = cx - (w.ax + ex * t), dz = cz - (w.az + ez * t), d = Math.hypot(dx, dz), m = r + .25;
    if (d < m && d > 1e-6) take(dx / d, dz / d, m - d);
  }
  for (const b of M.bg.query(x, z, r + 1, _b)) {
    if (top < b.y0 || y > b.y1) continue;
    const cx = x + res.x, cz = z + res.z;
    const qx = Math.max(b.x0, Math.min(b.x1, cx)), qz = Math.max(b.z0, Math.min(b.z1, cz));
    const dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
    if (d > 1e-6) { if (d < r) take(dx / d, dz / d, r - d); continue; }
    // centre inside the box: out through the nearest face
    const f = [[cx - b.x0, -1, 0], [b.x1 - cx, 1, 0], [cz - b.z0, 0, -1], [b.z1 - cz, 0, 1]].sort((p, q) => p[0] - q[0])[0];
    take(f[1], f[2], f[0] + r);
  }
  return hit;
}
// is (x, y, z) inside a building? (for keeping the chase camera out of walls)
export function insideSolid(M, x, y, z) {
  for (const b of M.bg.query(x, z, 0, _b)) if (x > b.x0 - .3 && x < b.x1 + .3 && z > b.z0 - .3 && z < b.z1 + .3 && y < b.y1 + .3) return true;
  return false;
}
// what part of the map this is, for the HUD
export function districtAt(x, z, y) {
  if (y > 3) return "RING EXPRESSWAY";
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m < DOWN + 12) return Math.hypot(x, z) < 160 ? "DOWNTOWN · FINANCIAL DISTRICT" : "DOWNTOWN";
  if (Math.abs(ringSD(x, z)) < DECK_HW + 2) return "UNDER THE RING";
  if (m < RING) return "MIDTOWN";
  if (m < BLVD + 12) return Math.min(Math.abs(x), Math.abs(z)) < 12 ? "AVENUE" : "WAREHOUSE DISTRICT";
  return "OUTER BOULEVARD";
}

// ---------------------------------------------------------------- traffic
// Local to each client: cars follow the lanes, keep their distance (an intelligent-driver model),
// stop for red lights, zip-merge where two lanes become one, and wait - then lean on the horn - when
// a player is sitting in front of them. Cars are only kept near the player.
export const CITY_BODIES = ["sedan", "sedan", "hatch", "suv", "suv", "pickup", "van", "coupe", "sedan", "hatch", "suv", "m340i", "q50", "x5m", "charger", "golfr", "sedan", "bus", "truck", "muscle"];
export const CITY_COLORS = [0xf2f2f2, 0x1d1f24, 0x9aa1aa, 0xc62828, 0x1e5bd8, 0x2e7d4f, 0x5b6f86, 0xd8cbb0, 0x7a1f2b, 0x3a3d44, 0xe8e6e0, 0x6d737c];
const TAXI = 0xf2c230;
const IDM = { a: 2.1, b: 3.2, s0: 2.4, th: 1.1 };
const _p = {};

export class CityTraffic {
  constructor(M, sizes) {
    this.M = M; this.sizes = sizes;          // sizes: body -> { L, W }
    this.cars = []; this.target = 50; this.nid = 1;
    this.spawnable = M.links.filter((l) => l.kind !== "conn" && l.len > 18);
    this.near = []; this.nearT = 0;
  }
  clear() { for (const c of this.cars) this.drop(c); this.cars.length = 0; }
  drop(c) { const a = c.link.cars, i = a.indexOf(c); if (i >= 0) a.splice(i, 1); c.dead = true; }
  choose(l) {
    const n = l.next;
    if (!n.length) return null;
    if (n.length === 1) return n[0];
    let tot = 0;
    const w = n.map((x) => { const v = x.kind === "conn" ? (x.turn === "S" ? 3 : 1.1) : x.kind === "ramp" && l.kind === "hwy" ? .7 : x.kind === "ramp" ? .8 : 2.4; tot += v; return v; });
    let r = Math.random() * tot;
    for (let i = 0; i < n.length; i++) if ((r -= w[i]) <= 0) return n[i];
    return n[n.length - 1];
  }
  spawnAt(l, s, v) {
    const body = CITY_BODIES[Math.floor(Math.random() * CITY_BODIES.length)];
    if ((body === "bus" || body === "truck") && l.kind === "ramp") return null;
    const sz = this.sizes[body] || { L: 4.6, W: 1.9 };
    if (l.cars.some((o) => Math.abs(o.s - s) < (o.L + sz.L) / 2 + 9)) return null;
    const color = body === "sedan" && Math.random() < .3 ? TAXI : body === "bus" ? 0xe8e6e0 : CITY_COLORS[Math.floor(Math.random() * CITY_COLORS.length)];
    const c = { id: this.nid++, link: l, s, v, L: sz.L, W: sz.W, body, color, k: .88 + Math.random() * .24, next: null, next2: null, acc: 0,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, sig: 0, stopT: 0, honkT: 0, playerBlock: false, bump: null, mesh: null };
    c.next = this.choose(l); c.next2 = c.next ? this.choose(c.next) : null;
    l.cars.push(c); this.cars.push(c);
    this.pose(c);
    return c;
  }
  // Keep about `target` cars within reach of the focus. initial: fill right up to it. Otherwise new cars
  // appear out of sight - behind the camera (focus.fx/fz is where it looks), or far enough off that
  // the haze hides them arriving.
  populate(focus, initial = false) {
    const R = 290;
    for (const c of this.cars) if (!c.dead && (c.x - focus.x) ** 2 + (c.z - focus.z) ** 2 > (R + 40) ** 2) this.drop(c);
    if (this.cars.some((c) => c.dead)) this.cars = this.cars.filter((c) => !c.dead);
    if ((this.nearT -= 1) <= 0 || initial) {
      this.nearT = 20;
      this.near = this.spawnable.filter((l) => l.bb.x1 > focus.x - R && l.bb.x0 < focus.x + R && l.bb.z1 > focus.z - R && l.bb.z0 < focus.z + R);
      // expressway cars leave the area fast, and matter most when you are up there with them
      const up = focus.y > 3;
      this.nearW = this.near.map((l) => l.len * (l.kind === "hwy" ? (up ? 5 : 1.6) : l.kind === "ramp" ? (up ? 2 : 1.2) : 1));
      this.nearLen = this.nearW.reduce((a, w) => a + w, 0);
    }
    if (!this.near.length) return;
    let tries = initial ? this.target * 30 : 10;
    while (tries-- > 0 && this.cars.length < this.target) {
      let r = Math.random() * this.nearLen, l = this.near[0];
      for (let i = 0; i < this.near.length; i++) { if ((r -= this.nearW[i]) <= 0) { l = this.near[i]; break; } }
      const s = 6 + Math.random() * Math.max(1, l.len - 12);
      sampleLink(l, s, _p);
      const d = Math.hypot(_p.x - focus.x, _p.y - focus.y, _p.z - focus.z);
      if (d > R || d < (initial ? 24 : 110)) continue;
      if (!initial && d < 230 && focus.fx !== undefined && ((_p.x - focus.x) * focus.fx + (_p.z - focus.z) * focus.fz) / d > -.2) continue;
      this.spawnAt(l, s, l.speed * (.6 + Math.random() * .3));
    }
  }
  pose(c) {
    sampleLink(c.link, c.s, _p);
    c.x = _p.x; c.y = _p.y; c.z = _p.z; c.hx = _p.hx; c.hz = _p.hz;
    c.yaw = Math.atan2(-_p.hx, -_p.hz);
    c.pitch = Math.atan(_p.grade);
  }
  // players: [{ x, y, z, vx, vz, L, W }]. Returns horn events.
  step(dt, T, players, focus) {
    const ev = [];
    if (dt <= 0) return ev;
    this.populate(focus);
    for (const c of this.cars) {
      const l = c.link;
      if (c.honkT > 0) c.honkT -= dt;
      // ---- how far is it to whatever I must not hit, and how fast is that going ----
      let gap = 1e9, lv = 0, block = false;
      const rest = l.len - c.s;
      for (const o of l.cars) if (o !== c && o.s > c.s) { const g = o.s - c.s - (o.L + c.L) / 2; if (g < gap) { gap = g; lv = o.v; } }
      const n = c.next;
      if (n && gap > rest) {
        for (const o of n.cars) { const g = rest + o.s - (o.L + c.L) / 2; if (g < gap) { gap = g; lv = o.v; } }
        if (c.next2 && gap > rest + n.len) for (const o of c.next2.cars) { const g = rest + n.len + o.s - (o.L + c.L) / 2; if (g < gap) { gap = g; lv = o.v; } }
        // two lanes becoming one: whoever is nearer the join goes first
        if (n.prev.length > 1 && rest < 70) for (const p of n.prev) {
          if (p === l) continue;
          for (const o of p.cars) {
            const ro = p.len - o.s;
            if (ro < rest - .01 || (Math.abs(ro - rest) <= .01 && o.id < c.id)) { const g = rest - ro - (o.L + c.L) / 2 - 1.5; if (g < gap) { gap = g; lv = o.v; } }
          }
        }
      }
      // the stop line
      const front = rest - c.L / 2;
      if (l.stop && n && n.sig && front > -.5) {
        const st = signalAt(n.sig.n, n.sig.axis, n.sig.left, T);
        if (st === 2 || (st === 1 && front > (c.v * c.v) / (2 * 3.6))) { const g = front - .4; if (g < gap) { gap = g; lv = 0; } }
      }
      // don't pull into a junction there is no room to leave
      if (n && n.kind === "conn" && front > -.5 && front < 25 && c.next2) {
        for (const o of c.next2.cars) if (o.s < o.L / 2 + c.L + 2 && o.v < 2.5) { const g = front - .4; if (g < gap) { gap = g; lv = 0; } break; }
      }
      // players ahead, near my line
      for (const p of players) {
        const rx = p.x - c.x, rz = p.z - c.z, along = rx * c.hx + rz * c.hz, lat = rx * -c.hz + rz * c.hx;
        if (along <= 0 || along > 46 || Math.abs(lat) > (c.W + p.W) / 2 + .5 || Math.abs(p.y - c.y) > 2.5) continue;
        const g = along - (c.L + p.L) / 2;
        if (g < gap) { gap = g; lv = Math.max(0, p.vx * c.hx + p.vz * c.hz); block = true; }
      }
      // ---- intelligent driver ----
      let v0 = l.speed * c.k;
      if (n) v0 = Math.min(v0, Math.sqrt(n.speed * n.speed * c.k * c.k + 2 * 2.4 * Math.max(0, rest - 2)));
      let a;
      if (c.bump && c.bump.hold > 0) { a = -12; c.bump.hold -= dt; }
      else {
        const ss = IDM.s0 + Math.max(0, c.v * IDM.th + (c.v * (c.v - lv)) / (2 * Math.sqrt(IDM.a * IDM.b)));
        a = IDM.a * (1 - Math.pow(Math.max(0, c.v) / Math.max(1, v0), 4) - (gap < 1e8 ? (ss / Math.max(.2, gap)) ** 2 : 0));
        if (gap < .3) a = Math.min(a, -9);
      }
      a = Math.max(-9, Math.min(IDM.a, a));
      c.acc = a;
      c.v = Math.max(0, c.v + a * dt);
      c.s += c.v * dt;
      // ---- honking at a player who won't move ----
      c.playerBlock = block;
      if (block && c.v < .4 && gap < 14) {
        c.stopT += dt;
        if (c.stopT > 2.2 && c.honkT <= 0) { c.honkT = 2.4 + Math.random() * 2.6; ev.push({ c, heavy: c.body === "bus" || c.body === "truck" }); }
      } else c.stopT = Math.max(0, c.stopT - dt * 2);
      // ---- on to the next lane ----
      while (c.s > c.link.len) {
        if (!c.next) { this.drop(c); break; }
        c.s -= c.link.len;
        const a2 = c.link.cars; a2.splice(a2.indexOf(c), 1);
        c.link = c.next; c.link.cars.push(c);
        c.next = c.next2; c.next2 = c.next ? this.choose(c.next) : null;
      }
      if (c.dead) continue;
      this.pose(c);
      // indicators: a turn coming up, or leaving / joining the expressway
      const nn = c.next;
      c.sig = c.link.kind === "conn" && c.link.turn !== "S" ? (c.link.turn === "L" ? -1 : 1)
        : nn && nn.kind === "conn" && nn.turn !== "S" && c.link.len - c.s < 45 ? (nn.turn === "L" ? -1 : 1)
          : nn && nn.kind === "ramp" && c.link.kind === "hwy" && c.link.len - c.s < 160 ? 1
            : c.link.kind === "ramp" && nn && nn.kind === "hwy" ? -1 : 0;
      // a shove from a player: pushed off its line, then eases back onto it
      if (c.bump) {
        const b = c.bump;
        b.t += dt; b.vx *= Math.exp(-dt * 3); b.vz *= Math.exp(-dt * 3); b.vr *= Math.exp(-dt * 3);
        b.dx += b.vx * dt; b.dz += b.vz * dt; b.r += b.vr * dt;
        if (b.hold <= 0) { const k = Math.exp(-dt * 1.4); b.dx *= k; b.dz *= k; b.r *= k; }
        if (b.hold <= 0 && Math.abs(b.dx) + Math.abs(b.dz) + Math.abs(b.r) < .02) c.bump = null;
        else { c.x += b.dx; c.z += b.dz; c.yaw += b.r; }
      }
    }
    if (this.cars.some((c) => c.dead)) this.cars = this.cars.filter((c) => !c.dead);
    return ev;
  }
  // a player hit this car: knock it along (ix, iz) at speed sp
  shove(c, ix, iz, sp) {
    const b = c.bump || (c.bump = { t: 0, dx: 0, dz: 0, r: 0, vx: 0, vz: 0, vr: 0, hold: 0 });
    const k = Math.min(3.5, sp * .3);
    b.vx += ix * k; b.vz += iz * k; b.vr += (Math.random() - .5) * Math.min(1.2, sp * .06);
    b.hold = Math.max(b.hold, 1.2 + Math.min(2.5, sp * .12));
    c.v *= .3;
  }
}
