/**
 * Turn delivered scenery into small, game-ready .glb files.
 *
 * Props keep arriving in formats a browser cannot open, so the conversion is
 * done here rather than asked of the artist:
 *
 *   OBJ + TGA   the plant. Nothing on the web decodes TGA, and the three maps
 *               are uncompressed 2048x2048 - 36 MB for one prop. The opacity
 *               mask packed in the _g map's BLUE channel becomes the alpha
 *               channel, so leaf cut-outs render as leaves and not as
 *               rectangles. The normal map is dropped: a third texture for
 *               detail nobody sees on background scenery.
 *
 *   .blend      the bookshelf. Read directly (see blend.mjs) because there is
 *               no Blender on this machine to export with. Objects are baked
 *               into world space, Z-up is converted to Y-up, and the packed
 *               textures are lifted straight out of the file.
 *
 *   plain OBJ   the bus. No .mtl was delivered and it has no UVs, so it has
 *               no colour at all - flat colours come from height bands instead.
 *
 *   .glb        the fountain, already converted from FBX by fbx-to-glb.html.
 *               Only the triangle count is touched.
 *
 *   OBJ object  a named object out of a multi-object OBJ, cut down with
 *               meshoptimizer. Built for the tree pack (nine scanned species
 *               merged into one 33 MB file); no prop uses it at present.
 *
 * Every path ends in the same place: one GLB, one primitive per material, and
 * every texture resized and re-encoded for a phone.
 *
 * Usage:
 *   npm run build:props
 *   node tools/build-props.mjs --size 256          # even smaller
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  openBlend, worldMatrix, multiply, transform, determinant3, Z_UP_TO_Y_UP, OB_MESH
} from "./blend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROPS_DIR = path.join(ROOT, "spoken_game/props");
const OUT_DIR = path.join(PROPS_DIR, "optimized");

/**
 * `height` is the real-world height in metres each prop is normalised to, so
 * the GLB is unit-correct whatever the source file used.
 */
const PROPS = [
  {
    kind: "obj",
    name: "plant_1",
    dir: "eb_house_plant_01",
    obj: "eb_house_plant_01.obj",
    colour: "eb_house_plant_01_c.tga",
    mask: "eb_house_plant_01_g.tga",
    maskChannel: 2,          // BLUE, per the pack's READ_ME
    height: 1.0
  },
  {
    kind: "blend",
    name: "bookshelf",
    dir: "bookself",
    blend: "Book Shelf.blend",
    // The .blend is a product shot: the shelf stands on a big ground plane
    // under a studio light. Only the shelf itself is wanted.
    skip: /^Plane/,
    height: 1.95
  },
  {
    // 8.06 x 2.27 x 2.42 metres of bus, and no bus.mtl was delivered with it -
    // one material called "default", no UVs. Height bands stand in for the
    // missing colours.
    kind: "mesh",
    name: "bus",
    dir: "bus",
    obj: "bus.obj",
    height: 2.55,
    // A flat side-elevation render of this exact bus, projected onto the faces
    // that look sideways. `facing` is how square-on a face must be to count.
    texture: { file: "5_BUS_0004.jpg", facing: 0.55 },
    // The glazing IS modelled: the side windows are their own quads, in a
    // band from y 1.21 to 2.06 of the model's 2.27 - fractions 0.53 to 0.91.
    // The front door pane starts lower, at 0.44, so the band opens there.
    // Colours are sRGB, matching what this location already uses.
    paint: [
      { name: "tyres",   below: 0.20, rgb: [0.13, 0.14, 0.17] },
      { name: "roof",    above: 0.91, rgb: [0.89, 0.92, 0.95] },
      { name: "windows", above: 0.43, below: 0.915, rgb: [0.62, 0.83, 0.94] },
      { name: "body",    rgb: [0.18, 0.44, 0.77] }
    ]
  },
  {
    // The client's bus shelter. Its .blend is a street scene, so the road, the
    // pavement slabs and the kerb gutters are left behind - and so are four
    // `bracket_profile` objects that carry 13,424 of the file's 14,492
    // triangles between them: decorative curls, 0.10 units thick, tucked under
    // the bench where nothing can see them.
    //
    // Its materials are named but colourless (every one reads 0.80 grey and
    // none links to a texture), so `colours` supplies the palette by name.
    kind: "blend",
    name: "bus_stop",
    dir: "bus stop",
    blend: "bus_stop.blend",
    skip: /^(road|footpath|GUTTER|bracket_profile)/,
    height: 2.75,
    colours: {
      default: [0.55, 0.59, 0.63],
      steel: [0.35, 0.40, 0.44],
      slats: [0.64, 0.44, 0.24],
      concrete: [0.78, 0.78, 0.82],
      glass: [0.70, 0.87, 0.92, 0.22],
      glass_diamond: [0.78, 0.90, 0.94, 0.13],
      galss_balck: [0.22, 0.26, 0.30, 0.55],
      orange: [0.88, 0.40, 0.17],
      poster_outside: [0.87, 0.90, 0.94],
      poster_inside: [0.87, 0.90, 0.94],
      signage_outside_border: [0.18, 0.44, 0.77],
      ridges: [0.54, 0.57, 0.61]
    }
  },
  {
    // A low-poly hospital ward. Its .blend is a Cycles file, so every material
    // sits at Blender's untouched 0.80 grey and the real colour is inside a
    // shader node tree - blend.mjs reads it out (see nodeColour). The room
    // shell is skipped: this location already has its own floor and walls.
    kind: "blend",
    name: "hospital_ward",
    dir: "Isometric Hospital Room - graphyTV",
    blend: "graphyTV_LowPoly_Hospital_Room.blend",
    skip: /^Plane$/,
    height: 2.20
  },
  {
    // A first aid cabinet, converted from FBX by tools/fbx-to-glb.html, which
    // also picked its raised cross emblem out in red - the model arrives as a
    // single white material. 736 triangles, so nothing here needs cutting.
    kind: "glb",
    name: "hospital_cabinet",
    dir: "hospital_cabinet",
    glb: "hospital_cabinet_raw.glb"
  },
  {
    // A three seater. No .mtl, no UVs, one grey material - the two PNGs beside
    // it are preview renders, not textures - so colour comes from height bands
    // again. The parts separate cleanly because they do not share a level:
    // legs sit below the plinth, seat cushions occupy 0.16-0.25, back cushions
    // 0.23-0.59, and the arms and back panel span too much to fall in either.
    // sRGB, matching the teal the home already uses.
    kind: "mesh",
    name: "sofa",
    dir: "78-koltuksofa",
    obj: "Koltuk.obj",
    height: 0.95,
    paint: [
      { name: "legs",      below: 0.263, rgb: [0.23, 0.16, 0.11] },
      { name: "seat",      above: 0.428, below: 0.559, rgb: [0.36, 0.54, 0.49] },
      { name: "cushions",  above: 0.520, rgb: [0.42, 0.60, 0.55] },
      { name: "frame",     rgb: [0.31, 0.48, 0.44] }
    ]
  },
  {
    // Converted from fountain.fbx by tools/fbx-to-glb.html, which already
    // centred it, sat it on y = 0 and scaled it to 2.2 units. Nothing here
    // touches the geometry beyond cutting the triangle count: the fountain body
    // arrives as a 256x256 sculpted plane, 65,536 triangles on its own.
    kind: "glb",
    name: "fountain",
    dir: "fountain",
    glb: "fountain_raw.glb",
    simplify: 0.06
  }
];

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const TEX_SIZE = Number(arg("size", 512));
const QUALITY = Number(arg("quality", 82));
const CREASE = Math.cos((Number(arg("crease", 40)) * Math.PI) / 180);

