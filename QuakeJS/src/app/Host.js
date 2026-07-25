/**
 * Host shell — eventually matches host.c (Init / Frame / Shutdown).
 * Phase 2 scaffold: clipped player walk + QuakeC server tick.
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
   */
  constructor({ canvas, hud, keyboard, pointer, renderer }) {
    this._canvas = canvas;
    this._hud = hud;
    this._keyboard = keyboard;
    this._pointer = pointer;
    this._renderer = renderer;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;
    this._noclipWasDown = false;
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
   * @param {number} dt seconds
   */
  frame(dt) {
    const { width, height } = syncCanvasSize(this._canvas);
    const worldMode = this._renderer.mode === 'world';
    const player = this._renderer.player;
    const kb = this._keyboard;

    // Toggle noclip with N
    const nDown = kb.isDown('KeyN');
    if (worldMode && player && nDown && !this._noclipWasDown) {
      player.noclip = !player.noclip;
    }
    this._noclipWasDown = nDown;

    if (worldMode && player) {
      const server = this._renderer.server;
      // Clip against doors/walls/bossgates (world hull alone has holes under brush floors)
      if (server && this._renderer.collision) {
        this._renderer.collision.brushes = server.getBrushDrawList();
      }

      player.setAngles(this._pointer.pitch, this._pointer.yaw);
      player.update(dt, {
        forward: kb.isDown('KeyW') || kb.isDown('ArrowUp'),
        back: kb.isDown('KeyS') || kb.isDown('ArrowDown'),
        left: kb.isDown('KeyA') || kb.isDown('ArrowLeft'),
        right: kb.isDown('KeyD') || kb.isDown('ArrowRight'),
        jump: kb.isDown('Space'),
        up: kb.isDown('Space'),
        down: kb.isDown('ControlLeft') || kb.isDown('ControlRight') || kb.isDown('KeyC'),
      });
      this._pointer.yaw = player.yaw;
      this._pointer.pitch = player.pitch;

      if (server) {
        const frameDt = Math.min(dt, 0.1);
        server.physics(frameDt);
        server.syncClientEdict(1, {
          origin: player.origin,
          velocity: player.velocity,
          pitch: player.pitch,
          yaw: player.yaw,
          mins: PLAYER_MINS,
          maxs: PLAYER_MAXS,
          onground: player.onground,
        });
        server.touchTriggers(player.origin, PLAYER_MINS, PLAYER_MAXS, 1);
        const applied = server.applyClientEdict(1, player);
        if (applied.fixangle) {
          this._pointer.yaw = applied.yaw;
          this._pointer.pitch = applied.pitch;
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
      const mode = player.noclip ? 'NOCLIP' : player.onground ? 'walk' : 'air';
      this._hud.textContent =
        `QuakeJS — ${this._renderer.mapName}\n` +
        `FPS ${this._fps.toFixed(0)}   ${width}×${height}\n` +
        `org ${player.origin[0].toFixed(0)} ${player.origin[1].toFixed(0)} ${player.origin[2].toFixed(0)}  [${mode}]\n` +
        `eye ${eye[0].toFixed(0)} ${eye[1].toFixed(0)} ${eye[2].toFixed(0)}\n` +
        `vis ${this._renderer.visibleFaces}  leaf ${this._renderer.viewLeaf}\n` +
        `\n` +
        `WASD move   Space jump   N noclip\n` +
        `QC entities active\n` +
        `${lockHint}`;
    } else {
      this._hud.textContent =
        `QuakeJS — demo room (fallback)\n` +
        `FPS ${this._fps.toFixed(0)}\n` +
        `${lockHint}`;
    }
  }
}
