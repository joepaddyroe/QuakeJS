/**
 * protocol.h — NetQuake message types (subset).
 */

export const PROTOCOL_VERSION = 15;

export const MAX_MSGLEN = 8000; // NET_MAXMESSAGE-ish

// server → client
export const svc = {
  bad: 0,
  nop: 1,
  disconnect: 2,
  updatestat: 3,
  version: 4,
  setview: 5,
  sound: 6,
  time: 7,
  print: 8,
  stufftext: 9,
  setangle: 10,
  serverinfo: 11,
  lightstyle: 12,
  updatename: 13,
  updatefrags: 14,
  clientdata: 15,
  stopsound: 16,
  updatecolors: 17,
  particle: 18,
  damage: 19,
  spawnstatic: 20,
  spawnbaseline: 22,
  temp_entity: 23,
  setpause: 24,
  signonnum: 25,
  centerprint: 26,
  killedmonster: 27,
  foundsecret: 28,
  spawnstaticsound: 29,
  intermission: 30,
  finale: 31,
  cdtrack: 32,
  sellscreen: 33,
  cutscene: 34,
};

// client → server
export const clc = {
  bad: 0,
  nop: 1,
  disconnect: 2,
  move: 3,
  stringcmd: 4,
};

export const TE = {
  spike: 0,
  superspike: 1,
  gunshot: 2,
  explosion: 3,
  tarexplosion: 4,
  lightning1: 5,
  lightning2: 6,
  wizspike: 7,
  knightspike: 8,
  lightning3: 9,
  lavasplash: 10,
  teleport: 11,
  explosion2: 12,
  beam: 13,
};

/** MSG_* WriteDest */
export const MSG = {
  BROADCAST: 0,
  ONE: 1,
  ALL: 2,
  INIT: 3,
};

/** Fast entity update bits (protocol.h) — high bit of cmd is U_SIGNAL */
export const U = {
  MOREBITS: 1 << 0,
  ORIGIN1: 1 << 1,
  ORIGIN2: 1 << 2,
  ORIGIN3: 1 << 3,
  ANGLE2: 1 << 4,
  NOLERP: 1 << 5,
  FRAME: 1 << 6,
  SIGNAL: 1 << 7,
  ANGLE1: 1 << 8,
  ANGLE3: 1 << 9,
  MODEL: 1 << 10,
  COLORMAP: 1 << 11,
  SKIN: 1 << 12,
  EFFECTS: 1 << 13,
  LONGENTITY: 1 << 14,
};

/** svc_clientdata bits */
export const SU = {
  VIEWHEIGHT: 1 << 0,
  IDEALPITCH: 1 << 1,
  PUNCH1: 1 << 2,
  PUNCH2: 1 << 3,
  PUNCH3: 1 << 4,
  VELOCITY1: 1 << 5,
  VELOCITY2: 1 << 6,
  VELOCITY3: 1 << 7,
  ITEMS: 1 << 9,
  ONGROUND: 1 << 10,
  INWATER: 1 << 11,
  WEAPONFRAME: 1 << 12,
  ARMOR: 1 << 13,
  WEAPON: 1 << 14,
};

export const DEFAULT_VIEWHEIGHT = 22;