/* ------------------------------------------------------------------- TGA */

/**
 * Minimal TGA reader: uncompressed (type 2) and RLE (type 10) true-colour,
 * 24 or 32 bit. That covers every map in the pack. Returns RGBA, top row first,
 * which is what PNG and glTF expect.
 */
function readTga(file) {
  const buf = fs.readFileSync(file);
  const idLength = buf[0];
  const imageType = buf[2];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const bpp = buf[16];
  const descriptor = buf[17];

  if (imageType !== 2 && imageType !== 10) {
    throw new Error(path.basename(file) + ": unsupported TGA image type " + imageType);
  }
  if (bpp !== 24 && bpp !== 32) {
    throw new Error(path.basename(file) + ": unsupported TGA depth " + bpp);
  }

  const bytes = bpp / 8;
  const pixels = width * height;
  const out = Buffer.alloc(pixels * 4);
  let src = 18 + idLength;
  let dst = 0;

  const put = (off) => {
    out[dst] = buf[off + 2];              // TGA stores BGR(A)
    out[dst + 1] = buf[off + 1];
    out[dst + 2] = buf[off];
    out[dst + 3] = bytes === 4 ? buf[off + 3] : 255;
    dst += 4;
  };

  if (imageType === 2) {
    for (let i = 0; i < pixels; i++, src += bytes) put(src);
  } else {
    while (dst < out.length) {
      const packet = buf[src++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {                       // run-length packet
        for (let i = 0; i < count; i++) put(src);
        src += bytes;
      } else {                                   // raw packet
        for (let i = 0; i < count; i++, src += bytes) put(src);
      }
    }
  }

  // Bit 5 of the descriptor sets the origin. When it is clear (the usual case)
  // the bottom row is stored first, so flip to get a top-down image.
  if (!(descriptor & 0x20)) {
    const row = width * 4;
    const flipped = Buffer.alloc(out.length);
    for (let y = 0; y < height; y++) {
      out.copy(flipped, (height - 1 - y) * row, y * row, y * row + row);
    }
    return { width, height, data: flipped };
  }
  return { width, height, data: out };
}

/* ------------------------------------------------------------------- OBJ */

/**
 * Parse an OBJ into indexed triangle meshes, one per `o`/`g` object.
 *
 * OBJ indexes position, uv and normal separately; glTF has one index per
 * vertex, so each distinct v/vt/vn triple becomes one vertex. Faces may be
 * quads or larger, and are fanned into triangles.
 *
 * The file is streamed a line at a time: the tree pack's OBJ is 33 MB of text
 * and reading it whole just to split it wastes a lot of memory for nothing.
 *
 * @param {RegExp|null} only  keep just the objects whose name matches
 * @returns {Promise<Map<string, {position,uv,normal,index,material}>>}
 */
async function readObj(file, only = null) {
  const readline = await import("node:readline");
  const positions = [], uvs = [], normals = [];
  const objects = new Map();

  let current = null;
  const open = (name) => {
    if (objects.has(name)) { current = objects.get(name); return; }
    current = { name, pos: [], uv: [], nor: [], index: [], seen: new Map(), material: null };
    objects.set(name, current);
  };

  const vertex = (token) => {
    if (current.seen.has(token)) return current.seen.get(token);
    const [vi, ti, ni] = token.split("/");
    const p = (Number(vi) - 1) * 3;
    current.pos.push(positions[p], positions[p + 1], positions[p + 2]);

    if (ti) {
      const t = (Number(ti) - 1) * 2;
      // OBJ's V axis points up from the bottom-left; glTF's points down from
      // the top-left.
      current.uv.push(uvs[t], 1 - uvs[t + 1]);
    } else {
      current.uv.push(0, 0);
    }

    if (ni) {
      const n = (Number(ni) - 1) * 3;
      current.nor.push(normals[n], normals[n + 1], normals[n + 2]);
    } else {
      current.nor.push(0, 1, 0);
    }

    const index = current.pos.length / 3 - 1;
    current.seen.set(token, index);
    return index;
  };

  const input = fs.createReadStream(file);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const space = line.indexOf(" ");
    const tag = space === -1 ? line : line.slice(0, space);
    const rest = space === -1 ? "" : line.slice(space + 1);

    switch (tag) {
      case "v":  { const p = rest.split(/\s+/); positions.push(+p[0], +p[1], +p[2]); break; }
      case "vt": { const p = rest.split(/\s+/); uvs.push(+p[0], +p[1]); break; }
      case "vn": { const p = rest.split(/\s+/); normals.push(+p[0], +p[1], +p[2]); break; }
      case "o":
      case "g":
        open(rest);
        break;
      case "usemtl":
        if (!current) open("default");
        if (!current.material) current.material = rest;
        break;
      case "f": {
        if (!current) open("default");
        if (only && !only.test(current.name)) break;
        const corners = rest.split(/\s+/).map(vertex);
        for (let i = 1; i < corners.length - 1; i++) {
          current.index.push(corners[0], corners[i], corners[i + 1]);
        }
        break;
      }
      default: break;
    }
  }

  const out = new Map();
  for (const [name, o] of objects) {
    if (!o.index.length) continue;
    if (only && !only.test(name)) continue;
    out.set(name, {
      position: new Float32Array(o.pos),
      uv: new Float32Array(o.uv),
      normal: new Float32Array(o.nor),
      index: new Uint32Array(o.index),
      material: o.material
    });
  }
  return out;
}

