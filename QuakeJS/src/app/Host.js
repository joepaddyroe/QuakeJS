/**
 * Host shell — eventually matches host.c (Init / Frame / Shutdown).
 * Phase 2 scaffold: clipped player walk + QuakeC server tick + changelevel.
 */

import { syncCanvasSize } from '../platform/GpuDevice.js';
import { PLAYER_MINS, PLAYER_MAXS } from '../server/PlayerMove.js';

export class Host {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLElement} deps.hud
   * @param {import('../platform/KeyboardInput.js').KeyboardInput} deps.keyboard
   * @param {import('../platform/PointerLook.js').PointerLook} deps.pointer
   * @param {import('../render/WebGpuRenderer.js').WebGpuRenderer} deps.renderer
   * @param {import('../fs/FileSystem.js').FileSystem} deps.fs
   */
  constructor({ canvas, hud, keyboard, pointer, renderer, fs }) {
    this._canvas = canvas;
    this._hud = hud;
    this._keyboard = keyboard;
    this._pointer = pointer;
    this._renderer = renderer;
    this._fs = fs;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;
    this._noclipWasDown = false;
    this._attackWasDown = false;
  }

  /**
   * Sync pointer angles from spawn / camera (degrees).
   */
  syncPointerFromCamera() {
    const cam = this._renderer.camera;
    if ('yaw' in cam && 'pitch' in cam) {
      this._pointer.yaw = cam.yaw;
      this._pointer.pitch = cam.pitch;
    }
  }

  /**
   * @param {string} mapName short name e.g. e1m1
   */
  changeMap(mapName) {
    const path = `maps/${mapName}.bsp`;
    if (!this._fs.has(path)) {
      console.error(`[host] map not found: ${path}`);
      return;
    }
    console.info(`[host] loading ${path}`);
    this._renderer.loadMap(this._fs, path);
    this.syncPointerFromCamera();
  }

  /**
   * @param {number} dt seconds
   */
  frame(dt) {
    const { width, height } = syncCanvasSize(this._canvas);
    const worldMode = this._renderer.mode === 'world';
    const player = this._renderer.player;
    const kb = this._keyboard;
    const server = this._renderer.server;

    // Pending changelevel from QuakeC
    if (server?.pendingMap) {
      const map = server.pendingMap;
      server.pendingMap = null;
      this.changeMap(map);
      return;
    }

    // Toggle noclip with N
    const nDown = kb.isDown('KeyN');
    if (worldMode && player && nDown && !this._noclipWasDown) {
      player.noclip = !player.noclip;
    }
    this._noclipWasDown = nDown;

    const intermission = !!(server && server.isIntermission());

    if (worldMode && player) {
      // Clip against doors/walls/bossgates
      if (server && this._renderer.collision) {
        this._renderer.collision.brushes = server.getBrushDrawList();
      }

      const attack = this._pointer.attack || kb.isDown('ControlLeft') || kb.isDown('ControlRight');
      const jump = kb.isDown('Space');
      const attackPressed = attack && !this._attackWasDown;
      this._attackWasDown = attack;

      if (server) {
        const frameDt = Math.min(dt, 0.1);
        server.syncClientEdict(1, {
          origin: player.origin,
          velocity: player.velocity,
          pitch: this._pointer.pitch,
          yaw: this._pointer.yaw,
          mins: PLAYER_MINS,
          maxs: PLAYER_MAXS,
          onground: player.onground,
          groundEntity: player.groundEntity,
        });
        server.runClientThink(1, { attack, jump });
        server.applyClientEdict(1, player);
      }

      if (!intermission) {
        player.setAngles(this._pointer.pitch, this._pointer.yaw);
        player.update(dt, {
          forward: kb.isDown('KeyW') || kb.isDown('ArrowUp'),
          back: kb.isDown('KeyS') || kb.isDown('ArrowDown'),
          left: kb.isDown('KeyA') || kb.isDown('ArrowLeft'),
          right: kb.isDown('KeyD') || kb.isDown('ArrowRight'),
          jump,
          up: jump,
          down: kb.isDown('ControlLeft') || kb.isDown('ControlRight') || kb.isDown('KeyC'),
        });
        this._pointer.yaw = player.yaw;
        this._pointer.pitch = player.pitch;
      }

      if (server) {
        const frameDt = Math.min(dt, 0.1);
        if (!intermission) {
          // Buttons / door messages / key doors — SV_Impact on brush bumps
          server.impactTouches(1, player.impactedEdicts);
          if (attackPressed) {
            const eye = player.eye();
            server.fireHitscan(1, eye, player.pitch, player.yaw, 20);
          }
        }
        server.physics(frameDt, player);
        if (!intermission) {
          // Player may have been carried by a plat/door — sync that origin
          server.syncClientEdict(1, {
            origin: player.origin,
            velocity: player.velocity,
            pitch: player.pitch,
            yaw: player.yaw,
            mins: PLAYER_MINS,
            maxs: PLAYER_MAXS,
            onground: player.onground,
            groundEntity: player.groundEntity,
          });
          server.touchTriggers(player.origin, PLAYER_MINS, PLAYER_MAXS, 1);
          const applied = server.applyClientEdict(1, player);
          if (applied.fixangle) {
            this._pointer.yaw = applied.yaw;
            this._pointer.pitch = applied.pitch;
          }
        }
      }
    } else {
      const cam = this._renderer.camera;
      cam.setAngles(
        (this._pointer.yaw * Math.PI) / 180,
        (this._pointer.pitch * Math.PI) / 180,
      );
      cam.update(dt, {
        forward: kb.isDown('KeyW') || kb.isDown('ArrowUp'),
        back: kb.isDown('KeyS') || kb.isDown('ArrowDown'),
        left: kb.isDown('KeyA') || kb.isDown('ArrowLeft'),
        right: kb.isDown('KeyD') || kb.isDown('ArrowRight'),
        up: kb.isDown('Space'),
        down: kb.isDown('ControlLeft') || kb.isDown('ControlRight') || kb.isDown('KeyC'),
      });
    }

    this._renderer.frame(width, height, dt);

    this._fpsAccum += dt;
    this._fpsFrames += 1;
    if (this._fpsAccum >= 0.5) {
      this._fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    const lockHint = this._pointer.locked
      ? 'mouse look active (Esc to release)'
      : 'click canvas for mouse look';

    if (worldMode && player) {
      const eye = player.eye();
      const mode = intermission
        ? 'INTERMISSION'
        : player.noclip
          ? 'NOCLIP'
          : player.onground
            ? 'walk'
            : 'air';
      this._hud.textContent =
        `QuakeJS — ${this._renderer.mapName}\n` +
        `FPS ${this._fps.toFixed(0)}   ${width}×${height}\n` +
        `org ${player.origin[0].toFixed(0)} ${player.origin[1].toFixed(0)} ${player.origin[2].toFixed(0)}  [${mode}]\n` +
        `eye ${eye[0].toFixed(0)} ${eye[1].toFixed(0)} ${eye[2].toFixed(0)}\n` +
        `vis ${this._renderer.visibleFaces}  leaf ${this._renderer.viewLeaf}  mdl ${this._renderer.aliasCount}\n` +
        `\n` +
        (intermission
          ? `Level complete — click / jump to continue\n`
          : `WASD move   Space jump   click shoot   N noclip\n`) +
        `${lockHint}`;
    } else {
      this._hud.textContent =
        `QuakeJS — demo room (fallback)\n` +
        `FPS ${this._fps.toFixed(0)}\n` +
        `${lockHint}`;
    }
  }
}
