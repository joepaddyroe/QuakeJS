/**
 * progs.dat loader (PR_LoadProgs). PROG_VERSION 6, PROGHEADER_CRC 5927.
 */

export const PROG_VERSION = 6;
export const PROGHEADER_CRC = 5927;

export const OFS_NULL = 0;
export const OFS_RETURN = 1;
export const OFS_PARM0 = 4;
export const RESERVED_OFS = 28;

export const EV_VOID = 0;
export const EV_STRING = 1;
export const EV_FLOAT = 2;
export const EV_VECTOR = 3;
export const EV_ENTITY = 4;
export const EV_FIELD = 5;
export const EV_FUNCTION = 6;
export const EV_POINTER = 7;

/**
 * @param {Uint8Array} data
 */
export class Progs {
  /**
   * @param {Uint8Array} data
   */
  constructor(data) {
    this._u8 = data;
    this._view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const v = this._view;
    const version = v.getInt32(0, true);
    const crc = v.getInt32(4, true);
    if (version !== PROG_VERSION) {
      throw new Error(`progs.dat version ${version}, expected ${PROG_VERSION}`);
    }
    if (crc !== PROGHEADER_CRC) {
      throw new Error(`progs.dat crc ${crc}, expected ${PROGHEADER_CRC}`);
    }

    this.ofsStatements = v.getInt32(8, true);
    this.numStatements = v.getInt32(12, true);
    this.ofsGlobaldefs = v.getInt32(16, true);
    this.numGlobaldefs = v.getInt32(20, true);
    this.ofsFielddefs = v.getInt32(24, true);
    this.numFielddefs = v.getInt32(28, true);
    this.ofsFunctions = v.getInt32(32, true);
    this.numFunctions = v.getInt32(36, true);
    this.ofsStrings = v.getInt32(40, true);
    this.numStrings = v.getInt32(44, true);
    this.ofsGlobals = v.getInt32(48, true);
    this.numGlobals = v.getInt32(52, true);
    this.entityfields = v.getInt32(56, true);

    /** @type {{ op: number, a: number, b: number, c: number }[]} */
    this.statements = new Array(this.numStatements);
    for (let i = 0; i < this.numStatements; i++) {
      const o = this.ofsStatements + i * 8;
      this.statements[i] = {
        op: v.getUint16(o, true),
        a: v.getInt16(o + 2, true),
        b: v.getInt16(o + 4, true),
        c: v.getInt16(o + 6, true),
      };
    }

    /** @type {{ type: number, ofs: number, s_name: number }[]} */
    this.globaldefs = new Array(this.numGlobaldefs);
    for (let i = 0; i < this.numGlobaldefs; i++) {
      const o = this.ofsGlobaldefs + i * 8;
      this.globaldefs[i] = {
        type: v.getUint16(o, true),
        ofs: v.getUint16(o + 2, true),
        s_name: v.getInt32(o + 4, true),
      };
    }

    /** @type {{ type: number, ofs: number, s_name: number }[]} */
    this.fielddefs = new Array(this.numFielddefs);
    /** @type {Map<string, { type: number, ofs: number }>} */
    this.fieldByName = new Map();
    for (let i = 0; i < this.numFielddefs; i++) {
      const o = this.ofsFielddefs + i * 8;
      const def = {
        type: v.getUint16(o, true),
        ofs: v.getUint16(o + 2, true),
        s_name: v.getInt32(o + 4, true),
      };
      this.fielddefs[i] = def;
      this.fieldByName.set(this.getString(def.s_name), {
        type: def.type & ~0x8000,
        ofs: def.ofs,
      });
    }

    /** @type {{ first_statement: number, parm_start: number, locals: number, s_name: number, s_file: number, numparms: number, parm_size: number[] }[]} */
    this.functions = new Array(this.numFunctions);
    /** @type {Map<string, number>} */
    this.functionByName = new Map();
    for (let i = 0; i < this.numFunctions; i++) {
      const o = this.ofsFunctions + i * 36;
      const parm_size = [];
      for (let j = 0; j < 8; j++) parm_size.push(this._u8[o + 28 + j]);
      const fn = {
        first_statement: v.getInt32(o, true),
        parm_start: v.getInt32(o + 4, true),
        locals: v.getInt32(o + 8, true),
        s_name: v.getInt32(o + 16, true),
        s_file: v.getInt32(o + 20, true),
        numparms: v.getInt32(o + 24, true),
        parm_size,
      };
      this.functions[i] = fn;
      const name = this.getString(fn.s_name);
      if (name) this.functionByName.set(name, i);
    }

    // Globals buffer (float + int views)
    const globBytes = this.numGlobals * 4;
    this.globalsBuf = new ArrayBuffer(globBytes);
    this.globalsF = new Float32Array(this.globalsBuf);
    this.globalsI = new Int32Array(this.globalsBuf);
    for (let i = 0; i < this.numGlobals; i++) {
      this.globalsI[i] = v.getInt32(this.ofsGlobals + i * 4, true);
    }

    /** @type {Map<string, number>} */
    this.globalOfs = new Map();
    for (const def of this.globaldefs) {
      const name = this.getString(def.s_name);
      if (name) this.globalOfs.set(name, def.ofs);
    }

    // Cache hot global offsets
    this.ofs = {
      self: this.requireGlobal('self'),
      other: this.requireGlobal('other'),
      world: this.requireGlobal('world'),
      time: this.requireGlobal('time'),
      frametime: this.requireGlobal('frametime'),
      force_retouch: this.requireGlobal('force_retouch'),
      mapname: this.requireGlobal('mapname'),
      deathmatch: this.requireGlobal('deathmatch'),
      coop: this.requireGlobal('coop'),
      StartFrame: this.requireGlobal('StartFrame'),
      PlayerPreThink: this.requireGlobal('PlayerPreThink'),
      PlayerPostThink: this.requireGlobal('PlayerPostThink'),
      ClientConnect: this.requireGlobal('ClientConnect'),
      PutClientInServer: this.requireGlobal('PutClientInServer'),
      SetNewParms: this.requireGlobal('SetNewParms'),
      v_forward: this.requireGlobal('v_forward'),
      v_right: this.requireGlobal('v_right'),
      v_up: this.requireGlobal('v_up'),
      trace_allsolid: this.requireGlobal('trace_allsolid'),
      trace_startsolid: this.requireGlobal('trace_startsolid'),
      trace_fraction: this.requireGlobal('trace_fraction'),
      trace_endpos: this.requireGlobal('trace_endpos'),
      trace_plane_normal: this.requireGlobal('trace_plane_normal'),
      trace_plane_dist: this.requireGlobal('trace_plane_dist'),
      trace_ent: this.requireGlobal('trace_ent'),
      trace_inopen: this.requireGlobal('trace_inopen'),
      trace_inwater: this.requireGlobal('trace_inwater'),
    };

    // Cache hot field offsets
    this.f = {
      modelindex: this.requireField('modelindex'),
      absmin: this.requireField('absmin'),
      absmax: this.requireField('absmax'),
      ltime: this.requireField('ltime'),
      movetype: this.requireField('movetype'),
      solid: this.requireField('solid'),
      origin: this.requireField('origin'),
      oldorigin: this.requireField('oldorigin'),
      velocity: this.requireField('velocity'),
      angles: this.requireField('angles'),
      avelocity: this.requireField('avelocity'),
      classname: this.requireField('classname'),
      model: this.requireField('model'),
      frame: this.requireField('frame'),
      mins: this.requireField('mins'),
      maxs: this.requireField('maxs'),
      size: this.requireField('size'),
      touch: this.requireField('touch'),
      use: this.requireField('use'),
      think: this.requireField('think'),
      blocked: this.requireField('blocked'),
      nextthink: this.requireField('nextthink'),
      groundentity: this.requireField('groundentity'),
      health: this.requireField('health'),
      flags: this.requireField('flags'),
      spawnflags: this.requireField('spawnflags'),
      target: this.requireField('target'),
      targetname: this.requireField('targetname'),
      owner: this.requireField('owner'),
      movedir: this.requireField('movedir'),
      message: this.requireField('message'),
      noise: this.requireField('noise'),
      chain: this.requireField('chain'),
      view_ofs: this.requireField('view_ofs'),
      button0: this.requireField('button0'),
      button1: this.requireField('button1'),
      button2: this.requireField('button2'),
      impulse: this.requireField('impulse'),
      fixangle: this.requireField('fixangle'),
      v_angle: this.requireField('v_angle'),
      netname: this.requireField('netname'),
      colormap: this.requireField('colormap'),
      items: this.requireField('items'),
      weapon: this.requireField('weapon'),
      weaponmodel: this.requireField('weaponmodel'),
      weaponframe: this.requireField('weaponframe'),
      currentammo: this.requireField('currentammo'),
      ammo_shells: this.requireField('ammo_shells'),
      ammo_nails: this.requireField('ammo_nails'),
      ammo_rockets: this.requireField('ammo_rockets'),
      ammo_cells: this.requireField('ammo_cells'),
      armortype: this.requireField('armortype'),
      armorvalue: this.requireField('armorvalue'),
      waterlevel: this.requireField('waterlevel'),
      watertype: this.requireField('watertype'),
      attack_finished: this.fieldByName.get('attack_finished')?.ofs ?? -1,
      ideal_yaw: this.fieldByName.get('ideal_yaw')?.ofs ?? -1,
      yaw_speed: this.fieldByName.get('yaw_speed')?.ofs ?? -1,
    };

    this.stringTemp = 0;
  }

