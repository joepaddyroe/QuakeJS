/**
 * Local single-player server scaffold (sv_main / sv_phys subset).
 * Loads progs, spawns map entities, runs think / PUSH / TOSS, trigger touch.
 */

import { Progs } from '../progs/Progs.js';
import {
  EdictStore,
  MAX_CLIENTS,
  MOVETYPE_NONE,
  MOVETYPE_PUSH,
  MOVETYPE_TOSS,
  MOVETYPE_WALK,
  MOVETYPE_FLY,
  MOVETYPE_FLYMISSILE,
  MOVETYPE_BOUNCE,
  MOVETYPE_NOCLIP,
  SOLID_NOT,
  SOLID_TRIGGER,
  SOLID_BSP,
  SOLID_SLIDEBOX,
  FL_ONGROUND,
  FL_CLIENT,
} from '../progs/Edicts.js';
import { PrExec } from '../progs/PrExec.js';
import { createBuiltins } from '../progs/Builtins.js';
import { OFS_PARM0 } from '../progs/Progs.js';
import { angleVectors } from '../math/QuakeMath.js';
import { World } from './World.js';
import { PLAYER_MINS, PLAYER_MAXS } from './PlayerMove.js';

/**
 * @param {string} data
 * @returns {{ token: string, data: string } | null}
 */
function comParse(data) {
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '/' && data[i + 1] === '/') {
      while (i < data.length && data[i] !== '\n') i++;
      continue;
    }
    break;
  }
  if (i >= data.length) return null;
  let token = '';
  if (data[i] === '"') {
    i++;
    while (i < data.length && data[i] !== '"') token += data[i++];
    if (i < data.length) i++;
    return { token, data: data.slice(i) };
  }
  while (
    i < data.length &&
    data[i] !== ' ' &&
    data[i] !== '\t' &&
    data[i] !== '\r' &&
    data[i] !== '\n'
  ) {
    token += data[i++];
  }
  return { token, data: data.slice(i) };
}

