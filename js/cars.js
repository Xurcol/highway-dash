// Car catalog + procedural faceted car models (extruded side profiles with tapered width).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { patchLit } from "./lights.js?v=mu6adgwj";
import { REAL_BODIES } from "./bodies-real.js?v=mu6adgwj";
import { loftBody, loftGreenhouse, tireGeo, contactShadow, bodySpan, bodyTop, frontAt, rearAt } from "./carmesh.js?v=mu6adgwj";

// ---------- body definitions (shape frame: +x = front, y = up, z = width) ----------
// up: outline from front-bottom over the roof to rear-bottom. glass: greenhouse polygon.
export const BODIES = {
  hatch: { L: 3.9, W: 1.76, bottom: 0.28, r: 0.32, wheels: [1.25, -1.25],
    up: [[1.95, .34], [1.98, .6], [1.8, .76], [1.05, .86], [.75, .9], [-1.7, .98], [-1.95, .96], [-1.95, .4], [-1.88, .32]],
    glass: [[.8, .88], [0, 1.45], [-1.55, 1.45], [-1.88, .97], [-1.85, .88]], roof: [0, -1.5, 1.45],
    hl: [1.86, .68], tl: [-1.93, .82], taper: [.28, .5, .35], belt: .9, top: 1.45, exhaust: [[-1.9, .3, .45]] },
  sedan: { L: 4.7, W: 1.86, bottom: .3, r: .34, wheels: [1.42, -1.42],
    up: [[2.35, .36], [2.38, .62], [2.2, .78], [1.05, .9], [.75, .92], [-1.35, .98], [-2.25, .98], [-2.38, .9], [-2.38, .45], [-2.3, .34]],
    glass: [[.8, .9], [.05, 1.42], [-.95, 1.43], [-1.55, .99], [-1.5, .9]], roof: [.05, -.95, 1.43],
    hl: [2.26, .7], tl: [-2.36, .86], taper: [.3, .5, .4], belt: .92, top: 1.43, exhaust: [[-2.3, .32, .5]] },
  suv: { L: 4.8, W: 1.96, bottom: .42, r: .42, wheels: [1.5, -1.5],
    up: [[2.4, .5], [2.42, .92], [2.25, 1.05], [1.25, 1.12], [.95, 1.14], [-2.3, 1.2], [-2.42, 1.15], [-2.42, .55], [-2.35, .46]],
    glass: [[1, 1.12], [.25, 1.78], [-2.2, 1.8], [-2.36, 1.2], [-2.3, 1.12]], roof: [.25, -2.22, 1.8],
    hl: [2.32, .95], tl: [-2.4, 1.02], taper: [.22, .35, .25], belt: 1.14, top: 1.8, exhaust: [[-2.35, .45, .55]] },
  pickup: { L: 5.3, W: 2.0, bottom: .45, r: .43, wheels: [1.75, -1.75],
    up: [[2.65, .55], [2.68, .95], [2.5, 1.12], [1.3, 1.18], [1.05, 1.2], [-2.62, 1.22], [-2.68, 1.15], [-2.68, .6], [-2.6, .5]],
    glass: [[1.1, 1.18], [.4, 1.82], [-.3, 1.82], [-.45, 1.21], [-.4, 1.18]], roof: [.4, -.35, 1.82],
    hl: [2.58, 1.0], tl: [-2.66, 1.05], taper: [.2, .3, .15], belt: 1.2, top: 1.82, exhaust: [[-2.6, .45, .6]], bed: true },
  van: { L: 5.2, W: 2.0, bottom: .4, r: .4, wheels: [1.8, -1.8],
    up: [[2.6, .5], [2.62, .95], [2.45, 1.15], [1.65, 1.3], [.95, 2.3], [-2.55, 2.35], [-2.6, 2.25], [-2.6, .5], [-2.5, .42]],
    panes: [[[1.62, 1.36], [.97, 2.24]]], sideWin: [[.8, -2.3, 1.55, 2.15]],
    hl: [2.52, 1.0], tl: [-2.6, 1.6], taper: [.12, .25, .08], belt: 1.3, top: 2.35 },
  muscle: { L: 4.9, W: 1.96, bottom: .26, r: .36, wheels: [1.45, -1.45],
    up: [[2.45, .34], [2.48, .75], [2.35, .85], [.95, .95], [.65, .97], [-1.3, .98], [-2.35, 1.0], [-2.48, .95], [-2.48, .45], [-2.4, .32]],
    glass: [[.7, .95], [-.1, 1.36], [-.9, 1.36], [-1.45, .99], [-1.4, .93]], roof: [-.1, -.9, 1.36],
    hl: [2.4, .66], tl: [-2.46, .82], taper: [.3, .3, .3], belt: .97, top: 1.36, exhaust: [[-2.4, .3, .55], [-2.4, .3, -.55]], ducktail: true, scoop: true },
  coupe: { L: 4.5, W: 1.9, bottom: .22, r: .34, wheels: [1.3, -1.3],
    up: [[2.25, .3], [2.3, .5], [2.1, .66], [.85, .82], [.55, .85], [-1.2, .95], [-2.2, .92], [-2.3, .85], [-2.3, .42], [-2.2, .28]],
    glass: [[.6, .83], [-.25, 1.22], [-.85, 1.22], [-1.9, .93], [-1.85, .86]], roof: [-.2, -.85, 1.22],
    hl: [2.12, .58], tl: [-2.28, .76], taper: [.32, .55, .4], belt: .85, top: 1.22, exhaust: [[-2.25, .28, .25], [-2.25, .28, -.25]], wing: .95 },
  super: { L: 4.5, W: 2.0, bottom: .18, r: .34, wheels: [1.38, -1.32],
    up: [[2.25, .26], [2.3, .42], [2.15, .55], [1.2, .72], [.55, .8], [-1, .88], [-1.9, .92], [-2.28, .9], [-2.3, .55], [-2.22, .28]],
    glass: [[.62, .78], [-.15, 1.15], [-.8, 1.16], [-1.95, .91], [-1.95, .82]], roof: [-.15, -.8, 1.16],
    hl: [2.12, .5], tl: [-2.28, .78], taper: [.38, .6, .4], belt: .8, top: 1.16, exhaust: [[-2.25, .42, .12], [-2.25, .42, -.12]], vents: true },
  hyper: { L: 4.7, W: 2.05, bottom: .14, r: .36, wheels: [1.45, -1.45],
    up: [[2.35, .2], [2.42, .34], [2.2, .5], [1, .7], [.45, .78], [-1.2, .92], [-2.2, .9], [-2.4, .82], [-2.4, .4], [-2.3, .22]],
    glass: [[.5, .76], [-.3, 1.1], [-.85, 1.1], [-1.4, .92], [-1.3, .8]], roof: [-.3, -.85, 1.1],
    hl: [2.25, .42], tl: [-2.38, .7], taper: [.4, .65, .35], belt: .78, top: 1.1, exhaust: [[-2.35, .5, 0]], wing: 1.2, fin: true, vents: true },
  truck: { L: 7.6, W: 2.45, bottom: .55, r: .5, wheels: [2.6, -1.9, -3.0],
    up: [[3.8, .62], [3.82, 1.25], [3.65, 1.45], [3.25, 1.55], [2.9, 2.6], [1.55, 2.65], [1.5, .62]],
    panes: [[[3.23, 1.62], [2.93, 2.5]]], sideWin: [[2.7, 1.8, 1.7, 2.4]],
    hl: [3.78, .95], tl: [-3.78, .9], taper: [.08, .2, 0], belt: 1.5, top: 2.65, cargo: [1.45, -3.8, .9, 3.6] },
  bus: { L: 11, W: 2.55, bottom: .35, r: .5, wheels: [3.6, -3.2],
    up: [[5.5, .45], [5.55, 2.9], [5.3, 3.2], [-5.4, 3.2], [-5.5, 3.0], [-5.5, .45]],
    panes: [[[5.56, 1.3], [5.5, 2.8]]], sideWin: [[4.9, -5.1, 1.55, 2.7]],
    hl: [5.52, .8], tl: [-5.52, .9], taper: [.05, .1, .05], belt: 1.3, top: 3.2 },
};
Object.assign(BODIES, REAL_BODIES);
for (const [k, d] of Object.entries({ hatch: 4, sedan: 4, suv: 4, pickup: 4, van: 2, muscle: 2, coupe: 2, super: 2, hyper: 2, truck: 2, bus: 2 })) BODIES[k].doors = d;
for (const k of ["van", "truck", "bus"]) BODIES[k].boxy = true;
BODIES.suv.style = BODIES.van.style = "suv";

