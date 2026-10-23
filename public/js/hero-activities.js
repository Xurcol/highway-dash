// Hero mode activities: races through the city (solo time trials, or everyone in the server on the same
// route at once), Trick Attack (the most style in 90 seconds), and challenging the boss. Opened from the
// activities menu (K) or chat (/race, /tricks). Online, whoever starts one invites the room; everyone
// who joins races the same checkpoints from the same start, times themselves, and the results go out to
// everyone.
import * as THREE from "three";
import { HIP_H } from "./hero-rig.js";

const V = THREE.Vector3;
export const ROUTES = [
  { id: "downtown", name: "Downtown Dash", note: "A lap of the financial district", pts: [[0, 60, -160], [200, 70, -200], [210, 55, 20], [100, 30, 100], [-120, 50, 110], [-210, 70, -100], [-40, 60, -230], [0, 60, -160]] },
  { id: "ring", name: "Ring Run", note: "Once round the expressway", pts: [[0, 16, -720], [600, 16, -600], [720, 16, 0], [600, 16, 600], [0, 16, 720], [-600, 16, 600], [-720, 16, 0], [-600, 16, -600], [0, 16, -720]] },
  { id: "bridges", name: "Bridge to Bridge", note: "Meridian Bridge to Southgate", pts: [[1330, 45, 0], [1050, 40, 220], [760, 45, 480], [420, 40, 760], [120, 35, 1000], [0, 40, 1330]] },
  { id: "port", name: "Port Sprint", note: "Downtown down to the docks", pts: [[0, 50, -300], [-150, 45, -620], [-380, 35, -980], [-380, 12, -1300], [0, 20, -1260], [418, 26, -1290], [780, 20, -1330]] },
  { id: "skyline", name: "Skyline Climb", note: "Up and over the tallest towers", pts: [[0, 40, 160], [60, 140, 60], [-60, 180, -60], [50, 290, -50], [-50, 330, 50], [0, 120, 260]] },
  { id: "underground", name: "Under the City", note: "Through the subway tunnel and back up", pts: [[-460, 20, 50], [-350, -4, 50], [0, -5, 50], [350, -4, 50], [460, 20, 50]] },
];
const TRICK_TIME = 90;

export class Activities {
  constructor(hero) {
    this.hero = hero;
    this.race = null;       // { id, route, start (net time ms), joined: Set, results: Map, mine: { i, t0, done } }
    this.tricks = null;     // { id, start, end, joined, results, base }
    this.invite = null;     // a pending invitation from another player
    this.rings = null;
    this.menuEl = null;
  }
  get net() { return this.hero.ctx.net; }
  get online() { return this.hero.online && !!this.net.room; }
  now() { return this.online ? this.net.now() : performance.now(); }
  me() { return this.hero.meId(); }
  best() { return (this.hero.profile().races ||= {}); }