/**
 * Split a tree into its textured trunk and its foliage.
 *
 * Two problems solve each other here. meshoptimizer can only collapse an edge
 * whose endpoints are genuinely shared, and every leaf sheet is its own UV
 * island, so simplification stalled at 8,200 triangles instead of the 2,000
 * asked for. Welding on position alone unblocked it - and wrecked the texture:
 * canopies rendered brown-grey even though the maps are 34-50% green, because
 * leaf vertices had been merged onto trunk UVs.
 *
 * So the canopy gives up its texture instead. Its triangles are averaged into
 * ONE flat colour, sampled through the real UVs before they are discarded, so
 * each tree keeps its own character - green for the green ones, tan for the
 * autumn one. With no UVs left to preserve, the canopy welds and collapses
 * freely, and flat-shaded foliage is what the rest of this world looks like
 * anyway. The trunk keeps its texture and its UVs.
 *
 * @param {number} canopyFrom  fraction of the height above which geometry is foliage
 */
function splitCanopy(mesh, canopyFrom, texture) {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < mesh.position.length; i += 3) {
    if (mesh.position[i] < minY) minY = mesh.position[i];
    if (mesh.position[i] > maxY) maxY = mesh.position[i];
  }
  const cut = minY + (maxY - minY) * canopyFrom;

  const trunk = [], canopy = [];
  let r = 0, g = 0, b = 0, samples = 0;

  for (let t = 0; t < mesh.index.length; t += 3) {
    const a = mesh.index[t], c = mesh.index[t + 1], d = mesh.index[t + 2];
    const y = (mesh.position[a * 3 + 1] + mesh.position[c * 3 + 1] + mesh.position[d * 3 + 1]) / 3;
    if (y < cut) { trunk.push(a, c, d); continue; }
    canopy.push(a, c, d);

    if (texture) {
      const u = (mesh.uv[a * 2] + mesh.uv[c * 2] + mesh.uv[d * 2]) / 3;
      const v = (mesh.uv[a * 2 + 1] + mesh.uv[c * 2 + 1] + mesh.uv[d * 2 + 1]) / 3;
      const px = texture.at(u, v);
      if (px) { r += px[0]; g += px[1]; b += px[2]; samples++; }
    }
  }

  const colour = samples
    ? gradeCanopy([r / samples / 255, g / samples / 255, b / samples / 255])
    : [0.24, 0.44, 0.24];

  return {
    trunk: trunk.length ? subset(mesh, trunk, true) : null,
    canopy: canopy.length ? weldPositions(subset(mesh, canopy, false)) : null,
    colour,
    canopyShare: canopy.length / (canopy.length + trunk.length)
  };
}

/**
 * Push an averaged photo colour back towards foliage.
 *
 * Averaging a leaf photo mixes lit highlights with shadowed undersides and
 * lands close to grey: this pack's greenest canopy averaged rgb 141,163,111,
 * only 22 points greener than it is red. Rendered flat under this world's
 * lights (hemisphere 2.3 + sun 1.8 + fill 0.7) that reads as pale sage stone,
 * next to grass at #5fb85f and painted trees at #3a9d5d.
 *
 * Saturation is restored around the sample's own luminance and the level
 * dropped for the strong lighting, so each tree keeps its own hue - the green
 * ones green, the autumn one amber - without being hand-picked.
 */
function gradeCanopy(rgb) {
  const SATURATION = 2.4;
  const LEVEL = 0.62;
  const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return rgb.map((c) => Math.min(1, Math.max(0, (luma + (c - luma) * SATURATION) * LEVEL)));
}

/** Pull a triangle list out of a mesh as a standalone mesh, dropping unused vertices. */
function subset(mesh, indices, keepUv) {
  const map = new Map();
  const position = [], uv = [], out = [];
  for (const i of indices) {
    let n = map.get(i);
    if (n === undefined) {
      position.push(mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]);
      if (keepUv) uv.push(mesh.uv[i * 2], mesh.uv[i * 2 + 1]);
      n = position.length / 3 - 1;
      map.set(i, n);
    }
    out.push(n);
  }
  return {
    position: new Float32Array(position),
    uv: keepUv ? new Float32Array(uv) : null,
    index: new Uint32Array(out)
  };
}

/**
 * Re-index a mesh so vertices sharing a position become one vertex. Only safe
 * once the mesh has no UVs left to keep aligned - see splitCanopy.
 */
function weldPositions(mesh, precision = 4) {
  const map = new Map();
  const position = [], remap = new Int32Array(mesh.position.length / 3);

  for (let i = 0; i < remap.length; i++) {
    const x = mesh.position[i * 3], y = mesh.position[i * 3 + 1], z = mesh.position[i * 3 + 2];
    const key = x.toFixed(precision) + "," + y.toFixed(precision) + "," + z.toFixed(precision);
    let index = map.get(key);
    if (index === undefined) {
      position.push(x, y, z);
      index = position.length / 3 - 1;
      map.set(key, index);
    }
    remap[i] = index;
  }

  const index = [];
  for (let t = 0; t < mesh.index.length; t += 3) {
    const a = remap[mesh.index[t]], b = remap[mesh.index[t + 1]], c = remap[mesh.index[t + 2]];
    if (a !== b && b !== c && a !== c) index.push(a, b, c);   // drop degenerate triangles
  }

  return {
    position: new Float32Array(position),
    uv: null,
    index: new Uint32Array(index)
  };
}

/** Concatenate objects into one mesh - used when a prop is the whole file. */
function merge(parts) {
  if (parts.length === 1) return parts[0];
  const position = [], uv = [], normal = [], index = [];
  let base = 0;
  for (const p of parts) {
    position.push(...p.position);
    uv.push(...p.uv);
    normal.push(...p.normal);
    for (const i of p.index) index.push(i + base);
    base += p.position.length / 3;
  }
  return {
    position: new Float32Array(position),
    uv: new Float32Array(uv),
    normal: new Float32Array(normal),
    index: new Uint32Array(index),
    material: parts[0].material
  };
}

