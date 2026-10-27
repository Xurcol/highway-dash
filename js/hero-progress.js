// Hero mode progression: XP from crimes, rescues, races, trick contests and takedowns levels the hero
// up; each level is a skill point. Skills change real numbers in the movement and the fight (swing
// speed, launches, air dashes, damage, focus, gadget cooldowns, health, trick scores). Suits are bought
// with the game's coins and worn online too.
import { SUITS } from "./hero-rig.js?v=mvq292b7";
import { TUNE } from "./hero-move.js?v=mvq292b7";
import { spend } from "./arcline-profile.js?v=mvq292b7";

export const SKILLS = {
  swing: { name: "Swing Mastery", max: 3, desc: "Faster swings: +7% top swing speed and pump per level" },
  launch: { name: "Launch Power", max: 3, desc: "Point launches, roof launches and swing jumps go further" },
  dash: { name: "Second Wind", max: 1, desc: "Two air dashes before landing" },
  wings: { name: "Glider", max: 2, desc: "Web wings sink slower and fly faster" },
  fists: { name: "Iron Fists", max: 3, desc: "+12% melee damage per level" },
  focus: { name: "Focus Flow", max: 2, desc: "+30% focus from hits and dodges per level" },
  gadgets: { name: "Quick Shooters", max: 2, desc: "-20% gadget cooldowns per level" },
  armor: { name: "Reinforced Suit", max: 3, desc: "-12% damage taken per level" },
  style: { name: "Showboat", max: 3, desc: "+10% trick points per level" },
};
const BASE = { swingMax: TUNE.swingMax, swingPump: TUNE.swingPump, launchFwd: TUNE.launchFwd, launchUp: TUNE.launchUp, swingJumpV: TUNE.swingJumpV, glideG: TUNE.glideG, glideMax: TUNE.glideMax };

export class Progress {
  constructor(hero) { this.hero = hero; }
  get pr() { return this.hero.profile(); }
  lvl(id) { return (this.pr.skills ||= {})[id] || 0; }
  // push the skills into the movement tuning and the fight
  apply() {
    const s = (id) => this.lvl(id);
    TUNE.swingMax = BASE.swingMax * (1 + .07 * s("swing")); TUNE.swingPump = BASE.swingPump * (1 + .07 * s("swing"));
    TUNE.launchFwd = BASE.launchFwd * (1 + .1 * s("launch")); TUNE.launchUp = BASE.launchUp * (1 + .08 * s("launch")); TUNE.swingJumpV = BASE.swingJumpV * (1 + .1 * s("launch"));
    TUNE.glideG = BASE.glideG * (1 - .2 * s("wings")); TUNE.glideMax = BASE.glideMax * (1 + .1 * s("wings"));
    const cb = this.hero.combat;
    if (cb) { cb.dmgK = 1 + .12 * s("fists"); cb.focusK = 1 + .3 * s("focus"); cb.coolK = 1 - .2 * s("gadgets"); cb.armorK = 1 - .12 * s("armor"); }
    if (this.hero.H) this.hero.H.dashes = 1 + s("dash");
    if (this.hero.tricks) this.hero.tricks.styleK = 1 + .1 * s("style");
  }
  act(kind, id) {
    const pr = this.pr, h = this.hero;
    if (kind === "skill") {
      const S = SKILLS[id];
      if (!S || (pr.points || 0) < 1 || this.lvl(id) >= S.max) return h.sfx("deny");
      pr.skills[id] = this.lvl(id) + 1; pr.points--;
      this.apply(); h.sfx("perfect"); h.ctx.save();
    }
    if (kind === "suit") {
      const S = SUITS[id];
      if (!S) return;
      pr.owned ||= ["arcline"];
      if (!pr.owned.includes(id)) {
        if (!spend(S.price).ok) { h.ctx.ui?.toast(`Not enough coins for ${S.name}`, [], "warn"); return h.sfx("deny"); }
        pr.owned.push(id); h.ctx.audio.coin?.();
      }
      h.setSuit(id);
    }
  }
  html() {
    const pr = this.pr, h = this.hero, P = h.ctx.P;
    const need = heroXp(pr.level || 1);
    const skills = Object.entries(SKILLS).map(([id, S]) => {
      const l = this.lvl(id), can = (pr.points || 0) > 0 && l < S.max;
      return `<button data-act="skill:${id}" class="${can ? "" : "dim"}"><b>${S.name} ${"●".repeat(l)}${"○".repeat(S.max - l)}</b><small>${S.desc}</small></button>`;
    }).join("");
    const suits = Object.entries(SUITS).map(([id, S]) => {
      const own = (pr.owned || ["arcline"]).includes(id), on = h.suitId === id;
      return `<button data-act="suit:${id}" class="suit ${on ? "on" : ""}"><i style="background:#${S.base.toString(16).padStart(6, "0")};border-color:#${S.accent.toString(16).padStart(6, "0")}"></i><b>${S.name}</b><small>${on ? "WEARING" : own ? "OWNED" : S.price.toLocaleString() + " coins"}</small></button>`;
    }).join("");
    return `<h4>HERO · LEVEL ${pr.level || 1} · ${pr.xp || 0}/${need} XP · ${pr.points || 0} SKILL POINT${(pr.points || 0) === 1 ? "" : "S"} · ${(P.coins || 0).toLocaleString()} COINS</h4>
      <div class="hm-list skills">${skills}</div>
      <h4>SUITS</h4><div class="hm-list suits">${suits}</div>`;
  }
}
export const heroXp = (lvl) => 500 + (lvl - 1) * 250;
