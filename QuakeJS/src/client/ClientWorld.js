/**
 * Client entity / stats state from svc_spawnbaseline, fast updates, svc_clientdata.
 * Draw lists follow CL_RelinkEntities (cl_main.c) — lerped origins between packets.
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
 *   msg_origins: [Float32Array, Float32Array],
 *   msg_angles: [Float32Array, Float32Array],
 *   modelindex: number,
 *   frame: number,
 *   colormap: number,
 *   skin: number,
 *   effects: number,
 *   msgtime: number,
 *   forcelink: boolean,
 * }}
 */
export function emptyClientEntity() {
  return {
    baseline: emptyEntityState(),
    origin: new Float32Array(3),
    angles: new Float32Array(3),
    msg_origins: [new Float32Array(3), new Float32Array(3)],
    msg_angles: [new Float32Array(3), new Float32Array(3)],
    modelindex: 0,
    frame: 0,
    colormap: 0,
    skin: 0,
    effects: 0,
    msgtime: 0,
    forcelink: true,
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

/**
 * @param {number} a
 * @param {number} b
 * @param {number} f
 */
function lerpAngle(a, b, f) {
  let d = b - a;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return a + f * d;
}

export class ClientWorld {
  constructor() {
    /** @type {ReturnType<typeof emptyClientEntity>[]} */
    this.entities = [];
    /** Last svc_time (cl.mtime[0]) — entities updated this packet */
    this.mtime = 0;
    /** cl.mtime[1] — previous packet time */
    this.mtime1 = 0;
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
    this.mtime1 = 0;
    this.viewentity = 1;
    this.viewheight = DEFAULT_VIEWHEIGHT;
    this.idealpitch = 0;
    this.punchangle[0] = this.punchangle[1] = this.punchangle[2] = 0;
    this.items = 0;
  }

  /**
   * Push new svc_time (CL_ParseServerMessage case svc_time).
   * @param {number} t
   */
  pushTime(t) {
    this.mtime1 = this.mtime;
    this.mtime = t;
  }

  /**
   * CL_LerpPoint — fraction between mtime[1] and mtime[0] for cl.time.
   * @param {number} time cl.time
   * @param {boolean} [nolerp=false] true when local SV active (sv.active)
   * @returns {number} frac 0..1
   */
  lerpFrac(time, nolerp = false) {
    if (nolerp) return 1;
    let f = this.mtime - this.mtime1;
    if (!f) return 1;
    if (f > 0.1) {
      // dropped packet or start of demo
      this.mtime1 = this.mtime - 0.1;
      f = 0.1;
    }
    let frac = (time - this.mtime1) / f;
    if (frac < 0) frac = 0;
    else if (frac > 1) frac = 1;
    return frac;
  }

  /**
   * CL_RelinkEntities — lerp msg_origins into origin for drawing / view.
   * @param {number} time cl.time
   * @param {boolean} [nolerp=false]
   */
  relinkEntities(time, nolerp = false) {
    const frac = this.lerpFrac(time, nolerp);
    const mtime0 = this.mtime;
    for (let i = 1; i < this.entities.length; i++) {
      const ent = this.entities[i];
      if (!ent || ent.msgtime !== mtime0) continue;
      if (ent.forcelink) {
        ent.origin[0] = ent.msg_origins[0][0];
        ent.origin[1] = ent.msg_origins[0][1];
        ent.origin[2] = ent.msg_origins[0][2];
        ent.angles[0] = ent.msg_angles[0][0];
        ent.angles[1] = ent.msg_angles[0][1];
        ent.angles[2] = ent.msg_angles[0][2];
        continue;
      }
      let f = frac;
      for (let j = 0; j < 3; j++) {
        const d = ent.msg_origins[0][j] - ent.msg_origins[1][j];
        if (d > 100 || d < -100) f = 1;
      }
      for (let j = 0; j < 3; j++) {
        ent.origin[j] =
          ent.msg_origins[1][j] + f * (ent.msg_origins[0][j] - ent.msg_origins[1][j]);
        ent.angles[j] = lerpAngle(
          ent.msg_angles[1][j],
          ent.msg_angles[0][j],
          f,
        );
      }
    }
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
        id: i,
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

  /**
   * Brush submodels (*N) for doors/plats — from client entity state.
   * @param {string[]} modelPrecache
   * @param {number} [maxSubmodels]
   * @returns {{ submodel: number, origin: Float32Array, edict: number }[]}
   */
  getBrushDrawList(modelPrecache, maxSubmodels = 256) {
    /** @type {{ submodel: number, origin: Float32Array, edict: number }[]} */
    const out = [];
    const mtime = this.mtime;
    for (let i = 1; i < this.entities.length; i++) {
      const ent = this.entities[i];
      if (!ent || ent.msgtime !== mtime) continue;
      const mi = ent.modelindex | 0;
      if (!mi || mi >= modelPrecache.length) continue;
      const model = modelPrecache[mi];
      if (!model || model[0] !== '*') continue;
      const sub = parseInt(model.slice(1), 10);
      if (!sub || sub >= maxSubmodels) continue;
      out.push({
        submodel: sub,
        origin: new Float32Array([ent.origin[0], ent.origin[1], ent.origin[2]]),
        edict: i,
      });
    }
    return out;
  }
}
