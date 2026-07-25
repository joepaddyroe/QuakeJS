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
  MOVETYPE_PUSH,
  MAX_CLIENTS,
} from './Edicts.js';
import { angleVectors } from '../math/QuakeMath.js';

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
    // traceline(v1, v2, nomonsters, ent)
    const v1 = G_VECTOR(PARM(0));
    const v2 = G_VECTOR(PARM(1));
    const tr = ctx.server.world.playerMove(
      v1,
      v2,
      new Float32Array([0, 0, 0]),
      new Float32Array([0, 0, 0]),
    );
    // Use hull0 for point trace — better:
    const hull = ctx.server.bsp.hulls[0];
    const trace = {
      allsolid: true,
      startsolid: false,
      inopen: false,
      inwater: false,
      fraction: 1,
      endpos: new Float32Array(v2),
      plane: { normal: new Float32Array(3), dist: 0 },
    };
    // Reuse recursive via World — point hull
    const w = ctx.server.world;
    const startL = new Float32Array(v1);
    const endL = new Float32Array(v2);
    const t = {
      allsolid: true,
      startsolid: false,
      inopen: false,
      inwater: false,
      fraction: 1,
      endpos: new Float32Array(v2),
      plane: { normal: new Float32Array(3), dist: 0 },
    };
    w._recursiveHullCheck(hull, hull.firstclipnode, 0, 1, startL, endL, t);
    SET_FLOAT(ofs.trace_allsolid, t.allsolid ? 1 : 0);
    SET_FLOAT(ofs.trace_startsolid, t.startsolid ? 1 : 0);
    SET_FLOAT(ofs.trace_fraction, t.fraction);
    SET_VECTOR(ofs.trace_endpos, t.endpos);
    SET_VECTOR(ofs.trace_plane_normal, t.plane.normal);
    SET_FLOAT(ofs.trace_plane_dist, t.plane.dist);
    SET_INT(ofs.trace_ent, 0);
    SET_FLOAT(ofs.trace_inopen, t.inopen ? 1 : 0);
    SET_FLOAT(ofs.trace_inwater, t.inwater ? 1 : 0);
    void tr;
  };
  builtins[17] = () => {
    // PF_checkclient — client only if in monster's view of client PVS
    const player = 1;
    if (edicts.free[player] || (edicts.getFloat(player, f.health) | 0) <= 0) {
      RETURN_INT(0);
      return;
    }
    if ((edicts.getFloat(player, f.flags) | 0) & FL_NOTARGET) {
      RETURN_INT(0);
      return;
    }
    const bsp = ctx.server.bsp;
    if (!bsp) {
      RETURN_INT(0);
      return;
    }
    // PVS is taken from the client (vanilla PF_newcheckclient)
    const po = edicts.getVec(player, f.origin);
    const pvo = edicts.getVec(player, f.view_ofs);
    const peye = [po[0] + pvo[0], po[1] + pvo[1], po[2] + pvo[2]];
    const playerLeaf = bsp.pointInLeaf(peye);
    const pvs = Uint8Array.from(bsp.leafPVS(playerLeaf));

    const self = G_INT(ofs.self);
    const so = edicts.getVec(self, f.origin);
    const svo = edicts.getVec(self, f.view_ofs);
    const eye = [so[0] + svo[0], so[1] + svo[1], so[2] + svo[2]];
    const selfLeaf = bsp.pointInLeaf(eye);
    // leafs[0] solid; PVS bit i ↔ leafs[i+1]
    const bit = selfLeaf - 1;
    if (bit < 0 || !(pvs[bit >> 3] & (1 << (bit & 7)))) {
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
    // walkmove(yaw, dist) — PF_walkmove / SV_movestep subset
    const self = G_INT(ofs.self);
    const flags = edicts.getFloat(self, f.flags) | 0;
    if (!(flags & (FL_ONGROUND | FL_FLY | FL_SWIM))) {
      RETURN_FLOAT(0);
      return;
    }
    const yaw = (G_FLOAT(PARM(0)) * Math.PI) / 180;
    const dist = G_FLOAT(PARM(1));
    const o = edicts.getVec(self, f.origin);
    const end = new Float32Array([
      o[0] + Math.cos(yaw) * dist,
      o[1] + Math.sin(yaw) * dist,
      o[2],
    ]);
    const mins = new Float32Array(edicts.getVec(self, f.mins));
    const maxs = new Float32Array(edicts.getVec(self, f.maxs));
    // Step up then down (SV_movestep STEPSIZE=18 subset)
    const STEP = 18;
    const raised = new Float32Array([end[0], end[1], end[2] + STEP]);
    const down = new Float32Array([end[0], end[1], end[2] - STEP]);
    const trUp = ctx.server.world.playerMove(o, raised, mins, maxs);
    const start = trUp.fraction < 1 && !trUp.allsolid ? trUp.endpos : raised;
    const tr = ctx.server.world.playerMove(start, down, mins, maxs);
    if (tr.allsolid || tr.startsolid || tr.fraction === 1) {
      RETURN_FLOAT(0);
      return;
    }
    edicts.setVec(self, f.origin, tr.endpos);
    edicts.linkAbs(self);
    if (tr.plane.normal[2] > 0.7) {
      edicts.setFloat(self, f.flags, flags | FL_ONGROUND);
    }
    RETURN_FLOAT(1);
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
    RETURN_FLOAT(1);
  }; // checkbottom
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
    // changeyaw
    const self = G_INT(ofs.self);
    if (f.ideal_yaw < 0) return;
    const ideal = edicts.getFloat(self, f.ideal_yaw);
    const angles = edicts.getVec(self, f.angles);
    let current = angles[1];
    let move = ideal - current;
    if (ideal > current) {
      if (move >= 180) move -= 360;
    } else if (move <= -180) move += 360;
    const speed = f.yaw_speed >= 0 ? edicts.getFloat(self, f.yaw_speed) : 20;
    if (move > 0) {
      if (move > speed) move = speed;
    } else if (move < -speed) move = -speed;
    angles[1] = current + move;
    edicts.setVec(self, f.angles, angles);
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
    // SV_MoveToGoal — step toward goalentity; stop when CloseEnough
    const self = G_INT(ofs.self);
    const dist = G_FLOAT(PARM(0));
    const flags = edicts.getFloat(self, f.flags) | 0;
    if (!(flags & (FL_ONGROUND | FL_FLY | FL_SWIM))) {
      RETURN_FLOAT(0);
      return;
    }
    const goalOfs = progs.fieldByName.get('goalentity')?.ofs;
    const enemyOfs = progs.fieldByName.get('enemy')?.ofs;
    let goal = goalOfs != null ? edicts.getInt(self, goalOfs) | 0 : 0;
    const enemy = enemyOfs != null ? edicts.getInt(self, enemyOfs) | 0 : 0;
    if (!goal || edicts.free[goal]) goal = enemy;
    if (!goal || edicts.free[goal]) {
      RETURN_FLOAT(0);
      return;
    }

    // SV_CloseEnough — next step would hit goal → don't walk (QC attacks)
    const amax = edicts.getVec(self, f.absmax);
    const amin = edicts.getVec(self, f.absmin);
    const gmax = edicts.getVec(goal, f.absmax);
    const gmin = edicts.getVec(goal, f.absmin);
    let close = true;
    for (let i = 0; i < 3; i++) {
      if (gmin[i] > amax[i] + dist || gmax[i] < amin[i] - dist) {
        close = false;
        break;
      }
    }
    if (close) {
      RETURN_FLOAT(1);
      return;
    }

    const o = edicts.getVec(self, f.origin);
    const t = edicts.getVec(goal, f.origin);
    const dx = t[0] - o[0];
    const dy = t[1] - o[1];
    const len = Math.hypot(dx, dy) || 1;
    let yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
    const idealOfs = progs.fieldByName.get('ideal_yaw')?.ofs;
    if (idealOfs != null) edicts.setFloat(self, idealOfs, yaw);
    edicts.setVec(self, f.angles, [0, yaw, 0]);

    const rad = (yaw * Math.PI) / 180;
    const end = new Float32Array([
      o[0] + Math.cos(rad) * dist,
      o[1] + Math.sin(rad) * dist,
      o[2],
    ]);
    const mins = new Float32Array(edicts.getVec(self, f.mins));
    const maxs = new Float32Array(edicts.getVec(self, f.maxs));
    const STEP = 18;
    const raised = new Float32Array([end[0], end[1], end[2] + STEP]);
    const down = new Float32Array([end[0], end[1], end[2] - STEP]);
    const trUp = ctx.server.world.playerMove(o, raised, mins, maxs);
    const start = !trUp.allsolid ? trUp.endpos : raised;
    const tr = ctx.server.world.playerMove(start, down, mins, maxs);
    if (tr.allsolid || tr.startsolid || tr.fraction === 1) {
      // Blocked / cliff — try a random side step (SV_NewChaseDir lite)
      const side = (Math.random() < 0.5 ? 1 : -1) * 90;
      const syaw = ((yaw + side) * Math.PI) / 180;
      const sideEnd = new Float32Array([
        o[0] + Math.cos(syaw) * dist,
        o[1] + Math.sin(syaw) * dist,
        o[2],
      ]);
      const sideRaised = new Float32Array([
        sideEnd[0],
        sideEnd[1],
        sideEnd[2] + STEP,
      ]);
      const sideDown = new Float32Array([
        sideEnd[0],
        sideEnd[1],
        sideEnd[2] - STEP,
      ]);
      const su = ctx.server.world.playerMove(o, sideRaised, mins, maxs);
      const ss = !su.allsolid ? su.endpos : sideRaised;
      const st = ctx.server.world.playerMove(ss, sideDown, mins, maxs);
      if (st.allsolid || st.startsolid || st.fraction === 1) {
        RETURN_FLOAT(0);
        return;
      }
      edicts.setVec(self, f.origin, st.endpos);
      if (idealOfs != null) edicts.setFloat(self, idealOfs, yaw + side);
    } else {
      edicts.setVec(self, f.origin, tr.endpos);
    }
    edicts.linkAbs(self);
    edicts.setFloat(self, f.flags, (edicts.getFloat(self, f.flags) | 0) | FL_ONGROUND);
    RETURN_FLOAT(1);
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
