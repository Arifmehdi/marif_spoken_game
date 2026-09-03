/**
 * A small read-only .blend parser, enough to lift meshes out of a Blender file.
 *
 * Props keep arriving in formats a browser cannot open - the plant came as OBJ
 * plus TGA, the bookshelf as a raw .blend - and there is no Blender on this
 * machine to export with. A .blend is self-describing: it ends with a DNA1
 * block listing every struct and field in the version that wrote it, so the
 * layout is read from the file rather than hard-coded, and this keeps working
 * across Blender versions.
 *
 * Only what a prop needs is implemented: objects and their transforms, meshes
 * (verts / polys / loops / UVs), materials, and images. No modifiers, no
 * armatures, no node graphs - a modifier stack is evaluated by Blender at
 * render time and simply is not in the file.
 */
import fs from "node:fs";

/** Blender's Object.type for a mesh. */
export const OB_MESH = 1;

export function openBlend(file) {
  const buf = fs.readFileSync(file);

  if (buf.toString("ascii", 0, 7) !== "BLENDER") {
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      throw new Error(file + " is gzip-compressed; re-save it with compression off");
    }
    throw new Error(file + " is not a .blend file");
  }

  const ptrSize = buf[7] === 0x2d ? 8 : 4;          // '-' 64-bit, '_' 32-bit
  const version = buf.toString("ascii", 9, 12);
  const headerSize = 4 + 4 + ptrSize + 4 + 4;

  /* ---------------------------------------------------------- block index */

  const blocks = [];
  const byAddress = new Map();                       // old pointer -> block
  let dnaAt = null;

  for (let off = 12; off < buf.length; ) {
    const code = buf.toString("ascii", off, off + 4).replace(/\0+$/, "");
    const size = buf.readUInt32LE(off + 4);
    const address = ptrSize === 8 ? buf.readBigUInt64LE(off + 8) : BigInt(buf.readUInt32LE(off + 8));
    const sdnaIndex = buf.readUInt32LE(off + 8 + ptrSize);
    const count = buf.readUInt32LE(off + 12 + ptrSize);
    const data = off + headerSize;

    const block = { code, size, address, sdnaIndex, count, data };
    blocks.push(block);
    if (address) byAddress.set(address, block);
    if (code === "DNA1") dnaAt = block;
    if (code === "ENDB") break;
    off = data + size;
  }
  if (!dnaAt) throw new Error("no DNA1 block - file is truncated");

  /* ------------------------------------------------------------------ DNA */

  const sdna = readDna(buf, dnaAt.data);

  // struct name -> { size, fields: { name -> { offset, size, type, count } } }
  const layouts = new Map();
  sdna.structs.forEach((s, index) => {
    const fields = new Map();
    let offset = 0;
    for (const f of s.fields) {
      const name = sdna.names[f.name];
      const isPointer = name.startsWith("*");
      const arrayLength = [...name.matchAll(/\[(\d+)\]/g)].reduce((n, m) => n * Number(m[1]), 1);
      const unit = isPointer ? ptrSize : sdna.lengths[f.type];
      const clean = name.replace(/[*()\[\]0-9]/g, "").replace(/^\s+|\s+$/g, "");
      fields.set(clean, {
        offset,
        size: unit * arrayLength,
        unit,
        count: arrayLength,
        type: sdna.types[f.type],
        isPointer
      });
      offset += unit * arrayLength;
    }
    layouts.set(sdna.types[s.type], { index, size: sdna.lengths[s.type], fields });
  });

  /* --------------------------------------------------------------- access */

  const read = {
    char: (at) => buf.readInt8(at),
    uchar: (at) => buf.readUInt8(at),
    short: (at) => buf.readInt16LE(at),
    ushort: (at) => buf.readUInt16LE(at),
    int: (at) => buf.readInt32LE(at),
    float: (at) => buf.readFloatLE(at),
    pointer: (at) => (ptrSize === 8 ? buf.readBigUInt64LE(at) : BigInt(buf.readUInt32LE(at)))
  };

  /** One record of `struct` living at absolute offset `at`. */
  function field(struct, at, path) {
    const parts = path.split(".");
    let type = struct;
    let cursor = at;
    for (let i = 0; i < parts.length; i++) {
      const layout = layouts.get(type);
      if (!layout) return null;
      const f = layout.fields.get(parts[i]);
      if (!f) return null;
      if (i === parts.length - 1) return { ...f, at: cursor + f.offset };
      cursor += f.offset;
      type = f.type;
    }
    return null;
  }

  function value(struct, at, path) {
    const f = field(struct, at, path);
    if (!f) return null;
    if (f.isPointer) return read.pointer(f.at);
    const reader = read[f.type];
    if (!reader) return null;
    if (f.count === 1) return reader(f.at);
    const out = [];
    for (let i = 0; i < f.count; i++) out.push(reader(f.at + i * f.unit));
    return out;
  }

  function text(struct, at, path) {
    const f = field(struct, at, path);
    if (!f) return "";
    const end = buf.indexOf(0, f.at);
    return buf.toString("ascii", f.at, end === -1 ? f.at + f.count : Math.min(end, f.at + f.count));
  }

  /** Datablock names carry a two-letter type prefix ("OBShelf") - drop it. */
  const idName = (struct, at) => text(struct, at, "id.name").replace(/^[A-Z]{2}/, "");

  /**
   * Follow a pointer to the block that owns that address and return an array of
   * `count` records. Blender writes each allocation as its own block, so the
   * address is the block's start.
   */
  function follow(address, count, structName, reader) {
    if (!address) return [];
    const block = byAddress.get(address);
    if (!block) return [];
    const layout = layouts.get(structName);
    const stride = layout ? layout.size : block.size / Math.max(1, block.count);
    const total = Math.min(count, Math.floor(block.size / stride));
    const out = new Array(total);
    for (let i = 0; i < total; i++) out[i] = reader(block.data + i * stride, i);
    return out;
  }

  const blocksOfCode = (code) => blocks.filter((b) => b.code === code);

  /* -------------------------------------------------------------- readers */

  function meshAt(at) {
    const totvert = value("Mesh", at, "totvert");
    const totpoly = value("Mesh", at, "totpoly");
    const totloop = value("Mesh", at, "totloop");
    const uvAddress = value("Mesh", at, "mloopuv");
    return {
      address: null,
      name: idName("Mesh", at),
      totvert, totpoly, totloop,
      totcol: value("Mesh", at, "totcol"),
      hasUv: !!(uvAddress && byAddress.has(uvAddress)),
      _at: at
    };
  }

  return {
    version,
    ptrSize,
    layouts,

    objects() {
      return blocksOfCode("OB").map((b) => {
        const dataPtr = value("Object", b.data, "data");
        const parentPtr = value("Object", b.data, "parent");
        const dataBlock = dataPtr && byAddress.get(dataPtr);
        const parentBlock = parentPtr && byAddress.get(parentPtr);
        return {
          name: idName("Object", b.data),
          type: value("Object", b.data, "type"),
          loc: value("Object", b.data, "loc"),
          size: value("Object", b.data, "size"),
          rot: value("Object", b.data, "rot"),
          quat: value("Object", b.data, "quat"),
          rotAxis: value("Object", b.data, "rotAxis"),
          rotAngle: value("Object", b.data, "rotAngle"),
          rotmode: value("Object", b.data, "rotmode"),
          // Blender stores a matrix with the translation in elements 12..14,
          // the same column-major order glTF and three.js use, so it needs no
          // transposing on the way out.
          parentinv: value("Object", b.data, "parentinv"),
          parentName: parentBlock ? idName("Object", parentBlock.data) : null,
          parentAddress: parentPtr || null,
          address: b.address,
          dataAddress: dataPtr || null,
          dataName: dataBlock ? idName("Mesh", dataBlock.data) : null,
          /** Material slots, in the order MPoly.mat_nr indexes them. */
          materials: follow(value("Object", b.data, "mat"), value("Object", b.data, "totcol") || 0,
            null, (o) => read.pointer(o))
        };
      });
    },

    meshes() {
      return blocksOfCode("ME").map((b) => ({ ...meshAt(b.data), address: b.address }));
    },

    materials() {
      return blocksOfCode("MA").map((b) => ({
        name: idName("Material", b.data),
        address: b.address,
        rgb: [value("Material", b.data, "r"), value("Material", b.data, "g"), value("Material", b.data, "b")]
      }));
    },

    images() {
      return blocksOfCode("IM").map((b) => ({ ...this.imageAt(b.address), address: b.address }));
    },

    /**
     * The image a material paints with, if any.
     *
     * This file predates Blender's node materials, so the link runs through the
     * old texture slots: Material.mtex[] -> MTex.tex -> Tex.ima. The first slot
     * that resolves to an image wins, which is all a prop needs.
     */
    materialAt(address) {
      const block = byAddress.get(address);
      if (!block) return null;
      const at = block.data;

      let imageAddress = null;
      const slots = field("Material", at, "mtex");
      if (slots) {
        for (let i = 0; i < slots.count && !imageAddress; i++) {
          const mtex = read.pointer(slots.at + i * slots.unit);
          const mtexBlock = mtex && byAddress.get(mtex);
          if (!mtexBlock) continue;
          const tex = value("MTex", mtexBlock.data, "tex");
          const texBlock = tex && byAddress.get(tex);
          if (!texBlock) continue;
          const ima = value("Tex", texBlock.data, "ima");
          if (ima && byAddress.has(ima)) imageAddress = ima;
        }
      }

      const legacy = [value("Material", at, "r"), value("Material", at, "g"), value("Material", at, "b")];

      // A file saved for Cycles never touches Material.r/g/b, so they sit at
      // Blender's untouched 0.80 grey while the real colour lives in a shader
      // node tree. Only reach for the node tree when the legacy value is that
      // default - a file that did set it means it.
      const untouched = legacy.every((c) => c != null && Math.abs(c - 0.8) < 0.001);
      const rgb = untouched ? (this.nodeColour(address) || legacy) : legacy;

      return { name: idName("Material", at), address, rgb, imageAddress };
    },

    /**
     * Read one field of `struct` from whatever block starts at `address`.
     * Handy for walking pointers the higher-level readers do not cover.
     */
    read(address, struct, path) {
      const block = byAddress.get(address);
      if (!block) return undefined;
      return value(struct, block.data, path);
    },

    /** Same, for a char array. */
    readText(address, struct, path) {
      const block = byAddress.get(address);
      if (!block) return undefined;
      return text(struct, block.data, path);
    },

    hasBlock(address) { return byAddress.has(address); },

    /**
     * Diffuse colour out of a Cycles node material.
     *
     * Files saved for Cycles leave Material.r/g/b at Blender's 0.80 grey default
     * and keep the real colour in a shader node tree - the hospital room's 25
     * materials all read as the same grey without this. The walk is
     * Material.nodetree -> bNodeTree.nodes -> bNode.inputs -> the socket whose
     * idname is NodeSocketColor, whose default_value is a bNodeSocketValueRGBA.
     *
     * A node named like a diffuse/principled shader wins; failing that, the
     * first colour socket in the tree is taken.
     */
    nodeColour(materialAddress) {
      const block = byAddress.get(materialAddress);
      if (!block) return null;
      const treePtr = value("Material", block.data, "nodetree");
      const tree = treePtr && byAddress.get(treePtr);
      if (!tree) return null;

      const list = (struct, at, path, itemStruct, take) => {
        const head = field(struct, at, path);
        if (!head) return;
        let ptr = read.pointer(head.at);          // ListBase.first
        let guard = 0;
        while (ptr && guard++ < 512) {
          const b = byAddress.get(ptr);
          if (!b) return;
          if (take(b.data) === false) return;
          ptr = value(itemStruct, b.data, "next");
        }
      };

      let best = null;
      let fallback = null;

      list("bNodeTree", tree.data, "nodes", "bNode", (nodeAt) => {
        const idname = text("bNode", nodeAt, "idname");
        const shader = /Bsdf(Diffuse|Principled)|ShaderNodeBsdf/i.test(idname);

        list("bNode", nodeAt, "inputs", "bNodeSocket", (sockAt) => {
          const socketId = text("bNodeSocket", sockAt, "idname");
          if (!/NodeSocketColor/i.test(socketId)) return;
          const valuePtr = value("bNodeSocket", sockAt, "default_value");
          const valueBlock = valuePtr && byAddress.get(valuePtr);
          if (!valueBlock) return;
          const f = field("bNodeSocketValueRGBA", valueBlock.data, "value");
          if (!f) return;
          const rgba = [0, 1, 2].map((i) => read.float(f.at + i * 4));
          if (shader && !best) best = rgba;
          if (!fallback) fallback = rgba;
        });
      });

      return best || fallback;
    },

    imageAt(address) {
      const block = byAddress.get(address);
      if (!block) return null;
      const at = block.data;
      const packedPtr = value("Image", at, "packedfile");
      const packedBlock = packedPtr && byAddress.get(packedPtr);

      let bytes = null;
      if (packedBlock) {
        const size = value("PackedFile", packedBlock.data, "size");
        const dataPtr = value("PackedFile", packedBlock.data, "data");
        const dataBlock = dataPtr && byAddress.get(dataPtr);
        if (dataBlock && size > 0) {
          bytes = buf.subarray(dataBlock.data, dataBlock.data + Math.min(size, dataBlock.size));
        }
      }

      return {
        name: idName("Image", at),
        path: text("Image", at, "name"),
        packed: !!bytes,
        bytes
      };
    },

    /** Material slot pointers on a mesh, indexed by MPoly.mat_nr. */
    meshMaterials(meshAddress) {
      const block = byAddress.get(meshAddress);
      if (!block) return [];
      return follow(value("Mesh", block.data, "mat"), value("Mesh", block.data, "totcol") || 0,
        null, (o) => read.pointer(o));
    },

    /**
     * Geometry of one mesh, in the mesh's own space.
     * @returns {{ positions: number[], polys: number[][], uvs: number[]|null, matIndex: number[] }}
     */
    geometry(meshAddress) {
      const block = byAddress.get(meshAddress);
      if (!block) return null;
      const at = block.data;

      const totvert = value("Mesh", at, "totvert");
      const totpoly = value("Mesh", at, "totpoly");
      const totloop = value("Mesh", at, "totloop");

      const positions = [];
      follow(value("Mesh", at, "mvert"), totvert, "MVert", (o) => {
        const co = field("MVert", o, "co");
        positions.push(read.float(co.at), read.float(co.at + 4), read.float(co.at + 8));
      });

      const loops = follow(value("Mesh", at, "mloop"), totloop, "MLoop", (o) => value("MLoop", o, "v"));

      const uvAddress = value("Mesh", at, "mloopuv");
      const loopUv = follow(uvAddress, totloop, "MLoopUV", (o) => {
        const uv = field("MLoopUV", o, "uv");
        return [read.float(uv.at), read.float(uv.at + 4)];
      });

      const polys = [];
      const matIndex = [];
      follow(value("Mesh", at, "mpoly"), totpoly, "MPoly", (o) => {
        const start = value("MPoly", o, "loopstart");
        const count = value("MPoly", o, "totloop");
        const corners = [];
        for (let i = 0; i < count; i++) corners.push(start + i);
        polys.push(corners);
        matIndex.push(value("MPoly", o, "mat_nr") || 0);
      });

      return { positions, loops, polys, matIndex, uvs: loopUv.length ? loopUv : null };
    }
  };
}

