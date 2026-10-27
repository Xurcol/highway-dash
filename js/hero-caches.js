// Hero mode collectibles: Signal Caches. Fifty glowing relays hidden round New Meridian - on roof
// corners, high ledges, low parapets - each with a faint beam so it can be spotted from the air.
// Every player finds the same places (fixed seed); what each hero has collected is saved with them.
// Picking one up pays XP and coins, every tenth pays a bonus, and all fifty pay a big one.
import * as THREE from "three";

export const CACHE_COUNT = 50;

function rng(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class Caches {
  constructor(hero) {
    this.hero = hero;
    this.list = []; this.W = null; this.mesh = null; this.beams = null;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.checkT = 0;
  }
  got() { const pr = this.hero.profile(); return (pr.caches ||= []); }
  build(W, scene) {
    if (this.W === W) return;
    this.W = W;
    // spread over the whole city: walk the perches in a seeded order and keep ones far enough apart
    const rnd = rng(9031), pool = W.perches.filter((p) => (p.kind === "corner" || p.kind === "ledge") && p.y > 6 && p.y < 230 && Math.max(Math.abs(p.x), Math.abs(p.z)) < 1000);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    this.list.length = 0;
    for (let gap = 150; this.list.length < CACHE_COUNT && gap >= 40; gap -= 30) {
      for (const p of pool) {
        if (this.list.length >= CACHE_COUNT) break;
        if (this.list.some((c) => (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < gap * gap)) continue;
        // a step in from the edge, floating at chest height
        const x = p.x - p.nx * 1.4, z = p.z - p.nz * 1.4, y = W.topAt(x, z, p.y + 2) + 1.3;
        if (!Number.isFinite(y) || Math.abs(y - 1.3 - p.y) > 1.5) continue;
        this.list.push({ id: this.list.length, x, y, z });
      }
    }
    if (this.mesh) { scene.remove(this.mesh); scene.remove(this.beams); this.mesh.geometry.dispose(); this.beams.geometry.dispose(); }
    const n = this.list.length;
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.42, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, .45), toneMapped: false }), n);
    const beamGeo = new THREE.CylinderGeometry(.12, .5, 70, 6, 1, true); beamGeo.translate(0, 35, 0);
    this.beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffc85a, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), n);
    this.mesh.frustumCulled = this.beams.frustumCulled = false;
    scene.add(this.mesh); scene.add(this.beams);
    this.refresh();
  }
  refresh() {
    if (!this.mesh) return;
    const got = new Set(this.got());
    for (const c of this.list) {
      c.taken = got.has(c.id);
      this.beams.setMatrixAt(c.id, c.taken ? this.zero : this.m.makeTranslation(c.x, c.y - 1.3, c.z));
    }
    this.beams.instanceMatrix.needsUpdate = true;
  }
  setVisible(on) { if (this.mesh) this.mesh.visible = this.beams.visible = on; }
  count() { return this.got().length; }
  update(dt, t, H, fx) {
    if (!this.mesh) return;
    // spin and bob (cheap: fifty matrices)
    this.q.setFromAxisAngle(_y, t * 1.6);
    const bob = Math.sin(t * 2.2) * .18;
    for (const c of this.list) {
      if (c.taken) { this.mesh.setMatrixAt(c.id, this.zero); continue; }
      this.p.set(c.x, c.y + bob, c.z); this.s.setScalar(1);
      this.mesh.setMatrixAt(c.id, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if ((this.checkT -= dt) > 0) return;
    this.checkT = .05;
    for (const c of this.list) {
      if (c.taken || (c.x - H.p.x) ** 2 + (c.y - H.p.y) ** 2 + (c.z - H.p.z) ** 2 > 2.8 * 2.8) continue;
      this.collect(c, fx);
    }
  }
  collect(c, fx) {
    const h = this.hero, got = this.got();
    if (got.includes(c.id)) return;
    got.push(c.id); c.taken = true;
    this.beams.setMatrixAt(c.id, this.zero); this.beams.instanceMatrix.needsUpdate = true;
    const n = got.length, total = this.list.length;
    let coins = 60, sub = "+150 XP · +60 coins";
    if (n === total) { coins += 3000; sub = "Every cache in the city · +3,000 coins"; }
    else if (n % 10 === 0) { coins += 500; sub = `${n} found · +500 bonus coins`; }
    h.reward(150, coins, "cache");
    h.hud.center(`SIGNAL CACHE ${n}/${total}`, sub, 2.2);
    fx.energy(c.x, c.y, c.z, 30, [1, .8, .35]);
    h.rings?.spawn(c.x, c.y - 1.2, c.z, 4, 0xffc85a, .5);
    h.sfx("perfect"); h.tricks?.link("cache");
  }
  // uncollected caches near a point, for the minimap
  near(x, z, r, out) {
    for (const c of this.list) if (!c.taken && (c.x - x) ** 2 + (c.z - z) ** 2 < r * r) out.push({ x: c.x, z: c.z, color: "#ffc85a" });
    return out;
  }
}
const _y = new THREE.Vector3(0, 1, 0);
