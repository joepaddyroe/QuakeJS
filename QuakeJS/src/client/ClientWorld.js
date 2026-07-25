/**
 * Client entity / stats state from svc_spawnbaseline, fast updates, svc_clientdata.
 */

import { DEFAULT_VIEWHEIGHT } from '../protocol/Protocol.js';

/**
 * @typedef {{
 *   origin: Float32Array,
 *   angles: Float32Array,
 *   modelindex: number,
 *   frame: number,
 *   colormap: number,
 *   skin: number,
 *   effects: number,
 * }} EntityState
 */

/**
 * @returns {EntityState}
 */
export function emptyEntityState() {
  return {
    origin: new Float32Array(3),
    angles: new Float32Array(3),
    modelindex: 0,
    frame: 0,
    colormap: 0,
    skin: 0,
    effects: 0,
  };
}

/**
 * @returns {{
 *   baseline: EntityState,
 *   origin: Float32Array,
 *   angles: Float32Array,
 *   modelindex: number,
 *   frame: number,
 *   colormap: number,
 *   skin: number,
 *   effects: number,
 *   msgtime: number,
 * }}
 */
export function emptyClientEntity() {
  return {
    baseline: emptyEntityState(),
    origin: new Float32Array(3),
    angles: new Float32Array(3),
    modelindex: 0,
    frame: 0,
    colormap: 0,
    skin: 0,
    effects: 0,
    msgtime: 0,
  };
}

export class ClientWorld {
  constructor() {
    /** @type {ReturnType<typeof emptyClientEntity>[]} */
    this.entities = [];
    this.viewheight = DEFAULT_VIEWHEIGHT;
    this.idealpitch = 0;
    this.punchangle = new Float32Array(3);
    this.items = 0;
    this.onground = false;
    this.inwater = false;
    this.stats = {
      health: 100,
      armor: 0,
      weapon: 0,
      ammo: 0,
      shells: 0,
      nails: 0,
      rockets: 0,
      cells: 0,
      weaponframe: 0,
    };
  }

  /**
   * @param {number} num
   */
  ensureEntity(num) {
    while (this.entities.length <= num) {
      this.entities.push(emptyClientEntity());
    }
    return this.entities[num];
  }

  clear() {
    this.entities.length = 0;
    this.viewheight = DEFAULT_VIEWHEIGHT;
    this.idealpitch = 0;
    this.punchangle[0] = this.punchangle[1] = this.punchangle[2] = 0;
    this.items = 0;
  }
}
