/**
 * CL_ParseServerMessage subset (cl_parse.c).
 */

import { SizeBuf } from '../net/SizeBuf.js';
import {
  svc,
  TE,
  U,
  SU,
  DEFAULT_VIEWHEIGHT,
} from '../protocol/Protocol.js';

/**
 * @typedef {{
 *   print?: (text: string) => void,
 *   stufftext?: (text: string) => void,
 *   centerprint?: (text: string) => void,
 *   lightstyle?: (index: number, map: string) => void,
 *   tempEntity?: (te: number, pos: Float32Array, extra?: object) => void,
 *   time?: (t: number) => void,
 *   cdtrack?: (track: number, loopTrack: number) => void,
 *   setangle?: (pitch: number, yaw: number, roll: number) => void,
 *   world?: import('./ClientWorld.js').ClientWorld,
 * }} ClientParseHooks
 */

/**
 * @param {SizeBuf} msg
 * @param {ClientParseHooks} hooks
 */
export function parseServerMessage(msg, hooks) {
  const world = hooks.world;
  while (msg.remaining > 0) {
    const cmd = msg.readByte();
    if (cmd === -1) break;

    // Fast entity update (U_SIGNAL)
    if (cmd & U.SIGNAL) {
      parseEntityUpdate(msg, cmd & 127, world);
      continue;
    }

    switch (cmd) {
      case svc.nop:
        break;
      case svc.disconnect:
        hooks.print?.('Server disconnected\n');
        return;
      case svc.print: {
        const s = msg.readString();
        hooks.print?.(s.endsWith('\n') ? s : `${s}\n`);
        break;
      }
      case svc.stufftext: {
        const s = msg.readString();
        hooks.stufftext?.(s);
        break;
      }
      case svc.centerprint: {
        hooks.centerprint?.(msg.readString());
        break;
      }
      case svc.time:
        hooks.time?.(msg.readFloat());
        break;
      case svc.lightstyle: {
        const i = msg.readByte();
        const map = msg.readString();
        hooks.lightstyle?.(i, map);
        break;
      }
      case svc.temp_entity:
        parseTempEntity(msg, hooks);
        break;
      case svc.particle: {
        const pos = new Float32Array([
          msg.readCoord(),
          msg.readCoord(),
          msg.readCoord(),
        ]);
        const dir = new Float32Array([
          msg.readChar() * (1 / 16),
          msg.readChar() * (1 / 16),
          msg.readChar() * (1 / 16),
        ]);
        const color = msg.readByte();
        const count = msg.readByte();
        hooks.tempEntity?.(TE.gunshot, pos, { dir, color, count, particle: true });
        break;
      }
      case svc.setangle: {
        const pitch = msg.readAngle();
        const yaw = msg.readAngle();
        const roll = msg.readAngle();
        hooks.setangle?.(pitch, yaw, roll);
        break;
      }
      case svc.clientdata: {
        const bits = msg.readShort();
        parseClientdata(msg, bits, world);
        break;
      }
      case svc.spawnbaseline: {
        const num = msg.readShort();
        parseBaseline(msg, world?.ensureEntity(num));
        break;
      }
      case svc.signonnum:
        msg.readByte();
        break;
      case svc.intermission:
      case svc.finale:
      case svc.cutscene:
        if (cmd === svc.finale || cmd === svc.cutscene) msg.readString();
        break;
      case svc.cdtrack: {
        const track = msg.readByte();
        const loopTrack = msg.readByte();
        hooks.cdtrack?.(track, loopTrack);
        break;
      }
      case svc.damage: {
        msg.readByte(); // armor
        msg.readByte(); // blood
        msg.readCoord();
        msg.readCoord();
        msg.readCoord();
        break;
      }
      default:
        hooks.print?.(`CL_Parse: unknown svc ${cmd}\n`);
        return;
    }
  }
}

/**
 * @param {SizeBuf} msg
 * @param {import('./ClientWorld.js').emptyClientEntity extends Function ? any : any} [ent]
 */
function parseBaseline(msg, ent) {
  if (!ent) {
    msg.readByte();
    msg.readByte();
    msg.readByte();
    msg.readByte();
    for (let i = 0; i < 3; i++) {
      msg.readCoord();
      msg.readAngle();
    }
    return;
  }
  const b = ent.baseline;
  b.modelindex = msg.readByte();
  b.frame = msg.readByte();
  b.colormap = msg.readByte();
  b.skin = msg.readByte();
  for (let i = 0; i < 3; i++) {
    b.origin[i] = msg.readCoord();
    b.angles[i] = msg.readAngle();
  }
  ent.modelindex = b.modelindex;
  ent.frame = b.frame;
  ent.colormap = b.colormap;
  ent.skin = b.skin;
  ent.effects = b.effects;
  ent.origin[0] = b.origin[0];
  ent.origin[1] = b.origin[1];
  ent.origin[2] = b.origin[2];
  ent.angles[0] = b.angles[0];
  ent.angles[1] = b.angles[1];
  ent.angles[2] = b.angles[2];
}

/**
 * @param {SizeBuf} msg
 * @param {number} bits
 * @param {import('./ClientWorld.js').ClientWorld|undefined} world
 */
