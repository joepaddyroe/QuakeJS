/**
 * Renderer facade — BSP world when loaded; demo room fallback otherwise.
 */

import { DemoRoomRenderer } from './DemoRoomRenderer.js';
import { FlyCamera } from './FlyCamera.js';
import { WorldRenderer } from './WorldRenderer.js';
import { AliasRenderer } from './AliasRenderer.js';
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
    this._time = 0;
  }

  /** @returns {FlyCamera|PlayerMove} */
  get camera() {
    return this.mode === 'world' && this.player ? this.player : this._demoCamera;
  }

  init() {
    this._demo.init();
    this._worldRend.initPipeline();
    this._aliasRend.initPipeline();
  }

  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   * @param {string} [mapPath='maps/start.bsp']
   */
  loadMap(fs, mapPath = 'maps/start.bsp') {
    const data = fs.load(mapPath);
    const palette = fs.loadPalette();
    const bsp = new BspModel(data, mapPath);
    this._worldRend.buildFromBsp(bsp, palette);
    this._aliasRend.setFilesystem(fs, palette);
    this.server = new Server(bsp, fs, mapPath);
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
      const brushes = this.server ? this.server.getBrushDrawList() : [];
      const aliases = this.server ? this.server.getAliasDrawList() : [];
      this._worldRend.draw(
        encoder,
        colorView,
        this.player.lookAtArgs(),
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
          this.player.lookAtArgs(),
          width,
          height,
          aliases,
        );
      }
      this.visibleFaces = this._worldRend.visibleFaces;
      this.viewLeaf = this._worldRend.viewLeaf;
      this.aliasCount = aliases.length;
    } else {
      this._demo.draw(encoder, colorView, this._demoCamera.lookAtArgs(), width, height);
    }
    device.queue.submit([encoder.finish()]);
  }

  destroy() {
    this._demo.destroy();
    this._worldRend.destroy();
    this._aliasRend.destroy();
  }
}
