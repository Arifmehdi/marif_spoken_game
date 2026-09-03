/**
 * Shrink character .glb files for mobile.
 *
 * The delivered models are ~15 MB each: 80,000 triangles and a 2048x2048 PNG.
 * That is fine on a desktop and unusable on a phone. This runs two passes:
 *
 *   1. geometry - via @gltf-transform/cli (weld, simplify, prune, quantize)
 *   2. textures - downscale and re-encode, done here because the CLI's image
 *      backend (libvips) fails on this machine
 *
 * Usage:
 *   npm run optimize            # process everything in MODELS below
 *   node tools/optimize-models.mjs --size 512 --quality 75
 *
 * Output goes to spoken_game/character/optimized/ and the game points there.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "spoken_game/character/optimized");

const MODELS = [
  { src: "spoken_game/character/main_character/boy_1_merged.glb", out: "boy_1.glb" },
  { src: "spoken_game/character/main_character/boy_2_merged.glb", out: "boy_2.glb" },
  { src: "spoken_game/character/main_character/girl_1_merged.glb", out: "girl_1.glb" },
  { src: "spoken_game/character/main_character/girl_2_merged.glb", out: "girl_2.glb" },
  // NPCs: two animated men, two static women.
  { src: "spoken_game/character/teacher_or_other_character/male_teacher_1_merged.glb", out: "npc_man_1.glb" },
  { src: "spoken_game/character/teacher_or_other_character/male_teacher_2_merged.glb", out: "npc_man_2.glb" },
  { src: "spoken_game/character/teacher_or_other_character/Teacher_lady_1_with_texture.glb", out: "npc_woman_1.glb" },
  { src: "spoken_game/character/teacher_or_other_character/Teacher_lady_2_with_texture.glb", out: "npc_woman_2.glb" }
];

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const TEX_SIZE = Number(arg("size", 1024));
const QUALITY = Number(arg("quality", 82));
const SIMPLIFY_ERROR = arg("simplify", "0.005");

/* ----------------------------------------------------------------- GLB io */

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error(file + " is not a GLB");
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "JSON") json = JSON.parse(data.toString("utf8"));
    else if (type.startsWith("BIN")) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}

const pad4 = (n) => (n + 3) & ~3;

function writeGlb(file, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20);
  const binPad = Buffer.alloc(pad4(bin.length) - bin.length, 0);

  const jsonLen = jsonBuf.length + jsonPad.length;
  const binLen = bin.length + binPad.length;
  const total = 12 + 8 + jsonLen + 8 + binLen;

  const head = Buffer.alloc(12);
  head.write("glTF", 0, "ascii");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);

  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonLen, 0);
  jsonHead.write("JSON", 4, "ascii");

  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binLen, 0);
  binHead.write("BIN\0", 4, "ascii");

  fs.writeFileSync(file, Buffer.concat([head, jsonHead, jsonBuf, jsonPad, binHead, bin, binPad]));
}

/**
 * Rebuild the binary chunk with new image bytes. Every bufferView is copied in
 * order and its byteOffset rewritten, so accessors (which address data by
 * bufferView + local offset) stay valid.
 */
function replaceImages(json, bin, newImages) {
  const parts = [];
  let cursor = 0;

  json.bufferViews.forEach((view, i) => {
    const replacement = newImages.get(i);
    const data = replacement || bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);

    const padding = pad4(cursor) - cursor;
    if (padding) { parts.push(Buffer.alloc(padding, 0)); cursor += padding; }

    view.byteOffset = cursor;
    view.byteLength = data.length;
    parts.push(data);
    cursor += data.length;
  });

  const out = Buffer.concat(parts);
  json.buffers[0].byteLength = out.length;
  return out;
}

/**
 * bufferViews are 4-byte aligned, so an image's slice can carry a few padding
 * bytes past the real end of the file. Decoders reject that ("unrecognised
 * content at end of stream"), so cut the buffer at the format's end marker.
 */
function trimImage(buf) {
  if (buf.length > 8 && buf.toString("ascii", 1, 4) === "PNG") {
    const end = buf.lastIndexOf(Buffer.from("IEND", "ascii"));
    if (end !== -1) return buf.subarray(0, end + 8);   // IEND + 4-byte CRC
  }
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = buf.length - 2; i > 1; i--) {
      if (buf[i] === 0xff && buf[i + 1] === 0xd9) return buf.subarray(0, i + 2);
    }
  }
  return buf;
}

