// Hero mode: the character. One skinned mesh per person (a single draw call), built from smooth
// lathed limbs, a sculpted torso and head, bound rigidly to a 20-bone skeleton with soft blends at the
// joints. The suit is painted in the shader from each vertex's place on the body (which part, how far
// round it, how far along it), so every suit is just a set of colours and a pattern style: stripes
// down the limbs, a chest emblem, glowing lenses, and the wrist emitters the lines come out of.
//
// Animation is procedural: every frame a pose is worked out for the current movement state (a run
// cycle from the stride phase, the arm that holds a swing line pointed at its anchor, a tuck for a
// flip, a punch from the attack's timeline...) and every bone eases towards it, so one state flows
// into the next without any canned transitions.
import * as THREE from "three";
import { patchLit } from "./lights.js";

const V = THREE.Vector3, Q = THREE.Quaternion, E = THREE.Euler;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ skeleton (rest pose, metres)
// Model space: +Y up, +Z forward, +X the character's left. Arms hang straight down, legs straight.
export const BONES = [
  ["root", null, 0, 0, 0],
  ["hips", "root", 0, .98, 0],
  ["spine", "hips", 0, .11, 0],
  ["chest", "spine", 0, .17, 0],
  ["neck", "chest", 0, .235, -.005],
  ["head", "neck", 0, .085, .01],
  ["armL", "chest", .205, .175, -.01],
  ["foreL", "armL", 0, -.29, 0],
  ["handL", "foreL", 0, -.26, 0],
  ["armR", "chest", -.205, .175, -.01],
  ["foreR", "armR", 0, -.29, 0],
  ["handR", "foreR", 0, -.26, 0],
  ["thighL", "hips", .098, -.055, 0],
  ["shinL", "thighL", 0, -.445, 0],
  ["footL", "shinL", 0, -.43, -.01],
  ["thighR", "hips", -.098, -.055, 0],
  ["shinR", "thighR", 0, -.445, 0],
  ["footR", "shinR", 0, -.43, -.01],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const HIP_H = .98;

// part ids, read by the suit shader
const PART = { chest: 0, abdomen: 1, pelvis: 2, head: 3, upperArm: 4, forearm: 5, hand: 6, thigh: 7, shin: 8, foot: 9, neck: 10, delt: 11 };

// A lathed limb along +Y from 0 to len (then placed by m): radius r(v) between two rounded ends,
// an elliptical section (sx across, sz front-to-back). Writes position, a normal, and per vertex
// (part, u round the limb with .5 at the front, v along it, side) for the suit.
function tube(out, o) {
  const { len, r, sx = 1, sz = 1, part, bone, parent = -1, side = 0, segU = 16, segV = 14, m, blend = .18, capA = true, capB = true } = o;
  const r0 = r(0), r1 = r(1), y0 = capA ? -r0 * .9 : 0, y1 = capB ? len + r1 * .9 : len;
  const base = out.pos.length / 3, rings = segV + 1;
  for (let j = 0; j < rings; j++) {
    const t = j / segV, y = y0 + (y1 - y0) * t;
    let rad;
    if (y < 0) rad = r0 * Math.sqrt(Math.max(0, 1 - (y / (r0 * .9)) ** 2));
    else if (y > len) rad = r1 * Math.sqrt(Math.max(0, 1 - ((y - len) / (r1 * .9)) ** 2));
    else rad = r(y / len);
    const vAlong = Math.min(1, Math.max(0, y / len));
    for (let i = 0; i <= segU; i++) {
      const a = (i / segU) * Math.PI * 2;
      // u: .5 at the front (+z), 0/1 at the back
      const px = Math.sin(a) * rad * sx, pz = -Math.cos(a) * rad * sz;
      _v.set(px, y, pz).applyMatrix4(m);
      out.pos.push(_v.x, _v.y, _v.z);
      out.suit.push(part, i / segU, vAlong, side);
      // rigid to its bone, eased into the parent near the joint for a smoother bend
      const w = parent >= 0 && blend > 0 ? Math.max(0, 1 - Math.max(0, y) / (len * blend)) * .5 : 0;
      out.si.push(bone, parent >= 0 ? parent : 0, 0, 0);
      out.sw.push(1 - w, w, 0, 0);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = base + j * (segU + 1) + i, b = a + segU + 1;
    out.idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
}
// an ellipsoid (head, deltoids, the hands' fists)
function blob(out, o) {
  const { rx, ry, rz, part, bone, side = 0, segU = 20, segV = 14, m, shape } = o;
  const base = out.pos.length / 3;
  for (let j = 0; j <= segV; j++) {
    const th = (j / segV) * Math.PI, sy = Math.cos(th), sr = Math.sin(th);
    for (let i = 0; i <= segU; i++) {
      const a = (i / segU) * Math.PI * 2;
      let x = Math.sin(a) * sr * rx, y = sy * ry, z = -Math.cos(a) * sr * rz;
      if (shape) [x, y, z] = shape(x, y, z, i / segU, 1 - j / segV);
      _v.set(x, y, z).applyMatrix4(m);
      out.pos.push(_v.x, _v.y, _v.z);
      out.suit.push(part, i / segU, 1 - j / segV, side);
      out.si.push(bone, 0, 0, 0); out.sw.push(1, 0, 0, 0);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = base + j * (segU + 1) + i, b = a + segU + 1;
    out.idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
}
const _v = new V(), _m = new THREE.Matrix4();

// the body's geometry in the bind pose (built once, shared by every hero on screen)
let SHARED = null;
function bodyGeometry() {
  if (SHARED) return SHARED;
  // rest-pose world positions of every bone
  const wp = BONES.map(() => new V());
  BONES.forEach(([n, par, x, y, z], i) => { wp[i].set(x, y, z); if (par) wp[i].add(wp[BI[par]]); });
  const out = { pos: [], suit: [], si: [], sw: [], idx: [] };
  const at = (bone, dx = 0, dy = 0, dz = 0, rot = null) => {
    _m.identity();
    if (rot) _m.makeRotationFromEuler(rot);
    _m.setPosition(wp[BI[bone]].x + dx, wp[BI[bone]].y + dy, wp[BI[bone]].z + dz);
    return _m.clone();
  };
  const down = new E(Math.PI, 0, 0);            // a limb that runs down -Y from its joint
  const smooth = (a, b, bulge = 0, at2 = .35) => (v) => a + (b - a) * v + bulge * Math.sin(Math.PI * Math.min(1, v / (at2 * 2))) * (v < at2 * 2 ? 1 : 0);
  // torso: pelvis, abdomen, chest - wide across, flatter front to back, a V from the lats to the waist
  tube(out, { len: .2, r: (v) => .118 + .012 * Math.sin(Math.PI * v), sx: 1.24, sz: .86, part: PART.pelvis, bone: BI.hips, m: at("hips", 0, -.09, .005), segV: 8, blend: 0 });
  tube(out, { len: .2, r: (v) => .108 + .012 * v, sx: 1.18, sz: .8, part: PART.abdomen, bone: BI.spine, parent: BI.hips, m: at("spine", 0, -.03, .008), segV: 8, blend: .35 });
  tube(out, { len: .25, r: (v) => .125 + .05 * Math.sin(Math.PI * Math.min(1, v * .95 + .02)) ** .7 - .028 * Math.max(0, v - .75) * 4, sx: 1.34, sz: .74, part: PART.chest, bone: BI.chest, parent: BI.spine, m: at("chest", 0, -.02, .006), segV: 12, blend: .2 });
  tube(out, { len: .1, r: () => .052, part: PART.neck, bone: BI.neck, parent: BI.chest, m: at("neck", 0, -.03, 0), segV: 5, blend: .4 });
  // head: a slightly egg-shaped mask, the jaw narrowed
  blob(out, { rx: .094, ry: .118, rz: .108, part: PART.head, bone: BI.head, m: at("head", 0, .1, .012), shape: (x, y, z) => { const k = y < 0 ? 1 - Math.min(.28, -y * 2.2) : 1; return [x * k, y, z * (y < -.02 ? .94 : 1) + (y < 0 ? .006 : 0)]; } });
  for (const [s, L] of [[1, "L"], [-1, "R"]]) {
    blob(out, { rx: .066, ry: .07, rz: .068, part: PART.delt, bone: BI["arm" + L], side: s, m: at("arm" + L, s * .012, -.012, 0), segU: 14, segV: 10 });
    tube(out, { len: .29, r: smooth(.053, .041, .012), sx: 1, sz: 1.05, part: PART.upperArm, bone: BI["arm" + L], parent: BI.chest, side: s, m: at("arm" + L, 0, 0, 0, down), blend: .12 });
    tube(out, { len: .26, r: smooth(.045, .033, .01, .3), sx: 1.05, sz: .95, part: PART.forearm, bone: BI["fore" + L], parent: BI["arm" + L], side: s, m: at("fore" + L, 0, 0, 0, down), blend: .2 });
    tube(out, { len: .085, r: (v) => .036 + .008 * Math.sin(Math.PI * v), sx: .62, sz: 1.2, part: PART.hand, bone: BI["hand" + L], parent: BI["fore" + L], side: s, m: at("hand" + L, 0, .005, .004, down), segU: 12, segV: 6, blend: .3 });
    tube(out, { len: .445, r: smooth(.088, .056, .014, .3), sx: 1.02, sz: 1.06, part: PART.thigh, bone: BI["thigh" + L], parent: BI.hips, side: s, m: at("thigh" + L, 0, 0, 0, down), blend: .14 });
    tube(out, { len: .43, r: (v) => .056 - .02 * v + .012 * Math.sin(Math.PI * Math.min(1, v * 1.6)), sx: .95, sz: 1.08, part: PART.shin, bone: BI["shin" + L], parent: BI["thigh" + L], side: s, m: at("shin" + L, 0, 0, 0, down), blend: .14 });
    // foot: from the heel forward along +z, a little flattened
    tube(out, { len: .2, r: (v) => .042 - .008 * v, sx: 1, sz: .72, part: PART.foot, bone: BI["foot" + L], parent: BI["shin" + L], side: s, m: at("foot" + L, 0, -.035, -.045, new E(Math.PI / 2, 0, 0)), segV: 8, blend: .15 });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("suit", new THREE.Float32BufferAttribute(out.suit, 4));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(out.si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(out.sw, 4));
  g.setIndex(out.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.boundingSphere.radius = 2.2;   // posed limbs reach further than the bind pose
  SHARED = { g, wp };
  return SHARED;
}

// ------------------------------------------------------------------ suits
// Colours are linear-ish hex; style picks the pattern.
export const SUITS = {
  arcline: { name: "Arcline", base: 0x1b1f27, accent: 0x18d6ff, dark: 0x0c0e12, glow: 0x5be7ff, lens: 0xe9fbff, style: 0, price: 0 },
  crimson: { name: "Crimson Line", base: 0x8e1522, accent: 0x111216, dark: 0x0b0b0e, glow: 0xff5a3c, lens: 0xfff2d8, style: 1, price: 2500 },
  stealth: { name: "Nightshade", base: 0x0d0e12, accent: 0x2a2440, dark: 0x050507, glow: 0x9b6bff, lens: 0xc7b3ff, style: 2, price: 4000 },
  gilded: { name: "Gilded", base: 0xe8e6e0, accent: 0xc89a2c, dark: 0x2a2620, glow: 0xffd36b, lens: 0x2b2f38, style: 0, price: 6000 },
  volt: { name: "Volt", base: 0x15161a, accent: 0xf2d21b, dark: 0x0a0a0c, glow: 0xffe14a, lens: 0xfff6c2, style: 1, price: 6000 },
  aurora: { name: "Aurora", base: 0x0f2a33, accent: 0x7c4dff, dark: 0x081419, glow: 0x3dffc4, lens: 0xd9fff4, style: 2, price: 9000 },
  ivory: { name: "Ivory Arc", base: 0xeef0f2, accent: 0x1d6dff, dark: 0x1a1d24, glow: 0x58a8ff, lens: 0x0c1220, style: 0, price: 12000 },
  ember: { name: "Ember", base: 0x2a1410, accent: 0xff7a1a, dark: 0x120806, glow: 0xff9a3d, lens: 0xffe4c4, style: 1, price: 12000 },
};
// enemies wear clothes, not suits: the same body, a jacket/trousers/skin look
export const OUTFITS = {
  thug: { base: 0x2b2f36, accent: 0x6b3a2a, dark: 0x16181c, glow: 0x000000, lens: 0xc89a7a, style: 3 },
  brute: { base: 0x3a3a3a, accent: 0x7a1c1c, dark: 0x111111, glow: 0x000000, lens: 0xa87a5a, style: 3 },
  gunner: { base: 0x283428, accent: 0x55452e, dark: 0x111511, glow: 0x000000, lens: 0xd2a084, style: 3 },
  boss: { base: 0x161616, accent: 0xb3122a, dark: 0x060606, glow: 0xff2240, lens: 0xff3048, style: 4 },
  civ: { base: 0x4a5a70, accent: 0x8a6a4a, dark: 0x22262c, glow: 0x000000, lens: 0xd8ab8c, style: 3 },
  cop: { base: 0x1b2a4a, accent: 0x1b2a4a, dark: 0x0e1018, glow: 0x000000, lens: 0xd2a084, style: 5 },
};

function suitMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5, metalness: .1 });
  const U = m.userData.u = {
    uBase: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() }, uDark: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() }, uLens: { value: new THREE.Color() }, uStyle: { value: 0 }, uGlowAmt: { value: 1 },
    uShoot: { value: new THREE.Vector2() }, uHit: { value: 0 }, uTime: { value: 0 }, uSquint: { value: 0 },
  };
  const extra = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 suit; varying vec4 vSuit; varying vec3 vLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSuit = suit; vLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec4 vSuit; varying vec3 vLocal;
        uniform vec3 uBase, uAccent, uDark, uGlow, uLens; uniform float uStyle, uGlowAmt, uHit, uTime, uSquint; uniform vec2 uShoot;
        float gEm; float gRough; float gMetal; float gHero; float gBump;
        float band(float x, float c, float w) { return 1. - smoothstep(w * .5, w * .5 + .012, abs(x - c)); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          float part = floor(vSuit.x + .5), u = vSuit.y, v = vSuit.z, side = vSuit.w;
          vec3 col = uBase; gEm = 0.; gRough = .48; gMetal = .12; gHero = 0.; gBump = 0.;
          float st = uStyle;
          // distance round the limb from its outside line (u .25 on the left limbs, .75 on the right)
          float sideU = side > 0. ? abs(u - .25) : abs(u - .75);
          bool limb = part > 3.5 && part < 9.5 && part != 6.;
          if (st < 2.5) {
            gHero = 1.;
            // a fine raised triangular weave over the base fabric (bind-pose metres, so it rides the limbs)
            vec3 wq = vLocal * 18.;
            float weave = max(max(band(fract(wq.y), .5, .1), band(fract(wq.x * .87 + wq.y * .5), .5, .1)), band(fract(-wq.x * .87 + wq.y * .5 + wq.z * .3), .5, .1));
            // fades out once a cell is smaller than a couple of pixels, so distant suits don't shimmer
            weave *= 1. - smoothstep(.12, .4, length(fwidth(wq)));
            if (part != 3.) { col = mix(col, col * .62, weave * .55); gRough += weave * .14 - .04; gBump = weave; }
            // stripes down the outside of every limb, with a glowing seam in the middle
            if (limb) {
              float s = band(sideU, 0., st == 1. ? .17 : .11);
              col = mix(col, uAccent, s);
              // the stripes are a slicker, raised material than the woven base
              gRough = mix(gRough, .3, s); gMetal = mix(gMetal, .28, s);
              float flow = .85 + .15 * sin(v * 16. - uTime * 5.);
              gEm += band(sideU, 0., .022) * (st == 2. ? 1.2 : .8) * flow;
            }
            // cuffs: dark gloves and boots, the web emitters as glowing rings at the wrists
            if (part == 6. || part == 9.) { col = uDark; gRough = .62; }
            if (part == 5.) { float cuff = smoothstep(.78, .8, v); col = mix(col, uDark, cuff); gEm += band(v, .82, .045) * (1. + 3. * (side > 0. ? uShoot.x : uShoot.y)); }
            if (part == 8.) { float boot = smoothstep(.62, .65, v); col = mix(col, uDark, boot); }
            // torso: side panels, a belt, the chest emblem (an arc over a line)
            if (part < 2.5) {
              // stripes down the sides, a glowing line down the spine
              float sp = band(abs(abs(u - .5) - .25), 0., st == 1. ? .16 : .1);
              col = mix(col, uAccent, sp * (st == 1. ? 1. : .9));
              gEm += band(abs(u - .5), .5, .025) * .9 + band(abs(abs(u - .5) - .25), 0., .02) * .5;
              if (part == 2.) { col = mix(col, uDark, band(v, .82, .16)); gEm += band(v, .82, .02) * .6; }
              if (part == 0.) {
                vec2 e = vec2((u - .5) * 3.2, v - .52);
                float arc = abs(length(e - vec2(0., -.34)) - .3) < .028 && e.y > -.18 && abs(e.x) < .3 ? 1. : 0.;
                float bar = abs(e.y + .2) < .022 && abs(e.x) < .2 ? 1. : 0.;
                float em = max(arc, bar);
                if (st == 1.) em = max(em, abs(e.x) < .025 && e.y > -.3 && e.y < .25 ? 1. : 0.);
                col = mix(col, uGlow, em); gEm += em * (1.35 + .1 * sin(uTime * 2.4));
                // collar line
                gEm += band(v, .93, .02) * .5;
              }
              if (part == 1.) { float rib = step(.5, fract(v * 3.)) * band(abs(u - .5), 0., .18); col = mix(col, col * .82, rib); }
            }
            if (part == 11.) col = mix(uBase, uAccent, .9);
            if (part == 10.) col = uBase * .8;
          } else if (st < 3.5) {
            // street clothes: jacket on top, trousers below, bare head and hands, shoes
            col = uBase;
            if (part == 2. || part == 7. || part == 8.) col = uAccent * .7 + uDark * .3;
            if (part == 3. || part == 6. || part == 10.) { col = uLens; gRough = .7; gMetal = 0.; }
            if (part == 9.) col = uDark;
            if (part == 0. || part == 1. || part == 4. || part == 11.) { col = uBase; gRough = .8; gMetal = 0.; }
            if (part == 3.) { float hair = smoothstep(.62, .66, v) + (1. - smoothstep(.0, .12, abs(u - .5) - .3)) * smoothstep(.35, .5, v) * 0.; col = mix(col, uDark * .6, clamp(hair, 0., 1.)); }
          } else if (st < 4.5) {
            // the boss: armour plates with red seams
            col = uBase;
            float seam = band(fract(v * 4. + u * 2.), .5, .06);
            col = mix(col, uAccent, seam); gEm += seam * .7; gMetal = .6; gRough = .35;
            if (part == 3.) { col = uDark; }
          } else {
            // police: dark blue uniform, a light shirt collar, cap
            col = uBase;
            if (part == 3. || part == 6.) { col = uLens; gRough = .7; gMetal = 0.; }
            if (part == 3.) col = mix(col, uDark, smoothstep(.62, .66, v));
            if (part == 0.) col = mix(col, vec3(.75, .78, .82), band(abs(u - .5), 0., .12) * smoothstep(.75, .9, v));
            if (part == 9.) col = uDark;
            gMetal = 0.; gRough = .75;
          }
          // head: big angular lenses
          if (part == 3. && st < 2.5) {
            // the lenses narrow when the hero squints into a fight (and for a blink now and then)
            float du = (u - .5) * 6.2, ex = abs(du) - .5, ey = (v - .56) * 4.6;
            ey *= 1. + uSquint * (ey > 0. ? 1.6 : .7);
            float lens = step(ex * ex * 1.1 + ey * ey * (ey > 0. ? 2.6 : 1.3) - ex * ey * .9, .16) * step(.08, abs(du));
            float rim = step(ex * ex * 1.1 + ey * ey * (ey > 0. ? 2.6 : 1.3) - ex * ey * .9, .24) * step(.06, abs(du)) - lens;
            col = mix(col, uDark, clamp(rim, 0., 1.));
            col = mix(col, uLens, lens); gEm += lens * 1.25; gRough = mix(gRough, .15, lens);
            // a ridge line over the crown
            col = mix(col, uAccent, band(abs(u - .5), 0., .03) * smoothstep(.62, .7, v) * (st == 2. ? .3 : 1.));
          }
          // soft occlusion in the creases: where limbs meet the body, under the chest and the jaw
          float crease = 1.;
          if (part > 3.5 && part < 9.5) crease = mix(.7, 1., smoothstep(0., .14, v) * smoothstep(1., .9, v));
          if (part < 2.5) crease = mix(.78, 1., smoothstep(0., .12, v));
          if (part == 3.) crease = mix(.8, 1., smoothstep(.05, .25, v));
          col *= crease;
          diffuseColor.rgb = col * mix(vec3(1.), vec3(1., .35, .3), uHit);
        }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          // the weave as a real raised texture: a bump from the screen-space slope of its height
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dFdx(gBump) * r1 + dFdy(gBump) * r2) * .0016;
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\nfloat gFres = pow(1. - clamp(abs(dot(normal, normalize(vViewPosition))), 0., 1.), 3.);\ntotalEmissiveRadiance += uGlow * gEm * uGlowAmt * 1.6 + vec3(1., .2, .1) * uHit * .6 + uGlow * gFres * gHero * .22;");
  };
  extra.key = "herosuit6";
  return patchLit(m, extra);
}