  // ------------------------------------------------------------------ starting
  start(kind, arg) {
    if (kind === "endwaves") { this.endWaves("SURVIVAL ENDED"); return { ok: true, text: "Back to free roam." }; }
    if (kind === "waves") return this.startWaves();
    if (this.waves) return { ok: false, text: "End Wave Survival in K before starting another activity." };
    if (kind === "race") {
      const r = ROUTES.find((q) => q.id === arg || q.name.toLowerCase().startsWith(String(arg || "").toLowerCase())) || ROUTES[0];
      if (this.race && !this.race.over) return { ok: false, text: "A race is already on." };
      const id = (Math.random() * 1e9) | 0, start = this.now() + (this.online ? 12000 : 3500);
      this.openRace({ id, route: r.id, start, by: this.me() });
      this.join("race");
      if (this.online) this.hero.sendWorld({ k: "race", op: "open", id, route: r.id, start, by: this.hero.ctx.net.me?.name || "Hero" });
      return { ok: true, text: this.online ? `${r.name}: race starts in 12 s - everyone can join (K)` : `${r.name}: go!` };
    }
    if (kind === "tricks") {
      if (this.tricks && !this.tricks.over) return { ok: false, text: "A trick contest is already on." };
      const id = (Math.random() * 1e9) | 0, start = this.now() + (this.online ? 8000 : 3000);
      this.openTricks({ id, start, by: this.me() });
      this.join("tricks");
      if (this.online) this.hero.sendWorld({ k: "tricks", op: "open", id, start });
      return { ok: true, text: this.online ? "Trick Attack starts in 8 s - everyone can join (K)" : "Trick Attack: 90 seconds of style!" };
    }
    if (kind === "boss") {
      const p = this.hero.H.p;
      if (this.hero.authority()) { const e = this.hero.events.start("boss", { x: p.x, z: p.z }, true); return e ? { ok: true, text: "VANTA is coming." } : { ok: false, text: "Nowhere for a showdown near here." }; }
      this.hero.sendWorld({ k: "boss", x: p.x, z: p.z });
      return { ok: true, text: "Challenge sent - VANTA is coming." };
    }
    return { ok: false, text: "Unknown activity." };
  }
  openRace(o) {
    const route = ROUTES.find((q) => q.id === o.route) || ROUTES[0];
    this.race = { ...o, routeDef: route, joined: new Set([o.by]), results: new Map(), mine: null, over: false };
    this.buildRings(route);
  }
  openTricks(o) { this.tricks = { ...o, end: o.start + TRICK_TIME * 1000, joined: new Set([o.by]), results: new Map(), mine: null, over: false }; }
  join(kind) {
    const H = this.hero.H;
    if (kind === "race" && this.race && !this.race.over) {
      const R = this.race, r = R.routeDef, me = this.me();
      R.joined.add(me);
      R.mine = { i: 1, t0: null, done: false, joined: true };
      // to the start, on a grid, facing the first checkpoint
      const n = [...R.joined].indexOf(me), [sx, sy, sz] = r.pts[0], [nx, , nz] = r.pts[1];
      const dx = nx - sx, dz = nz - sz, L = Math.hypot(dx, dz) || 1, side = ((n % 4) - 1.5) * 3, back = Math.floor(n / 4) * 4 + 4;
      const x = sx - dx / L * back - dz / L * side, z = sz - dz / L * back + dx / L * side;
      H.reset(x, Math.max(sy, this.hero.W.topAt(x, z, sy + 3) + HIP_H + .1), z); H.state = "air"; H.v.set(0, 0, 0);
      H.face.set(dx / L, 0, dz / L); this.hero.cam.yaw = Math.atan2(-dx, -dz); this.hero.cam.snapNext = true;
      this.hero.tpN = (this.hero.tpN | 0) + 1;
      this.freeze = true;
      if (this.online && R.by !== me) this.hero.sendWorld({ k: "race", op: "join", id: R.id });
    }
    if (kind === "tricks" && this.tricks && !this.tricks.over) {
      this.tricks.joined.add(this.me());
      this.tricks.mine = { base: null };
      if (this.online && this.tricks.by !== this.me()) this.hero.sendWorld({ k: "tricks", op: "join", id: this.tricks.id });
    }
    this.invite = null;
  }

