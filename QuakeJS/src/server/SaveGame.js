/**
 * Host_Savegame / Host_Loadgame — Quake text .sav format (version 5).
 */

import { MAX_LIGHTSTYLES } from '../render/LightStyles.js';
import {
  writeEdict,
  writeGlobals,
  nextBraceBlock,
  parseEpairs,
  applyEdictPairs,
  applyGlobalPairs,
} from '../progs/EdSerialize.js';
import { ensureExt, readConfig, writeConfig } from '../app/ConfigIO.js';

export const SAVEGAME_VERSION = 5;
export const NUM_SPAWN_PARMS = 16;
export const SAVEGAME_COMMENT_LENGTH = 39;

/**
 * @param {import('../server/Server.js').Server} server
 * @param {string} [comment]
 * @returns {string}
 */
export function buildSaveText(server, comment = '') {
  const progs = server.progs;
  const edicts = server.edicts;
  let out = `${SAVEGAME_VERSION}\n`;
  let c = (comment || server.mapName || 'QuakeJS').replace(/ /g, '_');
  if (c.length > SAVEGAME_COMMENT_LENGTH) c = c.slice(0, SAVEGAME_COMMENT_LENGTH);
  while (c.length < SAVEGAME_COMMENT_LENGTH) c += '_';
  out += `${c}\n`;
  for (let i = 0; i < NUM_SPAWN_PARMS; i++) {
    out += `${server.spawnParms[i] || 0}\n`;
  }
  out += `${server.skill | 0}\n`;
  out += `${server.mapName}\n`;
  out += `${server.time}\n`;
  for (let i = 0; i < MAX_LIGHTSTYLES; i++) {
    const ls = server.lightStyles.styles[i];
    out += `${ls?.map || 'm'}\n`;
  }
  out += writeGlobals(progs);
  for (let e = 0; e < edicts.numEdicts; e++) {
    out += writeEdict(progs, edicts, e);
  }
  return out;
}

/**
 * @param {string} name
 * @param {import('../server/Server.js').Server} server
 * @returns {boolean}
 */
export function saveGame(name, server) {
  const file = ensureExt(name, '.sav');
  const text = buildSaveText(server);
  return writeConfig(file, text);
}

/**
 * @typedef {{
 *   version: number,
 *   comment: string,
 *   spawnParms: number[],
 *   skill: number,
 *   mapName: string,
 *   time: number,
 *   lightstyles: string[],
 *   globalsBlock: string,
 *   edictBlocks: string[],
 * }} SaveHeader
 */

/**
 * @param {string} text
 * @returns {SaveHeader}
 */
export function parseSaveText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let li = 0;
  const version = parseInt(lines[li++], 10);
  const comment = lines[li++] || '';
  /** @type {number[]} */
  const spawnParms = [];
  for (let i = 0; i < NUM_SPAWN_PARMS; i++) {
    spawnParms.push(parseFloat(lines[li++]) || 0);
  }
  const skill = (parseFloat(lines[li++]) + 0.1) | 0;
  const mapName = (lines[li++] || '').trim();
  const time = parseFloat(lines[li++]) || 0;
  /** @type {string[]} */
  const lightstyles = [];
  for (let i = 0; i < MAX_LIGHTSTYLES; i++) {
    lightstyles.push(lines[li++] || 'm');
  }
  // Remainder is brace blocks
  const rest = lines.slice(li).join('\n');
  let pos = 0;
  const first = nextBraceBlock(rest, pos);
  if (!first) throw new Error('Savegame missing globals block');
  const globalsBlock = first.block;
  pos = first.next;
  /** @type {string[]} */
  const edictBlocks = [];
  while (true) {
    const b = nextBraceBlock(rest, pos);
    if (!b) break;
    edictBlocks.push(b.block);
    pos = b.next;
  }
  return {
    version,
    comment,
    spawnParms,
    skill,
    mapName,
    time,
    lightstyles,
    globalsBlock,
    edictBlocks,
  };
}

/**
 * @param {string} name
 * @returns {SaveHeader}
 */
export function loadSaveHeader(name) {
  const file = ensureExt(name, '.sav');
  const text = readConfig(file);
  if (!text) throw new Error(`couldn't open ${file}`);
  const header = parseSaveText(text);
  if (header.version !== SAVEGAME_VERSION) {
    throw new Error(
      `Savegame is version ${header.version}, not ${SAVEGAME_VERSION}`,
    );
  }
  return header;
}

/**
 * Apply globals + edicts + lightstyles + time onto an already-spawned server.
 * @param {import('../server/Server.js').Server} server
 * @param {SaveHeader} header
 */
export function applySaveToServer(server, header) {
  const progs = server.progs;
  const edicts = server.edicts;

  for (let i = 0; i < MAX_LIGHTSTYLES; i++) {
    server.lightStyles.set(i, header.lightstyles[i] || 'm');
  }

  applyGlobalPairs(progs, parseEpairs(header.globalsBlock));

  // Clear all edicts then restore from save
  for (let e = 0; e < edicts.numEdicts; e++) {
    edicts.free[e] = true;
    const base = e * edicts.entityfields;
    edicts.fields.fill(0, base, base + edicts.entityfields);
  }

  let num = header.edictBlocks.length;
  if (num > edicts.fields.length / edicts.entityfields) {
    num = (edicts.fields.length / edicts.entityfields) | 0;
  }
  edicts.numEdicts = Math.max(num, 1);

  for (let e = 0; e < num; e++) {
    const block = header.edictBlocks[e];
    const pairs = parseEpairs(block);
    if (pairs.length === 0) {
      edicts.free[e] = true;
      continue;
    }
    edicts.free[e] = false;
    applyEdictPairs(progs, edicts, e, pairs);
    edicts.linkAbs(e);
  }

  // Keep world reserved; client slot follows save data
  edicts.free[0] = false;

  server.time = header.time;
  edicts.time = header.time;
  progs.globalsF[progs.ofs.time] = header.time;
  server.spawnParms = header.spawnParms.slice();
  server.skill = header.skill;
  server.loadgame = true;
  server.paused = false;
  // putClientInServer runs on reconnect with loadgame=true
  server._clientSpawned = false;
  server._clientLoadoutReady = false;
}
