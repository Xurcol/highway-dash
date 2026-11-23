// Builds a static copy of the game for GitHub Pages (multiplayer runs over the public relay).
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
const three = path.join(root, "node_modules", "three");
const domain = process.argv.slice(2).find((a) => !a.startsWith("--")) || "xurco.xyz";
const withSounds = process.argv.includes("--with-sounds"); // recorded engine banks are third-party audio: opt-in only

fs.rmSync(out, { recursive: true, force: true });
// the loading screen's song and video are a commercial track and clip: local builds only, never published
fs.cpSync(path.join(root, "public"), out, { recursive: true, filter: (src) => !src.includes(path.join("public", "loader-media")) && (withSounds || !src.includes(path.join("public", "sounds"))) });
for (const rel of [
  "build/three.module.js", "build/three.core.js",
  "examples/jsm/postprocessing", "examples/jsm/shaders",
  "examples/jsm/environments", "examples/jsm/utils", "examples/jsm/loaders/GLTFLoader.js",
  "examples/jsm/loaders/DRACOLoader.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/libs/draco/gltf",
]) fs.cpSync(path.join(three, rel), path.join(out, "vendor", "three", rel), { recursive: true });
// cache-busting: version every local module/stylesheet reference so browsers never mix old and new files
const v = Date.now().toString(36);
const bust = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, "utf8")));
for (const f of fs.readdirSync(path.join(out, "js"))) {
  if (!f.endsWith(".js")) continue;
  bust(path.join(out, "js", f), (src) => src
    .replace(/(from\s+["']\.\/[\w-]+\.js)(["'])/g, `$1?v=${v}$2`)
    .replace(/(import\(\s*["']\.\/[\w-]+\.js)(["'])/g, `$1?v=${v}$2`)
    .replace(/(new URL\(\s*["']\.\/[\w-]+\.js)(["'])/g, `$1?v=${v}$2`));
}
for (const f of ["index.html", "viewer.html"]) bust(path.join(out, f), (src) => src
  .replace(/(src="js\/[\w-]+\.js)(")/g, `$1?v=${v}$2`)
  .replace(/(href="style\.css)(")/g, `$1?v=${v}$2`));
// the loading screen reads this, so a player can say which build they are on
bust(path.join(out, "index.html"), (src) => src.replace('<html lang="en">', `<html lang="en" data-ver="${v}">`));
// Only car models with a recorded licence/credit go on the public site; the rest stay local.
{
  const mf = path.join(out, "models", "models.json");
  const m = JSON.parse(fs.readFileSync(mf, "utf8")), credited = m.credits || {};
  const held = (m.available || []).filter((id) => !credited[id]);
  m.available = (m.available || []).filter((id) => credited[id]);
  for (const id of held) fs.rmSync(path.join(out, "models", (m[id]?.file || id + ".glb")), { force: true });
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  if (held.length) console.log("Held back (no licence recorded):", held.join(", "));
}
fs.writeFileSync(path.join(out, "CNAME"), domain + "\n");
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`Built ${out} for ${domain}`);
