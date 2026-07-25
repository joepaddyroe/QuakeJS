/**
 * Quake BSP29 brush model loader (model.c / gl_model.c Mod_LoadBrushModel subset).
 * World submodel 0 only for rendering.
 */

const BSPVERSION = 29;
const HEADER_LUMPS = 15;
const LUMP_ENTITIES = 0;
const LUMP_PLANES = 1;
const LUMP_TEXTURES = 2;
const LUMP_VERTEXES = 3;
const LUMP_VISIBILITY = 4;
const LUMP_NODES = 5;
const LUMP_TEXINFO = 6;
const LUMP_FACES = 7;
const LUMP_LIGHTING = 8;
const LUMP_CLIPNODES = 9;
const LUMP_LEAFS = 10;
const LUMP_MARKSURFACES = 11;
const LUMP_EDGES = 12;
const LUMP_SURFEDGES = 13;
const LUMP_MODELS = 14;

const TEX_SPECIAL = 1;

/**
 * @param {string} entities
 * @returns {{ origin: Float32Array, angles: Float32Array } | null}
 */
export function findPlayerStart(entities) {
  const blocks = entities.split('{');
  for (const block of blocks) {
    if (!/"classname"\s+"info_player_start"/i.test(block)) continue;
    const originMatch = block.match(/"origin"\s+"([^"]+)"/i);
    const angleMatch = block.match(/"angle"\s+"([^"]+)"/i);
    const anglesMatch = block.match(/"angles"\s+"([^"]+)"/i);
    const origin = new Float32Array([0, 0, 0]);
    const angles = new Float32Array([0, 0, 0]);
    if (originMatch) {
      const p = originMatch[1].trim().split(/\s+/).map(Number);
      origin[0] = p[0] || 0;
      origin[1] = p[1] || 0;
      origin[2] = p[2] || 0;
    }
    if (anglesMatch) {
      const p = anglesMatch[1].trim().split(/\s+/).map(Number);
      angles[0] = p[0] || 0;
      angles[1] = p[1] || 0;
      angles[2] = p[2] || 0;
    } else if (angleMatch) {
      angles[1] = Number(angleMatch[1]) || 0;
    }
    return { origin, angles };
  }
  return null;
}

/**
 * @typedef {object} BspTexture
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array|null} pixels  indexed level-0, or null if missing
 * @property {boolean} sky
 * @property {boolean} turb
 */

/**
 * @typedef {object} BspFace
 * @property {number} firstEdge
 * @property {number} numEdges
 * @property {number} texinfo
 * @property {number[]} styles
 * @property {number} lightofs
 * @property {number} planenum
 * @property {number} side
 * @property {boolean} planeBack
 * @property {Int32Array} texturemins
 * @property {Int32Array} extents
 * @property {'solid'|'sky'|'turb'|'skip'} kind
 * @property {number} lightS
 * @property {number} lightT
 * @property {number} lightmapIndex
 * @property {number} visframe
 */

/**
 * @typedef {object} BspNode
 * @property {number} planenum
 * @property {number[]} children  child index; >=0 node, <0 → leaf = -1-child
 * @property {Float32Array} mins
 * @property {Float32Array} maxs
 * @property {number} firstface
 * @property {number} numfaces
 * @property {number} parent  node index or -1
 * @property {number} visframe
 * @property {number} contents  0 for nodes
 */

/**
 * @typedef {object} BspLeaf
 * @property {number} contents
 * @property {number} visofs
 * @property {Float32Array} mins
 * @property {Float32Array} maxs
 * @property {number} firstmarksurface
 * @property {number} nummarksurfaces
 * @property {number} parent  node index or -1
 * @property {number} visframe
 */

