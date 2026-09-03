/**
 * LocationFactory - builds each playable place out of primitives.
 *
 * Every builder returns the same shape, so adding a location is self-contained:
 *   { group, spawn, npcSpots, colliders, bounds, sky, fog, label }
 *
 * colliders are axis-aligned boxes in world space; Player just clamps against
 * them, which is plenty for a walk-and-talk game and costs nothing.
 */
import * as THREE from "three";

const M = (color) => new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });

/**
 * Optional ModelLibrary, handed in by buildLocation(). Kept module-scoped so
 * the nine builders keep their one-argument signature - only the prop helpers
 * below ever read it, and they all cope with it being null.
 */
let props = null;

/**
 * Swap a real model in for a procedural stand-in, in place.
 *
 * Every prop is built procedurally first, so a location is complete the instant
 * it is created and never waits on a download. If the model is already cached
 * the swap happens in the same frame; if not, it happens when the file arrives,
 * and if the file is missing the primitive version simply stays. That is why
 * `holder` is a group rather than the meshes themselves.
 */
function upgradeProp(key, holder, scale) {
  if (!props) return;

  const swap = (model) => {
    // The player may have left before the download finished.
    if (!model || !holder.parent) return;
    [...holder.children].forEach((child) => { holder.remove(child); releaseTree(child); });
    model.scale.setScalar(scale);
    // Geometry and textures belong to ModelLibrary's cache and are shared with
    // every other copy in the world - leaving this location must not free them.
    model.userData.shared = true;
    model.traverse((o) => { o.receiveShadow = true; });
    holder.add(model);
  };

  const cached = props.instance(key);
  if (cached) swap(cached);
  else props.get(key).then(swap);
}

function box(w, h, d, color, x, y, z, group, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || M(color));
  mesh.position.set(x, y, z);
  if (opts.rotY) mesh.rotation.y = opts.rotY;
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function cyl(rt, rb, h, color, x, y, z, group, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), M(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/* --------------------------------------------------------------- shared */

/**
 * How far the floor and side walls run PAST the play area on the open side.
 *
 * The camera sits 8.2 behind the player and looks down at it. With the player
 * at the front of the play area the bottom of the frame reaches 3.17 further
 * than the floor used to, so a band of empty sky showed under the room
 * - the same room read as solid the moment the player stepped back. This is
 * scenery only: `bounds` still stops the player at the original edge.
 *
 * Only the +Z side gets it. Extending the floor backwards would put ground
 * behind the back wall, which this camera sees straight over the top of.
 */
const FLOOR_APRON = 3.8;

function floor(group, w, d, color) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d + FLOOR_APRON), M(color));
  f.rotation.x = -Math.PI / 2;
  f.position.z = FLOOR_APRON / 2;
  f.receiveShadow = true;
  group.add(f);
  return f;
}

function walls(group, w, d, color, h = 3.2) {
  const half = 0.1;
  // The side walls run the length of the floor, apron included, so the extra
  // ground in front is framed as part of the room instead of jutting out.
  const deep = d + FLOOR_APRON;
  const mid = FLOOR_APRON / 2;
  box(w, h, half * 2, color, 0, h / 2, -d / 2, group, { castShadow: false });
  box(half * 2, h, deep, color, -w / 2, h / 2, mid, group, { castShadow: false });
  box(half * 2, h, deep, color, w / 2, h / 2, mid, group, { castShadow: false });
  return [
    { x: 0, z: -d / 2, w, d: 0.4 },
    { x: -w / 2, z: mid, w: 0.4, d: deep },
    { x: w / 2, z: mid, w: 0.4, d: deep }
  ];
}

function table(group, x, z, color = "#b0793f", w = 1.3, d = 0.75, h = 0.72) {
  box(w, 0.08, d, color, x, h, z, group);
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  legs.forEach(([sx, sz]) => cyl(0.035, 0.035, h, "#8a5a2b", x + sx * (w / 2 - 0.1), h / 2, z + sz * (d / 2 - 0.09), group, 6));
  return { x, z, w, d: d + 0.1 };
}

function chair(group, x, z, rotY = 0, color = "#3b6ea5") {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  box(0.42, 0.06, 0.42, color, 0, 0.45, 0, g);
  box(0.42, 0.44, 0.06, color, 0, 0.67, -0.18, g);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
    cyl(0.025, 0.025, 0.45, "#5a5a66", sx * 0.17, 0.225, sz * 0.17, g, 6));
  group.add(g);
  return { x, z, w: 0.5, d: 0.5 };
}

/**
 * `model` names a ModelLibrary prop to use instead of the primitive leaves -
 * pass null (the default) to keep the cheap procedural version. Every indoor
 * location calls this, so the real model is opted into per call site rather
 * than applied everywhere at once.
 */
