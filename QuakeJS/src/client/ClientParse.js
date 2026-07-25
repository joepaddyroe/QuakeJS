/**
 * CL_ParseServerMessage subset (cl_parse.c).
 */

import { SizeBuf } from '../net/SizeBuf.js';
import { svc, TE } from '../protocol/Protocol.js';

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
 * }} ClientParseHooks
 */

/**
 * @param {SizeBuf} msg
 * @param {ClientParseHooks} hooks
 */
export function parseServerMessage(msg, hooks) {
  while (msg.remaining > 0) {
    const cmd = msg.readByte();
    if (cmd === -1) break;

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
        // org + dir + color + count
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
      case svc.signonnum:
        msg.readByte();
        break;
      case svc.intermission:
      case svc.finale:
      case svc.cutscene:
        // skip string if present for finale
        if (cmd === svc.finale || cmd === svc.cutscene) msg.readString();
        break;
      case svc.cdtrack: {
        const track = msg.readByte();
        const loopTrack = msg.readByte();
        hooks.cdtrack?.(track, loopTrack);
        break;
      }
      default:
        // Unknown — stop to avoid desync
        hooks.print?.(`CL_Parse: unknown svc ${cmd}\n`);
        return;
    }
  }
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
  if (te === TE.lightning1 || te === TE.lightning2 || te === TE.lightning3 || te === TE.beam) {
    msg.readShort(); // entity
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