  /**
   * @param {string} name
   * @returns {number}
   */
  requireGlobal(name) {
    const ofs = this.globalOfs.get(name);
    if (ofs === undefined) throw new Error(`Missing global ${name}`);
    return ofs;
  }

  /**
   * @param {string} name
   * @returns {number}
   */
  requireField(name) {
    const f = this.fieldByName.get(name);
    if (!f) throw new Error(`Missing field ${name}`);
    return f.ofs;
  }

  /**
   * @param {number} ofs
   * @returns {string}
   */
  getString(ofs) {
    if (ofs < 0 || ofs >= this.numStrings) return '';
    let s = '';
    let i = this.ofsStrings + ofs;
    while (i < this._u8.length) {
      const c = this._u8[i++];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /**
   * Allocate a temp string in the string blob (append to end of our copy).
   * For builtins that return strings — use globals return area with dynamic pool.
   * @param {string} s
   * @returns {number} string offset
   */
  allocString(s) {
    // Grow a side buffer of dynamic strings
    if (!this._dynStrings) {
      /** @type {string[]} */
      this._dynStrings = [];
      this._dynBase = 0x40000000; // high bit region
    }
    const idx = this._dynStrings.length;
    this._dynStrings.push(s);
    return this._dynBase + idx;
  }

  /**
   * @param {number} ofs
   * @returns {string}
   */
  stringAt(ofs) {
    if (ofs >= 0x40000000) {
      return this._dynStrings[ofs - 0x40000000] || '';
    }
    return this.getString(ofs);
  }

  /**
   * @param {string} name
   * @returns {number} function index or 0
   */
  findFunction(name) {
    return this.functionByName.get(name) || 0;
  }
}