function plant(group, x, z, scale = 1, model = null) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  cyl(0.16, 0.13, 0.28, "#c96b4a", 0, 0.14, 0, g, 10);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), M(i % 2 ? "#2f9e5e" : "#3fb873"));
    leaf.position.set(Math.cos(a) * 0.13, 0.45 + (i % 3) * 0.11, Math.sin(a) * 0.13);
    leaf.scale.set(1, 1.4, 1);
    leaf.castShadow = true;
    g.add(leaf);
  }
  group.add(g);
  if (model) upgradeProp(model, g, scale);
  return { x, z, w: 0.5, d: 0.5 };
}

function tree(group, x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  cyl(0.16, 0.22, 1.6, "#7a5230", 0, 0.8, 0, g, 8);
  [[0, 1.9, 0, 0.85], [0.4, 1.65, 0.2, 0.6], [-0.35, 1.7, -0.25, 0.55], [0.1, 2.35, -0.2, 0.5]].forEach(([bx, by, bz, r]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 9), M("#3a9d5d"));
    b.position.set(bx, by, bz);
    b.castShadow = true;
    g.add(b);
  });
  group.add(g);
  // Collider must grow with the trunk, or a big tree can be walked through.
  return { x, z, w: 0.7 * scale, d: 0.7 * scale };
}

/**
 * The first aid cabinet. The painted box stays as the stand-in.
 *
 * The model's door faces its local +Z, so a quarter turn points it away from
 * the wall and into the room.
 */
function cabinet(group, x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  box(0.9, 1.7, 0.45, "#ffffff", 0, 0.85, 0, g);
  group.add(g);
  upgradeProp("cabinet", g, 1);
  return { x, z, w: rotY ? 0.65 : 0.75, d: rotY ? 0.75 : 0.65 };
}

/**
 * The living room sofa. The painted boxes stay as the stand-in, in the same
 * place and the same colours, so the swap changes the shape and nothing else.
 *
 * The model's back panel is on its local -Z, which is the way the painted one
 * faced too, so it needs no turning.
 */
function sofa(group, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  box(2.8, 0.5, 1.0, "#4f7a6f", 0, 0.3, 0, g);
  box(2.8, 0.7, 0.28, "#5c8a7e", 0, 0.72, -0.42, g);
  box(0.28, 0.6, 1.0, "#5c8a7e", -1.36, 0.62, 0, g);
  box(0.28, 0.6, 1.0, "#5c8a7e", 1.36, 0.62, 0, g);
  group.add(g);
  upgradeProp("sofa", g, 1);
  return { x, z, w: 2.7, d: 1.3 };
}

/**
 * The hospital ward: two beds, their curtain rails and the bedside equipment.
 * The painted beds stay as the stand-in.
 *
 * It sits BEHIND the talking spot, further from the camera than the NPC, so
 * nothing of it can come between the two during a conversation.
 */
function ward(group, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  [[-1.5, 0], [1.5, 0]].forEach(([bx, bz]) => {
    box(1.0, 0.45, 2.1, "#c8d8e0", bx, 0.42, bz, g);
    box(1.05, 0.18, 2.15, "#ffffff", bx, 0.72, bz, g);
    box(1.0, 0.16, 0.4, "#eef4f7", bx, 0.86, bz - 0.85, g);
    box(1.1, 0.5, 0.08, "#8fa8b4", bx, 0.65, bz + 1.05, g);
  });
  group.add(g);
  upgradeProp("ward", g, 1);
  return { x, z, w: 6.6, d: 4.4 };
}

/**
 * The park fountain. The stacked cylinders are the stand-in; the real model is
 * the client's fountain.fbx, a tiered marble basin with a glow crystal on top.
 *
 * The collider covers the basin only. It is 2.79 across, but a player stopped a
 * metre and a half out would never get close enough for it to read as an
 * object they are standing beside.
 */
function fountain(group, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  cyl(0.5, 0.6, 0.7, "#c8c8d0", 0, 0.35, 0, g, 14);
  cyl(0.18, 0.22, 1.3, "#c8c8d0", 0, 1.0, 0, g, 10);
  group.add(g);
  upgradeProp("fountain", g, 1);
  return { x, z, w: 1.9, d: 1.9 };
}

/**
 * The shelter at the stop. The painted version stays as the stand-in; the real
 * model is the client's bus_stop.blend - posts, roof, back glass, bench and ad
 * panel - with the street scene it was modelled in left behind.
 */
function busShelter(group, x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  box(5.0, 0.15, 2.0, "#5a6570", 0, 2.6, 0, g);
  cyl(0.09, 0.09, 2.6, "#5a6570", -2.3, 1.3, 0, g, 8);
  cyl(0.09, 0.09, 2.6, "#5a6570", 2.3, 1.3, 0, g, 8);
  box(5.0, 1.4, 0.08, "#9fd4e0", 0, 1.5, 0.75, g, { castShadow: false });
  box(3.4, 0.12, 0.45, "#a4703c", 0, 0.5, 0.4, g);
  box(3.4, 0.5, 0.1, "#a4703c", 0, 0.75, 0.62, g);
  group.add(g);
  upgradeProp("busStop", g, 1);
  return { x, z, w: 4.7, d: 2.2 };
}