function parseClientdata(msg, bits, world) {
  if (!world) {
    // Still consume bytes
    skipClientdata(msg, bits);
    return;
  }
  if (bits & SU.VIEWHEIGHT) world.viewheight = msg.readChar();
  else world.viewheight = DEFAULT_VIEWHEIGHT;

  if (bits & SU.IDEALPITCH) world.idealpitch = msg.readChar();
  else world.idealpitch = 0;

  for (let i = 0; i < 3; i++) {
    if (bits & (SU.PUNCH1 << i)) world.punchangle[i] = msg.readChar();
    else world.punchangle[i] = 0;
    if (bits & (SU.VELOCITY1 << i)) msg.readChar(); // mvelocity
    else {
      /* zero */
    }
  }

  world.items = msg.readLong();
  world.onground = !!(bits & SU.ONGROUND);
  world.inwater = !!(bits & SU.INWATER);

  world.stats.weaponframe = bits & SU.WEAPONFRAME ? msg.readByte() : 0;
  world.stats.armor = bits & SU.ARMOR ? msg.readByte() : 0;
  if (bits & SU.WEAPON) msg.readByte(); // weapon modelindex
  world.stats.health = msg.readShort();
  world.stats.ammo = msg.readByte();
  world.stats.shells = msg.readByte();
  world.stats.nails = msg.readByte();
  world.stats.rockets = msg.readByte();
  world.stats.cells = msg.readByte();
  world.stats.weapon = msg.readByte();
}

/**
 * @param {SizeBuf} msg
 * @param {number} bits
 */
function skipClientdata(msg, bits) {
  if (bits & SU.VIEWHEIGHT) msg.readChar();
  if (bits & SU.IDEALPITCH) msg.readChar();
  for (let i = 0; i < 3; i++) {
    if (bits & (SU.PUNCH1 << i)) msg.readChar();
    if (bits & (SU.VELOCITY1 << i)) msg.readChar();
  }
  msg.readLong();
  if (bits & SU.WEAPONFRAME) msg.readByte();
  if (bits & SU.ARMOR) msg.readByte();
  if (bits & SU.WEAPON) msg.readByte();
  msg.readShort();
  msg.readByte();
  msg.readByte();
  msg.readByte();
  msg.readByte();
  msg.readByte();
  msg.readByte();
}

/**
 * @param {SizeBuf} msg
 * @param {number} bits
 * @param {import('./ClientWorld.js').ClientWorld|undefined} world
 */
function parseEntityUpdate(msg, bits, world) {
  if (bits & U.MOREBITS) bits |= msg.readByte() << 8;
  const num = bits & U.LONGENTITY ? msg.readShort() : msg.readByte();
  const ent = world?.ensureEntity(num);
  if (!ent) {
    skipEntityUpdate(msg, bits);
    return;
  }
  const b = ent.baseline;
  ent.modelindex = bits & U.MODEL ? msg.readByte() : b.modelindex;
  ent.frame = bits & U.FRAME ? msg.readByte() : b.frame;
  ent.colormap = bits & U.COLORMAP ? msg.readByte() : b.colormap;
  ent.skin = bits & U.SKIN ? msg.readByte() : b.skin;
  ent.effects = bits & U.EFFECTS ? msg.readByte() : b.effects;
  ent.origin[0] = bits & U.ORIGIN1 ? msg.readCoord() : b.origin[0];
  ent.angles[0] = bits & U.ANGLE1 ? msg.readAngle() : b.angles[0];
  ent.origin[1] = bits & U.ORIGIN2 ? msg.readCoord() : b.origin[1];
  ent.angles[1] = bits & U.ANGLE2 ? msg.readAngle() : b.angles[1];
  ent.origin[2] = bits & U.ORIGIN3 ? msg.readCoord() : b.origin[2];
  ent.angles[2] = bits & U.ANGLE3 ? msg.readAngle() : b.angles[2];
}

/**
 * @param {SizeBuf} msg
 * @param {number} bits
 */
function skipEntityUpdate(msg, bits) {
  if (bits & U.MODEL) msg.readByte();
  if (bits & U.FRAME) msg.readByte();
  if (bits & U.COLORMAP) msg.readByte();
  if (bits & U.SKIN) msg.readByte();
  if (bits & U.EFFECTS) msg.readByte();
  if (bits & U.ORIGIN1) msg.readCoord();
  if (bits & U.ANGLE1) msg.readAngle();
  if (bits & U.ORIGIN2) msg.readCoord();
  if (bits & U.ANGLE2) msg.readAngle();
  if (bits & U.ORIGIN3) msg.readCoord();
  if (bits & U.ANGLE3) msg.readAngle();
}

/**
 * @param {SizeBuf} msg
 * @param {ClientParseHooks} hooks
 */
function parseTempEntity(msg, hooks) {
  const te = msg.readByte();
  if (
    te === TE.gunshot ||
    te === TE.spike ||
    te === TE.superspike ||
    te === TE.explosion ||
    te === TE.tarexplosion ||
    te === TE.teleport ||
    te === TE.wizspike ||
    te === TE.knightspike ||
    te === TE.lavasplash
  ) {
    const pos = new Float32Array([
      msg.readCoord(),
      msg.readCoord(),
      msg.readCoord(),
    ]);
    hooks.tempEntity?.(te, pos);
    return;
  }
  if (te === TE.explosion2) {
    const pos = new Float32Array([
      msg.readCoord(),
      msg.readCoord(),
      msg.readCoord(),
    ]);
    msg.readByte();
    msg.readByte();
    hooks.tempEntity?.(te, pos);
    return;
  }
  if (
    te === TE.lightning1 ||
    te === TE.lightning2 ||
    te === TE.lightning3 ||
    te === TE.beam
  ) {
    msg.readShort();
    msg.readCoord();
    msg.readCoord();
    msg.readCoord();
    msg.readCoord();
    msg.readCoord();
    msg.readCoord();
    return;
  }
  hooks.print?.(`CL_ParseTEnt: bad type ${te}\n`);
}
