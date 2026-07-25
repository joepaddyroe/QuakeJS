/**
 * Renderer facade — BSP world when loaded; demo room fallback otherwise.
 */

import { DemoRoomRenderer } from './DemoRoomRenderer.js';
import { FlyCamera } from './FlyCamera.js';
import { QuakeCamera } from './QuakeCamera.js';
import { WorldRenderer } from './WorldRenderer.js';
import { BspModel } from './models/BspModel.js';

export class WebGpuRenderer {
  /**
   * @param {import('../platform/GpuDevice.js').GpuContext} gpu
   */
  constructor(gpu) {
    this._gpu = gpu;
    this._demo = new DemoRoomRenderer(gpu.device, gpu.presentationFormat);
    this._world = new WorldRenderer(gpu.device, gpu.presentationFormat);
    this._demoCamera = new FlyCamera();
    this._quakeCamera = new QuakeCamera();
    /** @type {'demo'|'world'} */
    this.mode = 'demo';
    this.mapName = '';
    this.faceCount = 0;
    this.triCount = 0;
  }

  /** @returns {FlyCamera|QuakeCamera} */
  get camera() {
    return this.mode === 'world' ? this._quakeCamera : this._demoCamera;
  }

  init() {
    this._demo.init();
    this._world.initPipeline();
  }

  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   * @param {string} [mapPath='maps/start.bsp']
   */
  loadMap(fs, mapPath = 'maps/start.bsp') {
    const data = fs.load(mapPath);
    const palette = fs.loadPalette();
    const bsp = new BspModel(data, mapPath);
    this._world.buildFromBsp(bsp, palette);
    this.mode = 'world';
    this.mapName = mapPath;
    this.faceCount = this._world.faceCount;
    this.triCount = this._world.triCount;

    if (bsp.playerStart) {
      this._quakeCamera.placeAtSpawn(bsp.playerStart.origin, bsp.playerStart.angles);
    } else {
      const m = bsp.submodels[0];
      this._quakeCamera.position[0] = (m.mins[0] + m.maxs[0]) * 0.5;
      this._quakeCamera.position[1] = (m.mins[1] + m.maxs[1]) * 0.5;
      this._quakeCamera.position[2] = (m.mins[2] + m.maxs[2]) * 0.5;
    }
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {number} _dt
   */
  frame(width, height, _dt) {
    const { device, context } = this._gpu;
    const colorView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
    if (this.mode === 'world') {
      this._world.draw(encoder, colorView, this._quakeCamera.lookAtArgs(), width, height);
    } else {
      this._demo.draw(encoder, colorView, this._demoCamera.lookAtArgs(), width, height);
    }
    device.queue.submit([encoder.finish()]);
  }

  destroy() {
    this._demo.destroy();
    this._world.destroy();
  }
}
