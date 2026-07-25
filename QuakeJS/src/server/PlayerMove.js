/**
 * Player walk movement scaffold (sv_user SV_AirMove + sv_phys SV_WalkMove / SV_FlyMove).
 * World-only; no QuakeC / water / entities yet.
 */

import { angleVectors } from '../math/QuakeMath.js';

const SV_GRAVITY = 800;
const SV_MAXSPEED = 320;
const SV_ACCELERATE = 10;
const SV_AIRACCELERATE = 10;
const SV_FRICTION = 4;
const SV_STOPSPEED = 100;
const STEPSIZE = 18;
const JUMP_IMPULSE = 270;
const VIEW_OFS_Z = 22;
const MAX_CLIP_PLANES = 5;

export const PLAYER_MINS = new Float32Array([-16, -16, -24]);
export const PLAYER_MAXS = new Float32Array([16, 16, 32]);

/**
 * @param {Float32Array} inVel
 * @param {Float32Array} normal
 * @param {Float32Array} outVel
 * @param {number} overbounce
 * @returns {number} blocked flags
 */
function clipVelocity(inVel, normal, outVel, overbounce) {
  let blocked = 0;
  if (normal[2] > 0) blocked |= 1;
  if (!normal[2]) blocked |= 2;

  const backoff =
    (inVel[0] * normal[0] + inVel[1] * normal[1] + inVel[2] * normal[2]) * overbounce;
  for (let i = 0; i < 3; i++) {
    const val = inVel[i] - normal[i] * backoff;
    outVel[i] = val;
    if (val > -0.1 && val < 0.1) outVel[i] = 0;
  }
  return blocked;
}

export class PlayerMove {
  /**
   * @param {import('./World.js').World} world
   */
  constructor(world) {
    this.world = world;
    /** @type {Set<number>} SOLID_BSP edicts bumped this frame (SV_Impact) */
    this.impactedEdicts = new Set();
    /** Entity origin (feet) */
    this.origin = new Float32Array(3);
    this.velocity = new Float32Array(3);
    this.pitch = 0;
    this.yaw = 0;
    this.onground = false;
    this.noclip = false;
    this.jumpReleased = true;
    this.viewOfsZ = VIEW_OFS_Z;
    /** Stair smooth Z (view.c oldz) — tracks origin[2] with lag on step-ups */
    this._smoothZ = 0;
  }

  /**
   * @param {Float32Array|number[]} origin
   * @param {Float32Array|number[]} angles
   */
  placeAtSpawn(origin, angles) {
    this.origin[0] = origin[0];
    this.origin[1] = origin[1];
    this.origin[2] = origin[2];
    this.pitch = angles[0] || 0;
    this.yaw = angles[1] || 0;
    this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
    this.onground = false;
    this.jumpReleased = true;
    this._smoothZ = origin[2];
  }

