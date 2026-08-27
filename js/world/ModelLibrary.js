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
  // Rigged, with named Walk and Run clips - the alias matcher binds them
  // automatically, so no singleClip hint is needed here.
  boy:     { file: BASE + "main_character/final_boy.glb", height: 1.00 },
  girl:    { file: BASE + "main_character/final_girl_.glb", height: 0.98 },
  teacher: { file: BASE + "teacher_or_other_character/Teacher_lady_2_with_texture.glb", height: 1.30 },

  // Earlier exports, kept registered so nothing 404s if they are swapped back in.
  // Mixamo names every clip "mixamo.com", hence the singleClip hint on these.
  boyFbx:     { file: BASE + "main_character/dark/boy_2_t_walking.fbx", height: 1.30, singleClip: "walk" },
  girlFbx:    { file: BASE + "main_character/dark/girl_2_t_walking.fbx", height: 1.28, singleClip: "walk" },
  boyStatic:  { file: BASE + "main_character/only_3d/boy_2_with_texture.glb", height: 1.30 },
  girlStatic: { file: BASE + "main_character/only_3d/girl_1_with_texture.glb", height: 1.28 }
};

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
    scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    let skinned = false;

    scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      skinned = true;
      if (o.skeleton) o.skeleton.update();
      o.computeBoundingBox();
      box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });

    if (!skinned) box.setFromObject(scene);
    return box;
  }

  /** Centre on X/Z, feet on the floor, scaled to the game's character height. */
  normalise(scene, targetHeight) {
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
      o.receiveShadow = false;   // self-shadowing on a 80k-tri mesh is not worth it
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
