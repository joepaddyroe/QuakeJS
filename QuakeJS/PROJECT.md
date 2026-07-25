# QuakeJS — Project Guide

Canonical instructions for building and maintaining this port. **Read this file before making structural changes.** Update it when architecture, conventions, or port status change.

### Documentation roles

| File | Role |
|------|------|
| **`PROJECT.md` (this file)** | Living source of truth — status, roadmap, conventions, changelog. **Update on every port milestone.** |
| **`README.md`** | User-facing overview: what it is, how to run, folder layout. **Do not sync from this file.** Only edit README when something user-facing or structural changes drastically. |
| **`../README.md`** | Short pointer at the repo root → `QuakeJS/`. |

**Reference sources (read-only — never edit):**

| Tree | Role |
|------|------|
| `../Quake-master/WinQuake/` | **Primary** — WinQuake / GLQuake engine (`host.c`, `sv_*`, `cl_*`, `pr_*`, `gl_*`, `r_*`, …) |
| `../Quake-master/QW/` | QuakeWorld client/server (net play later; not Phase 0–4) |
| `../Quake-master/qw-qc/` | QuakeC sources for QW progs (reference only; game logic ships as `progs.dat` in PAK) |

### Source of truth (mandatory)

| Question | Answer |
|----------|--------|
| Game behaviour, protocols, physics, QuakeC builtins, map/model formats | **WinQuake C only** (`../Quake-master/WinQuake/`) |
| Step order, SOLID layers, `PROJECT.md` style, thin `index.html` | DoomJS / Duke ports were a **process template only** |
| GPU presentation | **WebGPU** (browser); architecture follows **GLQuake** (`gl_*.c`), not the software `r_*` / `d_*` span/edge pipeline |

**Do not** port Doom algorithms (column/span software renderer, WAD lumps, 35 Hz Doom tics, mobj thinkers) into this codebase. When DoomJS (or any other port) and Quake disagree, **Quake wins**.

### Always check with vanilla (mandatory)

Before changing server physics, client parse, QuakeC, BSP/PVS, or render math:

1. **Open the matching C function first** in `../Quake-master/WinQuake/` (usually `sv_phys.c`, `world.c`, `cl_parse.c`, `pr_cmds.c`, `gl_rmain.c` / `r_main.c`).
2. **Diff call order, globals, and edge cases** — not just the “idea” of the algorithm. Half-ports of Quake (wrong `frametime` clamps, missing `SV_CheckVelocity`, broken `Mod_LeafPVS`, invented lighting) often look plausible and then break maps.
3. **Prefer a smaller, verified subset** over a speculative rewrite. If the full C path cannot be matched yet, leave the known-good approx and document the gap in **§12**.
4. **Do not invent fixes** (flip plane signs, change bbox mins/maxs, “simplify” QuakeC) without citing the C lines you are matching.
5. After a fidelity change, note it in **§15** and smoke-test `start` / `e1m1` before stacking more work.

If vanilla and the port disagree, **vanilla wins** — fix the port, do not “improve” on Quake.

---

## Quick start for agents (context recovery)

If you are picking up this project with no chat history:

1. Read **§12 Port status** — what works vs what vanilla still has.
2. Read **Always check with vanilla** (under Source of truth) — open C before changing physics / VM / render.
3. Read **§13 Priority roadmap** — suggested order of work.
4. Use **§14 Key file map** to jump to the right module.
5. Respect **§2–3** (SOLID + layers) before editing.
6. After completing work, update **§12**, **§7**, and **§15 Changelog** in this file. Leave `README.md` alone unless the change is drastic for end users.

**Current maturity (2026-07-25):** id1 PAK + BSP world + hull walk + stair smooth + QuakeC + brush draw/clip + changelevel + alias MDL + sprites + FP shotgun (fire anim) + particles + status bar + Web Audio SFX + console/cvars + main menu + loading/intermission overlays. No loopback protocol yet.

### Remaining tasks (priority order)

Use **§13** for file-level detail. Summary:

