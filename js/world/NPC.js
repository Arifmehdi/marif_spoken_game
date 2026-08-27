/**
 * NPC - a character the student can walk up to and talk with.
 *
 * Carries a floating marker so a child can see at a glance who to approach,
 * and reports when the player is close enough to start the conversation.
 */
import * as THREE from "three";
import { Character } from "./CharacterFactory.js";

const TALK_RANGE = 2.6;

/**
 * Marker states above an NPC's head.
 *
 *   quest - amber "!"  : someone to talk to, but you are too far away
 *   ready - green chat : you are close enough, press Talk NOW
 *   talk  - blue chat  : an NPC with no lesson here
 *   done  - green tick : conversation finished
 *
 * The amber-to-green switch is the cue that the Talk button will work.
 */
const MARKERS = {
  quest: { symbol: "!", color: "#f59e0b" },
  ready: { symbol: "\u{1F4AC}", color: "#22c55e" },
  talk: { symbol: "\u{1F4AC}", color: "#3b82f6" },
  done: { symbol: "✓", color: "#22c55e" }
};

// Textures are identical for every NPC, so build each one once and share it.
// (Never disposed per-NPC for that reason.)
const TEXTURES = new Map();

function markerTexture(kind) {
  if (TEXTURES.has(kind)) return TEXTURES.get(kind);
  const def = MARKERS[kind];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = def.color;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 72px Verdana, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.symbol, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  TEXTURES.set(kind, tex);
  return tex;
}

export class NPC {
  constructor({ id, name, role, spot }) {
    this.id = id;
    this.name = name || "Friend";
    this.role = role || "default";
    this.character = new Character(this.role);
    this.group = this.character.group;
    this.group.position.set(spot.x, 0, spot.z);
    this.group.rotation.y = spot.rotY || 0;
    this.homeRotation = this.group.rotation.y;
    this.inRange = false;
    this.busy = false;

    this.baseMarker = "quest";
    this.shownMarker = null;
    this.bodyHeight = 1.3;          // refined once the real model is measured
    this.markerFitted = false;

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTexture("quest"),
      depthTest: false,
      transparent: true
    }));
    this.marker.scale.setScalar(0.52);
    this.marker.renderOrder = 10;
    this.group.add(this.marker);
    this.applyMarker("quest");
    this.positionMarker();
  }

  /** The state this NPC returns to when the player walks away. */
  setMarker(kind) {
    this.baseMarker = kind;
    // "done" takes effect at once; the others yield to the proximity cue.
    if (kind === "done" || !this.inRange || this.busy) this.applyMarker(kind);
  }

  applyMarker(kind) {
    if (this.shownMarker === kind) return;
    if (!MARKERS[kind]) { this.marker.visible = false; this.shownMarker = kind; return; }
    this.shownMarker = kind;
    this.marker.visible = true;
    this.marker.material.map = markerTexture(kind);
    this.marker.material.needsUpdate = true;
    // The "you can talk" cue is a little larger so it reads at a glance.
    this.marker.scale.setScalar(kind === "ready" ? 0.62 : 0.52);
  }

  hideMarker() { this.marker.visible = false; }

  /** Sit the marker just above the head, whatever height this character is. */
  positionMarker() {
    this.markerBaseY = this.bodyHeight + 0.45;
    this.marker.position.set(0, this.markerBaseY, 0);
  }

  /** Measure the real model once it has been attached. */
  fitToModel() {
    const model = this.character.model;
    if (!model) return;
    const box = new THREE.Box3();
    let skinned = false;
    model.updateWorldMatrix(true, true);
    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      skinned = true;
      if (o.skeleton) o.skeleton.update();
      o.computeBoundingBox();
      box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    if (!skinned) box.setFromObject(model);
    const h = box.max.y - box.min.y;
    if (h > 0.1) {
      this.bodyHeight = h;
      this.positionMarker();
    }
    this.markerFitted = true;
  }

  get headPosition() {
    return new THREE.Vector3(this.group.position.x, this.bodyHeight, this.group.position.z);
  }

  /** @returns {boolean} true on the frame the player enters range */
  update(dt, playerPos) {
    this.character.update(dt);

    // The model arrives a moment after spawning; re-anchor the marker to it.
    if (!this.markerFitted && this.character.isModel) this.fitToModel();
    this.marker.position.y = this.markerBaseY + Math.sin(performance.now() / 400) * 0.08;

    const dist = Math.hypot(this.group.position.x - playerPos.x, this.group.position.z - playerPos.z);
    const wasInRange = this.inRange;
    this.inRange = dist < TALK_RANGE;

    // Amber while out of reach, green the moment Talk will actually work.
    // "done" is terminal: a finished conversation must not offer itself again
    // just because the player is still standing there.
    if (!this.busy) {
      this.applyMarker(this.baseMarker === "done" ? "done"
        : (this.inRange ? "ready" : this.baseMarker));
    }

    if (this.inRange && !this.busy) {
      // Turn to face the player as they approach.
      const want = Math.atan2(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z);
      let diff = want - this.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += diff * Math.min(1, dt * 5);
    }

    return this.inRange && !wasInRange;
  }

  faceTo(pos) {
    this.group.rotation.y = Math.atan2(pos.x - this.group.position.x, pos.z - this.group.position.z);
  }

  setState(state) { this.character.setState(state); }

  dispose() {
    // marker textures are shared between NPCs - only the material is ours
    this.marker.material.dispose();
    this.character.dispose();
  }
}
