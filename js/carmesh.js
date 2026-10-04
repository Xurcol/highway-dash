// Smooth lofted car bodies. The side outline (B.up) and greenhouse outline (B.glass) of each body
// are sampled at stations along the car; at each station a rounded cross-section is swept so the
// body gets curved sides, rounded shoulders, a crowned hood/roof and flared fenders.
// Shape frame: +x front, y up, z width (callers rotate into world space).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ---------- outline queries ----------
export function outline(B) {
  const pts = B.up.map((p) => [p[0], p[1]]);
  return pts; // closed implicitly from last (rear bottom) back to first (front bottom)
}
function crossV(poly, x) { // y values where the closed polygon crosses the vertical line x
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    if ((x0 <= x && x1 > x) || (x1 <= x && x0 > x)) ys.push(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  }
  return ys;
}
function crossH(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
  }
  return xs;
}
export const frontAt = (B, y) => Math.max(...crossH(outline(B), y), -99);
export const rearAt = (B, y) => Math.min(...crossH(outline(B), y), 99);
export function bodySpan(B, x) {
  const ys = crossV(outline(B), x);
  if (ys.length < 2) return null;
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const R = B.r + .08;
  for (const w of B.wheels) {
    const dx = Math.abs(x - w);
    if (dx < R) {
      const arch = B.r + Math.sqrt(R * R - dx * dx);
      lo = Math.max(lo, arch);
      hi = Math.max(hi, arch + .07); // fender always clears the tyre
    }
  }
  return [lo, hi];
}
export const bodyTop = (B, x) => (bodySpan(B, x) || [0, B.bottom])[1];
function glassSpan(B, x) {
  const ys = crossV(B.glass, x);
  return ys.length < 2 ? null : Math.max(...ys);
}

function stations(lo, hi, n, extra) {
  const xs = new Set();
  for (let i = 0; i < n; i++) xs.add(+(lo + (hi - lo) * (.5 - .5 * Math.cos((Math.PI * i) / (n - 1)))).toFixed(4));
  for (const x of extra) if (x > lo && x < hi) xs.add(+x.toFixed(4));
  return [...xs].sort((a, b) => a - b);
}

// ---------- lower body ----------
// right-half cross-section from bottom centre to top centre: [z fraction of half width, height fraction, crown weight]
// widest at the shoulder line; sharp creases between bands (rocker | side | upper surfaces)
const SIDE_HI = [[0, 0, 0], [.8, 0, 0], [.92, .04, 0], [.97, .14, 0], [.99, .3, 0], [1, .5, 0],
  [.998, .68, 0], [.99, .84, 0], [.976, .93, 0], [.952, .972, 0], [.9, .993, .1],
  [.7, 1, .45], [.35, 1, .85], [0, 1, 1]];
const BANDS_HI = [[0, 2], [2, 5], [5, 9], [9, 13]];
const SIDE_LO = [[0, 0, 0], [.84, 0, 0], [.96, .12, 0], [1, .5, 0], [.985, .88, 0], [.93, .985, 0], [.55, 1, .6], [0, 1, 1]];
const BANDS_LO = [[0, 2], [2, 3], [3, 5], [5, 7]];
const SIDE_BOX = [[0, 0, 0], [.94, 0, 0], [1, .06, 0], [1, .55, 0], [.995, .9, 0], [.95, .98, 0], [.5, 1, .2], [0, 1, .3]];
const BANDS_BOX = [[0, 2], [2, 4], [4, 5], [5, 7]];

