// Every price and every payout in the game lives here. Nothing else in the codebase hard-codes a
// cost: the garage, the upgrade shop, the tuning screen and the end-of-run rewards all read these
// tables, so the whole economy can be rebalanced from this one file.

// ---------------------------------------------------------------- cars
// Six tiers of progression. A starter car is free, a supercar is a season's worth of driving.
export const CAR_PRICES = {
  // starter
  b330i: 0, a4: 0, c300: 0,
  // street
  trailbox: 2500, golfr: 4000, dunerunner: 6000,
  // sports
  autobahn6: 9000, q50: 10000, m240i: 12000, q60: 13000, embergt: 13500, m340i: 15000, supra: 18000, rs3: 20000,
  // performance
  m2: 30000, c63: 34000, x3m: 36000, charger: 38000, challenger: 38000, vipermint: 40000,
  m3: 46000, chiron: 200000, laferrari: 120000, m5: 64000, m4: 48000, rs6: 52000, e63: 55000, glacierbolt: 60000,
  // super
  gt3rs: 84000, x5m: 72000, x6m: 76000, gtr: 88000, c8: 95000,
  // premium / rare
  phantom: 130000, svj: 180000,
};
// fallback if a car is added without a price: scale off its rarity
export const RARITY_PRICE = { COMMON: 0, RARE: 4000, EPIC: 14000, LEGENDARY: 45000, MYTHIC: 90000 };
export const carPrice = (car) => CAR_PRICES[car.id] ?? RARITY_PRICE[car.rarity] ?? 5000;

// ---------------------------------------------------------------- upgrades
// Price per part option, per category. "stock" is what the car came with, so it is always free.
// Everything else has to be bought once per car and is then yours to fit and unfit for nothing.
export const PART_PRICES = {
  intake: { stock: 0, panel: 400, open: 1200 },
  fuel: { stock: 0, p93: 600, e30: 2500, e50: 5000, e85: 9000 },
  exhaust: { stock: 0, catback: 2500, downpipe: 6000 },
  catalyst: { stock: 0, sports: 1800, deleted: 3500 },
  intercooler: { stock: 0, upgraded: 3500, race: 9000 },
  turbo: { stock: 0, upgraded: 9000, t51r: 26000 },
  tires: { stock: 0, sport: 1500, slick: 4500 },
  brakes: { stock: 0, sport: 1200, race: 3800 },
  suspension: { stock: 0, sport: 2000, race: 5500 },
  transmission: { stock: 0, sport: 4000, race: 11000 },
  weight: { stock: 0, stage1: 3000, stage2: 8500 },
  remap: { stock: 0, stage1: 2500, stage2: 6500, stage3: 14000 },
  internals: { stock: 0, forged: 8000, built: 20000 },
  diff: { stock: 0, lsd: 3500, plated: 9000 },
  aero: { stock: 0, splitter: 2800, wing: 7000, race: 16000 },
};
// ECU access has to be bought before the engine map can be touched at all; after that every
// committed map change is a dyno session.
export const TUNING_PRICES = { ecu: 1500, session: 250 };
export const COSMETIC_PRICES = { paint: 500 };
// Styling: the price of switching to a non-stock option in each category.
export const STYLE_PRICES = { finish: { gloss: 0, metallic: 800, pearl: 1500, satin: 1200, matte: 1800, chrome: 6000 }, rim: 600, caliper: 400, tint: 350, stance: 1500, glow: 2500, drl: 700,
  // fitment: bought once per car, then the slider is free to move
  drop: 1500, offset: 1200, camber: 900, wsize: 2000 };
export const FITMENT_KEYS = ["drop", "offset", "camber", "wsize"];
const FITMENT_DEF = { drop: 0, offset: 0, camber: 0, wsize: 1 };
export const stylePrice = (key, val) => {
  if (FITMENT_KEYS.includes(key)) return Math.abs((val ?? FITMENT_DEF[key]) - FITMENT_DEF[key]) < 1e-6 ? 0 : STYLE_PRICES[key];
  return val == null || val === "stock" || val === "gloss" || val === "none" ? 0 : typeof STYLE_PRICES[key] === "object" ? STYLE_PRICES[key][val] ?? 0 : STYLE_PRICES[key] ?? 0;
};

export const partPrice = (kind, option) => PART_PRICES[kind]?.[option] ?? 0;

// ---------------------------------------------------------------- payouts
// Tuned so a run that scores a few thousand pays for a bolt-on, and a great run pays for a lot more.
export const REWARDS = {
  perScore: 0.25,        // coins per point of score
  perCloseCall: 10,     // threading a gap
  perKm: 12,            // distance covered
  comboBonus: 5,       // per close-call streak step
  newBest: 250,         // beating your personal best
  medal: 800,          // each new medal on the ladder
  levelUp: 150,
  partySurvivor: 250,   // still driving when somebody else ended the round
  partyWin: 450,       // highest score in a party round
  minimum: 15,          // even a bad run pays something
};

// One place that decides what a run was worth. `run` comes straight from the game state.
export function runReward(run) {
  const r = REWARDS;
  let coins = Math.round(run.score * r.perScore)
    + run.closeCalls * r.perCloseCall
    + Math.round((run.distance || 0) / 1000 * r.perKm)
    + (run.bestCombo > 1 ? (run.bestCombo - 1) * r.comboBonus : 0);
  const extras = [];
  if (run.newBest) { coins += r.newBest; extras.push({ label: "New personal best", coins: r.newBest }); }
  if (run.newMedals > 0) { coins += run.newMedals * r.medal; extras.push({ label: `${run.newMedals} new medal${run.newMedals > 1 ? "s" : ""}`, coins: run.newMedals * r.medal }); }
  if (run.levelUps > 0) { coins += run.levelUps * r.levelUp; extras.push({ label: "Level up", coins: run.levelUps * r.levelUp }); }
  if (run.survivor) { coins += r.partySurvivor; extras.push({ label: "Survived the round", coins: r.partySurvivor }); }
  if (run.partyWin) { coins += r.partyWin; extras.push({ label: "Won the round", coins: r.partyWin }); }
  return { coins: Math.max(r.minimum, coins), extras };
}

export const fmtCoins = (n) => Math.round(n).toLocaleString();