  /**
   * Eye position for rendering / PVS (includes stair view smoothing).
   * @returns {Float32Array}
   */
  eye() {
    return new Float32Array([
      this.origin[0],
      this.origin[1],
      this._smoothZ + this.viewOfsZ,
    ]);
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
   * @returns {{ eye: Float32Array, center: Float32Array, up: Float32Array }}
   */
  lookAtArgs() {
    const { forward, up } = angleVectors([this.pitch, this.yaw, 0]);
    const eye = this.eye();
    return {
      eye,
      center: new Float32Array([
        eye[0] + forward[0],
        eye[1] + forward[1],
        eye[2] + forward[2],
      ]),
      up,
    };
  }

  /**
   * @param {number} dt
   * @param {{ forward: boolean, back: boolean, left: boolean, right: boolean, jump: boolean, up: boolean, down: boolean }} cmd
   */
  update(dt, cmd) {
    this.impactedEdicts.clear();
    if (dt <= 0) return;
    if (dt > 0.1) dt = 0.1;

    if (this.noclip) {
      this._noclipMove(dt, cmd);
      this._smoothZ = this.origin[2];
      return;
    }

    // Jump (QuakeC PlayerJump: +270 on button2)
    if (cmd.jump) {
      if (this.onground && this.jumpReleased) {
        this.onground = false;
        this.jumpReleased = false;
        this.velocity[2] += JUMP_IMPULSE;
      }
    } else {
      this.jumpReleased = true;
    }

    this._airMove(dt, cmd);

    // Always apply gravity (sv_phys SV_AddGravity) so we stay welded to floors
    this.velocity[2] -= SV_GRAVITY * dt;

    this._walkMove(dt);
    this._updateStepSmooth(dt);
  }

  /**
   * view.c stair smoothing — lag eye Z when origin steps up (never snap the camera up with physics).
   * Physics origin still jumps (vanilla SV_WalkMove); only the view catches up at 80 units/sec.
   * @param {number} dt
   */
  _updateStepSmooth(dt) {
    const z = this.origin[2];
    if (z > this._smoothZ) {
      // Ascending: always ease the view up — do not require onground (it flickers during steps).
      this._smoothZ += dt * 80;
      if (this._smoothZ > z) this._smoothZ = z;
      if (z - this._smoothZ > 12) this._smoothZ = z - 12;
    } else {
      // Flat or falling — stick to origin
      this._smoothZ = z;
    }
  }

  /**
   * @param {number} dt
   * @param {{ forward: boolean, back: boolean, left: boolean, right: boolean, up: boolean, down: boolean }} cmd
   */
  _noclipMove(dt, cmd) {
    const { forward, right } = angleVectors([this.pitch, this.yaw, 0]);
    let mx = 0;
    let my = 0;
    let mz = 0;
    const fH = new Float32Array([forward[0], forward[1], 0]);
    const fl = Math.hypot(fH[0], fH[1]) || 1;
    fH[0] /= fl;
    fH[1] /= fl;
    const rH = new Float32Array([right[0], right[1], 0]);
    const rl = Math.hypot(rH[0], rH[1]) || 1;
    rH[0] /= rl;
    rH[1] /= rl;
    if (cmd.forward) {
      mx += fH[0];
      my += fH[1];
    }
    if (cmd.back) {
      mx -= fH[0];
      my -= fH[1];
    }
    if (cmd.right) {
      mx += rH[0];
      my += rH[1];
    }
    if (cmd.left) {
      mx -= rH[0];
      my -= rH[1];
    }
    if (cmd.up || cmd.jump) mz += 1;
    if (cmd.down) mz -= 1;
    const len = Math.hypot(mx, my, mz);
    if (len > 0) {
      const s = (SV_MAXSPEED * dt) / len;
      this.origin[0] += mx * s;
      this.origin[1] += my * s;
      this.origin[2] += mz * s;
    }
    this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
  }

  /**
   * @param {number} dt
   * @param {{ forward: boolean, back: boolean, left: boolean, right: boolean }} cmd
   */
  _airMove(dt, cmd) {
    const { forward, right } = angleVectors([0, this.yaw, 0]); // yaw only for wish (walk)
    let fmove = 0;
    let smove = 0;
    if (cmd.forward) fmove += SV_MAXSPEED;
    if (cmd.back) fmove -= SV_MAXSPEED;
    if (cmd.right) smove += SV_MAXSPEED;
    if (cmd.left) smove -= SV_MAXSPEED;

    const wishvel = new Float32Array([
      forward[0] * fmove + right[0] * smove,
      forward[1] * fmove + right[1] * smove,
      0,
    ]);
    let wishspeed = Math.hypot(wishvel[0], wishvel[1], wishvel[2]);
    const wishdir = new Float32Array(3);
    if (wishspeed > 0) {
      wishdir[0] = wishvel[0] / wishspeed;
      wishdir[1] = wishvel[1] / wishspeed;
      wishdir[2] = wishvel[2] / wishspeed;
    }
    if (wishspeed > SV_MAXSPEED) {
      const scale = SV_MAXSPEED / wishspeed;
      wishvel[0] *= scale;
      wishvel[1] *= scale;
      wishspeed = SV_MAXSPEED;
    }

    if (this.onground) {
      this._friction(dt);
      this._accelerate(wishdir, wishspeed, SV_ACCELERATE, dt);
    } else {
      this._airAccelerate(wishvel, wishspeed, dt);
    }
  }

  /** @param {number} dt */
  _friction(dt) {
    const speed = Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]);
    if (speed < 1) {
      this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
      return;
    }
    const control = speed < SV_STOPSPEED ? SV_STOPSPEED : speed;
    const drop = control * SV_FRICTION * dt;
    let newspeed = speed - drop;
    if (newspeed < 0) newspeed = 0;
    newspeed /= speed;
    this.velocity[0] *= newspeed;
    this.velocity[1] *= newspeed;
    this.velocity[2] *= newspeed;
  }

  /**
   * @param {Float32Array} wishdir
   * @param {number} wishspeed
   * @param {number} accel
   * @param {number} dt
   */
  _accelerate(wishdir, wishspeed, accel, dt) {
    const currentspeed =
      this.velocity[0] * wishdir[0] +
      this.velocity[1] * wishdir[1] +
      this.velocity[2] * wishdir[2];
    const addspeed = wishspeed - currentspeed;
    if (addspeed <= 0) return;
    let accelspeed = accel * dt * wishspeed;
    if (accelspeed > addspeed) accelspeed = addspeed;
    this.velocity[0] += accelspeed * wishdir[0];
    this.velocity[1] += accelspeed * wishdir[1];
    this.velocity[2] += accelspeed * wishdir[2];
  }

  /**
   * @param {Float32Array} wishvel
   * @param {number} wishspeed
   * @param {number} dt
   */
  _airAccelerate(wishvel, wishspeed, dt) {
    let wishspd = wishspeed;
    if (wishspd > 30) wishspd = 30;
    const wishdir = new Float32Array(3);
    const len = Math.hypot(wishvel[0], wishvel[1], wishvel[2]) || 1;
    wishdir[0] = wishvel[0] / len;
    wishdir[1] = wishvel[1] / len;
    wishdir[2] = wishvel[2] / len;
    this._accelerate(wishdir, wishspd, SV_AIRACCELERATE, dt);
  }

  /** @param {number} dt */
  _walkMove(dt) {
    const oldonground = this.onground;
    this.onground = false;

    const oldorg = new Float32Array(this.origin);
    const oldvel = new Float32Array(this.velocity);

    let clip = this._flyMove(dt);

    if (!(clip & 2)) return;
    if (!oldonground) return;

    const nosteporg = new Float32Array(this.origin);
    const nostepvel = new Float32Array(this.velocity);

    this.origin.set(oldorg);

    // Step up
    const upEnd = new Float32Array([
      this.origin[0],
      this.origin[1],
      this.origin[2] + STEPSIZE,
    ]);
    let tr = this.world.playerMove(this.origin, upEnd, PLAYER_MINS, PLAYER_MAXS);
    this.origin.set(tr.endpos);

    this.velocity[0] = oldvel[0];
    this.velocity[1] = oldvel[1];
    this.velocity[2] = 0;
    clip = this._flyMove(dt);

    // Step down
    const downEnd = new Float32Array([
      this.origin[0],
      this.origin[1],
      this.origin[2] - STEPSIZE + oldvel[2] * dt,
    ]);
    tr = this.world.playerMove(this.origin, downEnd, PLAYER_MINS, PLAYER_MAXS);
    this.origin.set(tr.endpos);

    if (tr.plane.normal[2] > 0.7) {
      this.onground = true;
    } else {
      this.origin.set(nosteporg);
      this.velocity.set(nostepvel);
    }
  }

  /**
   * @param {number} time
   * @returns {number} blocked flags
   */
  _flyMove(time) {
    const original = new Float32Array(this.velocity);
    /** @type {Float32Array[]} */
    const planes = [];
    let timeLeft = time;
    let blocked = 0;

    for (let bump = 0; bump < 4; bump++) {
      if (!this.velocity[0] && !this.velocity[1] && !this.velocity[2]) break;

      const end = new Float32Array([
        this.origin[0] + timeLeft * this.velocity[0],
        this.origin[1] + timeLeft * this.velocity[1],
        this.origin[2] + timeLeft * this.velocity[2],
      ]);
      const trace = this.world.playerMove(this.origin, end, PLAYER_MINS, PLAYER_MAXS);

      if (trace.allsolid) {
        this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
        return 3;
      }

      if (trace.fraction > 0) {
        this.origin.set(trace.endpos);
        original.set(this.velocity);
        planes.length = 0;
      }

      if (trace.fraction === 1) break;

      if (trace.ent) this.impactedEdicts.add(trace.ent);

      if (trace.plane.normal[2] > 0.7) {
        blocked |= 1;
        this.onground = true;
      }
      if (!trace.plane.normal[2]) blocked |= 2;

      timeLeft -= timeLeft * trace.fraction;
      if (planes.length >= MAX_CLIP_PLANES) {
        this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
        return 3;
      }
      planes.push(new Float32Array(trace.plane.normal));

      let i = 0;
      for (; i < planes.length; i++) {
        clipVelocity(original, planes[i], this.velocity, 1);
        let ok = true;
        for (let j = 0; j < planes.length; j++) {
          if (j === i) continue;
          if (
            this.velocity[0] * planes[j][0] +
              this.velocity[1] * planes[j][1] +
              this.velocity[2] * planes[j][2] <
            0
          ) {
            ok = false;
            break;
          }
        }
        if (ok) break;
      }

      if (i === planes.length) {
        if (planes.length !== 2) {
          this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
          return 3;
        }
        const dir = new Float32Array([
          planes[0][1] * planes[1][2] - planes[0][2] * planes[1][1],
          planes[0][2] * planes[1][0] - planes[0][0] * planes[1][2],
          planes[0][0] * planes[1][1] - planes[0][1] * planes[1][0],
        ]);
        const d =
          dir[0] * this.velocity[0] + dir[1] * this.velocity[1] + dir[2] * this.velocity[2];
        this.velocity[0] = dir[0] * d;
        this.velocity[1] = dir[1] * d;
        this.velocity[2] = dir[2] * d;
      }

      if (
        this.velocity[0] * original[0] +
          this.velocity[1] * original[1] +
          this.velocity[2] * original[2] <=
        0
      ) {
        this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
        break;
      }
    }
    return blocked;
  }
}
