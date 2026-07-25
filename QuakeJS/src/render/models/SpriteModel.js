/**
 * Quake sprite SPR loader (Mod_LoadSpriteModel subset).
 * IDSP / SPRITE_VERSION 1.
 */

const IDSPRITEHEADER = 0x50534449; // 'IDSP' little-endian
const SPRITE_VERSION = 1;
const SPR_SINGLE = 0;
const SPR_GROUP = 1;

export const SPR_VP_PARALLEL_UPRIGHT = 0;
export const SPR_FACING_UPRIGHT = 1;
export const SPR_VP_PARALLEL = 2;
export const SPR_ORIENTED = 3;
export const SPR_VP_PARALLEL_ORIENTED = 4;

/**
 * @param {Uint8Array} palette RGB 768 bytes
 * @param {Uint8Array} indexed
 * @param {number} width
 * @param {number} height
 */
function expandIndexed(palette, indexed, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = indexed[i] * 3;
    const o = i * 4;
    out[o] = palette[p];
    out[o + 1] = palette[p + 1];
    out[o + 2] = palette[p + 2];
    out[o + 3] = indexed[i] === 255 ? 0 : 255;
  }
  return out;
}

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   up: number,
 *   down: number,
 *   left: number,
 *   right: number,
 *   rgba: Uint8Array,
 * }} SpriteFrame
 */

/**
 * @typedef {{
 *   type: 'single',
 *   frame: SpriteFrame,
 * } | {
 *   type: 'group',
 *   intervals: Float32Array,
 *   frames: SpriteFrame[],
 * }} SpriteFrameDesc
 */

export class SpriteModel {
  /**
   * @param {Uint8Array} data
   * @param {Uint8Array} palette
   * @param {string} [name]
   */
  constructor(data, palette, name = 'sprite') {
    this.name = name;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 0;
    const ident = view.getUint32(o, true);
    o += 4;
    const version = view.getInt32(o, true);
    o += 4;
    if (ident !== IDSPRITEHEADER || version !== SPRITE_VERSION) {
      throw new Error(`${name}: not SPR v1 (ident=${ident} ver=${version})`);
    }

    this.type = view.getInt32(o, true);
    o += 4;
    o += 4; // boundingradius
    this.maxWidth = view.getInt32(o, true);
    o += 4;
    this.maxHeight = view.getInt32(o, true);
    o += 4;
    const numframes = view.getInt32(o, true);
    o += 4;
    this.beamlength = view.getFloat32(o, true);
    o += 4;
    this.synctype = view.getInt32(o, true);
    o += 4;

    if (numframes < 1) {
      throw new Error(`${name}: invalid frame count ${numframes}`);
    }

    this.mins = new Float32Array([
      -this.maxWidth / 2,
      -this.maxWidth / 2,
      -this.maxHeight / 2,
    ]);
    this.maxs = new Float32Array([
      this.maxWidth / 2,
      this.maxWidth / 2,
      this.maxHeight / 2,
    ]);

    /** @type {SpriteFrameDesc[]} */
    this.frames = [];
    for (let i = 0; i < numframes; i++) {
      const frametype = view.getInt32(o, true);
      o += 4;
      if (frametype === SPR_SINGLE) {
        const loaded = loadFrame(view, data, o, palette);
        this.frames.push({ type: 'single', frame: loaded.frame });
        o = loaded.next;
      } else if (frametype === SPR_GROUP) {
        const loaded = loadGroup(view, data, o, palette);
        this.frames.push({
          type: 'group',
          intervals: loaded.intervals,
          frames: loaded.frames,
        });
        o = loaded.next;
      } else {
        throw new Error(`${name}: bad frametype ${frametype}`);
      }
    }
  }

  /**
   * R_GetSpriteFrame — resolve group animation by time.
   * @param {number} frame
   * @param {number} time
   * @returns {SpriteFrame}
   */
  getFrame(frame, time) {
    let fi = frame | 0;
    if (fi < 0 || fi >= this.frames.length) fi = 0;
    const desc = this.frames[fi];
    if (desc.type === 'single') return desc.frame;
    const intervals = desc.intervals;
    const full = intervals[intervals.length - 1];
    let target = time - Math.floor(time / full) * full;
    if (target < 0) target = 0;
    let i = 0;
    for (; i < intervals.length - 1; i++) {
      if (intervals[i] > target) break;
    }
    return desc.frames[i];
  }
}

/**
 * @param {DataView} view
 * @param {Uint8Array} data
 * @param {number} o
 * @param {Uint8Array} palette
 */
function loadFrame(view, data, o, palette) {
  const originX = view.getInt32(o, true);
  o += 4;
  const originY = view.getInt32(o, true);
  o += 4;
  const width = view.getInt32(o, true);
  o += 4;
  const height = view.getInt32(o, true);
  o += 4;
  const size = width * height;
  const indexed = data.subarray(o, o + size);
  o += size;
  /** @type {SpriteFrame} */
  const frame = {
    width,
    height,
    up: originY,
    down: originY - height,
    left: originX,
    right: width + originX,
    rgba: expandIndexed(palette, indexed, width, height),
  };
  return { frame, next: o };
}

/**
 * @param {DataView} view
 * @param {Uint8Array} data
 * @param {number} o
 * @param {Uint8Array} palette
 */
function loadGroup(view, data, o, palette) {
  const numframes = view.getInt32(o, true);
  o += 4;
  const intervals = new Float32Array(numframes);
  for (let i = 0; i < numframes; i++) {
    intervals[i] = view.getFloat32(o, true);
    o += 4;
    if (intervals[i] <= 0) {
      throw new Error('Mod_LoadSpriteGroup: interval<=0');
    }
  }
  /** @type {SpriteFrame[]} */
  const frames = [];
  for (let i = 0; i < numframes; i++) {
    const loaded = loadFrame(view, data, o, palette);
    frames.push(loaded.frame);
    o = loaded.next;
  }
  return { intervals, frames, next: o };
}
