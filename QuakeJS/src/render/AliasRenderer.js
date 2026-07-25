/**
 * WebGPU alias (MDL) entity draw — textured triangles, yaw + origin.
 */

import { AliasModel } from './models/AliasModel.js';
import {
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  mat4RotateZ,
  mat4Translate,
} from '../math/Mat4.js';

const WGSL = /* wgsl */ `
struct Uniforms { viewProj : mat4x4f, };
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex : texture_2d<f32>;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) uv : vec2f,
};
struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var o : VSOut;
  o.clip = u.viewProj * vec4f(input.pos, 1.0);
  o.uv = input.uv;
  return o;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let c = textureSample(tex, samp, input.uv);
  if (c.a < 0.1) { discard; }
  // Flat shade boost (no lightnormals yet)
  return vec4f(c.rgb * 0.9, 1.0);
}
`;

/**
 * @typedef {{ model: string, origin: Float32Array, yaw: number, frame: number }} AliasDrawEnt
 */

export class AliasRenderer {
  /**
   * @param {GPUDevice} device
   * @param {GPUTextureFormat} format
   */
  constructor(device, format) {
    this._device = device;
    this._format = format;
    /** @type {GPURenderPipeline|null} */
    this._pipeline = null;
    /** @type {GPUSampler|null} */
    this._sampler = null;
    /** @type {GPUBuffer|null} */
    this._uniform = null;
    /** @type {import('../fs/FileSystem.js').FileSystem|null} */
    this._fs = null;
    /** @type {Uint8Array|null} */
    this._palette = null;
    /** @type {Map<string, { model: AliasModel, texture: GPUTexture, bindGroup: GPUBindGroup, frameCache: Map<number, { vbo: GPUBuffer, vertCount: number }> }>} */
    this._cache = new Map();
  }

  initPipeline() {
    const device = this._device;
    const module = device.createShaderModule({ code: WGSL });
    this._sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
    });
    this._uniform = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [
          {
            format: this._format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
              },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   * @param {Uint8Array} palette
   */
  setFilesystem(fs, palette) {
    this._fs = fs;
    this._palette = palette;
    for (const entry of this._cache.values()) {
      entry.texture.destroy();
      for (const fr of entry.frameCache.values()) fr.vbo.destroy();
    }
    this._cache.clear();
  }

  /**
   * @param {string} name
   */
  _getEntry(name) {
    let entry = this._cache.get(name);
    if (entry) return entry;
    if (!this._fs || !this._palette || !this._pipeline) return null;
    let data;
    try {
      data = this._fs.load(name);
    } catch {
      return null;
    }
    let model;
    try {
      model = new AliasModel(data, this._palette, name);
    } catch (err) {
      console.warn(`[alias] ${name}`, err);
      return null;
    }

    const texture = this._device.createTexture({
      size: [model.skinWidth, model.skinHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this._device.queue.writeTexture(
      { texture },
      model.skins[0],
      { bytesPerRow: model.skinWidth * 4 },
      [model.skinWidth, model.skinHeight],
    );

    const bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._uniform } },
        { binding: 1, resource: this._sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });

    entry = { model, texture, bindGroup, frameCache: new Map() };
    this._cache.set(name, entry);
    return entry;
  }

  /**
   * @param {{ model: AliasModel, frameCache: Map<number, { vbo: GPUBuffer, vertCount: number }> }} entry
   * @param {number} frame
   */
  _meshForFrame(entry, frame) {
    const fi = Math.max(0, Math.min(entry.model.frames.length - 1, frame | 0));
    let mesh = entry.frameCache.get(fi);
    if (mesh) return mesh;
    const data = entry.model.buildMesh(fi);
    const vbo = this._device.createBuffer({
      size: Math.max(4, data.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    if (data.byteLength) this._device.queue.writeBuffer(vbo, 0, data);
    mesh = { vbo, vertCount: (data.length / 5) | 0 };
    entry.frameCache.set(fi, mesh);
    return mesh;
  }

  /**
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} colorView
   * @param {GPUTextureView} depthView
   * @param {{ eye: Float32Array, center: Float32Array, up: Float32Array }} camera
   * @param {number} width
   * @param {number} height
   * @param {AliasDrawEnt[]} ents
   */
  draw(encoder, colorView, depthView, camera, width, height, ents) {
    if (!this._pipeline || !ents.length) return;

    const aspect = width / Math.max(1, height);
    const proj = mat4Perspective((90 * Math.PI) / 180, aspect, 1, 8192);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);
    const u = new Float32Array(16);

    for (const ent of ents) {
      const entry = this._getEntry(ent.model);
      if (!entry) continue;
      const mesh = this._meshForFrame(entry, ent.frame);
      if (!mesh.vertCount) continue;

      const yaw = (ent.yaw * Math.PI) / 180;
      const model = mat4Multiply(
        mat4Translate(ent.origin[0], ent.origin[1], ent.origin[2]),
        mat4RotateZ(yaw),
      );
      u.set(mat4Multiply(viewProj, model));
      this._device.queue.writeBuffer(this._uniform, 0, u);

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            loadOp: 'load',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(this._pipeline);
      pass.setBindGroup(0, entry.bindGroup);
      pass.setVertexBuffer(0, mesh.vbo);
      pass.draw(mesh.vertCount);
      pass.end();
    }
  }

  destroy() {
    for (const entry of this._cache.values()) {
      entry.texture.destroy();
      for (const fr of entry.frameCache.values()) fr.vbo.destroy();
    }
    this._cache.clear();
    this._uniform?.destroy();
  }
}