// ---------- drivetrains ----------
const ZF8 = [5.25, 3.36, 2.17, 1.72, 1.32, 1.0, .82, .64];
const DSG7 = [3.56, 2.53, 1.68, 1.02, .79, .64, .52];
const HP8 = [4.71, 3.14, 2.1, 1.67, 1.29, 1.0, .84, .67];
export const ENGINE_SPECS = {
  sedan:  { ratios: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, .82, .64], final: 3.15, redline: 7000, idle: 750, torque: 500, mass: 1650, cda: .6, grip: 1.02, tire: .34, shiftTime: .09, sound: "b58" },
  hatch:  { ratios: [3.4, 2.1, 1.5, 1.18, .95, .8], final: 3.9, redline: 7200, idle: 850, torque: 330, mass: 1250, cda: .68, grip: .95, tire: .31, shiftTime: .14, sound: "i4" },
  suv:    { ratios: [3.8, 2.3, 1.6, 1.25, 1.0, .82, .68], final: 3.6, redline: 6800, idle: 800, torque: 520, mass: 1900, cda: .95, grip: .9, tire: .36, shiftTime: .16, sound: "v6" },
  pickup: { ratios: [3.2, 2.1, 1.5, 1.15, .9, .72], final: 3.73, redline: 6600, idle: 720, torque: 620, mass: 2050, cda: 1.0, grip: .92, tire: .37, shiftTime: .16, sound: "v8x" },
  muscle: { ratios: [2.97, 2.07, 1.43, 1.0, .84, .62], final: 3.73, redline: 7000, idle: 720, torque: 680, mass: 1700, cda: .76, grip: .98, tire: .34, shiftTime: .1, sound: "v8x" },
  coupe:  { ratios: [3.75, 2.38, 1.72, 1.34, 1.11, .96, .84], final: 3.44, redline: 9000, idle: 900, torque: 480, mass: 1420, cda: .62, grip: 1.05, tire: .33, shiftTime: .08, sound: "f6" },
  super:  { ratios: [3.13, 2.59, 1.96, 1.57, 1.29, 1.08, .9], final: 3.4, redline: 8700, idle: 950, torque: 600, mass: 1450, cda: .64, grip: 1.1, tire: .34, shiftTime: .07, sound: "v10" },
  hyper:  { ratios: [3.2, 2.3, 1.8, 1.45, 1.2, 1.0, .84], final: 3.3, redline: 9200, idle: 1000, torque: 800, mass: 1550, cda: .58, grip: 1.15, tire: .35, shiftTime: .06, sound: "v12" },
};
const spec = (o) => ({ idle: 750, grip: 1.02, shiftTime: .09, ...o });
const bmw8 = (o) => spec({ ratios: ZF8, final: 3.15, redline: 7000, tire: .35, vmax: 250, ...o });

export const CARS = [
  // ---- starters (free) - real figures ----
  { id: "b330i", name: "BMW 330i (G20)", rarity: "COMMON", price: 0, body: "b330i", color: 0x9aa4b0, handling: 70, sound: "b46",
    spec: bmw8({ hp: 255, torque: 400, mass: 1570, final: 2.81, redline: 6500, idle: 700, cda: .6, grip: 1.0, tire: .33, vmax: 209 }) },
  { id: "a4", name: "Audi A4 45 TFSI quattro", rarity: "COMMON", price: 0, body: "a4", color: 0x1c2a44, handling: 68, sound: "ea888",
    spec: spec({ hp: 261, torque: 370, mass: 1640, ratios: DSG7, final: 4.27, redline: 6500, idle: 750, cda: .6, grip: 1.02, tire: .33, shiftTime: .08, vmax: 209 }) },
  { id: "c300", name: "Mercedes-Benz C300", rarity: "COMMON", price: 0, body: "c300", color: 0xf1f1f1, handling: 67, sound: "m264",
    spec: spec({ hp: 255, torque: 400, mass: 1655, ratios: [5.35, 3.24, 2.25, 1.64, 1.21, 1, .87, .72, .6], final: 2.65, redline: 6300, idle: 700, cda: .6, grip: .98, tire: .33, shiftTime: .1, vmax: 209 }) },
  // ---- real cars ----
  { id: "golfr", name: "Volkswagen Golf R", rarity: "RARE", price: 1200, body: "golfr", color: 0x2a4fb0, handling: 74, sound: "i4",
    spec: spec({ hp: 315, torque: 420, mass: 1510, ratios: DSG7, final: 4.47, redline: 6700, idle: 800, cda: .66, grip: 1.08, tire: .33, shiftTime: .07, vmax: 270 }) },
  { id: "q50", name: "Brancuck Red Sport", rarity: "EPIC", price: 2000, body: "q50", color: 0xa3161c, handling: 70, sound: "vr30",
    spec: spec({ hp: 400, torque: 475, mass: 1780, ratios: [4.783, 3.103, 1.984, 1.371, 1, .871, .776], final: 3.13, redline: 7000, idle: 700, cda: .66, grip: .98, tire: .34, shiftTime: .14, vmax: 250 }) },
  { id: "m240i", name: "BMW M240i xDrive", rarity: "EPIC", price: 2200, body: "m240i", color: 0x3d6fc4, handling: 77, sound: "b58",
    spec: bmw8({ hp: 382, torque: 500, mass: 1690, cda: .62, grip: 1.08, tire: .34 }) },
  { id: "q60", name: "Infiniti Q60 Red Sport", rarity: "EPIC", price: 2400, body: "q60", color: 0xe9e9eb, handling: 72, sound: "vr30",
    spec: spec({ hp: 400, torque: 475, mass: 1750, ratios: [4.783, 3.103, 1.984, 1.371, 1, .871, .776], final: 3.13, redline: 7000, idle: 700, cda: .64, grip: .98, tire: .34, shiftTime: .14, vmax: 250 }) },
  { id: "m340i", name: "BMW M340i xDrive", rarity: "EPIC", price: 2600, body: "m340i", color: 0x1f5aa6, handling: 75, sound: "b58",
    spec: bmw8({ hp: 382, torque: 500, mass: 1745, cda: .62, grip: 1.08, tire: .34 }) },
  { id: "supra", name: "Toyota GR Supra 3.0", rarity: "EPIC", price: 3200, body: "supra", color: 0xc8102e, handling: 81, sound: "b58",
    spec: bmw8({ hp: 382, torque: 500, mass: 1540, cda: .6, grip: 1.02, tire: .34 }) },
  { id: "rs3", name: "Audi RS3 Sportback", rarity: "EPIC", price: 3500, body: "rs3", color: 0x3f7f3a, handling: 79, sound: "i5",
    spec: spec({ hp: 401, torque: 500, mass: 1575, ratios: DSG7, final: 4.1, redline: 7200, idle: 850, cda: .64, grip: 1.1, tire: .33, shiftTime: .06, vmax: 290 }) },
  { id: "m2", name: "BMW M2 (G87)", rarity: "LEGENDARY", price: 4800, body: "m2", color: 0x3b7dd8, handling: 83, sound: "s58real",
    spec: bmw8({ hp: 453, torque: 550, mass: 1725, final: 3.46, redline: 7200, idle: 800, cda: .66, grip: 1.03, vmax: 285 }) },
  { id: "c63", name: "Mercedes-AMG C63 S", rarity: "LEGENDARY", price: 5200, body: "c63", color: 0x7a7f86, handling: 78, sound: "amg",
    spec: spec({ hp: 503, torque: 700, mass: 1790, ratios: [4.38, 2.86, 1.92, 1.37, 1, .82, .73], final: 2.82, redline: 7000, cda: .66, grip: 1.0, tire: .35, shiftTime: .1, vmax: 290 }) },
  { id: "x3m", name: "BMW X3 M Competition", rarity: "LEGENDARY", price: 5400, body: "x3m", color: 0xa41e22, handling: 70, sound: "s58",
    spec: bmw8({ hp: 503, torque: 600, mass: 1970, redline: 7200, idle: 800, cda: .95, grip: 1.05, tire: .38, vmax: 285 }) },
  { id: "charger", name: "Dodge Charger SRT Hellcat", rarity: "LEGENDARY", price: 5800, body: "charger", color: 0xff6a13, handling: 64, sound: "hellcat",
    spec: spec({ hp: 717, torque: 881, mass: 2000, ratios: HP8, final: 2.62, redline: 6200, idle: 700, cda: .78, grip: .95, tire: .36, shiftTime: .1, vmax: 315 }) },
  { id: "challenger", name: "Dodge Challenger SRT Hellcat", rarity: "LEGENDARY", price: 5800, body: "challenger", color: 0x6ad13a, handling: 62, sound: "hellcat",
    spec: spec({ hp: 717, torque: 881, mass: 1990, ratios: HP8, final: 2.62, redline: 6200, idle: 700, cda: .8, grip: .95, tire: .36, shiftTime: .1, vmax: 315 }) },
  { id: "m3", name: "BMW M3 Competition (G80)", rarity: "LEGENDARY", price: 6800, body: "m3", color: 0x5a8a2b, handling: 84, sound: "s58real",
    spec: bmw8({ hp: 503, torque: 650, mass: 1730, redline: 7200, idle: 800, cda: .66, grip: 1.08, shiftTime: .08, vmax: 290 }) },
  { id: "m4", name: "BMW M4 Competition (G82)", rarity: "LEGENDARY", price: 7000, body: "m4", color: 0xf2c200, handling: 85, sound: "s58real",
    spec: bmw8({ hp: 503, torque: 650, mass: 1725, redline: 7200, idle: 800, cda: .64, grip: 1.08, shiftTime: .08, vmax: 290 }) },
  { id: "rs6", name: "Audi RS6 Avant", rarity: "LEGENDARY", price: 7800, body: "rs6", color: 0x8c8f93, handling: 76, sound: "amg",
    spec: spec({ hp: 591, torque: 800, mass: 2075, ratios: HP8, final: 3.2, redline: 7000, cda: .72, grip: 1.1, tire: .36, shiftTime: .1, vmax: 305 }) },
  { id: "e63", name: "Mercedes-AMG E63 S", rarity: "LEGENDARY", price: 8200, body: "e63", color: 0x151618, handling: 75, sound: "amg",
    spec: spec({ hp: 603, torque: 850, mass: 2000, ratios: [5.35, 3.24, 2.25, 1.64, 1.21, 1, .87, .72, .6], final: 3.07, redline: 7000, cda: .68, grip: 1.1, tire: .36, shiftTime: .09, vmax: 300 }) },
  { id: "x5m", name: "BMW X5 M Competition", rarity: "MYTHIC", price: 9000, body: "x5m", color: 0x2d5da8, handling: 66, sound: "s63",
    spec: bmw8({ hp: 617, torque: 750, mass: 2310, cda: 1.0, grip: 1.05, tire: .4, vmax: 290 }) },
  { id: "x6m", name: "BMW X6 M Competition", rarity: "MYTHIC", price: 9500, body: "x6m", color: 0x2e2f33, handling: 66, sound: "s63",
    spec: bmw8({ hp: 617, torque: 750, mass: 2295, cda: .96, grip: 1.05, tire: .4, vmax: 290 }) },
  { id: "gtr", name: "Nissan GT-R (R35)", rarity: "MYTHIC", price: 11000, body: "gtr", color: 0x8a8d90, handling: 88, sound: "vr38",
    spec: spec({ hp: 565, torque: 633, mass: 1750, ratios: [4.06, 2.3, 1.59, 1.25, 1, .8], final: 3.7, redline: 7100, idle: 900, cda: .72, grip: 1.15, tire: .35, shiftTime: .06, vmax: 315 }) },
  { id: "c8", name: "Chevrolet Corvette C8", rarity: "MYTHIC", price: 12000, body: "c8", color: 0xd01c1f, handling: 90, sound: "lt2",
    spec: spec({ hp: 495, torque: 637, mass: 1530, ratios: [2.91, 1.76, 1.22, .95, .67, .5, .42, .35], final: 5.17, redline: 6500, idle: 800, cda: .7, grip: 1.12, tire: .35, shiftTime: .06, vmax: 312 }) },
  { id: "gt3rs", name: "Porsche 911 GT3 RS", rarity: "MYTHIC", price: 84000, body: "gt3rs", color: 0x3fa9d6, handling: 95, sound: "gt3",
    spec: spec({ hp: 518, torque: 465, mass: 1450, ratios: [3.75, 2.38, 1.72, 1.34, 1.11, .96, .84], final: 4.12, redline: 9000, idle: 950, cda: .72, grip: 1.25, tire: .34, shiftTime: .05, vmax: 296 }) },
  { id: "svj", name: "Lamborghini Aventador SVJ", rarity: "MYTHIC", price: 20000, body: "svj", color: 0x72c02c, handling: 92, sound: "svj",
    spec: spec({ hp: 770, torque: 720, mass: 1750, ratios: [3.909, 2.438, 1.81, 1.458, 1.185, .967, .844], final: 3.73, redline: 8700, idle: 1000, cda: .66, grip: 1.2, tire: .35, shiftTime: .05, vmax: 350 }) },
];
export const RARITY_COLORS = { COMMON: "#9aa3ad", RARE: "#3d8bff", EPIC: "#b44cff", LEGENDARY: "#e8f04a", MYTHIC: "#ff3b5c" };
export const specOf = (car) => car.spec || ENGINE_SPECS[car.body];

