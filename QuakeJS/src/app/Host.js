/**
 * Host shell — eventually matches host.c (Init / Frame / Shutdown).
 * Phase 2 scaffold: clipped player walk + QuakeC server tick + changelevel.
 */

import { syncCanvasSize } from '../platform/GpuDevice.js';
import { PLAYER_MINS, PLAYER_MAXS } from '../server/PlayerMove.js';
import { angleVectors } from '../math/QuakeMath.js';
import { Cmd } from '../core/Cmd.js';
import { CvarStore } from '../core/Cvar.js';
import { Console } from '../ui/Console.js';
import { registerHostCommands } from '../ui/HostCmds.js';

export class Host {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLElement} deps.hud
   * @param {import('../platform/KeyboardInput.js').KeyboardInput} deps.keyboard
   * @param {import('../platform/PointerLook.js').PointerLook} deps.pointer
   * @param {import('../render/WebGpuRenderer.js').WebGpuRenderer} deps.renderer
   * @param {import('../fs/FileSystem.js').FileSystem} deps.fs
   * @param {import('../ui/StatusBar.js').StatusBar} [deps.statusBar]
   * @param {import('../audio/SoundSystem.js').SoundSystem} [deps.sound]
   * @param {import('../ui/Menu.js').Menu} [deps.menu]
   * @param {import('../ui/ScreenOverlay.js').ScreenOverlay} [deps.overlay]
   * @param {HTMLElement} [deps.consoleRoot]
   */
  constructor({
    canvas,
    hud,
    keyboard,
    pointer,
    renderer,
    fs,
    statusBar = null,
    sound = null,
    menu = null,
    overlay = null,
    consoleRoot = document.body,
  }) {
    this._canvas = canvas;
    this._hud = hud;
    this._keyboard = keyboard;
    this._pointer = pointer;
    this._renderer = renderer;
    this._fs = fs;
    this._statusBar = statusBar;
    this._sound = sound;
    this._menu = menu;
    this._overlay = overlay;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;
    this._noclipWasDown = false;
    this._attackWasDown = false;
    this._mapLoading = false;

    this.cmd = new Cmd();
    this.cvars = new CvarStore();
    this.con = new Console(consoleRoot);

    registerHostCommands({
      cmd: this.cmd,
      cvars: this.cvars,
      con: this.con,
      host: this,
      sound: this._sound,
    });

    this._onKeyDown = (e) => {
      if (e.code === 'Backquote') {
        if (this._menu?.isOpen) this._menu.close();
        const wasOpen = this.con.isOpen;
        this.con.handleKey(e, (line) => this._execConsole(line));
        if (this.con.isOpen && !wasOpen) {
          this._pointer.exitLock();
          this._keyboard._down.clear();
        }
        return;
      }

      if (this.con.isOpen) {
        this.con.handleKey(e, (line) => this._execConsole(line));
        return;
      }

      if (this._menu) {
        if (!this._menu.isOpen && e.code === 'Escape') {
          e.preventDefault();
          this._pointer.exitLock();
          this._keyboard._down.clear();
          this._menu.openMain();
          return;
        }
        if (this._menu.isOpen) {
          this._menu.handleKey(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown, true);

    if (this._sound && this._canvas) {
      const unlock = () => {
        void this._sound.unlock();
      };
      this._canvas.addEventListener('pointerdown', unlock, { once: false });
      window.addEventListener('keydown', unlock, { once: false });
    }

    this.con.print('Ready. Esc = menu, ` = console.\n');
  }

  openMenu() {
    if (!this._menu) return;
    this.con.close();
    this._pointer.exitLock();
    this._keyboard._down.clear();
    this._menu.openMain();
  }

  toggleMenu() {
    if (!this._menu) return;
    if (this.con.isOpen) this.con.close();
    if (!this._menu.isOpen) {
      this._pointer.exitLock();
      this._keyboard._down.clear();
    }
    this._menu.toggle();
  }

  /**
   * @param {string} line
   */
  _execConsole(line) {
    this.cmd.addText(line);
    this.cmd.executeBuffer(
      (args) => this._handleCvarArgs(args),
      (msg) => this.con.print(msg),
    );
  }

  /**
   * @param {string[]} args
   * @returns {boolean}
   */
  _handleCvarArgs(args) {
    if (!args.length) return false;
    const v = this.cvars.find(args[0]);
    if (!v) return false;
    if (args.length === 1) {
      this.con.print(`"${v.name}" is "${v.string}"\n`);
      return true;
    }
    this.cvars.set(v.name, args.slice(1).join(' '));
    this.con.print(`"${v.name}" set to "${v.string}"\n`);
    return true;
  }

  syncPointerFromCamera() {
    const cam = this._renderer.camera;
    if ('yaw' in cam && 'pitch' in cam) {
      this._pointer.yaw = cam.yaw;
      this._pointer.pitch = cam.pitch;
    }
  }

  /**
   * @param {string} mapName short name e.g. e1m1
   * @returns {Promise<void>}
   */
  async changeMap(mapName) {
    const path = `maps/${mapName}.bsp`;
    if (!this._fs.has(path)) {
      this.con.print(`map not found: ${path}\n`);
      console.error(`[host] map not found: ${path}`);
      return;
    }
    if (this._mapLoading) return;
    this._mapLoading = true;
    this.con.print(`[host] loading ${path}\n`);
    console.info(`[host] loading ${path}`);
    try {
      if (this._overlay) await this._overlay.waitForPaint();
      this._menu?.close();
      this._renderer.loadMap(this._fs, path, this._sound);
      this.syncPointerFromCamera();
    } finally {
      this._overlay?.hideLoading();
      this._mapLoading = false;
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
    const server = this._renderer.server;
    const consoleOpen = this.con.isOpen;
    const menuOpen = !!(this._menu && this._menu.isOpen);
    const uiBlocking = consoleOpen || menuOpen;

    if (server?.pendingMap) {
      const map = server.pendingMap;
      server.pendingMap = null;
      void this.changeMap(map);
      return;
    }

    if (this._mapLoading || this._overlay?.isLoading) {
      this._renderer.frame(width, height, 0);
      return;
    }

    const sens = this.cvars.value('sensitivity');
    if (sens > 0) this._pointer.sensitivity = 0.04 * sens;

    const nDown = !uiBlocking && kb.isDown('KeyN');
    if (worldMode && player && nDown && !this._noclipWasDown) {
      player.noclip = !player.noclip;
    }
    this._noclipWasDown = nDown;

    const intermission = !!(server && server.isIntermission());

    if (worldMode && player && !uiBlocking) {
      if (server && this._renderer.collision) {
        this._renderer.collision.brushes = server.getBrushDrawList();
      }

      const attack =
        this._pointer.attack ||
        kb.isDown('ControlLeft') ||
        kb.isDown('ControlRight');
      const jump = kb.isDown('Space');
      const attackPressed = attack && !this._attackWasDown;
      this._attackWasDown = attack;

      if (server) {
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
          down:
            kb.isDown('ControlLeft') ||
            kb.isDown('ControlRight') ||
            kb.isDown('KeyC'),
        });
        this._pointer.yaw = player.yaw;
        this._pointer.pitch = player.pitch;
      }

      if (server) {
        const frameDt = Math.min(dt, 0.1);
        if (!intermission) {
          server.impactTouches(1, player.impactedEdicts);
          server.bumpOpenDoors(1, player.impactedEdicts);
          if (attackPressed) {
            const eye = player.eye();
            server.playerAttack(1, eye, player.pitch, player.yaw);
          }
          server.tickWeaponAnim(1);
        }
        server.physics(frameDt, player);
        if (!intermission) {
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
    } else if (!uiBlocking) {
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
        down:
          kb.isDown('ControlLeft') ||
          kb.isDown('ControlRight') ||
          kb.isDown('KeyC'),
      });
    } else if (worldMode && player && server) {
      const frameDt = Math.min(dt, 0.1);
      if (this._renderer.collision) {
        this._renderer.collision.brushes = server.getBrushDrawList();
      }
      server.physics(frameDt, player);
    }

    this._renderer.frame(width, height, dt);

    if (this._sound && worldMode && player) {
      const eye = player.eye();
      const { forward, right, up } = angleVectors([
        this._pointer.pitch,
        this._pointer.yaw,
        0,
      ]);
      this._sound.update(eye, forward, right, up);
    }

    if (this._menu) this._menu.frame(dt);

    const interInfo = server ? server.getIntermissionInfo() : null;
    if (this._overlay) {
      if (!this._overlay.isLoading) {
        this._overlay.drawIntermission(interInfo);
      }
    }

    if (this._statusBar) {
      const stats =
        worldMode && server && !intermission && !menuOpen && !interInfo?.active
          ? server.getClientStats(1)
          : null;
      this._statusBar.draw(stats);
    }

    this._fpsAccum += dt;
    this._fpsFrames += 1;
    if (this._fpsAccum >= 0.5) {
      this._fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    if (menuOpen) {
      this._hud.textContent = '';
      return;
    }

    if (intermission) {
      this._hud.textContent =
        `Level complete\n` +
        `click / jump to continue`;
      return;
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
        (this._renderer.viewWeapon
          ? `gun ${this._renderer.viewWeapon}\n`
          : '') +
        `\n` +
        (intermission
          ? `Level complete — click / jump to continue\n`
          : `WASD move   Space jump   click shoot   Esc menu   \` console\n`) +
        `${lockHint}`;
    } else {
      this._hud.textContent =
        `QuakeJS — demo room (fallback)\n` +
        `FPS ${this._fps.toFixed(0)}\n` +
        `Esc menu   \` console\n` +
        `${lockHint}`;
    }
  }
}