| Priority | Task | Status |
|----------|------|--------|
| **P0** | Canvas + WebGPU shell, `Host` / frame loop | Done |
| **P0** | Filesystem: PAK + `id1` search paths | Done |
| **P1** | BSP / alias / sprite model load | Done — BSP + MDL + SPR |
| **P1** | WebGPU world draw (brush + lightmaps) | Done (+ PVS/sky/turb) |
| **P2** | Loopback client ↔ server + protocol | Not started |
| **P2** | QuakeC VM (`pr_exec` / edicts / builtins) | Partial — spawn/think/touch/changelevel |
| **P2** | Physics / movement (`sv_phys`, `world`) | Partial — walk + brush clip + PUSH |
| **P3** | View weapon, particles, status bar, menu | Partial — shotgun + particles + sprites + sbar + console + menu |
| **P3** | Sound (DMA-style mix → Web Audio) | Partial — SFX + spatialize |
| **P4** | Saves, demos, console polish | Not started |
| **P5** | QuakeWorld / multiplayer | Not started |

---

## 1. Mission

Port the original Quake engine to JavaScript so it runs in a browser via `index.html`, rendering with **WebGPU**.

| Goal | Detail |
|------|--------|
| Fidelity | Preserve original game logic and data flow; behaviour should match WinQuake C where practical |
| Structure | Sound OOP / SOLID — not a line-by-line transliteration of C globals |
| Runtime | Plain ES modules; no build step for local dev (static serve + `index.html`) |
| Display | Full-viewport canvas; WebGPU present; classic 4:3 (or user vid mode) scaled to viewport |
| Architecture | Keep Quake’s **client + server + QuakeC** split (even for single-player via loopback) |
| Reference | `Quake-master/` is **read-only** — never edit it |

Quake is several cooperating layers in C:

1. **Host** — `host.c` / `host_cmd.c` — frame orchestration, init/shutdown
2. **Server** — `sv_*.c`, `world.c` — entities, physics, game rules host
3. **QuakeC VM** — `pr_*.c` — runs `progs.dat` (monsters, items, triggers, weapons logic)
4. **Client** — `cl_*.c`, `view.c`, `chase.c` — input, prediction parse, view
5. **Renderer** — GLQuake `gl_*.c` (GPU path we follow) or software `r_*`/`d_*` (reference only)
6. **Platform** — `sys_*`, `vid_*`, `in_*`, `snd_*`, `net_*`

Port the **game architecture**; replace platform video with WebGPU and net/sound with browser APIs behind interfaces.

---

## 2. SOLID Rules (Mandatory)

### Single Responsibility (SRP)
One class/module = one reason to change. Example: `PakFile` reads archives; `BspModel` owns brush geometry; `WebGpuRenderer` draws — not one god object.

### Open/Closed (OCP)
Extend via new implementations. Example: `WebAudioSoundDriver` implements `SoundDriver` without changing `Host`.

### Liskov Substitution (LSP)
Subtypes honour interface contracts. Example: any video output must support the same present / resize contract.

### Interface Segregation (ISP)
Small interfaces. Example: keyboard polling is separate from `usercmd_t` building (`cl_input`).

### Dependency Inversion (DIP)
Server / client / VM code depends on abstractions, not browser APIs. `Host` receives sound/input/video/net via wiring in `main.js`.

---

## 3. Layer model (dependencies flow downward only)

```
index.html / main.js             ← bootstrap, wiring
        ↓
app/                             ← Host, HostCmds, frame loop, scenes
        ↓
server/ client/ progs/ render/   ← game subsystems
audio/ ui/ fs/
        ↓
core/ math/ protocol/            ← constants, vec/mathlib, net protocol
        ↓
platform/                        ← WebGPU canvas, input, sound, loopback net
        ↓
Browser APIs (WebGPU, Web Audio, …)
```

**Rule:** `src/server/`, `src/client/`, `src/progs/`, and `src/render/` must not import `document`/`window` directly.

### C source → QuakeJS mapping

| C prefix / files | QuakeJS |
|------------------|---------|
| `sys_*`, `vid_*`, `in_*` | `src/platform/` |
| `host.c`, `host_cmd.c` | `src/app/` |
| `common.c`, `cmd.c`, `cvar.c`, `zone.c`, `crc.c`, `wad.c` | `src/core/`, `src/fs/` |
| `model.c`, `gl_model.c`, BSP/MDL/SPR | `src/fs/` + `src/render/models/` |
| `sv_*`, `world.c` | `src/server/` |
| `pr_exec.c`, `pr_edict.c`, `pr_cmds.c` | `src/progs/` |
| `cl_*`, `view.c`, `chase.c` | `src/client/` |
| `gl_*` (GLQuake) | `src/render/` (WebGPU) |
| `r_*`, `d_*` | Reference only — **do not** port as primary renderer |
| `draw.c`, `gl_draw.c`, `sbar.c`, `menu.c`, `console.c`, `keys.c`, `screen.c` | `src/ui/`, `src/client/` |
| `snd_*` | `src/audio/` |
| `net_*` (loopback first) | `src/net/`, `src/platform/` |
| `quakedef.h`, `protocol.h`, `render.h` | `src/core/`, `src/protocol/` |

