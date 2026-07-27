/**
 * WebSocket net transport (opt-in MP) — binary frames of SizeBuf payloads.
 * Pair with scripts/ws-relay.mjs (role: server | client).
 */

import { SizeBuf } from './SizeBuf.js';
import { MAX_MSGLEN } from '../protocol/Protocol.js';

/**
 * @typedef {{
 *   address: string,
 *   receive: SizeBuf[],
 *   peer: null,
 *   canSend: boolean,
 *   remote: true,
 * }} WsSocket
 */

export class WebSocketNet {
  /**
   * @param {WebSocket} ws
   * @param {'server'|'client'} role
   */
  constructor(ws, role) {
    this.ws = ws;
    this.role = role;
    /** @type {WsSocket} */
    this.socket = {
      address: ws.url || 'ws',
      receive: [],
      peer: null,
      canSend: false,
      remote: true,
    };
    /** @type {(() => void)[]} */
    this._onOpen = [];
    /** @type {((msg: string) => void)[]} */
    this._onError = [];
    this._opened = ws.readyState === WebSocket.OPEN;

    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      this._opened = true;
      this.socket.canSend = true;
      // Announce role to relay
      ws.send(JSON.stringify({ type: 'hello', role }));
      for (const fn of this._onOpen) fn();
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'peer' && msg.event === 'join') {
            this._pendingPeers += 1;
          }
        } catch {
          /* ignore */
        }
        return;
      }
      const buf = new Uint8Array(ev.data);
      if (buf.length > MAX_MSGLEN) return;
      const msg = new SizeBuf(Math.max(256, buf.length));
      msg.beginRead(buf);
      this.socket.receive.push(msg);
    });
    ws.addEventListener('close', () => {
      this.socket.canSend = false;
      this._opened = false;
    });
    ws.addEventListener('error', () => {
      for (const fn of this._onError) fn('WebSocket error');
    });
    this._pendingPeers = 0;
  }

  /**
   * @param {string} url
   * @param {'server'|'client'} role
   * @returns {Promise<WebSocketNet>}
   */
  static connect(url, role) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      const net = new WebSocketNet(ws, role);
      const t = setTimeout(() => {
        reject(new Error('WebSocket connect timeout'));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 8000);
      net._onOpen.push(() => {
        clearTimeout(t);
        resolve(net);
      });
      net._onError.push((m) => {
        clearTimeout(t);
        reject(new Error(m));
      });
      ws.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('WebSocket failed'));
      });
    });
  }

  /**
   * Relay accepted a peer (server role).
   * @returns {WsSocket|null}
   */
  checkNewConnections() {
    if (this.role !== 'server' || this._pendingPeers <= 0) return null;
    this._pendingPeers -= 1;
    return this.socket;
  }

  /**
   * @param {WsSocket} sock
   * @param {SizeBuf} data
   * @returns {boolean}
   */
  sendUnreliable(sock, data) {
    if (!sock?.canSend || !this._opened || data.cursize <= 0) return false;
    if (data.cursize > MAX_MSGLEN) return false;
    try {
      this.ws.send(data.bytes());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {WsSocket} sock
   * @param {SizeBuf} data
   * @returns {boolean}
   */
  sendReliable(sock, data) {
    return this.sendUnreliable(sock, data);
  }

  /**
   * @param {WsSocket} sock
   * @param {SizeBuf} out
   * @returns {number}
   */
  getMessage(sock, out) {
    if (!sock || sock.receive.length === 0) return 0;
    const msg = sock.receive.shift();
    out.beginRead(msg.bytes());
    out.readcount = 0;
    return 1;
  }

  disconnect() {
    this.socket.receive.length = 0;
    this.socket.canSend = false;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
