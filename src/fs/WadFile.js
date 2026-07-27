/**
 * Quake WAD2 reader (wad.c W_LoadWadFile / W_GetLumpName).
 * Used for gfx.wad status-bar and UI pics.
 */

/** @typedef {{ width: number, height: number, pixels: Uint8Array }} QPic */

const LUMP_SIZE = 32;

/**
 * @param {ArrayBuffer|Uint8Array} source
 * @param {string} [label]
 */
export class WadFile {
  /**
   * @param {ArrayBuffer|Uint8Array} source
   * @param {string} [label]
   */
  constructor(source, label = 'wad') {
    this.label = label;
    const bytes =
      source instanceof Uint8Array ? source : new Uint8Array(source);
    this._bytes = bytes;
    /** @type {Map<string, { offset: number, size: number, type: number }>} */
    this._index = new Map();

    const id = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (id !== 'WAD2' && id !== '2DAW') {
      throw new Error(`${label}: not a WAD2 file (got "${id}")`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numlumps = view.getInt32(4, true);
    const infotableofs = view.getInt32(8, true);
    if (numlumps < 0 || infotableofs < 0) {
      throw new Error(`${label}: invalid header`);
    }

    for (let i = 0; i < numlumps; i++) {
      const o = infotableofs + i * LUMP_SIZE;
      const filepos = view.getInt32(o, true);
      const size = view.getInt32(o + 8, true);
      const type = bytes[o + 12];
      let name = '';
      for (let c = 0; c < 16; c++) {
        const ch = bytes[o + 16 + c];
        if (ch === 0) break;
        name += String.fromCharCode(ch);
      }
      const key = name.toLowerCase();
      this._index.set(key, { offset: filepos, size, type });
    }
  }

  /** @returns {number} */
  get lumpCount() {
    return this._index.size;
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._index.has(name.toLowerCase());
  }

  /**
   * Raw lump bytes (view into wad buffer).
   * @param {string} name
   * @returns {Uint8Array}
   */
  getLump(name) {
    const ent = this._index.get(name.toLowerCase());
    if (!ent) throw new Error(`${this.label}: missing lump "${name}"`);
    return this._bytes.subarray(ent.offset, ent.offset + ent.size);
  }

  /**
   * Parse a TYP_QPIC lump: int width, height, then indexed pixels.
   * @param {string} name
   * @returns {QPic}
   */
  getPic(name) {
    const lump = this.getLump(name);
    if (lump.length < 8) {
      throw new Error(`${this.label}: pic "${name}" too small`);
    }
    const view = new DataView(lump.buffer, lump.byteOffset, lump.byteLength);
    const width = view.getInt32(0, true);
    const height = view.getInt32(4, true);
    if (width <= 0 || height <= 0 || 8 + width * height > lump.length) {
      throw new Error(`${this.label}: bad pic dimensions for "${name}"`);
    }
    return {
      width,
      height,
      pixels: lump.subarray(8, 8 + width * height),
    };
  }
}