When porting a C function, identify which **class owns the data** it mutates (edict fields → `EdictStore`; `cl` → `ClientState`; lightmap atlas → `LightmapAtlas`; etc.).

---

## 4. Directory layout (target)

```
QuakeJS/
├── index.html
├── PROJECT.md
├── src/
│   ├── main.js                 # Composition root
│   ├── app/
│   │   ├── Host.js             # Host_Init / Host_Frame / Host_Shutdown
│   │   ├── HostCmds.js         # map, quit, load/save, reconnect, …
│   │   └── GameLoop.js         # rAF → Host.frame(time)
│   ├── core/                   # quake constants, cvars helpers, sizes from quakedef.h
│   ├── math/                   # mathlib (vec3, angle vectors, BoxOnPlaneSide, …)
│   ├── protocol/               # protocol.h message types, sizes
│   ├── fs/                     # PakFile, FileSystem (COM_*), lump/cache helpers
│   ├── server/
│   │   ├── Server.js           # sv_main
│   │   ├── ServerPhys.js       # sv_phys
│   │   ├── ServerMove.js       # sv_move
│   │   ├── ServerUser.js       # sv_user (client think on server)
│   │   └── World.js            # world.c — hulls, PointContents, Move
│   ├── progs/
│   │   ├── PrExec.js           # QuakeC interpreter
│   │   ├── PrEdict.js          # edict pool / fields
│   │   └── PrBuiltins.js       # pr_cmds.c builtins
│   ├── client/
│   │   ├── Client.js           # cl_main
│   │   ├── ClientInput.js      # cl_input → usercmd
│   │   ├── ClientParse.js      # cl_parse
│   │   ├── ClientTempEnts.js   # cl_tent
│   │   ├── ClientDemo.js       # cl_demo
│   │   └── View.js             # view.c / chase
│   ├── render/                 # WebGPU path (GLQuake-shaped)
│   │   ├── WebGpuRenderer.js   # facade (SCR_UpdateScreen / V_RenderView glue)
│   │   ├── DemoRoomRenderer.js # TEMP scaffolding only — not Quake BSP
│   │   ├── FlyCamera.js        # TEMP fly cam for demo room
│   │   ├── GpuDevice.js        # (lives in platform/) adapter/device/swapchain
│   │   ├── WorldRenderer.js    # brush surfaces, PVS, lightmaps (later)
│   │   ├── AliasRenderer.js    # MDL (later)
│   │   ├── SpriteRenderer.js
│   │   ├── ParticleRenderer.js
│   │   ├── SkyRenderer.js
│   │   └── models/             # BspModel, AliasModel, SpriteModel loaders (later)
│   ├── audio/                  # SoundSystem → Web Audio (snd_dma / snd_mix)
│   ├── ui/                     # Console, Menu, StatusBar, Draw 2D
│   ├── net/                    # NetLoop (loopback), later WebSocket/UDP bridge
│   └── platform/               # Canvas/WebGPU surface, keyboard, mouse, timers
└── assets/                     # Optional id1/ (often gitignored; user-supplied PAK)
```

Phase 0 only creates the shell folders and platform/app/core stubs.

---

## 5. Coding conventions

- ES modules; `camelCase` methods, `PascalCase` classes, `UPPER_SNAKE` for C-macro-style constants
- JSDoc on public APIs
- **Keep:** Quake coordinate system, `vec3_t` float math, BSP/MDL/SPR/PAK layouts, protocol message shapes, QuakeC semantics, deterministic RNG where vanilla uses it (`rand` builtins / server)
- **Modernize:** hunk/zone → GC-backed pools where safe; function pointers → method dispatch; `byte*` → `Uint8Array` / `DataView`
- **Render:** WebGPU is the **only** present path; do not implement the software `D_DrawSpans` pipeline unless explicitly requested as a debug tool
- Fail fast on missing `pak0.pak` / `gfx.wad` / `progs.dat` / maps during development

### Timing (from `host.c`)

