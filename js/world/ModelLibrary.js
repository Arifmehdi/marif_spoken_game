/**
 * ModelLibrary - loads the client's .glb characters and makes them usable.
 *
 * The supplied models are static meshes: no skeleton, no animation clips
 * (they were produced by trimesh, i.e. generated from the artwork). They are
 * also centred on the origin and about 2 units tall, so every one of them is
 * normalised on load:
 *
 *   - centred on X/Z
 *   - dropped so the feet sit exactly on y = 0
 *   - scaled to the height the game's camera and talk-range expect
 *
 * Loading is lazy and cached: a 5 MB download only happens for a character
 * that is actually about to appear on screen.
 */
import * as THREE from "three";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { FBXLoader } from "../vendor/FBXLoader.js";
import { clone as cloneSkinned } from "../vendor/SkeletonUtils.js";

const BASE = "spoken_game/character/";
const PROPS = "spoken_game/props/optimized/";

/**
 * role/character id -> file + the height it should stand at, in metres.
 *
 * The student models are rigged FBX exports from Mixamo and carry a walk clip.
 * The teacher is still a static .glb, so she falls back to whole-body motion.
 * Format is chosen from the file extension, so replacing any of these with a
 * newer/animated export needs no code change.
 */
/*
 * `height` is the only knob for character size, in world units. For reference,
 * the procedural characters the world was originally built around measure
 * 1.21 (student) and 1.30 (teacher). The imported models read bulkier at the
 * same height - big heads, wider silhouette - so they sit a little under it.
 * Raise or lower these numbers alone to resize a character; nothing else
 * depends on them.
 */
export const MODELS = {
  // Four playable students, each rigged with idle / walk / run / talk clips.
  // Built by tools/build-character.html from the per-animation FBX exports,
  // then shrunk by `npm run optimize`.
  boy1:    { file: BASE + "optimized/boy_1.glb", height: 1.00 },
  boy2:    { file: BASE + "optimized/boy_2.glb", height: 1.00 },
  girl1:   { file: BASE + "optimized/girl_1.glb", height: 0.88 },
  girl2:   { file: BASE + "optimized/girl_2.glb", height: 0.88 },
  // NPCs. The two men are rigged with idle + talk clips; the two women are
  // static meshes and fall back to whole-body procedural motion.
  npcMan1:   { file: BASE + "optimized/npc_man_1.glb",   height: 1.34 },
  npcMan2:   { file: BASE + "optimized/npc_man_2.glb",   height: 1.34 },
  npcWoman1: { file: BASE + "optimized/npc_woman_1.glb", height: 1.30 },
  npcWoman2: { file: BASE + "optimized/npc_woman_2.glb", height: 1.30 },

  // Earlier exports, kept registered so nothing 404s if they are swapped back in.
  // Mixamo names every clip "mixamo.com", hence the singleClip hint on these.
  boyFbx:     { file: BASE + "main_character/dark/boy_2_t_walking.fbx", height: 1.30, singleClip: "walk" },
  girlFbx:    { file: BASE + "main_character/dark/girl_2_t_walking.fbx", height: 1.28, singleClip: "walk" },
  boyStatic:  { file: BASE + "main_character/only_3d/boy_2_with_texture.glb", height: 1.30 },
  girlStatic: { file: BASE + "main_character/only_3d/girl_1_with_texture.glb", height: 1.28 },

  // Scenery. Built by `npm run build:props` from the OBJ + TGA source, and
  // loaded through the same cache as the characters: one download, one copy of
  // the geometry and texture in memory, however many are placed in the world.
  plant1:    { file: PROPS + "plant_1.glb",  height: 0.85 },
  // 1.95 m in the real world; a student model stands 1.00, representing a
  // child of about 1.2 m, so the shelf is a little over one and a half of them.
  bookshelf: { file: PROPS + "bookshelf.glb", height: 1.65 },
  // Converted from the client's fountain.fbx by tools/fbx-to-glb.html. It is
  // untextured - marble, water and a glow crystal, all flat colours - which is
  // exactly how the rest of this world is painted.
  fountain:  { file: PROPS + "fountain.glb",  height: 2.20 },
  // The delivered bus.obj had no .mtl and no UVs, so build-props paints it in
  // flat bands. 2.55 units tall against a 1.00 student - a real bus is about
  // two and a half times a child.
  bus:       { file: PROPS + "bus.glb",       height: 2.55 },
  // The shelter from the client's bus_stop.blend, minus the street scene it
  // was modelled in. 2.75 units to the top of the roof.
  busStop:   { file: PROPS + "bus_stop.glb",  height: 2.75 },
  // A two-bed ward, curtain rails and all. CC-BY: "Isometric Hospital Room" by
  // graphyTV (Blend Swap 89028) - the credit is in README.md and on the
  // settings screen, and the licence requires it.
  ward:      { file: PROPS + "hospital_ward.glb", height: 2.20 },
  cabinet:   { file: PROPS + "hospital_cabinet.glb", height: 1.70 },
  sofa:      { file: PROPS + "sofa.glb",      height: 0.95 }
};