/** newmtl name -> the file its map_Kd points at. */
function readMtl(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  let name = null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) name = line.slice(7).trim();
    else if (line.startsWith("map_Kd ") && name) {
      // MTL paths are written with Windows separators even on other platforms.
      out.set(name, line.slice(7).trim().replace(/\\+/g, "/"));
    }
  }
  return out;
}

/* ----------------------------------------------------------------- .blend */

/**
 * Flatten every mesh object in a .blend into one primitive per material.
 *
 * Each object is baked into world space - Blender's parent/child transforms
 * and object scales are applied here, because glTF consumers should not have
 * to reproduce Blender's `parent * parent_inverse * basis` rule.
 */
function readBlend(file, prop) {
  const blend = openBlend(file);
  const objects = blend.objects();
  const byAddress = new Map(objects.map((o) => [o.address, o]));

  const groups = new Map();          // material address (or "none") -> arrays
  const materials = new Map();

  const groupFor = (address) => {
    const key = address ? String(address) : "none";
    if (!groups.has(key)) groups.set(key, { position: [], uv: [], index: [], seen: new Map() });
    if (address && !materials.has(key)) materials.set(key, blend.materialAt(address));
    return groups.get(key);
  };

  let skipped = 0;
  for (const object of objects) {
    if (object.type !== OB_MESH || !object.dataAddress) continue;
    if (prop.skip && prop.skip.test(object.name)) { skipped++; continue; }

    const mesh = blend.geometry(object.dataAddress);
    if (!mesh || !mesh.polys.length) continue;

    const world = multiply(Z_UP_TO_Y_UP, worldMatrix(object, byAddress));
    // A negative scale mirrors the object, which reverses its triangle winding.
    // Left uncorrected the faces end up inside out and the prop looks hollow.
    const mirrored = determinant3(world) < 0;

    const slots = blend.meshMaterials(object.dataAddress);
    const points = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const p = transform(world, mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
      // Interior scenes are modelled with slack outside the room: walls run from
      // -1 to 4 either side of a 0-to-3 room, a door frame dips below the floor,
      // a sofa base sits under it. Left alone that slack decides the prop's
      // height and lifts everything off the ground. Clamping squashes it back
      // to the room instead of dropping whole objects, so no wall gets a hole.
      if (prop.clampY) {
        p[1] = Math.min(prop.clampY[1], Math.max(prop.clampY[0], p[1]));
      }
      points.push(p);
    }

    mesh.polys.forEach((loopIndices, polyIndex) => {
      const material = slots[mesh.matIndex[polyIndex]] || (object.materials || [])[mesh.matIndex[polyIndex]];
      const group = groupFor(material);

      const corner = (loop) => {
        const vertex = mesh.loops[loop];
        const uv = mesh.uvs ? mesh.uvs[loop] : [0, 0];
        const p = points[vertex];
        if (!p) return null;
        // glTF's V axis points down from the top-left, Blender's points up.
        const key = p[0].toFixed(5) + "," + p[1].toFixed(5) + "," + p[2].toFixed(5) +
                    "," + uv[0].toFixed(5) + "," + uv[1].toFixed(5);
        if (group.seen.has(key)) return group.seen.get(key);
        group.position.push(p[0], p[1], p[2]);
        group.uv.push(uv[0], 1 - uv[1]);
        const index = group.position.length / 3 - 1;
        group.seen.set(key, index);
        return index;
      };

      const corners = loopIndices.map(corner).filter((c) => c !== null);
      for (let i = 1; i < corners.length - 1; i++) {
        if (mirrored) group.index.push(corners[0], corners[i + 1], corners[i]);
        else group.index.push(corners[0], corners[i], corners[i + 1]);
      }
    });
  }

  const primitives = [];
  for (const [key, group] of groups) {
    if (!group.index.length) continue;
    const position = new Float32Array(group.position);
    const index = new Uint32Array(group.index);
    primitives.push({
      position,
      uv: new Float32Array(group.uv),
      normal: creasedNormals(position, index),
      index,
      material: materials.get(key) || null
    });
  }

  return { primitives, blend, skipped };
}

/**
 * Vertex normals with a crease angle.
 *
 * Fully smooth normals round off the shelf's square corners; fully flat ones
 * facet the curved book spines. So normals are averaged per position, and a
 * corner falls back to its own face normal when the two disagree by more than
 * the crease angle - sharp edges stay sharp, smooth surfaces stay smooth.
 */
function creasedNormals(position, index) {
  const faceNormals = new Float32Array(index.length);   // 3 per triangle
  const smooth = new Map();                             // position key -> [x,y,z]
  const key = (i) => position[i * 3].toFixed(4) + "," +
                     position[i * 3 + 1].toFixed(4) + "," +
                     position[i * 3 + 2].toFixed(4);

  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2];
    const ux = position[b * 3] - ax, uy = position[b * 3 + 1] - ay, uz = position[b * 3 + 2] - az;
    const vx = position[c * 3] - ax, vy = position[c * 3 + 1] - ay, vz = position[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    faceNormals[t] = nx; faceNormals[t + 1] = ny; faceNormals[t + 2] = nz;

    for (const corner of [a, b, c]) {
      const k = key(corner);
      const acc = smooth.get(k) || [0, 0, 0];
      acc[0] += nx; acc[1] += ny; acc[2] += nz;
      smooth.set(k, acc);
    }
  }

  const normals = new Float32Array(position.length);
  for (let t = 0; t < index.length; t += 3) {
    const nx = faceNormals[t], ny = faceNormals[t + 1], nz = faceNormals[t + 2];
    for (let c = 0; c < 3; c++) {
      const corner = index[t + c];
      const acc = smooth.get(key(corner)) || [nx, ny, nz];
      const len = Math.hypot(acc[0], acc[1], acc[2]) || 1;
      const sx = acc[0] / len, sy = acc[1] / len, sz = acc[2] / len;
      const agrees = sx * nx + sy * ny + sz * nz >= CREASE;
      normals[corner * 3] = agrees ? sx : nx;
      normals[corner * 3 + 1] = agrees ? sy : ny;
      normals[corner * 3 + 2] = agrees ? sz : nz;
    }
  }
  return normals;
}