// ------------------------------------------------------------------ the rig
export class HeroRig {
  constructor(look = SUITS.arcline) {
    const { g } = bodyGeometry();
    this.bones = BONES.map(([n]) => { const b = new THREE.Bone(); b.name = n; return b; });
    BONES.forEach(([n, par, x, y, z], i) => { this.bones[i].position.set(x, y, z); if (par) this.bones[BI[par]].add(this.bones[i]); });
    this.mat = suitMaterial();
    this.mesh = new THREE.SkinnedMesh(g, this.mat);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.b = Object.fromEntries(BONES.map(([n], i) => [n, this.bones[i]]));
    this.target = this.bones.map(() => new Q());
    this.rest = this.bones.map((b) => b.position.clone());
    this.rootQ = new Q(); this.rootTarget = new Q(); this.trickQ = new Q(); this.rootPos = new V();
    this.poseOffset = new V(); this.posePosition = new V();
    this.poseBase = this.bones.map(() => new Q()); this.posePrevious = this.bones.map(() => new Q());
    this.poseBaseOffset = new V(); this.posePreviousOffset = new V();
    this.phase = 0; this.blendRate = 14;
    this.setLook(look);
  }
  setLook(s) {
    const U = this.mat.userData.u;
    U.uBase.value.setHex(s.base); U.uAccent.value.setHex(s.accent); U.uDark.value.setHex(s.dark);
    U.uGlow.value.setHex(s.glow); U.uLens.value.setHex(s.lens); U.uStyle.value = s.style;
    this.look = s;
  }
  dispose() { this.mat.dispose(); }
  // world position of a bone (the hands are where the lines start)
  handPos(side, out) { this.mesh.updateMatrixWorld(true); return this.b[side > 0 ? "handL" : "handR"].localToWorld(out.set(0, -.07, .015)); }
  bonePos(name, out) { return this.b[name].getWorldPosition(out); }