  // ------------------------------------------------------------------ per frame
  startWaves() {
    const h = this.hero;
    if (this.online) return { ok: false, text: "Choose Explore alone in the city menu, then K → Wave Survival." };
    if (this.waves) return { ok: false, text: "Wave Survival is already running." };
    if (this.race && !this.race.over || this.tricks && !this.tricks.over)
      return { ok: false, text: "Finish your current activity first." };
    const p = h.events.sidewalk(h.H.p.x, h.H.p.z, 180);
    if (!p) return { ok: false, text: "Move closer to a city street to start survival." };
    h.H.reset(p.x, p.y + HIP_H, p.z); h.H.state = "ground"; h.afterTeleport();
    h.combat.reset();
    this.waves = { x: p.x, z: p.z, wave: 0, cleared: 0, timer: 4, fighting: false, ids: [] };
    h.hud.center("WAVE SURVIVAL", "Get ready · Stay within 100 m · K to end", 3);
    return { ok: true, text: "Wave Survival: clear each wave to recover 25% health." };
  }
  clearWaveEnemies() {
    const h = this.hero, w = this.waves;
    if (!w) return;
    h.sim.shots = h.sim.shots.filter(s => !w.ids.includes(s.from));
    for (const id of w.ids) { const e = h.sim.byId.get(id); if (e) h.sim.remove(e); }
    w.ids.length = 0;
  }
  endWaves(title) {
    const w = this.waves;
    if (!w) return;
    this.clearWaveEnemies(); this.waves = null; this.raceHtml = "";
    this.hero.hud.center(title, `${w.cleared} waves cleared · K to play again`, 3);
  }
  updateWaves(dt) {
    const h = this.hero, w = this.waves;
    if (!w) return "";
    if (this.online || h.combat.downT > 0 || h.combat.hp <= 0) { this.endWaves("SURVIVAL OVER"); return ""; }
    if (Math.hypot(h.H.p.x - w.x, h.H.p.z - w.z) > 100) { this.endWaves("LEFT THE ARENA"); return ""; }
    let left = 0;
    for (const id of w.ids) { const e = h.sim.byId.get(id); if (e && h.sim.alive(e)) left++; }
    if (w.fighting && left === 0) {
      w.cleared = w.wave; w.fighting = false; w.timer = 7;
      this.clearWaveEnemies();
      h.combat.hp = Math.min(1, h.combat.hp + .25);
      const pr = h.profile(); pr.waveBest = Math.max(pr.waveBest || 0, w.cleared); h.ctx.save();
      h.hud.center(`WAVE ${w.wave} CLEARED`, "25% health restored · Next wave in 7 seconds", 3);
    }
    if (!w.fighting) {
      w.timer -= dt;
      if (w.timer <= 0) {
        w.wave++;
        const count = Math.min(12, 3 + w.wave);
        for (let i = 0; i < count; i++) {
          const angle = i / count * Math.PI * 2;
          const p = h.events.sidewalk(w.x + Math.cos(angle) * 16, w.z + Math.sin(angle) * 16, 16);
          if (!p) continue;
          const kind = w.wave % 5 === 0 && i === 0 ? "boss" : w.wave >= 3 && i % 5 === 0 ? "brute" : w.wave >= 2 && i % 4 === 0 ? "gunner" : i % 2 ? "bat" : "thug";
          const e = h.sim.spawn(kind, p.x, p.z, { y: p.y, guard: 100, hpK: 1 + Math.min(.75, (w.wave - 1) * .05) });
          e.alert = true; w.ids.push(e.id);
        }
        if (!w.ids.length) { this.endWaves("NO ROOM FOR A WAVE"); return ""; }
        w.fighting = true; left = w.ids.length;
        h.hud.center(`WAVE ${w.wave}`, w.wave % 5 === 0 ? "VANTA has entered the fight" : `${left} enemies incoming`, 2);
      }
    }
    return `<small>WAVE SURVIVAL · BEST ${h.profile().waveBest || 0}</small><b>Wave ${w.fighting ? w.wave : w.wave + 1}</b><small>${w.fighting ? `${left} enemies left` : `Starts in ${Math.max(0, Math.ceil(w.timer))}s · Recover`}</small><small>K · End survival</small>`;
  }
  update(dt) {
    const h = this.hero, H = h.H, now = this.now();
    let race = "";
    const R = this.race;
    if (R && !R.over) {
      const left = (R.start - now) / 1000;
      if (R.mine && !R.mine.done) {
        if (left > 0) {
          // held at the start until the light
          if (this.freeze) { H.v.set(0, 0, 0); if (H.state === "air") H.v.y = 0; }
          race = `<b>${Math.ceil(left)}</b><small>${R.routeDef.name.toUpperCase()} · GET READY</small>`;
          if (Math.ceil(left) !== this.lastCount && left < 3.5) { this.lastCount = Math.ceil(left); h.sfx("sense"); }
        } else {
          if (this.freeze) { this.freeze = false; h.hud.center("GO!", "", .8); h.sfx("perfect"); }
          if (R.mine.t0 === null) R.mine.t0 = R.start;
          const t = (now - R.mine.t0) / 1000, p = R.routeDef.pts[R.mine.i];
          const d = Math.hypot(H.p.x - p[0], H.p.y - p[1], H.p.z - p[2]);
          if (d < 11) {
            R.mine.i++;
            h.sfx("perfect");
            if (R.mine.i >= R.routeDef.pts.length) this.finishRace(t);
            else h.hud.center(`CHECKPOINT ${R.mine.i - 1}/${R.routeDef.pts.length - 1}`, fmtT(t), .8, "small");
          }
          const pos = this.raceRank();
          race = `<b>${fmtT(t)}</b><small>CHECKPOINT ${Math.min(R.mine.i, R.routeDef.pts.length - 1)}/${R.routeDef.pts.length - 1}${pos ? ` · ${pos}` : ""}${this.best()[R.route] ? ` · BEST ${fmtT(this.best()[R.route])}` : ""}</small>`;
        }
      } else if (R.mine?.done) race = `<b>${fmtT(R.mine.time)}</b><small>FINISHED · ${this.raceRank() || ""}</small>${this.resultsHtml(R.results, true)}`;
      // everyone done, or long enough: it's over
      if (now > R.start + 6 * 60000 || (R.joined.size && [...R.joined].every((id) => R.results.has(id)))) this.endRace();
    }
    const Tr = this.tricks;
    if (Tr && !Tr.over && Tr.mine) {
      const left = (Tr.start - now) / 1000, rem = (Tr.end - now) / 1000;
      if (left > 0) race = `<b>${Math.ceil(left)}</b><small>TRICK ATTACK · GET READY</small>`;
      else if (rem > 0) {
        if (Tr.mine.base === null) { Tr.mine.base = h.tricks.score; h.hud.center("TRICK ATTACK", "Style, style, style", 1.2); }
        const live = h.tricks.combo ? h.tricks.combo.pts * h.tricks.combo.mult : 0;
        Tr.mine.score = Math.round(h.tricks.score - Tr.mine.base + live);
        race = `<b>${Math.ceil(rem)}</b><small>TRICK ATTACK · ${Tr.mine.score.toLocaleString()} PTS${this.trickRank()}</small>`;
      } else {
        // time: bank what's in the air and post the score
        h.tricks.bank();
        const score = Math.round(h.tricks.score - Tr.mine.base);
        Tr.results.set(this.me(), { name: this.net.me?.name || "You", score });
        if (this.online) h.sendWorld({ k: "tricks", op: "score", id: Tr.id, score });
        const pr = h.profile(); pr.trickBest = Math.max(pr.trickBest || 0, score);
        h.reward(Math.round(80 + score / 200), Math.round(score / 60), "Trick Attack");
        Tr.over = true; Tr.overAt = now;
        h.hud.center(`${score.toLocaleString()} PTS`, `Trick Attack over · best ${pr.trickBest.toLocaleString()}`, 3);
      }
    }
    if (Tr?.over && now - Tr.overAt < 15000) race = race || `<small>TRICK ATTACK RESULTS</small>${this.resultsHtml(Tr.results, false)}`;
    if (this.invite && now > this.invite.start) this.invite = null;
    if (this.invite) race = race || `<small>${this.invite.text}</small><small>Press K to join</small>`;
    this.raceHtml = this.updateWaves(dt) || race;
    this.drawRings(dt);
  }
  finishRace(t) {
    const R = this.race, h = this.hero;
    R.mine.done = true; R.mine.time = t;
    R.results.set(this.me(), { name: this.net.me?.name || "You", time: t });
    const best = this.best(), prev = best[R.route];
    if (!prev || t < prev) best[R.route] = t;
    h.hud.center("FINISH", `${fmtT(t)}${!prev || t < prev ? " · NEW BEST" : ` · best ${fmtT(prev)}`}`, 3);
    h.reward(150 + Math.max(0, Math.round(300 - t)), 120, "Race");
    if (this.online) h.sendWorld({ k: "race", op: "finish", id: R.id, time: Math.round(t * 1000) / 1000 });
    h.ctx.save();
  }
  endRace() {
    const R = this.race;
    if (!R || R.over) return;
    R.over = true;
    setTimeout(() => { if (this.race === R) { this.race = null; this.clearRings(); } }, 15000);
  }
  raceRank() {
    const R = this.race;
    if (!R || !this.online) return "";
    // live order: finished by time, then by checkpoints reached
    const rows = [];
    for (const id of R.joined) {
      if (R.results.has(id)) { rows.push({ id, k: 1e6 - R.results.get(id).time }); continue; }
      if (id === this.me()) { rows.push({ id, k: R.mine?.i || 0 }); continue; }
      const v = this.hero.netx?.list().find((q) => q.id === id);
      rows.push({ id, k: v?.rc?.[0] === R.id ? v.rc[1] : 0 });
    }
    rows.sort((a, b) => b.k - a.k);
    const i = rows.findIndex((r) => r.id === this.me());
    return i >= 0 ? `${ord(i + 1)} OF ${rows.length}` : "";
  }
  trickRank() {
    const T = this.tricks;
    if (!T || !this.online) return "";
    const mine = T.mine?.score || 0;
    const better = (this.hero.netx?.list() || []).filter((v) => v.rc?.[2] === 1 && v.rc[0] === T.id && v.rc[1] > mine).length;
    return ` · ${ord(better + 1)}`;
  }
  resultsHtml(res, race) {
    const rows = [...res.values()].sort((a, b) => (race ? a.time - b.time : b.score - a.score));
    return `<ol class="hh-results">${rows.slice(0, 8).map((r) => `<li><span>${esc(r.name)}</span><b>${race ? fmtT(r.time) : r.score.toLocaleString()}</b></li>`).join("")}</ol>`;
  }
  // what goes in this hero's state packet so others can rank the race live
  raceProgress() {
    const R = this.race, T = this.tricks;
    if (R && R.mine && !R.over) return [R.id, R.mine.i, 0];
    if (T && T.mine && !T.over && T.mine.score !== undefined) return [T.id, T.mine.score, 1];
    return undefined;
  }