/* ---------------------------------------------------------------- shaping */

/** Centre on X/Z, base at y = 0, scaled to `height` metres. Applied to every primitive. */
function normalise(primitives, height) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of primitives) {
    for (let i = 0; i < p.position.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        if (p.position[i + a] < min[a]) min[a] = p.position[i + a];
        if (p.position[i + a] > max[a]) max[a] = p.position[i + a];
      }
    }
  }
  const sourceHeight = max[1] - min[1];
  const scale = sourceHeight > 0 ? height / sourceHeight : 1;
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;

  for (const p of primitives) {
    for (let i = 0; i < p.position.length; i += 3) {
      p.position[i] = (p.position[i] - cx) * scale;
      p.position[i + 1] = (p.position[i + 1] - min[1]) * scale;
      p.position[i + 2] = (p.position[i + 2] - cz) * scale;
    }
  }

  return {
    sourceHeight,
    size: [(max[0] - min[0]) * scale, height, (max[2] - min[2]) * scale]
  };
}

/* --------------------------------------------------------------- textures */

async function encodeImage(rgba, width, height, wantAlpha) {
  const { Jimp, JimpMime } = await import("jimp");
  const img = Jimp.fromBitmap({ data: rgba, width, height });
  if (img.bitmap.width > TEX_SIZE) img.resize({ w: TEX_SIZE });

  // A cut-out mask has to stay in the alpha channel, so it forces PNG. Without
  // one, JPEG is several times smaller for the same picture.
  const buffer = wantAlpha
    ? await img.getBuffer(JimpMime.png)
    : await img.getBuffer(JimpMime.jpeg, { quality: QUALITY });

  return {
    buffer: Buffer.from(buffer),
    mime: wantAlpha ? JimpMime.png : JimpMime.jpeg,
    size: img.bitmap.width + "x" + img.bitmap.height
  };
}

/** Re-encode an already-compressed image (a texture packed inside a .blend). */
async function recodeImage(bytes) {
  const { Jimp, JimpMime } = await import("jimp");
  const img = await Jimp.fromBuffer(Buffer.from(bytes));
  if (img.bitmap.width > TEX_SIZE) img.resize({ w: TEX_SIZE });
  const buffer = Buffer.from(await img.getBuffer(JimpMime.jpeg, { quality: QUALITY }));
  return { buffer, mime: JimpMime.jpeg, size: img.bitmap.width + "x" + img.bitmap.height };
}

/* ------------------------------------------------------------------- GLB */

const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const pad4 = (n) => (n + 3) & ~3;

function bounds(array, stride) {
  const min = new Array(stride).fill(Infinity);
  const max = new Array(stride).fill(-Infinity);
  for (let i = 0; i < array.length; i += stride) {
    for (let a = 0; a < stride; a++) {
      if (array[i + a] < min[a]) min[a] = array[i + a];
      if (array[i + a] > max[a]) max[a] = array[i + a];
    }
  }
  return { min, max };
}

/**
 * @param {{ primitives: Array, images: Array }} model
 *   each primitive: { position, normal, uv, index, materialIndex }
 *   each material:  { name, imageIndex, rgb, alphaMode }
 */
function writeGlb(file, model, name) {
  const parts = [];
  const views = [];
  let cursor = 0;

  const addView = (data, target) => {
    const padding = pad4(cursor) - cursor;
    if (padding) { parts.push(Buffer.alloc(padding, 0)); cursor += padding; }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const view = { buffer: 0, byteOffset: cursor, byteLength: buf.length };
    if (target) view.target = target;
    views.push(view);
    parts.push(buf);
    cursor += buf.length;
    return views.length - 1;
  };

  const accessors = [];
  const primitives = [];

  for (const p of model.primitives) {
    const pb = bounds(p.position, 3);
    const big = p.position.length / 3 > 65535;
    const indices = big ? p.index : Uint16Array.from(p.index);

    const attributes = {};
    attributes.POSITION = accessors.length;
    accessors.push({ bufferView: addView(p.position, 34962), componentType: 5126, count: p.position.length / 3, type: "VEC3", min: pb.min, max: pb.max });

    // A prop that is about to be simplified ships without normals - they stop
    // meshoptimizer from welding, and ModelLibrary rebuilds them on load.
    if (p.normal) {
      attributes.NORMAL = accessors.length;
      accessors.push({ bufferView: addView(p.normal, 34962), componentType: 5126, count: p.normal.length / 3, type: "VEC3" });
    }
    // A flat-coloured primitive has no UVs to carry.
    if (p.uv) {
      attributes.TEXCOORD_0 = accessors.length;
      accessors.push({ bufferView: addView(p.uv, 34962), componentType: 5126, count: p.uv.length / 2, type: "VEC2" });
    }

    const indicesAccessor = accessors.length;
    accessors.push({ bufferView: addView(indices, 34963), componentType: big ? 5125 : 5123, count: indices.length, type: "SCALAR" });

    const primitive = { attributes, indices: indicesAccessor };
    if (p.materialIndex != null) primitive.material = p.materialIndex;
    primitives.push(primitive);
  }

  const images = model.images.map((image) => ({ bufferView: addView(image.buffer), mimeType: image.mime }));

  const materials = model.materials.map((m) => {
    const pbr = { metallicFactor: 0, roughnessFactor: 1 };
    if (m.imageIndex != null) pbr.baseColorTexture = { index: m.imageIndex };
    // A 4th component in a palette colour is opacity. The bus shelter's panes
    // are glass: left solid, the stop reads as a grey box and hides whatever is
    // standing behind it, camera included.
    // glTF's baseColorFactor is LINEAR, but every colour written here was picked
    // in sRGB - a hex value, or a pixel sampled out of a texture. Passed through
    // unconverted they all render washed out: #22252b came back as #656973.
    else if (m.rgb) {
      pbr.baseColorFactor = [...m.rgb.slice(0, 3).map(srgbToLinear), m.rgb.length > 3 ? m.rgb[3] : 1];
    }
    const out = { name: m.name, doubleSided: !!m.doubleSided, pbrMetallicRoughness: pbr };
    if (m.alphaMode) { out.alphaMode = m.alphaMode; out.alphaCutoff = 0.5; }
    else if (m.rgb && m.rgb.length > 3 && m.rgb[3] < 1) out.alphaMode = "BLEND";
    return out;
  });

  const json = {
    asset: { version: "2.0", generator: "spoken_game tools/build-props.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: cursor }]
  };
  if (materials.length) json.materials = materials;
  if (images.length) {
    json.images = images;
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    json.textures = images.map((_, i) => ({ source: i, sampler: 0 }));
  }

  const bin = Buffer.concat(parts);
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20);
  const binPad = Buffer.alloc(pad4(bin.length) - bin.length, 0);

  const jsonLen = jsonBuf.length + jsonPad.length;
  const binLen = bin.length + binPad.length;

  const head = Buffer.alloc(12);
  head.write("glTF", 0, "ascii");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonLen + 8 + binLen, 8);

  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonLen, 0);
  jsonHead.write("JSON", 4, "ascii");

  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binLen, 0);
  binHead.write("BIN\0", 4, "ascii");

  fs.writeFileSync(file, Buffer.concat([head, jsonHead, jsonBuf, jsonPad, binHead, bin, binPad]));
}

