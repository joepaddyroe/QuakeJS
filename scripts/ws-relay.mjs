/**
 * Minimal QuakeJS WebSocket relay for opt-in NetQuake-style MP.
 *
 * Usage:
 *   node scripts/ws-relay.mjs [port]
 *
 * Host browser:  listen ws://localhost:27500
 * Client browser: connect ws://localhost:27500
 *
 * Binary frames are forwarded host↔clients. JSON control:
 *   { type:'hello', role:'server'|'client' }
 *   { type:'peer', event:'join'|'leave' }  → notified to server role
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const port = parseInt(process.argv[2] || '27500', 10);

/** @type {import('ws').WebSocket|null} */
let host = null;
/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('QuakeJS WS relay OK\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  /** @type {'server'|'client'|null} */
  let role = null;

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === 'hello' && (msg.role === 'server' || msg.role === 'client')) {
          role = msg.role;
          if (role === 'server') {
            if (host && host !== ws) {
              try {
                host.close();
              } catch {
                /* ignore */
              }
            }
            host = ws;
            ws.send(JSON.stringify({ type: 'ok', role: 'server' }));
            console.log('[relay] host connected');
            for (const c of clients) {
              ws.send(JSON.stringify({ type: 'peer', event: 'join' }));
              void c;
            }
          } else {
            clients.add(ws);
            ws.send(JSON.stringify({ type: 'ok', role: 'client' }));
            console.log('[relay] client connected (%d)', clients.size);
            if (host && host.readyState === 1) {
              host.send(JSON.stringify({ type: 'peer', event: 'join' }));
            }
          }
        }
      } catch {
        /* ignore */
      }
      return;
    }

    // Binary game payload
    if (role === 'server') {
      for (const c of clients) {
        if (c.readyState === 1) c.send(data, { binary: true });
      }
    } else if (role === 'client') {
      if (host && host.readyState === 1) host.send(data, { binary: true });
    }
  });

  ws.on('close', () => {
    if (role === 'server' && host === ws) {
      host = null;
      console.log('[relay] host disconnected');
    }
    if (role === 'client') {
      clients.delete(ws);
      console.log('[relay] client disconnected (%d)', clients.size);
      if (host && host.readyState === 1) {
        host.send(JSON.stringify({ type: 'peer', event: 'leave' }));
      }
    }
  });
});

server.listen(port, () => {
  console.log(`QuakeJS relay listening on ws://localhost:${port}`);
  console.log('Host:   listen ws://localhost:%d', port);
  console.log('Client: connect ws://localhost:%d', port);
});
