/**
 * Demo record / playback (cl_demo.c subset) — Quake .dem message stream.
 * Playback prefers filesystem (PAK demo1–3); record still uses localStorage.
 */

import { ensureExt, readConfig, writeConfig } from '../app/ConfigIO.js';

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * @param {string} b64
 * @returns {Uint8Array}
 */
function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class DemoRecorder {
  constructor() {
    /** @type {number[]} */
    this._chunks = [];
    this.recording = false;
    this.name = '';
  }

  /**
   * @param {string} name
   * @param {number} [cdtrack=-1]
   */
  start(name, cdtrack = -1) {
    this.name = ensureExt(name, '.dem');
    this._chunks = [];
    const hdr = `${cdtrack | 0}\n`;
    for (let i = 0; i < hdr.length; i++) this._chunks.push(hdr.charCodeAt(i));
    this.recording = true;
  }

  /**
   * CL_WriteDemoMessage
   * @param {Uint8Array} msgBytes
   * @param {Float32Array|number[]} viewangles pitch yaw roll
   */
  writeMessage(msgBytes, viewangles) {
    if (!this.recording || !msgBytes.length) return;
    const len = msgBytes.length;
    const buf = new ArrayBuffer(4 + 12 + len);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    view.setInt32(0, len, true);
    view.setFloat32(4, viewangles[0] || 0, true);
    view.setFloat32(8, viewangles[1] || 0, true);
    view.setFloat32(12, viewangles[2] || 0, true);
    u8.set(msgBytes, 16);
    for (let i = 0; i < u8.length; i++) this._chunks.push(u8[i]);
  }

  /**
   * @returns {boolean}
   */
  stop() {
    if (!this.recording) return false;
    this.recording = false;
    const bytes = new Uint8Array(this._chunks);
    return writeConfig(this.name, toBase64(bytes));
  }
}

export class DemoPlayer {
  constructor() {
    this.playing = false;
    this.name = '';
    /** @type {Uint8Array} */
    this._data = new Uint8Array(0);
    this._pos = 0;
    this.cdtrack = -1;
  }

  /**
   * Open a .dem from PAK / filesystem, falling back to localStorage recordings.
   * @param {string} name
   * @param {import('../fs/FileSystem.js').FileSystem} [fs]
   */
  open(name, fs) {
    const file = ensureExt(name, '.dem');
    /** @type {Uint8Array|null} */
    let data = null;

    if (fs) {
      const candidates = [file, file.toLowerCase(), name, `${name}.dem`];
      for (const c of candidates) {
        if (fs.has(c)) {
          data = fs.load(c);
          break;
        }
      }
    }
    if (!data) {
      const b64 = readConfig(file);
      if (b64) data = fromBase64(b64);
    }
    if (!data) throw new Error(`couldn't open ${file}`);

    this._data = data;
    this._pos = 0;
    this.name = file;
    let line = '';
    while (this._pos < this._data.length) {
      const c = this._data[this._pos++];
      if (c === 10) break;
      if (c === 13) continue;
      line += String.fromCharCode(c);
    }
    this.cdtrack = parseInt(line, 10);
    if (Number.isNaN(this.cdtrack)) this.cdtrack = -1;
    this.playing = true;
  }

  stop() {
    this.playing = false;
    this._data = new Uint8Array(0);
    this._pos = 0;
  }

  /**
   * Read next demo message into out SizeBuf-like { beginRead }.
   * @param {import('../net/SizeBuf.js').SizeBuf} out
   * @param {Float32Array} viewanglesOut
   * @returns {boolean}
   */
  readMessage(out, viewanglesOut) {
    if (!this.playing) return false;
    if (this._pos + 16 > this._data.length) {
      this.playing = false;
      return false;
    }
    const view = new DataView(
      this._data.buffer,
      this._data.byteOffset + this._pos,
      this._data.length - this._pos,
    );
    const len = view.getInt32(0, true);
    if (len < 0 || this._pos + 16 + len > this._data.length) {
      this.playing = false;
      return false;
    }
    viewanglesOut[0] = view.getFloat32(4, true);
    viewanglesOut[1] = view.getFloat32(8, true);
    viewanglesOut[2] = view.getFloat32(12, true);
    const payload = this._data.subarray(this._pos + 16, this._pos + 16 + len);
    this._pos += 16 + len;
    out.beginRead(payload);
    return true;
  }
}