| Concept | Vanilla | QuakeJS |
|---------|---------|---------|
| Frame driver | `Host_Frame(time)` as fast as the platform allows | `requestAnimationFrame` → `Host.frame(dt)` |
| `host_frametime` | Clamped (~0.001–0.1); optional `host_framerate` | Same clamps |
| Server | Runs inside host frame; Quake2 path can subdivide to ~1/72 | Match WinQuake `#ifdef` behaviour you target (document choice in §12) |
| QuakeC `frametime` | `pr_global_struct->frametime = host_frametime` | Same |

**Not** Doom’s fixed 35 Hz tic. Do not invent a Doom-style accumulator unless matching a specific Quake subsystem that already quantizes time.

### Data (from `common.c` / filesystem)

- Game directory default: **`id1`**
- Archives: **`pak0.pak`**, **`pak1.pak`**, … (PAK directory + file lumps)
- Critical lumps: `progs.dat`, `gfx.wad`, `gfx/palette.lmp`, `gfx/colormap.lmp`, maps under `maps/*.bsp`
- User supplies legally obtained Quake data — **never** commit commercial PAK contents

---

## 6. Porting workflow

1. Locate C source in `../Quake-master/WinQuake/`
2. Identify data ownership (globals → instance fields on Host / Server / Client / Progs)
3. Design JS class/interface
4. Port one vertical slice (e.g. PAK → load BSP → clear WebGPU frame with palette clear color)
5. Verify against vanilla behaviour on a known map (`start`, `e1m1`)
6. Update **§7** checklist and **§12** port status in this file

Do **not** bulk-translate entire `.c` files. One subsystem per change.

**Renderer note:** When the C reference is software (`r_bsp.c`, `d_edge.c`), read the **GLQuake** equivalent (`gl_rmain.c`, `gl_rsurf.c`, `gl_warp.c`, `gl_mesh.c`) for the algorithm shape you will implement in WebGPU. Still verify visibility (PVS), surface flags, and entity link order against vanilla.

---

## 7. Implementation phases (accurate status)

Legend: `[x]` done · `[~]` partial · `[ ]` not started

### Phase 0 — Shell
- [x] Full-viewport canvas, ES module bootstrap
- [x] WebGPU device / swapchain (`GpuDevice.js`)
- [x] `GameLoop` → `Host.frame`
- [x] Demo-room present path (`DemoRoomRenderer.js` — **TEMP scaffolding**, not BSP)
- [x] Fly camera (WASD + pointer lock) to exercise view matrix
- [ ] Stub `Host` init/shutdown matching `Host_Init` stages (filesystem before vid)

### Phase 1 — Data / filesystem
- [x] `PakFile` — PAK directory and lump I/O
- [x] `FileSystem` — search paths (`pak1` then `pak0`), `load` / `has`
- [x] Palette load (`gfx/palette.lmp`)
- [x] `gfx.wad` picture lumps for 2D (later menus/console) — sbar + menu LMPs
- [ ] User file picker / directory handle when fetch of `id1` fails

### Phase 2 — Models
- [x] Brush BSP load (verts, edges, surfaces, textures, lighting, texinfo, faces, entities, submodels)
- [x] Alias MDL load
- [x] Sprite SPR load
- [x] Texture upload path (8-bit → RGBA GPU; lightmap atlas 128×128 pages)

### Phase 3 — Render (WebGPU)
- [x] World brush draw with lightmaps (static, style 0)
- [x] PVS culling (`Mod_PointInLeaf` / `Mod_LeafPVS` / marksurfaces)
- [x] Turbulent water / sky (`EmitWaterPolys` / `EmitSkyPolys` subset)
- [x] Alias models (items/monsters) + first-person view weapon (`v_shot.mdl`)
- [x] Particles (gunshot / blood via `R_RunParticleEffect` subset)
- [x] Sprites (SPR load + billboard draw; QW-style explosion temps)
- [ ] Dynamic lights / lightstyles
- [ ] 2D draw (`Draw_Pic`, console background)
- [ ] Frustum cull on BSP nodes (`R_CullBox`)