  // ------------------------------------------------------------------ the network
  onWorld(from, w) {
    const name = this.net.peers.get(from)?.name || "A player";
    if (w.k === "race") {
      if (w.op === "open" && (!this.race || this.race.over)) {
        const r = ROUTES.find((q) => q.id === w.route);
        if (!r) return;
        this.openRace({ id: +w.id, route: r.id, start: +w.start, by: from });
        this.invite = { kind: "race", start: +w.start, text: `${esc(name)} started a race: ${r.name}` };
        this.hero.ctx.ui?.toast(`${name} started a race: ${r.name}`, [{ label: "JOIN", run: () => this.join("race") }], "info");
      }
      const R = this.race;
      if (!R || +w.id !== R.id) return;
      if (w.op === "join") R.joined.add(from);
      if (w.op === "finish") { R.results.set(from, { name, time: +w.time }); this.hero.ctx.ui?.toast(`${name} finished in ${fmtT(+w.time)}`, [], "info"); }
    }
    if (w.k === "tricks") {
      if (w.op === "open" && (!this.tricks || this.tricks.over)) {
        this.openTricks({ id: +w.id, start: +w.start, by: from });
        this.invite = { kind: "tricks", start: +w.start, text: `${esc(name)} started Trick Attack` };
        this.hero.ctx.ui?.toast(`${name} started Trick Attack`, [{ label: "JOIN", run: () => this.join("tricks") }], "info");
      }
      const T = this.tricks;
      if (!T || +w.id !== T.id) return;
      if (w.op === "join") T.joined.add(from);
      if (w.op === "score") T.results.set(from, { name, score: Math.max(0, +w.score | 0) });
    }
    if (w.k === "boss" && this.hero.authority()) this.hero.events.start("boss", { x: +w.x || 0, z: +w.z || 0 }, true);
  }
  snapshot() { return null; }
  applySnap() { }

