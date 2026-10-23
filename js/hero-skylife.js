// Life above the streets of New Meridian: news and police helicopters circling the skyline (with a
// searchlight sweeping the streets at night), and flocks of pigeons wheeling over the rooftops that
// scatter when the hero comes through. Everything follows the shared clock, so the helicopters are in
// the same places for every player; the birds are local.
import * as THREE from "three";

function rng(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4(), _e = new THREE.Euler();

function helicopter(livery) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: livery, roughness: .45, metalness: .35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: .6, metalness: .2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a38, roughness: .1, metalness: .6 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  const cab = add(new THREE.SphereGeometry(1, 14, 10), body, 0, 0, 0); cab.scale.set(1.25, 1.15, 2.3);
  const nose = add(new THREE.SphereGeometry(1, 12, 8), glass, 0, .15, 1.15); nose.scale.set(1.05, .9, 1.2);
  const boom = add(new THREE.CylinderGeometry(.22, .4, 5.6, 8), body, 0, .35, -4.4); boom.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(.12, 1.5, .9), body, 0, 1, -7);
  for (const s of [-1, 1]) { const sk = add(new THREE.BoxGeometry(.12, .12, 4), dark, s * 1.05, -1.45, .2); void sk; add(new THREE.BoxGeometry(.08, .7, .08), dark, s * 1, -1.1, .9); add(new THREE.BoxGeometry(.08, .7, .08), dark, s * 1, -1.1, -.6); }
  add(new THREE.CylinderGeometry(.15, .15, .7, 8), dark, 0, 1.45, 0);
  const rotor = new THREE.Group(); rotor.position.set(0, 1.85, 0); g.add(rotor);
  for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(11, .05, .32), dark); b.rotation.y = i * Math.PI / 2; rotor.add(b); }
  const tail = new THREE.Group(); tail.position.set(.18, 1, -7); g.add(tail);
  tail.add(new THREE.Mesh(new THREE.BoxGeometry(.04, 1.8, .14), dark));
  // the searchlight: a soft cone under the nose, only seen at night
  const beamGeo = new THREE.ConeGeometry(9, 90, 18, 1, true); beamGeo.translate(0, -45, 0);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.set(0, -1.2, 1.6); g.add(beam);
  g.traverse((o) => { if (o.isMesh && o !== beam) o.castShadow = false; });
  return { g, rotor, tail, beam, beamMat };
}

