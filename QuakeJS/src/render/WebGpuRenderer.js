/**
 * Renderer facade — BSP world when loaded; demo room fallback otherwise.
 */

import { DemoRoomRenderer } from './DemoRoomRenderer.js';
import { FlyCamera } from './FlyCamera.js';
import { WorldRenderer } from './WorldRenderer.js';
import { AliasRenderer } from './AliasRenderer.js';
import { SpriteRenderer } from './SpriteRenderer.js';
import { ParticleSystem } from './ParticleSystem.js';
import { LightStyles } from './LightStyles.js';
import { DynamicLights } from './DynamicLights.js';
import { BspModel } from './models/BspModel.js';
import { PlayerMove } from '../server/PlayerMove.js';
import { Server } from '../server/Server.js';
import { World } from '../server/World.js';

export class WebGpuRenderer {
  /**
   * @param {import('../platform/GpuDevice.js').GpuContext} gpu
   */
  constructor(gpu) {
    this._gpu = gpu;
    this._demo = new DemoRoomRenderer(gpu.device, gpu.presentationFormat);
    this._worldRend = new WorldRenderer(gpu.device, gpu.presentationFormat);
    this._aliasRend = new AliasRenderer(gpu.device, gpu.presentationFormat);
    this._spriteRend = new SpriteRenderer(gpu.device, gpu.presentationFormat);
    this._particles = new ParticleSystem(gpu.device, gpu.presentationFormat);
    this._lightStyles = new LightStyles();
    this._dlights = new DynamicLights();
    this._worldRend.setLightStyles(this._lightStyles);
    this._worldRend.setDynamicLights(this._dlights);
    this._demoCamera = new FlyCamera();
    /** @type {PlayerMove|null} */
    this.player = null;
    /** @type {import('../server/World.js').World|null} */
    this.collision = null;
    /** @type {Server|null} */
    this.server = null;
    /** @type {import('../client/ClientWorld.js').ClientWorld|null} */
    this.clientWorld = null;
    /** Demo/remote model precache (overrides server when set) */
    /** @type {string[]|null} */
    this.clientModelPrecache = null;
    /** @type {'demo'|'world'} */
    this.mode = 'demo';
    this.mapName = '';
    this.faceCount = 0;
    this.triCount = 0;
    this.visibleFaces = 0;
    this.viewLeaf = 0;
    this.aliasCount = 0;
    this.spriteCount = 0;
    this.viewWeapon = '';
    this._time = 0;
  }

  /** @returns {ParticleSystem} */
  get particles() {
    return this._particles;
  }

  /** @returns {import('./LightStyles.js').LightStyles} */
  get lightStyles() {
    return this._lightStyles;
  }

  /**
   * ClientParse TE / particle hooks (effects formerly local on Server).
   * @param {number} te
   * @param {Float32Array} pos
   * @param {object} [extra]
   */
  handleTempEntity(te, pos, extra = {}) {
    const TE_SPIKE = 0;
    const TE_SUPERSPIKE = 1;
    const TE_GUNSHOT = 2;
    const TE_EXPLOSION = 3;
    const TE_TAREXPLOSION = 4;

    if (extra.particle) {
      this._particles.runEffect(
        pos,
        extra.dir || [0, 0, 0],
        extra.color | 0,
        extra.count | 0,
      );
      return;
    }
    if (te === TE_EXPLOSION || te === TE_TAREXPLOSION) {
      this._particles.explosion(pos);
      this._dlights.explosion(pos, this.server?.clientTime ?? this._time);
      this._spriteRend.spawnExplosion(pos, this.server?.clientTime ?? this._time);
      if (this.server?.sound) {
        this.server.precacheSound('weapons/r_exp3.wav');
        this.server.sound.startSound(
          -1,
          0,
          'weapons/r_exp3.wav',
          pos,
          255,
          1,
        );
      }
      return;
    }
    if (te === TE_GUNSHOT || te === TE_SPIKE || te === TE_SUPERSPIKE) {
      this._particles.runEffect(
        pos,
        [0, 0, 0],
        0,
        te === TE_GUNSHOT ? 20 : 10,
      );
    }
  }

  /** @returns {FlyCamera|PlayerMove} */
  get camera() {
    return this.mode === 'world' && this.player ? this.player : this._demoCamera;
  }