export function carStats(car) {
  const e = specOf(car);
  const top = e.vmax ? Math.min(e.vmax, topSpeedKmh(e)) : topSpeedKmh(e);
  const accel = e.hp ? (e.hp / e.mass) * 300 : (e.torque / e.mass) * 190 - 20;
  return { speed: Math.round(Math.max(5, Math.min(100, (top - 170) / 1.5))), accel: Math.round(Math.min(100, accel)), handling: car.handling, top };
}
function topSpeedKmh(e) {
  const g = e.ratios.length, ratio = e.ratios[g - 1] * e.final;
  const vRed = (e.redline / 60 / ratio) * 2 * Math.PI * e.tire;
  let v = 10;
  for (let i = 0; i < 400; i++) {
    const F = e.torque * .95 * ratio / e.tire * .9 - .5 * 1.2 * e.cda * v * v - .013 * e.mass * 9.81;
    v += F > 0 ? 0.5 : -0.5;
  }
  return Math.min(vRed, v) * 3.6;
}

// ---------- materials ----------
const matCache = new Map();
export function bodyMaterial(color) {
  if (!matCache.has(color)) matCache.set(color, patchLit(new THREE.MeshPhysicalMaterial({ color, metalness: .62, roughness: .3, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.35, sheen: .25, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), .35), sheenRoughness: .4 })));
  return matCache.get(color);
}
export const MATS = {
  trim: patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .35, roughness: .5 })),
  glass: patchLit(new THREE.MeshPhysicalMaterial({ color: 0x080b10, metalness: .35, roughness: .02, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2, reflectivity: 1 })),
  lights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
};

// ---------- geometry helpers ----------
const C = (hex) => new THREE.Color(hex);
function colorize(geo, color) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  if (geo.attributes.uv === undefined) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}
const box = (w, h, d, x, y, z, color) => colorize(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
// box in the car frame: dx = length (x), dy = height, dz = width
const cbox = (dx, dy, dz, x, y, z, color, rz = 0) => colorize(new THREE.BoxGeometry(dx, dy, dz).rotateZ(rz).translate(x, y, z), color);
// flat 2D outline drawn on the nose (sign=+1) or tail (sign=-1): pts are [z, y]
function facePlate(pts, depth, x, sign, color) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([a, b]) => s.lineTo(a, b));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.rotateY(sign > 0 ? -Math.PI / 2 : Math.PI / 2).translate(x, 0, 0);
  return colorize(g, color);
}
const disc = (r, len, x, y, z, color, seg = 14) => colorize(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z), color);

function taperFn(B) {
  const [top, nose, tail] = B.taper, half = B.L / 2, hip = B.hip || 0;
  return (x, y) => {
    const ty = Math.max(0, Math.min(1, (y - B.belt) / Math.max(.01, B.top - B.belt)));
    const tn = Math.max(0, (x - (half - .8)) / .8), tt = Math.max(0, ((-half + .7) - x) / .7);
    let k = 1 - top * 0.45 * ty - nose * 0.35 * tn * tn - tail * 0.3 * tt * tt;
    if (hip) {
      const bulge = Math.max(...B.wheels.map((w) => Math.exp(-(((x - w) / .85) ** 2))));
      const low = y < B.belt - .05 ? 1 : Math.max(0, 1 - (y - B.belt + .05) / .2);
      k *= 1 - hip + hip * bulge * low + hip * (1 - low) * .6;
    }
    return k;
  };
}
function extrude(points, width, B, bevel = .05, arches = null) {
  const shape = new THREE.Shape();
  if (arches) {
    const last = points[points.length - 1];
    shape.moveTo(last[0], B.bottom);
    const R = B.r + .08;
    for (const cx of [...arches].sort((a, b) => a - b)) {
      if (cx - R < last[0] || cx + R > points[0][0]) continue;
      const th = Math.asin(Math.max(-1, Math.min(1, (B.bottom - B.r) / R)));
      shape.lineTo(cx - R * Math.cos(th), B.bottom);
      for (let k = 0; k <= 10; k++) {
        const a = Math.PI - th - (k / 10) * (Math.PI - 2 * th);
        shape.lineTo(cx + R * Math.cos(a), B.r + R * Math.sin(a));
      }
      shape.lineTo(cx + R * Math.cos(th), B.bottom);
    }
    shape.lineTo(points[0][0], B.bottom);
    points.forEach(([x, y]) => shape.lineTo(x, y));
  } else {
    shape.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
  }
  const depth = Math.max(.05, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .8, bevelSegments: 1, curveSegments: 2 });
  g.translate(0, 0, -depth / 2);
  const tf = taperFn(B), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * tf(p.getX(i), p.getY(i)));
  g.computeVertexNormals();
  return g;
}
function pane(a, b, width, off = .03, th = .03) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), nx = dy / len, ny = -dx / len;
  const o = off, p = [[a[0] + nx * o, a[1] + ny * o], [b[0] + nx * o, b[1] + ny * o], [b[0] + nx * (o + th), b[1] + ny * (o + th)], [a[0] + nx * (o + th), a[1] + ny * (o + th)]];
  const s = new THREE.Shape(); s.moveTo(...p[0]); p.slice(1).forEach((q) => s.lineTo(...q));
  return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false }).translate(0, 0, -width / 2);
}

