/**
 * Free-fly camera for the demo room (Y-up scaffolding — not Quake Z-up).
 */
export class FlyCamera {
  constructor() {
    this.position = new Float32Array([0, 1.7, 6]);
    this.yaw = Math.PI; // face −Z toward room center
    this.pitch = 0;
    this.moveSpeed = 6;
  }

  /**
   * @param {number} yaw
   * @param {number} pitch
   */
  setAngles(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /**
   * Forward unit vector (Y-up, yaw around Y, pitch around local X).
   * @returns {Float32Array}
   */
  forward() {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    return new Float32Array([sy * cp, sp, -cy * cp]);
  }

  /**
   * @returns {Float32Array}
   */
  right() {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    return new Float32Array([cy, 0, sy]);
  }

  /**
   * @param {number} dt
   * @param {{ forward: boolean, back: boolean, left: boolean, right: boolean, up: boolean, down: boolean }} move
   */
  update(dt, move) {
    const f = this.forward();
    const r = this.right();
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (move.forward) {
      mx += f[0];
      my += f[1];
      mz += f[2];
    }
    if (move.back) {
      mx -= f[0];
      my -= f[1];
      mz -= f[2];
    }
    if (move.right) {
      mx += r[0];
      mz += r[2];
    }
    if (move.left) {
      mx -= r[0];
      mz -= r[2];
    }
    if (move.up) my += 1;
    if (move.down) my -= 1;

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
    const f = this.forward();
    return {
      eye: this.position,
      center: new Float32Array([
        this.position[0] + f[0],
        this.position[1] + f[1],
        this.position[2] + f[2],
      ]),
      up: new Float32Array([0, 1, 0]),
    };
  }
}