### Phase 4 — Server + QuakeC
- [x] Edict pool + field layout (`progs.dat` CRC / defs)
- [x] QuakeC interpreter (`PrExec`) — LOAD/ADDRESS use field globals like WinQuake
- [x] Builtins subset — doors/items/triggers spawn path
- [x] World hull collision (`World.js` — PointContents + RecursiveHullCheck)
- [x] Player walk scaffold (`PlayerMove.js` — accelerate / FlyMove / step-up / jump)
- [x] Map entity spawn + think / PUSH / trigger touch (`Server.js` in Host frame)
- [x] Draw `*N` brush entities (doors/plats) at edict origin
- [x] Stair view smoothing (`view.c` oldz → eye Z)
- [x] Clip player against brush entities (`World.brushes` / submodel hulls)
- [x] `changelevel` builtin + Host map reload (`e1m1` …)
- [ ] Client connect via **loopback** (`net_loop`)
- [ ] Fuller builtins + `PutClientInServer` (loadout + shotgun fire anim stub done)

### Phase 5 — Client playable slice
- [ ] `CL_SendCmd` / `SV_ClientThink` movement
- [ ] `CL_ParseServerMessage` entity baseline / updates
- [ ] View punch, bob, roll (`view.c`) subset
- [ ] Point entities: items, monsters, doors/plats/triggers via QuakeC (no hand-rolled Doom-style AI)

### Phase 6 — UI / meta
- [x] Console + cvars + commands (`cmd`, `cvar`, `console`, `keys`) — basic overlay
- [x] Menus (`menu.c`) — main / singleplayer / options / help / quit
- [x] Status bar (`sbar.c`) — health / armor / ammo / face + inventory strip
- [x] Loading plaque / intermission / finale messages

### Phase 7 — Audio
- [x] SFX from PAK (`sound/*.wav`) via Web Audio
- [x] Ambient channel / spatialization subset (`S_StartSound` parity)
- [ ] CD / music track stubs (optional HTMLAudio or silent)

### Phase 8 — Persistence & demos
- [ ] Save / load (`Host_Savegame` / `Host_Loadgame` — Quake text save format)
- [ ] Demo record / playback (`cl_demo.c`)
- [ ] Config / `autoexec.cfg` / `config.cfg` in `localStorage` or File System Access API

### Phase 9 — Multiplayer (opt-in; does not alter SP loopback path)
- [ ] QuakeWorld or NetQuake protocol over WebSocket/WebRTC (separate milestone)
- [ ] Do not require QW for single-player id1 completion

---

## 12. Port status vs vanilla Quake

Last audited: **2026-07-25** against `Quake-master/WinQuake`. Re-audit after major features.

### 12.1 Subsystem maturity

```
Host / frame         ████░░░░░░  ~40%   rAF Host.frame; server physics + trigger touch
Filesystem (PAK)     ████████░░  ~80%   pak0+pak1; no loose files / -path
Models (BSP/MDL/SPR) ██████░░░░  ~65%   BSP+alias MDL; no SPR
WebGPU render        ████████░░  ~85%   world+brush+alias+sprites+view weapon+particles; no frustum
Server / world       ███████░░░  ~65%   hull walk + pushers + brush clip
QuakeC VM            ██████░░░░  ~55%   exec+edicts+builtins; doors/triggers on start
Client / protocol    ░░░░░░░░░░   0%   view weapon pose via local edict stub
UI / console/menu    ████████░░  ~80%   sbar + console + menu + loading/intermission
Audio                ████░░░░░░  ~40%   Web Audio SFX + Quake spatialize; no DMA mix / CD
Saves / demos        ░░░░░░░░░░   0%
Net (non-loopback)   ░░░░░░░░░░   0%
```

### 12.2 Done well (vanilla parity acceptable)

| Area | Key files | Notes |
|------|-----------|-------|
| WebGPU bring-up | `GpuDevice.js`, `WebGpuRenderer.js` | Device + present |
| PAK filesystem | `PakFile.js`, `FileSystem.js` | id1 pak0/pak1 |
| BSP load | `BspModel.js` | BSP29 + nodes/leafs/vis/clipnodes/hulls |
| PVS | `BspModel.markLeaves` / `gatherVisibleFaces` | Leaf PVS → marksurfaces |
| World draw | `WorldRenderer.js` | Texture × lightmap; sky dual-layer; turb warp |
| Collision | `server/World.js` | Hull0 contents + hull1 player trace |
| Player move | `server/PlayerMove.js` | Walk/jump/step/noclip scaffold |
| QuakeC | `progs/*`, `server/Server.js` | Load progs, spawn entities, think/PUSH/touch |

### 12.3 Partial — known gaps

#### Rendering
- No frustum box cull on nodes (`R_CullBox`)
- Lightstyles not animated (style 0 @ 'm' scale only)
- Sky/turb are WebGPU approximations of `gl_warp.c` (no subdivided polys)
- `DemoRoomRenderer` retained as load-failure fallback