/* ------------------------------------------------------------------ build */

/**
 * One object out of a multi-object OBJ, with the texture its material names.
 *
 * The tree pack is nine trees merged into one 33 MB file, one object per
 * species, so each is pulled out separately and placed on its own.
 */
async function buildObjObjectProp(prop, dir) {
  const objects = await readObj(path.join(dir, prop.obj), new RegExp("^" + prop.object + "$"));
  let mesh = objects.get(prop.object);
  if (!mesh) {
    throw new Error(prop.obj + " has no object named '" + prop.object + "'" +
      " (found: " + [...objects.keys()].join(", ") + ")");
  }
  const maps = readMtl(path.join(dir, prop.mtl));
  const textureFile = maps.get(mesh.material);
  const full = textureFile ? path.join(dir, textureFile) : null;
  const notes = [];

  // Read the map once for colour sampling, and again (resized) for the GLB.
  let sampler = null, encoded = null;
  if (full && fs.existsSync(full)) {
    const { Jimp } = await import("jimp");
    const img = await Jimp.read(full);
    const { data, width, height } = img.bitmap;
    sampler = {
      at(u, v) {
        const x = Math.min(width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * width)));
        const y = Math.min(height - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * height)));
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      }
    };
    encoded = await recodeImage(fs.readFileSync(full));
    notes.push("texture   : " + path.basename(textureFile) + "  →  " +
      encoded.size + ", " + kb(encoded.buffer.length) + "  (trunk only)");
  }

  const split = splitCanopy(mesh, prop.canopyFrom != null ? prop.canopyFrom : 0.4, sampler);
  const primitives = [];
  const images = [];
  const materials = [];

  if (split.trunk && encoded) {
    images.push(encoded);
    primitives.push({ ...split.trunk, materialIndex: materials.length });
    materials.push({ name: prop.name + "_bark", imageIndex: 0, rgb: [1, 1, 1], doubleSided: true });
  } else if (split.trunk) {
    primitives.push({ ...split.trunk, uv: null, materialIndex: materials.length });
    materials.push({ name: prop.name + "_bark", imageIndex: null, rgb: [0.42, 0.32, 0.22], doubleSided: true });
  }

  if (split.canopy) {
    primitives.push({ ...split.canopy, materialIndex: materials.length });
    materials.push({ name: prop.name + "_leaves", imageIndex: null, rgb: split.colour, doubleSided: true });
    notes.push("canopy    : " + Math.round(split.canopyShare * 100) + "% of the triangles, flattened to rgb " +
      split.colour.map((v) => Math.round(v * 255)).join(",") + " sampled through its own UVs");
  }

  // Normals are deliberately omitted: they stop the simplifier from welding
  // vertices, and ModelLibrary rebuilds them on load anyway.
  return { primitives, images, materials, notes };
}

/**
 * A plain untextured OBJ, painted with flat colours by height band.
 *
 * The bus arrives with no UVs and a `bus.mtl` that was never delivered, so it
 * has no colour information at all - one material named "default". Rather than
 * render the whole vehicle in a single tone, triangles are split into bands of
 * the model's own height, which is enough to separate tyres from bodywork and
 * glazing. Flat colour is the right answer here anyway: everything else in
 * these locations is painted the same way.
 */
/**
 * Trim a render down to its subject.
 *
 * The bus's texture is a studio render on a flat dark backdrop, with a soft
 * reflection under it. Everything outside the vehicle has to go before the
 * image can be stretched across the model, or the bus would be projected at the
 * wrong scale with a band of grey around it.
 */
