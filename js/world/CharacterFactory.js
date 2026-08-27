/**
 * CharacterFactory - builds chunky cartoon characters out of primitives.
 *
 * Everything is procedural so the game runs with no downloaded art at all.
 * When real models arrive, keep the same part names (head, armL, legR, ...)
 * and Character.update() will animate a GLTF rig without changes elsewhere.
 */
import * as THREE from "three";

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

  /** @param {"idle"|"walk"|"run"|"talk"|"listen"|"wave"|"think"} state */
  setState(state) {
    if (this.state !== state) this.state = state;
  }

  update(dt) {
    this.clock += dt;
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
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}

export function createCharacter(role, options) {
  return new Character(role, options);
}
