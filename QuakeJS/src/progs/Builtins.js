/**
 * QuakeC builtins (pr_cmds.c) — minimum set for doors/items + stubs.
 */

import { OFS_RETURN, OFS_PARM0 } from './Progs.js';
import {
  SOLID_NOT,
  SOLID_BSP,
  SOLID_TRIGGER,
  FL_ONGROUND,
  FL_FLY,
  FL_SWIM,
  FL_NOTARGET,
  FL_ITEM,
  FL_PARTIALGROUND,
  MOVETYPE_PUSH,
  MAX_CLIENTS,
} from './Edicts.js';
import { angleVectors } from '../math/QuakeMath.js';
import { CONTENTS_EMPTY, CONTENTS_SOLID } from '../server/World.js';

const STEPSIZE = 18;
const DI_NODIR = -1;

/**
 * Ray vs AABB — enter fraction in [0,1], or null if miss.
 * @param {number[]} start
 * @param {number[]} end
 * @param {Float32Array|number[]} amin
 * @param {Float32Array|number[]} amax
 * @returns {number|null}
 */
function rayAabbFraction(start, end, amin, amax) {
  let tmin = 0;
  let tmax = 1;
  for (let i = 0; i < 3; i++) {
    const d = end[i] - start[i];
    if (Math.abs(d) < 1e-8) {
      if (start[i] < amin[i] || start[i] > amax[i]) return null;
      continue;
    }
    let t1 = (amin[i] - start[i]) / d;
    let t2 = (amax[i] - start[i]) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0) return tmax >= 0 ? 0 : null;
  return tmin;
}

