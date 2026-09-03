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
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 5173;

/**
 * Rebuild data/lessons/manifest.json so a lesson the admin just published or
 * reset shows up in the game right away - nobody types npm run build:lessons.
 */
function rebuildManifest() {
  const result = spawnSync(process.execPath, [path.join(ROOT, "tools/build-lessons.mjs")], {
    cwd: ROOT, encoding: "utf8"
  });
  return { ok: result.status === 0, output: (result.stdout + result.stderr).trim() };
}

/* ------------------------------------------------------------ admin login */

/**
 * The lesson editor writes files, so it is behind a password.
 *
 * A password checked in the browser stops nobody - the page's own JavaScript is
 * readable by anyone who opens it. So the check lives HERE, and the write
 * endpoint refuses anything without a valid token. The page just collects the
 * password and holds the token.
 *
 * Set it with ADMIN_PASSWORD, or in admin.config.json ({ "password": "..." }),
 * which is git-ignored. With neither, one is generated and printed at startup
 * so the server is never quietly wide open with a guessable default.
 */
const CONFIG_FILE = path.join(ROOT, "admin.config.json");

const PBKDF2_ITERATIONS = 120000;
const hashWith = (password, salt, iterations) =>
  crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");

function adminCredential() {
  if (process.env.ADMIN_PASSWORD) {
    return { plain: process.env.ADMIN_PASSWORD, from: "ADMIN_PASSWORD" };
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      if (cfg.hash && cfg.salt) {
        return { hash: cfg.hash, salt: cfg.salt,
                 iterations: Number(cfg.iterations) || PBKDF2_ITERATIONS,
                 from: "admin.config.json" };
      }
      // A plain "password" is the old format. Still honoured so nobody is
      // locked out, but it should be replaced with a hash.
      if (cfg.password) {
        return { plain: String(cfg.password), from: "admin.config.json (plain text - run npm run admin:password)" };
      }
    } catch { /* fall through to a generated one */ }
  }
  return { plain: crypto.randomBytes(6).toString("hex"), from: "generated for this run" };
}

const ADMIN = adminCredential();
const sessions = new Set();

/** Constant-time compare, so response timing cannot be used to guess. */
function samePassword(given) {
  if (ADMIN.hash) {
    const a = Buffer.from(hashWith(given, ADMIN.salt, ADMIN.iterations), "hex");
    const b = Buffer.from(ADMIN.hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const a = Buffer.from(String(given));
  const b = Buffer.from(ADMIN.plain);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks)));
});

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

  /**
   * Dev-only write endpoint, used by tools/build-character.html.
   *
   * Merging Mixamo FBX animation exports into one .glb needs three.js's FBX
   * loader and GLTF exporter, which only run in a browser. The build page does
   * the work and POSTs the result here so it lands on disk.
   *
   * Writes are confined to the project directory and to .glb files.
   */
  /** Exchange the admin password for a token that /__save will accept. */
  if (req.method === "POST" && (url === "/__admin/login" || url.endsWith("/admin/api/login.php"))) {
    readBody(req).then((body) => {
      let given = "";
      try { given = JSON.parse(body.toString("utf8")).password || ""; } catch { /* empty */ }
      if (!samePassword(given)) {
        console.log("  admin login refused");
        res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"Wrong password"}');
        return;
      }
      const token = crypto.randomBytes(24).toString("hex");
      sessions.add(token);
      console.log("  admin signed in");
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ token }));
    });
    return;
  }

  /** Is this token still good? Lets the page restore a session after a reload. */
  if (req.method === "GET" && (url === "/__admin/check" || url.endsWith("/admin/api/check.php"))) {
    const ok = sessions.has(String(req.headers["x-admin-token"] || ""));
    res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" })
       .end(JSON.stringify({ ok }));
    return;
  }

  /** Dev-only directory listing, so the build page can discover source files. */
  if (req.method === "GET" && url === "/__list") {
    const dir = new URL(req.url, "http://x").searchParams.get("dir") || "";
    const target = path.join(ROOT, dir);
    if (!target.startsWith(ROOT) || !fs.existsSync(target)) {
      res.writeHead(404).end("[]");
      return;
    }
    const files = fs.readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(files));
    return;
  }

  if (req.method === "POST" && (url === "/__save" || url.endsWith("/admin/api/save.php"))) {
    const name = String(req.headers["x-filename"] || "");
    const target = path.join(ROOT, name);

    // Two things may be written, and nothing else: a converted model, and a
    // lesson from the editor. Lessons are confined to data/lessons/ so a stray
    // filename cannot overwrite game code.
    const isModel = name.endsWith(".glb");
    const isLesson = /^data\/lessons\/[a-z0-9_-]+\.json$/i.test(name.replace(/\\/g, "/"));
    if (!name || !target.startsWith(ROOT) || !(isModel || isLesson)) {
      res.writeHead(400).end("refused: must be a .glb, or a .json inside data/lessons/");
      return;
    }
    // Lessons come from the admin page, so they need a signed-in session. The
    // .glb path is a local build step with no UI to log in from.
    if (isLesson && !sessions.has(String(req.headers["x-admin-token"] || ""))) {
      res.writeHead(401).end("refused: sign in on the admin page first");
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const data = Buffer.concat(chunks);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      console.log("  saved " + name + "  (" +
        (data.length > 65536 ? (data.length / 1048576).toFixed(2) + " MB" : data.length + " bytes") + ")");

      if (isLesson) {
        const built = rebuildManifest();
        if (!built.ok) console.log("  manifest rebuild failed:\n" + built.output);
        res.writeHead(200, { "Content-Type": "application/json" })
           .end(JSON.stringify({ saved: name, published: built.ok, buildOutput: built.output }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" }).end("saved " + data.length);
    });
    return;
  }
  /** Restore all 30 standard lessons from data/lessons/defaults/, undoing admin edits. */
  if (req.method === "POST" && (url === "/__admin/reset" || url.endsWith("/admin/api/reset.php"))) {
    if (!sessions.has(String(req.headers["x-admin-token"] || ""))) {
      res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"Sign in first"}');
      return;
    }
    const defaultsDir = path.join(ROOT, "data/lessons/defaults");
    if (!fs.existsSync(defaultsDir)) {
      res.writeHead(500, { "Content-Type": "application/json" })
         .end('{"error":"No default lessons are available to reset to"}');
      return;
    }
    const restored = fs.readdirSync(defaultsDir).filter((f) => /^day_\d+\.json$/.test(f));
    restored.forEach((f) => fs.copyFileSync(path.join(defaultsDir, f), path.join(ROOT, "data/lessons", f)));
    console.log("  admin reset " + restored.length + " lesson(s) to standard");
    const built = rebuildManifest();
    if (!built.ok) console.log("  manifest rebuild failed:\n" + built.output);
    res.writeHead(200, { "Content-Type": "application/json" })
       .end(JSON.stringify({ restored, published: built.ok, buildOutput: built.output }));
    return;
  }

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
    const ext = path.extname(target).toLowerCase();
    const cacheable = [".glb", ".gltf", ".png", ".jpg", ".jpeg", ".svg", ".mp3", ".ogg", ".wav", ".woff2"];
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": cacheable.includes(ext) ? "public, max-age=86400" : "no-cache"
    }).end(data);
  });
});

server.listen(PORT, () => {
  console.log("Spoken English Adventure running at http://localhost:" + PORT + "/");
  console.log("  admin      http://localhost:" + PORT + "/admin/");
  console.log("  password   " + (ADMIN.hash ? "(hashed in admin.config.json)" : ADMIN.plain) +
    "   [" + ADMIN.from + "]");
});
