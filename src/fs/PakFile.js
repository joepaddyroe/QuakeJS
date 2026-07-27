/**
 * Quake PAK archive reader (common.c COM_LoadPackFile).
 * On-disk: dpackheader_t + directory of dpackfile_t { name[56], filepos, filelen }.
 */

const HEADER_SIZE = 12;
const DIR_ENTRY_SIZE = 64; // 56 + 4 + 4

/**
 * @param {ArrayBuffer} buffer
 * @param {string} [label]
 */
export class PakFile {
  /**
   * @param {ArrayBuffer} buffer
   * @param {string} [label]
   */
  constructor(buffer, label = 'pak') {
    this.label = label;
    this._buffer = buffer;
    this._bytes = new Uint8Array(buffer);
    /** @type {Map<string, { offset: number, length: number }>} */
    this._index = new Map();

    const view = new DataView(buffer);
    const id = String.fromCharCode(
      this._bytes[0],
      this._bytes[1],
      this._bytes[2],
      this._bytes[3],
    );
    if (id !== 'PACK') {
      throw new Error(`${label}: not a PACK file (got "${id}")`);
    }
    const dirofs = view.getInt32(4, true);
    const dirlen = view.getInt32(8, true);
    if (dirofs < 0 || dirlen < 0 || dirofs + dirlen > buffer.byteLength) {
      throw new Error(`${label}: invalid directory`);
    }
    const numFiles = dirlen / DIR_ENTRY_SIZE;
    if (numFiles !== (numFiles | 0)) {
      throw new Error(`${label}: directory length not aligned`);
    }

    for (let i = 0; i < numFiles; i++) {
      const off = dirofs + i * DIR_ENTRY_SIZE;
      let name = '';
      for (let c = 0; c < 56; c++) {
        const ch = this._bytes[off + c];
        if (ch === 0) break;
        name += String.fromCharCode(ch);
      }
      const filepos = view.getInt32(off + 56, true);
      const filelen = view.getInt32(off + 60, true);
      const key = name.replace(/\\/g, '/').toLowerCase();
      this._index.set(key, { offset: filepos, length: filelen });
    }
  }

  /** @returns {number} */
  get fileCount() {
    return this._index.size;
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._index.has(name.replace(/\\/g, '/').toLowerCase());
  }

  /**
   * @param {string} name
   * @returns {Uint8Array|null} view into pak buffer (do not mutate)
   */
  read(name) {
    const ent = this._index.get(name.replace(/\\/g, '/').toLowerCase());
    if (!ent) return null;
    return this._bytes.subarray(ent.offset, ent.offset + ent.length);
  }

  /**
   * @param {string} name
   * @returns {ArrayBuffer|null} copy
   */
  readCopy(name) {
    const slice = this.read(name);
    if (!slice) return null;
    return slice.slice().buffer;
  }
}