// wheel in shape frame: axis along z
function wheelGeo(r, detailed, rim = {}) {
  const parts = [];
  const rimCol = C(rim.color ?? (detailed ? 0xc9ced6 : 0x8b9098));
  parts.push(colorize(tireGeo(r, detailed), C(0x141417)));
  if (!detailed) {
    parts.push(colorize(new THREE.CylinderGeometry(r * .66, r * .66, .3, 10).rotateX(Math.PI / 2), rimCol));
    parts.push(colorize(new THREE.CylinderGeometry(r * .22, r * .22, .31, 8).rotateX(Math.PI / 2), C(0x2a2d33)));
    return mergeGeometries(parts);
  }
  const rr = r * .74;
  parts.push(colorize(new THREE.CylinderGeometry(rr, rr, .27, 24, 1, false).rotateX(Math.PI / 2), C(0x0e0f12)));       // barrel
  parts.push(colorize(new THREE.CylinderGeometry(rr * .8, rr * .8, .285, 24).rotateX(Math.PI / 2), C(0x80868e)));        // brake disc face
  parts.push(colorize(new THREE.CylinderGeometry(rr * .36, rr * .36, .29, 16).rotateX(Math.PI / 2), C(0x3a3e45)));       // disc hat
  const face = [];
  face.push(colorize(new THREE.TorusGeometry(rr, .026, 6, 28).translate(0, 0, .15), rimCol));                        // lip
  face.push(colorize(new THREE.TorusGeometry(rr * .96, .01, 4, 28).translate(0, 0, .158), C(0x2a2d33)));             // lip edge shadow
  face.push(colorize(new THREE.BoxGeometry(r * .3, r * .56, .07).translate(rr * .58, 0, .13).rotateZ(.7), C(rim.caliper ?? 0xd41f1f)));
  const n = rim.spokes || 5, thick = n >= 20 ? .016 : n >= 10 ? .026 : .042;
  const pair = n <= 6 ? [-.085, .085] : [0];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    for (const o of pair) {
      const sp = new THREE.BoxGeometry(rr * .8, r * thick * 2.4, .035, 4, 1, 1).translate(rr * .5, 0, 0);
      const pa = sp.attributes.position; // concave dish: spokes sink toward the hub
      for (let i = 0; i < pa.count; i++) pa.setZ(i, pa.getZ(i) - (1 - pa.getX(i) / rr) * .045);
      face.push(colorize(sp.rotateZ(a + o).translate(0, 0, .165), rimCol));
    }
  }
  face.push(colorize(new THREE.CylinderGeometry(r * .15, r * .17, .03, 14).rotateX(Math.PI / 2).translate(0, 0, .13), rimCol)); // hub
  face.push(colorize(new THREE.CylinderGeometry(r * .07, r * .07, .01, 10).rotateX(Math.PI / 2).translate(0, 0, .147), C(0x15171b))); // cap
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; face.push(colorize(new THREE.CylinderGeometry(.012, .012, .02, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * r * .11, Math.sin(a) * r * .11, .148), C(0x9aa1ab))); }
  const outer = mergeGeometries(face);
  parts.push(outer, outer.clone().rotateY(Math.PI)); // inner face is the same design turned around
  return mergeGeometries(parts);
}

// cross-section of the lofted body: fraction of half-width at a given height fraction (matches SIDE_HI)
const SIDEZ = [[0, .8], [.04, .92], [.14, .97], [.3, .99], [.5, 1], [.68, .998], [.84, .99], [.93, .976], [.972, .952], [.993, .9], [1, .7]];
function sideZ(B, tf, x, y) {
  const sp = bodySpan(B, x);
  const yn = sp ? Math.max(0, Math.min(1, (y - sp[0]) / (sp[1] - sp[0]))) : .5;
  let k = 1;
  for (let i = 0; i < SIDEZ.length - 1; i++) if (yn >= SIDEZ[i][0] && yn <= SIDEZ[i + 1][0]) { const t = (yn - SIDEZ[i][0]) / (SIDEZ[i + 1][0] - SIDEZ[i][0]); k = SIDEZ[i][1] + (SIDEZ[i + 1][1] - SIDEZ[i][1]) * t; }
  return (B.W / 2) * tf(x, y) * (B.boxy ? 1 : k);
}

// Surface-aware placement: every detail is a thin part whose outer face sits on the body.
function surface(B, tf) {
  const h = B.L / 2;
  const hwMax = (x, y) => (B.W / 2) * tf(x, y);
  const plan = (x, y, z) => { const u = Math.min(1, Math.abs(z) / Math.max(.3, hwMax(x, y))); return Math.pow(u, 7) * .18; };
  const fX = (y, z) => { const x0 = frontAt(B, y); return x0 - plan(x0 - .2, y, z); };
  const rX = (y, z) => { const x0 = rearAt(B, y); return x0 + plan(x0 + .2, y, z); };
  const orient = (g, face, y, z, dx) => {
    const X = face > 0 ? fX : rX;
    const vy = (X(y + .03, z) - X(y - .03, z)) / .06;          // lean of the fascia
    const vz = (X(y, z + .04) - X(y, z - .04)) / .08;          // wrap around the corner
    g.rotateZ(face > 0 ? -Math.atan(vy) : Math.atan(vy));
    g.rotateY(Math.atan(vz) * (face > 0 ? 1 : 1));
    g.translate(X(y, z) - face * (dx / 2 - .008), y, z);
    return g;
  };
  return {
    h, hwMax, fX, rX,
    // box on the nose (face=+1) or tail (face=-1); proud = how far it stands off the surface
    face: (face, dx, dy, dz, y, z, color, proud = 0) => colorize(orient(new THREE.BoxGeometry(dx, dy, dz), face, y, z, dx - (proud + .012) * 2), color),
    faceDisc: (face, r, len, y, z, color, seg = 16) => colorize(orient(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2), face, y, z, len), color),
    faceRing: (face, r, tube, y, z, color) => colorize(orient(new THREE.TorusGeometry(r, tube, 6, 20).rotateY(Math.PI / 2), face, y, z, tube * 2), color),
    side: (dx, dy, dz, x, y, s, color, rz = 0) => colorize(new THREE.BoxGeometry(dx, dy, dz).rotateZ(rz).translate(x, y, s * (sideZ(B, tf, x, y) + dz / 2 - .006)), color),
    top: (dx, dy, dz, x, z, color, lift = 0) => {
      const y = bodyTop(B, x), slope = Math.atan2(bodyTop(B, x + .05) - bodyTop(B, x - .05), .1);
      return colorize(new THREE.BoxGeometry(dx, dy, dz).rotateZ(slope).translate(x, y + dy / 2 - .01 + lift, z), color);
    },
  };
}