### 12.4 Missing entirely (initial backlog)

| Vanilla module | Purpose |
|----------------|---------|
| `host.c` / `host_cmd.c` | Frame + commands |
| `common.c` filesystem | PAK / search paths |
| `model.c` / `gl_model.c` | BSP and models |
| `gl_*.c` | GPU render (map to WebGPU) |
| `sv_*.c` / `world.c` | Server simulation |
| `pr_*.c` | QuakeC |
| `cl_*.c` / `view.c` | Client |
| `snd_*.c` | Sound |
| `menu.c` / `sbar.c` / `console.c` | UI |
| `net_*.c` | Networking beyond loopback |

---

## 13. Priority roadmap

Use this when choosing what to port next. Goal: **playable Quake 1 single-player (id1)** before QuakeWorld / multiplayer polish.

| Priority | Task | Why | Primary files / C ref |
|----------|------|-----|------------------------|
| P0 | **WebGPU + Host shell** | Done | `platform/`, `app/Host.js` |
| P0 | **PAK filesystem** | Done | `fs/PakFile.js`, `FileSystem.js` · `common.c` |
| P1 | **BSP load + lightmaps** | Done (static) | `models/BspModel.js`, `WorldRenderer.js` · `model.c`, `gl_rsurf.c` |
| P1 | **Clear + draw world** | Done | `WebGpuRenderer.js` · `gl_rmain.c` |
| P1 | **PVS + sky/turb** | Done | `BspModel.js`, `WorldRenderer.js` · `gl_warp.c`, `Mod_LeafPVS` |
| P2 | **Physics / hulls** | Partial — world walk | `server/World.js`, `PlayerMove.js` · `world.c`, `sv_phys.c` |
| P2 | **QuakeC VM + builtins** | Partial — spawn/think/touch | `progs/*`, `Server.js` · `pr_exec.c`, `pr_edict.c`, `pr_cmds.c` |
| P2 | **Draw brush ents + entity clip** | Done | `WorldRenderer` + `World.brushes` · `SV_ClipMoveToEntity` |
| P2 | **Changelevel / map load** | Done (no intermission UI) | `Host.changeMap`, builtin #70 · `host_cmd.c` |
| P2 | **Loopback net + SV/CL connect** | Real Quake architecture | `net/NetLoop.js`, `Client.js` · `net_loop.c`, `sv_main.c`, `cl_main.c` |
| P3 | **Alias + view weapon** | Partial — FP shotgun + fire frames | `AliasRenderer.js`, `Server.playerAttack` · `gl_mesh.c`, `view.c` |
| P3 | **Status bar + menu + console** | Partial — sbar + console + menu + overlays | `ui/*` · `sbar.c`, `console.c`, `menu.c`, `screen.c` |
| P3 | **Sound** | Partial — SFX + spatialize | `audio/SoundSystem.js` · `snd_dma.c` |
| P4 | **Particles, temp ents, sky polish** | Partial — particles + explosion sprites | `ParticleSystem.js`, `SpriteRenderer.js` · `r_part.c`, `cl_tent.c` |
| P4 | **Save / load / demos** | QoL | `HostCmds.js`, `ClientDemo.js` · `host_cmd.c`, `cl_demo.c` |
| P5 | **QuakeWorld / MP** | Later | `../Quake-master/QW/` |

---

## 14. Key file map

| If you need to… | Start here |
|-----------------|------------|
| Change frame order / init | `app/Host.js` · `host.c` `_Host_Frame` |
| Load files from PAK | `fs/FileSystem.js`, `PakFile.js` · `common.c` |
| Spawn / change map | `server/Server.js`, `app/HostCmds.js` · `SV_SpawnServer` |
| QuakeC execution | `progs/PrExec.js` · `pr_exec.c` |
| Builtins (setorigin, sound, …) | `progs/PrBuiltins.js` · `pr_cmds.c` |
| Movement / gravity / fly | `server/ServerPhys.js` · `sv_phys.c` |
| Trace / hulls / contents | `server/World.js` · `world.c` |
| Build usercmds | `client/ClientInput.js` · `cl_input.c` |
| Parse svc_* messages | `client/ClientParse.js` · `cl_parse.c` |
| Render one frame | `render/WebGpuRenderer.js` · `gl_rmain.c` / `SCR_UpdateScreen` |
| Brush surfaces / lightmaps | `render/WorldRenderer.js` · `gl_rsurf.c` |
| Alias / weapon model | `render/AliasRenderer.js` · `gl_mesh.c` |
| Sprites | `render/SpriteRenderer.js`, `models/SpriteModel.js` · `r_sprite.c`, `gl_rmain.c` |
| Particles | `render/ParticleSystem.js` · `r_part.c` |
| HUD | `ui/StatusBar.js`, `ui/ScreenOverlay.js`, `fs/WadFile.js` · `sbar.c`, `screen.c` |
| Sound | `audio/SoundSystem.js` · `snd_dma.c`, `snd_mem.c` |
| Menus | `ui/Menu.js`, `ui/DrawPics.js` · `menu.c` |
| Console / cvars | `ui/Console.js`, `core/Cvar.js`, `core/Cmd.js`, `ui/HostCmds.js` · `console.c`, `cvar.c`, `cmd.c` |
| Constants / limits | `core/` · `quakedef.h`, `protocol.h` |

