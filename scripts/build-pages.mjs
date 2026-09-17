// Builds a static copy of the game for GitHub Pages (multiplayer runs over the public relay).
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
const three = path.join(root, "node_modules", "three");
const domain = process.argv.slice(2).find((a) => !a.startsWith("--")) || "xurco.xyz";
const withSounds = process.argv.includes("--with-sounds"); // recorded engine banks are third-party audio: opt-in only

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true, filter: (src) => withSounds || !src.includes(path.join("public", "sounds")) });
for (const rel of [
  "build/three.module.js", "build/three.core.js",
  "examples/jsm/environments", "examples/jsm/utils", "examples/jsm/loaders/GLTFLoader.js",
  "examples/jsm/loaders/DRACOLoader.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/libs/draco/gltf",
]) fs.cpSync(path.join(three, rel), path.join(out, "vendor", "three", rel), { recursive: true });
fs.writeFileSync(path.join(out, "CNAME"), domain + "\n");
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`Built ${out} for ${domain}`);
