// Serves dist/ as plain static files (like GitHub Pages) for testing the Pages build.
import http from "http";
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..", "dist");
const port = +process.env.PORT || 4000;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary" };
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url.endsWith("/")) url += "index.html";
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(port, () => console.log(`dist on http://localhost:${port}`));
