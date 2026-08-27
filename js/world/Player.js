/**
 * Player - the student the child controls.
 *
 * Movement is camera-relative (push the stick "up", walk away from the camera),
 * with box collision resolved one axis at a time so you slide along desks
 * instead of sticking to them.
 */
import * as THREE from "three";
import { Character } from "./CharacterFactory.js";

const WALK = 3.4;
const RUN = 6.0;
const RADIUS = 0.32;

export class Player {
  constructor() {
    this.character = new Character("student");
    this.group = this.character.group;
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.frozen = false;
  }

  placeAt(spawn) {
    this.group.position.set(spawn.x, 0, spawn.z);
    this.velocity.set(0, 0, 0);
    this.character.setState("idle");
  }

  freeze(on) {
    this.frozen = on;
    if (on) this.velocity.set(0, 0, 0);
  }

  /**
   * @param {number} dt seconds
   * @param {{x:number,y:number}} input
   * @param {boolean} running
   * @param {object} location current location (colliders + bounds)
   * @param {number} cameraYaw radians
   */
  update(dt, input, running, location, cameraYaw) {
    if (this.frozen) {
      this.character.update(dt);
      return;
    }

    const mag = Math.hypot(input.x, input.y);
    if (mag > 0.06) {
      // Rotate the stick vector into camera space.
      const sin = Math.sin(cameraYaw), cos = Math.cos(cameraYaw);
      const dx = input.x * cos - input.y * sin;
      const dz = input.x * sin + input.y * cos;

      const speed = (running ? RUN : WALK) * Math.min(1, mag);
      this.velocity.set(dx, 0, dz).normalize().multiplyScalar(speed);
      this.facing = Math.atan2(dx, dz);
      this.character.setState(running && mag > 0.85 ? "run" : "walk");
    } else {
      this.velocity.multiplyScalar(0.0001);
      this.character.setState("idle");
    }

    const pos = this.group.position;
    const nextX = pos.x + this.velocity.x * dt;
    const nextZ = pos.z + this.velocity.z * dt;

    if (!this.blocked(nextX, pos.z, location)) pos.x = nextX;
    if (!this.blocked(pos.x, nextZ, location)) pos.z = nextZ;

    const b = location.bounds;
    pos.x = Math.min(Math.max(pos.x, b.minX), b.maxX);
    pos.z = Math.min(Math.max(pos.z, b.minZ), b.maxZ);

    // Ease into the facing direction rather than snapping.
    let diff = this.facing - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 12);

    this.character.update(dt);
  }

  blocked(x, z, location) {
    return location.colliders.some((c) =>
      Math.abs(x - c.x) < c.w / 2 + RADIUS && Math.abs(z - c.z) < c.d / 2 + RADIUS);
  }

  faceTowards(target) {
    this.facing = Math.atan2(target.x - this.group.position.x, target.z - this.group.position.z);
  }

  distanceTo(v) {
    const p = this.group.position;
    return Math.hypot(p.x - v.x, p.z - v.z);
  }

  setState(state) {
    this.character.setState(state);
  }
}
