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
   */
  loadMap(fs, mapPath = 'maps/start.bsp', sound = null) {
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
    this.server = new Server(bsp, fs, mapPath, sound, this._lightStyles);
    this.server.particles = this._particles;
    this.server.dlights = this._dlights;
    this.server.onTempEntity = (te, pos) => {
      if (te === 3 || te === 4) this._spriteRend.spawnExplosion(pos);
    };
    this._worldRend.invalidateLightmapCache();
    this.collision = this.server.world;
    this.player = new PlayerMove(this.collision);
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
      const brushes = this.server ? this.server.getBrushDrawList() : [];
      const aliases = this.server ? this.server.getAliasDrawList() : [];
      const sprites = this.server ? this.server.getSpriteDrawList() : [];
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
        const gun = this.server ? this.server.getViewWeapon(this.player) : null;
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

  destroy() {
    this._demo.destroy();
    this._worldRend.destroy();
    this._aliasRend.destroy();
    this._spriteRend.destroy();
    this._particles.destroy();
  }
}