/* ------------------------------------------------- matrices (column-major) */

const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

export function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function transform(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

export function determinant3(m) {
  return m[0] * (m[5] * m[10] - m[9] * m[6])
       - m[4] * (m[1] * m[10] - m[9] * m[2])
       + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

/**
 * An object's local matrix, built the way Blender does: rotation depends on
 * rotmode - 0 is a quaternion, a positive value is an Euler order, -1 is
 * axis-angle. Getting this wrong scatters the parts of a model around.
 */
export function basisMatrix(obj) {
  const [sx, sy, sz] = obj.size || [1, 1, 1];
  let rot = identity();

  if (obj.rotmode === 0 && obj.quat) {
    const [w, x, y, z] = obj.quat;
    rot = quatToMatrix(x, y, z, w);
  } else if (obj.rotmode === -1 && obj.rotAxis) {
    const [ax, ay, az] = obj.rotAxis;
    const len = Math.hypot(ax, ay, az) || 1;
    const half = (obj.rotAngle || 0) / 2;
    const s = Math.sin(half);
    rot = quatToMatrix((ax / len) * s, (ay / len) * s, (az / len) * s, Math.cos(half));
  } else if (obj.rot) {
    rot = eulerToMatrix(obj.rot, obj.rotmode || 1);
  }

  const m = rot.slice();
  for (let c = 0; c < 3; c++) {
    const s = [sx, sy, sz][c];
    m[c * 4] *= s; m[c * 4 + 1] *= s; m[c * 4 + 2] *= s;
  }
  m[12] = obj.loc ? obj.loc[0] : 0;
  m[13] = obj.loc ? obj.loc[1] : 0;
  m[14] = obj.loc ? obj.loc[2] : 0;
  return m;
}

function quatToMatrix(x, y, z, w) {
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n; y /= n; z /= n; w /= n;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w),     2 * (x * z - y * w),     0,
    2 * (x * y - z * w),     1 - 2 * (x * x + z * z), 2 * (y * z + x * w),     0,
    2 * (x * z + y * w),     2 * (y * z - x * w),     1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1
  ];
}

