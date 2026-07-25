/**
 * Quake search-path filesystem (common.c COM_* subset).
 * Loads id1 pak0/pak1 from a URL base; later packs override earlier for same path.
 */

import { PakFile } from './PakFile.js';

/**
 * @param {string} baseUrl
 * @param {string} relative
 */
async function fetchOk(baseUrl, relative) {
  const url = `${baseUrl.replace(/\/$/, '')}/${relative}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

export class FileSystem {
  constructor() {
    /** @type {PakFile[]} later packs searched first (pak1 then pak0) */
    this._packs = [];
    this.baseUrl = '';
  }

  /**
   * Load assets/id1/pak0.pak (+ pak1 if present). Tries lower/upper case names.
   * @param {string} [baseUrl='./assets/id1']
   */
  async initId1(baseUrl = './assets/id1') {
    this.baseUrl = baseUrl;
    this._packs = [];

    const names = [
      ['pak1.pak', 'PAK1.PAK'],
      ['pak0.pak', 'PAK0.PAK'],
    ];

    /** @type {PakFile[]} */
    const loaded = [];
    for (const variants of names) {
      let buf = null;
      let used = '';
      for (const v of variants) {
        buf = await fetchOk(baseUrl, v);
        if (buf) {
          used = v;
          break;
        }
      }
      if (!buf) continue;
      const pak = new PakFile(buf, used);
      loaded.push(pak);
      console.info(`[fs] Added pack ${used} (${pak.fileCount} files)`);
    }

    if (loaded.length === 0) {
      throw new Error(`No PAK files found under ${baseUrl} (need pak0.pak)`);
    }

    // Search order: pak1 first (registered overrides), then pak0 — matches COM (later path wins)
    // We loaded pak1 then pak0 into `loaded`; search front-to-back.
    this._packs = loaded;

    if (!this.has('gfx/palette.lmp')) {
      throw new Error('gfx/palette.lmp missing from PAK');
    }
  }

  /**
   * Load PAK buffers from user-selected File objects (file picker fallback).
   * @param {File[]} files
   */
  async initFromFiles(files) {
    this.baseUrl = 'file-picker';
    this._packs = [];
    /** @type {Map<string, ArrayBuffer>} */
    const byName = new Map();
    for (const f of files) {
      const key = f.name.replace(/\\/g, '/').toLowerCase();
      const base = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
      byName.set(base, await f.arrayBuffer());
    }
    /** @type {PakFile[]} */
    const loaded = [];
    for (const name of ['pak1.pak', 'pak0.pak']) {
      const buf = byName.get(name);
      if (!buf) continue;
      const pak = new PakFile(buf, name);
      loaded.push(pak);
      console.info(`[fs] Added pack ${name} (${pak.fileCount} files) [picker]`);
    }
    if (loaded.length === 0 || !byName.has('pak0.pak')) {
      throw new Error('Need at least pak0.pak (select pak0.pak and optionally pak1.pak)');
    }
    this._packs = loaded;
    if (!this.has('gfx/palette.lmp')) {
      throw new Error('gfx/palette.lmp missing from PAK');
    }
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    const key = name.replace(/\\/g, '/').toLowerCase();
    for (const pak of this._packs) {
      if (pak.has(key)) return true;
    }
    return false;
  }

  /**
   * @param {string} name
   * @returns {Uint8Array}
   */
  load(name) {
    const key = name.replace(/\\/g, '/').toLowerCase();
    for (const pak of this._packs) {
      const data = pak.read(key);
      if (data) return data;
    }
    throw new Error(`File not found: ${name}`);
  }

  /**
   * @param {string} name
   * @returns {string}
   */
  loadText(name) {
    const data = this.load(name);
    let s = '';
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /**
   * 256 RGB triplets from gfx/palette.lmp
   * @returns {Uint8Array} length 768
   */
  loadPalette() {
    const pal = this.load('gfx/palette.lmp');
    if (pal.length < 768) {
      throw new Error('palette.lmp too small');
    }
    return pal.subarray(0, 768);
  }
}