// details every lofted car gets: wheel-well liners, mirrors, door seams & handles, wipers
function commonDetails(B, tf, P, gh, detailed) {
  const black = C(0x08080a), seamCol = C(0x1c1d21), handleCol = C(0x9aa1ab), R = B.r + .08;
  for (const w of B.wheels) if (Math.abs(w) + R < B.L / 2) P.trim.push(box(R * 1.85, R * .95, Math.max(.3, B.W - .68), w, B.r + R * .52, 0, black));
  if (!gh) return;
  // mirrors at the base of the A-pillar
  const mx = gh.g1 - .3, my = bodyTop(B, mx) + .1;
  for (const s of [1, -1]) {
    const zb = sideZ(B, tf, mx, bodyTop(B, mx) - .06) - .04;
    P.trim.push(box(.07, .035, .16, mx + .02, my - .05, s * (zb + .05), black));
    P.body.push(colorize(new THREE.SphereGeometry(1, 12, 8).scale(.15, .075, .12).translate(mx, my, s * (zb + .17)), C(0xffffff)));
    P.trim.push(box(.02, .1, .17, mx - .1, my, s * (zb + .17), black));
  }
  if (!detailed) return;
  const wx = gh.g1 - .12, wy = bodyTop(B, wx) + .02;
  for (const z of [.32, -.1]) P.trim.push(colorize(new THREE.BoxGeometry(.025, .015, .55).rotateY(-.2).translate(wx, wy, z), black));
  // doors
  const doors = B.doors || 2, fa = B.wheels[0], ra = B.wheels[B.wheels.length - 1];
  const d0 = Math.min(gh.g1 - .12, fa - R - .12);
  const cuts = doors === 4 ? [d0, gh.bX, Math.max(ra + R + .1, gh.rr - .2)] : [d0, Math.max(ra + R + .14, gh.rr - .1)];
  for (const x of cuts) {
    const yTop = bodyTop(B, x) - .05, yBot = B.bottom + .16;
    for (let k = 0; k < 8; k++) {
      const y0 = yBot + (yTop - yBot) * (k / 8), y1 = yBot + (yTop - yBot) * ((k + 1) / 8), ym = (y0 + y1) / 2;
      for (const s of [1, -1]) P.trim.push(box(.006, y1 - y0 + .004, .01, x, ym, s * (sideZ(B, tf, x, ym) - .002), seamCol));
    }
  }
  for (let i = 1; i < cuts.length; i++) {
    const hx = cuts[i] + .26, hy = bodyTop(B, hx) - .13;
    for (const s of [1, -1]) P.trim.push(box(.19, .028, .02, hx, hy, s * (sideZ(B, tf, hx, hy) + .004), handleCol));
  }
}