const AXIS_ORDER = { 1: "XYZ", 2: "XZY", 3: "YXZ", 4: "YZX", 5: "ZXY", 6: "ZYX" };

function eulerToMatrix([rx, ry, rz], mode) {
  const axis = { X: rx, Y: ry, Z: rz };
  const order = AXIS_ORDER[mode] || "XYZ";
  // Blender applies the named order right-to-left, i.e. XYZ means Z then Y then X.
  let m = identity();
  for (const letter of order) m = multiply(m, axisMatrix(letter, axis[letter]));
  return m;
}

function axisMatrix(letter, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  if (letter === "X") return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1];
  if (letter === "Y") return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
  return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1];
}

/**
 * World matrix, following Blender's rule:
 *   world = parent_world * parent_inverse * basis
 */
export function worldMatrix(obj, byAddress) {
  const local = basisMatrix(obj);
  if (!obj.parentAddress) return local;

  const parent = byAddress.get(obj.parentAddress);
  if (!parent) return local;

  const withInverse = obj.parentinv ? multiply(obj.parentinv, local) : local;
  return multiply(worldMatrix(parent, byAddress), withInverse);
}

/** Blender is Z-up; glTF is Y-up. (x, y, z) -> (x, z, -y). */
export const Z_UP_TO_Y_UP = [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1];