  // place the body: p = centre of mass (hip height), up/fwd = which way the body points, extra = an
  // added rotation about the centre of mass (flips and spins)
  place(p, up, fwd, extra, dt, rate = 12) {
    const x = _a.crossVectors(up, fwd);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const f = _b.crossVectors(x, up).normalize();
    _m.makeBasis(x, up, f);
    this.rootTarget.setFromRotationMatrix(_m);
    if (rate <= 0) this.rootQ.copy(this.rootTarget);
    else this.rootQ.slerp(this.rootTarget, 1 - Math.exp(-dt * rate));
    const q = _q.copy(this.rootQ);
    if (extra) q.multiply(extra);
    this.group.quaternion.copy(q);
    // rotate about the centre of mass: the hips sit at p
    _c.set(0, HIP_H, 0).applyQuaternion(q);
    this.group.position.copy(p).sub(_c);
  }
  // ease every bone towards the target pose
  apply(dt, rate = this.blendRate) {
    const k = 1 - Math.exp(-dt * rate);
    for (let i = 1; i < this.bones.length; i++) this.bones[i].quaternion.slerp(this.target[i], k);
    this.b.hips.position.lerp(this.posePosition.copy(this.rest[BI.hips]).add(this.poseOffset), k);
  }
  snap() {
    for (let i = 1; i < this.bones.length; i++) this.bones[i].quaternion.copy(this.target[i]);
    this.b.hips.position.copy(this.rest[BI.hips]).add(this.poseOffset);
  }
}
const _a = new V(), _b = new V(), _c = new V(), _q = new Q();