// ---------- real-car detailing ----------
function realDetails(B, tf, P, gh) {
  const S = surface(B, tf), h = S.h, W = B.W;
  const black = C(0x0b0b0d), gloss = C(0x141519), chrome = C(0xc3c9d1), darkChrome = C(0x454a52);
  const white = C(0xfff6e8), red = C(0xff1e1e), amber = C(0xffa21a), smoked = C(0x2a0707), mBlue = C(0x2f7bff), plate = C(0xe9ecef);
  const y0 = B.noseLo + .02, y1 = B.noseHi - .02;           // front fascia band
  const mCar = B.extras.includes("powerdome");
  const T = P.trim, F = (...a) => S.face(1, ...a), Rr = (...a) => S.face(-1, ...a);
  const hwF = (y) => S.hwMax(S.fX(y, 0) - .3, y);

  // ---- grilles ----
  const g = B.grille;
  const kidney = (w, hg, zc, yc, frame, slats, frameCol = chrome) => {
    for (const s of [1, -1]) {
      T.push(F(.05, hg, w, yc, s * zc, frameCol));
      T.push(F(.05, hg - .03, w - .03, yc, s * zc, black, .004));
      for (let i = 1; i <= slats; i++) T.push(F(.04, .012, w - .05, yc - hg / 2 + (i / (slats + 1)) * hg, s * zc, darkChrome, .008));
    }
  };
  if (g === "kidney") kidney(.25, .19, .155, y1 - .12, 0, 4);
  if (g === "kidneyVert") kidney(.19, .25, .125, y1 - .15, 0, 5, darkChrome);
  if (g === "kidneyWide") kidney(.33, .17, .19, y1 - .13, 0, 3, gloss);
  if (g === "kidneyTall") kidney(.21, .42, .125, y1 - .26, 0, 7, darkChrome);
  if (g === "kidneyXL") kidney(.32, .3, .19, y1 - .18, 0, 3);
  if (g === "infiniti") {
    T.push(F(.05, .25, .66, y1 - .16, 0, chrome)); T.push(F(.05, .21, .6, y1 - .16, 0, black, .004));
    for (let i = -6; i <= 6; i++) for (let j = 0; j < 3; j++) T.push(F(.03, .02, .03, y1 - .23 + j * .06, i * .045, darkChrome, .008));
  }
  if (g === "amg") {
    T.push(F(.05, .28, .72, y1 - .17, 0, black));
    for (let i = -5; i <= 5; i++) T.push(F(.04, .24, .016, y1 - .17, i * .06, chrome, .006));
    T.push(F(.04, .025, .72, y1 - .17, 0, chrome, .01));
  }
  if (g === "audi") {
    T.push(F(.05, .38, .84, (y0 + y1) / 2 + .02, 0, gloss));
    for (let i = 0; i < 5; i++) for (let j = -6; j <= 6; j++) T.push(F(.03, .035, .05, (y0 + y1) / 2 - .12 + i * .065, j * .06 + (i % 2) * .03, darkChrome, .006));
  }
  if (g === "dodge" || g === "dodgeWide") {
    const wide = g === "dodgeWide", hh = wide ? .26 : .18, ww = wide ? hwF(y1 - .15) * 1.85 : 1.2;
    T.push(F(.05, hh, ww, y1 - hh / 2 - .03, 0, black));
    T.push(F(.04, .014, ww * .9, y1 - hh / 2 - .03, 0, darkChrome, .006));
    if (!wide) T.push(F(.04, hh * .9, .014, y1 - hh / 2 - .03, 0, darkChrome, .006));
    T.push(F(.05, .12, 1.3, y0 + .08, 0, black));
  }
  if (g === "supra") { T.push(F(.05, .2, .92, y0 + .13, 0, black)); T.push(F(.05, .06, .32, y1 - .08, 0, black)); }
  if (g === "nissan") { T.push(F(.05, .3, .6, (y0 + y1) / 2, 0, black)); T.push(F(.04, .03, .62, (y0 + y1) / 2 + .15, 0, chrome, .006)); }
  if (g === "vw") { T.push(F(.05, .06, 1.0, y1 - .05, 0, black)); T.push(F(.05, .22, 1.1, y0 + .14, 0, black)); P.head.push(F(.03, .01, .95, y1 - .085, 0, C(0xcfe3ff), .01)); }
  if (g === "c8") T.push(F(.05, .1, .8, y0 + .07, 0, black));
  if (g === "svj") {
    for (const s of [1, -1]) {
      const zc = s * (hwF(y0 + .12) - .36);
      T.push(F(.06, .22, .46, y0 + .13, zc, black));
      for (let i = 0; i < 3; i++) T.push(F(.04, .012, .4, y0 + .06 + i * .06, zc, darkChrome, .006));
    }
    T.push(F(.05, .08, .5, y0 + .05, 0, black));
  }
  if (!["vw", "supra", "c8", "dodge", "dodgeWide", "svj"].includes(g)) for (const s of [1, -1]) T.push(F(.05, .15, .3, y0 + .1, s * (hwF(y0 + .1) - .32), black));
  if (B.extras.includes("splitter")) T.push(colorize(new THREE.BoxGeometry(.2, .022, hwF(B.noseLo) * 1.6).translate(S.fX(B.noseLo, 0) - .13, B.noseLo - .005, 0), black));

  // ---- headlights ----
  const hy = B.hl[1];
  for (const s of [1, -1]) {
    const z = s * (hwF(hy) - .27), sig = s > 0 ? P.sigR : P.sigL, t = B.hlType;
    if (t === "round2") {
      for (const k of [-1, 1]) { const zz = z + s * k * .1; T.push(S.faceDisc(1, .085, .05, hy - .03, zz, gloss)); P.head.push(S.faceRing(1, .062, .012, hy - .03, zz, white)); P.head.push(S.faceDisc(1, .03, .02, hy - .03, zz, white)); }
      sig.push(F(.03, .03, .12, y0 + .16, z, amber, .004));
      continue;
    }
    const tall = t === "bmw" ? .13 : t === "c8" || t === "y" ? .08 : .1, wide = t === "swoop" || t === "audi" || t === "charger" ? .5 : .44;
    T.push(F(.05, tall, wide, hy, z, t === "bmw" ? darkChrome : gloss));
    T.push(F(.04, tall * .7, wide * .35, hy - tall * .08, z + s * wide * .18, chrome, .004));                       // reflector
    P.head.push(S.faceDisc(1, tall * .22, .02, hy - tall * .08, z + s * wide * .18, white, 12));                    // projector
    if (t === "bmw") {
      P.head.push(F(.03, .02, wide * .75, hy + tall * .32, z - s * .03, white, .008));
      P.head.push(F(.03, tall * .6, .02, hy, z - s * wide * .4, white, .008));
      if (mCar) T.push(F(.03, .012, .1, hy - tall * .38, z + s * .05, mBlue, .008));
    } else if (t === "charger") {
      P.head.push(F(.03, .014, wide * .95, hy + .04, z, white, .008)); P.head.push(F(.03, .014, wide * .95, hy - .04, z, white, .008));
    } else if (t === "audi") {
      for (let i = 0; i < 5; i++) P.head.push(F(.03, .016, .06, hy + .03, z - s * .18 + s * i * .08, white, .008));
    } else if (t === "y") {
      P.head.push(F(.03, .014, .2, hy + .015, z + s * .02, white, .008));
      P.head.push(colorize(new THREE.BoxGeometry(.03, .014, .12).rotateX(s * .7).translate(S.fX(hy, z - s * .12) + .005, hy - .012, z - s * .12), white));
      P.head.push(colorize(new THREE.BoxGeometry(.03, .014, .12).rotateX(-s * .7).translate(S.fX(hy, z - s * .12) + .005, hy + .035, z - s * .12), white));
    } else {
      P.head.push(F(.03, .016, wide * .85, hy + tall * .3, z, white, .008));
    }
    sig.push(F(.03, .018, .13, hy - tall * .42, z + s * wide * .3, amber, .008));
  }

  // ---- taillights ----
  const ty = B.tl[1], tt = B.tlType, hwR = S.hwMax(S.rX(ty, 0) + .3, ty);
  if (tt === "ring") {
    const ww = hwR * 2 - .16;
    T.push(Rr(.05, .2, ww, ty, 0, smoked));
    P.tail.push(Rr(.03, .022, ww * .98, ty + .075, 0, red, .006)); P.tail.push(Rr(.03, .022, ww * .98, ty - .075, 0, red, .006));
    for (const s of [1, -1]) { P.tail.push(Rr(.03, .17, .03, ty, s * ww * .49, red, .006)); (s > 0 ? P.sigR : P.sigL).push(Rr(.03, .05, .1, ty, s * (ww * .49 - .1), amber, .006)); }
  } else if (tt === "split") {
    for (const s of [1, -1]) { T.push(Rr(.05, .16, hwR - .12, ty, s * (hwR / 2 + .04), smoked)); P.tail.push(Rr(.03, .09, hwR - .22, ty, s * (hwR / 2 + .06), red, .006)); (s > 0 ? P.sigR : P.sigL).push(Rr(.03, .025, .14, ty - .06, s * (hwR - .2), amber, .008)); }
  } else {
    for (const s of [1, -1]) {
      const z = s * (hwR - .25), sig = s > 0 ? P.sigR : P.sigL;
      if (tt === "round4") {
        for (const k of [0, 1]) { const zz = s * (hwR - .2 - k * .26); T.push(S.faceDisc(-1, .095, .05, ty, zz, gloss)); P.tail.push(S.faceRing(-1, .07, .016, ty, zz, red)); P.tail.push(S.faceDisc(-1, .028, .02, ty, zz, red)); }
        sig.push(Rr(.03, .02, .1, ty - .13, s * (hwR - .33), amber, .006));
        continue;
      }
      const wide = tt === "audi" || tt === "audiBar" ? .46 : tt === "supra" || tt === "c8" ? .34 : .42;
      const tall = tt === "supra" || tt === "c8" ? .06 : tt === "bmwL" ? .15 : .1;
      T.push(Rr(.05, tall + .03, wide + .03, ty, z, smoked));
      if (tt === "bmwL") {
        P.tail.push(Rr(.03, .028, wide * .9, ty + .045, z + s * .01, red, .006));
        P.tail.push(Rr(.03, .11, .028, ty - .005, z - s * wide * .43, red, .006));
        P.tail.push(Rr(.03, .02, wide * .45, ty - .04, z + s * .08, red, .006));
      } else if (tt === "y") {
        P.tail.push(Rr(.03, .02, .28, ty, z - s * .02, red, .006));
        P.tail.push(colorize(new THREE.BoxGeometry(.03, .02, .15).rotateX(s * .8).translate(S.rX(ty, z) - .004, ty + .045, z + s * .16), red));
        P.tail.push(colorize(new THREE.BoxGeometry(.03, .02, .15).rotateX(-s * .8).translate(S.rX(ty, z) - .004, ty - .045, z + s * .16), red));
      } else {
        P.tail.push(Rr(.03, tall * .35, wide * .92, ty + tall * .22, z, red, .006));
        P.tail.push(Rr(.03, tall * .75, .035, ty, z + s * wide * .44, red, .006));
        if (tt === "q" || tt === "amg") P.tail.push(Rr(.03, tall * .28, wide * .55, ty - tall * .25, z - s * wide * .15, red, .006));
      }
      sig.push(Rr(.03, .02, .12, ty - tall / 2 - .02, z - s * wide * .25, amber, .006));
    }
    if (tt === "audiBar") P.tail.push(Rr(.03, .012, hwR * 2 - .6, ty + .02, 0, C(0x991010), .006));
  }

  // plate + recess
  const py = B.tailLo + .26;
  T.push(Rr(.04, .15, .56, py, 0, black)); T.push(Rr(.03, .11, .5, py, 0, plate, .004)); T.push(Rr(.02, .025, .34, py, 0, C(0x30343c), .008));

  // ---- exhausts ----
  const ey = B.tailLo + .05, hwE = S.hwMax(S.rX(ey, 0) + .2, ey);
  const tip = (r, z, col = darkChrome, y = ey, sz = 1) => {
    const x = S.rX(y, z) - .02;
    T.push(colorize(new THREE.CylinderGeometry(r, r, .18, 18).rotateZ(Math.PI / 2).scale(1, 1, sz).translate(x, y, z), col));
    T.push(colorize(new THREE.CylinderGeometry(r * .78, r * .78, .19, 16).rotateZ(Math.PI / 2).scale(1, 1, sz).translate(x - .004, y, z), black));
  };
  const e = B.exType;
  if (e === "mQuad" || e === "golfQuad") for (const s of [1, -1]) { tip(.048, s * (hwE - .5)); tip(.048, s * (hwE - .37)); }
  if (e === "twinSquare") for (const s of [1, -1]) { T.push(Rr(.14, .08, .17, ey, s * (hwE - .42), darkChrome, .06)); T.push(Rr(.14, .06, .14, ey, s * (hwE - .42), black, .064)); }
  if (e === "twinRound") for (const s of [1, -1]) tip(.055, s * (hwE - .42));
  if (e === "quadTrap") for (const s of [1, -1]) for (const o of [.36, .5]) { T.push(Rr(.14, .07, .11, ey, s * (hwE - o), chrome, .06)); T.push(Rr(.14, .05, .09, ey, s * (hwE - o), black, .064)); }
  if (e === "rsOval") for (const s of [1, -1]) tip(.07, s * (hwE - .46), darkChrome, ey, 1.6);
  if (e === "dualRect") for (const s of [1, -1]) { T.push(Rr(.14, .09, .22, ey, s * (hwE - .45), chrome, .06)); T.push(Rr(.14, .065, .19, ey, s * (hwE - .45), black, .064)); }
  if (e === "gtrQuad") for (const s of [1, -1]) { tip(.058, s * (hwE - .52), C(0x8f7d62)); tip(.058, s * (hwE - .37), C(0x8f7d62)); }
  if (e === "svjCenter") for (const s of [1, -1]) tip(.08, s * .13, darkChrome, B.tailLo + .36);
  if (e === "centerQuad") for (const z of [-.22, -.08, .08, .22]) { T.push(Rr(.14, .08, .1, B.tailLo + .2, z, darkChrome, .06)); T.push(Rr(.14, .06, .08, B.tailLo + .2, z, black, .064)); }

  // ---- aero & body extras ----
  const X = B.extras;
  if (X.includes("diffuser")) {
    const dy = B.tailLo + .02;
    T.push(Rr(.3, .09, S.hwMax(-h + .3, dy) * 1.5, dy, 0, black));
    for (let i = -2; i <= 2; i++) T.push(Rr(.28, .1, .015, dy - .04, i * .16, black, .02));
  }
  const deckX = -h + .2;
  if (X.includes("lip")) (mCar ? T : P.body).push(S.top(.1, .03, S.hwMax(deckX, B.deck) * 1.7, deckX + .02, 0, mCar ? black : C(0xffffff)));
  if (X.includes("ducktail")) P.body.push(S.top(.24, .05, S.hwMax(deckX, B.deck) * 1.75, deckX + .06, 0, C(0xffffff)));
  if (X.includes("roofSpoiler")) T.push(colorize(new THREE.BoxGeometry(.3, .035, S.hwMax(B.roof[1], B.top) * 1.45).rotateZ(.08).translate(B.roof[1] - .08, B.top + .03, 0), black));
  if (X.includes("wing") || X.includes("alaWing")) {
    const ala = X.includes("alaWing"), wy = B.deck + (ala ? .34 : .28), wx = -h + (ala ? .32 : .24);
    T.push(colorize(new THREE.BoxGeometry(.36, .03, W * (ala ? .92 : .82)).rotateZ(.09).translate(wx, wy, 0), black));
    for (const s of [1, -1]) {
      T.push(colorize(new THREE.BoxGeometry(.3, .14, .025).translate(wx, wy + .01, s * W * (ala ? .46 : .41)), black));
      T.push(colorize(new THREE.BoxGeometry(.06, wy - bodyTop(B, wx + .1), .03).rotateZ(-.2).translate(wx + .1, (wy + bodyTop(B, wx + .1)) / 2, s * (ala ? .42 : .5)), black));
    }
  }
  if (X.includes("louvers")) for (let i = 0; i < 6; i++) T.push(S.top(.05, .02, .8, B.cX - .15 - i * .15, 0, black));
  if (X.includes("hoodVents2")) for (const s of [1, -1]) T.push(S.top(.32, .015, .16, h - .8, s * .3, black));
  if (X.includes("hoodScoop")) T.push(S.top(.5, .06, .44, h - .85, 0, black));
  if (X.includes("gills")) for (const s of [1, -1]) T.push(S.side(.24, .06, .02, B.wheels[0] - .66, .64, s, black, -.25));
  if (X.includes("sideIntake")) for (const s of [1, -1]) T.push(S.side(.7, .26, .04, B.wheels[1] + .85, .6, s, black, .2));
  if (X.includes("skirts")) for (const s of [1, -1]) { const x = (B.wheels[0] + B.wheels[1]) / 2; T.push(S.side(B.wheels[0] - B.wheels[1] - .95, .06, .03, x, B.bottom + .07, s, black)); }
  if (gh) T.push(colorize(new THREE.BoxGeometry(.2, .05, .06).translate(gh.rr + .12, B.top + .025, 0), black)); // shark-fin antenna
  T.push(box(B.L * .78, .04, W * .82, 0, B.bottom * .6, 0, black));
}

