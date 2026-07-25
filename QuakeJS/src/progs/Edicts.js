/**
 * Edict pool (pr_edict.c ED_Alloc / ED_Free subset).
 * Entity handles are edict indices (0 = world).
 */

export const MAX_EDICTS = 600;
export const MAX_CLIENTS = 1;

export const MOVETYPE_NONE = 0;
export const MOVETYPE_WALK = 3;
export const MOVETYPE_STEP = 4;
export const MOVETYPE_FLY = 5;
export const MOVETYPE_TOSS = 6;
export const MOVETYPE_PUSH = 7;
export const MOVETYPE_NOCLIP = 8;
export const MOVETYPE_FLYMISSILE = 9;
export const MOVETYPE_BOUNCE = 10;

export const SOLID_NOT = 0;
export const SOLID_TRIGGER = 1;
export const SOLID_BBOX = 2;
export const SOLID_SLIDEBOX = 3;
export const SOLID_BSP = 4;

export const FL_FLY = 1;
export const FL_SWIM = 2;
export const FL_CLIENT = 8;
export const FL_INWATER = 16;
export const FL_MONSTER = 32;
export const FL_GODMODE = 64;
export const FL_NOTARGET = 128;
export const FL_ITEM = 256;
export const FL_ONGROUND = 512;
export const FL_PARTIALGROUND = 1024;
export const FL_WATERJUMP = 2048;
export const FL_JUMPRELEASED = 4096;

export class EdictStore {
  /**
   * @param {import('./Progs.js').Progs} progs
   */
  constructor(progs) {
    this.progs = progs;
    this.entityfields = progs.entityfields;
    this.fields = new Float32Array(MAX_EDICTS * this.entityfields);
    this.fieldsI = new Int32Array(this.fields.buffer);
    /** @type {boolean[]} */
    this.free = new Array(MAX_EDICTS).fill(true);
    /** @type {number[]} */
    this.freetime = new Array(MAX_EDICTS).fill(0);
    this.numEdicts = MAX_CLIENTS + 1;
    this.time = 0;

    // World (0) and reserved client slots never free-scan as reusable initially
    this.free[0] = false;
    for (let i = 1; i <= MAX_CLIENTS; i++) this.free[i] = false;
  }

  /**
   * @param {number} edict
   * @param {number} fieldOfs
   * @returns {number} flat index into fields
   */
  idx(edict, fieldOfs) {
    return edict * this.entityfields + fieldOfs;
  }

  /**
   * @param {number} edict
   * @param {number} fieldOfs
   */
  getFloat(edict, fieldOfs) {
    return this.fields[this.idx(edict, fieldOfs)];
  }

  /**
   * @param {number} edict
   * @param {number} fieldOfs
   * @param {number} v
   */
  setFloat(edict, fieldOfs, v) {
    this.fields[this.idx(edict, fieldOfs)] = v;
  }

  /**
   * @param {number} edict
   * @param {number} fieldOfs
   */
  getInt(edict, fieldOfs) {
    return this.fieldsI[this.idx(edict, fieldOfs)];
  }

  /**
   * @param {number} edict
   * @param {number} fieldOfs
   * @param {number} v
   */
  setInt(edict, fieldOfs, v) {
    this.fieldsI[this.idx(edict, fieldOfs)] = v;
  }

  /**
   * @param {number} edict
   * @param {number} fieldOfs
   * @returns {Float32Array}
   */
  getVec(edict, fieldOfs) {
    const i = this.idx(edict, fieldOfs);
    return this.fields.subarray(i, i + 3);
  }

  /**
   * @param {number} edict
   * @param {number} fieldOfs
   * @param {Float32Array|number[]} v
   */
  setVec(edict, fieldOfs, v) {
    const i = this.idx(edict, fieldOfs);
    this.fields[i] = v[0];
    this.fields[i + 1] = v[1];
    this.fields[i + 2] = v[2];
  }

  clear(edict) {
    const base = edict * this.entityfields;
    this.fields.fill(0, base, base + this.entityfields);
  }

  /**
   * @returns {number}
   */
  alloc() {
    for (let i = MAX_CLIENTS + 1; i < this.numEdicts; i++) {
      if (this.free[i] && (this.freetime[i] < 2 || this.time - this.freetime[i] > 0.5)) {
        this.free[i] = false;
        this.clear(i);
        return i;
      }
    }
    if (this.numEdicts >= MAX_EDICTS) {
      throw new Error('ED_Alloc: no free edicts');
    }
    const e = this.numEdicts++;
    this.free[e] = false;
    this.clear(e);
    return e;
  }

  /**
   * @param {number} edict
   */
  freeEdict(edict) {
    if (edict <= MAX_CLIENTS) return;
    const f = this.progs.f;
    this.setFloat(edict, f.model, 0);
    this.setFloat(edict, f.modelindex, 0);
    this.setFloat(edict, f.colormap, 0);
    this.setFloat(edict, f.frame, 0);
    this.setVec(edict, f.origin, [0, 0, 0]);
    this.setVec(edict, f.angles, [0, 0, 0]);
    this.setFloat(edict, f.nextthink, -1);
    this.setFloat(edict, f.solid, SOLID_NOT);
    this.free[edict] = true;
    this.freetime[edict] = this.time;
  }

  /**
   * Update absmin/absmax/size from origin+mins/maxs (SV_LinkEdict subset).
   * @param {number} edict
   */
  linkAbs(edict) {
    const f = this.progs.f;
    const o = this.getVec(edict, f.origin);
    const mins = this.getVec(edict, f.mins);
    const maxs = this.getVec(edict, f.maxs);
    const absmin = [
      o[0] + mins[0],
      o[1] + mins[1],
      o[2] + mins[2],
    ];
    const absmax = [
      o[0] + maxs[0],
      o[1] + maxs[1],
      o[2] + maxs[2],
    ];
    // FL_ITEM expand
    if ((this.getFloat(edict, f.flags) | 0) & FL_ITEM) {
      absmin[0] -= 15;
      absmin[1] -= 15;
      absmax[0] += 15;
      absmax[1] += 15;
    }
    this.setVec(edict, f.absmin, absmin);
    this.setVec(edict, f.absmax, absmax);
    this.setVec(edict, f.size, [
      maxs[0] - mins[0],
      maxs[1] - mins[1],
      maxs[2] - mins[2],
    ]);
  }
}