/**
 * World-space bounds of a character model, used for both sizing and grounding.
 *
 * Prefers the POSED bounds (bone transforms applied), because a skinned mesh's
 * bind-pose geometry can be several times its rendered size. But some exports
 * report a collapsed posed box - one NPC measured 0.02 units tall, which scaled
 * it down to nothing - so a degenerate result falls back to the plain geometry.
 *
 * Shared by ModelLibrary and Character so sizing and grounding never disagree.
 */
export function measureModel(root) {
  root.updateWorldMatrix(true, true);
  const posed = new THREE.Box3();
  const plain = new THREE.Box3();
  let skinned = false;

  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) {
      skinned = true;
      if (o.skeleton) o.skeleton.update();
      o.computeBoundingBox();
      if (o.boundingBox && !o.boundingBox.isEmpty()) {
        posed.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
      }
    }
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.geometry.boundingBox) {
      plain.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });

  if (!skinned) return plain;

  const posedHeight = posed.isEmpty() ? 0 : posed.max.y - posed.min.y;
  const plainHeight = plain.isEmpty() ? 0 : plain.max.y - plain.min.y;

  // A posed box under a fifth of the geometry's height is not a pose, it is a
  // broken read - trust the geometry instead.
  if (posedHeight < plainHeight * 0.2) return plain;
  return posed;
}

export class ModelLibrary {
  /** @param {THREE.WebGLRenderer} [renderer] used only to read max anisotropy. */
  constructor(renderer) {
    this.maxAnisotropy = renderer && renderer.capabilities
      ? Math.min(8, renderer.capabilities.getMaxAnisotropy())
      : 4;
    this.gltf = new GLTFLoader();
    this.fbx = new FBXLoader();
    this.cache = new Map();     // key -> normalised THREE.Group
    this.pending = new Map();   // key -> Promise, so two requests share one download
    this.failed = new Set();
  }

  static has(key) {
    return !!MODELS[key];
  }