/**
 * Remove per-vertex normals before simplifying.
 *
 * The simplifier can only collapse edges on a WELDED mesh, and welding merges
 * vertices only when every attribute matches. A normal attribute differs across
 * shared vertices, so almost nothing welds and simplification silently does
 * nothing - one teacher stayed at 79,826 triangles while an identical student
 * mesh (which happened to ship without normals) came down to 5,124.
 *
 * Dropping them is safe: ModelLibrary calls computeVertexNormals() on any mesh
 * that arrives without them, and the result is smoother than the originals.
 */
function stripNormals(file) {
  const { json, bin } = readGlb(file);
  let removed = 0;
  (json.meshes || []).forEach((mesh) => {
    mesh.primitives.forEach((prim) => {
      if (prim.attributes && prim.attributes.NORMAL != null) {
        delete prim.attributes.NORMAL;
        removed++;
      }
    });
  });
  if (removed) writeGlb(file, json, bin);   // gltf-transform's prune drops the orphan
  return removed;
}

/* ------------------------------------------------------------- processing */

async function optimiseTextures(file) {
  const { Jimp } = await import("jimp");
  const { json, bin } = readGlb(file);
  if (!json.images || !json.images.length) return { saved: 0, note: "no textures" };

  const replacements = new Map();
  let before = 0, after = 0;

  for (let i = 0; i < json.images.length; i++) {
    const image = json.images[i];
    if (image.bufferView == null) continue;
    const view = json.bufferViews[image.bufferView];
    const raw = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    before += raw.length;

    const img = await Jimp.read(trimImage(Buffer.from(raw)));
    if (img.bitmap.width > TEX_SIZE || img.bitmap.height > TEX_SIZE) {
      img.resize({ w: TEX_SIZE });
    }

    // Character skins are opaque; JPEG is far smaller than PNG for them.
    // Only keep PNG when the alpha channel is actually used.
    let transparent = false;
    const d = img.bitmap.data;
    for (let p = 3; p < d.length; p += 4) { if (d[p] < 250) { transparent = true; break; } }

    const mime = transparent ? "image/png" : "image/jpeg";
    const encoded = transparent
      ? await img.getBuffer("image/png")
      : await img.getBuffer("image/jpeg", { quality: QUALITY });

    replacements.set(image.bufferView, Buffer.from(encoded));
    image.mimeType = mime;
    after += encoded.length;
  }

  const rebuilt = replaceImages(json, bin, replacements);
  writeGlb(file, json, rebuilt);
  return { before, after };
}

function runGltfTransform(src, dest) {
  execFileSync("npx", ["--yes", "@gltf-transform/cli@4", "optimize", src, dest,
    "--compress", "quantize",
    "--texture-compress", "false",
    "--simplify", "true",
    "--simplify-error", SIMPLIFY_ERROR
  ], { stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
}

const mb = (n) => (n / 1048576).toFixed(2) + " MB";

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Optimising models  (textures " + TEX_SIZE + "px q" + QUALITY +
    ", simplify error " + SIMPLIFY_ERROR + ")\n");

  let totalBefore = 0, totalAfter = 0;
  for (const model of MODELS) {
    const src = path.join(ROOT, model.src);
    if (!fs.existsSync(src)) { console.log("  skip (missing): " + model.src); continue; }
    const dest = path.join(OUT_DIR, model.out);
    const sizeBefore = fs.statSync(src).size;

    process.stdout.write("  " + model.out.padEnd(14) + mb(sizeBefore).padStart(9) + "  →  ");

    // Work on a copy so the source delivered by the artist is never modified.
    const staged = path.join(OUT_DIR, "_staging_" + model.out);
    fs.copyFileSync(src, staged);
    stripNormals(staged);
    runGltfTransform(staged, dest);
    fs.unlinkSync(staged);
    const tex = await optimiseTextures(dest);
    const sizeAfter = fs.statSync(dest).size;

    totalBefore += sizeBefore;
    totalAfter += sizeAfter;
    console.log(mb(sizeAfter).padStart(9) + "   (" +
      (sizeBefore / sizeAfter).toFixed(1) + "x smaller" +
      (tex.before ? ", texture " + mb(tex.before) + " → " + mb(tex.after) : "") + ")");
  }

  console.log("\n  TOTAL  " + mb(totalBefore) + "  →  " + mb(totalAfter) +
    "   (" + (totalBefore / totalAfter).toFixed(1) + "x smaller)");
}

main().catch((err) => { console.error(err); process.exit(1); });