// ---------- model assembly ----------
const geoCache = new Map();
function buildGeometries(bodyKey, detailed) {
  const B = BODIES[bodyKey], half = B.L / 2, W = B.W, tf = taperFn(B);
  const trim = [], glass = [], body = [];
  const dark = C(0x16181d), chrome = C(0x9aa1ab), black = C(0x0a0a0c);
  const head = [], tail = [], sigL = [], sigR = [];

  body.push(loftBody(B, tf, detailed));
  let gh = null;
  if (B.glass) {
    gh = loftGreenhouse(B, tf, detailed, { doors: B.doors });
    if (gh.glass) glass.push(gh.glass);
    if (gh.body) body.push(gh.body);
    if (gh.trim) trim.push(colorize(gh.trim, black));
  }
  commonDetails(B, tf, { trim, glass, body }, gh, detailed);

  if (B.real) {
    realDetails(B, tf, { trim, glass, body, head, tail, sigL, sigR }, gh);
  } else {
    (B.panes || []).forEach(([a, b]) => glass.push(pane(a, b, W * .86)));
    (B.sideWin || []).forEach(([x0, x1, y0, y1]) => {
      for (const s of [1, -1]) glass.push(new THREE.BoxGeometry(x0 - x1, y1 - y0, .04).translate((x0 + x1) / 2, (y0 + y1) / 2, s * (W / 2 * tf((x0 + x1) / 2, (y0 + y1) / 2) + .02)));
    });
    if (B.cargo) { const [x0, x1, y0, y1] = B.cargo; trim.push(box(x0 - x1, y1 - y0, W, (x0 + x1) / 2, (y0 + y1) / 2, 0, C(0xe9ecef))); trim.push(box(B.L * .9, .25, W * .8, -.5, .7, 0, dark)); }
    if (B.bed) trim.push(box(2.0, .08, W * .8, -1.55, 1.24, 0, dark));
    const noseW = W * tf(half, B.hl[1]);
    trim.push(box(.12, .22, noseW * .7, half - .02, B.bottom + .12, 0, dark));
    trim.push(box(.12, .2, W * tf(-half, B.bottom + .2) * .8, -half + .02, B.bottom + .1, 0, dark));
    if (B.glass || B.panes) {
      const mx = B.glass ? B.glass[0][0] - .15 : B.panes[0][0][0] - .2, my = B.belt + .12;
      for (const s of [1, -1]) trim.push(box(.18, .1, .2, mx, my, s * (W / 2 * tf(mx, my) + .1), C(0x202328)));
    }
    (B.exhaust || []).forEach(([x, y, z]) => trim.push(colorize(new THREE.CylinderGeometry(.06, .07, .2, 8).rotateZ(Math.PI / 2).translate(x, y, z), chrome)));
    if (B.wing) {
      trim.push(box(.35, .05, W * .95, -half + .25, B.wing, 0, black));
      for (const s of [1, -1]) trim.push(box(.12, B.wing - .85, .05, -half + .3, (B.wing + .85) / 2, s * .55, black));
      for (const s of [1, -1]) trim.push(box(.4, .22, .03, -half + .25, B.wing + .03, s * W * .475, black));
    }
    if (B.ducktail) trim.push(box(.25, .06, W * .85, -half + .15, 1.02, 0, black));
    if (B.scoop) trim.push(box(.8, .08, .5, 1.3, .96, 0, black));
    if (B.fin) trim.push(box(1.1, .18, .03, -1.6, 1.0, 0, black));
    if (B.vents) for (const s of [1, -1]) trim.push(box(.6, .18, .04, -.9, .55, s * (W / 2 * tf(-.9, .55) + .01), black));
    const hlZ = W / 2 * tf(B.hl[0], B.hl[1]) - .32, tlZ = W / 2 * tf(B.tl[0], B.tl[1]) - .3;
    for (const s of [1, -1]) {
      head.push(box(.1, .09, .38, B.hl[0] + .02, B.hl[1], s * hlZ, C(0xfff6e0)));
      tail.push(box(.08, .09, .36, B.tl[0] - .02, B.tl[1], s * tlZ, C(0xff1a1a)));
      (s > 0 ? sigR : sigL).push(box(.08, .07, .12, B.hl[0], B.hl[1] - .02, s * (hlZ + .26), C(0xffa21a)));
      (s > 0 ? sigR : sigL).push(box(.08, .07, .12, B.tl[0] - .02, B.tl[1] - .02, s * (tlZ + .25), C(0xffa21a)));
    }
    if (["super", "hyper", "coupe"].includes(bodyKey)) tail.push(box(.06, .04, tlZ * 2 - .3, B.tl[0] - .01, B.tl[1] + .02, 0, C(0xff1a1a)));
    trim.push(box(B.L * .8, .04, W * .8, 0, B.bottom * .6, 0, black));
  }

  const out = {
    body: mergeGeometries(body.map((g) => colorize(g, C(0xffffff)))),
    trim: mergeGeometries(trim),
    glass: mergeGeometries(glass.map((g) => colorize(g, C(0xffffff)))),
    head: mergeGeometries(head), tail: mergeGeometries(tail),
    sigL: mergeGeometries(sigL), sigR: mergeGeometries(sigR),
    wheel: wheelGeo(B.r, detailed, B.rim),
  };
  if (!detailed) {
    const wheels = [];
    const wx = W / 2 - .16;
    B.wheels.forEach((x) => [1, -1].forEach((s) => wheels.push(out.wheel.clone().translate(x, B.r, s * wx))));
    out.trim = mergeGeometries([out.trim, ...wheels]);
    out.lightsAll = mergeGeometries([out.head, out.tail, out.sigL, out.sigR]);
  }
  for (const k of Object.keys(out)) out[k]?.rotateY?.(Math.PI / 2);
  return out;
}
function geos(bodyKey, detailed) {
  const k = bodyKey + detailed;
  if (!geoCache.has(k)) geoCache.set(k, buildGeometries(bodyKey, detailed));
  return geoCache.get(k);
}

