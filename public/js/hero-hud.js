// Hero mode HUD: everything drawn over the game while playing the hero, built into #hud so it shows
// and hides with it. A reticle with markers for the zip target and the swing anchor, speed and height,
// the trick combo and its feed, health and focus, the target's name and health, district names,
// mission and race panels, prompts, and the controls card.
import { HERO_KEYS } from "./hero-input.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => Math.round(n).toLocaleString();

export class HeroHud {
  constructor() {
    const host = document.getElementById("hud") || document.body;
    const el = this.el = document.createElement("div");
    el.id = "heroHud"; el.hidden = true;
    el.innerHTML = `
      <div class="hh-reticle" id="hhRet"><i></i></div>
      <div class="hh-mark zip" id="hhZip" hidden><i></i></div>
      <div class="hh-mark anchor" id="hhAnchor" hidden></div>
      <div class="hh-mark target" id="hhTarget" hidden><b></b><span><i></i></span></div>
      <div class="hh-noweb" id="hhNoWeb" hidden>NO ANCHOR</div>
      <div class="hh-sense" id="hhSense" hidden><i></i><i></i><i></i></div>
      <div class="hh-combat" id="hhCombat" hidden><b id="hhHits">0</b><small>HITS</small></div>
      <div class="hh-district" id="hhDistrict"></div>
      <div class="hh-combo" id="hhCombo" hidden>
        <div class="hh-total"><b id="hhPts">0</b><em id="hhMult">x1</em></div>
        <div class="hh-grace"><i id="hhGrace"></i></div>
        <ol id="hhFeed"></ol>
      </div>
      <div class="hh-banked" id="hhBanked" hidden></div>
      <div class="hh-score" id="hhScore"><small>STYLE</small><b id="hhStyle">0</b><small id="hhBest">BEST 0</small></div>
      <div class="hh-vitals">
        <div class="hh-hp"><i id="hhHp"></i></div>
        <div class="hh-focus" id="hhFocus"><i></i><i></i><i></i></div>
        <div class="hh-gadgets" id="hhGadgets"></div>
      </div>
      <div class="hh-speed"><b id="hhSpd">0</b><small>KM/H</small><span id="hhAlt">0 m</span><em id="hhState"></em></div>
      <div class="hh-panel" id="hhMission" hidden></div>
      <div class="hh-race" id="hhRace" hidden></div>
      <div class="hh-prompt" id="hhPrompt" hidden></div>
      <div class="hh-way" id="hhWay" hidden><i></i><b></b></div>
      <div class="hh-center" id="hhCenter" hidden></div>
      <div class="hh-keys" id="hhKeys" hidden></div>
      <div class="hh-emotes" id="hhEmotes" hidden></div>
      <div class="hh-hint" id="hhHint">H &middot; controls</div>`;
    host.appendChild(el);
    this.$ = (id) => el.querySelector("#" + id);
    this.cache = {};
    this.$("hhKeys").innerHTML = `<h4>CONTROLS</h4>` + HERO_KEYS.map(([k, a, p]) => `<div><kbd>${esc(k)}</kbd><span>${esc(a)}</span><small>${esc(p)}</small></div>`).join("");
    this.feedKey = "";
    this.bankT = 0; this.centerT = 0; this.districtT = 0;
  }
  show(on) { this.el.hidden = !on; document.body.classList.toggle("hero-mode", on); }
  set(id, v, attr = "textContent") { const k = id + attr; if (this.cache[k] === v) return; this.cache[k] = v; this.$(id)[attr] = v; }
  toggleKeys() { const k = this.$("hhKeys"); k.hidden = !k.hidden; this.$("hhHint").hidden = !k.hidden; return !k.hidden; }
  // a screen-space marker at a projected world point (or hidden)
  mark(id, sx, sy, on, extra) {
    const m = this.$(id);
    if (!on) { if (!m.hidden) m.hidden = true; return; }
    m.hidden = false;
    m.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    if (extra) extra(m);
  }
  center(text, sub = "", t = 2.2, cls = "") {
    const c = this.$("hhCenter");
    c.className = "hh-center " + cls;
    c.innerHTML = `<b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}`;
    c.hidden = false; this.centerT = t;
  }
  prompt(text) { const p = this.$("hhPrompt"); if (!text) { if (!p.hidden) p.hidden = true; return; } p.hidden = false; this.set("hhPrompt", text, "innerHTML"); }
  district(name) {
    if (!name || name === this.districtName) return;
    this.districtName = name; this.districtT = 4;
    const d = this.$("hhDistrict"); d.textContent = name; d.classList.remove("on"); void d.offsetWidth; d.classList.add("on");
  }
  // s: { speed, alt, state, tricks, hp, focus, gadgets, noWeb, ... }
  update(dt, s) {
    this.set("hhSpd", String(Math.round(s.speed * 3.6)));
    this.set("hhAlt", `${Math.max(0, Math.round(s.alt))} m`);
    this.set("hhState", s.stateLabel || "");
    this.$("hhNoWeb").hidden = !(s.noWeb > 0);
    // ---- combo ----
    const tr = s.tricks, c = tr.combo;
    const box = this.$("hhCombo");
    if (c && (c.pts > 0 || c.n > 0)) {
      box.hidden = false;
      this.set("hhPts", fmt(c.pts));
      this.set("hhMult", "x" + c.mult.toFixed(c.mult % 1 ? 1 : 0));
      this.$("hhGrace").style.width = Math.max(0, Math.min(1, c.grace ?? 1)) * 100 + "%";
    } else if (!box.hidden && !tr.feed.length) box.hidden = true;
    const key = tr.feed.map((f) => f.text + f.pts).join("|");
    if (key !== this.feedKey) {
      this.feedKey = key;
      this.$("hhFeed").innerHTML = tr.feed.slice(0, 6).map((f, i) => `<li class="${f.kind}${f.rep ? " rep" : ""}" style="--i:${i}"><span>${esc(f.text)}</span>${f.pts ? `<b>${f.pts > 0 ? "+" : ""}${fmt(f.pts)}</b>` : ""}</li>`).join("");
      if (tr.feed.length) box.hidden = false;
    }
    this.$("hhFeed").style.opacity = tr.feed.length && tr.feed[0].t > 2.5 ? Math.max(0, 1 - (tr.feed[0].t - 2.5) / 1.2) : 1;
    for (const e of s.trickEvents || []) {
      if (e.type === "banked") { const b = this.$("hhBanked"); b.innerHTML = `<b>+${fmt(e.total)}</b><small>${e.n} TRICK COMBO · x${e.mult.toFixed(1)}</small>`; b.hidden = false; b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); this.bankT = 2; }
      if (e.type === "bail") this.center("BAILED", e.lost ? `-${fmt(e.lost)}` : "", 1.4, "bail");
    }
    if (this.bankT > 0 && (this.bankT -= dt) <= 0) this.$("hhBanked").hidden = true;
    this.set("hhStyle", fmt(tr.score));
    this.set("hhBest", `BEST COMBO ${fmt(tr.best)}`);
    // ---- vitals ----
    this.$("hhHp").style.width = Math.max(0, s.hp) * 100 + "%";
    this.$("hhHp").parentNode.classList.toggle("low", s.hp < .3);
    const fe = this.$("hhFocus").children;
    for (let i = 0; i < 3; i++) fe[i].style.setProperty("--f", Math.max(0, Math.min(1, s.focus - i)).toFixed(3));
    if (s.gadgets) this.set("hhGadgets", s.gadgets, "innerHTML");
    if (this.centerT > 0 && (this.centerT -= dt) <= 0) this.$("hhCenter").hidden = true;
    // the sense: chevrons pointing at whoever is about to hit (screen-relative angle, radians)
    const se = this.$("hhSense");
    if (s.sense) { se.hidden = false; se.style.transform = `rotate(${s.sense.ang.toFixed(3)}rad)`; se.classList.toggle("heavy", !!s.sense.heavy); se.style.opacity = Math.min(1, s.sense.t * 3 + .3).toFixed(2); }
    else if (!se.hidden) se.hidden = true;
    const cb = this.$("hhCombat");
    if (s.hits > 1) { cb.hidden = false; this.set("hhHits", String(s.hits)); } else if (!cb.hidden) cb.hidden = true;
    if (this.districtT > 0 && (this.districtT -= dt) <= 0) this.$("hhDistrict").classList.remove("on");
    // ---- mission / race panels ----
    this.set("hhMission", s.mission || "", "innerHTML");
    this.$("hhMission").hidden = !s.mission;
    this.set("hhRace", s.race || "", "innerHTML");
    this.$("hhRace").hidden = !s.race;
  }
  emotes(on, names) {
    const e = this.$("hhEmotes");
    if (!on) { e.hidden = true; return; }
    if (e.hidden) e.innerHTML = names.map((n, i) => `<div><kbd>${i + 1}</kbd>${esc(n)}</div>`).join("");
    e.hidden = false;
  }
}
