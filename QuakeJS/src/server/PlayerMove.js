/**
 * Player walk movement scaffold (sv_user SV_AirMove / SV_WaterMove + sv_phys).
 */

import { angleVectors } from '../math/QuakeMath.js';
import {
  CONTENTS_EMPTY,
  CONTENTS_WATER,
} from './World.js';

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

const CL_ROLLANGLE = 2.0;
const CL_ROLLSPEED = 200;

/**
 * view.c V_CalcRoll
 * @param {Float32Array|number[]} angles
 * @param {Float32Array|number[]} velocity
 * @returns {number}
 */
function calcRoll(angles, velocity) {
  const { right } = angleVectors(angles);
  const side = velocity[0] * right[0] + velocity[1] * right[1] + velocity[2] * right[2];
  const sign = side < 0 ? -1 : 1;
  let s = Math.abs(side);
  let value = CL_ROLLANGLE;
  if (s < CL_ROLLSPEED) value = (s * value) / CL_ROLLSPEED;
  return value * sign;
}

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
    this.groundEntity = 0;
    this.noclip = false;
    this.jumpReleased = true;
    this.viewOfsZ = VIEW_OFS_Z;
    /** Stair smooth Z (view.c oldz) — tracks origin[2] with lag on step-ups */
    this._smoothZ = 0;
    /** V_CalcBob cycle (radians-ish progress) */
    this._bobCycle = 0;
    this._bob = 0;
    /** View punch (degrees) — from svc_clientdata / QC punchangle */
    this.punchangle = new Float32Array(3);
    /** View roll (degrees) from V_CalcRoll */
    this.roll = 0;
    /** SV_CheckWater — 0..3 */
    this.waterlevel = 0;
    /** CONTENTS_* at feet when in liquid */
    this.watertype = CONTENTS_EMPTY;
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
    this.groundEntity = 0;
    this.jumpReleased = true;
    this._smoothZ = origin[2];
  }

  /**
   * Eye position for rendering / PVS (includes stair view smoothing + bob).
   * @returns {Float32Array}
   */
  eye() {
    return new Float32Array([
      this.origin[0],
      this.origin[1],
      this._smoothZ + this.viewOfsZ + this._bob,
    ]);
  }

  /**
   * Apply view punch from clientdata / edict.
   * @param {Float32Array|number[]} punch
   */
  setPunchangle(punch) {
    this.punchangle[0] = punch[0] || 0;
    this.punchangle[1] = punch[1] || 0;
    this.punchangle[2] = punch[2] || 0;
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
    // view.c V_CalcRefdef subset — punch + bob + roll
    const pitch = this.pitch + this.punchangle[0];
    const yaw = this.yaw + this.punchangle[1];
    this.roll = calcRoll([0, this.yaw, 0], this.velocity);
    const roll = this.roll + this.punchangle[2];
    const { forward, up } = angleVectors([pitch, yaw, roll]);
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
   * @param {{
   *   forward?: boolean, back?: boolean, left?: boolean, right?: boolean,
   *   jump?: boolean, up?: boolean, down?: boolean,
   *   forwardmove?: number, sidemove?: number, upmove?: number,
   * }} cmd
   */
  update(dt, cmd) {
    this.impactedEdicts.clear();
    if (dt <= 0) return;
    if (dt > 0.1) dt = 0.1;

    if (this.noclip) {
      this._noclipMove(dt, cmd);
      this._smoothZ = this.origin[2];
      this._bob = 0;
      this.waterlevel = 0;
      this.watertype = CONTENTS_EMPTY;
      return;
    }

    this._checkWater();

    // Jump (QuakeC PlayerJump: +270 on button2) — not while fully submerged swim
    if (cmd.jump) {
      if (this.onground && this.jumpReleased && this.waterlevel < 2) {
        this.onground = false;
        this.jumpReleased = false;
        this.velocity[2] += JUMP_IMPULSE;
      }
    } else {
      this.jumpReleased = true;
    }

    if (this.waterlevel >= 2) {
      this._waterMove(dt, cmd);
    } else {
      this._airMove(dt, cmd);
      // SV_CheckWater returns waterlevel > 1 — gravity only when not swimming
      this.velocity[2] -= SV_GRAVITY * dt;
    }

    // QuakeC WaterMove velocity drag (PlayerPreThink) — once per frame, not stacked
    // with a second copy from applyClientEdict after PreThink.
    if (this.waterlevel > 0) {
      const drag = 1 - 0.8 * this.waterlevel * dt;
      if (drag > 0) {
        this.velocity[0] *= drag;
        this.velocity[1] *= drag;
        this.velocity[2] *= drag;
      }
    }

    this._walkMove(dt);
    this._updateStepSmooth(dt);
    this._updateBob(dt);
  }

  /**
   * SV_CheckWater — set waterlevel / watertype from hull contents.
   */
  _checkWater() {
    const mins = PLAYER_MINS;
    const maxs = PLAYER_MAXS;
    const point = new Float32Array([
      this.origin[0],
      this.origin[1],
      this.origin[2] + mins[2] + 1,
    ]);
    this.waterlevel = 0;
    this.watertype = CONTENTS_EMPTY;
    let cont = this.world.pointContents(point);
    if (cont <= CONTENTS_WATER) {
      this.watertype = cont;
      this.waterlevel = 1;
      point[2] = this.origin[2] + (mins[2] + maxs[2]) * 0.5;
      cont = this.world.pointContents(point);
      if (cont <= CONTENTS_WATER) {
        this.waterlevel = 2;
        point[2] = this.origin[2] + this.viewOfsZ;
        cont = this.world.pointContents(point);
        if (cont <= CONTENTS_WATER) this.waterlevel = 3;
      }
    }
  }

  /**
   * Eye-point contents for V_SetContentsColor (underwater tint).
   * @returns {number} CONTENTS_*
   */
  eyeContents() {
    const eye = this.eye();
    return this.world.pointContents(eye);
  }

  /**
   * SV_WaterMove — full 3D swim when waterlevel >= 2.
   * @param {number} dt
   * @param {{
   *   forwardmove?: number, sidemove?: number, upmove?: number,
   *   jump?: boolean, up?: boolean, down?: boolean,
   * }} cmd
   */
  _waterMove(dt, cmd) {
    const { forward, right } = angleVectors([this.pitch, this.yaw, 0]);
    let fmove = cmd.forwardmove !== undefined ? cmd.forwardmove : 0;
    let smove = cmd.sidemove !== undefined ? cmd.sidemove : 0;
    let umove = cmd.upmove !== undefined ? cmd.upmove : 0;
    // Jump / swim-up while in water (button2 → upmove in usercmd)
    if (cmd.jump || cmd.up) umove = Math.max(umove, SV_MAXSPEED);
    if (cmd.down) umove = Math.min(umove, -SV_MAXSPEED);

    const wishvel = new Float32Array([
      forward[0] * fmove + right[0] * smove,
      forward[1] * fmove + right[1] * smove,
      forward[2] * fmove + right[2] * smove,
    ]);
    if (!fmove && !smove && !umove) {
      wishvel[2] -= 60; // drift toward bottom
    } else {
      wishvel[2] += umove;
    }

    let wishspeed = Math.hypot(wishvel[0], wishvel[1], wishvel[2]);
    if (wishspeed > SV_MAXSPEED) {
      const s = SV_MAXSPEED / wishspeed;
      wishvel[0] *= s;
      wishvel[1] *= s;
      wishvel[2] *= s;
      wishspeed = SV_MAXSPEED;
    }
    wishspeed *= 0.7;

    // Water friction
    let speed = Math.hypot(
      this.velocity[0],
      this.velocity[1],
      this.velocity[2],
    );
    let newspeed = 0;
    if (speed) {
      newspeed = speed - dt * speed * SV_FRICTION;
      if (newspeed < 0) newspeed = 0;
      const scale = newspeed / speed;
      this.velocity[0] *= scale;
      this.velocity[1] *= scale;
      this.velocity[2] *= scale;
    }

    // Water acceleration — vanilla uses |velocity| after friction, not projection
    if (!wishspeed) return;
    const addspeed = wishspeed - newspeed;
    if (addspeed <= 0) return;
    const wl = Math.hypot(wishvel[0], wishvel[1], wishvel[2]) || 1;
    const wishdir = new Float32Array([
      wishvel[0] / wl,
      wishvel[1] / wl,
      wishvel[2] / wl,
    ]);
    let accelspeed = SV_ACCELERATE * wishspeed * dt;
    if (accelspeed > addspeed) accelspeed = addspeed;
    this.velocity[0] += accelspeed * wishdir[0];
    this.velocity[1] += accelspeed * wishdir[1];
    this.velocity[2] += accelspeed * wishdir[2];
  }

  /**
   * view.c V_CalcBob subset — vertical eye bob from XY speed.
   * @param {number} dt
   */
  _updateBob(dt) {
    const xyspeed = Math.hypot(this.velocity[0], this.velocity[1]);
    if (this.onground && xyspeed > 20) {
      this._bobCycle += dt * (0.3 + xyspeed * 0.002);
      const bob =
        Math.sin(this._bobCycle * Math.PI * 2) *
        Math.min(xyspeed, 400) *
        0.015;
      this._bob = bob;
    } else {
      this._bob *= Math.max(0, 1 - dt * 8);
      if (Math.abs(this._bob) < 0.05) this._bob = 0;
    }
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
   * @param {{
   *   forward?: boolean, back?: boolean, left?: boolean, right?: boolean,
   *   up?: boolean, down?: boolean,
   *   forwardmove?: number, sidemove?: number, upmove?: number,
   * }} cmd
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

    let fmove =
      cmd.forwardmove !== undefined
        ? cmd.forwardmove
        : (cmd.forward ? SV_MAXSPEED : 0) - (cmd.back ? SV_MAXSPEED : 0);
    let smove =
      cmd.sidemove !== undefined
        ? cmd.sidemove
        : (cmd.right ? SV_MAXSPEED : 0) - (cmd.left ? SV_MAXSPEED : 0);
    let umove =
      cmd.upmove !== undefined
        ? cmd.upmove
        : (cmd.up ? SV_MAXSPEED : 0) - (cmd.down ? SV_MAXSPEED : 0);

    mx = fH[0] * fmove + rH[0] * smove;
    my = fH[1] * fmove + rH[1] * smove;
    mz = forward[2] * fmove + umove;

    const speed = Math.hypot(mx, my, mz);
    if (speed > SV_MAXSPEED) {
      const s = SV_MAXSPEED / speed;
      mx *= s;
      my *= s;
      mz *= s;
    }
    this.origin[0] += mx * dt;
    this.origin[1] += my * dt;
    this.origin[2] += mz * dt;
    this.velocity[0] = mx;
    this.velocity[1] = my;
    this.velocity[2] = mz;
    this.onground = false;
  }

  /**
   * SV_AirMove wish from usercmd.forwardmove/sidemove (or bool keys).
   * @param {number} dt
   * @param {{
   *   forward?: boolean, back?: boolean, left?: boolean, right?: boolean,
   *   forwardmove?: number, sidemove?: number,
   * }} cmd
   */
  _airMove(dt, cmd) {
    const { forward, right } = angleVectors([0, this.yaw, 0]); // yaw only for wish (walk)
    let fmove =
      cmd.forwardmove !== undefined
        ? cmd.forwardmove
        : (cmd.forward ? SV_MAXSPEED : 0) - (cmd.back ? SV_MAXSPEED : 0);
    let smove =
      cmd.sidemove !== undefined
        ? cmd.sidemove
        : (cmd.right ? SV_MAXSPEED : 0) - (cmd.left ? SV_MAXSPEED : 0);

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
    // SV_UserFriction — speed is horizontal only (vel[2] scaled by same ratio)
    const speed = Math.hypot(this.velocity[0], this.velocity[1]);
    if (!speed) return;

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
    this.groundEntity = 0;

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
      this.groundEntity = tr.ent || 0;
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
        this.groundEntity = trace.ent || 0;
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
