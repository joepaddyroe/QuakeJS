/**
 * Quake alias MDL loader (Mod_LoadAliasModel subset).
 * IDPO / ALIAS_VERSION 6.
 */

const IDPOLYHEADER = 0x4f504449; // 'IDPO' little-endian
const ALIAS_VERSION = 6;
const ALIAS_SINGLE = 0;
const ALIAS_SKIN_SINGLE = 0;

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

export class AliasModel {
  /**
   * @param {Uint8Array} data
   * @param {Uint8Array} palette
   * @param {string} [name]
   */
  constructor(data, palette, name = 'alias') {
    this.name = name;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 0;
    const ident = view.getUint32(o, true);
    o += 4;
    const version = view.getInt32(o, true);
    o += 4;
    if (ident !== IDPOLYHEADER || version !== ALIAS_VERSION) {
      throw new Error(`${name}: not alias MDL v6 (ident=${ident} ver=${version})`);
    }

    this.scale = [
      view.getFloat32(o, true),
      view.getFloat32(o + 4, true),
      view.getFloat32(o + 8, true),
    ];
    o += 12;
    this.scaleOrigin = [
      view.getFloat32(o, true),
      view.getFloat32(o + 4, true),
      view.getFloat32(o + 8, true),
    ];
    o += 12;
    o += 4; // boundingradius
    o += 12; // eyeposition
    this.numSkins = view.getInt32(o, true);
    o += 4;
    this.skinWidth = view.getInt32(o, true);
    o += 4;
    this.skinHeight = view.getInt32(o, true);
    o += 4;
    this.numVerts = view.getInt32(o, true);
    o += 4;
    this.numTris = view.getInt32(o, true);
    o += 4;
    this.numFrames = view.getInt32(o, true);
    o += 4;
    o += 4; // synctype
    o += 4; // flags
    o += 4; // size

    const skinSize = this.skinWidth * this.skinHeight;
    /** @type {Uint8Array[]} RGBA skins */
    this.skins = [];

    for (let s = 0; s < this.numSkins; s++) {
      const skintype = view.getInt32(o, true);
      o += 4;
      if (skintype === ALIAS_SKIN_SINGLE) {
        const indexed = data.subarray(o, o + skinSize);
        o += skinSize;
        this.skins.push(
          expandIndexed(palette, indexed, this.skinWidth, this.skinHeight),
        );
      } else {
        // Skin group — take first skin only
        const groupSkins = view.getInt32(o, true);
        o += 4;
        o += groupSkins * 4; // intervals
        const indexed = data.subarray(o, o + skinSize);
        o += skinSize;
        this.skins.push(
          expandIndexed(palette, indexed, this.skinWidth, this.skinHeight),
        );
        for (let k = 1; k < groupSkins; k++) o += skinSize;
      }
    }

    /** @type {{ onseam: boolean, s: number, t: number }[]} */
    this.stVerts = [];
    for (let i = 0; i < this.numVerts; i++) {
      const onseam = view.getInt32(o, true);
      const s = view.getInt32(o + 4, true);
      const t = view.getInt32(o + 8, true);
      o += 12;
      this.stVerts.push({ onseam: onseam !== 0, s, t });
    }

    /** @type {{ facesFront: boolean, verts: [number, number, number] }[]} */
    this.triangles = [];
    for (let i = 0; i < this.numTris; i++) {
      const facesFront = view.getInt32(o, true);
      const v0 = view.getInt32(o + 4, true);
      const v1 = view.getInt32(o + 8, true);
      const v2 = view.getInt32(o + 12, true);
      o += 16;
      this.triangles.push({
        facesFront: !!facesFront,
        verts: [v0, v1, v2],
      });
    }

    /** @type {Float32Array[]} each: numVerts * 3 floats (world-scaled) */
    this.frames = [];

    for (let f = 0; f < this.numFrames; f++) {
      const frametype = view.getInt32(o, true);
      o += 4;
      if (frametype === ALIAS_SINGLE) {
        o = this._loadFrame(data, view, o);
      } else {
        const num = view.getInt32(o, true);
        o += 4;
        o += 8; // bbox min/max trivertx (4+4)
        o += num * 4; // intervals
        for (let g = 0; g < num; g++) {
          o = this._loadFrame(data, view, o, g === 0);
        }
      }
    }

    if (!this.skins.length) {
      this.skins.push(new Uint8Array(this.skinWidth * this.skinHeight * 4).fill(255));
    }
  }

  /**
   * @param {Uint8Array} data
   * @param {DataView} view
   * @param {number} o
   * @param {boolean} [store=true]
   */
  _loadFrame(data, view, o, store = true) {
    o += 4; // bboxmin trivertx
    o += 4; // bboxmax
    o += 16; // name
    const pos = new Float32Array(this.numVerts * 3);
    const sx = this.scale[0];
    const sy = this.scale[1];
    const sz = this.scale[2];
    const ox = this.scaleOrigin[0];
    const oy = this.scaleOrigin[1];
    const oz = this.scaleOrigin[2];
    for (let i = 0; i < this.numVerts; i++) {
      const vx = data[o++];
      const vy = data[o++];
      const vz = data[o++];
      o++; // lightnormalindex
      pos[i * 3] = vx * sx + ox;
      pos[i * 3 + 1] = vy * sy + oy;
      pos[i * 3 + 2] = vz * sz + oz;
    }
    if (store) this.frames.push(pos);
    return o;
  }

  /**
   * Interleaved pos.xyz + uv.xy for one frame (tri list).
   * @param {number} frame
   * @returns {Float32Array}
   */
  buildMesh(frame) {
    return this.buildMeshLerped(frame, frame, 1);
  }

  /**
   * Vertex lerp between two poses (r_lerpmodels / Quakespasm-style).
   * @param {number} frame0 previous pose
   * @param {number} frame1 current pose
   * @param {number} blend 0 = frame0, 1 = frame1
   * @returns {Float32Array}
   */
  buildMeshLerped(frame0, frame1, blend) {
    const n = this.frames.length;
    if (!n) return new Float32Array(0);
    const i0 = Math.max(0, Math.min(n - 1, frame0 | 0));
    const i1 = Math.max(0, Math.min(n - 1, frame1 | 0));
    const fr0 = this.frames[i0];
    const fr1 = this.frames[i1];
    if (!fr0 || !fr1) return new Float32Array(0);
    const b = blend <= 0 ? 0 : blend >= 1 ? 1 : blend;
    const same = i0 === i1 || b >= 1;
    const halfW = this.skinWidth * 0.5;
    const out = new Float32Array(this.numTris * 3 * 5);
    let w = 0;
    for (const tri of this.triangles) {
      for (let k = 0; k < 3; k++) {
        const vi = tri.verts[k];
        const st = this.stVerts[vi];
        let s = st.s;
        const t = st.t;
        if (!tri.facesFront && st.onseam) s += halfW;
        const o = vi * 3;
        if (same) {
          out[w++] = fr1[o];
          out[w++] = fr1[o + 1];
          out[w++] = fr1[o + 2];
        } else {
          out[w++] = fr0[o] + (fr1[o] - fr0[o]) * b;
          out[w++] = fr0[o + 1] + (fr1[o + 1] - fr0[o + 1]) * b;
          out[w++] = fr0[o + 2] + (fr1[o + 2] - fr0[o + 2]) * b;
        }
        out[w++] = (s + 0.5) / this.skinWidth;
        out[w++] = (t + 0.5) / this.skinHeight;
      }
    }
    return out;
  }
}
