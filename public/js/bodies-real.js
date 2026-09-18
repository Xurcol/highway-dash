// Real-car body definitions, generated from a handful of measured proportions per car.
// All values in metres, shape frame: +x = front, y = up. Output matches BODIES entries in cars.js.

function makeBody(p) {
  const h = p.L / 2, B = p.bottom;
  const wsX = h - p.ws, rfX = h - p.rf, rrX = h - p.rr, cX = h - p.c;
  const tip = p.noseLo + (p.noseHi - p.noseLo) * .42;
  const up = [
    [h - .16, B + .06], [h - .05, p.noseLo], [h, tip], [h - .06, p.noseHi - .06], [h - .16, p.noseHi], [h - .42, p.hoodF], [wsX, p.hood],
    [(wsX + cX) / 2, (p.hood + p.belt) / 2 + .02], [cX, p.belt],
  ];
  const deckR = p.style === "sedan" || p.style === "coupe" ? p.deck - .03 : p.deck;
  if (p.style === "sedan" || p.style === "coupe") up.push([-h + .45, p.deck], [-h + .12, deckR]);
  else if (p.style === "fastback") up.push([-h + .2, p.deck]);
  else up.push([-h + .1, p.deck]); // wagon / hatch / suv
  const rtip = p.tailLo + (deckR - p.tailLo) * .45;
  up.push([-h + .03, deckR - .1], [-h, rtip], [-h + .05, p.tailLo], [-h + .18, B + .06]);
  const glass = [[wsX + .07, p.hood - .03], [rfX, p.H], [rrX, p.H], [cX - .02, p.belt], [cX + .08, p.belt - .08], [wsX + .16, p.hood - .1]];
  const fa = h - p.fo, ra = fa - p.wb;
  const deckRear = p.style === "sedan" || p.style === "coupe" ? p.deck - .03 : p.deck;
  return {
    real: true, style: p.style, doors: p.doors ?? (["sedan", "suv", "wagon", "hatch"].includes(p.style) ? 4 : 2), L: p.L, W: p.W, bottom: B, r: p.r, wheels: [fa, ra],
    up, glass, roof: [rfX - .06, rrX + .08, p.H],
    hl: [h - .1, p.noseHi - .07], tl: [-h + .02, deckRear - .14], crown: p.crown ?? (p.extras?.includes("powerdome") ? .035 : .015),
    taper: p.taper || [.3, .5, .35], hip: p.hip ?? .05, belt: Math.min(p.hood, p.belt), top: p.H,
    hood: p.hood, hoodF: p.hoodF, noseHi: p.noseHi, noseLo: p.noseLo, deck: deckRear, tailLo: p.tailLo, wsX, cX,
    grille: p.grille, hlType: p.hlType || "slim", tlType: p.tlType || "pair", exType: p.exType || "twin",
    extras: p.extras || [], rim: { spokes: 5, color: 0x2b2e34, caliper: 0xd41f1f, ...(p.rim || {}) },
  };
}

const bmwSedan = { style: "sedan", noseLo: .2, noseHi: .7, hoodF: .8, hlType: "bmw", tlType: "bmwL", taper: [.34, .5, .35] };
const bmwCoupe = { ...bmwSedan, style: "coupe" };
const bmwSuv = { style: "suv", noseLo: .32, noseHi: .9, hoodF: 1.0, hlType: "bmw", tlType: "bmwL", taper: [.3, .4, .25], bottom: .24 };
const mRim = { spokes: 5, color: 0x1f2126, caliper: 0x1f5fd6 };

