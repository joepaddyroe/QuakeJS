/**
 * Host shell — eventually matches host.c (Init / Frame / Shutdown).
 * Phase 1: BSP world present + Quake fly camera (no clip yet).
 */

import { syncCanvasSize } from '../platform/GpuDevice.js';

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
    const cam = this._renderer.camera;
    const worldMode = this._renderer.mode === 'world';

    if (worldMode) {
      // QuakeCamera: pitch/yaw degrees
      cam.setAngles(this._pointer.pitch, this._pointer.yaw);
    } else {
      // FlyCamera demo: radians stored on pointer historically — convert
      cam.setAngles(
        (this._pointer.yaw * Math.PI) / 180,
        (this._pointer.pitch * Math.PI) / 180,
      );
    }

    const kb = this._keyboard;
    cam.update(dt, {
      forward: kb.isDown('KeyW') || kb.isDown('ArrowUp'),
      back: kb.isDown('KeyS') || kb.isDown('ArrowDown'),
      left: kb.isDown('KeyA') || kb.isDown('ArrowLeft'),
      right: kb.isDown('KeyD') || kb.isDown('ArrowRight'),
      up: kb.isDown('Space'),
      down: kb.isDown('ControlLeft') || kb.isDown('ControlRight') || kb.isDown('KeyC'),
    });

    if (worldMode) {
      this._pointer.yaw = cam.yaw;
      this._pointer.pitch = cam.pitch;
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

    if (worldMode) {
      this._hud.textContent =
        `QuakeJS — ${this._renderer.mapName}\n` +
        `FPS ${this._fps.toFixed(0)}   ${width}×${height}\n` +
        `pos ${cam.position[0].toFixed(0)} ${cam.position[1].toFixed(0)} ${cam.position[2].toFixed(0)}\n` +
        `faces ${this._renderer.faceCount}  tris ${this._renderer.triCount}\n` +
        `\n` +
        `WASD move   Space up   Ctrl/C down\n` +
        `${lockHint}\n` +
        `\n` +
        `No clip / no PVS / no sky-water yet.`;
    } else {
      this._hud.textContent =
        `QuakeJS — demo room (fallback)\n` +
        `FPS ${this._fps.toFixed(0)}\n` +
        `${lockHint}`;
    }
  }
}
