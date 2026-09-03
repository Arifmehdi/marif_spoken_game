/**
 * CharacterFactory - builds chunky cartoon characters out of primitives.
 *
 * Everything is procedural so the game runs with no downloaded art at all.
 * When real models arrive, keep the same part names (head, armL, legR, ...)
 * and Character.update() will animate a GLTF rig without changes elsewhere.
 */
import * as THREE from "three";
import { measureModel } from "./ModelLibrary.js";

const SKINS = ["#f3c9a0", "#e0a878", "#c68642", "#8d5524", "#ffdbac"];

export const ROLE_STYLES = {
  student:    { skin: 1, hair: "#1b1b1f", top: "#ffffff", bottom: "#2f4f8f", accent: "#3b82f6", accessory: "backpack", height: 1.0 },
  teacher:    { skin: 0, hair: "#2b2118", top: "#1e3a5f", bottom: "#33333d", accent: "#8b5cf6", accessory: "glasses", height: 1.08 },
  friend:     { skin: 1, hair: "#3a2418", top: "#ff6fa5", bottom: "#4a6fa5", accent: "#f472b6", accessory: "hairband", height: 0.98 },
  shopkeeper: { skin: 2, hair: "#241a12", top: "#8a5a2b", bottom: "#4a3728", accent: "#f59e0b", accessory: "moustache", height: 1.06 },
  waiter:     { skin: 1, hair: "#1b1b1f", top: "#ffffff", bottom: "#22252b", accent: "#ef4444", accessory: "apron", height: 1.05 },
  police:     { skin: 2, hair: "#1b1b1f", top: "#2f4858", bottom: "#22303c", accent: "#fbbf24", accessory: "cap", height: 1.1 },
  mother:     { skin: 1, hair: "#241a12", top: "#0f9d76", bottom: "#0b7a5c", accent: "#34d399", accessory: "bindi", height: 1.02 },
  doctor:     { skin: 0, hair: "#2b2118", top: "#ffffff", bottom: "#5b6472", accent: "#06b6d4", accessory: "stethoscope", height: 1.04 },
  default:    { skin: 1, hair: "#2b2118", top: "#9ca3af", bottom: "#4b5563", accent: "#6b7280", accessory: null, height: 1.0 }
};

const mat = (color, opts = {}) => new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(color) }, opts));

/**
 * Animation clip names to look for in a .glb, per game state. Matching is a
 * loose substring test because every exporter names clips differently.
 * Give the artist these words and the clips bind with no code change.
 */
/**
 * Extra cadence on top of matching the ground speed.
 *
 * Kept close to 1 on purpose. The walk clip already runs at a natural 2.1 steps
 * a second; the rate that would cancel the skating outright is about 5x, which
 * is 10 steps a second - a child vibrating. Removing the slide is not on the
 * table at this movement speed, so the cadence stays believable and the real
 * gain comes from it TRACKING the stick instead of being fixed.
 *
 * Turn this up for busier legs, down for a glidier walk.
 */
const STRIDE_BOOST = 1.15;

const CLIP_ALIASES = {
  idle:   ["idle", "stand", "breath"],
  walk:   ["walk"],
  run:    ["run", "jog", "sprint"],
  talk:   ["talk", "speak", "speech"],
  listen: ["listen", "attention", "nod"],
  wave:   ["wave", "greet", "hello", "cheer", "clap"],
  think:  ["think", "thought", "ponder", "confused"]
};

export class Character {
  constructor(role = "default", options = {}) {
    this.role = role;
    this.style = Object.assign({}, ROLE_STYLES[role] || ROLE_STYLES.default, options.style || {});
    this.group = new THREE.Group();
    this.parts = {};
    this.state = "idle";
    this.clock = Math.random() * 10;   // desync identical NPCs
    this.build();
  }