/* ------------------------------------------------------------------- DNA */

function readDna(buf, start) {
  let p = start;
  const tag = () => { const t = buf.toString("ascii", p, p + 4); p += 4; return t; };
  const u32 = () => { const v = buf.readUInt32LE(p); p += 4; return v; };
  const align = () => { p = (p + 3) & ~3; };
  const strings = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const end = buf.indexOf(0, p);
      out.push(buf.toString("ascii", p, end));
      p = end + 1;
    }
    align();
    return out;
  };

  if (tag() !== "SDNA") throw new Error("DNA1 block does not start with SDNA");
  if (tag() !== "NAME") throw new Error("DNA: expected NAME");
  const names = strings(u32());

  if (tag() !== "TYPE") throw new Error("DNA: expected TYPE");
  const typeCount = u32();
  const types = strings(typeCount);

  if (tag() !== "TLEN") throw new Error("DNA: expected TLEN");
  const lengths = [];
  for (let i = 0; i < typeCount; i++) { lengths.push(buf.readUInt16LE(p)); p += 2; }
  align();

  if (tag() !== "STRC") throw new Error("DNA: expected STRC");
  const structCount = u32();
  const structs = [];
  for (let i = 0; i < structCount; i++) {
    const type = buf.readUInt16LE(p); p += 2;
    const fieldCount = buf.readUInt16LE(p); p += 2;
    const fields = [];
    for (let f = 0; f < fieldCount; f++) {
      fields.push({ type: buf.readUInt16LE(p), name: buf.readUInt16LE(p + 2) });
      p += 4;
    }
    structs.push({ type, fields });
  }

  return { names, types, lengths, structs };
}