export class BspModel {
  /**
   * @param {Uint8Array} data
   * @param {string} [name]
   */
  constructor(data, name = 'maps/unknown.bsp') {
    this.name = name;
    this._buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this._view = new DataView(this._buf);
    this._u8 = new Uint8Array(this._buf);

    /** @type {{ fileofs: number, filelen: number }[]} */
    this.lumps = [];
    /** @type {Float32Array[]} */
    this.vertexes = [];
    /** @type {{ v: [number, number] }[]} */
    this.edges = [];
    /** @type {Int32Array} */
    this.surfedges = new Int32Array(0);
    /** @type {BspTexture[]} */
    this.textures = [];
    /** @type {Uint8Array|null} */
    this.lightdata = null;
    /** @type {{ normal: Float32Array, dist: number, type: number }[]} */
    this.planes = [];
    /** @type {{ vecs: Float32Array, miptex: number, flags: number }[]} */
    this.texinfo = [];
    /** @type {BspFace[]} */
    this.faces = [];
    /** @type {BspNode[]} */
    this.nodes = [];
    /** @type {BspLeaf[]} */
    this.leafs = [];
    /** @type {Uint16Array} */
    this.marksurfaces = new Uint16Array(0);
    /** @type {Uint8Array|null} */
    this.visdata = null;
    /** vis leaf count for PVS row size (submodel 0 visleafs) */
    this.numVisLeafs = 0;
    /** @type {{ mins: Float32Array, maxs: Float32Array, origin: Float32Array, headnode: number[], firstface: number, numfaces: number, visleafs: number }[]} */
    this.submodels = [];
    /** @type {string} */
    this.entities = '';
    /** @type {{ origin: Float32Array, angles: Float32Array } | null} */
    this.playerStart = null;

    this._visframecount = 0;
    this._framecount = 0;
    /** @type {Uint8Array} */
    this._decompressedVis = new Uint8Array(0);

    this._load();
  }

  _load() {
    const v = this._view;
    const version = v.getInt32(0, true);
    if (version !== BSPVERSION) {
      throw new Error(`${this.name}: BSP version ${version}, expected ${BSPVERSION}`);
    }
    for (let i = 0; i < HEADER_LUMPS; i++) {
      const off = 4 + i * 8;
      this.lumps.push({
        fileofs: v.getInt32(off, true),
        filelen: v.getInt32(off + 4, true),
      });
    }

    this._loadVertexes();
    this._loadEdges();
    this._loadSurfedges();
    this._loadTextures();
    this._loadLighting();
    this._loadPlanes();
    this._loadTexinfo();
    this._loadFaces();
    this._loadMarksurfaces();
    this._loadVisibility();
    this._loadLeafs();
    this._loadNodes();
    this._loadEntities();
    this._loadSubmodels();
    this.numVisLeafs = this.submodels[0] ? this.submodels[0].visleafs : this.leafs.length;
    this._decompressedVis = new Uint8Array((this.numVisLeafs + 7) >> 3);
    this.playerStart = findPlayerStart(this.entities);
  }

  /**
   * @param {number} lump
   * @returns {{ ofs: number, len: number }}
   */
  _lump(lump) {
    const L = this.lumps[lump];
    return { ofs: L.fileofs, len: L.filelen };
  }

