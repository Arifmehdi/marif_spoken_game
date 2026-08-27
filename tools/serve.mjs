/**
 * Zero-dependency static server, for running the game without Laragon/Apache.
 *
 *   node tools/serve.mjs          -> http://localhost:5173
 *   node tools/serve.mjs 8080     -> http://localhost:8080
 *
 * localhost counts as a secure origin, so the microphone works here.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".woff2": "font/woff2"
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let target = path.join(ROOT, url === "/" ? "index.html" : url);

  // Never serve outside the project directory.
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, "index.html");
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found: " + url);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    }).end(data);
  });
});

server.listen(PORT, () => {
  console.log("Spoken English Adventure running at http://localhost:" + PORT + "/");
});
