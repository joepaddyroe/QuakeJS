/**
 * Client main (cl_main.c subset) — loopback connect + message read.
 */

import { SizeBuf } from '../net/SizeBuf.js';
import { clc } from '../protocol/Protocol.js';
import { parseServerMessage } from './ClientParse.js';
import { ClientWorld } from './ClientWorld.js';

export const ca = {
  dedicated: 0,
  disconnected: 1,
  connected: 2,
};

export class Client {
  /**
   * @param {object} deps
   * @param {import('../net/NetLoop.js').NetLoop} deps.net
   * @param {import('./ClientParse.js').ClientParseHooks} [deps.hooks]
   */
  constructor({ net, hooks = {} }) {
    this.net = net;
    this.hooks = hooks;
    this.state = ca.disconnected;
    /** @type {import('../net/NetLoop.js').LoopSocket|null} */
    this.socket = null;
    this.mtime = 0;
    /** Client simulation clock (cl.time) — advances with host frametime */
    this.time = 0;
    this._msg = new SizeBuf(8192);
    this._out = new SizeBuf(8192);
    /** Drop first two moves like CL_SendMove */
    this.movemessages = 0;
    /** Last viewangles sent (pitch, yaw, roll) */
    this.viewangles = new Float32Array(3);
    this.world = new ClientWorld();
    /** Model precache from svc_serverinfo (demo / remote); index 0 unused */
    /** @type {string[]} */
    this.modelPrecache = [''];
    this.signon = 0;
  }

  /**
   * Connect to local server via loopback.
   */
  connectLocal() {
    this.socket = this.net.connectLocal();
    this.state = ca.connected;
    this.movemessages = 0;
    this.world.clear();
    this.hooks.print?.('Connected to loopback\n');
  }

  /**
   * Connect over a remote net driver (WebSocket).
   * @param {{ socket: object, sendUnreliable: Function, getMessage: Function, disconnect: Function }} net
   */
  connectRemote(net) {
    this.net = net;
    this.socket = net.socket;
    this.state = ca.connected;
    this.movemessages = 0;
    this.world.clear();
    this.hooks.print?.('Connected to remote\n');
  }

  disconnect() {
    this.state = ca.disconnected;
    this.socket = null;
    this.net.disconnect();
  }

  /**
   * Read and parse all pending server messages.
   */
  readPackets() {
    if (this.state !== ca.connected || !this.socket) return;
    while (this.net.getMessage(this.socket, this._msg)) {
      parseServerMessage(this._msg, {
        ...this.hooks,
        world: this.world,
        time: (t) => {
          this.world.pushTime(t);
          this.mtime = t;
          this.hooks.time?.(t);
        },
      });
    }
  }

  /**
   * CL_SendMove — clc_move over loopback.
   * @param {{
   *   forwardmove?: number,
   *   sidemove?: number,
   *   upmove?: number,
   *   buttons?: number,
   *   impulse?: number,
   *   angles?: Float32Array|number[],
   * }} cmd
   */
  sendMove(cmd) {
    if (!this.socket || this.state !== ca.connected) return;
    const angles = cmd.angles || this.viewangles;
    this.viewangles[0] = angles[0] || 0;
    this.viewangles[1] = angles[1] || 0;
    this.viewangles[2] = angles[2] || 0;

    this._out.clear();
    this._out.writeByte(clc.move);
    this._out.writeFloat(this.mtime);
    this._out.writeAngle(this.viewangles[0]);
    this._out.writeAngle(this.viewangles[1]);
    this._out.writeAngle(this.viewangles[2]);
    this._out.writeShort(cmd.forwardmove | 0);
    this._out.writeShort(cmd.sidemove | 0);
    this._out.writeShort(cmd.upmove | 0);
    this._out.writeByte(cmd.buttons | 0);
    this._out.writeByte(cmd.impulse | 0);

    this.movemessages += 1;
    if (this.movemessages <= 2) return;
    this.net.sendUnreliable(this.socket, this._out);
  }

  /**
   * Send a clc_stringcmd (console command to server).
   * @param {string} text
   */
  sendStringCmd(text) {
    if (!this.socket || this.state !== ca.connected) return;
    this._out.clear();
    this._out.writeByte(clc.stringcmd);
    this._out.writeString(text.endsWith('\n') ? text : `${text}\n`);
    this.net.sendUnreliable(this.socket, this._out);
  }
}