/**
 * The bus at the stop. The painted box version stays as the stand-in, built to
 * the same 8.4 x 2.3 x 2.5 the real bus.obj measures, so the swap changes the
 * look and not the layout.
 */
function busVehicle(group, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  box(8.4, 2.3, 2.5, "#2f6fc4", 0, 1.5, 0, g);
  box(8.5, 0.5, 2.55, "#1f4f92", 0, 0.5, 0, g);
  for (let i = 0; i < 5; i++) box(1.2, 0.9, 0.06, "#bfe4ff", -3.2 + i * 1.6, 1.9, 1.28, g, { castShadow: false });
  box(1.0, 1.5, 0.06, "#bfe4ff", 4.22, 1.5, 0.7, g, { castShadow: false });
  [[-2.7, 1.25], [2.7, 1.25], [-2.7, -1.25], [2.7, -1.25]].forEach(([bx, bz]) => {
    const wheel = cyl(0.55, 0.55, 0.35, "#22252b", bx, 0.55, bz, g, 14);
    wheel.rotation.z = Math.PI / 2;
  });
  group.add(g);
  upgradeProp("bus", g, 1);
  return { x, z, w: 9.1, d: 2.8 };
}

/**
 * `model` names a ModelLibrary prop to use instead of the painted boxes. The
 * real bookshelf is 1.06 wide once scaled, not `w`, so the collider follows the
 * model - otherwise the player is stopped by a metre of empty floor.
 */
function shelf(group, x, z, rotY = 0, w = 1.6, model = null) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  box(w, 1.9, 0.42, "#a4703c", 0, 0.95, 0, g);
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 7; i++) {
      const c = ["#e05c5c", "#4a90d9", "#f2c14e", "#5cb85c", "#a86ed6"][(i + s) % 5];
      box(w / 8.5, 0.24, 0.16, c, -w / 2 + 0.16 + i * (w / 8), 0.55 + s * 0.5, 0.24, g);
    }
  }
  group.add(g);

  const span = model ? PROP_FOOTPRINT[model] : null;
  if (model) upgradeProp(model, g, 1);
  const across = span ? span.w : w;
  const deep = span ? span.d : 0.5;
  return { x, z, w: rotY ? deep : across, d: rotY ? across : deep };
}

/** Ground footprint of the .glb props, in world units, for colliders. */
const PROP_FOOTPRINT = {
  bookshelf: { w: 1.06, d: 0.45 }
};

/**
 * A flat sign drawn onto a canvas texture.
 *
 * The type size is FITTED, not fixed. At a hard-coded 64px "Today's Lesson" ran
 * wider than the canvas and lost a letter off each end ("oday's Lessor"), and
 * "Home Sweet Home" and "MAIN STREET" were on the same edge. The font now
 * shrinks until the string fits inside a margin, so a caller only picks a
 * width and any wording is safe.
 *
 * opts.h      plane height in world units (default w / 4).
 * opts.chalk  no painted plate - white writing straight onto whatever is
 *             behind the plane. The classroom board needs this: a second green
 *             rectangle sitting on the blackboard read as a sticker stuck over
 *             it rather than as a lesson written up for the class.
 */
