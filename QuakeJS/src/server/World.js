/**
 * World collision (world.c SV_HullPointContents / SV_RecursiveHullCheck subset).
 * World-only traces against brush hulls — no entity clip links yet.
 */

export const CONTENTS_EMPTY = -1;
export const CONTENTS_SOLID = -2;
export const CONTENTS_WATER = -3;
export const CONTENTS_SLIME = -4;
export const CONTENTS_LAVA = -5;
export const CONTENTS_SKY = -6;

const DIST_EPSILON = 0.03125;

/**
 * @typedef {object} Trace
 * @property {boolean} allsolid
 * @property {boolean} startsolid
 * @property {boolean} inopen
 * @property {boolean} inwater
 * @property {number} fraction
 * @property {Float32Array} endpos
 * @property {{ normal: Float32Array, dist: number }} plane
 * @property {number} ent edict index (0 = world)
 */

/**
 * @returns {Trace}
 */
function emptyTrace(end) {
  return {
    allsolid: true,
    startsolid: false,
    inopen: false,
    inwater: false,
    fraction: 1,
    endpos: new Float32Array(end),
    plane: { normal: new Float32Array([0, 0, 0]), dist: 0 },
    ent: 0,
  };
}

export class World {
  /**
   * @param {import('../render/models/BspModel.js').BspModel} bsp
   */
  constructor(bsp) {
    this.bsp = bsp;
    /** @type {{ submodel: number, origin: Float32Array, edict?: number }[]} SOLID_BSP brush ents to clip */
    this.brushes = [];
  }

  /**
   * @param {import('../render/models/BspModel.js').BspModel['hulls'][0]} hull
   * @param {number} num
   * @param {Float32Array|number[]} p
   * @returns {number} CONTENTS_*
   */
  hullPointContents(hull, num, p) {
    while (num >= 0) {
      const node = hull.clipnodes[num];
      const plane = hull.planes[node.planenum];
      let d;
      if (plane.type < 3) {
        d = p[plane.type] - plane.dist;
      } else {
        d =
          plane.normal[0] * p[0] +
          plane.normal[1] * p[1] +
          plane.normal[2] * p[2] -
          plane.dist;
      }
      num = d < 0 ? node.children[1] : node.children[0];
    }
    return num;
  }

  /**
   * Point contents via hull 0.
   * @param {Float32Array|number[]} p
   */
  pointContents(p) {
    return this.hullPointContents(this.bsp.hulls[0], this.bsp.hulls[0].firstclipnode, p);
  }

  /**
   * Player-sized box trace against world (hull 1) + SOLID_BSP brush submodels.
   * @param {Float32Array|number[]} start
   * @param {Float32Array|number[]} end
   * @param {Float32Array|number[]} [mins]
   * @param {Float32Array|number[]} [maxs]
   * @returns {Trace}
   */
  playerMove(start, end, mins, maxs) {
    const hull = this.bsp.hulls[1];
    const mns = mins || hull.clipMins;
    const mxs = maxs || hull.clipMaxs;
    let trace = this._clipToHull(hull, 0, 0, 0, start, end, mns, mxs);
    trace.ent = 0;

    for (const be of this.brushes) {
      const sm = this.bsp.submodels[be.submodel];
      if (!sm) continue;
      const brushHull = {
        clipnodes: hull.clipnodes,
        planes: hull.planes,
        firstclipnode: sm.headnode[1],
        lastclipnode: hull.lastclipnode,
        clipMins: hull.clipMins,
        clipMaxs: hull.clipMaxs,
      };
      const tr = this._clipToHull(
        brushHull,
        be.origin[0],
        be.origin[1],
        be.origin[2],
        start,
        end,
        mns,
        mxs,
      );
      if (tr.allsolid || tr.fraction < trace.fraction) {
        tr.ent = be.edict || 0;
        trace = tr;
      }
    }
    return trace;
  }

