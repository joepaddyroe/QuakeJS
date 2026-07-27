/**
 * Loopback net driver (net_loop.c subset).
 * Client and server sockets exchange SizeBuf messages in-process.
 */

import { SizeBuf } from './SizeBuf.js';
import { MAX_MSGLEN } from '../protocol/Protocol.js';

/**
 * @typedef {{
 *   address: string,
 *   receive: SizeBuf[],
 *   peer: LoopSocket|null,
 *   canSend: boolean,
 * }} LoopSocket
 */

export class NetLoop {
  constructor() {
    /** @type {LoopSocket|null} */
    this.client = null;
    /** @type {LoopSocket|null} */
    this.server = null;
    this._pendingConnect = false;
  }

  /**
   * Loop_Connect("local")
   * @returns {LoopSocket}
   */
  connectLocal() {
    this._pendingConnect = true;
    if (!this.client) {
      this.client = {
        address: 'localhost',
        receive: [],
        peer: null,
        canSend: true,
      };
    }
    if (!this.server) {
      this.server = {
        address: 'LOCAL',
        receive: [],
        peer: null,
        canSend: true,
      };
    }
    this.client.peer = this.server;
    this.server.peer = this.client;
    this.client.receive.length = 0;
    this.server.receive.length = 0;
    this.client.canSend = true;
    this.server.canSend = true;
    return this.client;
  }

  /**
   * Loop_CheckNewConnections — accept pending local client.
   * @returns {LoopSocket|null}
   */
  checkNewConnections() {
    if (!this._pendingConnect || !this.server) return null;
    this._pendingConnect = false;
    this.server.receive.length = 0;
    this.client.receive.length = 0;
    this.server.canSend = true;
    this.client.canSend = true;
    return this.server;
  }

  /**
   * Loop_SendUnreliableMessage — queue on peer receive.
   * @param {LoopSocket} sock
   * @param {SizeBuf} data
   * @returns {boolean}
   */
  sendUnreliable(sock, data) {
    if (!sock?.peer || data.cursize <= 0) return false;
    if (data.cursize > MAX_MSGLEN) return false;
    const copy = new Uint8Array(data.cursize);
    copy.set(data.bytes());
    const msg = new SizeBuf(Math.max(256, copy.length));
    msg.beginRead(copy);
    sock.peer.receive.push(msg);
    return true;
  }

  /**
   * Reliable send (same as unreliable for loopback SP).
   * @param {LoopSocket} sock
   * @param {SizeBuf} data
   * @returns {boolean}
   */
  sendReliable(sock, data) {
    return this.sendUnreliable(sock, data);
  }

  /**
   * Loop_GetMessage — pop next message into out buf.
   * @param {LoopSocket} sock
   * @param {SizeBuf} out
   * @returns {number} 0=none, 1=message
   */
  getMessage(sock, out) {
    if (!sock || sock.receive.length === 0) return 0;
    const msg = sock.receive.shift();
    out.beginRead(msg.bytes());
    out.readcount = 0;
    return 1;
  }

  disconnect() {
    if (this.client) this.client.receive.length = 0;
    if (this.server) this.server.receive.length = 0;
    this._pendingConnect = false;
  }
}