export class SkyLife {
  constructor(scene, W) {
    this.scene = scene; this.W = W;
    const rnd = rng(5150);
    // helicopters: wide circuits over different parts of the city
    this.helis = [
      { livery: 0x2b5fd9, cx: 80, cz: 60, R: 260, y: 190, sp: 26 },
      { livery: 0xe8e6e0, cx: -560, cz: -420, R: 320, y: 170, sp: -22 },
      { livery: 0x1b2a4a, cx: 520, cz: 480, R: 280, y: 160, sp: 24 },
    ].map((h, i) => ({ ...h, ...helicopter(h.livery), ph: i * 2.1 }));
    for (const h of this.helis) scene.add(h.g);
    // pigeons: one instanced mesh, the wings beaten in the vertex shader
    const homes = [], pool = W.perches.filter((p) => p.kind === "corner" && p.y > 12 && p.y < 90 && Math.max(Math.abs(p.x), Math.abs(p.z)) < 900);
    for (let i = 0; i < 400 && homes.length < 7 && pool.length; i++) {
      const p = pool[Math.floor(rnd() * pool.length)];
      if (!homes.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < 220)) homes.push(p);
    }
    this.flocks = homes.map((p) => ({ hx: p.x, hy: p.y + 16 + rnd() * 10, hz: p.z, x: p.x, y: p.y + 20, z: p.z, R: 18 + rnd() * 18, a: rnd() * 6.28, w: (rnd() < .5 ? -1 : 1) * (.32 + rnd() * .15), flee: 0, fx: 0, fz: 0 }));
    const per = 18, n = this.flocks.length * per;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, .16, -.42, .02, 0, 0, 0, -.12, 0, 0, .16, 0, 0, -.12, .42, .02, 0, 0, -.02, .2, 0, -.02, -.22, 0, .05, 0], 3));
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a2c31, side: THREE.DoubleSide });
    this.time = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat ph = float(gl_InstanceID) * 1.37;\ntransformed.y += abs(position.x) * sin(uTime * 15. + ph) * 1.1;");
    };
    mat.customProgramCacheKey = () => "pigeon1";
    this.birds = new THREE.InstancedMesh(geo, mat, n);
    this.birds.frustumCulled = false;
    this.offsets = [];
    for (let i = 0; i < n; i++) this.offsets.push([(rnd() - .5) * 10, (rnd() - .5) * 5, (rnd() - .5) * 10, rnd() * 6.28]);
    this.per = per;
    scene.add(this.birds);
  }
  setVisible(on) { for (const h of this.helis) h.g.visible = on; this.birds.visible = on; }
  update(dt, T, cam, hero, night, glows) {
    this.time.value = T;
    // ---- helicopters ----
    for (const h of this.helis) {
      const a = h.ph + T * h.sp / h.R, x = h.cx + Math.cos(a) * h.R, z = h.cz + Math.sin(a) * h.R;
      const dir = Math.sign(h.sp), tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir;
      h.g.position.set(x, h.y + Math.sin(T * .3 + h.ph) * 6, z);
      _e.set(.06, Math.atan2(tx, tz), -dir * .2, "YXZ");
      h.g.quaternion.setFromEuler(_e);
      h.rotor.rotation.y = T * 42; h.tail.rotation.x = T * 60;
      h.beamMat.opacity = night * .07;
      h.beam.rotation.x = .35 + Math.sin(T * .5 + h.ph) * .25; h.beam.rotation.z = Math.cos(T * .37 + h.ph) * .3;
      if (glows && Math.floor(T * 1.5 + h.ph) % 2 === 0) glows.add(x, h.y - 1.2, z, 1, .1, .08, 3.5 + night * 3);
    }
    // ---- pigeons ----
    const per = this.per;
    this.flocks.forEach((f, i) => {
      // put up by the hero passing close
      const dh = Math.hypot(hero.x - f.x, hero.z - f.z);
      if (f.flee <= 0 && dh < 22 && Math.abs(hero.y - f.y) < 20) { f.flee = 6; f.fx = (f.x - hero.x) / (dh || 1); f.fz = (f.z - hero.z) / (dh || 1); }
      if (f.flee > 0) {
        f.flee -= dt;
        f.x += f.fx * 16 * dt; f.z += f.fz * 16 * dt; f.y += 5 * dt;
      } else {
        // circle home, drifting back to it after a scare
        f.a += f.w * dt;
        const tx = f.hx + Math.cos(f.a) * f.R, tz = f.hz + Math.sin(f.a) * f.R, k = Math.min(1, dt * .6);
        f.x += (tx - f.x) * k; f.z += (tz - f.z) * k; f.y += (f.hy + Math.sin(f.a * 2) * 3 - f.y) * k;
      }
      const far = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2 > 450 * 450;
      if (far && !f.wasFar) for (let j = 0; j < per; j++) this.birds.setMatrixAt(i * per + j, _m.makeScale(0, 0, 0));
      f.wasFar = far;
      if (far) return;
      // fly along the circle's tangent (or straight away from the hero)
      const sg = Math.sign(f.w), head = f.flee > 0 ? Math.atan2(f.fx, f.fz) : Math.atan2(-Math.sin(f.a) * sg, Math.cos(f.a) * sg);
      _q.setFromAxisAngle(_y, head);
      for (let j = 0; j < per; j++) {
        const o = this.offsets[i * per + j], wob = T * 1.3 + o[3];
        _p.set(f.x + o[0] + Math.sin(wob) * 1.2, f.y + o[1] + Math.sin(wob * 1.7) * .8, f.z + o[2] + Math.cos(wob) * 1.2);
        this.birds.setMatrixAt(i * per + j, _m.compose(_p, _q, _s));
      }
    });
    this.birds.instanceMatrix.needsUpdate = true;
  }
}
const _y = new THREE.Vector3(0, 1, 0);