/** @param {number} a @returns {number} */
function anglemod(a) {
  a = a % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * @param {object} ctx
 * @param {import('./Progs.js').Progs} ctx.progs
 * @param {import('./Edicts.js').EdictStore} ctx.edicts
 * @param {import('./PrExec.js').PrExec} ctx.exec
 * @param {import('../server/Server.js').Server} ctx.server
 * @returns {((() => void) | null)[]}
 */
export function createBuiltins(ctx) {
  const { progs, edicts } = ctx;
  const gf = () => progs.globalsF;
  const gi = () => progs.globalsI;
  const f = progs.f;
  const ofs = progs.ofs;

  const G_FLOAT = (o) => gf()[o];
  const G_INT = (o) => gi()[o];
  const SET_FLOAT = (o, v) => {
    gf()[o] = v;
  };
  const SET_INT = (o, v) => {
    gi()[o] = v;
  };
  const G_VECTOR = (o) => [gf()[o], gf()[o + 1], gf()[o + 2]];
  const SET_VECTOR = (o, v) => {
    gf()[o] = v[0];
    gf()[o + 1] = v[1];
    gf()[o + 2] = v[2];
  };
  const G_STRING = (o) => progs.stringAt(gi()[o]);
  const RETURN_FLOAT = (v) => {
    gf()[OFS_RETURN] = v;
  };
  const RETURN_INT = (v) => {
    gi()[OFS_RETURN] = v;
  };
  const RETURN_VECTOR = (v) => SET_VECTOR(OFS_RETURN, v);
  const RETURN_STRING = (s) => {
    gi()[OFS_RETURN] = progs.allocString(s);
  };
  const PARM = (n) => OFS_PARM0 + n * 3;
  /** PF_VarString — concatenate string parms from `start` (uses call argc) */
  const varString = (start) => {
    const argc = ctx.exec?.argc ?? 8;
    let out = '';
    for (let i = start; i < argc; i++) {
      out += G_STRING(PARM(i));
    }
    return out;
  };

  /**
   * anglemod — wrap yaw to [0,360)
   * @param {number} a
   */
  const angmod = (a) => anglemod(a);

  /**
   * Point (hull0) move — SV_Move with vec3_origin mins/maxs
   * @param {Float32Array|number[]} start
   * @param {Float32Array|number[]} end
   */
  const pointMove = (start, end) => {
    const hull = ctx.server.bsp.hulls[0];
    return ctx.server.world._clipToHull(
      hull,
      0,
      0,
      0,
      start,
      end,
      new Float32Array([0, 0, 0]),
      new Float32Array([0, 0, 0]),
    );
  };

  /**
   * SV_CheckBottom (sv_move.c)
   * @param {number} ent
   * @returns {boolean}
   */
  const svCheckBottom = (ent) => {
    const o = edicts.getVec(ent, f.origin);
    const mins = edicts.getVec(ent, f.mins);
    const maxs = edicts.getVec(ent, f.maxs);
    const absMins = [o[0] + mins[0], o[1] + mins[1], o[2] + mins[2]];
    const absMaxs = [o[0] + maxs[0], o[1] + maxs[1], o[2] + maxs[2]];
    const world = ctx.server.world;
    const start = [0, 0, absMins[2] - 1];
    for (let x = 0; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        start[0] = x ? absMaxs[0] : absMins[0];
        start[1] = y ? absMaxs[1] : absMins[1];
        if (world.pointContents(start) !== CONTENTS_SOLID) {
          start[2] = absMins[2];
          const midX = (absMins[0] + absMaxs[0]) * 0.5;
          const midY = (absMins[1] + absMaxs[1]) * 0.5;
          const stop = [midX, midY, start[2] - 2 * STEPSIZE];
          start[0] = midX;
          start[1] = midY;
          let tr = pointMove(start, stop);
          if (tr.fraction === 1) return false;
          const mid = tr.endpos[2];
          let bottom = mid;
          for (let x2 = 0; x2 <= 1; x2++) {
            for (let y2 = 0; y2 <= 1; y2++) {
              start[0] = stop[0] = x2 ? absMaxs[0] : absMins[0];
              start[1] = stop[1] = y2 ? absMaxs[1] : absMins[1];
              stop[2] = absMins[2] - 2 * STEPSIZE;
              start[2] = absMins[2];
              tr = pointMove(start, stop);
              if (tr.fraction !== 1 && tr.endpos[2] > bottom) bottom = tr.endpos[2];
              if (tr.fraction === 1 || mid - tr.endpos[2] > STEPSIZE) return false;
            }
          }
          return true;
        }
      }
    }
    return true;
  };

  /**
   * PF_changeyaw / SV_StepDirection helper
   * @param {number} ent
   */
  const svChangeYaw = (ent) => {
    const idealOfs = f.ideal_yaw;
    const speedOfs = f.yaw_speed;
    if (idealOfs < 0) return;
    const ideal = edicts.getFloat(ent, idealOfs);
    const speed = speedOfs >= 0 ? edicts.getFloat(ent, speedOfs) || 20 : 20;
    const ang = edicts.getVec(ent, f.angles);
    let current = angmod(ang[1]);
    if (current === ideal) return;
    let move = ideal - current;
    if (ideal > current) {
      if (move >= 180) move -= 360;
    } else if (move <= -180) {
      move += 360;
    }
    if (move > 0) {
      if (move > speed) move = speed;
    } else if (move < -speed) {
      move = -speed;
    }
    ang[1] = angmod(current + move);
    edicts.setVec(ent, f.angles, ang);
  };

  /**
   * SV_movestep (sv_move.c) — relink=false defers linkAbs to StepDirection
   * @param {number} ent
   * @param {number} dx
   * @param {number} dy
   * @param {boolean} [relink=true]
   * @returns {boolean}
   */
  const svMoveStep = (ent, dx, dy, relink = true) => {
    const flags0 = edicts.getFloat(ent, f.flags) | 0;
    const o = edicts.getVec(ent, f.origin);
    const oldorg = [o[0], o[1], o[2]];
    const mins = new Float32Array(edicts.getVec(ent, f.mins));
    const maxs = new Float32Array(edicts.getVec(ent, f.maxs));
    const world = ctx.server.world;
    const enemyOfs = progs.fieldByName.get('enemy')?.ofs;
    const enemy = enemyOfs != null ? edicts.getInt(ent, enemyOfs) | 0 : 0;

    // FL_SWIM | FL_FLY — no stair step
    if (flags0 & (FL_SWIM | FL_FLY)) {
      for (let i = 0; i < 2; i++) {
        const neworg = new Float32Array([o[0] + dx, o[1] + dy, o[2]]);
        if (i === 0 && enemy && !edicts.free[enemy]) {
          const dz = o[2] - edicts.getVec(enemy, f.origin)[2];
          if (dz > 40) neworg[2] -= 8;
          if (dz < 30) neworg[2] += 8;
        }
        const tr = world.playerMove(o, neworg, mins, maxs);
        if (tr.fraction === 1) {
          if (
            flags0 & FL_SWIM &&
            world.pointContents(tr.endpos) === CONTENTS_EMPTY
          ) {
            return false;
          }
          edicts.setVec(ent, f.origin, tr.endpos);
          if (relink) edicts.linkAbs(ent);
          return true;
        }
        if (!enemy || edicts.free[enemy]) break;
      }
      return false;
    }

    // Ground monster — drop from STEPSIZE above wished XY
    const neworg = new Float32Array([o[0] + dx, o[1] + dy, o[2] + STEPSIZE]);
    const end = new Float32Array([neworg[0], neworg[1], neworg[2] - STEPSIZE * 2]);
    let tr = world.playerMove(neworg, end, mins, maxs);
    if (tr.allsolid) return false;
    if (tr.startsolid) {
      neworg[2] -= STEPSIZE;
      tr = world.playerMove(neworg, end, mins, maxs);
      if (tr.allsolid || tr.startsolid) return false;
    }
    if (tr.fraction === 1) {
      if (flags0 & FL_PARTIALGROUND) {
        edicts.setVec(ent, f.origin, [o[0] + dx, o[1] + dy, o[2]]);
        if (relink) edicts.linkAbs(ent);
        edicts.setFloat(ent, f.flags, flags0 & ~FL_ONGROUND);
        return true;
      }
      return false;
    }

    edicts.setVec(ent, f.origin, tr.endpos);
    if (!svCheckBottom(ent)) {
      if (flags0 & FL_PARTIALGROUND) {
        if (relink) edicts.linkAbs(ent);
        return true;
      }
      edicts.setVec(ent, f.origin, oldorg);
      return false;
    }
    let flags = edicts.getFloat(ent, f.flags) | 0;
    flags = (flags & ~FL_PARTIALGROUND) | FL_ONGROUND;
    edicts.setFloat(ent, f.flags, flags);
    edicts.setInt(ent, f.groundentity, tr.ent | 0);
    if (relink) edicts.linkAbs(ent);
    return true;
  };

  /**
   * SV_StepDirection (sv_move.c)
   * @param {number} ent
   * @param {number} yaw
   * @param {number} dist
   * @returns {boolean}
   */
  const svStepDirection = (ent, yaw, dist) => {
    const idealOfs = f.ideal_yaw;
    if (idealOfs >= 0) edicts.setFloat(ent, idealOfs, yaw);
    svChangeYaw(ent);
    const rad = (yaw * Math.PI) / 180;
    const o = edicts.getVec(ent, f.origin);
    const oldorigin = [o[0], o[1], o[2]];
    if (svMoveStep(ent, Math.cos(rad) * dist, Math.sin(rad) * dist, false)) {
      const ang = edicts.getVec(ent, f.angles);
      const ideal = idealOfs >= 0 ? edicts.getFloat(ent, idealOfs) : yaw;
      let delta = ang[1] - ideal;
      delta = angmod(delta);
      if (delta > 45 && delta < 315) {
        // Not turned far enough — undo step (vanilla still returns true)
        edicts.setVec(ent, f.origin, oldorigin);
      }
      edicts.linkAbs(ent);
      return true;
    }
    edicts.linkAbs(ent);
    return false;
  };

  /**
   * SV_NewChaseDir (sv_move.c) — match vanilla including 215° SW quirk
   * @param {number} ent
   * @param {number} goal
   * @param {number} dist
   */
  const svNewChaseDir = (ent, goal, dist) => {
    const o = edicts.getVec(ent, f.origin);
    const t = edicts.getVec(goal, f.origin);
    const deltax = t[0] - o[0];
    const deltay = t[1] - o[1];
    const idealOfs = f.ideal_yaw;
    const olddir =
      idealOfs >= 0
        ? angmod(((edicts.getFloat(ent, idealOfs) / 45) | 0) * 45)
        : 0;
    const turnaround = angmod(olddir - 180);

    let d1 = deltax > 10 ? 0 : deltax < -10 ? 180 : DI_NODIR;
    let d2 = deltay < -10 ? 270 : deltay > 10 ? 90 : DI_NODIR;

    if (d1 !== DI_NODIR && d2 !== DI_NODIR) {
      let tdir;
      if (d1 === 0) tdir = d2 === 90 ? 45 : 315;
      else tdir = d2 === 90 ? 135 : 215; // vanilla uses 215, not 225
      if (tdir !== turnaround && svStepDirection(ent, tdir, dist)) return;
    }

    if ((((Math.random() * 4) | 0) & 1) || Math.abs(deltay) > Math.abs(deltax)) {
      const tmp = d1;
      d1 = d2;
      d2 = tmp;
    }

    if (d1 !== DI_NODIR && d1 !== turnaround && svStepDirection(ent, d1, dist))
      return;
    if (d2 !== DI_NODIR && d2 !== turnaround && svStepDirection(ent, d2, dist))
      return;
    if (olddir !== DI_NODIR && svStepDirection(ent, olddir, dist)) return;

    if (Math.random() < 0.5) {
      for (let tdir = 0; tdir <= 315; tdir += 45) {
        if (tdir !== turnaround && svStepDirection(ent, tdir, dist)) return;
      }
    } else {
      for (let tdir = 315; tdir >= 0; tdir -= 45) {
        if (tdir !== turnaround && svStepDirection(ent, tdir, dist)) return;
      }
    }

    if (turnaround !== DI_NODIR && svStepDirection(ent, turnaround, dist)) return;

    if (idealOfs >= 0) edicts.setFloat(ent, idealOfs, olddir);
    if (!svCheckBottom(ent)) {
      edicts.setFloat(
        ent,
        f.flags,
        (edicts.getFloat(ent, f.flags) | 0) | FL_PARTIALGROUND,
      );
    }
  };

  /**
   * SV_CloseEnough
   * @param {number} ent
   * @param {number} goal
   * @param {number} dist
   */
  const svCloseEnough = (ent, goal, dist) => {
    const amax = edicts.getVec(ent, f.absmax);
    const amin = edicts.getVec(ent, f.absmin);
    const gmax = edicts.getVec(goal, f.absmax);
    const gmin = edicts.getVec(goal, f.absmin);
    for (let i = 0; i < 3; i++) {
      if (gmin[i] > amax[i] + dist || gmax[i] < amin[i] - dist) return false;
    }
    return true;
  };

  /** @type {((() => void) | null)[]} */
  const builtins = new Array(96).fill(null);

  const fixme = () => {
    console.warn('QC Fixme builtin');
  };

  builtins[0] = fixme;
  builtins[1] = () => {
    // makevectors(angles)
    const ang = G_VECTOR(PARM(0));
    const { forward, right, up } = angleVectors(ang);
    SET_VECTOR(ofs.v_forward, forward);
    SET_VECTOR(ofs.v_right, right);
    SET_VECTOR(ofs.v_up, up);
  };
  builtins[2] = () => {
    // setorigin(e, org)
    const e = G_INT(PARM(0));
    const org = G_VECTOR(PARM(1));
    edicts.setVec(e, f.origin, org);
    edicts.linkAbs(e);
  };
  builtins[3] = () => {
    // setmodel(e, m)
    const e = G_INT(PARM(0));
    const m = G_STRING(PARM(1));
    edicts.setInt(e, f.model, progs.allocString(m));
    const idx = ctx.server.precacheModel(m);
    edicts.setFloat(e, f.modelindex, idx);
    const bounds = ctx.server.modelBounds(m);
    if (bounds) {
      edicts.setVec(e, f.mins, bounds.mins);
      edicts.setVec(e, f.maxs, bounds.maxs);
    }
    edicts.linkAbs(e);
  };
  builtins[4] = () => {
    // setsize(e, min, max)
    const e = G_INT(PARM(0));
    edicts.setVec(e, f.mins, G_VECTOR(PARM(1)));
    edicts.setVec(e, f.maxs, G_VECTOR(PARM(2)));
    edicts.linkAbs(e);
  };
  builtins[5] = fixme;
  builtins[6] = () => {}; // break
  builtins[7] = () => {
    RETURN_FLOAT(Math.random());
  };
  builtins[8] = () => {
    // sound(entity, channel, sample, volume, attenuation)
    const e = G_INT(PARM(0));
    const channel = G_FLOAT(PARM(1)) | 0;
    const sample = G_STRING(PARM(2));
    const volume = (G_FLOAT(PARM(3)) * 255) | 0;
    const attenuation = G_FLOAT(PARM(4));
    ctx.server.startSound(e, channel, sample, volume, attenuation);
  };
  builtins[9] = () => {
    const v = G_VECTOR(PARM(0));
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    RETURN_VECTOR([v[0] / len, v[1] / len, v[2] / len]);
  };
  builtins[10] = () => {
    throw new Error(`QC error: ${G_STRING(PARM(0))}`);
  };
  builtins[11] = () => {
    console.error(`QC objerror: ${G_STRING(PARM(0))}`);
    const self = G_INT(ofs.self);
    edicts.freeEdict(self);
  };
  builtins[12] = () => {
    const v = G_VECTOR(PARM(0));
    RETURN_FLOAT(Math.hypot(v[0], v[1], v[2]));
  };
  builtins[13] = () => {
    const v = G_VECTOR(PARM(0));
    let yaw = 0;
    if (v[0] || v[1]) {
      yaw = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
      if (yaw < 0) yaw += 360;
    }
    RETURN_FLOAT(yaw);
  };
  builtins[14] = () => {
    RETURN_INT(edicts.alloc());
  };
  builtins[15] = () => {
    edicts.freeEdict(G_INT(PARM(0)));
  };
  builtins[16] = () => {
    // traceline(v1, v2, nomonsters, ent) — world + entity clip (CheckAttack needs trace_ent)
    const v1 = G_VECTOR(PARM(0));
    const v2 = G_VECTOR(PARM(1));
    const nomonsters = G_FLOAT(PARM(2));
    const passedict = G_INT(PARM(3));

    const hull = ctx.server.bsp.hulls[0];
    const w = ctx.server.world;
    const t = {
      allsolid: true,
      startsolid: false,
      inopen: false,
      inwater: false,
      fraction: 1,
      endpos: new Float32Array(v2),
      plane: { normal: new Float32Array(3), dist: 0 },
    };
    w._recursiveHullCheck(
      hull,
      hull.firstclipnode,
      0,
      1,
      new Float32Array(v1),
      new Float32Array(v2),
      t,
    );
    let hitEnt = 0;

    // Clip doors/plats (BSP) always; non-BSP only when nomonsters==0 (MOVE_NORMAL)
    for (let e = 1; e < edicts.numEdicts; e++) {
      if (e === passedict || edicts.free[e]) continue;
      const solid = edicts.getFloat(e, f.solid) | 0;
      if (solid === SOLID_NOT || solid === SOLID_TRIGGER) continue;
      if (nomonsters && solid !== SOLID_BSP) continue;

      const amin = edicts.getVec(e, f.absmin);
      const amax = edicts.getVec(e, f.absmax);
      const frac = rayAabbFraction(v1, v2, amin, amax);
      if (frac == null || frac < 0) continue;
      if (frac < t.fraction) {
        t.fraction = frac;
        t.endpos[0] = v1[0] + (v2[0] - v1[0]) * frac;
        t.endpos[1] = v1[1] + (v2[1] - v1[1]) * frac;
        t.endpos[2] = v1[2] + (v2[2] - v1[2]) * frac;
        t.allsolid = false;
        hitEnt = e;
      }
    }

    SET_FLOAT(ofs.trace_allsolid, t.allsolid ? 1 : 0);
    SET_FLOAT(ofs.trace_startsolid, t.startsolid ? 1 : 0);
    SET_FLOAT(ofs.trace_fraction, t.fraction);
    SET_VECTOR(ofs.trace_endpos, t.endpos);
    SET_VECTOR(ofs.trace_plane_normal, t.plane.normal);
    SET_FLOAT(ofs.trace_plane_dist, t.plane.dist);
    SET_INT(ofs.trace_ent, hitEnt);
    SET_FLOAT(ofs.trace_inopen, t.inopen ? 1 : 0);
    SET_FLOAT(ofs.trace_inwater, t.inwater ? 1 : 0);
  };
  builtins[17] = () => {
    // PF_checkclient — PVS only (vanilla); no LOS fallback
    const player = 1;
    if (edicts.free[player] || edicts.getFloat(player, f.health) <= 0) {
      RETURN_INT(0);
      return;
    }
    if ((edicts.getFloat(player, f.flags) | 0) & FL_NOTARGET) {
      RETURN_INT(0);
      return;
    }
    const bsp = ctx.server.bsp;
    if (!bsp) {
      RETURN_INT(player);
      return;
    }

    let pvo = edicts.getVec(player, f.view_ofs);
    if (!pvo[0] && !pvo[1] && !pvo[2]) {
      edicts.setVec(player, f.view_ofs, [0, 0, 22]);
      pvo = edicts.getVec(player, f.view_ofs);
    }
    const po = edicts.getVec(player, f.origin);
    const peye = [po[0] + pvo[0], po[1] + pvo[1], po[2] + pvo[2]];
    // PF_newcheckclient — PVS from client eye
    const pvsSrc = bsp.leafPVS(bsp.pointInLeaf(peye));
    const row = (bsp.numVisLeafs + 7) >> 3;
    const pvs = pvsSrc.slice(0, row);

    const self = G_INT(ofs.self);
    const so = edicts.getVec(self, f.origin);
    const svo = edicts.getVec(self, f.view_ofs);
    const view = [so[0] + svo[0], so[1] + svo[1], so[2] + svo[2]];
    const selfLeaf = bsp.pointInLeaf(view);
    const bit = selfLeaf - 1;
    if (bit < 0 || bit >= bsp.numVisLeafs || !(pvs[bit >> 3] & (1 << (bit & 7)))) {
      RETURN_INT(0);
      return;
    }
    RETURN_INT(player);
  }; // checkclient
  builtins[18] = () => {
    // find(start, fieldOfs, match)
    let e = G_INT(PARM(0));
    const fieldOfs = G_INT(PARM(1));
    const match = G_STRING(PARM(2));
    for (e = e + 1; e < edicts.numEdicts; e++) {
      if (edicts.free[e]) continue;
      const s = progs.stringAt(edicts.getInt(e, fieldOfs));
      if (s === match) {
        RETURN_INT(e);
        return;
      }
    }
    RETURN_INT(0);
  };
  builtins[19] = () => {
    // precache_sound
    const s = G_STRING(PARM(0));
    ctx.server.precacheSound(s);
    RETURN_INT(gi()[PARM(0)]);
  };
  builtins[20] = () => {
    const m = G_STRING(PARM(0));
    ctx.server.precacheModel(m);
    RETURN_INT(gi()[PARM(0)]);
  };
  builtins[21] = () => {}; // stuffcmd
  builtins[22] = () => {
    // findradius(org, rad)
    const org = G_VECTOR(PARM(0));
    const rad = G_FLOAT(PARM(1));
    let chain = 0;
    for (let e = 1; e < edicts.numEdicts; e++) {
      if (edicts.free[e]) continue;
      if (edicts.getFloat(e, f.solid) === SOLID_NOT) continue;
      const o = edicts.getVec(e, f.origin);
      const d = Math.hypot(o[0] - org[0], o[1] - org[1], o[2] - org[2]);
      if (d > rad) continue;
      edicts.setInt(e, f.chain, chain);
      chain = e;
    }
    RETURN_INT(chain);
  };
  builtins[23] = () => {}; // bprint
  builtins[24] = () => {}; // sprint
  builtins[25] = () => {
    // dprint
    // console.debug(G_STRING(PARM(0)));
  };
  builtins[26] = () => {
    RETURN_STRING(String(G_FLOAT(PARM(0))));
  };
  builtins[27] = () => {
    const v = G_VECTOR(PARM(0));
    RETURN_STRING(`'${v[0]} ${v[1]} ${v[2]}'`);
  };
  builtins[28] = () => {}; // coredump
  builtins[29] = () => {}; // traceon
  builtins[30] = () => {}; // traceoff
  builtins[31] = () => {}; // eprint
  builtins[32] = () => {
    // PF_walkmove — SV_movestep with relink
    const self = G_INT(ofs.self);
    const flags = edicts.getFloat(self, f.flags) | 0;
    if (!(flags & (FL_ONGROUND | FL_FLY | FL_SWIM))) {
      RETURN_FLOAT(0);
      return;
    }
    const yaw = (G_FLOAT(PARM(0)) * Math.PI) / 180;
    const dist = G_FLOAT(PARM(1));
    RETURN_FLOAT(
      svMoveStep(self, Math.cos(yaw) * dist, Math.sin(yaw) * dist, true) ? 1 : 0,
    );
  }; // walkmove
  builtins[33] = fixme;
  builtins[34] = () => {
    // droptofloor
    const self = G_INT(ofs.self);
    const o = edicts.getVec(self, f.origin);
    const end = new Float32Array([o[0], o[1], o[2] - 256]);
    const mins = new Float32Array(edicts.getVec(self, f.mins));
    const maxs = new Float32Array(edicts.getVec(self, f.maxs));
    const tr = ctx.server.world.playerMove(o, end, mins, maxs);
    if (tr.fraction === 1 || tr.allsolid) {
      RETURN_FLOAT(0);
      return;
    }
    edicts.setVec(self, f.origin, tr.endpos);
    edicts.linkAbs(self);
    edicts.setFloat(self, f.flags, (edicts.getFloat(self, f.flags) | 0) | FL_ONGROUND);
    edicts.setInt(self, f.groundentity, 0);
    RETURN_FLOAT(1);
  };
  builtins[35] = () => {
    // lightstyle(style, value)
    ctx.server.setLightstyle(G_FLOAT(PARM(0)), G_STRING(PARM(1)));
  };
  builtins[36] = () => {
    RETURN_FLOAT(Math.round(G_FLOAT(PARM(0))));
  };
  builtins[37] = () => {
    RETURN_FLOAT(Math.floor(G_FLOAT(PARM(0))));
  };
  builtins[38] = () => {
    RETURN_FLOAT(Math.ceil(G_FLOAT(PARM(0))));
  };
  builtins[39] = fixme;
  builtins[40] = () => {
    // PF_checkbottom(ent)
    const e = G_INT(PARM(0));
    RETURN_FLOAT(svCheckBottom(e) ? 1 : 0);
  };
  builtins[41] = () => {
    const p = G_VECTOR(PARM(0));
    RETURN_FLOAT(ctx.server.world.pointContents(p));
  };
  builtins[42] = fixme;
  builtins[43] = () => {
    RETURN_FLOAT(Math.abs(G_FLOAT(PARM(0))));
  };
  builtins[44] = () => {
    RETURN_VECTOR(G_VECTOR(ofs.v_forward));
  }; // aim stub
  builtins[45] = () => {
    // cvar(name) — enough for changelevel / registered checks
    const name = G_STRING(PARM(0));
    if (name === 'registered') RETURN_FLOAT(1);
    RETURN_FLOAT(0);
  };
  builtins[46] = () => {}; // localcmd
  builtins[47] = () => {
    let e = G_INT(PARM(0)) + 1;
    for (; e < edicts.numEdicts; e++) {
      if (!edicts.free[e]) {
        RETURN_INT(e);
        return;
      }
    }
    RETURN_INT(0);
  };
  builtins[48] = () => {
    // particle(org, dir, color, count)
    const org = G_VECTOR(PARM(0));
    const dir = G_VECTOR(PARM(1));
    const color = G_FLOAT(PARM(2)) | 0;
    const count = G_FLOAT(PARM(3)) | 0;
    ctx.server.particles?.runEffect(org, dir, color, count);
  };
  builtins[49] = () => {
    // PF_changeyaw
    svChangeYaw(G_INT(ofs.self));
  };
  builtins[50] = fixme;
  builtins[51] = () => {
    const v = G_VECTOR(PARM(0));
    let yaw = 0;
    let pitch = 0;
    if (v[1] === 0 && v[0] === 0) {
      yaw = 0;
      pitch = v[2] > 0 ? 90 : 270;
    } else {
      yaw = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
      if (yaw < 0) yaw += 360;
      const forward = Math.hypot(v[0], v[1]);
      pitch = (-Math.atan2(v[2], forward) * 180) / Math.PI;
      if (pitch < 0) pitch += 360;
    }
    RETURN_VECTOR([pitch, yaw, 0]);
  };
  // WriteByte / WriteChar / WriteShort / WriteLong / WriteCoord / WriteAngle / WriteString / WriteEntity
  builtins[52] = () => {
    ctx.server.writeByte(G_FLOAT(PARM(0)), G_FLOAT(PARM(1)));
  };
  builtins[53] = () => {
    ctx.server.writeChar(G_FLOAT(PARM(0)), G_FLOAT(PARM(1)));
  };
  builtins[54] = () => {
    ctx.server.writeShort(G_FLOAT(PARM(0)), G_FLOAT(PARM(1)));
  };
  builtins[55] = () => {
    ctx.server.writeLong(G_FLOAT(PARM(0)), G_FLOAT(PARM(1)));
  };
  builtins[56] = () => {
    ctx.server.writeCoord(G_FLOAT(PARM(0)), G_FLOAT(PARM(1)));
  };
  builtins[57] = () => {
    ctx.server.writeAngle(G_FLOAT(PARM(0)), G_FLOAT(PARM(1)));
  };
  builtins[58] = () => {
    ctx.server.writeString(G_FLOAT(PARM(0)), G_STRING(PARM(1)));
  };
  builtins[59] = () => {
    ctx.server.writeEntity(G_FLOAT(PARM(0)), G_INT(PARM(1)));
  };
  for (let i = 60; i <= 66; i++) builtins[i] = () => {};
  builtins[67] = () => {
    // SV_MoveToGoal — uses ideal_yaw (QC sets via HuntTarget / enemy_yaw paths)
    const self = G_INT(ofs.self);
    const dist = G_FLOAT(PARM(0));
    const flags = edicts.getFloat(self, f.flags) | 0;
    if (!(flags & (FL_ONGROUND | FL_FLY | FL_SWIM))) {
      RETURN_FLOAT(0);
      return;
    }
    const goalOfs = progs.fieldByName.get('goalentity')?.ofs;
    const enemyOfs = progs.fieldByName.get('enemy')?.ofs;
    const goal = goalOfs != null ? edicts.getInt(self, goalOfs) | 0 : 0;
    const enemy = enemyOfs != null ? edicts.getInt(self, enemyOfs) | 0 : 0;
    if (!goal || edicts.free[goal]) return;

    // if the next step hits the enemy, return immediately
    if (enemy && !edicts.free[enemy] && svCloseEnough(self, goal, dist)) {
      return;
    }

    const ideal =
      f.ideal_yaw >= 0 ? edicts.getFloat(self, f.ideal_yaw) : 0;
    if (((Math.random() * 4) | 0) === 1 || !svStepDirection(self, ideal, dist)) {
      svNewChaseDir(self, goal, dist);
    }
  }; // movetogoal
  builtins[68] = () => {
    // makestatic — free edict
    edicts.freeEdict(G_INT(ofs.self));
  };
  builtins[69] = builtins[20];
  builtins[70] = () => {
    // changelevel(map)
    const map = G_STRING(PARM(0));
    if (map) ctx.server.requestChangeLevel(map);
  };
  builtins[71] = fixme;
  builtins[72] = () => {}; // cvar_set
  builtins[73] = () => {
    // centerprint(clientent, value…) — PF_centerprint
    const entnum = G_INT(PARM(0));
    if (entnum < 1 || entnum > MAX_CLIENTS) return;
    const s = varString(1);
    ctx.server.writeByte(2, 26); // MSG_ALL, svc_centerprint
    ctx.server.writeString(2, s || '');
  };
  builtins[74] = () => {
    // ambientsound(pos, sample, vol, attenuation)
    const pos = G_VECTOR(PARM(0));
    const samp = G_STRING(PARM(1));
    const vol = G_FLOAT(PARM(2));
    const attenuation = G_FLOAT(PARM(3));
    ctx.server.startAmbientSound(pos, samp, vol, attenuation);
  };
  builtins[75] = builtins[20];
  builtins[76] = builtins[19];
  builtins[77] = () => {
    RETURN_INT(gi()[PARM(0)]);
  }; // precache_file
  builtins[78] = () => {}; // setspawnparms
  builtins[79] = fixme;
  builtins[80] = () => {
    // infokey(e, key) — empty unless needed
    RETURN_STRING('');
  };

  // silence unused
  void MOVETYPE_PUSH;
  void SOLID_BSP;
  void SOLID_TRIGGER;
  void FL_ITEM;

  return builtins;
}
