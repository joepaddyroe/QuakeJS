/**
 * sizebuf_t / MSG_Write* / MSG_Read* subset (common.c).
 */

export class SizeBuf {
  /**
   * @param {number} [maxSize=8192]
   */
  constructor(maxSize = 8192) {
    this.maxSize = maxSize;
    this.data = new Uint8Array(maxSize);
    this.view = new DataView(this.data.buffer);
    this.cursize = 0;
    this.readcount = 0;
    this.overflowed = false;
  }

  clear() {
    this.cursize = 0;
    this.readcount = 0;
    this.overflowed = false;
  }

  /**
   * @returns {Uint8Array}
   */
  bytes() {
    return this.data.subarray(0, this.cursize);
  }

  /**
   * @param {Uint8Array} src
   */
  beginRead(src) {
    const n = Math.min(src.length, this.maxSize);
    this.data.set(src.subarray(0, n), 0);
    this.cursize = n;
    this.readcount = 0;
    this.overflowed = false;
  }

  /** @param {number} c */
  writeByte(c) {
    if (this.cursize + 1 > this.maxSize) {
      this.overflowed = true;
      return;
    }
    this.data[this.cursize++] = c & 0xff;
  }

  /** @param {number} c */
  writeChar(c) {
    this.writeByte(c);
  }

  /** @param {number} c */
  writeShort(c) {
    if (this.cursize + 2 > this.maxSize) {
      this.overflowed = true;
      return;
    }
    this.view.setInt16(this.cursize, c | 0, true);
    this.cursize += 2;
  }

  /** @param {number} c */
  writeLong(c) {
    if (this.cursize + 4 > this.maxSize) {
      this.overflowed = true;
      return;
    }
    this.view.setInt32(this.cursize, c | 0, true);
    this.cursize += 4;
  }

  /** @param {number} f */
  writeFloat(f) {
    if (this.cursize + 4 > this.maxSize) {
      this.overflowed = true;
      return;
    }
    this.view.setFloat32(this.cursize, f, true);
    this.cursize += 4;
  }

  /** Quake MSG_WriteCoord */
  writeCoord(f) {
    this.writeShort((f * 8) | 0);
  }

  /** Quake MSG_WriteAngle */
  writeAngle(f) {
    this.writeByte(((f * 256) / 360) | 0);
  }

  /** @param {string} s */
  writeString(s) {
    const str = s || '';
    for (let i = 0; i < str.length; i++) {
      this.writeByte(str.charCodeAt(i) & 0xff);
    }
    this.writeByte(0);
  }

  readByte() {
    if (this.readcount + 1 > this.cursize) return -1;
    return this.data[this.readcount++];
  }

  readChar() {
    const c = this.readByte();
    return c === -1 ? -1 : (c << 24) >> 24;
  }

  readShort() {
    if (this.readcount + 2 > this.cursize) return -1;
    const v = this.view.getInt16(this.readcount, true);
    this.readcount += 2;
    return v;
  }

  readLong() {
    if (this.readcount + 4 > this.cursize) return -1;
    const v = this.view.getInt32(this.readcount, true);
    this.readcount += 4;
    return v;
  }

  readFloat() {
    if (this.readcount + 4 > this.cursize) return 0;
    const v = this.view.getFloat32(this.readcount, true);
    this.readcount += 4;
    return v;
  }

  readCoord() {
    return this.readShort() * (1 / 8);
  }

  readAngle() {
    return this.readByte() * (360 / 256);
  }

  readString() {
    let s = '';
    while (true) {
      const c = this.readByte();
      if (c <= 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  get remaining() {
    return this.cursize - this.readcount;
  }
}