function signBoard(group, text, x, y, z, color = "#2f6f4f", w = 2.4, opts = {}) {
  const h = opts.h || w / 4;
  const canvas = document.createElement("canvas");
  canvas.height = 256;                                   // texels per unit of height
  canvas.width = Math.round(canvas.height * (w / h));
  const ctx = canvas.getContext("2d");

  if (!opts.chalk) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const margin = canvas.width * 0.07;
  const font = (px) => "bold " + px + "px Verdana, sans-serif";
  let size = Math.round(canvas.height * (opts.chalk ? 0.46 : 0.52));
  ctx.font = font(size);
  while (size > 10 && ctx.measureText(text).width > canvas.width - margin * 2) {
    size -= 2;
    ctx.font = font(size);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const midX = canvas.width / 2;
  const midY = canvas.height * (opts.chalk ? 0.44 : 0.5);

  if (opts.chalk) {
    ctx.shadowColor = "rgba(255,255,255,.5)";            // chalk dust around the stroke
    ctx.shadowBlur = 9;
    ctx.fillStyle = "#f3f7ee";
  } else {
    ctx.fillStyle = "#ffffff";
  }
  ctx.fillText(text, midX, midY);

  if (opts.chalk) {
    ctx.shadowBlur = 0;
    const half = ctx.measureText(text).width / 2;
    ctx.strokeStyle = "rgba(243,247,238,.7)";
    ctx.lineWidth = Math.max(2, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(midX - half, canvas.height * 0.76);
    ctx.lineTo(midX + half, canvas.height * 0.76);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;                                    // signs are read at a steep angle
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: !!opts.chalk }));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

/* ------------------------------------------------------------ locations */

const BUILDERS = {
  school(group) {
    const W = 14, D = 12;
    floor(group, W, D, "#d9cdb8");
    const c = walls(group, W, D, "#7fc4c9");

    box(6.2, 2.2, 0.12, "#2f5d4a", 0, 1.9, -D / 2 + 0.2, group, { castShadow: false });
    box(6.6, 0.16, 0.22, "#8a5a2b", 0, 0.72, -D / 2 + 0.26, group);
    // Written on the board, inside its 0.8 - 3.0 span, not floating over the top.
    signBoard(group, "Today's Lesson", 0, 2.42, -D / 2 + 0.28, null, 4.6, { h: 0.86, chalk: true });

    c.push(table(group, -3.6, -3.4, "#b0793f", 2.2, 0.9));
    c.push(chair(group, -3.6, -4.3, Math.PI));

    for (let r = 0; r < 3; r++) {
      for (let s = 0; s < 3; s++) {
        const x = -3.4 + s * 3.4, z = 0.4 + r * 2.3;
        c.push(table(group, x, z, "#c08a4e", 1.2, 0.62, 0.6));
        c.push(chair(group, x, z + 0.85, Math.PI));
      }
    }

    // Two real bookshelves fill the wall the one painted shelf used to cover.
    // The model's solid back panel faces its local -Z, so +PI/2 turns the open
    // front away from the wall and into the room.
    c.push(shelf(group, -W / 2 + 0.35, -1.1, Math.PI / 2, 1.06, "bookshelf"));
    c.push(shelf(group, -W / 2 + 0.35,  0.1, Math.PI / 2, 1.06, "bookshelf"));
    c.push(plant(group, W / 2 - 0.9, -3.5, 1, "plant1"));
    c.push(plant(group, W / 2 - 0.9, 3.5, 1, "plant1"));

    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), M("#ffffff"));
    clock.position.set(4.6, 2.6, -D / 2 + 0.22);
    group.add(clock);

    return {
      // Stand in the aisle between the desk columns (x = -3.4 / 0 / 3.4). This
      // aisle lines up with the teacher at x -1.6, so walking straight forward
      // reaches her without snagging on a desk.
      spawn: { x: -1.7, z: 4.6 },
      npcSpots: [{ x: -1.6, z: -2.2, rotY: Math.PI }],
      colliders: c, bounds: { minX: -W / 2 + 0.7, maxX: W / 2 - 0.7, minZ: -D / 2 + 0.7, maxZ: D / 2 - 0.7 },
      sky: "#bfe9f2", fog: 40, label: "School"
    };
  },

  home(group) {
    const W = 13, D = 11;
    floor(group, W, D, "#c8a678");
    const c = walls(group, W, D, "#f0d8b8");

    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), M("#b4503f"));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-1.5, 0.02, 0.5); rug.receiveShadow = true;
    group.add(rug);

    c.push(sofa(group, -1.5, -1.9));

    c.push(table(group, -1.5, 0.5, "#8a5a2b", 1.5, 0.8, 0.45));

    box(0.3, 1.1, 2.0, "#3a3a44", 4.6, 0.55, 0.2, group);
    box(0.12, 1.3, 2.2, "#15151c", 4.35, 1.5, 0.2, group);
    c.push({ x: 4.6, z: 0.2, w: 0.6, d: 2.2 });

    // kitchen counter
    box(4.2, 0.9, 0.7, "#d8d8e0", -3.2, 0.45, -D / 2 + 0.9, group);
    box(4.3, 0.08, 0.78, "#8a8a96", -3.2, 0.92, -D / 2 + 0.9, group);
    c.push({ x: -3.2, z: -D / 2 + 0.9, w: 4.4, d: 1.0 });

    // dining
    c.push(table(group, 2.2, 3.0, "#a4703c", 1.8, 1.0));
    c.push(chair(group, 1.3, 3.0, Math.PI / 2, "#8a5a2b"));
    c.push(chair(group, 3.1, 3.0, -Math.PI / 2, "#8a5a2b"));

    c.push(plant(group, W / 2 - 1.0, -3.6, 1.2, "plant1"));
    signBoard(group, "Home Sweet Home", 0, 2.5, -D / 2 + 0.22, "#a4703c", 3.2);

    return {
      // Far enough back that the player actually walks over; at z 4.0 they
      // spawned already inside talk range.
      spawn: { x: 0.5, z: 4.6 },
      npcSpots: [{ x: 0.6, z: 1.6, rotY: Math.PI }],
      colliders: c, bounds: { minX: -W / 2 + 0.7, maxX: W / 2 - 0.7, minZ: -D / 2 + 0.7, maxZ: D / 2 - 0.7 },
      sky: "#ffe2bd", fog: 40, label: "Home"
    };
  },

  shop(group) {
    const W = 13, D = 11;
    floor(group, W, D, "#cfcfd8");
    const c = walls(group, W, D, "#f2e2c4");

    box(4.6, 1.0, 0.9, "#a4703c", 0, 0.5, -1.4, group);
    box(4.8, 0.1, 1.0, "#c99a5e", 0, 1.03, -1.4, group);
    c.push({ x: 0, z: -1.4, w: 4.8, d: 1.2 });

    // till
    box(0.5, 0.3, 0.4, "#3a3a44", 1.6, 1.22, -1.4, group);

    c.push(shelf(group, -W / 2 + 0.7, -1.0, Math.PI / 2, 3.2));
    c.push(shelf(group, W / 2 - 0.7, -1.0, -Math.PI / 2, 3.2));
    c.push(shelf(group, -2.6, -D / 2 + 0.7, 0, 3.0));
    c.push(shelf(group, 2.6, -D / 2 + 0.7, 0, 3.0));

    // fruit crates
    [[-3.2, 2.2, "#e05c5c"], [-2.1, 2.2, "#f2c14e"], [-3.2, 3.3, "#5cb85c"]].forEach(([x, z, col]) => {
      box(1.0, 0.4, 1.0, "#a4703c", x, 0.2, z, group);
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), M(col));
        s.position.set(x + (Math.random() - 0.5) * 0.6, 0.52, z + (Math.random() - 0.5) * 0.6);
        s.castShadow = true;
        group.add(s);
      }
      c.push({ x, z, w: 1.1, d: 1.1 });
    });

    signBoard(group, "SHOP", 0, 2.6, -D / 2 + 0.22, "#c0392b", 3.0);

    return {
      spawn: { x: 0.5, z: 3.8 },
      npcSpots: [{ x: 0, z: -2.5, rotY: 0 }],
      colliders: c, bounds: { minX: -W / 2 + 0.7, maxX: W / 2 - 0.7, minZ: -D / 2 + 0.7, maxZ: D / 2 - 0.7 },
      sky: "#ffd9a0", fog: 40, label: "Shop"
    };
  },

  restaurant(group) {
    const W = 14, D = 12;
    floor(group, W, D, "#8f5a3c");
    const c = walls(group, W, D, "#f6ddb0");

    [[-3.5, -1.5], [1.0, -1.5], [-3.5, 2.2], [1.0, 2.2], [4.6, 0.4]].forEach(([x, z]) => {
      c.push(table(group, x, z, "#c9a06a", 1.4, 1.4, 0.74));
      c.push(chair(group, x, z + 1.05, Math.PI, "#a4503f"));
      c.push(chair(group, x, z - 1.05, 0, "#a4503f"));
      const vase = cyl(0.07, 0.09, 0.22, "#ffffff", x, 0.85, z, group, 10);
      vase.castShadow = false;
    });

    box(3.6, 1.05, 0.8, "#7a4a2c", -3.0, 0.52, -D / 2 + 0.9, group);
    box(3.7, 0.1, 0.9, "#c9a06a", -3.0, 1.08, -D / 2 + 0.9, group);
    c.push({ x: -3.0, z: -D / 2 + 0.9, w: 3.8, d: 1.1 });

    for (let i = 0; i < 3; i++) {
      const lamp = cyl(0.24, 0.1, 0.28, "#f2c14e", -3.5 + i * 3.5, 2.5, 0.2, group, 12);
      lamp.castShadow = false;
      cyl(0.01, 0.01, 0.7, "#3a3a44", -3.5 + i * 3.5, 2.95, 0.2, group, 4).castShadow = false;
    }

    c.push(plant(group, W / 2 - 1.0, -4.0, 1.3));
    c.push(plant(group, -W / 2 + 1.0, 4.0, 1.3));
    signBoard(group, "RESTAURANT", 0, 2.7, -D / 2 + 0.22, "#8a3b2a", 4.0);

    return {
      spawn: { x: 2.0, z: 4.5 },
      npcSpots: [{ x: -0.8, z: 0.4, rotY: Math.PI * 0.75 }],
      colliders: c, bounds: { minX: -W / 2 + 0.7, maxX: W / 2 - 0.7, minZ: -D / 2 + 0.7, maxZ: D / 2 - 0.7 },
      sky: "#ffcf9e", fog: 40, label: "Restaurant"
    };
  },

  hospital(group) {
    const W = 14, D = 12;
    floor(group, W, D, "#e4eef2");
    const c = walls(group, W, D, "#dff0f4");

    box(3.8, 1.05, 0.9, "#ffffff", -3.4, 0.52, -D / 2 + 1.0, group);
    box(3.9, 0.1, 1.0, "#9fd4e0", -3.4, 1.08, -D / 2 + 1.0, group);
    c.push({ x: -3.4, z: -D / 2 + 1.0, w: 4.0, d: 1.2 });

    c.push(ward(group, 3.5, -3.0));

    // On the back wall rather than the side one: its door - and the red cross
    // raised on it - faces the camera there instead of edge on.
    c.push(cabinet(group, -W / 2 + 0.9, -D / 2 + 0.6, 0));

    // red cross
    box(0.9, 0.28, 0.06, "#e03b3b", 0, 2.7, -D / 2 + 0.22, group, { castShadow: false });
    box(0.28, 0.9, 0.06, "#e03b3b", 0, 2.7, -D / 2 + 0.22, group, { castShadow: false });

    [[-2.0, 3.4], [-0.6, 3.4], [0.8, 3.4]].forEach(([x, z]) => c.push(chair(group, x, z, Math.PI, "#7fb4c4")));
    c.push(plant(group, W / 2 - 1.0, 3.8, 1.2, "plant1"));
    signBoard(group, "HOSPITAL", 4.0, 2.7, -D / 2 + 0.22, "#2f7d8a", 3.2);

    return {
      spawn: { x: 0, z: 4.6 },
      npcSpots: [{ x: 0.2, z: 0.6, rotY: Math.PI }],
      colliders: c, bounds: { minX: -W / 2 + 0.7, maxX: W / 2 - 0.7, minZ: -D / 2 + 0.7, maxZ: D / 2 - 0.7 },
      sky: "#d6f0f7", fog: 45, label: "Hospital"
    };
  },

  park(group) {
    const W = 22, D = 20;
    floor(group, W, D, "#5fb85f");
    const c = [];

    const path = new THREE.Mesh(new THREE.PlaneGeometry(3.2, D), M("#d8c9a8"));
    path.rotation.x = -Math.PI / 2; path.position.set(0, 0.01, 0); path.receiveShadow = true;
    group.add(path);

    const pond = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), M("#4aa8d8"));
    pond.rotation.x = -Math.PI / 2; pond.position.set(-6.0, 0.02, -3.0);
    group.add(pond);
    c.push(fountain(group, -6.0, -3.0));

    [[-8, 4], [-5.5, 7], [7, 5], [8.5, -2], [-9, -7], [5, -7.5], [9, 8]].forEach(([x, z]) =>
      c.push(tree(group, x, z, 0.9 + Math.random() * 0.5)));

    [[-3.2, 2.0, Math.PI / 2], [3.2, 2.0, -Math.PI / 2], [-3.2, -3.0, Math.PI / 2]].forEach(([x, z, r]) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = r;
      box(1.8, 0.1, 0.5, "#a4703c", 0, 0.45, 0, g);
      box(1.8, 0.5, 0.1, "#a4703c", 0, 0.72, -0.2, g);
      box(0.1, 0.45, 0.5, "#5a5a66", -0.8, 0.22, 0, g);
      box(0.1, 0.45, 0.5, "#5a5a66", 0.8, 0.22, 0, g);
      group.add(g);
      c.push({ x, z, w: 1.2, d: 1.2 });
    });

    for (let i = 0; i < 40; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), M(["#ff6fa5", "#f2c14e", "#a86ed6", "#ffffff"][i % 4]));
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 5;
      f.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
      group.add(f);
    }

    signBoard(group, "CITY PARK", 0, 2.2, -9.0, "#2f7d4a", 3.4);

    return {
      spawn: { x: 0, z: 6.0 },
      npcSpots: [{ x: 0.4, z: 1.4, rotY: Math.PI }],
      colliders: c, bounds: { minX: -W / 2 + 1, maxX: W / 2 - 1, minZ: -D / 2 + 1, maxZ: D / 2 - 1 },
      sky: "#87ceeb", fog: 60, label: "Park"
    };
  },

  city(group) {
    const W = 24, D = 22;
    floor(group, W, D, "#9a9aa4");
    const c = [];

    const road = new THREE.Mesh(new THREE.PlaneGeometry(7, D), M("#4a4a54"));
    road.rotation.x = -Math.PI / 2; road.position.y = 0.01; road.receiveShadow = true;
    group.add(road);
    for (let z = -10; z < 10; z += 2.4) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.2), M("#f2f2f2"));
      dash.rotation.x = -Math.PI / 2; dash.position.set(0, 0.02, z);
      group.add(dash);
    }
    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 6.6), M("#f2f2f2"));
      stripe.rotation.x = -Math.PI / 2; stripe.position.set(-2.6 + i * 1.05, 0.03, 4.5);
      group.add(stripe);
    }

    // Storey heights, not doll's-house heights: a 1.3-unit character next to a
    // 5-unit "building" made the whole street look like a toy.
    const COLORS = ["#c96b6b", "#6b8fc9", "#c9a76b", "#7fb894", "#a88fc9", "#c98fa8"];
    [[-9, -7, 5, 6], [-9.5, 0, 4.5, 7], [-9, 7.5, 5, 5], [9, -7.5, 5, 8], [9.5, 0.5, 4.5, 6], [9, 8, 5, 5]]
      .forEach(([x, z, w, h], i) => {
        box(w, h, w, COLORS[i % COLORS.length], x, h / 2, z, group);
        for (let fy = 1; fy < h - 0.5; fy += 1.6) {
          for (let fx = -1; fx <= 1; fx++) {
            box(0.7, 0.8, 0.06, "#ffe9a8", x + fx * 1.4, fy, z + w / 2 + 0.03, group, { castShadow: false });
          }
        }
        c.push({ x, z, w: w + 0.2, d: w + 0.2 });
      });

    // bus stop
    box(3.0, 0.12, 1.4, "#5a5a66", 5.2, 2.4, -2.0, group);
    cyl(0.08, 0.08, 2.4, "#5a5a66", 4.0, 1.2, -2.0, group, 8);
    cyl(0.08, 0.08, 2.4, "#5a5a66", 6.4, 1.2, -2.0, group, 8);
    box(2.4, 0.1, 0.4, "#a4703c", 5.2, 0.5, -2.4, group);
    c.push({ x: 5.2, z: -2.0, w: 3.2, d: 1.6 });

    [-6, 0, 6].forEach((z) => {
      cyl(0.09, 0.11, 3.4, "#3a3a44", -4.4, 1.7, z, group, 8);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), M("#ffe9a8"));
      lamp.position.set(-4.4, 3.5, z);
      group.add(lamp);
      c.push({ x: -4.4, z, w: 0.4, d: 0.4 });
    });

    [[-6.5, -3, 1], [6.8, 4, 1.1]].forEach(([x, z, s]) => c.push(tree(group, x, z, s)));
    signBoard(group, "MAIN STREET", 0, 3.2, -9.5, "#2f4858", 4.0);

    return {
      spawn: { x: -1.5, z: 7.0 },
      npcSpots: [{ x: -1.2, z: 1.2, rotY: Math.PI }],
      colliders: c, bounds: { minX: -W / 2 + 1, maxX: W / 2 - 1, minZ: -D / 2 + 1, maxZ: D / 2 - 1 },
      sky: "#a8c8e8", fog: 70, label: "City"
    };
  },

  transport(group) {
    const W = 22, D = 18;
    floor(group, W, D, "#8e8e98");
    const c = [];

    const road = new THREE.Mesh(new THREE.PlaneGeometry(W, 8), M("#454550"));
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, -3.5); road.receiveShadow = true;
    group.add(road);
    for (let x = -10; x < 10; x += 2.6) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.2), M("#f2f2f2"));
      dash.rotation.x = -Math.PI / 2; dash.position.set(x, 0.02, -3.5);
      group.add(dash);
    }
    // kerb
    box(W, 0.22, 0.4, "#c8c8d0", 0, 0.11, 0.55, group, { castShadow: false });

    c.push(busVehicle(group, -3.5, -4.2));

    // Set to the right of the talking spot, not behind it. The camera looks
    // down from +Z, so a shelter directly behind the NPC puts its ROOF across
    // the sight line - clear glass does not help, the roof is opaque and has to
    // be. Standing it aside keeps the conversation in the open.
    // Its back glass is at the model's local -Z, so a half turn faces the open
    // front towards the road.
    c.push(busShelter(group, 7.0, 2.6, Math.PI));

    signBoard(group, "BUS STOP", 7.0, 3.1, 2.4, "#2f6fc4", 2.6);

    [-8, 8].forEach((x) => {
      cyl(0.1, 0.12, 3.4, "#3a3a44", x, 1.7, 5.6, group, 8);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), M("#ffe9a8"));
      lamp.position.set(x, 3.5, 5.6);
      group.add(lamp);
      c.push({ x, z: 5.6, w: 0.4, d: 0.4 });
    });
    c.push(tree(group, -8.5, 2.5, 1.0));
    c.push(tree(group, 9.0, 1.5, 0.9));

    return {
      spawn: { x: 2.0, z: 6.4 },
      npcSpots: [{ x: 3.0, z: 1.6, rotY: Math.PI }],
      colliders: c, bounds: { minX: -W / 2 + 1, maxX: W / 2 - 1, minZ: -1.2, maxZ: D / 2 - 1 },
      sky: "#9ec9ec", fog: 60, label: "Bus Stop"
    };
  },

  workplace(group) {
    const W = 15, D = 13;
    floor(group, W, D, "#6e7683");
    const c = walls(group, W, D, "#dfe6ee");

    // glass partition
    for (let i = 0; i < 4; i++) {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.08),
        new THREE.MeshLambertMaterial({ color: new THREE.Color("#bfe4ff"), transparent: true, opacity: 0.35 }));
      glass.position.set(-5.6 + i * 1.7, 1.2, -1.0);
      group.add(glass);
    }
    c.push({ x: -3.9, z: -1.0, w: 6.8, d: 0.4 });

    // desk pods
    [[2.4, -3.0], [5.4, -3.0], [2.4, 0.6], [5.4, 0.6]].forEach(([x, z]) => {
      c.push(table(group, x, z, "#c9c9d2", 1.7, 0.85, 0.74));
      const mon = box(0.9, 0.55, 0.06, "#22252b", x, 1.06, z - 0.22, group);
      mon.rotation.x = -0.12;
      box(0.24, 0.05, 0.16, "#5a5a66", x, 0.79, z - 0.22, group);
      box(0.6, 0.03, 0.22, "#e2e8f0", x, 0.78, z + 0.14, group, { castShadow: false });
      c.push(chair(group, x, z + 0.95, Math.PI, "#3a4657"));
    });

    // meeting table
    c.push(table(group, -3.6, 2.6, "#a4703c", 2.8, 1.4, 0.74));
    [[-4.6, 1.5, 0], [-2.6, 1.5, 0], [-4.6, 3.7, Math.PI], [-2.6, 3.7, Math.PI]]
      .forEach(([x, z, r]) => c.push(chair(group, x, z, r, "#3a4657")));

    // reception counter
    box(3.2, 1.05, 0.8, "#4a5568", -5.0, 0.52, -4.6, group);
    box(3.3, 0.1, 0.9, "#cbd5e1", -5.0, 1.08, -4.6, group);
    c.push({ x: -5.0, z: -4.6, w: 3.4, d: 1.0 });

    c.push(plant(group, W / 2 - 1.0, -4.4, 1.3));
    c.push(plant(group, W / 2 - 1.0, 4.4, 1.2));
    c.push(shelf(group, -W / 2 + 0.7, 0.5, Math.PI / 2, 2.4));

    signBoard(group, "OFFICE", -5.0, 2.2, -D / 2 + 0.22, "#2f4858", 2.8);

    return {
      spawn: { x: 0.5, z: 4.8 },
      npcSpots: [{ x: 0.2, z: 1.4, rotY: Math.PI }],
      colliders: c, bounds: { minX: -W / 2 + 0.7, maxX: W / 2 - 0.7, minZ: -D / 2 + 0.7, maxZ: D / 2 - 0.7 },
      sky: "#cfe0f0", fog: 45, label: "Workplace"
    };
  }
};

