/**
 * Client dynamic lights (cl_dlights / CL_AllocDlight / CL_DecayLights).
 */

import { angleVectors } from '../math/QuakeMath.js';

export const MAX_DLIGHTS = 32;

/**
 * @typedef {{
 *   origin: Float32Array,
 *   radius: number,
 *   die: number,
 *   decay: number,
 *   minlight: number,
 *   key: number,
 * }} Dlight
 */

export class DynamicLights {
  constructor() {
    /** @type {Dlight[]} */
    this.lights = [];
    for (let i = 0; i < MAX_DLIGHTS; i++) {
      this.lights.push({
        origin: new Float32Array(3),
        radius: 0,
        die: -1,
        decay: 0,
        minlight: 0,
        key: 0,
      });
    }
  }

  clear() {
    for (const dl of this.lights) {
      dl.radius = 0;
      dl.die = -1;
      dl.decay = 0;
      dl.minlight = 0;
      dl.key = 0;
    }
  }

  /**
   * @param {number} key
   * @param {number} time
   * @returns {Dlight}
   */
  alloc(key, time) {
    if (key) {
      for (const dl of this.lights) {
        if (dl.key === key) {
          this._reset(dl, key);
          return dl;
        }
      }
    }
    for (const dl of this.lights) {
      if (dl.die < time) {
        this._reset(dl, key);
        return dl;
      }
    }
    const dl = this.lights[0];
    this._reset(dl, key);
    return dl;
  }

  /**
   * @param {Dlight} dl
   * @param {number} key
   */
  _reset(dl, key) {
    dl.origin[0] = dl.origin[1] = dl.origin[2] = 0;
    dl.radius = 0;
    dl.die = 0;
    dl.decay = 0;
    dl.minlight = 0;
    dl.key = key;
  }

  /**
   * EF_MUZZLEFLASH — flash in front of the view.
   * @param {Float32Array|number[]} eye
   * @param {number} pitch
   * @param {number} yaw
   * @param {number} time
   * @param {number} [key=1]
   */
  muzzleFlash(eye, pitch, yaw, time, key = 1) {
    const { forward } = angleVectors([pitch, yaw, 0]);
    const dl = this.alloc(key, time);
    // cl_main: origin + (0,0,16) + forward*18; eye is already view org
    dl.origin[0] = eye[0] + forward[0] * 18;
    dl.origin[1] = eye[1] + forward[1] * 18;
    dl.origin[2] = eye[2] + forward[2] * 18;
    dl.radius = 200 + ((Math.random() * 32) | 0);
    dl.minlight = 32;
    dl.die = time + 0.1;
    dl.decay = 0;
  }

  /**
   * TE_EXPLOSION dlight.
   * @param {Float32Array|number[]} org
   * @param {number} time
   */
  explosion(org, time) {
    const dl = this.alloc(0, time);
    dl.origin[0] = org[0];
    dl.origin[1] = org[1];
    dl.origin[2] = org[2];
    dl.radius = 350;
    dl.die = time + 0.5;
    dl.decay = 300;
    dl.minlight = 0;
  }

  /**
   * CL_DecayLights
   * @param {number} time
   * @param {number} dt
   */
  decay(time, dt) {
    for (const dl of this.lights) {
      if (dl.die < time || !dl.radius) continue;
      if (dl.decay) {
        dl.radius -= dt * dl.decay;
        if (dl.radius < 0) dl.radius = 0;
      }
    }
  }
}