### Host frame order (reference)

Matches vanilla `_Host_Frame` intent (simplified):

```
filtertime / set host_frametime
Host_GetConsoleCommands
if (server active) Host_ServerFrame   // → SV_Frame / QuakeC / physics
if (client) CL_ReadFromServer
SCR_UpdateScreen                      // → V_RenderView → WebGPU present
S_Update (audio)
```

Keep this order unless you are matching a documented vanilla `#ifdef` variant.

---

## 8. Agent instructions

When working on QuakeJS:

1. Read this file — especially **§12** and **§13**
2. Respect SOLID and the layer model
3. Keep `index.html` thin; logic in `src/`
4. Minimize scope — one subsystem per task
5. Do **not** modify `Quake-master/`
6. Do **not** add npm/webpack/TypeScript unless the user requests it
7. Do **not** treat DoomJS/Duke as behavioural references — only as process templates
8. Prefer **GLQuake** (`gl_*.c`) over software (`r_*`/`d_*`) when implementing rendering
9. Update **§7**, **§12**, and **§15** when completing port milestones

When unsure where code belongs: *Which layer owns this data, and which interface should the rest of the engine use?*

---

## 9. Local development

```powershell
cd "QuakeJS"
python -m http.server 8080
# → http://localhost:8080
```

Requires a browser with **WebGPU** enabled.

User supplies a legally obtained Quake `id1` directory (at least `pak0.pak`). File picker / directory access available if default fetch fails.

---

## 10. Non-goals (unless requested)

- Software `r_*` / `d_*` span renderer as the primary path
- Shipping commercial PAK / demo data in the repo
- QuakeWorld multiplayer before id1 single-player is playable
- Node.js dedicated server as the primary target
- TypeScript migration
- Non-faithful gameplay tweaks / “QoL” that change vanilla feel
- Bulk line-by-line C transliteration without ownership redesign

---

## 15. Changelog

