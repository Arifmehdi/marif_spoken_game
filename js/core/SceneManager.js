/**
 * SceneManager - renderer, lights, and the follow camera.
 *
 * The camera sits behind and above the student at a fixed yaw (the isometric
 * look from the concept art) and eases toward its target, so movement reads
 * clearly for a young player without any camera controls to learn.
 */
import * as THREE from "three";

// Camera sits at +Z behind the student and looks toward -Z, which is where every
// location puts its back wall and its NPC. This also defines "up" on the stick:
// Player.update rotates input by this yaw, so 0 keeps forward = away from camera.
const CAM_YAW = 0;
const CAM_DIST = 8.2;
const CAM_HEIGHT = 6.4;
const CAM_LOOK_Y = 1.1;

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#bfe9f2");
    this.scene.fog = new THREE.Fog("#bfe9f2", 22, 45);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camera.position.set(0, CAM_HEIGHT, CAM_DIST);
    this.camera.lookAt(0, CAM_LOOK_Y, 0);

    this.zoom = 1;
    this.target = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();

    this.buildLights();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  buildLights() {
    this.ambient = new THREE.HemisphereLight("#ffffff", "#9a8f7a", 1.05);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight("#fff3d6", 1.5);
    this.sun.position.set(7, 13, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -16; s.right = 16; s.top = 16; s.bottom = -16;
    s.near = 1; s.far = 45;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight("#cfe4ff", 0.35);
    this.fill.position.set(-8, 6, -6);
    this.scene.add(this.fill);
  }

  setAtmosphere(sky, fogFar) {
    const color = new THREE.Color(sky);
    this.scene.background = color;
    this.scene.fog = new THREE.Fog(color, Math.max(12, fogFar * 0.45), fogFar);
  }

  get yaw() { return CAM_YAW; }

  /** Snap straight to the target - used when entering a location. */
  snapTo(position) {
    this.computeDesired(position);
    this.camera.position.copy(this.desired);
    this.target.copy(position);
    this.camera.lookAt(position.x, CAM_LOOK_Y, position.z);
  }

  computeDesired(position) {
    this.desired.set(
      position.x + Math.sin(CAM_YAW) * CAM_DIST * this.zoom,
      CAM_HEIGHT * this.zoom,
      position.z + Math.cos(CAM_YAW) * CAM_DIST * this.zoom
    );
  }

  follow(position, dt) {
    this.computeDesired(position);
    const ease = 1 - Math.pow(0.0015, dt);
    this.camera.position.lerp(this.desired, ease);
    this.lookAt.lerp(new THREE.Vector3(position.x, CAM_LOOK_Y, position.z), ease);
    this.camera.lookAt(this.lookAt);

    this.sun.position.set(position.x + 7, 13, position.z + 6);
    this.sun.target.position.set(position.x, 0, position.z);
    this.sun.target.updateMatrixWorld();
  }

  /** Pull in a little during conversations so faces read better. */
  setConversationFraming(on) {
    this.zoom = on ? 0.72 : 1;
  }

  /** World position -> CSS pixels, for anchoring speech bubbles to heads. */
  project(worldPos) {
    const v = worldPos.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width,
      y: (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z < 1
    };
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
