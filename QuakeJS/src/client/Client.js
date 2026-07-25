/**
 * Client main (cl_main.c subset) — loopback connect + message read.
 */

import { SizeBuf } from '../net/SizeBuf.js';
import { parseServerMessage } from './ClientParse.js';

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
    this._msg = new SizeBuf(8192);
    this._out = new SizeBuf(8192);
  }

  /**
   * Connect to local server via loopback.
   */
  connectLocal() {
    this.socket = this.net.connectLocal();
    this.state = ca.connected;
    this.hooks.print?.('Connected to loopback\n');
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
        time: (t) => {
          this.mtime = t;
          this.hooks.time?.(t);
        },
      });
    }
  }

  /**
   * Send a clc_stringcmd (console command to server).
   * @param {string} text
   */
  sendStringCmd(text) {
    if (!this.socket || this.state !== ca.connected) return;
    this._out.clear();
    this._out.writeByte(4); // clc_stringcmd
    this._out.writeString(text.endsWith('\n') ? text : `${text}\n`);
    this.net.sendUnreliable(this.socket, this._out);
  }
}