// ------------------------------------------------------------------ poses
// A pose writes target rotations (degrees, XYZ) into rig.target. Semantics, in each bone's own frame:
//  arms/legs hang down -Y: rx < 0 swings the limb forward, rz > 0 swings it out to the side (for the
//  left limbs; use the mirror helpers), knees bend with +rx, elbows with -rx, spine leans forward +rx.
const _e = new E();
const setB = (rig, name, x = 0, y = 0, z = 0) => rig.target[BI[name]].setFromEuler(_e.set(x * D2R, y * D2R, z * D2R, "XYZ"));
// limbs by side: s = +1 left, -1 right; abduction and twist mirror
const arm = (rig, s, fwd, out, twist = 0, elbow = 0) => { const L = s > 0 ? "L" : "R"; setB(rig, "arm" + L, -fwd, twist * s, out * s); setB(rig, "fore" + L, -elbow, 0, 0); };
const leg = (rig, s, fwd, out, knee = 0, foot = 0, twist = 0) => { const L = s > 0 ? "L" : "R"; setB(rig, "thigh" + L, -fwd, twist * s, out * s); setB(rig, "shin" + L, knee, 0, 0); setB(rig, "foot" + L, foot, 0, 0); };
const hand = (rig, s, curl = 0, side = 0) => setB(rig, "hand" + (s > 0 ? "L" : "R"), -curl, 0, side * s);
const torso = (rig, lean = 0, twist = 0, side = 0, chestLean = 0, chestTwist = 0) => { setB(rig, "spine", lean, twist, side); setB(rig, "chest", chestLean, chestTwist, side * .5); };
const headP = (rig, nod = 0, turn = 0, tilt = 0) => { setB(rig, "neck", nod * .4, turn * .4, tilt * .4); setB(rig, "head", nod * .6, turn * .6, tilt * .6); };
// Targets arrive in body space. Undo the posed torso so a bank or twist keeps the wrist on its line.
const _from = new V(0, -1, 0), _dir = new V(), _qa = new Q();
function aimArm(rig, s, dirBody, elbow = 6) {
  _qa.copy(rig.target[BI.hips]).multiply(rig.target[BI.spine]).multiply(rig.target[BI.chest]).invert();
  _dir.copy(dirBody).applyQuaternion(_qa);
  if (_dir.lengthSq() < 1e-8) _dir.set(0, 1, 0);
  else _dir.normalize();
  rig.target[BI[s > 0 ? "armL" : "armR"]].setFromUnitVectors(_from, _dir);
  setB(rig, s > 0 ? "foreL" : "foreR", -elbow, 0, 0);
  hand(rig, s, 20, 0);
}
export const POSE = { setB, arm, leg, hand, torso, headP, aimArm };

const sin = Math.sin, cos = Math.cos, PI = Math.PI;
const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (v) => { v = cl(v, 0, 1); return v * v * (3 - 2 * v); };
const _contact = new V(), _pole = new V(), _joint = new V(), _ikDir = new V(), _bend = new V(), _elbow = new V(), _limb = new V(), _offset = new V();
const _parentQ = new Q(), _upperQ = new Q(), _lowerQ = new Q(), _inverseQ = new Q(), _soleQ = new Q().setFromEuler(new E(-PI / 2, 0, 0));