  _loadVertexes() {
    const { ofs, len } = this._lump(LUMP_VERTEXES);
    const count = len / 12;
    const v = this._view;
    this.vertexes = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 12;
      this.vertexes[i] = new Float32Array([
        v.getFloat32(o, true),
        v.getFloat32(o + 4, true),
        v.getFloat32(o + 8, true),
      ]);
    }
  }

  _loadEdges() {
    const { ofs, len } = this._lump(LUMP_EDGES);
    const count = len / 4;
    const v = this._view;
    this.edges = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 4;
      this.edges[i] = {
        v: [v.getUint16(o, true), v.getUint16(o + 2, true)],
      };
    }
  }

  _loadSurfedges() {
    const { ofs, len } = this._lump(LUMP_SURFEDGES);
    const count = len / 4;
    const arr = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this._view.getInt32(ofs + i * 4, true);
    }
    this.surfedges = arr;
  }

  _loadTextures() {
    const { ofs, len } = this._lump(LUMP_TEXTURES);
    if (len === 0) {
      this.textures = [];
      return;
    }
    const v = this._view;
    const nummiptex = v.getInt32(ofs, true);
    this.textures = new Array(nummiptex);
    for (let i = 0; i < nummiptex; i++) {
      const dataofs = v.getInt32(ofs + 4 + i * 4, true);
      if (dataofs === -1) {
        this.textures[i] = {
          name: 'missing',
          width: 16,
          height: 16,
          pixels: null,
          sky: false,
          turb: false,
        };
        continue;
      }
      const base = ofs + dataofs;
      let name = '';
      for (let c = 0; c < 16; c++) {
        const ch = this._u8[base + c];
        if (ch === 0) break;
        name += String.fromCharCode(ch);
      }
      const width = v.getUint32(base + 16, true);
      const height = v.getUint32(base + 20, true);
      const offset0 = v.getUint32(base + 24, true);
      const lower = name.toLowerCase();
      const sky = lower.startsWith('sky');
      const turb = lower.startsWith('*');
      let pixels = null;
      if (offset0 && width > 0 && height > 0) {
        const pixOff = base + offset0;
        const pixLen = width * height;
        if (pixOff + pixLen <= this._u8.length) {
          pixels = this._u8.subarray(pixOff, pixOff + pixLen);
        }
      }
      this.textures[i] = { name, width, height, pixels, sky, turb };
    }
  }

  _loadLighting() {
    const { ofs, len } = this._lump(LUMP_LIGHTING);
    if (len <= 0) {
      this.lightdata = null;
      return;
    }
    this.lightdata = this._u8.subarray(ofs, ofs + len);
  }

  _loadPlanes() {
    const { ofs, len } = this._lump(LUMP_PLANES);
    const count = len / 20;
    const v = this._view;
    this.planes = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 20;
      this.planes[i] = {
        normal: new Float32Array([
          v.getFloat32(o, true),
          v.getFloat32(o + 4, true),
          v.getFloat32(o + 8, true),
        ]),
        dist: v.getFloat32(o + 12, true),
        type: v.getInt32(o + 16, true),
      };
    }
  }

  _loadTexinfo() {
    const { ofs, len } = this._lump(LUMP_TEXINFO);
    const count = len / 40;
    const v = this._view;
    this.texinfo = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 40;
      const vecs = new Float32Array(8);
      for (let k = 0; k < 8; k++) {
        vecs[k] = v.getFloat32(o + k * 4, true);
      }
      this.texinfo[i] = {
        vecs,
        miptex: v.getInt32(o + 32, true),
        flags: v.getInt32(o + 36, true),
      };
    }
  }

  _loadFaces() {
    const { ofs, len } = this._lump(LUMP_FACES);
    const count = len / 20;
    const v = this._view;
    this.faces = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 20;
      const planenum = v.getInt16(o, true);
      const side = v.getInt16(o + 2, true);
      const firstedge = v.getInt32(o + 4, true);
      const numedges = v.getInt16(o + 8, true);
      const texinfo = v.getInt16(o + 10, true);
      const styles = [
        this._u8[o + 12],
        this._u8[o + 13],
        this._u8[o + 14],
        this._u8[o + 15],
      ];
      const lightofs = v.getInt32(o + 16, true);

      /** @type {BspFace} */
      const face = {
        firstEdge: firstedge,
        numEdges: numedges,
        texinfo,
        styles,
        lightofs,
        planenum,
        side,
        planeBack: side !== 0,
        texturemins: new Int32Array(2),
        extents: new Int32Array(2),
        kind: 'skip',
        lightS: 0,
        lightT: 0,
        lightmapIndex: -1,
        visframe: -1,
      };

      const ti = this.texinfo[texinfo];
      const tex = ti ? this.textures[ti.miptex] : null;
      if (!tex || !tex.pixels) {
        face.kind = 'skip';
      } else if (tex.sky) {
        face.kind = 'sky';
      } else if (tex.turb || (ti.flags & TEX_SPECIAL)) {
        // TEX_SPECIAL without sky/turb name still skip lightmap; treat turb by name
        face.kind = tex.turb ? 'turb' : 'skip';
      } else {
        face.kind = 'solid';
        this._calcSurfaceExtents(face);
      }
      this.faces[i] = face;
    }
  }

  _loadMarksurfaces() {
    const { ofs, len } = this._lump(LUMP_MARKSURFACES);
    const count = len / 2;
    const arr = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this._view.getUint16(ofs + i * 2, true);
    }
    this.marksurfaces = arr;
  }

  _loadVisibility() {
    const { ofs, len } = this._lump(LUMP_VISIBILITY);
    if (len <= 0) {
      this.visdata = null;
      return;
    }
    this.visdata = this._u8.subarray(ofs, ofs + len);
  }

  _loadLeafs() {
    const { ofs, len } = this._lump(LUMP_LEAFS);
    const count = len / 28;
    const v = this._view;
    this.leafs = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 28;
      this.leafs[i] = {
        contents: v.getInt32(o, true),
        visofs: v.getInt32(o + 4, true),
        mins: new Float32Array([
          v.getInt16(o + 8, true),
          v.getInt16(o + 10, true),
          v.getInt16(o + 12, true),
        ]),
        maxs: new Float32Array([
          v.getInt16(o + 14, true),
          v.getInt16(o + 16, true),
          v.getInt16(o + 18, true),
        ]),
        firstmarksurface: v.getUint16(o + 20, true),
        nummarksurfaces: v.getUint16(o + 22, true),
        parent: -1,
        visframe: -1,
      };
    }
  }

  _loadNodes() {
    const { ofs, len } = this._lump(LUMP_NODES);
    const count = len / 24;
    const v = this._view;
    this.nodes = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 24;
      this.nodes[i] = {
        planenum: v.getInt32(o, true),
        children: [v.getInt16(o + 4, true), v.getInt16(o + 6, true)],
        mins: new Float32Array([
          v.getInt16(o + 8, true),
          v.getInt16(o + 10, true),
          v.getInt16(o + 12, true),
        ]),
        maxs: new Float32Array([
          v.getInt16(o + 14, true),
          v.getInt16(o + 16, true),
          v.getInt16(o + 18, true),
        ]),
        firstface: v.getUint16(o + 20, true),
        numfaces: v.getUint16(o + 22, true),
        parent: -1,
        visframe: -1,
        contents: 0,
      };
    }
    if (count > 0) this._setParent(0, -1);
  }

  /**
   * @param {number} nodeIndex
   * @param {number} parent
   */
  _setParent(nodeIndex, parent) {
    const node = this.nodes[nodeIndex];
    node.parent = parent;
    for (let j = 0; j < 2; j++) {
      const c = node.children[j];
      if (c >= 0) {
        this._setParent(c, nodeIndex);
      } else {
        const leafIndex = -1 - c;
        this.leafs[leafIndex].parent = nodeIndex;
      }
    }
  }

  /**
   * @param {BspFace} face
   */
  _calcSurfaceExtents(face) {
    const ti = this.texinfo[face.texinfo];
    const mins = [Infinity, Infinity];
    const maxs = [-Infinity, -Infinity];
    for (let i = 0; i < face.numEdges; i++) {
      const e = this.surfedges[face.firstEdge + i];
      const vert =
        e >= 0
          ? this.vertexes[this.edges[e].v[0]]
          : this.vertexes[this.edges[-e].v[1]];
      for (let j = 0; j < 2; j++) {
        const val =
          vert[0] * ti.vecs[j * 4] +
          vert[1] * ti.vecs[j * 4 + 1] +
          vert[2] * ti.vecs[j * 4 + 2] +
          ti.vecs[j * 4 + 3];
        if (val < mins[j]) mins[j] = val;
        if (val > maxs[j]) maxs[j] = val;
      }
    }
    for (let i = 0; i < 2; i++) {
      const bmins = Math.floor(mins[i] / 16);
      const bmaxs = Math.ceil(maxs[i] / 16);
      face.texturemins[i] = bmins * 16;
      face.extents[i] = (bmaxs - bmins) * 16;
    }
  }

  _loadEntities() {
    const { ofs, len } = this._lump(LUMP_ENTITIES);
    if (len <= 0) {
      this.entities = '';
      return;
    }
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = this._u8[ofs + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    this.entities = s;
  }

  _loadSubmodels() {
    const { ofs, len } = this._lump(LUMP_MODELS);
    const count = len / 64;
    const v = this._view;
    this.submodels = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = ofs + i * 64;
      const mins = new Float32Array([
        v.getFloat32(o, true),
        v.getFloat32(o + 4, true),
        v.getFloat32(o + 8, true),
      ]);
      const maxs = new Float32Array([
        v.getFloat32(o + 12, true),
        v.getFloat32(o + 16, true),
        v.getFloat32(o + 20, true),
      ]);
      const origin = new Float32Array([
        v.getFloat32(o + 24, true),
        v.getFloat32(o + 28, true),
        v.getFloat32(o + 32, true),
      ]);
      const headnode = [
        v.getInt32(o + 36, true),
        v.getInt32(o + 40, true),
        v.getInt32(o + 44, true),
        v.getInt32(o + 48, true),
      ];
      const visleafs = v.getInt32(o + 52, true);
      const firstface = v.getInt32(o + 56, true);
      const numfaces = v.getInt32(o + 60, true);
      this.submodels[i] = { mins, maxs, origin, headnode, firstface, numfaces, visleafs };
    }
  }

  /**
   * @param {Float32Array|number[]} p
   * @returns {number} leaf index
   */
  pointInLeaf(p) {
    let nodeIndex = 0;
    while (true) {
      const node = this.nodes[nodeIndex];
      const plane = this.planes[node.planenum];
      const d =
        p[0] * plane.normal[0] +
        p[1] * plane.normal[1] +
        p[2] * plane.normal[2] -
        plane.dist;
      const c = d > 0 ? node.children[0] : node.children[1];
      if (c < 0) return -1 - c;
      nodeIndex = c;
    }
  }

  /**
   * @param {number} leafIndex
   * @returns {Uint8Array} bitset over vis leafs (leafs 1..numVisLeafs)
   */
  leafPVS(leafIndex) {
    const row = (this.numVisLeafs + 7) >> 3;
    const out = this._decompressedVis;
    if (leafIndex === 0 || !this.visdata) {
      out.fill(0xff, 0, row);
      return out;
    }
    const leaf = this.leafs[leafIndex];
    if (leaf.visofs < 0) {
      out.fill(0xff, 0, row);
      return out;
    }
    let inn = leaf.visofs;
    let outp = 0;
    const vis = this.visdata;
    while (outp < row) {
      const b = vis[inn++];
      if (b) {
        out[outp++] = b;
        continue;
      }
      let c = vis[inn++];
      while (c-- > 0 && outp < row) out[outp++] = 0;
    }
    return out;
  }

  /**
   * Mark nodes reachable from the view leaf's PVS (R_MarkLeaves).
   * @param {number} viewLeaf
   */
  markLeaves(viewLeaf) {
    this._visframecount++;
    const vis = this.leafPVS(viewLeaf);
    const vf = this._visframecount;
    for (let i = 0; i < this.numVisLeafs; i++) {
      if (vis[i >> 3] & (1 << (i & 7))) {
        let parent = this.leafs[i + 1].parent;
        while (parent >= 0) {
          const node = this.nodes[parent];
          if (node.visframe === vf) break;
          node.visframe = vf;
          parent = node.parent;
        }
        this.leafs[i + 1].visframe = vf;
      }
    }
  }

  /**
   * Collect visible face indices via PVS marksurfaces (R_MarkLeaves + leaf marks).
   * @param {Float32Array|number[]} modelorg  view origin
   * @param {number[]} solidOut
   * @param {number[]} skyOut
   * @param {number[]} turbOut
   */
  gatherVisibleFaces(modelorg, solidOut, skyOut, turbOut) {
    this._framecount++;
    const frame = this._framecount;
    const vf = this._visframecount;
    solidOut.length = 0;
    skyOut.length = 0;
    turbOut.length = 0;

    // Mark surfaces belonging to PVS leaves
    for (let i = 0; i < this.numVisLeafs; i++) {
      const leaf = this.leafs[i + 1];
      if (leaf.visframe !== vf) continue;
      if (leaf.contents === -2) continue; // CONTENTS_SOLID
      for (let j = 0; j < leaf.nummarksurfaces; j++) {
        const fi = this.marksurfaces[leaf.firstmarksurface + j];
        this.faces[fi].visframe = frame;
      }
    }

    const world = this.submodels[0];
    if (!world) return;
    const first = world.firstface;
    const last = first + world.numfaces;

    for (let fi = first; fi < last; fi++) {
      const face = this.faces[fi];
      if (face.visframe !== frame) continue;
      if (face.kind === 'skip' || face.numEdges < 3) continue;

      if (face.kind === 'solid' || face.kind === 'sky') {
        const plane = this.planes[face.planenum];
        const dot =
          modelorg[0] * plane.normal[0] +
          modelorg[1] * plane.normal[1] +
          modelorg[2] * plane.normal[2] -
          plane.dist;
        if (((dot < 0) ? 1 : 0) ^ (face.planeBack ? 1 : 0)) continue;
      }

      if (face.kind === 'solid') solidOut.push(fi);
      else if (face.kind === 'sky') skyOut.push(fi);
      else if (face.kind === 'turb') turbOut.push(fi);
    }
  }

  /**
   * Face vertex positions in winding order.
   * @param {BspFace} face
   * @returns {Float32Array[]}
   */
  faceVerts(face) {
    /** @type {Float32Array[]} */
    const verts = [];
    for (let i = 0; i < face.numEdges; i++) {
      const e = this.surfedges[face.firstEdge + i];
      if (e >= 0) {
        verts.push(this.vertexes[this.edges[e].v[0]]);
      } else {
        verts.push(this.vertexes[this.edges[-e].v[1]]);
      }
    }
    return verts;
  }
}