export const LOCATION_IDS = Object.keys(BUILDERS);

/** `art` points at the client's location artwork, used by the travel menu. */
export const LOCATION_META = {
  home:       { label: "Home",       icon: "\u{1F3E0}", blurb: "Family and daily routine", art: "locations/home_locations.png" },
  school:     { label: "School",     icon: "\u{1F3EB}", blurb: "Greetings, classroom talk", art: "locations/school_location_2.png" },
  shop:       { label: "Shop",       icon: "\u{1F6D2}", blurb: "Buying and prices",         art: "locations/shop_location_3.png" },
  restaurant: { label: "Restaurant", icon: "\u{1F37D}", blurb: "Ordering food",             art: "locations/restaurant_location_4.png" },
  hospital:   { label: "Hospital",   icon: "\u{1F3E5}", blurb: "Health and help",           art: "locations/hospital_location_5.png" },
  park:       { label: "Park",       icon: "\u{1F333}", blurb: "Making friends",            art: "locations/park_location_6.png" },
  transport:  { label: "Bus Stop",   icon: "\u{1F68C}", blurb: "Travel and tickets",        art: "locations/bus_transport_location_7.png" },
  city:       { label: "City",       icon: "\u{1F3D9}", blurb: "Directions and travel",     art: "locations/city_location_8.png" },
  workplace:  { label: "Workplace",  icon: "\u{1F3E2}", blurb: "Office and interviews",     art: "locations/workplace_location_9.png" }
};

/** @param {ModelLibrary} [modelLibrary] enables the .glb props; omit for primitives only. */
export function buildLocation(id, modelLibrary = null) {
  const builder = BUILDERS[id] || BUILDERS.school;
  const group = new THREE.Group();
  props = modelLibrary;
  try {
    const info = builder(group);
    return Object.assign({ id, group }, info);
  } finally {
    props = null;
  }
}

export function disposeLocation(location) {
  releaseTree(location.group);
}

/**
 * Free a subtree's GPU resources.
 *
 * Object3D.traverse() cannot be pruned, so this recurses by hand: a node marked
 * `userData.shared` is a ModelLibrary instance whose geometry and textures are
 * shared with every other copy of that prop, and disposing it here would blank
 * out the model everywhere else. Those are freed once, by ModelLibrary.
 */
function releaseTree(node) {
  if (node.userData && node.userData.shared) return;
  node.children.forEach(releaseTree);
  if (node.geometry) node.geometry.dispose();
  if (node.material) {
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  }
}