  /**
   * @returns {Promise<THREE.Group|null>} a fresh clone, or null if it could not
   *   be loaded. Null is not an error state - the caller falls back to the
   *   procedural character and the game carries on.
   */
  async get(key) {
    const def = MODELS[key];
    if (!def || this.failed.has(key)) return null;

    if (this.cache.has(key)) return this.instance(key);
    if (this.pending.has(key)) {
      await this.pending.get(key);
      return this.cache.has(key) ? this.instance(key) : null;
    }

    const job = this.load(key, def)
      .then((group) => { this.cache.set(key, group); })
      .catch((err) => {
        console.warn("Could not load model '" + key + "' (" + def.file + ")", err);
        this.failed.add(key);
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, job);
    await job;
    return this.cache.has(key) ? this.instance(key) : null;
  }

  /**
   * FBX and glTF hand back different shapes: GLTFLoader gives { scene,
   * animations }, FBXLoader gives an Object3D with `.animations` on it.
   * Both are reduced to one normalised group with clips in userData.
   */
  load(key, def) {
    const isFbx = /\.fbx$/i.test(def.file);
    const loader = isFbx ? this.fbx : this.gltf;

    return new Promise((resolve, reject) => {
      loader.load(def.file,
        (result) => {
          try {
            const scene = isFbx ? result : result.scene;
            const clips = (isFbx ? result.animations : result.animations) || [];
            const group = this.normalise(scene, def.height);
            // Animation clips are plain data and can be shared by every
            // instance; each instance gets its own mixer.
            group.userData.clips = clips;
            group.userData.singleClip = def.singleClip || null;
            group.userData.targetHeight = def.height;
            resolve(group);
          } catch (err) { reject(err); }
        },
        undefined,
        reject);
    });
  }

  /**
   * True on-screen bounds of a model.
   *
   * Box3.setFromObject() only looks at geometry in its BIND pose. A skinned
   * mesh is moved by its bones in the vertex shader, and a Mixamo rig carries a
   * large scale in the skeleton - so the rendered character can be ~3x the
   * geometry's bounding box. Scaling from that number makes characters that
   * measure correct in code and appear enormous on screen.
   *
   * SkinnedMesh.computeBoundingBox() applies the bone transforms, so it reports
   * what is actually drawn.
   */
  measureRendered(scene) {
    return measureModel(scene);
  }

  /**
   * Throw away anything a character export brought with it that belongs to the
   * scene, not the character.
   *
   * One delivered teacher carried a point light of intensity 1000. Adding that
   * model to the world lit the whole room from inside his chest. Cameras have
   * the same problem in reverse - harmless but pointless. A character model
   * should contribute geometry and nothing else.
   */
  stripSceneObjects(scene) {
    const doomed = [];
    scene.traverse((o) => { if (o.isLight || o.isCamera) doomed.push(o); });
    doomed.forEach((o) => {
      if (o.parent) o.parent.remove(o);
      if (o.dispose) o.dispose();
    });
    return doomed.length;
  }

  /** Centre on X/Z, feet on the floor, scaled to the game's character height. */
  normalise(scene, targetHeight) {
    const removed = this.stripSceneObjects(scene);
    if (removed) {
      console.info("ModelLibrary: removed " + removed +
        " light/camera object(s) baked into a character model");
    }

    const root = new THREE.Group();
    root.add(scene);

    const box = this.measureRendered(scene);
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);

    const scale = size.y > 0 ? targetHeight / size.y : 1;
    scene.scale.setScalar(scale);
    scene.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;   // self-shadowing a character is not worth the cost
      o.frustumCulled = true;

      // The Mixamo FBX exports arrive with NO normal attribute. Every lit
      // material then computes zero light and the character renders as a solid
      // black silhouette. Rebuild the normals so it can be lit at all.
      if (o.geometry && !o.geometry.attributes.normal) {
        o.geometry.computeVertexNormals();
      }

      if (!o.material) return;
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => this.convertMaterial(m))
        : this.convertMaterial(o.material);
    });

    return root;
  }

  /**
   * Imported models arrive as MeshPhongMaterial (FBX) or MeshStandardMaterial
   * (glTF). Both read noticeably darker than the rest of the world, which is
   * built from MeshLambertMaterial, because they expect an environment map for
   * ambient light and there isn't one. Converting to Lambert matches the scene,
   * brightens the characters, and is cheaper to shade.
   *
   * Anisotropy is the other half: the camera looks down at a steep angle, and
   * at the default anisotropy of 1 every texture smears into a blur.
   */
  convertMaterial(m) {
    const tune = (tex) => {
      if (!tex) return null;
      tex.anisotropy = this.maxAnisotropy;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    };

    if (m.map) {
      m.map.colorSpace = THREE.SRGBColorSpace;   // colour maps must be sRGB
      tune(m.map);
    }

    const lambert = new THREE.MeshLambertMaterial({
      map: m.map || null,
      normalMap: tune(m.normalMap) || null,
      color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
      transparent: !!m.transparent,
      opacity: m.opacity != null ? m.opacity : 1,
      alphaTest: m.alphaTest || 0,
      side: m.side,
      vertexColors: !!m.vertexColors
    });
    lambert.name = m.name;

    m.dispose();          // frees the material only - textures are reused above
    return lambert;
  }

  instance(key) {
    const source = this.cache.get(key);
    if (!source) return null;

    // A plain Object3D.clone() does NOT rebind a skeleton: every copy would be
    // driven by the first one's bones. Rigged models must go through
    // SkeletonUtils.clone(). Geometry and textures are still shared either way.
    let skinned = false;
    source.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });

    const copy = skinned ? cloneSkinned(source) : source.clone(true);
    copy.userData.clips = source.userData.clips || [];
    copy.userData.singleClip = source.userData.singleClip || null;
    copy.userData.targetHeight = source.userData.targetHeight || null;
    return copy;
  }

  /** Warm the cache without blocking - used to hide the download behind a menu. */
  prefetch(keys) {
    keys.filter((k) => MODELS[k]).forEach((k) => { this.get(k); });
  }

  dispose() {
    this.cache.forEach((group) => {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
    });
    this.cache.clear();
  }
}
