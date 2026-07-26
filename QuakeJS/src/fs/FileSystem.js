/**
 * Quake search-path filesystem (common.c COM_* subset).
 * Loads id1 pak0/pak1; **pak1 is searched first** so registered files win.
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
    /** @type {PakFile[]} searched front-to-back (pak1 then pak0) */
    this._packs = [];
    this.baseUrl = '';
    /** COM_CheckRegistered — true when gfx/pop.lmp is present (full game) */
    this.registered = false;
  }

  /**
   * Load assets/id1 — prefer pak1 (registered) when present, then pak0.
   * @param {string} [baseUrl='./assets/id1']
   */
  async initId1(baseUrl = './assets/id1') {
    this.baseUrl = baseUrl;
    this._packs = [];

    // Load order into search list: pak1 first (overrides), then pak0
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
      throw new Error(
        `No PAK files found under ${baseUrl} (need pak0.pak and/or pak1.pak)`,
      );
    }

    const hasPal = loaded.some((p) => p.has('gfx/palette.lmp'));
    if (!hasPal) {
      throw new Error('gfx/palette.lmp missing from PAK');
    }

    this._packs = loaded;
    this._checkRegistered();
  }

  /**
   * Load PAK buffers from user-selected File objects (file picker fallback).
   * Prefers pak1 over pak0 in the search path when both are selected.
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
    if (loaded.length === 0 || (!byName.has('pak0.pak') && !byName.has('pak1.pak'))) {
      throw new Error('Need at least pak0.pak or pak1.pak (full game prefers pak1.pak)');
    }
    this._packs = loaded;
    if (!this.has('gfx/palette.lmp')) {
      throw new Error('gfx/palette.lmp missing from PAK');
    }
    this._checkRegistered();
  }

  /**
   * COM_CheckRegistered — gfx/pop.lmp marks the full registered build.
   */
  _checkRegistered() {
    this.registered = this.has('gfx/pop.lmp');
    if (this.registered) {
      console.info('[fs] Playing registered version (pak1 / gfx/pop.lmp).');
    } else {
      console.info('[fs] Playing shareware version (pak0).');
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