function autoCrop(img) {
  const { data, width, height } = img.bitmap;
  const at = (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const bg = at(0, 0);

  // A faint threshold also catches the mirror reflection under the vehicle,
  // which stretched the crop from a 3.4 aspect to 2.7 and squashed the bus into
  // the top of the texture. The subject is high contrast and the reflection is
  // not, so the test is both STRONG difference and enough of it in a row.
  const strong = (p) =>
    Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 110;

  const rows = new Array(height).fill(0);
  const cols = new Array(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!strong(at(x, y))) continue;
      rows[y]++;
      cols[x]++;
    }
  }

  const span = (counts, need) => {
    let lo = -1, hi = -1;
    counts.forEach((n, i) => { if (n >= need) { if (lo === -1) lo = i; hi = i; } });
    return [lo, hi];
  };
  const [y0, y1] = span(rows, Math.max(3, width * 0.01));
  const [x0, x1] = span(cols, Math.max(3, height * 0.01));

  if (x1 < x0 || y1 < y0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Face normal of one triangle. */
function faceNormal(position, a, b, c) {
  const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2];
  const ux = position[b * 3] - ax, uy = position[b * 3 + 1] - ay, uz = position[b * 3 + 2] - az;
  const vx = position[c * 3] - ax, vy = position[c * 3 + 1] - ay, vz = position[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

async function buildMeshProp(prop, dir) {
  const objects = await readObj(path.join(dir, prop.obj),
    prop.object ? new RegExp("^" + prop.object + "$") : null);
  const mesh = merge([...objects.values()]);

  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < mesh.position.length; i += 3) {
    if (mesh.position[i] < minY) minY = mesh.position[i];
    if (mesh.position[i] > maxY) maxY = mesh.position[i];
  }
  const span = maxY - minY;
  const bands = prop.paint || [{ name: "body", rgb: [0.7, 0.7, 0.7] }];

  // Faces that look sideways get the side-elevation render projected straight
  // onto them: the bus has no UVs at all, so there is nothing else to map with.
  // The roof, the ends and the wheel arches keep flat colours - a side view
  // smeared across the roof would look far worse than one clean tone, and the
  // roof is most of what this camera sees.
  const sideTris = [];
  let image = null;
  if (prop.texture) {
    const { Jimp, JimpMime } = await import("jimp");
    const img = await Jimp.read(path.join(dir, prop.texture.file));
    const crop = autoCrop(img);
    if (crop) img.crop(crop);
    if (img.bitmap.width > TEX_SIZE * 2) img.resize({ w: TEX_SIZE * 2 });
    image = {
      buffer: Buffer.from(await img.getBuffer(JimpMime.jpeg, { quality: QUALITY })),
      mime: JimpMime.jpeg,
      size: img.bitmap.width + "x" + img.bitmap.height,
      crop
    };
  }

  const groups = bands.map(() => []);
  for (let t = 0; t < mesh.index.length; t += 3) {
    const a = mesh.index[t], b = mesh.index[t + 1], c = mesh.index[t + 2];
    const ya = mesh.position[a * 3 + 1], yb = mesh.position[b * 3 + 1], yc = mesh.position[c * 3 + 1];

    // A triangle joins a band only if ALL of it fits inside. Testing the
    // centroid instead put a sawtooth along the roof line: the bus sides are
    // long triangles that straddle the boundary, and each one flipped colour
    // depending on where its middle happened to land. Anything spanning a
    // boundary falls through to the catch-all, so the seam follows the model's
    // own edge loops.
    const lo = span > 0 ? (Math.min(ya, yb, yc) - minY) / span : 0;
    const hi = span > 0 ? (Math.max(ya, yb, yc) - minY) / span : 0;

    let pick = bands.length - 1;                 // the last band is the catch-all
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      if (band.below == null && band.above == null) continue;
      if (band.below != null && hi > band.below) continue;
      if (band.above != null && lo < band.above) continue;
      pick = i;
      break;
    }
    if (image) {
      const n = faceNormal(mesh.position, a, b, c);
      if (Math.abs(n[2]) > (prop.texture.facing || 0.5)) { sideTris.push(a, b, c); continue; }
    }
    groups[pick].push(a, b, c);
  }

  const primitives = [];
  const materials = [];
  const notes = [];
  const images = [];

  if (image && sideTris.length) {
    const part = subset(mesh, sideTris, false);
    // Planar projection: the model's own x/y bounds map onto the cropped image.
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < part.position.length; i += 3) {
      if (part.position[i] < x0) x0 = part.position[i];
      if (part.position[i] > x1) x1 = part.position[i];
    }
    const uv = new Float32Array((part.position.length / 3) * 2);
    for (let i = 0, v = 0; i < part.position.length; i += 3, v += 2) {
      uv[v] = (part.position[i] - x0) / (x1 - x0 || 1);
      uv[v + 1] = 1 - (part.position[i + 1] - minY) / (span || 1);
    }
    part.uv = uv;
    images.push(image);
    primitives.push({ ...part, materialIndex: materials.length });
    materials.push({ name: prop.name + "_side", imageIndex: 0, rgb: [1, 1, 1], doubleSided: false });
    const modelAspect = (x1 - x0) / (span || 1);
    const cropAspect = image.crop ? image.crop.w / image.crop.h : 0;
    notes.push("texture   : " + prop.texture.file + " cropped to " +
      (image.crop ? image.crop.w + "x" + image.crop.h : "full") + "  →  " +
      image.size + ", " + kb(image.buffer.length));
    notes.push("  aspect   model side " + modelAspect.toFixed(2) +
      "  vs  cropped image " + cropAspect.toFixed(2) +
      (Math.abs(modelAspect - cropAspect) < 0.25 ? "   (aligned)" : "   (MISMATCH)"));
    notes.push("  sides    " + String(Math.round(sideTris.length / 3)).padStart(5) + " tris  planar-projected");
  }

  bands.forEach((band, i) => {
    if (!groups[i].length) return;
    const part = subset(mesh, groups[i], false);
    primitives.push({ ...part, normal: null, materialIndex: materials.length });
    materials.push({ name: prop.name + "_" + band.name, imageIndex: null, rgb: band.rgb, doubleSided: false });
    notes.push("  " + band.name.padEnd(10) + String(Math.round(groups[i].length / 3)).padStart(5) +
      " tris  rgb " + band.rgb.map((v) => Math.round(v * 255)).join(","));
  });

  notes.unshift("painted   : no .mtl was delivered, so colour comes from height bands");
  return { primitives, images, materials, notes };
}

async function buildObjProp(prop, dir) {
  const objects = await readObj(path.join(dir, prop.obj));
  const mesh = merge([...objects.values()]);

  const colour = readTga(path.join(dir, prop.colour));
  let usesAlpha = false;
  if (prop.mask) {
    const mask = readTga(path.join(dir, prop.mask));
    if (mask.width !== colour.width || mask.height !== colour.height) {
      throw new Error("colour and mask maps are different sizes");
    }
    for (let i = 0; i < colour.data.length; i += 4) {
      const a = mask.data[i + prop.maskChannel];
      colour.data[i + 3] = a;
      if (a < 250) usesAlpha = true;
    }
  }

  const image = await encodeImage(colour.data, colour.width, colour.height, usesAlpha);
  const primitives = [{ ...mesh, materialIndex: 0 }];

  return {
    primitives,
    images: [image],
    materials: [{
      name: prop.name + "_mat",
      imageIndex: 0,
      doubleSided: true,                       // leaf cards are single-sided planes
      alphaMode: usesAlpha ? "MASK" : null
    }],
    notes: [
      "texture   : " + colour.width + "x" + colour.height + " TGA  →  " + image.size + " " +
        image.mime.split("/")[1] + ", " + kb(image.buffer.length) +
        (usesAlpha ? "  (alpha cut-out kept)" : "  (opaque)")
    ]
  };
}