export class Server {
  /**
   * @param {import('../render/models/BspModel.js').BspModel} bsp
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   * @param {string} mapName
   */
  constructor(bsp, fs, mapName) {
    this.bsp = bsp;
    this.fs = fs;
    this.mapName = mapName.replace(/^maps\//, '').replace(/\.bsp$/i, '');
    this.world = new World(bsp);
    this.progs = new Progs(fs.load('progs.dat'));
    this.edicts = new EdictStore(this.progs);
    /** @type {string[]} */
    this.modelPrecache = [''];
    this.modelPrecache.push(`maps/${this.mapName}.bsp`); // index 1 = world

    /** @type {PrExec} */
    this.exec = null;
    const self = this;
    this.exec = new PrExec(
      this.progs,
      this.edicts,
      createBuiltins({
        get progs() {
          return self.progs;
        },
        get edicts() {
          return self.edicts;
        },
        get exec() {
          return self.exec;
        },
        get server() {
          return self;
        },
      }),
    );

    this.time = 1.0;
    this._clientLoadoutReady = false;
    this.edicts.time = this.time;
    /** @type {string|null} */
    this.pendingMap = null;
    this._changelevelIssued = false;
    this._spawnEntities();
    // Settle
    const saved = 0.1;
    for (let i = 0; i < 2; i++) this.physics(saved);
  }

  /**
   * @param {string} map short name e.g. "e1m1"
   */
  requestChangeLevel(map) {
    if (this._changelevelIssued) return;
    this._changelevelIssued = true;
    const name = map.replace(/^maps\//, '').replace(/\.bsp$/i, '');
    this.pendingMap = name;
    console.info(`[server] changelevel → ${name}`);
  }

  /**
   * @returns {boolean}
   */
  isIntermission() {
    const ofs = this.progs.globalOfs.get('intermission_running');
    if (ofs === undefined) return false;
    return !!this.progs.globalsF[ofs];
  }

  /**
   * SV_Physics_Client subset — PlayerPreThink (intermission / rules).
   * @param {number} ent
   * @param {{ attack?: boolean, jump?: boolean }} buttons
   */
  runClientThink(ent, buttons = {}) {
    const progs = this.progs;
    const edicts = this.edicts;
    const f = progs.f;
    const ofs = progs.ofs;
    const gi = progs.globalsI;
    const gf = progs.globalsF;

    edicts.setFloat(ent, f.button0, buttons.attack ? 1 : 0);
    edicts.setFloat(ent, f.button1, 0);
    edicts.setFloat(ent, f.button2, buttons.jump ? 1 : 0);

    const pre = gi[ofs.PlayerPreThink];
    if (!pre) return;
    gi[ofs.self] = ent;
    gi[ofs.other] = 0;
    gf[ofs.time] = this.time;
    try {
      this.exec.execute(pre);
    } catch (err) {
      this.exec.reset();
      console.error('PlayerPreThink', err);
    }
  }

  /**
   * @param {string} name
   * @returns {number} modelindex
   */
  precacheModel(name) {
    if (!name) return 0;
    let i = this.modelPrecache.indexOf(name);
    if (i >= 0) return i;
    this.modelPrecache.push(name);
    return this.modelPrecache.length - 1;
  }

  /**
   * @param {string} name
   * @returns {{ mins: Float32Array, maxs: Float32Array } | null}
   */
  modelBounds(name) {
    if (!name) return null;
    if (name.startsWith('*')) {
      const idx = parseInt(name.slice(1), 10);
      const sm = this.bsp.submodels[idx];
      if (!sm) return null;
      return { mins: sm.mins, maxs: sm.maxs };
    }
    // Alias/sprite — stub empty
    return {
      mins: new Float32Array([-16, -16, -16]),
      maxs: new Float32Array([16, 16, 16]),
    };
  }

  _spawnEntities() {
    const progs = this.progs;
    const edicts = this.edicts;
    const gi = progs.globalsI;
    const gf = progs.globalsF;
    const f = progs.f;
    const ofs = progs.ofs;

    // World edict 0
    edicts.setInt(0, f.model, progs.allocString(`maps/${this.mapName}.bsp`));
    edicts.setFloat(0, f.modelindex, 1);
    edicts.setFloat(0, f.solid, SOLID_BSP);
    edicts.setFloat(0, f.movetype, MOVETYPE_PUSH);
    const w = this.bsp.submodels[0];
    edicts.setVec(0, f.mins, w.mins);
    edicts.setVec(0, f.maxs, w.maxs);
    edicts.linkAbs(0);

    gi[ofs.world] = 0;
    gi[ofs.mapname] = progs.allocString(this.mapName);
    gf[ofs.deathmatch] = 0;
    gf[ofs.coop] = 0;
    gf[ofs.time] = this.time;
    gf[ofs.frametime] = 0.1;

    let data = this.bsp.entities;
    let inhibit = 0;
    let first = true;

    while (true) {
      const open = comParse(data);
      if (!open) break;
      data = open.data;
      if (open.token !== '{') {
        throw new Error(`ED_LoadFromFile: expected { got ${open.token}`);
      }

      const ent = first ? 0 : edicts.alloc();
      first = false;
      if (ent !== 0) edicts.clear(ent);

      // Parse epairs
      while (true) {
        const keyP = comParse(data);
        if (!keyP) throw new Error('EOF inside entity');
        data = keyP.data;
        if (keyP.token === '}') break;
        const keyname = keyP.token;
        const valP = comParse(data);
        if (!valP) throw new Error('EOF reading value');
        data = valP.data;
        const value = valP.token;

        if (keyname === 'angle') {
          const field = progs.fieldByName.get('angles');
          if (field) {
            edicts.setVec(ent, field.ofs, [0, parseFloat(value) || 0, 0]);
          }
          continue;
        }
        if (keyname === 'light') {
          const field =
            progs.fieldByName.get('light_lev') || progs.fieldByName.get('light');
          if (field) edicts.setFloat(ent, field.ofs, parseFloat(value) || 0);
          continue;
        }

        const field = progs.fieldByName.get(keyname);
        if (!field) continue;
        this._parseEpair(ent, field, value);
      }

      const spawnflags = edicts.getFloat(ent, f.spawnflags) | 0;
      // skill 1 (medium): skip NOT_MEDIUM (512)
      if (spawnflags & 512) {
        if (ent !== 0) edicts.freeEdict(ent);
        inhibit++;
        continue;
      }

      const classname = progs.stringAt(edicts.getInt(ent, f.classname));
      if (!classname) {
        if (ent !== 0) edicts.freeEdict(ent);
        continue;
      }

      if (classname === 'worldspawn') {
        edicts.setFloat(0, f.solid, SOLID_BSP);
        edicts.setFloat(0, f.movetype, MOVETYPE_PUSH);
        edicts.setFloat(0, f.modelindex, 1);
        edicts.setInt(0, f.model, progs.allocString(`maps/${this.mapName}.bsp`));
      }

      const func = progs.findFunction(classname);
      if (!func) {
        console.warn(`No spawn function for ${classname}`);
        if (ent !== 0) edicts.freeEdict(ent);
        continue;
      }

      gi[ofs.self] = ent;
      gi[ofs.other] = 0;
      gf[ofs.time] = this.time;
      try {
        this.exec.execute(func);
      } catch (err) {
        console.error(`Spawn ${classname} failed:`, err);
        if (ent !== 0) edicts.freeEdict(ent);
      }
    }

    console.info(
      `[server] spawned ${edicts.numEdicts} edicts (${inhibit} inhibited) on ${this.mapName}`,
    );
  }

  /**
   * @param {number} ent
   * @param {{ type: number, ofs: number }} field
   * @param {string} value
   */
  _parseEpair(ent, field, value) {
    const type = field.type & ~0x8000;
    const edicts = this.edicts;
    const progs = this.progs;
    switch (type) {
      case 1: // string
        edicts.setInt(ent, field.ofs, progs.allocString(value));
        break;
      case 2: // float
        edicts.setFloat(ent, field.ofs, parseFloat(value) || 0);
        break;
      case 3: { // vector
        const p = value.trim().split(/\s+/).map(Number);
        edicts.setVec(ent, field.ofs, [p[0] || 0, p[1] || 0, p[2] || 0]);
        break;
      }
      case 4: // entity
        edicts.setInt(ent, field.ofs, 0);
        break;
      case 5: // field
        {
          const fdef = progs.fieldByName.get(value);
          edicts.setInt(ent, field.ofs, fdef ? fdef.ofs : 0);
        }
        break;
      case 6: // function
        edicts.setInt(ent, field.ofs, progs.findFunction(value));
        break;
      default:
        break;
    }
  }

  /**
   * @param {number} frametime
   * @param {import('./PlayerMove.js').PlayerMove | null} [player] local player to ride pushers
   */
  physics(frametime, player = null) {
    const progs = this.progs;
    const edicts = this.edicts;
    const gi = progs.globalsI;
    const gf = progs.globalsF;
    const ofs = progs.ofs;
    const f = progs.f;

    if (frametime > 0.1) frametime = 0.1;
    gf[ofs.frametime] = frametime;
    gf[ofs.time] = this.time;
    edicts.time = this.time;

    // Keep brush clip origins in sync while pushers move this frame
    this.world.brushes = this.getBrushDrawList();

    // StartFrame
    const startFrame = gi[ofs.StartFrame];
    if (startFrame) {
      gi[ofs.self] = 0;
      gi[ofs.other] = 0;
      try {
        this.exec.execute(startFrame);
      } catch (err) {
        this.exec.reset();
        console.error('StartFrame', err);
      }
    }

    for (let e = 0; e < edicts.numEdicts; e++) {
      if (edicts.free[e]) continue;
      // Skip client slot for now (player handled outside)
      if (e >= 1 && e <= MAX_CLIENTS) continue;

      const movetype = edicts.getFloat(e, f.movetype) | 0;
      switch (movetype) {
        case MOVETYPE_PUSH:
          this._physicsPusher(e, frametime, player);
          break;
        case MOVETYPE_NONE:
          this._runThink(e, frametime);
          break;
        case MOVETYPE_TOSS:
        case MOVETYPE_BOUNCE:
        case MOVETYPE_FLYMISSILE:
          this._physicsToss(e, frametime);
          break;
        case MOVETYPE_FLY:
        case MOVETYPE_WALK:
        case MOVETYPE_NOCLIP:
          this._runThink(e, frametime);
          break;
        default:
          this._runThink(e, frametime);
          break;
      }
    }

    this.time += frametime;
    gf[ofs.time] = this.time;
    edicts.time = this.time;
  }

  /**
   * @param {number} ent
   * @param {number} frametime
   */
  _runThink(ent, frametime) {
    const f = this.progs.f;
    const ofs = this.progs.ofs;
    const thinktime = this.edicts.getFloat(ent, f.nextthink);
    if (!thinktime || thinktime <= 0 || thinktime > this.time + frametime) return;
    this.edicts.setFloat(ent, f.nextthink, 0);
    const think = this.edicts.getInt(ent, f.think);
    if (!think) return;
    this.progs.globalsF[ofs.time] = thinktime;
    this.progs.globalsI[ofs.self] = ent;
    this.progs.globalsI[ofs.other] = 0;
    try {
      this.exec.execute(think);
    } catch (err) {
      this.exec.reset();
      console.error(`think ent ${ent}`, err);
    }
  }

  /**
   * SV_Physics_Pusher + SV_PushMove subset — move brush, carry local player.
   * @param {number} ent
   * @param {number} frametime
   * @param {import('./PlayerMove.js').PlayerMove | null} [player]
   */
  _physicsPusher(ent, frametime, player = null) {
    const f = this.progs.f;
    const edicts = this.edicts;
    let movetime = frametime;
    const thinktime = edicts.getFloat(ent, f.nextthink);
    const oldltime = edicts.getFloat(ent, f.ltime);
    // WinQuake SV_Physics_Pusher: clamp move to thinktime; past/negative nextthink → 0
    if (thinktime < oldltime + frametime) {
      movetime = thinktime - oldltime;
      if (movetime < 0) movetime = 0;
    }

    const vel = edicts.getVec(ent, f.velocity);
    const move = [vel[0] * movetime, vel[1] * movetime, vel[2] * movetime];

    if (!move[0] && !move[1] && !move[2]) {
      edicts.setFloat(ent, f.ltime, oldltime + movetime);
      this._pusherTryThink(ent, thinktime, oldltime);
      return;
    }

    const pushorig = edicts.getVec(ent, f.origin);
    const pushorigCopy = [pushorig[0], pushorig[1], pushorig[2]];

    edicts.setVec(ent, f.origin, [
      pushorig[0] + move[0],
      pushorig[1] + move[1],
      pushorig[2] + move[2],
    ]);
    edicts.linkAbs(ent);
    edicts.setFloat(ent, f.ltime, oldltime + movetime);
    this.world.brushes = this.getBrushDrawList();

    if (player && !player.noclip) {
      const ok = this._pushLocalPlayer(ent, move, player);
      if (!ok) {
        edicts.setVec(ent, f.origin, pushorigCopy);
        edicts.linkAbs(ent);
        edicts.setFloat(ent, f.ltime, oldltime);
        this.world.brushes = this.getBrushDrawList();

        const blocked = edicts.getInt(ent, f.blocked);
        if (blocked) {
          this.progs.globalsI[this.progs.ofs.self] = ent;
          this.progs.globalsI[this.progs.ofs.other] = 1;
          this.progs.globalsF[this.progs.ofs.time] = this.time;
          try {
            this.exec.execute(blocked);
          } catch (err) {
            this.exec.reset();
            console.error(`blocked ${ent}`, err);
          }
        }
        return;
      }
    }

    this._pusherTryThink(ent, thinktime, oldltime);
  }

  /**
   * WinQuake: thinktime > oldltime && thinktime <= ltime
   * (wait=-1 sets nextthink = ltime-1 so the return think must NOT run).
   * @param {number} ent
   * @param {number} thinktime nextthink captured before the move
   * @param {number} oldltime ltime before the move
   */
  _pusherTryThink(ent, thinktime, oldltime) {
    const f = this.progs.f;
    const edicts = this.edicts;
    if (thinktime > oldltime && thinktime <= edicts.getFloat(ent, f.ltime)) {
      edicts.setFloat(ent, f.nextthink, 0);
      const think = edicts.getInt(ent, f.think);
      if (think) {
        this.progs.globalsF[this.progs.ofs.time] = this.time;
        this.progs.globalsI[this.progs.ofs.self] = ent;
        this.progs.globalsI[this.progs.ofs.other] = 0;
        try {
          this.exec.execute(think);
        } catch (err) {
          this.exec.reset();
          console.error(`push think ${ent}`, err);
        }
        this.world.brushes = this.getBrushDrawList();
      }
    }
  }

  /**
   * Carry local player only when standing on the pusher (plats).
   * Do not lateral-drag through doors — that feels like ghosting.
   * @param {number} pusher
   * @param {number[]} move
   * @param {import('./PlayerMove.js').PlayerMove} player
   * @returns {boolean} false if move blocked
   */
  _pushLocalPlayer(pusher, move, player) {
    const onPusher = player.onground && (player.groundEntity | 0) === pusher;

    if (!onPusher) {
      // After pusher moved: if player is embedded, fail move (door_blocked / crush)
      if (this.world.testPlayerPosition(player.origin, PLAYER_MINS, PLAYER_MAXS, 0)) {
        return false;
      }
      return true;
    }

    const oldOrg = [player.origin[0], player.origin[1], player.origin[2]];
    const oldSmooth = player._smoothZ;

    const end = new Float32Array([
      player.origin[0] + move[0],
      player.origin[1] + move[1],
      player.origin[2] + move[2],
    ]);
    const savedBrushes = this.world.brushes;
    this.world.brushes = savedBrushes.filter((b) => b.edict !== pusher);
    const tr = this.world.playerMove(player.origin, end, PLAYER_MINS, PLAYER_MAXS);
    this.world.brushes = savedBrushes;

    player.origin[0] = tr.endpos[0];
    player.origin[1] = tr.endpos[1];
    player.origin[2] = tr.endpos[2];
    player._smoothZ = player.origin[2];

    if (this.world.testPlayerPosition(player.origin, PLAYER_MINS, PLAYER_MAXS, pusher)) {
      player.origin[0] = oldOrg[0];
      player.origin[1] = oldOrg[1];
      player.origin[2] = oldOrg[2];
      player._smoothZ = oldSmooth;
      return false;
    }

    player.onground = true;
    player.groundEntity = pusher;
    return true;
  }

  /**
   * Walk-up doors: fat trigger normally opens them; also open on bump if
   * the door has no targetname / key / health (vanilla touch field doors).
   * @param {number} playerEnt
   * @param {Iterable<number>|number[]} hitEnts
   */
  bumpOpenDoors(playerEnt, hitEnts) {
    const edicts = this.edicts;
    const f = this.progs.f;
    const progs = this.progs;
    const ofs = this.progs.ofs;
    const doorUse = progs.findFunction('door_use');
    const actOfs = progs.globalOfs.get('activator');
    const seen = new Set();

    for (const e of hitEnts) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      if (edicts.free[e]) continue;
      if ((edicts.getFloat(e, f.solid) | 0) !== SOLID_BSP) continue;
      if (progs.stringAt(edicts.getInt(e, f.classname)) !== 'door') continue;
      if (edicts.getInt(e, f.use) !== doorUse) continue;
      if (progs.stringAt(edicts.getInt(e, f.targetname))) continue;
      if (edicts.getFloat(e, f.items)) continue;
      if (edicts.getFloat(e, f.health) > 0) continue;

      if (actOfs !== undefined) progs.globalsI[actOfs] = playerEnt;
      progs.globalsI[ofs.self] = e;
      progs.globalsI[ofs.other] = playerEnt;
      progs.globalsF[ofs.time] = this.time;
      const use = edicts.getInt(e, f.use);
      if (!use) continue;
      try {
        this.exec.execute(use);
      } catch (err) {
        this.exec.reset();
        console.error(`door use ${e}`, err);
      }
    }
  }

  /**
   * @param {number} ent
   * @param {number} frametime
   */
  _physicsToss(ent, frametime) {
    this._runThink(ent, frametime);
    if (this.edicts.free[ent]) return;
    const f = this.progs.f;
    if ((this.edicts.getFloat(ent, f.flags) | 0) & FL_ONGROUND) return;

    // Gravity
    const vel = this.edicts.getVec(ent, f.velocity);
    vel[2] -= 800 * frametime;
    this.edicts.setVec(ent, f.velocity, vel);

    const o = this.edicts.getVec(ent, f.origin);
    const end = new Float32Array([
      o[0] + vel[0] * frametime,
      o[1] + vel[1] * frametime,
      o[2] + vel[2] * frametime,
    ]);
    const mins = new Float32Array(this.edicts.getVec(ent, f.mins));
    const maxs = new Float32Array(this.edicts.getVec(ent, f.maxs));
    const tr = this.world.playerMove(o, end, mins, maxs);
    this.edicts.setVec(ent, f.origin, tr.endpos);
    this.edicts.linkAbs(ent);
    if (tr.fraction < 1) {
      if (tr.plane.normal[2] > 0.7) {
        this.edicts.setFloat(
          ent,
          f.flags,
          (this.edicts.getFloat(ent, f.flags) | 0) | FL_ONGROUND,
        );
        this.edicts.setVec(ent, f.velocity, [0, 0, 0]);
      }
    }
  }

  /**
   * Mirror local player into reserved client edict (svs.clients[0] → edict 1).
   * QuakeC teleports/triggers require classname "player", health > 0, SOLID_SLIDEBOX.
   * @param {number} ent
   * @param {{ origin: Float32Array|number[], velocity?: Float32Array|number[], pitch?: number, yaw?: number, mins?: Float32Array|number[], maxs?: Float32Array|number[], health?: number, onground?: boolean, groundEntity?: number }} player
   */
  syncClientEdict(ent, player) {
    const f = this.progs.f;
    const edicts = this.edicts;
    const progs = this.progs;
    edicts.free[ent] = false;
    if (!this._playerClassname) {
      this._playerClassname = progs.allocString('player');
    }
    edicts.setInt(ent, f.classname, this._playerClassname);
    edicts.setVec(ent, f.origin, player.origin);
    if (player.velocity) edicts.setVec(ent, f.velocity, player.velocity);
    if (player.mins) edicts.setVec(ent, f.mins, player.mins);
    if (player.maxs) edicts.setVec(ent, f.maxs, player.maxs);
    edicts.setVec(ent, f.angles, [0, player.yaw || 0, 0]);
    edicts.setVec(ent, f.v_angle, [player.pitch || 0, player.yaw || 0, 0]);
    edicts.setFloat(ent, f.movetype, MOVETYPE_WALK);
    edicts.setFloat(ent, f.solid, SOLID_SLIDEBOX);
    edicts.setFloat(ent, f.health, player.health ?? 100);
    // Never draw a third-person body on the local client
    edicts.setInt(ent, f.model, 0);
    edicts.setFloat(ent, f.modelindex, 0);
    let flags = FL_CLIENT;
    if (player.onground) flags |= FL_ONGROUND;
    edicts.setFloat(ent, f.flags, flags);
    edicts.setInt(ent, f.groundentity, player.groundEntity | 0);
    this._ensureClientLoadout(ent);
    edicts.linkAbs(ent);
  }

  /**
   * W_SetCurrentAmmo weapon → view model (single active weapon only).
   * @param {number} weapon IT_* bit
   * @returns {string}
   */
  _viewModelForWeapon(weapon) {
    const w = weapon | 0;
    if (w === 4096) return 'progs/v_axe.mdl'; // IT_AXE
    if (w === 1) return 'progs/v_shot.mdl'; // IT_SHOTGUN
    if (w === 2) return 'progs/v_shot2.mdl';
    if (w === 4) return 'progs/v_nail.mdl';
    if (w === 8) return 'progs/v_nail2.mdl';
    if (w === 16) return 'progs/v_rock.mdl';
    if (w === 32) return 'progs/v_rock2.mdl';
    if (w === 64) return 'progs/v_light.mdl';
    return 'progs/v_shot.mdl';
  }

  /**
   * SetNewParms + W_SetCurrentAmmo subset until full PutClientInServer.
   * @param {number} ent
   */
  _ensureClientLoadout(ent) {
    if (this._clientLoadoutReady) return;
    const f = this.progs.f;
    const edicts = this.edicts;
    // IT_SHOTGUN|IT_AXE|IT_SHELLS — SetNewParms; active weapon is shotgun only
    const IT_AXE = 4096;
    const IT_SHOTGUN = 1;
    const IT_SHELLS = 256;
    edicts.setFloat(ent, f.items, IT_SHOTGUN | IT_AXE | IT_SHELLS);
    edicts.setFloat(ent, f.weapon, IT_SHOTGUN);
    edicts.setFloat(ent, f.ammo_shells, 25);
    edicts.setFloat(ent, f.currentammo, 25);
    edicts.setFloat(ent, f.weaponframe, 0);
    const path = this._viewModelForWeapon(IT_SHOTGUN);
    edicts.setInt(ent, f.weaponmodel, this.progs.allocString(path));
    this.precacheModel(path);
    this._clientLoadoutReady = true;
  }

  /**
   * cl.viewent setup (V_CalcRefdef gun pose subset).
   * @param {{ origin: Float32Array, pitch: number, yaw: number, viewOfsZ: number, _smoothZ: number }} player
   * @returns {{ model: string, origin: Float32Array, pitch: number, yaw: number, frame: number } | null}
   */
  getViewWeapon(player) {
    const f = this.progs.f;
    const edicts = this.edicts;
    const ent = 1;
    if (edicts.free[ent]) return null;
    if ((edicts.getFloat(ent, f.health) | 0) <= 0) return null;
    // Always resolve from .weapon (W_SetCurrentAmmo) — one view model, never axe+gun.
    const weapon = edicts.getFloat(ent, f.weapon) | 0;
    const model = this._viewModelForWeapon(weapon || 1);
    const origin = new Float32Array([
      player.origin[0],
      player.origin[1],
      player._smoothZ + player.viewOfsZ + 2,
    ]);
    return {
      model,
      origin,
      pitch: player.pitch,
      yaw: player.yaw,
      frame: edicts.getFloat(ent, f.weaponframe) | 0,
    };
  }

  /**
   * Copy QC-side changes (teleport setorigin / fixangle / velocity) back to the local player.
   * @param {number} ent
   * @param {{ origin: Float32Array, velocity: Float32Array, pitch: number, yaw: number, onground: boolean, _smoothZ?: number }} player
   * @returns {{ fixangle: boolean, pitch: number, yaw: number }}
   */
  applyClientEdict(ent, player) {
    const f = this.progs.f;
    const edicts = this.edicts;
    const o = edicts.getVec(ent, f.origin);
    const dx = o[0] - player.origin[0];
    const dy = o[1] - player.origin[1];
    const dz = o[2] - player.origin[2];
    const teleported = dx * dx + dy * dy + dz * dz > 1;
    player.origin[0] = o[0];
    player.origin[1] = o[1];
    player.origin[2] = o[2];
    if (teleported && '_smoothZ' in player) player._smoothZ = o[2];
    const vel = edicts.getVec(ent, f.velocity);
    player.velocity[0] = vel[0];
    player.velocity[1] = vel[1];
    player.velocity[2] = vel[2];
    player.onground = !!(edicts.getFloat(ent, f.flags) & FL_ONGROUND);

    const fix = edicts.getFloat(ent, f.fixangle) | 0;
    let pitch = player.pitch;
    let yaw = player.yaw;
    if (fix) {
      // teleport_touch sets angles = dest.mangle and fixangle; not v_angle
      const ang = edicts.getVec(ent, f.angles);
      pitch = ang[0];
      yaw = ang[1];
      player.pitch = pitch;
      player.yaw = yaw;
      edicts.setVec(ent, f.v_angle, [pitch, yaw, 0]);
      edicts.setFloat(ent, f.fixangle, 0);
    }
    return { fixangle: !!fix, pitch, yaw };
  }

  /**
   * Non-brush models to draw (items, monsters, …).
   * @returns {{ model: string, origin: Float32Array, yaw: number, frame: number }[]}
   */
  getAliasDrawList() {
    const edicts = this.edicts;
    const f = this.progs.f;
    const progs = this.progs;
    /** @type {{ model: string, origin: Float32Array, yaw: number, frame: number }[]} */
    const out = [];
    for (let e = 1; e < edicts.numEdicts; e++) {
      if (edicts.free[e]) continue;
      // cl_main.c CL_RelinkEntities: skip cl.viewentity unless chase_active
      if (e === 1) continue;
      if ((edicts.getFloat(e, f.flags) | 0) & FL_CLIENT) continue;
      const classname = progs.stringAt(edicts.getInt(e, f.classname));
      if (classname === 'player') continue;
      const model = progs.stringAt(edicts.getInt(e, f.model));
      if (!model || model[0] === '*') continue;
      if (!model.endsWith('.mdl')) continue;
      // View weapons are cl.viewent only; never draw player body MDLs in FP
      if (
        model.includes('/v_') ||
        model === 'progs/player.mdl' ||
        model === 'progs/eyes.mdl' ||
        model === 'progs/h_player.mdl'
      ) {
        continue;
      }
      const solid = edicts.getFloat(e, f.solid) | 0;
      // Skip pure triggers / removed visuals
      if (solid === SOLID_NOT && !(edicts.getFloat(e, f.modelindex) > 0)) continue;
      const o = edicts.getVec(e, f.origin);
      const ang = edicts.getVec(e, f.angles);
      const frame = edicts.getFloat(e, f.frame) | 0;
      out.push({
        model,
        origin: new Float32Array([o[0], o[1], o[2]]),
        yaw: ang[1] || 0,
        frame,
      });
    }
    return out;
  }

  /**
   * Brush models to draw / clip (doors/plats/buttons) — *N submodels with SOLID_BSP.
   * @returns {{ submodel: number, origin: Float32Array, edict: number }[]}
   */
  getBrushDrawList() {
    const edicts = this.edicts;
    const f = this.progs.f;
    const progs = this.progs;
    /** @type {{ submodel: number, origin: Float32Array, edict: number }[]} */
    const out = [];
    for (let e = 1; e < edicts.numEdicts; e++) {
      if (edicts.free[e]) continue;
      if ((edicts.getFloat(e, f.solid) | 0) !== SOLID_BSP) continue;
      const model = progs.stringAt(edicts.getInt(e, f.model));
      if (!model || model[0] !== '*') continue;
      const sub = parseInt(model.slice(1), 10);
      if (!sub || sub >= this.bsp.submodels.length) continue;
      const o = edicts.getVec(e, f.origin);
      out.push({
        submodel: sub,
        origin: new Float32Array([o[0], o[1], o[2]]),
        edict: e,
      });
    }
    return out;
  }

  /**
   * SV_Impact — run touch functions when two entities collide.
   * @param {number} e1
   * @param {number} e2
   */
  impact(e1, e2) {
    const edicts = this.edicts;
    const f = this.progs.f;
    const ofs = this.progs.ofs;
    if (edicts.free[e1] || edicts.free[e2]) return;

    const touch1 = edicts.getInt(e1, f.touch);
    const solid1 = edicts.getFloat(e1, f.solid) | 0;
    if (touch1 && solid1 !== SOLID_NOT) {
      this.progs.globalsI[ofs.self] = e1;
      this.progs.globalsI[ofs.other] = e2;
      this.progs.globalsF[ofs.time] = this.time;
      try {
        this.exec.execute(touch1);
      } catch (err) {
        console.error(`impact touch ${e1}`, err);
      }
    }

    const touch2 = edicts.getInt(e2, f.touch);
    const solid2 = edicts.getFloat(e2, f.solid) | 0;
    if (touch2 && solid2 !== SOLID_NOT) {
      this.progs.globalsI[ofs.self] = e2;
      this.progs.globalsI[ofs.other] = e1;
      this.progs.globalsF[ofs.time] = this.time;
      try {
        this.exec.execute(touch2);
      } catch (err) {
        console.error(`impact touch ${e2}`, err);
      }
    }
  }

  /**
   * @param {number} playerEnt
   * @param {Iterable<number>|number[]} hitEnts brush edicts bumped this frame
   */
  impactTouches(playerEnt, hitEnts) {
    const seen = new Set();
    for (const e of hitEnts) {
      if (!e || e === playerEnt || seen.has(e)) continue;
      seen.add(e);
      this.impact(playerEnt, e);
    }
  }

  /**
   * Point trace (hull 0) against world + SOLID_BSP brushes — for attacks.
   * @param {Float32Array|number[]} start
   * @param {Float32Array|number[]} end
   * @returns {import('./World.js').Trace}
   */
  traceLine(start, end) {
    const hull = this.bsp.hulls[0];
    const w = this.world;
    const zero = new Float32Array(3);
    let trace = w._clipToHull(hull, 0, 0, 0, start, end, zero, zero);
    trace.ent = 0;

    for (const be of w.brushes) {
      const sm = this.bsp.submodels[be.submodel];
      if (!sm) continue;
      const brushHull = {
        clipnodes: hull.clipnodes,
        planes: hull.planes,
        firstclipnode: sm.headnode[0],
        lastclipnode: hull.lastclipnode,
        clipMins: hull.clipMins,
        clipMaxs: hull.clipMaxs,
      };
      const tr = w._clipToHull(
        brushHull,
        be.origin[0],
        be.origin[1],
        be.origin[2],
        start,
        end,
        zero,
        zero,
      );
      if (tr.allsolid || tr.fraction < trace.fraction) {
        tr.ent = be.edict || 0;
        trace = tr;
      }
    }
    return trace;
  }

  /**
   * Shootable brushes (secret doors, health buttons): call th_pain / th_die.
   * @param {number} attackerEnt
   * @param {Float32Array|number[]} eye
   * @param {number} pitch deg
   * @param {number} yaw deg
   * @param {number} [damage=20]
   */
  fireHitscan(attackerEnt, eye, pitch, yaw, damage = 20) {
    const { forward } = angleVectors([pitch, yaw, 0]);
    const end = new Float32Array([
      eye[0] + forward[0] * 2048,
      eye[1] + forward[1] * 2048,
      eye[2] + forward[2] * 2048,
    ]);
    const tr = this.traceLine(eye, end);
    if (!tr.ent || tr.fraction >= 1) return;

    const edicts = this.edicts;
    const progs = this.progs;
    const ofs = progs.ofs;
    const takedamageOfs = progs.fieldByName.get('takedamage')?.ofs;
    const thPainOfs = progs.fieldByName.get('th_pain')?.ofs;
    const thDieOfs = progs.fieldByName.get('th_die')?.ofs;

    if (takedamageOfs == null || !(edicts.getFloat(tr.ent, takedamageOfs) > 0)) {
      return;
    }

    let health = edicts.getFloat(tr.ent, progs.f.health);
    health -= damage;
    edicts.setFloat(tr.ent, progs.f.health, health);

    progs.globalsI[ofs.self] = tr.ent;
    progs.globalsI[ofs.other] = attackerEnt;
    progs.globalsF[ofs.time] = this.time;

    if (health <= 0 && thDieOfs != null) {
      const die = edicts.getInt(tr.ent, thDieOfs);
      if (die) {
        try {
          this.exec.execute(die);
        } catch (err) {
          console.error(`th_die ${tr.ent}`, err);
        }
        return;
      }
    }

    // Secret doors open via th_pain (fd_secret_use) on any hit
    if (thPainOfs != null) {
      const pain = edicts.getInt(tr.ent, thPainOfs);
      if (pain) {
        progs.globalsI[OFS_PARM0] = attackerEnt;
        progs.globalsF[OFS_PARM0 + 1] = damage;
        try {
          this.exec.execute(pain);
        } catch (err) {
          console.error(`th_pain ${tr.ent}`, err);
        }
      }
    }
  }

  /**
   * SV_TouchLinks subset — SOLID_TRIGGER only (not SOLID_BSP buttons; those use SV_Impact).
   * @param {Float32Array|number[]} origin player origin
   * @param {Float32Array|number[]} mins
   * @param {Float32Array|number[]} maxs
   * @param {number} playerEnt
   */
  touchTriggers(origin, mins, maxs, playerEnt) {
    const edicts = this.edicts;
    const f = this.progs.f;
    const ofs = this.progs.ofs;
    const amin = [
      origin[0] + mins[0],
      origin[1] + mins[1],
      origin[2] + mins[2],
    ];
    const amax = [
      origin[0] + maxs[0],
      origin[1] + maxs[1],
      origin[2] + maxs[2],
    ];

    for (let e = 1; e < edicts.numEdicts; e++) {
      if (edicts.free[e]) continue;
      if ((edicts.getFloat(e, f.solid) | 0) !== SOLID_TRIGGER) continue;
      const touch = edicts.getInt(e, f.touch);
      if (!touch) continue;
      const bmin = edicts.getVec(e, f.absmin);
      const bmax = edicts.getVec(e, f.absmax);
      if (
        amin[0] > bmax[0] ||
        amin[1] > bmax[1] ||
        amin[2] > bmax[2] ||
        amax[0] < bmin[0] ||
        amax[1] < bmin[1] ||
        amax[2] < bmin[2]
      ) {
        continue;
      }
      this.progs.globalsI[ofs.self] = e;
      this.progs.globalsI[ofs.other] = playerEnt;
      this.progs.globalsF[ofs.time] = this.time;
      try {
        this.exec.execute(touch);
      } catch (err) {
        console.error(`touch ${e}`, err);
      }
    }
  }
}