function strip(rows, ring, a, b, sgn) {
  const pos = [], idx = [], n = b - a + 1;
  for (const row of rows) for (let i = a; i <= b; i++) pos.push(row[i][0], row[i][1], row[i][2] * sgn);
  for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < n - 1; i++) {
    const p0 = r * n + i, p1 = p0 + 1, p2 = p0 + n, p3 = p1 + n;
    if (sgn > 0) idx.push(p0, p2, p1, p1, p2, p3); else idx.push(p0, p1, p2, p1, p3, p2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}
function cap(row, front) {
  const ring = [...row, ...row.slice(1, -1).reverse().map(([x, y, z]) => [x, y, -z])];
  const pos = [];
  let cy = 0; for (const p of ring) cy += p[1]; cy /= ring.length;
  const cx = row[0][0];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (front) pos.push(cx, cy, 0, q[0], q[1], q[2], p[0], p[1], p[2]);
    else pos.push(cx, cy, 0, p[0], p[1], p[2], q[0], q[1], q[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function loftBody(B, tf, detailed) {
  const poly = outline(B);
  const xs0 = Math.min(...poly.map((p) => p[0])), xs1 = Math.max(...poly.map((p) => p[0]));
  const R = B.r + .08, extra = [];
  for (const w of B.wheels) { extra.push(w - R - .001, w - R + .001, w + R - .001, w + R + .001); for (let k = -8; k <= 8; k++) extra.push(w + (k / 8) * R * .99); }
  for (const p of poly) extra.push(p[0] - .003, p[0] + .003);
  const X = stations(xs0 + .003, xs1 - .003, detailed ? 64 : 26, extra);
  const side = B.boxy ? SIDE_BOX : detailed ? SIDE_HI : SIDE_LO;
  const bands = B.boxy ? BANDS_BOX : detailed ? BANDS_HI : BANDS_LO;
  const crown = B.crown ?? .015;
  const rows = [];
  for (const x of X) {
    const span = bodySpan(B, x);
    if (!span || span[1] - span[0] < .004) continue;
    const [yb, yt] = span, hgt = yt - yb;
    rows.push(side.map(([zn, yn, cw]) => {
      const y = yb + yn * hgt + cw * crown * Math.min(1, hgt * 2.5);
      return [x, y, zn * (B.W / 2) * tf(x, y)];
    }));
  }
  const parts = [];
  for (const sgn of [1, -1]) for (const [a, b] of bands) parts.push(strip(rows, side, a, b, sgn));
  parts.push(cap(rows[0], false), cap(rows[rows.length - 1], true));
  return mergeGeometries(parts);
}
// make sure triangles face outwards (normal points away from the car's centre line)
function fixWinding(g) {
  const p = g.attributes.position, ix = g.index.array;
  let score = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 30) {
    a.fromBufferAttribute(p, ix[t]); b.fromBufferAttribute(p, ix[t + 1]); c.fromBufferAttribute(p, ix[t + 2]);
    n.subVectors(c, b).cross(a.clone().sub(b));
    const center = a.clone().add(b).add(c).divideScalar(3);
    score += n.dot(new THREE.Vector3(0, center.y - .6, center.z));
  }
  if (score < 0) { for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; } g.computeVertexNormals(); }
  return g;
}

// ---------- greenhouse: glass, pillars, roof, seals ----------
// ring (right half): [widthLerp (0 = base width, 1 = roof-edge width, >1 = toward centre), height fraction, crown]
const GH = [[0, 0, 0], [.02, .075, 0], [.4, .5, 0], [.78, .86, 0], [1, .965, 0], [1.25, 1, .006], [1.62, 1, .014], [2, 1, .018]];
export function loftGreenhouse(B, tf, detailed, opts) {
  const gx = B.glass.map((p) => p[0]);
  const g0 = Math.min(...gx), g1 = Math.max(...gx);
  const top = Math.max(...B.glass.map((p) => p[1]));
  const roofPts = B.glass.filter((p) => p[1] > top - .03).map((p) => p[0]);
  const rf = B.roof ? Math.max(B.roof[0], B.roof[1]) : Math.max(...roofPts);
  const rr = B.roof ? Math.min(B.roof[0], B.roof[1]) : Math.min(...roofPts);
  const X = stations(g0 + .003, g1 - .003, detailed ? 30 : 14, [rf, rf - .01, rr, rr + .01]);
  const ring = [...GH, ...GH.slice(0, -1).reverse().map(([a, y, c]) => [a, y, c, -1])];
  const RN = ring.length;
  const four = opts.doors === 4;
  const bX = rf - (rf - rr) * (B.style === "suv" || B.style === "wagon" ? .4 : .47);
  const tumble = .2 + B.taper[0] * .25;
  const pos = [], rowsX = [];
  for (const x of X) {
    const roofY = glassSpan(B, x);
    if (roofY === null) continue;
    const base = bodyTop(B, x) - .015;
    const hgt = Math.max(.001, roofY - base);
    const hb = (B.W / 2) * tf(x, base) * .955, ht = hb * (1 - tumble);
    for (const [a, yn, crown, s = 1] of ring) {
      const z = a <= 1 ? hb + (ht - hb) * a : ht * (2 - a);
      pos.push(x, base + yn * hgt + crown * Math.min(1, hgt * 3), s * z);
    }
    rowsX.push(x);
  }
  const cls = { glass: [], body: [], trim: [] };
  const n = GH.length - 1; // segments per side
  for (let r = 0; r < rowsX.length - 1; r++) {
    const xm = (rowsX[r] + rowsX[r + 1]) / 2;
    const zone = xm > rf ? "front" : xm < rr ? "rear" : "roof";
    for (let i = 0; i < RN - 1; i++) {
      const seg = i < n ? i : RN - 2 - i; // mirrored segment index
      let c;
      if (seg === 0) c = "trim";
      else if (seg >= 5) c = zone === "roof" ? "body" : "glass";
      else if (seg === 4) c = "body";
      else if (seg === 3) c = zone === "roof" ? "trim" : "body";
      else { // side window
        if (zone === "roof") c = four && Math.abs(xm - bX) < .045 ? "trim" : "glass";
        else if (zone === "front") c = "glass";
        else c = (B.style === "suv" || B.style === "wagon") ? (xm < g0 + .12 ? "body" : "glass") : (xm > rr - (rr - g0) * .4 ? "glass" : "body");
      }
      const a = r * RN + i, b = a + 1, cc = a + RN, d = b + RN;
      cls[c].push(a, cc, b, b, cc, d);
    }
  }
  const all = [...cls.glass, ...cls.body, ...cls.trim];
  const full = new THREE.BufferGeometry();
  full.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  full.setIndex(all);
  full.computeVertexNormals();
  fixWinding(full);
  const out = {};
  let off = 0;
  for (const k of ["glass", "body", "trim"]) {
    const g = full.clone();
    g.setIndex(Array.from(full.index.array.slice(off, off + cls[k].length)));
    off += cls[k].length;
    out[k] = g.index.count ? g.toNonIndexed() : null;
  }
  out.rf = rf; out.rr = rr; out.g0 = g0; out.g1 = g1; out.bX = bX;
  return out;
}

// ---------- wheels ----------
export function tireGeo(r, detailed) {
  const w = .15, pts = [[r * .72, -w], [r * .9, -w - .006], [r * .975, -w + .02], [r, -w + .06], [r * 1.004, 0], [r, w - .06], [r * .975, w - .02], [r * .9, w + .006], [r * .72, w]];
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), detailed ? 28 : 12);
  g.rotateX(Math.PI / 2);
  return g;
}

// soft contact shadow under each car
let shadowTex = null;
export function contactShadow(L, W) {
  if (!shadowTex) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grd.addColorStop(0, "rgba(0,0,0,.85)"); grd.addColorStop(.55, "rgba(0,0,0,.5)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.35, L * 1.12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: .7, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.y = .015; m.renderOrder = 1;
  return m;
}