async function buildBlendProp(prop, dir) {
  const { primitives, blend, skipped } = readBlend(path.join(dir, prop.blend), prop);

  const images = [];
  const materials = [];
  const byImageAddress = new Map();
  const notes = [];
  const painted = [];

  for (const p of primitives) {
    const source = p.material;
    if (!source) {
      // No material at all renders pure white in glTF, which is how the
      // shelter's roof and supports first came out. Fall back to the palette.
      const fallback = prop.colours && prop.colours.default;
      if (!fallback) { p.materialIndex = null; continue; }
      p.materialIndex = materials.length;
      materials.push({ name: prop.name + "_default", imageIndex: null, rgb: fallback, doubleSided: false });
      delete p.material;
      continue;
    }

    let imageIndex = null;
    if (source.imageAddress) {
      const key = String(source.imageAddress);
      if (byImageAddress.has(key)) {
        imageIndex = byImageAddress.get(key);
      } else {
        const image = blend.imageAt(source.imageAddress);
        if (image && image.bytes) {
          const encoded = await recodeImage(image.bytes);
          imageIndex = images.length;
          images.push(encoded);
          byImageAddress.set(key, imageIndex);
          notes.push("texture   : " + decodeURIComponent(image.name).replace(/\.[a-z]+$/i, "").slice(0, 34) +
            "  →  " + encoded.size + ", " + kb(encoded.buffer.length));
        }
      }
    }

    // A material can carry a name and no usable colour - the shelter's twelve
    // all read as the 0.80 grey default and none links to a texture. `colours`
    // lets the prop supply the palette by material name.
    // An unnamed or unlisted material falls back to `default`: every material
    // in this file reads the same meaningless 0.80 grey, so its own rgb is
    // never worth keeping.
    const named = prop.colours && (prop.colours[source.name.trim()] || prop.colours.default);
    if (named) painted.push(source.name.trim());

    p.materialIndex = materials.length;
    materials.push({ name: source.name, imageIndex, rgb: named || source.rgb, doubleSided: false });
    delete p.material;
  }

  if (painted.length) notes.push("palette   : " + painted.length + " material(s) coloured by name - " + painted.join(", "));
  notes.unshift("objects   : " + primitives.length + " material group(s)" +
    (skipped ? ", " + skipped + " studio object(s) skipped" : ""));
  return { primitives, images, materials, notes };
}

/**
 * Cut a model down to `ratio` of its vertices with meshoptimizer.
 *
 * A photo-scanned tree arrives at 40,000-95,000 triangles. On screen it is a
 * few hundred pixels of background scenery next to characters made of a few
 * thousand triangles, so almost all of that detail is paid for and never seen.
 * Returns the triangle count before and after.
 */
function simplifyGlb(file, ratio) {
  const before = countTriangles(file);
  const staged = file.replace(/\.glb$/, "_full.glb");
  fs.renameSync(file, staged);
  try {
    execFileSync("npx", ["--yes", "@gltf-transform/cli@4", "optimize", staged, file,
      "--compress", "quantize",
      "--texture-compress", "false",
      "--weld", "true",
      "--simplify", "true",
      "--simplify-ratio", String(ratio),
      "--simplify-lock-border", "false",
      "--simplify-error", "1"
    ], { stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }
  return { before, after: countTriangles(file) };
}

function countTriangles(file) {
  const buf = fs.readFileSync(file);
  let off = 12, json = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    if (buf.toString("ascii", off + 4, off + 8) === "JSON") {
      json = JSON.parse(buf.toString("utf8", off + 8, off + 8 + len));
      break;
    }
    off += 8 + len;
  }
  if (!json) return 0;
  let tris = 0;
  (json.meshes || []).forEach((m) => m.primitives.forEach((p) => {
    tris += p.indices != null ? json.accessors[p.indices].count / 3
                              : json.accessors[p.attributes.POSITION].count / 3;
  }));
  return Math.round(tris);
}

/* ------------------------------------------------------------------- main */

const mb = (n) => (n / 1048576).toFixed(2) + " MB";
const kb = (n) => (n / 1024).toFixed(0) + " KB";

function sourceBytes(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /\.(obj|tga|fbx|mtl|blend)$/i.test(f))
    .reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Building props  (textures " + TEX_SIZE + "px q" + QUALITY + ")\n");

  for (const prop of PROPS) {
    const dir = path.join(PROPS_DIR, prop.dir);
    const source = path.join(dir, prop.glb || prop.blend || prop.obj);
    if (!fs.existsSync(source)) { console.log("  skip (missing): " + prop.dir); continue; }

    const before = sourceBytes(dir);
    const dest = path.join(OUT_DIR, prop.name + ".glb");
    let notes = [];
    let fit = null;
    let triangles = 0, vertices = 0;

    if (prop.kind === "glb") {
      // Already a GLB, already shaped - only the triangle count needs work.
      fs.copyFileSync(source, dest);
      triangles = countTriangles(dest);
    } else {
      const model = prop.kind === "blend" ? await buildBlendProp(prop, dir)
                  : prop.kind === "mesh"  ? await buildMeshProp(prop, dir)
                  : prop.object           ? await buildObjObjectProp(prop, dir)
                                          : await buildObjProp(prop, dir);
      fit = normalise(model.primitives, prop.height);
      writeGlb(dest, model, prop.name);
      notes = model.notes;
      triangles = model.primitives.reduce((n, p) => n + p.index.length / 3, 0);
      vertices = model.primitives.reduce((n, p) => n + p.position.length / 3, 0);
    }

    let cut = null;
    if (prop.simplify) {
      cut = simplifyGlb(dest, prop.simplify);
      triangles = cut.after;
    }
    const after = fs.statSync(dest).size;

    console.log("  " + prop.name);
    console.log("    triangles : " + (cut
      ? cut.before.toLocaleString() + "  →  " + cut.after.toLocaleString() +
        "   (" + Math.round((1 - cut.after / cut.before) * 100) + "% removed)"
      : triangles.toLocaleString() + "  (" + vertices.toLocaleString() + " vertices)"));
    notes.forEach((n) => console.log("    " + n));
    if (fit) {
      console.log("    size      : " + fit.size.map((n) => n.toFixed(2)).join(" x ") + " m" +
        "   (source height " + fit.sourceHeight.toFixed(2) + " units)");
    }
    console.log("    source " + mb(before) + "  →  " + kb(after) +
      "   (" + Math.round(before / after) + "x smaller)\n");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
