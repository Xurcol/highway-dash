// Builds the standalone ARCLINE site for GitHub Pages (multiplayer uses the public relay).
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
const three = path.join(root, "node_modules", "three");
const source = path.join(root, "public");
const domain = process.argv.slice(2).find((a) => !a.startsWith("--")) || "xurco.xyz";
const withSounds = process.argv.includes("--with-sounds"); // recorded engine banks are third-party audio: opt-in only
const withModels = process.argv.includes("--with-models"); // ARCLINE uses procedural city traffic by default

// Follow literal local module references, including lazy imports and worklets, before touching dist.
const references = [
  /(\b(?:import|export)\s+[^;]*?\bfrom\s*)(["'])([^"']+)\2/g,
  /(\bimport\s*)(["'])([^"']+)\2/g,
  /(\bimport\s*\(\s*)(["'])([^"']+)\2/g,
  /(\bnew\s+URL\s*\(\s*)(["'])([^"']+)\2/g,
];
const localFile = (ref, importer, entry = false) => {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(ref) || !entry && !ref.startsWith(".") && !ref.startsWith("/")) return null;
  const name = ref.split(/[?#]/)[0];
  const file = path.resolve(ref.startsWith("/") ? source : path.dirname(importer), ref.startsWith("/") ? "." + name : name);
  const rel = path.relative(source, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Local asset escapes public/: ${ref}`);
  return file;
};
const indexPath = path.join(source, "index.html"), index = fs.readFileSync(indexPath, "utf8");
const modules = new Set();
function visit(file) {
  if (modules.has(file)) return;
  if (!fs.existsSync(file)) throw new Error(`Missing reachable module: ${path.relative(root, file)}`);
  modules.add(file);
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of references) for (const match of text.matchAll(pattern)) {
    if (!/\.m?js(?:[?#]|$)/i.test(match[3])) continue;
    const dependency = localFile(match[3], file);
    if (dependency) visit(dependency);
  }
}
for (const match of index.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) {
  const file = localFile(match[2], indexPath, true);
  if (file && /\.m?js$/i.test(file)) visit(file);
}
if (!modules.has(path.join(source, "js", "main.js"))) throw new Error("ARCLINE index.html must load js/main.js.");
const styles = new Set();
function visitStyle(file) {
  if (styles.has(file)) return;
  if (!fs.existsSync(file)) throw new Error(`Missing stylesheet: ${path.relative(root, file)}`);
  styles.add(file);
  for (const match of fs.readFileSync(file, "utf8").matchAll(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1/g)) {
    const dependency = localFile(match[2], file, true);
    if (dependency && dependency.endsWith(".css")) visitStyle(dependency);
  }
}
for (const match of index.matchAll(/<link\b[^>]*\bhref\s*=\s*(["'])([^"']+\.css(?:[?#][^"']*)?)\1[^>]*>/gi)) {
  const file = localFile(match[2], indexPath, true);
  if (file) visitStyle(file);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(source, out, { recursive: true, filter: (file) => {
  const rel = path.relative(source, file).split(path.sep).join("/");
  const top = rel.split("/")[0];
  if (top === "loader-media" || top === "sounds" && !withSounds || top === "models" && !withModels) return false;
  if (rel.endsWith(".html") && rel !== "index.html") return false;
  if (/\.m?js$/i.test(rel)) return modules.has(file);
  if (rel.endsWith(".css")) return styles.has(file);
  return true;
} });
for (const rel of [
  "build/three.module.js", "build/three.core.js",
  "examples/jsm/postprocessing", "examples/jsm/shaders",
  "examples/jsm/environments", "examples/jsm/utils", "examples/jsm/loaders/GLTFLoader.js",
  "examples/jsm/loaders/DRACOLoader.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/libs/draco/gltf",
]) fs.cpSync(path.join(three, rel), path.join(out, "vendor", "three", rel), { recursive: true });
// cache-busting: version every local module/stylesheet reference so browsers never mix old and new files
const v = Date.now().toString(36);
const bust = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, "utf8")));
const version = (ref) => {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) return ref;
  const [url, hash] = ref.split("#");
  return url + (url.includes("?") ? "&" : "?") + "v=" + v + (hash ? "#" + hash : "");
};
for (const file of modules) {
  // The MQTT vendor bundle stays byte-for-byte intact; its importing URL receives the version.
  if (!path.relative(source, file).startsWith("js" + path.sep)) continue;
  bust(path.join(out, path.relative(source, file)), (text) => {
    for (const pattern of references) text = text.replace(pattern, (all, prefix, quote, ref) =>
      (ref.startsWith(".") || ref.startsWith("/")) && /\.m?js(?:[?#]|$)/i.test(ref) ? prefix + quote + version(ref) + quote : all);
    return text;
  });
}
bust(path.join(out, "index.html"), (text) => text.replace(/(\b(?:src|href)\s*=\s*)(["'])([^"']+\.(?:m?js|css)(?:[?#][^"']*)?)\2/gi,
  (all, prefix, quote, ref) => prefix + quote + version(ref) + quote));
for (const file of styles) bust(path.join(out, path.relative(source, file)), (text) => text.replace(
  /(@import\s+(?:url\(\s*)?)(["'])([^"']+\.css(?:[?#][^"']*)?)\2/gi,
  (all, prefix, quote, ref) => prefix + quote + version(ref) + quote));
// the loading screen reads this, so a player can say which build they are on
bust(path.join(out, "index.html"), (src) => src.replace('<html lang="en">', `<html lang="en" data-ver="${v}">`));
// Only car models with a recorded licence/credit go on the public site; the rest stay local.
{
  const mf = path.join(out, "models", "models.json");
  if (fs.existsSync(mf)) {
    const m = JSON.parse(fs.readFileSync(mf, "utf8")), credited = m.credits || {};
    const held = (m.available || []).filter((id) => !credited[id]);
    m.available = (m.available || []).filter((id) => credited[id]);
    for (const id of held) fs.rmSync(path.join(out, "models", (m[id]?.file || id + ".glb")), { force: true });
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    if (held.length) console.log("Held back (no licence recorded):", held.join(", "));
  }
}
fs.writeFileSync(path.join(out, "CNAME"), domain + "\n");
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`Built ARCLINE (${modules.size} local modules) at ${out} for ${domain}`);
