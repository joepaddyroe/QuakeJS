# QuakeJS

Browser-based port of Quake 1 (WinQuake / GLQuake architecture), written in JavaScript (ES modules) with **WebGPU** rendering.

## Requirements

- A legally obtained Quake `id1` install — **`pak0.pak`** (shareware) and preferably **`pak1.pak`** (full registered game; searched first when both are present)
  - Place them under `assets/id1/`, **or**
  - Use the in-page file picker when fetch fails (files stay local; nothing is uploaded)
- A browser with **WebGPU** enabled (current Chrome / Edge recommended)
- A static file server (e.g. `python -m http.server 8080`)

## Run

```bash
python -m http.server 8080
```

Open `http://127.0.0.1:8080/index.html` (or the repo root on GitHub Pages). On boot the game runs **`quake.rc`** like vanilla — including the **`startdemos demo1 demo2 demo3`** attract loop from the PAKs. Click the canvas for pointer lock; Esc opens the menu (New Game stops demos and starts a map); `` ` `` opens the console.

### Optional music

CD tracks are not in the PAKs. To enable BGM, put rip files under `music/` as `track02.ogg`, `track04.ogg`, … and list their numbers in `music/tracks.json` (e.g. `[2, 4, 5, 9]`). With an empty list (default), the game stays silent and does not request missing files.

## Controls

Click the canvas before playing so keyboard and mouse input reach the game. Pointer lock is released while the console or menu is open.

### In-game

Defaults (rebind with console `bind` / `unbind` / `bindlist`):

| Action | Input |
|--------|--------|
| Move forward / back / strafe | **W** / **S** / **A** / **D** (or arrow keys) |
| Look | **Mouse** (sensitivity cvar / Options) |
| Jump | **Space** |
| Duck / swim down | **C** |
| Fire | **Left mouse** or **Ctrl** |
| Weapons | **1**–**8** (`impulse`) |
| Noclip toggle | **N** (or console `noclip`) |
| Console | **\`** (backquote) |
| Main menu | **Escape** |

### Console (useful commands)

| Command | Purpose |
|---------|---------|
| `map <name>` | Load a map (`e1m1`, `start`, …) |
| `bind` / `unbind` / `bindlist` | Key bindings (saved in `config.cfg`) |
| `impulse <1-8>` | Select weapon (axe…lightning); keys **1**–**8** |
| `give all` | All weapons + ammo (cheat) |
| `noclip` | Toggle noclip |
| `save` / `load` `<name>` | Quake `.sav` via localStorage |
| `record` / `stop` / `playdemo` | Demo record / playback |
| `listen` / `connect` / `disconnect` | Opt-in WebSocket multiplayer (see below) |
| `help` / `cmdlist` / `status` | List commands / status |

### Menus

| Action | Input |
|--------|--------|
| Open / close | **Escape** |
| Navigate / activate | Menu keys (arrows / Enter — classic Quake menu LMPs) |

## Port status

Last audited **2026-07-25** against `Quake-master/WinQuake`. Full gap analysis lives in [PROJECT.md](./PROJECT.md) §12.

```
Host / frame         ███████░░░  ~70%   Host_Init/Shutdown; protocol move + clientdata flush
Filesystem (PAK)     ██████████  ~95%   pak1-first; registered (gfx/pop.lmp); picker fallback
Models (BSP/MDL/SPR) ████████░░  ~80%   BSP + alias MDL + SPR
WebGPU render        ██████████  ~95%   world+brush+alias+sprites+lightstyles+dlights+view weapon+particles+frustum
Server / world       ███████░░░  ~70%   hull walk + pushers + brush clip + walkmove / STEP freefall
QuakeC VM            ███████░░░  ~65%   exec+edicts+builtins; PutClientInServer; walkmove/checkclient
Client / protocol    ███████░░░  ~70%   loopback + clientdata + baselines + entity updates + clc_move
UI / console/menu    █████████░  ~90%   sbar + conback console + menu + loading/intermission + centerprint
Audio                █████░░░░░  ~50%   Web Audio SFX + spatialize + CD stub
Saves / demos        ███████░░░  ~70%   Quake .sav text + .dem record/play via localStorage
Net (loopback)       ███████░░░  ~70%   NetLoop + SizeBuf + per-frame datagram
Net (non-loopback)   ████░░░░░░  ~40%   WebSocketNet + ws-relay; fan-out; no multi-slot SV yet
```

## Multiplayer (opt-in)

Single-player uses in-process **loopback** and does **not** require the relay. Experimental WebSocket path:

| Piece | Purpose |
|--------|---------|
| [scripts/ws-relay.mjs](./scripts/ws-relay.mjs) | Thin Node relay (host ↔ clients binary frames) |
| [src/net/WebSocketNet.js](./src/net/WebSocketNet.js) | Browser transport |
| Console `listen` / `connect` / `disconnect` | Host or join via relay |

```bash
cd QuakeJS
npm install
npm run relay
# default: ws://localhost:27500
```

1. Host browser: load a map → console `listen` (or `listen ws://localhost:27500`)
2. Client browser: `connect ws://localhost:27500` (host may stufftext the map name)

Full QuakeWorld / multi-slot clients are still an open milestone — see [PROJECT.md](./PROJECT.md) Phase 9.

## Reference

The original C source in `Quake-master/` is **read-only** reference material for this port (`WinQuake/` primary; `QW/` for net play later). Local only — not published with the Pages site.

See [PROJECT.md](./PROJECT.md) for architecture, file map, roadmap, and development guidelines.