  // ------------------------------------------------------------------ checkpoint rings
  buildRings(route) {
    this.clearRings();
    const sc = this.hero.ctx.scene, g = new THREE.Group();
    const geo = new THREE.TorusGeometry(9, .35, 8, 48);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: .85, toneMapped: false, depthWrite: false });
    route.pts.forEach((p, i) => {
      const m = new THREE.Mesh(geo, mat.clone());
      m.position.set(p[0], p[1], p[2]);
      const q = route.pts[Math.min(i + 1, route.pts.length - 1)], pr = route.pts[Math.max(0, i - 1)];
      const dir = new V(q[0] - pr[0], q[1] - pr[1], q[2] - pr[2]).normalize();
      m.lookAt(m.position.clone().add(dir));
      m.userData.i = i;
      g.add(m);
    });
    sc.add(g);
    this.rings = g;
  }
  drawRings(dt) {
    const R = this.race;
    if (!this.rings) return;
    const cur = R?.mine ? R.mine.i : 1;
    for (const m of this.rings.children) {
      const i = m.userData.i, next = i === cur, last = i === this.rings.children.length - 1;
      m.visible = i >= cur - (R?.mine ? 0 : 1) && i <= cur + 2;
      m.material.color.setHex(last ? 0xffd23b : next ? 0x7fe9ff : 0x4a6a7a);
      m.material.opacity = next ? .95 : .4;
      m.scale.setScalar(next ? 1 + Math.sin(performance.now() / 180) * .05 : .85);
    }
    const p = R && R.mine && !R.mine.done ? R.routeDef.pts[Math.min(R.mine.i, R.routeDef.pts.length - 1)] : null;
    this.target = p ? { x: p[0], y: p[1], z: p[2] } : null;
  }
  clearRings() { if (this.rings) { this.hero.ctx.scene.remove(this.rings); this.rings.traverse((o) => { o.material?.dispose?.(); }); this.rings = null; } this.target = null; }
  clear() { this.clearRings(); this.race = null; this.tricks = null; this.invite = null; this.freeze = false; this.closeMenu(); }

  // ------------------------------------------------------------------ the menu (K)
  toggleMenu() { if (this.menuEl && !this.menuEl.hidden) this.closeMenu(); else this.openMenu(); }
  closeMenu() { if (this.menuEl) this.menuEl.hidden = true; this.hero.input.wantLock = true; }
  openMenu() {
    const h = this.hero;
    if (!this.menuEl) {
      this.menuEl = document.createElement("div");
      this.menuEl.className = "hh-menu";
      (document.getElementById("hud") || document.body).appendChild(this.menuEl);
      this.menuEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]");
        if (!b) return;
        const [kind, arg] = b.dataset.act.split(":");
        if (kind === "close") return this.closeMenu();
        if (kind === "join") { this.join(arg); this.closeMenu(); return; }
        if (kind === "suit" || kind === "skill") { h.progress?.act(kind, arg); this.openMenu(); return; }
        const r = this.start(kind, arg);
        h.ctx.ui?.toast(r.text, [], r.ok ? "success" : "warn");
        if (r.ok) this.closeMenu();
      });
    }
    h.input.unlock(); h.input.wantLock = false;
    const best = this.best(), pr = h.profile();
    const inv = this.invite ? `<div class="hm-invite">${this.invite.text}<button class="btn green" data-act="join:${this.invite.kind}">JOIN</button></div>` : "";
    this.menuEl.innerHTML = `<div class="hm-card">
      <div class="hm-head"><h3>ACTIVITIES</h3><button class="btn gray" data-act="close">CLOSE · K</button></div>
      ${inv}
      <h4>RACES${this.online ? " · starts a race for everyone in the server" : ""}</h4>
      <div class="hm-list">${ROUTES.map((r) => `<button data-act="race:${r.id}"><b>${r.name}</b><small>${r.note} · ${r.pts.length - 1} checkpoints${best[r.id] ? " · best " + fmtT(best[r.id]) : ""}</small></button>`).join("")}</div>
      <h4>CHALLENGES</h4>
      <div class="hm-list">
        <button data-act="${this.waves ? "endwaves" : "waves"}"><b>${this.waves ? "End Wave Survival" : "Wave Survival"}</b><small>Solo combat · Escalating waves · VANTA every 5 waves · Best ${pr.waveBest || 0}</small></button>
        <button data-act="tricks"><b>Trick Attack</b><small>90 seconds: the most style wins${pr.trickBest ? " · best " + pr.trickBest.toLocaleString() : ""}</small></button>
        <button data-act="boss"><b>Challenge VANTA</b><small>The city's worst, with a crew. Better with friends.</small></button>
      </div>
      ${h.progress ? h.progress.html() : ""}
    </div>`;
    this.menuEl.hidden = false;
  }
}
const fmtT = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? "0" : ""}${s.toFixed(2)}`; };
const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "ST" : n % 10 === 2 && n % 100 !== 12 ? "ND" : n % 10 === 3 && n % 100 !== 13 ? "RD" : "TH");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