  build() {
    const s = this.style;
    const skin = mat(SKINS[s.skin] || SKINS[1]);
    const top = mat(s.top);
    const bottom = mat(s.bottom);
    const hair = mat(s.hair);
    const shoe = mat("#2c2c34");
    const h = s.height;

    const root = new THREE.Group();
    root.scale.setScalar(h);
    this.group.add(root);
    this.parts.root = root;

    // --- legs
    const legGeo = new THREE.CapsuleGeometry(0.085, 0.32, 4, 8);
    ["L", "R"].forEach((side, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(i === 0 ? -0.1 : 0.1, 0.5, 0);
      const leg = new THREE.Mesh(legGeo, bottom);
      leg.position.y = -0.2;
      leg.castShadow = true;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.21), shoe);
      foot.position.set(0, -0.4, 0.04);
      foot.castShadow = true;
      pivot.add(leg, foot);
      root.add(pivot);
      this.parts["leg" + side] = pivot;
    });

    // --- torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.26, 4, 10), top);
    torso.position.y = 0.76;
    torso.castShadow = true;
    root.add(torso);
    this.parts.torso = torso;

    // --- arms
    const armGeo = new THREE.CapsuleGeometry(0.062, 0.28, 4, 8);
    ["L", "R"].forEach((side, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(i === 0 ? -0.23 : 0.23, 0.92, 0);
      const arm = new THREE.Mesh(armGeo, top);
      arm.position.y = -0.17;
      arm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 8), skin);
      hand.position.y = -0.34;
      pivot.add(arm, hand);
      root.add(pivot);
      this.parts["arm" + side] = pivot;
    });

    // --- head
    const head = new THREE.Group();
    head.position.y = 1.06;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 14), skin);
    skull.scale.set(1, 1.08, 0.95);
    skull.castShadow = true;
    head.add(skull);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.183, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    cap.position.y = 0.018;
    head.add(cap);

    const eyeGeo = new THREE.SphereGeometry(0.032, 10, 10);
    const white = mat("#ffffff");
    const pupil = mat("#1b1b22");
    [-0.062, 0.062].forEach((x) => {
      const e = new THREE.Mesh(eyeGeo, white);
      e.position.set(x, 0.02, 0.152);
      e.scale.set(1, 1.15, 0.5);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 8), pupil);
      p.position.set(x, 0.02, 0.175);
      head.add(e, p);
    });

    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.02), mat("#a4443f"));
    mouth.position.set(0, -0.072, 0.168);
    head.add(mouth);
    this.parts.mouth = mouth;

    root.add(head);
    this.parts.head = head;

    this.addAccessory(head, root, skin);

    this.group.userData.character = this;
  }

  addAccessory(head, root, skin) {
    const s = this.style;
    switch (s.accessory) {
      case "glasses": {
        const frame = mat("#22252b");
        [-0.062, 0.062].forEach((x) => {
          const lens = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 14), frame);
          lens.position.set(x, 0.02, 0.155);
          head.add(lens);
        });
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.008), frame);
        bridge.position.set(0, 0.02, 0.158);
        head.add(bridge);
        break;
      }
      case "backpack": {
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.14), mat(s.accent));
        bag.position.set(0, 0.78, -0.19);
        bag.castShadow = true;
        root.add(bag);
        break;
      }
      case "hairband": {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.022, 8, 20), mat(s.accent));
        band.position.set(0, 0.09, 0);
        band.rotation.x = Math.PI / 2.3;
        head.add(band);
        break;
      }
      case "moustache": {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.026, 0.03), mat(s.hair));
        m.position.set(0, -0.045, 0.166);
        head.add(m);
        break;
      }
      case "apron": {
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.06), mat(s.accent));
        a.position.set(0, 0.7, 0.17);
        root.add(a);
        break;
      }
      case "cap": {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.075, 16), mat(s.top));
        c.position.set(0, 0.14, 0);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.16), mat(s.top));
        brim.position.set(0, 0.11, 0.14);
        const badge = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), mat(s.accent));
        badge.position.set(0, 0.155, 0.172);
        head.add(c, brim, badge);
        break;
      }
      case "bindi": {
        const b = new THREE.Mesh(new THREE.CircleGeometry(0.017, 10), mat("#c0392b"));
        b.position.set(0, 0.075, 0.166);
        head.add(b);
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), mat(s.hair));
        bun.position.set(0, 0.03, -0.16);
        head.add(bun);
        break;
      }
      case "stethoscope": {
        const tube = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 6, 18, Math.PI), mat("#334155"));
        tube.position.set(0, 0.94, 0.13);
        tube.rotation.x = Math.PI;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.018, 12), mat("#94a3b8"));
        disc.position.set(0.08, 0.84, 0.16);
        root.add(tube, disc);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Swap the primitive body for one of the client's .glb models.
   *
   * Those models have no skeleton, so nothing can be posed limb by limb. The
   * whole body is animated instead - bob, sway, lean, nod - which reads
   * surprisingly well on chunky cartoon characters and costs nothing.
   */
  /**
   * A .glb is on its way. Hide the primitive body immediately so the player
   * never sees the placeholder appear and then pop out a moment later.
   */
  expectModel() {
    this.awaitingModel = true;
    if (this.parts.root) this.parts.root.visible = false;
  }

  /** The download failed. Show the placeholder rather than an invisible NPC. */
  cancelExpectedModel() {
    if (!this.awaitingModel) return;
    this.awaitingModel = false;
    if (this.parts.root && !this.isModel) this.parts.root.visible = true;
  }

  useModel(modelGroup) {
    if (!modelGroup) return false;
    this.isModel = true;
    this.awaitingModel = false;
    this.model = modelGroup;
    if (this.parts.root) this.parts.root.visible = false;
    this.group.add(modelGroup);

    // If the model arrived with a rig and clips, drive it properly. If not
    // (the current models are static meshes), fall back to whole-body motion.
    const clips = modelGroup.userData.clips || [];
    if (clips.length) this.setupClips(clips);
    this.fitModelHeight();

    // Fit once more after the mixer has actually been running in the real loop.
    // Measuring a skinned mesh the instant it is attached does not always match
    // what it settles to a few frames later, and being wrong here shows up as a
    // character of the wrong size or floating off the floor. The fit converges
    // on the target, so repeating it is safe and costs a few milliseconds once.
    this.refitFrames = 4;
    return true;
  }

  /**
   * Final size correction, applied once the animation pose is in place.
   *
   * A skinned character's height depends on its pose, and the pose at load time
   * is not the pose it is drawn in. Measuring once during loading therefore gets
   * it wrong in both directions. This measures the real thing - bones applied,
   * first animation frame evaluated - and rescales to the requested height,
   * then puts the feet back on the floor.
   */
  fitModelHeight() {
    const target = this.model && this.model.userData.targetHeight;
    if (!target) return;

    // Settle into the real animated pose before measuring. Mixamo clips drive
    // the hips with a position track, so the animated body can sit a long way
    // off the bind pose - measuring the bind pose left the character floating
    // more than a body-height above the floor.
    if (this.mixer) {
      if (this.activeAction) {
        this.activeAction.setEffectiveWeight(1);
        this.activeAction.paused = false;
        this.activeAction.time = 0;
      }
      this.mixer.update(0.001);
    }

    const measure = () => measureModel(this.model);

    // In these exports the bones are children of the mesh, so the group's scale
    // reaches the vertices twice - through bone.matrixWorld AND through the
    // mesh's own matrix - and height grows with the SQUARE of the scale. Other
    // models are linear. Rather than assume either, converge on the target:
    // the square-root step lands the quadratic case in one go and the linear
    // case in a handful, and the loop stops as soon as it is within 0.5%.
    for (let i = 0; i < 10; i++) {
      const box = measure();
      const h = box.max.y - box.min.y;
      if (h <= 0.001) break;
      if (Math.abs(h - target) / target < 0.005) break;
      this.model.scale.multiplyScalar(Math.sqrt(target / h));
    }

    // Drop the model onto the ground plane.
    //
    // Same trap as the scale above: because the bones sit under the mesh, a
    // change to the model's transform reaches the vertices twice, so moving the
    // body down by X shifts the measured feet by roughly 2X. A single
    // subtraction overshoots and leaves the character floating or sunk, so
    // step toward zero with damping until the feet are on the floor.
    for (let i = 0; i < 15; i++) {
      const box = measure();
      if (Math.abs(box.min.y) < 0.005) break;
      this.model.position.y -= box.min.y * 0.5;
    }

    // Every frame resets position.y, so remember where the floor is.
    this.groundOffsetY = this.model.position.y;
  }

  setupClips(clips) {
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this.activeAction = null;

    // Exporters name clips inconsistently ("Walk", "walking", "Armature|Run",
    // and Mixamo's infamous "mixamo.com"), so match loosely on aliases.
    Object.entries(CLIP_ALIASES).forEach(([state, aliases]) => {
      const clip = clips.find((c) => {
        const name = String(c.name || "").toLowerCase();
        return aliases.some((a) => name.includes(a));
      });
      if (clip) this.actions[state] = this.mixer.clipAction(clip);
    });

    // One clip with an exporter-generated name: the model definition says what
    // it actually is (Mixamo calls every export "mixamo.com").
    if (!Object.keys(this.actions).length && clips.length === 1) {
      const state = this.model.userData.singleClip || "idle";
      this.actions[state] = this.mixer.clipAction(clips[0]);
    }
    this.playClip(this.state);
  }

  /** @returns {boolean} true if a real clip is driving this state */
  playClip(state) {
    if (!this.mixer) return false;
    const next = this.actions[state] || this.actions.idle;

    if (!next) {
      // No clip for this state. Releasing the skeleton would snap the character
      // into its bind T-pose, so hold a pose instead - the first frame of the
      // walk if there is one, which is far more neutral than freezing mid-run.
      const rest = this.actions.walk || this.activeAction;
      if (rest) {
        if (rest !== this.activeAction) {
          rest.reset().setEffectiveWeight(1).play();
          if (this.activeAction) this.activeAction.stop();
          this.activeAction = rest;
        }
        rest.time = 0;
        rest.paused = true;
      }
      return false;   // caller layers procedural breathing on top
    }

    if (next === this.activeAction) {
      next.paused = false;
      return true;
    }

    if (this.activeAction) {
      // Deliberately NOT reset(). reset() rewinds to frame 0, so every time the
      // player stopped and set off again the walk restarted from its first
      // frame - the foot snapping back mid-stride is what reads as "not
      // smooth". These cycles loop, so picking up where the clock already is
      // looks continuous.
      //
      // Walk and run keep separate clocks, and crossfading them out of phase
      // slides the feet. Matching the normalised time first lines the strides
      // up so one hands over to the other.
      const loco = (a) => a === this.actions.walk || a === this.actions.run;
      if (loco(next) && loco(this.activeAction)) {
        const fromLength = this.activeAction.getClip().duration || 1;
        const toLength = next.getClip().duration || 1;
        next.time = (this.activeAction.time / fromLength) * toLength;
      }

      next.enabled = true;
      if (!next.isRunning()) next.play();
      next.fadeIn(0.22);
      this.activeAction.fadeOut(0.22);
    } else {
      // First clip: snap to full weight. Fading in from nothing means fading in
      // from the bind pose, which both looks wrong and makes the very first
      // height measurement read the T-pose instead of the animation.
      next.reset().setEffectiveWeight(1).play();
    }
    next.paused = false;
    this.activeAction = next;
    return true;
  }

  /** @param {"idle"|"walk"|"run"|"talk"|"listen"|"wave"|"think"} state */
  setState(state) {
    if (this.state !== state) this.state = state;
  }

  /**
   * How fast the legs should cycle, as a fraction of the clip's normal rate.
   *
   * The clips are in-place Mixamo cycles authored for a full-size adult, and the
   * students stand about 1.0 unit tall. Played at their own rate the planted
   * foot travels 0.67 units per second while the body crosses the floor at 3.4
   * - the feet skate, which is what reads as the walk not being smooth.
   *
   * Tying the cadence to the real ground speed fixes the worse half of it: the
   * legs now speed up and slow down WITH the character, so a half-pushed stick
   * ambles instead of sprinting on the spot. STRIDE_BOOST closes part of the
   * remaining gap - not all of it, because a rate that removed the slide
   * completely would have a child taking five steps a second.
   */
  setStride(rate) {
    this.stride = Math.min(2.4, Math.max(0.35, rate * STRIDE_BOOST));
  }

  /** Whole-body motion for rig-less models; real clips take over when present. */
  updateModel(dt) {
    if (this.refitFrames > 0) {
      this.refitFrames--;
      if (this.refitFrames === 0) this.fitModelHeight();
    }

    if (this.mixer) {
      // Cadence is re-applied every frame: a crossfade can hand over to a clip
      // that was last used at a different speed.
      const rate = this.stride || 1;
      if (this.actions.walk) this.actions.walk.setEffectiveTimeScale(rate);
      if (this.actions.run) this.actions.run.setEffectiveTimeScale(rate);
      this.mixer.update(dt);
      // A rigged clip animates the body itself - adding a body-wide bob on top
      // would double up and look wrong.
      if (this.playClip(this.state)) {
        // Return to the GROUNDED height, not to zero: fitModelHeight offsets the
        // model so the feet land on the floor, and zeroing it here would leave
        // the character hovering by however much that offset was.
        this.model.position.y = this.groundOffsetY || 0;
        this.model.rotation.x = 0;
        this.model.rotation.z = 0;
        return;
      }
    }

    const t = this.clock;
    const m = this.model;
    let y = 0, tiltX = 0, tiltZ = 0;

    switch (this.state) {
      case "walk":
        y = Math.abs(Math.sin(t * 8)) * 0.045;
        tiltZ = Math.sin(t * 8) * 0.045;
        tiltX = 0.05;
        break;
      case "run":
        y = Math.abs(Math.sin(t * 12)) * 0.075;
        tiltZ = Math.sin(t * 12) * 0.07;
        tiltX = 0.12;
        break;
      case "talk":
        y = Math.sin(t * 3) * 0.008;
        tiltX = Math.sin(t * 5) * 0.05;      // nodding while speaking
        tiltZ = Math.sin(t * 2.3) * 0.03;
        break;
      case "listen":
        y = Math.sin(t * 1.5) * 0.006;
        tiltX = 0.07;                        // leaning in
        tiltZ = Math.sin(t * 1.2) * 0.02;
        break;
      case "wave":
        y = Math.abs(Math.sin(t * 6)) * 0.06; // a happy hop - no arm to raise
        tiltZ = Math.sin(t * 6) * 0.05;
        break;
      case "think":
        tiltZ = Math.sin(t * 1.1) * 0.09;
        tiltX = -0.05;
        break;
      default:
        y = Math.sin(t * 1.8) * 0.012;       // breathing
        tiltZ = Math.sin(t * 1.1) * 0.012;
        break;
    }

    m.position.y = (this.groundOffsetY || 0) + y;
    m.rotation.x = tiltX;
    m.rotation.z = tiltZ;
  }

  update(dt) {
    this.clock += dt;
    if (this.isModel) return this.updateModel(dt);

    const t = this.clock;
    const p = this.parts;
    const set = (part, x) => { if (p[part]) p[part].rotation.x = x; };

    switch (this.state) {
      case "walk":
      case "run": {
        const speed = this.state === "run" ? 13 : 8;
        const amp = this.state === "run" ? 0.85 : 0.55;
        const s = Math.sin(t * speed);
        set("legL", s * amp);
        set("legR", -s * amp);
        set("armL", -s * amp * 0.8);
        set("armR", s * amp * 0.8);
        p.torso.position.y = 0.76 + Math.abs(s) * 0.02;
        p.head.rotation.z = 0;
        break;
      }
      case "talk": {
        set("legL", 0); set("legR", 0);
        p.head.rotation.x = Math.sin(t * 5) * 0.07;
        p.head.rotation.z = Math.sin(t * 2.3) * 0.04;
        set("armR", Math.sin(t * 4) * 0.35 - 0.2);
        set("armL", Math.sin(t * 3.1) * 0.12);
        // simple lip-flap
        if (p.mouth) p.mouth.scale.y = 1 + Math.abs(Math.sin(t * 11)) * 2.2;
        break;
      }
      case "listen": {
        set("legL", 0); set("legR", 0);
        p.head.rotation.x = 0.07 + Math.sin(t * 1.4) * 0.02;
        p.head.rotation.z = 0.1;
        set("armL", 0.05); set("armR", 0.05);
        if (p.mouth) p.mouth.scale.y = 1;
        break;
      }
      case "wave": {
        set("legL", 0); set("legR", 0);
        if (p.armR) {
          p.armR.rotation.z = -2.1;
          p.armR.rotation.x = Math.sin(t * 8) * 0.4;
        }
        p.head.rotation.z = Math.sin(t * 2) * 0.06;
        break;
      }
      case "think": {
        set("legL", 0); set("legR", 0);
        if (p.armR) { p.armR.rotation.z = -1.5; p.armR.rotation.x = -0.9; }
        p.head.rotation.x = -0.12;
        p.head.rotation.z = Math.sin(t * 1.1) * 0.12;
        break;
      }
      default: {
        const b = Math.sin(t * 1.8);
        set("legL", 0); set("legR", 0);
        set("armL", b * 0.05); set("armR", -b * 0.05);
        p.torso.position.y = 0.76 + b * 0.012;
        p.head.rotation.x = b * 0.03;
        p.head.rotation.z = 0;
        if (p.armR) p.armR.rotation.z = 0;
        if (p.mouth) p.mouth.scale.y = 1;
        break;
      }
    }
  }

  get position() { return this.group.position; }

  lookAt(target) {
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    this.group.rotation.y = Math.atan2(dx, dz);
  }

  dispose() {
    // The .glb model is a clone that SHARES geometry and textures with the
    // cached original. Disposing those would blank out every other instance,
    // so detach it and let ModelLibrary own its lifetime.
    if (this.model) {
      this.group.remove(this.model);
      this.model = null;
      this.isModel = false;
    }
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}

export function createCharacter(role, options) {
  return new Character(role, options);
}