| Date | Change |
|------|--------|
| 2026-07-25 | Initial project guide for QuakeJS (WebGPU + ES modules); WinQuake reference; greenfield status |
| 2026-07-25 | **Phase 0 shell:** WebGPU swapchain, `Host`/`GameLoop`, `DemoRoomRenderer` scaffolding + fly camera (WASD / pointer lock) |
| 2026-07-25 | **Phase 1 data + world draw:** `PakFile`/`FileSystem`, BSP29 `BspModel`, `WorldRenderer` (texture×lightmap), `QuakeCamera` spawn on `maps/start.bsp` |
| 2026-07-25 | **PVS + sky/turb:** nodes/leafs/vis, marksurfaces culling; dual-layer sky + water warp shaders |
| 2026-07-25 | **Player collision walk:** clipnodes/hulls, `World` trace, `PlayerMove` (gravity/jump/steps); `N` noclip |
| 2026-07-25 | **QuakeC VM:** `Progs`/`Edicts`/`PrExec`/`Builtins`, map spawn + think/PUSH/touch in `Host`; fixed LOAD/ADDRESS field-ofs (WinQuake `pr_exec.c`) |
| 2026-07-25 | **Brush ents + stair smooth:** draw `*N` submodels at origin; `view.c` step-up eye lag (`_smoothZ`) |
| 2026-07-25 | **Brush collision:** clip player vs SOLID_BSP `*N` hulls (fixes fall-through under `func_bossgate` after start teleporters) |
| 2026-07-25 | **Changelevel:** builtin #70 + `Host.changeMap`; PlayerPreThink/buttons; touch episode exits to load `e1m1` etc. |
| 2026-07-25 | **Doors/buttons:** SV_Impact on brush bumps (func_button); hitscan for shootable secret doors; walk-up door fields already via SOLID_TRIGGER |
| 2026-07-25 | **Pushers:** SV_PushMove subset carries local player on plats/doors; `groundEntity`; brush `startsolid` merge; refresh brushes while pushers move |
| 2026-07-25 | **Alias MDL:** `AliasModel` + `AliasRenderer`; draw items/monsters from `getAliasDrawList` |
| 2026-07-25 | **View weapon:** `v_shot.mdl` via client loadout stub (`SetNewParms`/`W_SetCurrentAmmo`); `drawViewModel` + camera-aligned basis |
| 2026-07-25 | **WebGPU uniform bug:** shared `writeBuffer` before submit made every alias/brush draw use the last matrix (ents stacked on camera); fix via in-encoder `copyBufferToBuffer` |
| 2026-07-25 | **Pusher think:** match `SV_Physics_Pusher` (`nextthink > oldltime`) so `wait=-1` doors/buttons do not instantly return; touch triggers once per frame |
| 2026-07-25 | **Status bar:** `WadFile` + `StatusBar` from `gfx.wad`; health/armor/ammo/face + inventory strip wired to client edict stats |
| 2026-07-25 | **Sound:** `SoundSystem` (Web Audio); `sound`/`precache_sound`/`ambientsound` builtins; Quake L/R spatialize; shotgun stub SFX |
| 2026-07-25 | **Console:** `Cmd`/`Cvar` + DOM console (`); commands map/noclip/help/status; volume & sensitivity cvars |
| 2026-07-25 | **Main menu:** `Menu` from gfx LMPs; Single Player → New Game; Options volume/sensitivity; Help; Quit stub |
| 2026-07-25 | **Loading / intermission:** `ScreenOverlay` (`gfx/loading.lmp`, complete/inter/finale); map-change plaque; QC intermission stats |
| 2026-07-25 | **Weapon fire anim:** shotgun `weaponframe` 1–6 (`v_shot.mdl`); ammo consume; `attack_finished` cooldown via `playerAttack` |
| 2026-07-25 | **Particles:** `ParticleSystem` (`R_RunParticleEffect` subset); gunshot sparks / blood on hitscan; QC `particle` builtin |
| 2026-07-25 | **Sprites:** SPR loader + billboard draw; entity `.spr` list; QW-style `s_explod` temps via Write*/`svc_temp_entity` |

---

## Appendix A — Quake architecture cheat sheet

| Concern | Lives in vanilla | Notes for the port |
|---------|------------------|--------------------|
| Game rules (monsters, items, doors) | `progs.dat` via QuakeC | Do **not** reimplement AI in ad-hoc JS; grow builtins + VM fidelity |
| Physics | `sv_phys.c` + `world.c` | Hull-based traces; separate from rendering |
| Networking | Client ↔ server messages | SP uses **loopback**; same code paths as net play |
| Maps | BSP v29 (Quake) | Planes, nodes, leafs, clipnodes, surfaces, lighting lump |
| Models | MDL (alias), SPR (sprites) | GPU buffers + CPU animation frames |
| 2D UI | `gfx.wad` + `draw`/`gl_draw` | Console, menu, sbar |
| Config | cvars + cmds | `cvar.c`, `cmd.c` — keep early; Quake is cvar-driven |

## Appendix B — Important WinQuake entry points

| Function | File | Role |
|----------|------|------|
| `Host_Init` / `Host_Frame` / `Host_Shutdown` | `host.c` | Lifetime |
| `COM_InitFilesystem` | `common.c` | PAK paths |
| `SV_SpawnServer` | `sv_main.c` | Load map + progs |
| `SV_Physics` | `sv_phys.c` | Entity physics |
| `PR_ExecuteProgram` | `pr_exec.c` | Run QuakeC |
| `CL_ReadFromServer` | `cl_main.c` | Pull updates |
| `V_RenderView` | `view.c` | Set up view |
| `R_RenderView` / `GL_BeginRendering` | `r_main.c` / `gl_rmain.c` | 3D frame |
| `SCR_UpdateScreen` | `screen.c` / `gl_screen.c` | Compose + present |
| `S_Update` | `snd_dma.c` | Mix audio |

Always verify against these files in `../Quake-master/WinQuake/` — they are authoritative.