  init() {
    this._demo.init();
    this._worldRend.initPipeline();
    this._aliasRend.initPipeline();
    this._spriteRend.initPipeline();
    this._particles.initPipeline();
  }

  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   * @param {string} [mapPath='maps/start.bsp']
   * @param {import('../audio/SoundSystem.js').SoundSystem|null} [sound]
   * @param {{ playback?: boolean }} [opts] playback = demo/client-only (no local SV)
   */
  loadMap(fs, mapPath = 'maps/start.bsp', sound = null, opts = {}) {
    if (sound) sound.stopAll();
    this._particles.clear();
    this._spriteRend.clear();
    this._dlights.clear();
    const data = fs.load(mapPath);
    const palette = fs.loadPalette();
    this._particles.setPalette(palette);
    const bsp = new BspModel(data, mapPath);
    this._worldRend.buildFromBsp(bsp, palette);
    this._aliasRend.setFilesystem(fs, palette);
    this._spriteRend.setFilesystem(fs, palette);
    if (opts.playback) {
      // Demo / remote client: world draw only — entity state comes from net messages
      this.server = null;
      this.collision = new World(bsp);
      this.player = new PlayerMove(this.collision);
    } else {
      this.server = new Server(bsp, fs, mapPath, sound, this._lightStyles);
      this.server.particles = this._particles;
      this.server.dlights = this._dlights;
      this.collision = this.server.world;
      this.player = new PlayerMove(this.collision);
    }
    this._worldRend.invalidateLightmapCache();
    this.mode = 'world';
    this.mapName = mapPath;
    this.faceCount = this._worldRend.faceCount;
    this.triCount = this._worldRend.triCount;

    if (bsp.playerStart) {
      this.player.placeAtSpawn(bsp.playerStart.origin, bsp.playerStart.angles);
    } else {
      const m = bsp.submodels[0];
      this.player.placeAtSpawn(
        [
          (m.mins[0] + m.maxs[0]) * 0.5,
          (m.mins[1] + m.maxs[1]) * 0.5,
          (m.mins[2] + m.maxs[2]) * 0.5,
        ],
        [0, 0, 0],
      );
    }
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {number} dt
   */
  frame(width, height, dt) {
    this._time = (this._time || 0) + dt;
    const { device, context } = this._gpu;
    const colorView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
    if (this.mode === 'world' && this.player) {
      if (this.server) this.server.clientTime = this._time;
      this._particles.update(dt);
      const precache =
        this.clientModelPrecache || this.server?.modelPrecache;
      const brushes = this.server
        ? this.server.getBrushDrawList()
        : this.clientWorld && precache
          ? this.clientWorld.getBrushDrawList(precache)
          : [];
      const { aliases, sprites } = this._entityDrawLists();
      const cam = this.player.lookAtArgs();
      this._worldRend.draw(
        encoder,
        colorView,
        cam,
        width,
        height,
        this._time,
        brushes,
      );
      if (this._worldRend._depthView) {
        this._aliasRend.draw(
          encoder,
          colorView,
          this._worldRend._depthView,
          cam,
          width,
          height,
          aliases,
          this._time,
        );
        this._spriteRend.draw(
          encoder,
          colorView,
          this._worldRend._depthView,
          cam,
          width,
          height,
          sprites,
          this._time,
        );
        this._particles.draw(
          encoder,
          colorView,
          this._worldRend._depthView,
          cam,
          width,
          height,
        );
        const gun = this._viewWeapon(this.player);
        this.viewWeapon = gun ? gun.model : '';
        this._aliasRend.drawViewModel(
          encoder,
          colorView,
          this._worldRend._depthView,
          cam,
          width,
          height,
          gun,
        );
      }
      this.visibleFaces = this._worldRend.visibleFaces;
      this.viewLeaf = this._worldRend.viewLeaf;
      this.aliasCount = aliases.length;
      this.spriteCount = sprites.length + this._spriteRend._explosions.length;
    } else {
      this._demo.draw(encoder, colorView, this._demoCamera.lookAtArgs(), width, height);
    }
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Prefer client entity state (protocol) when svc_time has been received;
   * otherwise fall back to server-side lists (pre-connect / first frames).
   * @returns {{
   *   aliases: { model: string, origin: Float32Array, yaw: number, frame: number }[],
   *   sprites: { model: string, origin: Float32Array, angles: Float32Array, frame: number }[],
   * }}
   */
  _entityDrawLists() {
    const precache =
      this.clientModelPrecache || this.server?.modelPrecache;
    const cw = this.clientWorld;
    if (cw && precache && cw.mtime > 0) {
      return {
        aliases: cw.getAliasDrawList(precache, this._time),
        sprites: cw.getSpriteDrawList(precache),
      };
    }
    return {
      aliases: this.server ? this.server.getAliasDrawList() : [],
      sprites: this.server ? this.server.getSpriteDrawList() : [],
    };
  }

  /**
   * View weapon from clientdata weapon modelindex when available.
   * @param {import('../server/PlayerMove.js').PlayerMove} player
   * @returns {{ model: string, origin: Float32Array, pitch: number, yaw: number, frame: number } | null}
   */
  _viewWeapon(player) {
    const cw = this.clientWorld;
    const precache =
      this.clientModelPrecache || this.server?.modelPrecache;
    if (cw && precache && cw.mtime > 0) {
      if ((cw.stats.health | 0) <= 0) return null;
      const mi = cw.stats.weaponmodel | 0;
      const model = mi > 0 && mi < precache.length ? precache[mi] : '';
      if (model && model.endsWith('.mdl')) {
        return {
          model,
          origin: new Float32Array([
            player.origin[0],
            player.origin[1],
            player._smoothZ + player.viewOfsZ + 2,
          ]),
          pitch: player.pitch,
          yaw: player.yaw,
          frame: cw.stats.weaponframe | 0,
        };
      }
    }
    return this.server ? this.server.getViewWeapon(player) : null;
  }

  destroy() {
    this._demo.destroy();
    this._worldRend.destroy();
    this._aliasRend.destroy();
    this._spriteRend.destroy();
    this._particles.destroy();
  }
}
