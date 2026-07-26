/**
 * Client entity / stats state from svc_spawnbaseline, fast updates, svc_clientdata.
 * Draw lists follow CL_RelinkEntities (cl_main.c) — only ents updated this frame.
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

/**
 * @param {string} model
 */
function skipFpBodyModel(model) {
  return (
    model.includes('/v_') ||
    model === 'progs/player.mdl' ||
    model === 'progs/eyes.mdl' ||
    model === 'progs/h_player.mdl'
  );
}

export class ClientWorld {
  constructor() {
    /** @type {ReturnType<typeof emptyClientEntity>[]} */
    this.entities = [];
    /** Last svc_time (cl.mtime[0]) */
    this.mtime = 0;
    /** Local player edict / view entity (usually 1) */
    this.viewentity = 1;
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
      /** Model precache index for view weapon (STAT_WEAPON) */
      weaponmodel: 0,
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
    this.mtime = 0;
    this.viewentity = 1;
    this.viewheight = DEFAULT_VIEWHEIGHT;
    this.idealpitch = 0;
    this.punchangle[0] = this.punchangle[1] = this.punchangle[2] = 0;
    this.items = 0;
  }

  /**
   * Alias MDLs visible this frame (CL_RelinkEntities subset).
   * @param {string[]} modelPrecache
   * @param {number} [time] client clock for EF_ROTATE
   * @returns {{ model: string, origin: Float32Array, yaw: number, frame: number }[]}
   */
  getAliasDrawList(modelPrecache, time = 0) {
    /** @type {{ model: string, origin: Float32Array, yaw: number, frame: number }[]} */
    const out = [];
    const mtime = this.mtime;
    const view = this.viewentity;
    const bobjrotate = ((100 * time) % 360 + 360) % 360;
    for (let i = 1; i < this.entities.length; i++) {
      const ent = this.entities[i];
      if (!ent || ent.msgtime !== mtime) continue;
      if (i === view) continue;
      const mi = ent.modelindex | 0;
      if (!mi || mi >= modelPrecache.length) continue;
      const model = modelPrecache[mi];
      if (!model || model[0] === '*' || !model.endsWith('.mdl')) continue;
      if (skipFpBodyModel(model)) continue;
      let yaw = ent.angles[1] || 0;
      // Approximate model EF_ROTATE for bonus items (ammo/weapon/armor)
      if (
        model.includes('armor') ||
        model.includes('backpack') ||
        model.includes('g_') ||
        model.includes('w_') ||
        model.includes('b_') ||
        model.includes('quaddama') ||
        model.includes('invisibl') ||
        model.includes('invulner') ||
        model.includes('suit') ||
        model.includes('jetpack')
      ) {
        yaw = bobjrotate;
      }
      out.push({
        model,
        origin: new Float32Array([ent.origin[0], ent.origin[1], ent.origin[2]]),
        yaw,
        frame: ent.frame | 0,
      });
    }
    return out;
  }

  /**
   * Sprite entities visible this frame.
   * @param {string[]} modelPrecache
   * @returns {{ model: string, origin: Float32Array, angles: Float32Array, frame: number }[]}
   */
  getSpriteDrawList(modelPrecache) {
    /** @type {{ model: string, origin: Float32Array, angles: Float32Array, frame: number }[]} */
    const out = [];
    const mtime = this.mtime;
    const view = this.viewentity;
    for (let i = 1; i < this.entities.length; i++) {
      const ent = this.entities[i];
      if (!ent || ent.msgtime !== mtime) continue;
      if (i === view) continue;
      const mi = ent.modelindex | 0;
      if (!mi || mi >= modelPrecache.length) continue;
      const model = modelPrecache[mi];
      if (!model || !model.endsWith('.spr')) continue;
      out.push({
        model,
        origin: new Float32Array([ent.origin[0], ent.origin[1], ent.origin[2]]),
        angles: new Float32Array([
          ent.angles[0] || 0,
          ent.angles[1] || 0,
          ent.angles[2] || 0,
        ]),
        frame: ent.frame | 0,
      });
    }
    return out;
  }
}
