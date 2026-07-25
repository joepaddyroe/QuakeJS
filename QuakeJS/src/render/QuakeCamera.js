/**
 * Quake-style fly camera (Z-up, angles in degrees — mathlib AngleVectors).
 */
import { angleVectors } from '../math/QuakeMath.js';

export class QuakeCamera {
  constructor() {
    /** World position (eye) */
    this.position = new Float32Array([0, 0, 0]);
    /** pitch, yaw, roll degrees */
    this.pitch = 0;
    this.yaw = 0;
    this.roll = 0;
    this.moveSpeed = 320; // Quake units / sec (sv_maxspeed-ish feel)
  }

  /**
   * @param {Float32Array|number[]} origin entity origin
   * @param {Float32Array|number[]} angles
   * @param {number} [viewOfsZ=22]
   */
  placeAtSpawn(origin, angles, viewOfsZ = 22) {
    this.position[0] = origin[0];
    this.position[1] = origin[1];
    this.position[2] = origin[2] + viewOfsZ;
    this.pitch = angles[0] || 0;
    this.yaw = angles[1] || 0;
    this.roll = angles[2] || 0;
  }

  /**
   * @param {number} pitch
   * @param {number} yaw
   */
  setAngles(pitch, yaw) {
    this.pitch = pitch;
    this.yaw = yaw;
    const limit = 89;
    if (this.pitch > limit) this.pitch = limit;
    if (this.pitch < -limit) this.pitch = -limit;
  }

  /**
   * @returns {{ forward: Float32Array, right: Float32Array, up: Float32Array }}
   */
  basis() {
    return angleVectors([this.pitch, this.yaw, this.roll]);
  }

  /**
   * @param {number} dt
   * @param {{ forward: boolean, back: boolean, left: boolean, right: boolean, up: boolean, down: boolean }} move
   */
  update(dt, move) {
    const { forward, right } = this.basis();
    // Horizontal move (ignore pitch for Quake-like ground feel)
    const fH = new Float32Array([forward[0], forward[1], 0]);
    const fl = Math.hypot(fH[0], fH[1]) || 1;
    fH[0] /= fl;
    fH[1] /= fl;
    const rH = new Float32Array([right[0], right[1], 0]);
    const rl = Math.hypot(rH[0], rH[1]) || 1;
    rH[0] /= rl;
    rH[1] /= rl;

    let mx = 0;
    let my = 0;
    let mz = 0;
    if (move.forward) {
      mx += fH[0];
      my += fH[1];
    }
    if (move.back) {
      mx -= fH[0];
      my -= fH[1];
    }
    if (move.right) {
      mx += rH[0];
      my += rH[1];
    }
    if (move.left) {
      mx -= rH[0];
      my -= rH[1];
    }
    if (move.up) mz += 1;
    if (move.down) mz -= 1;

    const len = Math.hypot(mx, my, mz);
    if (len > 0) {
      const s = (this.moveSpeed * dt) / len;
      this.position[0] += mx * s;
      this.position[1] += my * s;
      this.position[2] += mz * s;
    }
  }

  /**
   * @returns {{ eye: Float32Array, center: Float32Array, up: Float32Array }}
   */
  lookAtArgs() {
    const { forward, up } = this.basis();
    return {
      eye: this.position,
      center: new Float32Array([
        this.position[0] + forward[0],
        this.position[1] + forward[1],
        this.position[2] + forward[2],
      ]),
      up,
    };
  }
}