export const REAL_BODIES = {
  m240i: makeBody({ ...bmwCoupe, L: 4.54, W: 1.84, H: 1.39, bottom: .15, r: .34, fo: .84, wb: 2.74, ws: 1.72, hood: .96, rf: 2.52, rr: 3.15, c: 3.85, belt: 1.0, deck: 1.02, tailLo: .32, hip: .05,
    grille: "kidneyVert", exType: "twinSquare", extras: ["lip", "diffuser", "splitter"], rim: { spokes: 5, color: 0x3a3d44, caliper: 0x1f5fd6 } }),
  m340i: makeBody({ ...bmwSedan, L: 4.71, W: 1.83, H: 1.44, bottom: .15, r: .34, fo: .83, wb: 2.85, ws: 1.75, hood: .98, rf: 2.58, rr: 3.3, c: 3.9, belt: 1.02, deck: 1.04, tailLo: .33, hip: .04,
    grille: "kidney", exType: "twinSquare", extras: ["lip", "diffuser"], rim: { spokes: 10, color: 0x3a3d44, caliper: 0x1f5fd6 } }),
  m2: makeBody({ ...bmwCoupe, L: 4.58, W: 1.89, H: 1.40, bottom: .13, r: .35, fo: .86, wb: 2.75, ws: 1.72, hood: .97, rf: 2.5, rr: 3.15, c: 3.86, belt: 1.0, deck: 1.02, tailLo: .3, hip: .09,
    grille: "kidneyWide", exType: "mQuad", extras: ["powerdome", "lip", "diffuser", "splitter", "gills", "skirts"], rim: mRim }),
  m3: makeBody({ ...bmwSedan, L: 4.79, W: 1.90, H: 1.43, bottom: .13, r: .35, fo: .88, wb: 2.86, ws: 1.8, hood: .98, rf: 2.62, rr: 3.42, c: 3.98, belt: 1.02, deck: 1.04, tailLo: .3, hip: .08,
    grille: "kidneyTall", exType: "mQuad", extras: ["powerdome", "lip", "diffuser", "splitter", "gills", "skirts"], rim: mRim }),
  m4: makeBody({ ...bmwCoupe, L: 4.79, W: 1.89, H: 1.39, bottom: .13, r: .35, fo: .88, wb: 2.86, ws: 1.8, hood: .97, rf: 2.64, rr: 3.3, c: 4.05, belt: 1.0, deck: 1.02, tailLo: .3, hip: .08,
    grille: "kidneyTall", exType: "mQuad", extras: ["powerdome", "lip", "diffuser", "splitter", "gills", "skirts"], rim: mRim }),
  x3m: makeBody({ ...bmwSuv, L: 4.72, W: 1.90, H: 1.67, r: .38, fo: .85, wb: 2.86, ws: 1.62, hood: 1.14, rf: 2.38, rr: 4.38, c: 4.62, belt: 1.18, deck: 1.22, tailLo: .45, hip: .06,
    grille: "kidneyXL", exType: "mQuad", extras: ["roofSpoiler", "diffuser", "gills"], rim: mRim }),
  x5m: makeBody({ ...bmwSuv, L: 4.94, W: 2.02, H: 1.76, r: .4, fo: .92, wb: 2.97, ws: 1.68, hood: 1.22, rf: 2.48, rr: 4.58, c: 4.85, belt: 1.26, deck: 1.3, tailLo: .48, hip: .06,
    grille: "kidneyXL", exType: "mQuad", extras: ["roofSpoiler", "diffuser", "gills"], rim: mRim }),
  x6m: makeBody({ ...bmwSuv, style: "fastback", doors: 4, L: 4.94, W: 2.02, H: 1.69, r: .4, fo: .92, wb: 2.97, ws: 1.68, hood: 1.22, rf: 2.48, rr: 3.55, c: 4.72, belt: 1.25, deck: 1.28, tailLo: .48, hip: .06,
    grille: "kidneyXL", exType: "mQuad", extras: ["lip", "diffuser", "gills"], rim: mRim }),
  q50: makeBody({ style: "sedan", L: 4.80, W: 1.82, H: 1.44, bottom: .15, r: .34, fo: .9, wb: 2.85, noseLo: .22, noseHi: .72, hoodF: .82, ws: 1.85, hood: .97, rf: 2.7, rr: 3.45, c: 4.0, belt: 1.02, deck: 1.04, tailLo: .34, hip: .06,
    grille: "infiniti", hlType: "swoop", tlType: "q", exType: "twinRound", extras: ["lip"], rim: { spokes: 10, color: 0x2a2d33, caliper: 0xd41f1f } }),
  q60: makeBody({ style: "coupe", L: 4.69, W: 1.85, H: 1.39, bottom: .14, r: .35, fo: .88, wb: 2.85, noseLo: .2, noseHi: .7, hoodF: .8, ws: 1.8, hood: .94, rf: 2.6, rr: 3.22, c: 4.0, belt: .99, deck: 1.0, tailLo: .32, hip: .08,
    grille: "infiniti", hlType: "swoop", tlType: "q", exType: "twinRound", extras: ["lip"], rim: { spokes: 10, color: 0x2a2d33, caliper: 0xd41f1f } }),
  c63: makeBody({ style: "sedan", L: 4.75, W: 1.84, H: 1.43, bottom: .13, r: .35, fo: .82, wb: 2.84, noseLo: .2, noseHi: .7, hoodF: .8, ws: 1.82, hood: .96, rf: 2.62, rr: 3.42, c: 3.98, belt: 1.02, deck: 1.04, tailLo: .32, hip: .09,
    grille: "amg", hlType: "slim", tlType: "amg", exType: "quadTrap", extras: ["lip", "diffuser", "splitter", "hoodVents2", "skirts"], rim: { spokes: 10, color: 0x2a2d33, caliper: 0xd8d8d8 } }),
  e63: makeBody({ style: "sedan", L: 4.99, W: 1.91, H: 1.46, bottom: .14, r: .36, fo: .86, wb: 2.94, noseLo: .21, noseHi: .72, hoodF: .82, ws: 1.95, hood: .98, rf: 2.8, rr: 3.62, c: 4.2, belt: 1.05, deck: 1.07, tailLo: .33, hip: .07,
    grille: "amg", hlType: "slim", tlType: "amg", exType: "quadTrap", extras: ["lip", "diffuser", "splitter", "skirts"], rim: { spokes: 5, color: 0x2a2d33, caliper: 0xd8d8d8 } }),
  rs3: makeBody({ style: "hatch", L: 4.39, W: 1.85, H: 1.44, bottom: .13, r: .34, fo: .9, wb: 2.63, noseLo: .2, noseHi: .7, hoodF: .82, ws: 1.55, hood: .96, rf: 2.35, rr: 3.7, c: 4.25, belt: 1.02, deck: 1.1, tailLo: .34, hip: .09,
    grille: "audi", hlType: "audi", tlType: "audi", exType: "rsOval", extras: ["roofSpoiler", "diffuser", "splitter", "skirts"], rim: { spokes: 10, color: 0x2a2d33, caliper: 0xd41f1f } }),
  rs6: makeBody({ style: "wagon", L: 5.0, W: 1.95, H: 1.46, bottom: .13, r: .36, fo: .95, wb: 2.93, noseLo: .2, noseHi: .72, hoodF: .82, ws: 1.85, hood: .98, rf: 2.72, rr: 4.6, c: 4.9, belt: 1.05, deck: 1.12, tailLo: .34, hip: .11,
    grille: "audi", hlType: "audi", tlType: "audiBar", exType: "rsOval", extras: ["roofSpoiler", "diffuser", "splitter", "skirts"], rim: { spokes: 10, color: 0x2a2d33, caliper: 0xd41f1f } }),
  charger: makeBody({ style: "sedan", L: 5.1, W: 1.96, H: 1.47, bottom: .14, r: .36, fo: .95, wb: 3.05, noseLo: .24, noseHi: .78, hoodF: .88, ws: 2.05, hood: 1.0, rf: 2.92, rr: 3.72, c: 4.35, belt: 1.08, deck: 1.1, tailLo: .36, hip: .08,
    grille: "dodge", hlType: "charger", tlType: "ring", exType: "dualRect", extras: ["lip", "hoodVents2", "splitter"], rim: { spokes: 5, color: 0x1f2126, caliper: 0xd41f1f } }),
  challenger: makeBody({ style: "coupe", L: 5.03, W: 1.95, H: 1.45, bottom: .14, r: .36, fo: .95, wb: 2.95, noseLo: .24, noseHi: .8, hoodF: .9, ws: 2.1, hood: 1.02, rf: 2.92, rr: 3.45, c: 4.25, belt: 1.08, deck: 1.1, tailLo: .36, hip: .06,
    grille: "dodgeWide", hlType: "round2", tlType: "split", exType: "dualRect", extras: ["lip", "hoodScoop", "splitter"], rim: { spokes: 5, color: 0x1f2126, caliper: 0xd41f1f }, taper: [.26, .25, .2] }),
  supra: makeBody({ style: "fastback", L: 4.38, W: 1.85, H: 1.29, bottom: .12, r: .34, fo: .83, wb: 2.47, noseLo: .16, noseHi: .62, hoodF: .72, ws: 1.75, hood: .9, rf: 2.45, rr: 2.95, c: 3.95, belt: .98, deck: 1.0, tailLo: .3, hip: .13,
    grille: "supra", hlType: "slim", tlType: "supra", exType: "twinRound", extras: ["ducktail", "diffuser", "splitter"], rim: { spokes: 10, color: 0x1f2126, caliper: 0xd41f1f }, taper: [.4, .6, .45] }),
  gtr: makeBody({ style: "fastback", L: 4.71, W: 1.90, H: 1.37, bottom: .13, r: .35, fo: .92, wb: 2.78, noseLo: .2, noseHi: .68, hoodF: .78, ws: 1.7, hood: .95, rf: 2.45, rr: 3.2, c: 4.05, belt: 1.0, deck: 1.04, tailLo: .32, hip: .08,
    grille: "nissan", hlType: "slim", tlType: "round4", exType: "gtrQuad", extras: ["wing", "diffuser", "splitter"], rim: { spokes: 6, color: 0x3a3d44, caliper: 0xd41f1f }, taper: [.34, .45, .3] }),
  golfr: makeBody({ style: "hatch", L: 4.29, W: 1.79, H: 1.46, bottom: .14, r: .34, fo: .88, wb: 2.63, noseLo: .2, noseHi: .68, hoodF: .8, ws: 1.38, hood: .98, rf: 2.1, rr: 3.75, c: 4.18, belt: 1.04, deck: 1.1, tailLo: .34, hip: .05,
    grille: "vw", hlType: "slim", tlType: "vw", exType: "golfQuad", extras: ["roofSpoiler", "diffuser"], rim: { spokes: 10, color: 0x2a2d33, caliper: 0x1f5fd6 } }),
  svj: makeBody({ style: "fastback", L: 4.94, W: 2.1, H: 1.14, bottom: .1, r: .35, fo: 1.12, wb: 2.7, noseLo: .12, noseHi: .36, hoodF: .44, ws: 1.55, hood: .64, rf: 2.35, rr: 2.85, c: 3.35, belt: .98, deck: .96, tailLo: .28, hip: .13,
    grille: "svj", hlType: "y", tlType: "y", exType: "svjCenter", extras: ["alaWing", "diffuser", "splitter", "sideIntake", "louvers", "skirts"], rim: { spokes: 5, color: 0x1f2126, caliper: 0xf2c230 }, taper: [.46, .72, .38] }),
  gt3rs: makeBody({ style: "fastback", L: 4.57, W: 1.9, H: 1.32, bottom: .11, r: .35, fo: .98, wb: 2.46, noseLo: .14, noseHi: .56, hoodF: .64, ws: 1.5, hood: .84, rf: 2.3, rr: 2.85, c: 4.1, belt: 1.0, deck: 1.02, tailLo: .32, hip: .15,
    grille: "c8", hlType: "round2", tlType: "audiBar", exType: "twinRound", extras: ["wing", "diffuser", "splitter", "louvers", "skirts"], rim: { spokes: 5, color: 0x16181c, caliper: 0xf2c230 }, taper: [.44, .62, .5] }),
  b330i: makeBody({ ...bmwSedan, L: 4.71, W: 1.83, H: 1.44, bottom: .15, r: .33, fo: .83, wb: 2.85, ws: 1.75, hood: .98, rf: 2.58, rr: 3.3, c: 3.9, belt: 1.02, deck: 1.04, tailLo: .33, hip: .03,
    grille: "kidney", exType: "twinRound", extras: ["lip"], rim: { spokes: 10, color: 0x9aa0a8, caliper: 0x3a3d44 } }),
  a4: makeBody({ style: "sedan", L: 4.76, W: 1.84, H: 1.43, bottom: .15, r: .33, fo: .9, wb: 2.82, noseLo: .2, noseHi: .7, hoodF: .82, ws: 1.8, hood: .97, rf: 2.62, rr: 3.4, c: 3.95, belt: 1.02, deck: 1.04, tailLo: .34, hip: .04,
    grille: "audi", hlType: "audi", tlType: "audi", exType: "twinRound", extras: ["lip"], rim: { spokes: 10, color: 0xa0a4aa, caliper: 0x3a3d44 } }),
  c300: makeBody({ style: "sedan", L: 4.75, W: 1.82, H: 1.44, bottom: .15, r: .33, fo: .82, wb: 2.84, noseLo: .2, noseHi: .7, hoodF: .8, ws: 1.82, hood: .96, rf: 2.62, rr: 3.42, c: 3.98, belt: 1.02, deck: 1.04, tailLo: .33, hip: .04,
    grille: "amg", hlType: "slim", tlType: "amg", exType: "twinSquare", extras: ["lip"], rim: { spokes: 5, color: 0xa0a4aa, caliper: 0x3a3d44 } }),
  c8: makeBody({ style: "coupe", L: 4.63, W: 1.93, H: 1.23, bottom: .12, r: .35, fo: .95, wb: 2.72, noseLo: .14, noseHi: .5, hoodF: .56, ws: 1.35, hood: .8, rf: 2.05, rr: 2.55, c: 3.95, belt: .96, deck: .98, tailLo: .3, hip: .1,
    grille: "c8", hlType: "c8", tlType: "c8", exType: "centerQuad", extras: ["lip", "diffuser", "splitter", "sideIntake"], rim: { spokes: 20, color: 0x1f2126, caliper: 0xf2c230 }, taper: [.45, .6, .4] }),
};