  /**
   * @param {object} hull
   * @param {number} ox entity origin x
   * @param {number} oy
   * @param {number} oz
   * @param {Float32Array|number[]} start
   * @param {Float32Array|number[]} end
   * @param {Float32Array|number[]} mns
   * @param {Float32Array|number[]} mxs
   * @returns {Trace}
   */
  _clipToHull(hull, ox, oy, oz, start, end, mns, mxs) {
    // offset = clip_mins - mins + ent.origin  (SV_HullForEntity / SV_ClipMoveToEntity)
    const offset = new Float32Array([
      hull.clipMins[0] - mns[0] + ox,
      hull.clipMins[1] - mns[1] + oy,
      hull.clipMins[2] - mns[2] + oz,
    ]);
    const startL = new Float32Array([
      start[0] - offset[0],
      start[1] - offset[1],
      start[2] - offset[2],
    ]);
    const endL = new Float32Array([
      end[0] - offset[0],
      end[1] - offset[1],
      end[2] - offset[2],
    ]);

    const trace = emptyTrace(endL);
    this._recursiveHullCheck(hull, hull.firstclipnode, 0, 1, startL, endL, trace);

    if (trace.fraction !== 1) {
      trace.endpos[0] += offset[0];
      trace.endpos[1] += offset[1];
      trace.endpos[2] += offset[2];
    } else {
      trace.endpos[0] = end[0];
      trace.endpos[1] = end[1];
      trace.endpos[2] = end[2];
    }
    return trace;
  }

  /**
   * @param {import('../render/models/BspModel.js').BspModel['hulls'][0]} hull
   * @param {number} num
   * @param {number} p1f
   * @param {number} p2f
   * @param {Float32Array} p1
   * @param {Float32Array} p2
   * @param {Trace} trace
   * @returns {boolean}
   */
  _recursiveHullCheck(hull, num, p1f, p2f, p1, p2, trace) {
    if (num < 0) {
      if (num !== CONTENTS_SOLID) {
        trace.allsolid = false;
        if (num === CONTENTS_EMPTY) trace.inopen = true;
        else trace.inwater = true;
      } else {
        trace.startsolid = true;
      }
      return true;
    }

    const node = hull.clipnodes[num];
    const plane = hull.planes[node.planenum];
    let t1;
    let t2;
    if (plane.type < 3) {
      t1 = p1[plane.type] - plane.dist;
      t2 = p2[plane.type] - plane.dist;
    } else {
      t1 =
        plane.normal[0] * p1[0] +
        plane.normal[1] * p1[1] +
        plane.normal[2] * p1[2] -
        plane.dist;
      t2 =
        plane.normal[0] * p2[0] +
        plane.normal[1] * p2[1] +
        plane.normal[2] * p2[2] -
        plane.dist;
    }

    if (t1 >= 0 && t2 >= 0) {
      return this._recursiveHullCheck(hull, node.children[0], p1f, p2f, p1, p2, trace);
    }
    if (t1 < 0 && t2 < 0) {
      return this._recursiveHullCheck(hull, node.children[1], p1f, p2f, p1, p2, trace);
    }

    let frac;
    if (t1 < 0) frac = (t1 + DIST_EPSILON) / (t1 - t2);
    else frac = (t1 - DIST_EPSILON) / (t1 - t2);
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;

    const midf = p1f + (p2f - p1f) * frac;
    const mid = new Float32Array([
      p1[0] + frac * (p2[0] - p1[0]),
      p1[1] + frac * (p2[1] - p1[1]),
      p1[2] + frac * (p2[2] - p1[2]),
    ]);
    const side = t1 < 0 ? 1 : 0;

    if (!this._recursiveHullCheck(hull, node.children[side], p1f, midf, p1, mid, trace)) {
      return false;
    }

    if (this.hullPointContents(hull, node.children[side ^ 1], mid) !== CONTENTS_SOLID) {
      return this._recursiveHullCheck(hull, node.children[side ^ 1], midf, p2f, mid, p2, trace);
    }

    if (trace.allsolid) return false;

    if (!side) {
      trace.plane.normal[0] = plane.normal[0];
      trace.plane.normal[1] = plane.normal[1];
      trace.plane.normal[2] = plane.normal[2];
      trace.plane.dist = plane.dist;
    } else {
      trace.plane.normal[0] = -plane.normal[0];
      trace.plane.normal[1] = -plane.normal[1];
      trace.plane.normal[2] = -plane.normal[2];
      trace.plane.dist = -plane.dist;
    }

    let f = frac;
    let midf2 = midf;
    const mid2 = new Float32Array(mid);
    while (this.hullPointContents(hull, hull.firstclipnode, mid2) === CONTENTS_SOLID) {
      f -= 0.1;
      if (f < 0) {
        trace.fraction = midf2;
        trace.endpos.set(mid2);
        return false;
      }
      midf2 = p1f + (p2f - p1f) * f;
      mid2[0] = p1[0] + f * (p2[0] - p1[0]);
      mid2[1] = p1[1] + f * (p2[1] - p1[1]);
      mid2[2] = p1[2] + f * (p2[2] - p1[2]);
    }

    trace.fraction = midf2;
    trace.endpos.set(mid2);
    return false;
  }
}