// Solve a surface contact in body space. The bend pole keeps elbows and knees clear of the wall.
function plantLimb(rig, side, isArm, contact, pole) {
  const L = side > 0 ? "L" : "R", upper = BI[(isArm ? "arm" : "thigh") + L];
  const lower = BI[(isArm ? "fore" : "shin") + L], end = BI[(isArm ? "hand" : "foot") + L];
  _parentQ.copy(rig.target[BI.hips]);
  if (isArm) {
    _joint.copy(rig.rest[BI.spine]).applyQuaternion(_parentQ);
    _parentQ.multiply(rig.target[BI.spine]);
    _joint.add(_offset.copy(rig.rest[BI.chest]).applyQuaternion(_parentQ));
    _parentQ.multiply(rig.target[BI.chest]);
    _joint.add(_offset.copy(rig.rest[upper]).applyQuaternion(_parentQ));
    _ikDir.copy(contact); _ikDir.y += .07; _ikDir.z -= .015;
  } else {
    _joint.copy(rig.rest[upper]).applyQuaternion(_parentQ);
    _ikDir.copy(contact); _ikDir.y -= .06; _ikDir.z -= .04;
  }
  _ikDir.sub(_joint);
  const l1 = isArm ? .29 : .445, l2 = isArm ? .26 : .43;
  const raw = _ikDir.length(), reach = cl(raw, Math.abs(l1 - l2) + .015, l1 + l2 - .008);
  if (raw < 1e-6) _ikDir.set(0, -1, 0); else _ikDir.divideScalar(raw);
  _bend.copy(pole).addScaledVector(_ikDir, -pole.dot(_ikDir));
  if (_bend.lengthSq() < 1e-6) _bend.set(side, 0, 0).addScaledVector(_ikDir, -side * _ikDir.x);
  _bend.normalize();
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  _elbow.copy(_joint).addScaledVector(_ikDir, along).addScaledVector(_bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  _upperQ.setFromUnitVectors(_from, _limb.subVectors(_elbow, _joint).normalize());
  _lowerQ.setFromUnitVectors(_from, _limb.copy(_joint).addScaledVector(_ikDir, reach).sub(_elbow).normalize());
  rig.target[upper].copy(_inverseQ.copy(_parentQ).invert()).multiply(_upperQ);
  rig.target[lower].copy(_inverseQ.copy(_upperQ).invert()).multiply(_lowerQ);
  // Palms face into the surface; soles turn so their toes point along the climb.
  rig.target[end].copy(_inverseQ.copy(_lowerQ).invert());
  if (!isArm) rig.target[end].multiply(_soleQ);
}

function saveBasePose(rig) {
  for (let i = 1; i < rig.target.length; i++) rig.poseBase[i].copy(rig.target[i]);
  rig.poseBaseOffset.copy(rig.poseOffset);
}
function blendBasePose(rig, strength) {
  for (let i = 1; i < rig.target.length; i++) rig.target[i].slerp(rig.poseBase[i], 1 - strength);
  rig.poseOffset.lerp(rig.poseBaseOffset, 1 - strength);
}

function poseWall(rig, a) {
  const mv = a.wallMove, mx = mv?.x || 0, my = mv?.y || 0, speed = Math.hypot(mx, my);
  const moving = smooth(speed / .6), dx = speed > .05 ? mx / speed : 0, dy = speed > .05 ? my / speed : 1;
  const running = a.wallMode === "run" && speed > 3, phase = a.phase || 0;
  const gap = cl(a.wallDistance ?? .44, .3, .65), sway = sin(phase) * moving;
  torso(rig, running ? 10 : 18, sway * (running ? 7 : 4), -dx * 5, running ? 3 : 7, -sway * 3);
  headP(rig, running ? -26 : -38, dx * 12, sway * 2);
  rig.poseOffset.set(sway * (running ? .018 : .012), running ? -.015 : -.065, 0);
  for (let s = -1; s <= 1; s += 2) {
    const limbPhase = phase + (s > 0 ? 0 : PI), cycle = ((limbPhase / (PI * 2)) % 1 + 1) % 1;
    const hold = running ? .4 : .64, reach = smooth((cycle - hold) / (1 - hold));
    const travel = (cycle < hold ? .5 - cycle / hold : -.5 + reach) * moving;
    const lift = cycle < hold ? 0 : sin(reach * PI) * moving;
    if (running) {
      arm(rig, s, 20 - sway * s * 38, 18, -sway * 9, 75 + sway * s * 15);
      hand(rig, s, 20);
      const brush = smooth((cos(limbPhase) - .15) / .65);
      if (brush > 0) {
        const upper = BI["arm" + (s > 0 ? "L" : "R")], lower = upper + 1, end = upper + 2;
        rig.posePrevious[upper].copy(rig.target[upper]); rig.posePrevious[lower].copy(rig.target[lower]); rig.posePrevious[end].copy(rig.target[end]);
        _contact.set(s * .32 + dx * travel * .24, .18 + dy * travel * .24, gap - .018);
        plantLimb(rig, s, true, _contact, _pole.set(s * .7, -.2, -1));
        rig.target[upper].slerp(rig.posePrevious[upper], 1 - brush); rig.target[lower].slerp(rig.posePrevious[lower], 1 - brush); rig.target[end].slerp(rig.posePrevious[end], 1 - brush);
      }
    } else {
      _contact.set(s * (.36 + lift * .035) + dx * travel * .46, .56 + dy * travel * .46, gap - .018 - lift * .14);
      plantLimb(rig, s, true, _contact, _pole.set(s * .8, -.1, -1));
    }
    // Each foot plants opposite its arm, giving the body two diagonal supports during a reach.
    const footCycle = (cycle + .5) % 1, footReach = smooth((footCycle - hold) / (1 - hold));
    const footTravel = (footCycle < hold ? .5 - footCycle / hold : -.5 + footReach) * moving;
    const footLift = footCycle < hold ? 0 : sin(footReach * PI) * moving;
    _contact.set(s * (running ? .18 : .3) + dx * footTravel * (running ? .6 : .46), (running ? -.43 : -.36) + dy * footTravel * (running ? .6 : .46), gap - .02 - footLift * (running ? .27 : .13));
    plantLimb(rig, s, false, _contact, _pole.set(s * (running ? .3 : .9), .1, -1));
  }
  return a.stateT < .2 ? 28 : running ? 24 : 22;
}

function poseAir(rig, a) {
  const t = a.t || 0, vy = a.vy || 0, hs = a.hs || 0, turn = cl(a.turn || 0, -1, 1);
  const rise = smooth(vy / 16), fall = smooth((-vy - 2) / 34), apex = 1 - smooth(Math.abs(vy) / 7);
  const fast = cl(hs / 48, 0, 1), brace = smooth((8 - (a.heightAbove ?? 100)) / 7) * fall;
  const freefall = smooth((-vy - 18) / 28) * (1 - brace);
  const tumble = smooth((-vy - 38) / 30) * (1 - brace), drift = sin(t * 2.8) * (2 + tumble * 7) + sin(t * 13) * fall * fast * 3;
  const s = a.swingSide || 1;
  if (a.dive) {
    torso(rig, 6 + brace * 20, -turn * 5, -turn * 7, -6 + brace * 12); headP(rig, -42 + brace * 28, turn * 12);
    leg(rig, s, -8 + brace * 65, 5 + brace * 8, 8 + brace * 80, 22 - brace * 35);
    leg(rig, -s, -2 + brace * 42, 8 + brace * 6, 16 + brace * 65, 18 - brace * 24);
    arm(rig, s, -24 + brace * 78, 16 + brace * 20, 0, 8 + brace * 36);
    arm(rig, -s, -16 + brace * 65, 21 + brace * 14, 0, 15 + brace * 35);
    hand(rig, s, 8); hand(rig, -s, 8);
    return 14;
  }
  if (a.glide) {
    const bank = cl(a.bank || turn, -1, 1);
    torso(rig, -5, -bank * 8, bank * 12, -8); headP(rig, -35, bank * 15, -bank * 5);
    leg(rig, 1, -8 + bank * 8, 20 - bank * 5, 9, 24); leg(rig, -1, -3 - bank * 8, 24 + bank * 5, 15, 20);
    arm(rig, 1, -8 + bank * 8, 82 - bank * 8, 0, 8); arm(rig, -1, -8 - bank * 8, 82 + bank * 8, 0, 8);
    hand(rig, 1, 0); hand(rig, -1, 0);
    return 11;
  }
  // Rise, hang time and freefall share one pose so crossing the apex never snaps the limbs.
  torso(rig, 5 + rise * 5 + fall * 15 + brace * 7 - freefall * 9, -turn * 12 + tumble * drift + sin(t * 4.5) * freefall * 13, -turn * (9 + fast * 7) + sin(t * 3.2) * freefall * 8, -5 - rise * 3 + brace * 11);
  headP(rig, -10 * rise + fall * 19 - brace * 15 - freefall * 5, turn * 20 + sin(t * 3.2) * freefall * 12, tumble * drift * .4);
  leg(rig, s, 18 + rise * 42 + fall * 12 + brace * 25 + freefall * 18, 10 + fall * 11 + freefall * 16, 32 + rise * 55 + brace * 38 + freefall * 38, -10 - brace * 12 - freefall * 16);
  leg(rig, -s, -8 + rise * 12 + fall * 22 + brace * 22 + freefall * 12, 17 + fall * 12 + freefall * 18, 36 + rise * 15 + fall * 12 + brace * 30 + freefall * 28, 10 - brace * 24 + freefall * 14);
  arm(rig, s, 18 + rise * 42 + apex * 14 - fall * 12 + brace * 42 + drift - freefall * 28, 28 + apex * 20 + fall * 34 - brace * 20 + freefall * 58, 0, 30 + rise * 15 + brace * 20 + freefall * 18);
  arm(rig, -s, 7 + rise * 20 + apex * 9 - fall * 8 + brace * 38 - drift - freefall * 20, 39 + apex * 15 + fall * 24 - brace * 18 + freefall * 50, 0, 35 + rise * 12 + brace * 20 - freefall * 14);
  hand(rig, s, 8 + brace * 25 + freefall * 12); hand(rig, -s, 8 + brace * 25 + freefall * 12);
  if (a.releaseT >= 0 && a.releaseT < .54) {
    saveBasePose(rig);
    const k = cl(a.releaseT / .54, 0, 1), open = sin(k * PI), quality = cl(a.releaseQuality || 0, 0, 2);
    torso(rig, -12 + open * 18, -s * open * 18, -turn * 12, -8); headP(rig, -18 + open * 11, turn * 20);
    arm(rig, s, 150 - k * 110, 18 + open * 34, 0, 9 + k * 36);
    arm(rig, -s, -20 + k * 45, 50 + open * 26, 0, 19 + open * 20);
    leg(rig, s, 42 + open * (25 + quality * 6), 10, 64 + open * 37, -17);
    leg(rig, -s, -23 + k * 42, 17, 22 + k * 24, 17);
    hand(rig, s, 0); hand(rig, -s, 5);
    blendBasePose(rig, 1 - smooth((a.releaseT - .14) / .4));
  }
  if (a.dash > 0) {
    torso(rig, 32, -s * 9, -turn * 12, 11); headP(rig, -22, turn * 15);
    leg(rig, s, 65, 8, 93, -10); leg(rig, -s, -12, 13, 35, 18);
    arm(rig, s, -42, 24, 0, 22); arm(rig, -s, -28, 32, 0, 36);
    return 24;
  }
  return 13 + brace * 7;
}

function trickStrength(trick) {
  return cl(trick.blend ?? sin(cl((trick.k || 0) * 1.15, 0, 1) * PI), 0, 1);
}
function poseTrick(rig, tr) {
  const sh = tr.shape, s = tr.side === -1 ? -1 : 1, dx = cl(tr.dirX || 0, -1, 1), dy = cl(tr.dirY || 0, -1, 1);
  const breath = sin((tr.k || 0) * PI * 2) * 3;
  if (sh === "tuck") {
    torso(rig, 35 + dy * 6, -s * 6, -dx * 8, 17); headP(rig, 16 + dy * 6, dx * 8);
    leg(rig, s, 120 + breath, 10, 142, 18); leg(rig, -s, 112 - breath, 14, 135, 24);
    arm(rig, s, 72, 24, 0, 110); arm(rig, -s, 68, 30, 0, 104);
    hand(rig, s, 18); hand(rig, -s, 18);
  } else if (sh === "layout") {
    torso(rig, -13, s * 9, s * 12, -8, -s * 6); headP(rig, -9, -s * 12);
    leg(rig, s, -6, 8, 9, 22); leg(rig, -s, 2, 14, 24, 17);
    arm(rig, s, 155, 26, 0, 12); arm(rig, -s, 14, 78, 0, 20);
    hand(rig, s, 0); hand(rig, -s, 5);
  } else if (sh === "pike") {
    torso(rig, 53, -dx * 8, -dx * 6, 14); headP(rig, 10, dx * 12);
    leg(rig, s, 105, 8, 8, 6); leg(rig, -s, 99, 12, 12, 10);
    arm(rig, s, 108, 14, 0, 13); arm(rig, -s, 101, 20, 0, 20);
    hand(rig, s, 0); hand(rig, -s, 0);
  } else if (sh === "spread") {
    torso(rig, -4, s * 7, dx * 8, -9); headP(rig, -12, dx * 14);
    leg(rig, s, 13, 43, 14, 12); leg(rig, -s, -3, 49, 24, 18);
    arm(rig, s, 8, 101, 0, 10); arm(rig, -s, -4, 92, 0, 18);
    hand(rig, s, 0, -8); hand(rig, -s, 0, -8);
  } else if (sh === "corkscrew") {
    torso(rig, 10 + dy * 9, -s * 29, -s * 14, 4, s * 16); headP(rig, -5, s * 20, s * 5);
    leg(rig, s, 70 + breath, 12, 105, -14); leg(rig, -s, -15, 16, 26, 24);
    arm(rig, s, 65, 18, 0, 114); arm(rig, -s, -12, 68, 0, 24);
    hand(rig, s, 16); hand(rig, -s, 0);
  } else if (sh === "superman") {
    torso(rig, -18, -dx * 8, -dx * 10, -9); headP(rig, -28, dx * 15);
    arm(rig, s, 173, 11, 0, 4); arm(rig, -s, 149, 25, 0, 20);
    leg(rig, s, -12, 7, 8, 22); leg(rig, -s, -3, 13, 30, 18);
    hand(rig, s, 2); hand(rig, -s, 5);
  } else if (sh === "split") {
    torso(rig, 11, -s * 10, -dx * 8, -3); headP(rig, -12, s * 12);
    leg(rig, s, 93, 12, 8, 5); leg(rig, -s, -67, 17, 13, 24);
    arm(rig, s, 31, 87, 0, 12); arm(rig, -s, 8, 97, 0, 16);
    hand(rig, s, 0); hand(rig, -s, 0);
  }
}
function poseTricks(rig, tr) {
  saveBasePose(rig);
  const previous = tr.previous, transition = smooth(tr.transition ?? 1);
  if (previous && transition < 1) {
    poseTrick(rig, previous); blendBasePose(rig, trickStrength(previous));
    for (let i = 1; i < rig.target.length; i++) { rig.posePrevious[i].copy(rig.target[i]); rig.target[i].copy(rig.poseBase[i]); }
    rig.posePreviousOffset.copy(rig.poseOffset); rig.poseOffset.copy(rig.poseBaseOffset);
  }
  poseTrick(rig, tr); blendBasePose(rig, trickStrength(tr));
  if (previous && transition < 1) {
    for (let i = 1; i < rig.target.length; i++) { rig.posePrevious[i].slerp(rig.target[i], transition); rig.target[i].copy(rig.posePrevious[i]); }
    rig.poseOffset.copy(rig.posePreviousOffset.lerp(rig.poseOffset, transition));
  }
}

// The whole-body pose for a movement state. a = animation inputs prepared by the controller:
//  { state, speed, hs (horizontal speed), vy, phase, grounded, sprint, slide, roll, hard, landT,
//    crouch, dive, glide, swingSide, anchorLocal (V3 in body frame), zip, wallMode, wallMove (x right,
//    y up in the wall's frame), ledge, perch, swim, trick, attack, turn, releaseT, releaseQuality, t }
export function poseBody(rig, a) {
  const t = a.t || 0, st = a.state, turn = cl(a.turn || 0, -1, 1);
  const hero = rig.look.style < 2.5;
  rig.poseOffset.set(0, 0, 0);
  const U = rig.mat.userData.u;
  U.uTime.value = t;
  U.uGlowAmt.value = hero ? 1 + cl(((a.speed || 0) - 12) / 48, 0, .45) + (a.attack ? .18 : 0) : 1;
  // a neutral starting point every frame
  for (let i = 1; i < rig.bones.length; i++) rig.target[i].identity();
  hand(rig, 1, 30); hand(rig, -1, 30);
  let rate = 14;
  if (st === "ground") {
    const hs = a.hs, run = cl((hs - 1.2) / 8, 0, 1), sprint = cl((hs - 10) / 8, 0, 1);
    if (a.slide > 0) {
      // the slide: low, leaning back, lead leg out in front, a hand trailing on the ground
      torso(rig, -24, 0, -8, -8); headP(rig, 14, 0, 6);
      leg(rig, 1, 72, 6, 8, -20); leg(rig, -1, 28, 10, 105, 10);
      arm(rig, 1, 35, 55, 0, 20); arm(rig, -1, -25, 40, 0, 15);
      if (hero) rig.poseOffset.y = -.43;
      rate = 16;
    } else if (a.roll > 0) {
      torso(rig, 70, 0, 0, 30); headP(rig, 40);
      leg(rig, 1, 120, 4, 140, 30); leg(rig, -1, 115, 6, 145, 30);
      arm(rig, 1, 80, 25, 0, 90); arm(rig, -1, 80, 25, 0, 90);
      if (hero) rig.poseOffset.y = -.36;
      rate = 22;
    } else if (a.hard > 0) {
      // superhero landing: down on one knee, a fist on the ground
      torso(rig, 55, 10, 0, 14); headP(rig, -38);
      leg(rig, 1, 95, 8, 105, -20); leg(rig, -1, 15, 12, 120, 35);
      arm(rig, -1, 72, 12, 0, 4); hand(rig, -1, 12); arm(rig, 1, -10, 48, 0, 30);
      if (hero) rig.poseOffset.y = -.48;
      rate = 26;
    } else if (hs < 1.2) {
      // idle: an easy hero stance, breathing
      const br = sin(t * 1.9) * 1.5;
      const crouch = a.crouch ? 1 : 0;
      torso(rig, 4 + br * .3 + crouch * 25, 0, 0, -2 + br * .4); headP(rig, -4 - crouch * 18 + sin(t * .7) * 2, sin(t * .37) * 6);
      leg(rig, 1, 4 + crouch * 70, 7, 6 + crouch * 110, -2 - crouch * 30, 6); leg(rig, -1, -2 + crouch * 60, 8, 4 + crouch * 105, 2 - crouch * 35, 8);
      arm(rig, 1, 6 + crouch * 30, 9 + br * .3, 10, 14 + crouch * 30); arm(rig, -1, 4 + crouch * 30, 9 + br * .3, 10, 12 + crouch * 30);
      if (hero) rig.poseOffset.y = -.38 * crouch + br * .002;
      // left standing, the hero glances round the street every few seconds and shifts their weight
      if (hero && !crouch && !a.combat && a.landT >= .25) {
        const cyc = (t % 9) / 9, look = smooth((cyc - .55) / .08) * (1 - smooth((cyc - .82) / .08)), side = sin(t * .11) > 0 ? 1 : -1;
        headP(rig, -4 + look * 6, sin(t * .37) * 6 + look * 46 * side, look * 5 * side);
        torso(rig, 4 + br * .3, look * 10 * side, sin(t * .5) * 2, -2 + br * .4, look * 6 * side);
        leg(rig, 1, 4, 7 + sin(t * .5) * 2, 6 + Math.max(0, sin(t * .5)) * 8, -2, 6);
      }
      if (a.landT < .25) { const k = 1 - a.landT / .25; torso(rig, 14 * k, 0, 0, 6 * k); leg(rig, 1, 30 * k, 7, 55 * k, -18 * k); leg(rig, -1, 26 * k, 8, 50 * k, -15 * k); if (hero) rig.poseOffset.y = -.12 * k; }
      if (hero && a.combat && !crouch && a.landT >= .25) {
        torso(rig, 8 + br * .2, -14, 0, 3); headP(rig, -7, 14);
        leg(rig, 1, 18, 12, 28, -8); leg(rig, -1, -8, 14, 18, 4);
        arm(rig, 1, 38 + br, 20, 0, 112); arm(rig, -1, 28 - br, 24, 0, 104);
        hand(rig, 1, 76); hand(rig, -1, 76); rig.poseOffset.y = -.055;
      }
      rate = 9;
    } else {
      // walk -> run -> sprint: one stride cycle, longer and more bent the faster it goes
      const ph = a.phase, s1 = sin(ph), c1 = cos(ph);
      const swing = 22 + run * 30 + sprint * 18, kneeK = 18 + run * 55 + sprint * 25;
      const lean = 5 + run * 9 + sprint * 12 + cl(a.accel || 0, -10, 20) * .4;
      torso(rig, lean, s1 * (6 + run * 6) - turn * 10, -turn * (5 + run * 9), 2 + sprint * 4, -s1 * (4 + run * 6));
      headP(rig, -lean * .6, -s1 * 3 + turn * 14, turn * 4);
      for (const s of [1, -1]) {
        const p = s > 0 ? ph : ph + PI, sp = sin(p);
        const knee = kneeK * Math.max(0, sin(p + 1.4)) + 8;
        leg(rig, s, sp * swing + run * 8, 4, knee, -sp * 12 - run * 8, 0);
        arm(rig, s, -sp * (swing * .9 + sprint * 10), 8 + run * 6, 0, 18 + run * 55 + sprint * 15);
        hand(rig, s, 40 + run * 40);
      }
      // The hips absorb each footfall; the head stays readable through the stride.
      if (hero) rig.poseOffset.y = Math.abs(c1) * (.025 + run * .035) - .02;
      rate = 18;
    }
  } else if (st === "perch") {
    // crouched on the edge, on the toes, a hand between the feet
    torso(rig, 48, 0, 0, 14); headP(rig, -38, sin(t * .6) * 10);
    leg(rig, 1, 105, 22, 140, -40, 10); leg(rig, -1, 100, 22, 145, -45, 10);
    arm(rig, 1, 70, 6, 0, 20); hand(rig, 1, 10); arm(rig, -1, 30, 30, 0, 50);
    if (hero) rig.poseOffset.y = -.62;
    rate = 12;
  } else if (st === "air") {
    rate = poseAir(rig, a);
  } else if (st === "swing") {
    // one arm (both on a double line) holds the line straight up to the anchor; the body hangs below
    // it and the legs swing through - tucked under at the bottom, kicked out ahead on the way up
    const ph = a.swingPhase || 0;          // -1 coming down behind .. 0 bottom .. +1 out in front
    const kick = cl(ph, -1, 1), load = 1 - Math.abs(kick), fast = cl((a.speed || 0) / 48, 0, 1);
    const s = a.swingSide || 1, bank = turn * (8 + fast * 10);
    // wind on the limbs at speed, and the chest whipping round as the swing passes the bottom
    const flutter = sin(t * 11) * fast * 4, whip = load * load * s * 10;
    torso(rig, -8 - kick * 19, s * (8 + load * 8), -bank, -8 - kick * 7, -s * 6 + whip);
    headP(rig, -12 + kick * 10, turn * 22 - whip * .5, bank * .4);
    // three ways through a swing, picked per line so a long run never repeats one silhouette
    const style = a.swingStyle || 0;
    if (style === 1) {
      // legs together and long, the free arm thrown wide
      leg(rig, s, 18 + kick * 58 + flutter, 6, 10 + load * 22, -8 + flutter);
      leg(rig, -s, 14 + kick * 52 - flutter, 9, 16 + load * 26, -6);
    } else if (style === 2) {
      // a running scissor through the bottom of the arc
      const sc = sin((a.swingPhase || 0) * PI) * 26;
      leg(rig, s, 36 + kick * 46 + sc, 9, 64 + load * 34, -14);
      leg(rig, -s, -6 + kick * 30 - sc, 15, 26 + load * 40, 4);
    } else {
      leg(rig, s, 30 + kick * 50 + flutter, 8 + turn * s * 4, 30 + load * (45 + fast * 12), -18 + flutter);
      leg(rig, -s, 8 + kick * 34 - flutter, 15 - turn * s * 4, 48 + load * 34 - flutter * 1.5, -7);
    }
    if (a.anchorLocal) aimArm(rig, s, a.anchorLocal, 5 + load * 5);
    else arm(rig, s, 160, 20, 0, 10);
    if (a.anchor2Local) aimArm(rig, -s, a.anchor2Local, 8);
    else if (style === 1) { arm(rig, -s, -6 + kick * 20, 84 + fast * 8, 0, 12); hand(rig, -s, 0, -10); }
    else if (style === 2) { arm(rig, -s, 30 + kick * 40, 30, 0, 40 + load * 30); hand(rig, -s, 30); }
    else { arm(rig, -s, -24 + kick * 35, 45 + fast * 16 - turn * s * 12, 0, 28 + load * 20); hand(rig, -s, 12); }
    rate = 13;
  } else if (st === "zip") {
    // pulled along the line: the arm out in front, the body stretched behind it
    torso(rig, -14, (a.swingSide || 1) * 10, -turn * 12, -8); headP(rig, -20, turn * 16);
    leg(rig, 1, -20, 7, 24, 28); leg(rig, -1, 8, 11, 78, 14);
    if (a.anchorLocal) aimArm(rig, a.swingSide || 1, a.anchorLocal, 4); else arm(rig, 1, 170, 0, 0, 0);
    arm(rig, -(a.swingSide || 1), -36, 35, 0, 24);
    rate = 18;
  } else if (st === "wall") {
    rate = poseWall(rig, a);
  } else if (st === "ledge") {
    torso(rig, -2, 0, 0, -4); headP(rig, -25);
    arm(rig, 1, 172, 14, 0, 18); arm(rig, -1, 172, 14, 0, 18); hand(rig, 1, 60); hand(rig, -1, 60);
    leg(rig, 1, 8 + sin(t * 1.3) * 4, 4, 18); leg(rig, -1, 2 - sin(t * 1.3) * 4, 5, 28);
    rate = 12;
  } else if (st === "water") {
    const ph = t * 4;
    torso(rig, 60, 0, 0, 10); headP(rig, -55);
    arm(rig, 1, 120 + sin(ph) * 40, 30 + cos(ph) * 25, 0, 40); arm(rig, -1, 120 + sin(ph) * 40, 30 + cos(ph) * 25, 0, 40);
    leg(rig, 1, -10 + sin(ph * 1.5) * 20, 10, 20); leg(rig, -1, -10 - sin(ph * 1.5) * 20, 10, 20);
    rate = 8;
  }
  // the slingshot: crouched, leaning back against two lines held out in front
  if (a.sling != null && (st === "ground" || st === "perch")) {
    const c = a.sling, q = sin(t * 40) * c * 1.5;
    torso(rig, -8 - c * 20, 0, q, -8 - c * 8); headP(rig, -12 + c * 8);
    leg(rig, 1, 46 + c * 30, 14, 66 + c * 44, -16); leg(rig, -1, -12 - c * 16, 15, 28 + c * 22, 12);
    arm(rig, 1, 78 - c * 8, 24, 0, 22 + c * 40); arm(rig, -1, 78 - c * 8, 24, 0, 22 + c * 40);
    hand(rig, 1, 75); hand(rig, -1, 75);
    if (hero) rig.poseOffset.y = -.16 - c * .22;
    rate = 14;
  }
  // scripted moves override the state's pose
  if (a.move) {
    const mv = a.move, k = Math.min(1, mv.t / mv.dur);
    if (mv.kind === "vault") {
      // speed vault: body turned and low over the obstacle, a hand planted, legs swung through
      torso(rig, 40, -25, 25, 10); headP(rig, -25, 20);
      arm(rig, 1, 70 + k * 30, 18, 0, 5); hand(rig, 1, 0);
      arm(rig, -1, 20, 70, 0, 30);
      leg(rig, 1, 70 - k * 50, 35, 50, -10); leg(rig, -1, 55 - k * 40, 30, 70, -10);
      rate = 24;
    } else {
      // mantle / climb: both hands on top, knees come up, then up and over
      torso(rig, 30 + k * 20, 0, 0, 10); headP(rig, -20);
      arm(rig, 1, 150 - k * 110, 20, 0, 40 + k * 40); arm(rig, -1, 150 - k * 110, 20, 0, 40 + k * 40);
      leg(rig, 1, 40 + k * 60, 8, 80 + k * 30, -20); leg(rig, -1, 10 + k * 70, 8, 40 + k * 60, -20);
      rate = 24;
    }
  }
  // Pose strength follows the held trick, with a separate crossfade when its family changes.
  if (a.trick && (st === "air" || st === "swing" || st === "zip")) {
    poseTricks(rig, a.trick); rate = Math.max(rate, 22);
    if ((st === "swing" || st === "zip") && a.anchorLocal) aimArm(rig, a.swingSide || 1, a.anchorLocal, 7);
    if (st === "swing" && a.anchor2Local) aimArm(rig, -(a.swingSide || 1), a.anchor2Local, 7);
  }
  // combat moves override arms/legs/torso for their duration
  if (a.attack) rate = Math.max(rate, poseAttack(rig, a.attack));
  // web shots outside a swing: the shooting arm snaps to the target for a moment
  if (a.shootLocal && st !== "swing" && st !== "zip") aimArm(rig, a.shootSide || 1, a.shootLocal, 4);
  return rate;
}

// attacks: { kind, k (0..1 through it), side, impact (optional normalized contact time) }
function poseAttack(rig, at) {
  const k = cl(at.k ?? .5, 0, 1), s = at.side || 1, contact = cl(at.impact ?? .42, .15, .85);
  const ease = (x) => { x = cl(x, 0, 1); return x * x * (3 - 2 * x); };
  const windEnd = contact * .5, wind = ease(k / windEnd);
  const hit = ease((k - windEnd) / (contact - windEnd)), rec = ease((k - contact) / (1 - contact));
  const ext = k < windEnd ? -.4 * wind : k < contact ? -.4 + 1.4 * hit : 1 - rec;
  switch (at.kind) {
    case "jab": case "cross": {
      const tw = at.kind === "cross" ? 35 : 15;
      torso(rig, 10 + Math.max(0, ext) * 5, -s * tw * ext, -s * Math.max(0, ext) * 4, 4, -s * tw * .5 * ext); headP(rig, -6, s * 8 * ext);
      arm(rig, s, 20 + 72 * Math.max(0, ext), 10, 0, 110 - 105 * Math.max(0, ext)); hand(rig, s, 85);
      arm(rig, -s, 40, 15, 0, 120); hand(rig, -s, 85);
      leg(rig, s, 25, 8, 30); leg(rig, -s, -12, 10, 20);
      return 30;
    }
    case "hook": {
      torso(rig, 12, -s * 45 * ext, 0, 6); headP(rig, -6, s * 15 * ext);
      arm(rig, s, 80, 70 - 40 * Math.max(0, ext), 0, 95); hand(rig, s, 85);
      arm(rig, -s, 40, 15, 0, 120);
      leg(rig, s, 20, 10, 35); leg(rig, -s, -10, 12, 25);
      return 30;
    }
    case "uppercut": case "launch": {
      torso(rig, 20 - 45 * Math.max(0, ext), -s * 20 * ext, 0, -10 * Math.max(0, ext)); headP(rig, -20 * Math.max(0, ext));
      arm(rig, s, 40 + 120 * Math.max(0, ext), 10, 0, 100 - 60 * Math.max(0, ext)); hand(rig, s, 85);
      arm(rig, -s, 20, 30, 0, 90);
      leg(rig, s, 20 + 30 * (1 - Math.max(0, ext)), 8, 60 * (1 - Math.max(0, ext)) + 10); leg(rig, -s, -15, 10, 20);
      return 28;
    }
    case "kick": {
      torso(rig, -20 * Math.max(0, ext), s * 10, 0, -6); headP(rig, 10);
      leg(rig, s, 10 + 95 * Math.max(0, ext), 8, 90 - 85 * Math.max(0, ext), 20); leg(rig, -s, -5, 10, 15);
      arm(rig, s, -20, 40, 0, 60); arm(rig, -s, 30, 30, 0, 80);
      return 30;
    }
    case "roundhouse": case "spin": {
      torso(rig, -10, s * 30 * ext, -s * 35 * Math.max(0, ext), -5); headP(rig, 0, -s * 30 * ext);
      leg(rig, s, 40 * Math.max(0, ext), 85 * Math.max(0, ext), 20 + 70 * (1 - Math.max(0, ext)), 20, -40); leg(rig, -s, -5, 8, 20);
      arm(rig, s, 10, 60, 0, 40); arm(rig, -s, 30, 50, 0, 70);
      return 28;
    }
    case "air": {
      // aerial strikes alternate fists and a knee
      const alt = (at.n || 0) % 3;
      torso(rig, 20, -s * 25 * ext, 0, 6);
      if (alt === 2) { leg(rig, s, 90 * Math.max(0, ext) + 20, 8, 120); arm(rig, s, 40, 30, 0, 100); }
      else { arm(rig, s, 30 + 70 * Math.max(0, ext), 10, 0, 100 - 95 * Math.max(0, ext)); hand(rig, s, 85); leg(rig, s, 40, 8, 70); }
      leg(rig, -s, 20, 10, 60); arm(rig, -s, 30, 25, 0, 100);
      return 28;
    }
    case "slam": {
      torso(rig, 50 * Math.max(0, ext), 0, 0, 20); headP(rig, -10);
      arm(rig, 1, 160 - 120 * Math.max(0, ext), 15, 0, 30); arm(rig, -1, 160 - 120 * Math.max(0, ext), 15, 0, 30);
      hand(rig, 1, 85); hand(rig, -1, 85);
      leg(rig, 1, 60, 10, 90); leg(rig, -1, 60, 10, 90);
      return 26;
    }
    case "dodge": {
      const side = at.dir || 1;
      const duck = Math.sin(k * PI);
      torso(rig, 16 + duck * 14, -side * duck * 14, -side * 34 * duck, 8); headP(rig, -12, side * 15 * duck);
      leg(rig, side, 30 + duck * 25, 18 + duck * 18, 45 + duck * 40, -12);
      leg(rig, -side, 20 + duck * 15, 22, 35 + duck * 30, -8);
      arm(rig, side, 38, 54, 0, 72); arm(rig, -side, 50, 24, 0, 105);
      if (rig.look.style < 2.5) rig.poseOffset.y = -.15 * duck;
      return 26;
    }
    case "web": {
      // a two-handed web shot / pull: both wrists forward, then a yank back
      const pull = cl((k - .45) / .3, 0, 1);
      torso(rig, 6 - pull * 20, 0, 0, 0);
      arm(rig, 1, 85 - pull * 50, 5, 0, 10 + pull * 80); arm(rig, -1, 85 - pull * 50, 5, 0, 10 + pull * 80);
      hand(rig, 1, 10); hand(rig, -1, 10);
      leg(rig, 1, 20, 10, 25); leg(rig, -1, -10, 10, 15);
      return 26;
    }
    case "throw": {
      // swing whatever the line holds round overhead and let it fly
      torso(rig, 10 + 20 * Math.max(0, ext), -s * 50 * ext, 0, 6);
      arm(rig, s, 120 * (1 - Math.max(0, ext)) + 60, 40, 0, 20); arm(rig, -s, 50, 30, 0, 50);
      leg(rig, s, 30, 10, 30); leg(rig, -s, -15, 12, 20);
      return 22;
    }
    case "hit": {
      // taking a hit: knocked back, arms up
      torso(rig, -25 * Math.sin(k * PI), 0, 10, -10); headP(rig, -25 * Math.sin(k * PI));
      arm(rig, 1, 40, 40, 0, 80); arm(rig, -1, 40, 40, 0, 80);
      return 24;
    }
    case "down": {
      // knocked down, lying on the back
      torso(rig, -10, 0, 0, -5); headP(rig, -10);
      arm(rig, 1, 20, 70, 0, 20); arm(rig, -1, 10, 60, 0, 30);
      leg(rig, 1, 15, 15, 10); leg(rig, -1, 5, 10, 30);
      return 10;
    }
    case "webbed": {
      // cocooned: arms pinned to the sides, legs together
      torso(rig, 0, 0, 0, 0); headP(rig, 5 * Math.sin(at.t * 6));
      arm(rig, 1, 0, 3, 0, 0); arm(rig, -1, 0, 3, 0, 0); leg(rig, 1, 0, 1, 0); leg(rig, -1, 0, 1, 0);
      return 14;
    }
    case "aim": {
      // a gunman aiming at the target
      torso(rig, 5, -20, 0, 0); headP(rig, 0, 15);
      arm(rig, -1, 90, 0, 0, 5); arm(rig, 1, 80, -20, 0, 40);
      leg(rig, 1, 10, 10, 10); leg(rig, -1, -10, 10, 10);
      return 16;
    }
    case "parry": {
      // forearms crossed up in a guard; a parried blow is shoved aside with the lead arm
      const up = ease(k / .25), shove = at.riposte ? sin(cl((k - .2) / .6, 0, 1) * PI) : 0;
      torso(rig, 8 - shove * 14, -s * (10 + shove * 30), 0, 6, -s * shove * 18); headP(rig, -8, s * 10);
      arm(rig, s, 70 * up + shove * 30, 30 + shove * 40, 0, 120 * up - shove * 70); hand(rig, s, 70);
      arm(rig, -s, 78 * up, 26, 0, 125 * up); hand(rig, -s, 80);
      leg(rig, s, 28, 12, 42, -10); leg(rig, -s, -16, 14, 26, 6);
      if (rig.look.style < 2.5) rig.poseOffset.y = -.1 * up;
      return 32;
    }
    case "burst": {
      // gathered low, then everything thrown outwards at once
      const gather = ease(k / contact), out = k < contact ? 0 : 1 - ease((k - contact) / (1 - contact)) * .6;
      torso(rig, 30 * gather * (1 - out) - 12 * out, 0, 0, 12 * gather - 14 * out); headP(rig, 18 * gather - 22 * out);
      for (const q of [1, -1]) {
        arm(rig, q, 40 * gather * (1 - out) + 30 * out, 20 + 70 * out, 0, 120 * gather * (1 - out) + 10 * out); hand(rig, q, 60 * (1 - out));
        leg(rig, q, 70 * gather * (1 - out) + 10 * out, 14 + 20 * out, 100 * gather * (1 - out) + 10 * out, -20 * gather);
      }
      if (rig.look.style < 2.5) rig.poseOffset.y = -.4 * gather * (1 - out);
      return 30;
    }
    case "emote": return poseEmote(rig, at);
  }
  return 20;
}
// emotes: wave, salute, flex, dance, cheer, point, sit, bow
function poseEmote(rig, at) {
  const t = at.t;
  switch (at.id) {
    case 0: arm(rig, 1, 10, 150 + sin(t * 9) * 20, 0, 30); torso(rig, 0, 0, -5); headP(rig, 0, 10); return 12;
    case 1: arm(rig, -1, 70, 50, 0, 140); hand(rig, -1, 0); torso(rig, -3); headP(rig, -5); return 14;
    case 2: arm(rig, 1, 0, 90, 0, 120); arm(rig, -1, 0, 90, 0, 120); hand(rig, 1, 90); hand(rig, -1, 90); torso(rig, -6, 0, 0, -6); leg(rig, 1, 0, 14); leg(rig, -1, 0, 14); return 12;
    case 3: { const b = sin(t * 7); torso(rig, 6, b * 15, b * 6, 0, -b * 10); arm(rig, 1, 60 + b * 40, 40, 0, 90); arm(rig, -1, 60 - b * 40, 40, 0, 90); leg(rig, 1, 15 + b * 15, 10, 30 + b * 20); leg(rig, -1, 15 - b * 15, 10, 30 - b * 20); headP(rig, b * 8, b * 15); return 16; }
    case 4: arm(rig, 1, 10, 165, 0, 10); arm(rig, -1, 10, 165, 0, 10); hand(rig, 1, 85); hand(rig, -1, 85); torso(rig, -10 + sin(t * 8) * 3, 0, 0, -6); headP(rig, -15); return 14;
    case 5: arm(rig, 1, 90, 10, 0, 0); hand(rig, 1, 40); torso(rig, 0, 20); headP(rig, 0, 20); return 14;
    case 6: torso(rig, 10); leg(rig, 1, 90, 10, 90); leg(rig, -1, 85, 12, 95); arm(rig, 1, 30, 15, 0, 40); arm(rig, -1, 30, 15, 0, 40); return 10;
    case 7: torso(rig, 50, 0, 0, 10); headP(rig, 20); arm(rig, 1, 20, 10, 0, 60); arm(rig, -1, -10, 10, 0, 10); return 12;
  }
  return 12;
}
export const EMOTES = ["Wave", "Salute", "Flex", "Dance", "Cheer", "Point", "Sit", "Bow"];