// Traffic car: 4 meshes, shared materials.
export function makeTrafficCar(bodyKey, color) {
  const g = geos(bodyKey, false), grp = new THREE.Group();
  const body = new THREE.Mesh(g.body, bodyMaterial(color));
  grp.add(body, new THREE.Mesh(g.trim, MATS.trim), new THREE.Mesh(g.glass, MATS.glass), new THREE.Mesh(g.lightsAll, MATS.lights));
  grp.children.forEach((m, i) => { m.castShadow = i < 2; m.receiveShadow = false; });
  grp.add(contactShadow(BODIES[bodyKey].L, BODIES[bodyKey].W));
  grp.userData = { body: bodyKey, L: BODIES[bodyKey].L, W: BODIES[bodyKey].W };
  body.userData.setColor = (c) => (body.material = bodyMaterial(c));
  return grp;
}

// Player / remote car: separate animated wheels and controllable lights.
// Paint finishes: each is a set of physical material parameters, not a texture.
export const FINISHES = {
  gloss: { label: "Gloss", metalness: .55, roughness: .3, clearcoat: 1, clearcoatRoughness: .04, sheen: 0 },
  metallic: { label: "Metallic", metalness: .9, roughness: .24, clearcoat: 1, clearcoatRoughness: .03, sheen: .2 },
  pearl: { label: "Pearl", metalness: .45, roughness: .18, clearcoat: 1, clearcoatRoughness: .02, sheen: 1 },
  satin: { label: "Satin", metalness: .45, roughness: .5, clearcoat: .35, clearcoatRoughness: .35, sheen: .1 },
  matte: { label: "Matte", metalness: .15, roughness: .82, clearcoat: 0, clearcoatRoughness: 1, sheen: 0 },
  chrome: { label: "Chrome wrap", metalness: 1, roughness: .06, clearcoat: 1, clearcoatRoughness: 0, sheen: 0 },
};
export const TINTS = { none: { label: "Clear", c: 0x3a4a58, o: .55 }, light: { label: "Light", c: 0x1a2430, o: .8 }, dark: { label: "Dark", c: 0x080b10, o: .92 }, limo: { label: "Limo", c: 0x020203, o: 1 } };
// Fitment sliders: [min, max, step, default, unit-formatter]
export const FITMENT = {
  drop: { label: "Ride height", min: 0, max: .12, step: .005, def: 0, fmt: (v) => (v ? "-" + Math.round(v * 100) + " cm" : "Stock") },
  offset: { label: "Wheel poke", min: 0, max: .1, step: .005, def: 0, fmt: (v) => (v ? "+" + Math.round(v * 100) + " cm" : "Stock") },
  camber: { label: "Camber", min: 0, max: 10, step: .5, def: 0, fmt: (v) => (v ? "-" + v.toFixed(1) + "°" : "Stock") },
  wsize: { label: "Wheel size", min: 1, max: 1.16, step: .01, def: 1, fmt: (v) => (v > 1.001 ? "+" + Math.round((v - 1) * 100) + "%" : "Stock") },
};
export const STANCES = { stock: { label: "Stock", drop: 0 }, lowered: { label: "Lowered", drop: .045 }, slammed: { label: "Slammed", drop: .09 } };

export class DetailedCar {
  constructor(bodyKey, color) {
    const B = BODIES[bodyKey], g = geos(bodyKey, true);
    this.B = B;
    this.group = new THREE.Group();
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);
    this.bodyMat = patchLit(new THREE.MeshPhysicalMaterial({ color, metalness: .55, roughness: .3, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: .35 }));
    this.glassMat = MATS.glass.clone();
    this.group.add(contactShadow(B.L, B.W));
    const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; this.bodyGroup.add(m); return m; };
    add(g.body, this.bodyMat); add(g.trim, MATS.trim); add(g.glass, this.glassMat, false);
    // each car gets its own wheel geometry so rim and caliper colours can be changed per car
    this.wheelGeo = g.wheel.clone();
    this.wheelBase = this.wheelGeo.attributes.color.array.slice();
    this.rimOrig = new THREE.Color(B.rim?.color ?? 0xc9ced6);
    this.calOrig = new THREE.Color(B.rim?.caliper ?? 0xd41f1f);
    // underglow: an additive light pool under the car, off until fitted
    const ug = document.createElement("canvas"); ug.width = ug.height = 64;
    const gg = ug.getContext("2d"), rg = gg.createRadialGradient(32, 32, 4, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(1, "rgba(255,255,255,0)"); gg.fillStyle = rg; gg.fillRect(0, 0, 64, 64);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(B.W * 1.9, B.L * 1.25).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(ug), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.glow.position.y = .03; this.glow.visible = false; this.group.add(this.glow);
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x991010, toneMapped: false });
    this.sigLMat = new THREE.MeshBasicMaterial({ color: 0x4a2c08, toneMapped: false });
    this.sigRMat = this.sigLMat.clone();
    add(g.head, this.headMat, false); add(g.tail, this.tailMat, false); add(g.sigL, this.sigLMat, false); add(g.sigR, this.sigRMat, false);
    this.wheels = [];
    const wx = B.W / 2 - .16;
    B.wheels.forEach((x) => [1, -1].forEach((s) => {
      const w = new THREE.Mesh(this.wheelGeo, MATS.trim); w.castShadow = true;
      if (s < 0) w.rotation.y = Math.PI;
      const spinner = new THREE.Group(); spinner.add(w);
      const holder = new THREE.Group(); holder.position.set(s * wx, B.r, -x); holder.add(spinner);
      this.group.add(holder); this.wheels.push({ w: spinner, front: x > 0, holder, side: s, baseX: s * wx });
    }));
    this.spin = 0;
  }
  setColor(c) { this.bodyMat.color.set(c); }
  // finish, wheel/caliper colour, tint, stance and underglow
  applyStyle(st = {}) {
    const f = FINISHES[st.finish] || FINISHES.gloss, m = this.bodyMat;
    m.metalness = f.metalness; m.roughness = f.roughness; m.clearcoat = f.clearcoat; m.clearcoatRoughness = f.clearcoatRoughness; m.sheen = f.sheen;
    m.needsUpdate = true;
    const col = this.wheelGeo.attributes.color, a = col.array, base = this.wheelBase;
    const rim = st.rim != null ? new THREE.Color(st.rim) : this.rimOrig, cal = st.caliper != null ? new THREE.Color(st.caliper) : this.calOrig;
    const near = (i, c) => Math.abs(base[i] - c.r) < .01 && Math.abs(base[i + 1] - c.g) < .01 && Math.abs(base[i + 2] - c.b) < .01;
    for (let i = 0; i < a.length; i += 3) {
      const src = near(i, this.rimOrig) ? rim : near(i, this.calOrig) ? cal : null;
      if (src) { a[i] = src.r; a[i + 1] = src.g; a[i + 2] = src.b; } else { a[i] = base[i]; a[i + 1] = base[i + 1]; a[i + 2] = base[i + 2]; }
    }
    col.needsUpdate = true;
    const t = TINTS[st.tint] || TINTS.dark;
    this.glassMat.color.set(t.c); this.glassMat.opacity = t.o; this.glassMat.transparent = t.o < 1;
    // fitment: ride height sinks the body over the wheels; poke, camber and size move the wheels
    const drop = st.drop != null ? st.drop : (STANCES[st.stance] || STANCES.stock).drop;
    this.bodyGroup.position.y = -drop;
    const off = st.offset || 0, cam = (st.camber || 0) * Math.PI / 180, ws = st.wsize || 1;
    for (const wh of this.wheels) {
      wh.holder.position.x = wh.baseX + wh.side * off;
      wh.holder.position.y = this.B.r * ws;
      wh.holder.rotation.z = wh.side * cam;       // top of the wheel leans in: negative camber
      wh.w.scale.setScalar(ws);
    }
    this.drl = st.drl != null ? new THREE.Color(st.drl) : null;
    this.glow.visible = st.glow != null;
    if (st.glow != null) { this.glow.material.color.set(st.glow); this.glow.material.opacity = .9; }
  }
  setLights(brake, left, right, night) {
    this.tailMat.color.setRGB(brake ? 2.2 : .45 + night * .5, brake ? .08 : .03, brake ? .08 : .03);
    const on = [1.8, .9, .08], off = [.18, .1, .02];
    this.sigLMat.color.setRGB(...(left ? on : off));
    this.sigRMat.color.setRGB(...(right ? on : off));
    if (this.drl) this.headMat.color.copy(this.drl).multiplyScalar(1.5 + night * 1.2);
    else this.headMat.color.setScalar(.9 + night * 1.6);
  }
  update(dist, steer) {
    this.spin -= dist / this.B.r;
    for (const { w, front } of this.wheels) {
      w.rotation.x = this.spin;
      w.parent.rotation.y = front ? -steer * .35 : 0;
    }
  }
  dispose() { this.bodyMat.dispose(); }
}
