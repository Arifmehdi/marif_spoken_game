/**
 * NPC - a character the student can walk up to and talk with.
 *
 * Carries a floating marker so a child can see at a glance who to approach,
 * and reports when the player is close enough to start the conversation.
 */
import * as THREE from "three";
import { Character } from "./CharacterFactory.js";

const TALK_RANGE = 2.6;

function markerTexture(symbol, color) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 72px Verdana, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(symbol, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
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

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTexture("!", "#f59e0b"),
      depthTest: false,
      transparent: true
    }));
    this.marker.scale.setScalar(0.52);
    this.marker.position.set(0, 2.15, 0);
    this.marker.renderOrder = 10;
    this.group.add(this.marker);
  }

  setMarker(kind) {
    const map = {
      quest: { symbol: "!", color: "#f59e0b" },
      talk: { symbol: "\u{1F4AC}", color: "#3b82f6" },
      done: { symbol: "✓", color: "#22c55e" }
    }[kind];
    if (!map) { this.marker.visible = false; return; }
    this.marker.visible = true;
    if (this.marker.material.map) this.marker.material.map.dispose();
    this.marker.material.map = markerTexture(map.symbol, map.color);
    this.marker.material.needsUpdate = true;
  }

  hideMarker() { this.marker.visible = false; }

  get headPosition() {
    return new THREE.Vector3(this.group.position.x, 1.72 * (this.character.style.height || 1), this.group.position.z);
  }

  /** @returns {boolean} true on the frame the player enters range */
  update(dt, playerPos) {
    this.character.update(dt);
    this.marker.position.y = 2.15 + Math.sin(performance.now() / 400) * 0.08;

    const dist = Math.hypot(this.group.position.x - playerPos.x, this.group.position.z - playerPos.z);
    const wasInRange = this.inRange;
    this.inRange = dist < TALK_RANGE;

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
    if (this.marker.material.map) this.marker.material.map.dispose();
    this.marker.material.dispose();
    this.character.dispose();
  }
}
