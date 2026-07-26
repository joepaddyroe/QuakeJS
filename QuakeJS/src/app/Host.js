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
import { NetLoop } from '../net/NetLoop.js';
import { WebSocketNet } from '../net/WebSocketNet.js';
import { Client, ca } from '../client/Client.js';
import { CdAudio } from '../audio/CdAudio.js';
import { readConfig, writeConfig } from './ConfigIO.js';
import { saveGame, loadSaveHeader, applySaveToServer } from '../server/SaveGame.js';
import { DemoRecorder, DemoPlayer } from '../client/Demo.js';
import { SizeBuf } from '../net/SizeBuf.js';
import { parseServerMessage } from '../client/ClientParse.js';
import { KeyBindings } from '../input/KeyBindings.js';

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
   * @param {import('../ui/Console.js').Console} [deps.console]
   * @param {import('../audio/CdAudio.js').CdAudio} [deps.cd]
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
    console: consoleUi = null,
    cd = null,
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
    this._cd = cd || new CdAudio();
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;
    this._mapLoading = false;
    this.keys = new KeyBindings();
    /** Console `impulse N` pending for next usercmd */
    this._consoleImpulse = 0;
    this._initialized = false;
    this._shuttingDown = false;
    this._pendingSave = null;
    this.demoRecorder = new DemoRecorder();
    this.demoPlayer = new DemoPlayer();
    this._demoAngles = new Float32Array(3);
    this._demoMsg = new SizeBuf(8192);

    this.cmd = new Cmd();
    this.cvars = new CvarStore();
    this.con = consoleUi || new Console(document.createElement('canvas'));

    this.net = new NetLoop();
    /** @type {import('../net/WebSocketNet.js').WebSocketNet|null} */
    this.remoteNet = null;
    /** @type {'listen'|'client'|null} */
    this.mpRole = null;
    this.client = new Client({
      net: this.net,
      hooks: {
        print: (t) => this.con.print(t),
        stufftext: (t) => {
          this.cmd.addText(t);
          this.cmd.executeBuffer(
            (args) => this._handleCvarArgs(args),
            (msg) => this.con.print(msg),
          );
        },
        centerprint: (t) => this._overlay?.centerPrint(t) ?? this.con.print(`${t}\n`),
        lightstyle: (i, map) => this._renderer.lightStyles.set(i, map),
        tempEntity: (te, pos, extra) =>
          this._renderer.handleTempEntity(te, pos, extra),
        cdtrack: (track, loopTrack) => {
          const t = track | 0;
          if (t <= 0) this._cd.stop();
          else this._cd.play(t, (loopTrack | 0) === t);
        },
        setangle: (pitch, yaw) => {
          this._pointer.pitch = pitch;
          this._pointer.yaw = yaw;
          const player = this._renderer.player;
          if (player) {
            player.pitch = pitch;
            player.yaw = yaw;
          }
        },
      },
    });
    this._renderer.clientWorld = this.client.world;

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
  }

  /**
   * Host_Init stages (filesystem / vid already wired by main.js).
   */
  init() {
    if (this._initialized) return;
    this.con.print('Host_Init: COM / filesystem ready\n');
    this.con.print('Host_Init: Cmd / Cvar / Console\n');
    this.con.print('Host_Init: Menu / Sbar / Overlay\n');
    this.con.print('Host_Init: NET / SV / CL (loopback)\n');
    this.con.print('Host_Init: VID / Draw / R (WebGPU)\n');
    this.con.print('Host_Init: S / IN\n');
    this._cd.init();
    this.con.print('Host_Init: CDAudio stub\n');
    this.execConfigs();
    this._connectLoopback();
    this._initialized = true;
    this.con.print('========QuakeJS Initialized=========\n');
    this.con.print('Ready. Esc = menu, ` = console.\n');
  }

  /**
   * exec config.cfg then autoexec.cfg from localStorage.
   */
  execConfigs() {
    for (const name of ['config.cfg', 'autoexec.cfg']) {
      const text = readConfig(name);
      if (!text) continue;
      this.con.print(`execing ${name}\n`);
      this.cmd.addText(text);
      this.cmd.executeBuffer(
        (args) => this._handleCvarArgs(args),
        (msg) => this.con.print(msg),
      );
    }
  }

  /**
   * Host_WriteConfiguration
   */
  writeConfiguration() {
    const body = this.cvars.writeArchived() + this.keys.writeConfig();
    writeConfig('config.cfg', body);
  }

  /**
   * Sample binds into move / buttons / impulse (and fire one-shot cmds).
   * @param {boolean} uiBlocking
   * @returns {{
   *   forwardmove: number,
   *   sidemove: number,
   *   upmove: number,
   *   attack: boolean,
   *   jump: boolean,
   *   down: boolean,
   *   impulse: number,
   * }}
   */
  _sampleMove(uiBlocking) {
    const kb = this._keyboard;
    const ptr = this._pointer;
    if (!uiBlocking) {
      this.keys.sample(kb, ptr, (cmd) => {
        this.cmd.addText(cmd.endsWith('\n') ? cmd : `${cmd}\n`);
        this.cmd.executeBuffer(
          (args) => this._handleCvarArgs(args),
          (msg) => this.con.print(msg),
        );
      });
    }
    if (uiBlocking) {
      return {
        forwardmove: 0,
        sidemove: 0,
        upmove: 0,
        attack: false,
        jump: false,
        down: false,
        impulse: 0,
      };
    }
    let forwardmove = 0;
    let sidemove = 0;
    let upmove = 0;
    if (this.keys.isDown(kb, ptr, 'forward')) forwardmove += 400;
    if (this.keys.isDown(kb, ptr, 'back')) forwardmove -= 400;
    if (this.keys.isDown(kb, ptr, 'moveleft')) sidemove -= 350;
    if (this.keys.isDown(kb, ptr, 'moveright')) sidemove += 350;
    const jump = this.keys.isDown(kb, ptr, 'jump');
    const down = this.keys.isDown(kb, ptr, 'movedown');
    if (jump) upmove += 200;
    if (down) upmove -= 200;
    const impulse =
      (this.keys.pendingImpulse | 0) || (this._consoleImpulse | 0);
    this._consoleImpulse = 0;
    return {
      forwardmove,
      sidemove,
      upmove,
      attack: this.keys.isDown(kb, ptr, 'attack'),
      jump,
      down,
      impulse,
    };
  }

  /**
   * @param {string} name
   */
  saveGame(name) {
    const server = this._renderer.server;
    if (!server) throw new Error('Not playing a local game.');
    if (server.isIntermission()) throw new Error("Can't save in intermission.");
    const stats = server.getClientStats(1);
    if (stats && stats.health <= 0) {
      throw new Error("Can't savegame with a dead player");
    }
    server.skill = this.cvars.value('skill') | 0;
    if (!saveGame(name, server)) throw new Error("couldn't open.");
  }

  /**
   * @param {string} name
   * @returns {Promise<void>}
   */
  async loadGame(name) {
    const header = loadSaveHeader(name);
    this.cvars.set('skill', header.skill);
    this._pendingSave = header;
    await this.changeMap(header.mapName);
  }

  /**
   * @param {string} name
   */
  startDemoRecord(name) {
    this.demoRecorder.start(name);
  }

  /** @returns {boolean} */
  stopDemoRecord() {
    return this.demoRecorder.stop();
  }

  /**
   * @param {string} name
   */
  playDemo(name) {
    this.demoPlayer.open(name);
    if (this.demoPlayer.cdtrack > 0) {
      this._cd.play(this.demoPlayer.cdtrack, true);
    }
    this.con.print(`Playing demo (freeze sim): ${this.demoPlayer.name}\n`);
  }

  /**
   * Feed one demo message per frame into client parse.
   * @param {number} dt
   */
  _runDemoPlayback(dt) {
    void dt;
    if (!this.demoPlayer.readMessage(this._demoMsg, this._demoAngles)) {
      this.con.print('Demo finished\n');
      this._cd.stop();
      return;
    }
    this._pointer.pitch = this._demoAngles[0];
    this._pointer.yaw = this._demoAngles[1];
    const player = this._renderer.player;
    if (player) {
      player.pitch = this._demoAngles[0];
      player.yaw = this._demoAngles[1];
    }
    parseServerMessage(this._demoMsg, {
      ...this.client.hooks,
      world: this.client.world,
      time: (t) => {
        this.client.mtime = t;
        this.client.world.mtime = t;
      },
    });
  }

  /**
   * Host_Shutdown
   */
  shutdown() {
    if (this._shuttingDown) return;
    this._shuttingDown = true;
    this.con.print('Host_Shutdown\n');
    if (this._initialized) this.writeConfiguration();
    if (this.demoRecorder.recording) this.demoRecorder.stop();
    this.demoPlayer.stop();
    this.client.disconnect();
    this.stopListen();
    this._cd.shutdown();
    window.removeEventListener('keydown', this._onKeyDown, true);
    this._initialized = false;
  }

  /**
   * Connect client ↔ server over NetLoop after a map is loaded.
   * Skipped when acting as a remote MP client (keeps WebSocket).
   */
  _connectLoopback() {
    if (this.mpRole === 'client') return;
    const server = this._renderer.server;
    if (!server) return;
    this.client.disconnect();
    this.net = new NetLoop();
    this.client.net = this.net;
    this.client.connectLocal();
    const sock = this.net.checkNewConnections();
    if (sock) {
      const pose = server.attachNet(this.net, sock);
      const player = this._renderer.player;
      if (pose && player) {
        player.placeAtSpawn(pose.origin, [pose.pitch, pose.yaw, 0]);
        this._pointer.pitch = pose.pitch;
        this._pointer.yaw = pose.yaw;
      }
      // Re-attach listen socket after map change
      if (this.mpRole === 'listen' && this.remoteNet) {
        server.attachRemoteNet(this.remoteNet, this.remoteNet.socket);
      }
    }
    this.client.readPackets();
  }

  /**
   * listen ws://host:port — host side of WebSocket relay (SP loopback kept).
   * @param {string} url
   * @returns {Promise<void>}
   */
  async listen(url) {
    const server = this._renderer.server;
    if (!server) {
      this.con.print('Load a map before listen\n');
      return;
    }
    this.stopListen();
    if (this.mpRole === 'client') {
      this.con.print('disconnect first\n');
      return;
    }
    try {
      this.remoteNet = await WebSocketNet.connect(url, 'server');
      this.mpRole = 'listen';
      server.attachRemoteNet(this.remoteNet, this.remoteNet.socket);
      this.con.print(`listening on ${url}\n`);
    } catch (err) {
      this.remoteNet = null;
      this.mpRole = null;
      this.con.print(
        `listen failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  /**
   * connect ws://host:port — join a listening host via relay.
   * @param {string} url
   * @returns {Promise<void>}
   */
  async connect(url) {
    this.stopListen();
    try {
      // Drop loopback; use WebSocket as the client net
      this.client.disconnect();
      this.remoteNet = await WebSocketNet.connect(url, 'client');
      this.mpRole = 'client';
      this.client.connectRemote(this.remoteNet);
      this.con.print(`connecting to ${url}\n`);
    } catch (err) {
      this.remoteNet = null;
      this.mpRole = null;
      this.con.print(
        `connect failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      this._connectLoopback();
    }
  }

  /** Stop listen / remote client WebSocket. */
  stopListen() {
    const server = this._renderer.server;
    if (server) server.detachRemoteNet();
    if (this.remoteNet) {
      try {
        this.remoteNet.disconnect();
      } catch {
        /* ignore */
      }
      this.remoteNet = null;
    }
    if (this.mpRole === 'listen' || this.mpRole === 'client') {
      this.mpRole = null;
    }
  }

  /**
   * disconnect — leave remote / stop listen; restore loopback if map loaded.
   */
  disconnectMp() {
    const wasClient = this.mpRole === 'client';
    const wasListen = this.mpRole === 'listen';
    const server = this._renderer.server;
    if (server) server.detachRemoteNet();
    if (this.remoteNet) {
      try {
        this.remoteNet.disconnect();
      } catch {
        /* ignore */
      }
      this.remoteNet = null;
    }
    this.mpRole = null;
    if (wasClient) {
      this.client.state = ca.disconnected;
      this.client.socket = null;
      this.con.print('Disconnected\n');
      this._connectLoopback();
    } else if (wasListen) {
      this.con.print('listen stopped\n');
    }
  }

  /**
   * Remote client frame — usercmds to host + parse datagrams; no local SV.
   * @param {number} dt
   * @param {number} width
   * @param {number} height
   * @param {boolean} uiBlocking
   */
  _frameRemoteClient(dt, width, height, uiBlocking) {
    const player = this._renderer.player;
    const worldMode = this._renderer.mode === 'world';

    if (worldMode && player && !uiBlocking) {
      const mv = this._sampleMove(false);
      this.client.sendMove({
        forwardmove: mv.forwardmove,
        sidemove: mv.sidemove,
        upmove: mv.upmove,
        buttons: (mv.attack ? 1 : 0) | (mv.jump ? 2 : 0),
        impulse: mv.impulse,
        angles: [this._pointer.pitch, this._pointer.yaw, 0],
      });
      player.setAngles(this._pointer.pitch, this._pointer.yaw);
      // Prefer host clientdata / entity pose when present
      const ent = this.client.world.entities[1];
      if (ent && (ent.origin[0] || ent.origin[1] || ent.origin[2])) {
        player.origin[0] = ent.origin[0];
        player.origin[1] = ent.origin[1];
        player.origin[2] = ent.origin[2];
        if (ent.angles[0] || ent.angles[1]) {
          player.pitch = ent.angles[0];
          player.yaw = ent.angles[1];
          this._pointer.pitch = player.pitch;
          this._pointer.yaw = player.yaw;
        }
      }
      const punch = this.client.world.punchangle;
      if (punch[0] || punch[1] || punch[2]) player.setPunchangle(punch);
      if (this.client.world.viewheight) {
        player.viewOfsZ = this.client.world.viewheight;
      }
    } else if (!uiBlocking) {
      const cam = this._renderer.camera;
      cam.setAngles(
        (this._pointer.yaw * Math.PI) / 180,
        (this._pointer.pitch * Math.PI) / 180,
      );
    }

    this.client.readPackets();
    this._cd.update();
    this._overlay?.frame(dt);
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
    this.con.frame(dt);
    if (this._statusBar) {
      const st = this.client.world.stats;
      this._statusBar.draw(
        worldMode && !uiBlocking
          ? {
              health: st.health,
              armor: st.armor,
              weapon: st.weapon,
              ammo: st.ammo,
              shells: st.shells,
              nails: st.nails,
              rockets: st.rockets,
              cells: st.cells,
              items: this.client.world.items,
            }
          : null,
      );
    }
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
      const server = this._renderer.server;
      if (server && this._pendingSave) {
        const header = this._pendingSave;
        this._pendingSave = null;
        applySaveToServer(server, header);
        server.skill = header.skill;
      }
      this.syncPointerFromCamera();
      this._connectLoopback();
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
    const demoPlaying = this.demoPlayer.playing;

    if (demoPlaying) {
      this._runDemoPlayback(dt);
      this._renderer.frame(width, height, dt);
      this.con.frame(dt);
      return;
    }

    if (this.mpRole === 'listen' && server) {
      server.checkRemoteConnections();
    }

    // Remote MP client: send moves / parse host datagrams; no local SV authority
    if (this.mpRole === 'client') {
      this._frameRemoteClient(dt, width, height, uiBlocking);
      return;
    }

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

    const intermission = !!(server && server.isIntermission());
    const mv = this._sampleMove(uiBlocking || intermission);
    const attack = mv.attack;
    const jump = mv.jump;

    if (worldMode && player && !uiBlocking) {
      if (server && this._renderer.collision) {
        this._renderer.collision.brushes = server.getBrushDrawList();
      }

      // CL_SendMove → SV_ReadClientMessage (buttons/angles via loopback)
      const { forwardmove, sidemove, upmove, impulse } = mv;
      const buttons = (attack ? 1 : 0) | (jump ? 2 : 0);
      this.client.sendMove({
        forwardmove,
        sidemove,
        upmove,
        buttons,
        impulse,
        angles: [this._pointer.pitch, this._pointer.yaw, 0],
      });
      if (server) server.readClientMessages();

      if (server) {
        const cmdButtons = server.lastCmd.buttons;
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
          viewOfsZ: player.viewOfsZ,
        });
        server.runClientThink(
          1,
          {
            attack: !!(cmdButtons & 1) || attack,
            jump: !!(cmdButtons & 2) || jump,
          },
          frameDt,
        );
        server.applyClientEdict(1, player);
      }

      if (!intermission) {
        player.setAngles(this._pointer.pitch, this._pointer.yaw);
        const lc = server?.lastCmd;
        player.update(dt, {
          forwardmove: lc?.forwardmove ?? forwardmove,
          sidemove: lc?.sidemove ?? sidemove,
          upmove: lc?.upmove ?? upmove,
          jump: !!(lc?.buttons & 2) || jump,
          up: jump,
          down: mv.down,
        });
        this._pointer.yaw = player.yaw;
        this._pointer.pitch = player.pitch;
        // View punch from protocol clientdata (preferred) or edict
        const punch = this.client.world.punchangle;
        if (punch[0] || punch[1] || punch[2]) {
          player.setPunchangle(punch);
        } else if (server) {
          player.setPunchangle(server.getPunchangle(1));
        }
        if (this.client.world.viewheight) {
          player.viewOfsZ = this.client.world.viewheight;
        }
      }

      if (server) {
        const frameDt = Math.min(dt, 0.1);
        if (!intermission) {
          // Sync after PlayerMove so monster checkclient/PVS sees current pose
          server.syncClientEdict(1, {
            origin: player.origin,
            velocity: player.velocity,
            pitch: player.pitch,
            yaw: player.yaw,
            mins: PLAYER_MINS,
            maxs: PLAYER_MAXS,
            onground: player.onground,
            groundEntity: player.groundEntity,
            viewOfsZ: player.viewOfsZ,
          });
          server.impactTouches(1, player.impactedEdicts);
          server.bumpOpenDoors(1, player.impactedEdicts);
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
            viewOfsZ: player.viewOfsZ,
          });
          server.touchTriggers(player.origin, PLAYER_MINS, PLAYER_MAXS, 1);
          const applied = server.applyClientEdict(1, player);
          if (applied.fixangle) {
            this._pointer.yaw = applied.yaw;
            this._pointer.pitch = applied.pitch;
          }
          // W_WeaponFrame / ImpulseCommands / W_Attack (all weapons via QuakeC)
          server.runClientPostThink(1);
        }
      }
    } else if (!uiBlocking) {
      const cam = this._renderer.camera;
      cam.setAngles(
        (this._pointer.yaw * Math.PI) / 180,
        (this._pointer.pitch * Math.PI) / 180,
      );
      cam.update(dt, {
        forward: this.keys.isDown(kb, this._pointer, 'forward'),
        back: this.keys.isDown(kb, this._pointer, 'back'),
        left: this.keys.isDown(kb, this._pointer, 'moveleft'),
        right: this.keys.isDown(kb, this._pointer, 'moveright'),
        up: this.keys.isDown(kb, this._pointer, 'jump'),
        down: this.keys.isDown(kb, this._pointer, 'movedown'),
      });
    } else if (worldMode && player && server) {
      const frameDt = Math.min(dt, 0.1);
      if (this._renderer.collision) {
        this._renderer.collision.brushes = server.getBrushDrawList();
      }
      server.physics(frameDt, player);
    }

    if (server) {
      const frameBytes = server.sendClientMessages();
      if (this.demoRecorder.recording && frameBytes) {
        this.demoRecorder.writeMessage(frameBytes, [
          this._pointer.pitch,
          this._pointer.yaw,
          0,
        ]);
      }
      this.client.readPackets();
    }

    this._cd.update();
    this._overlay?.frame(dt);

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
    this.con.frame(dt);

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
        `vis ${this._renderer.visibleFaces}  leaf ${this._renderer.viewLeaf}  mdl ${this._renderer.aliasCount}  spr ${this._renderer.spriteCount}\n` +
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
