/**
 * WebGPU sprite draw — R_DrawSpriteModel subset (VP_PARALLEL + ORIENTED).
 */

import { SpriteModel, SPR_ORIENTED } from './models/SpriteModel.js';
import { angleVectors } from '../math/QuakeMath.js';
import {
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
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
  return vec4f(c.rgb, 1.0);
}
`;

const MAT4_BYTES = 64;
const VERT_FLOATS = 5; // xyz uv
const QUAD_VERTS = 6;

/**
 * @typedef {{
 *   model: string,
 *   origin: Float32Array,
 *   angles: Float32Array,
 *   frame: number,
 * }} SpriteDrawEnt
 */

export class SpriteRenderer {
  /**
   * @param {GPUDevice} device
   * @param {GPUTextureFormat} format
   */
  constructor(device, format) {
    this._device = device;
    this._format = format;
    /** @type {GPURenderPipeline|null} */
    this._pipeline = null;
    /** @type {GPUBindGroupLayout|null} */
    this._bindGroupLayout = null;
    /** @type {GPUSampler|null} */
    this._sampler = null;
    /** @type {GPUBuffer|null} */
    this._uniform = null;
    /** @type {GPUBuffer|null} */
    this._vbo = null;
    this._vboCapacity = 0;
    /** @type {import('../fs/FileSystem.js').FileSystem|null} */
    this._fs = null;
    /** @type {Uint8Array|null} */
    this._palette = null;
    /**
     * @type {Map<string, {
     *   model: SpriteModel,
     *   frames: Map<string, { texture: GPUTexture, bindGroup: GPUBindGroup }>,
     * }>}
     */
    this._cache = new Map();
    /** QW-style explosion sprites (CL_AllocExplosion) */
    /** @type {{ origin: Float32Array, start: number }[]} */
    this._explosions = [];
    this._time = 0;
  }

  initPipeline() {
    const device = this._device;
    const module = device.createShaderModule({ code: WGSL });
    this._sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
    });
    this._uniform = device.createBuffer({
      size: MAT4_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
    });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [this._bindGroupLayout],
    });
    this._pipeline = device.createRenderPipeline({
      layout,
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
      for (const fr of entry.frames.values()) fr.texture.destroy();
    }
    this._cache.clear();
    this._explosions.length = 0;
  }

  /**
   * CL_AllocExplosion — animated s_explod.spr (QW cl_tent).
   * @param {Float32Array|number[]} org
   * @param {number} [time]
   */
  spawnExplosion(org, time = this._time) {
    const MAX = 8;
    /** @type {{ origin: Float32Array, start: number }} */
    const slot = {
      origin: new Float32Array([org[0], org[1], org[2]]),
      start: time,
    };
    if (this._explosions.length < MAX) {
      this._explosions.push(slot);
      return;
    }
    let oldest = 0;
    for (let i = 1; i < this._explosions.length; i++) {
      if (this._explosions[i].start < this._explosions[oldest].start) oldest = i;
    }
    this._explosions[oldest] = slot;
  }

  clear() {
    this._explosions.length = 0;
  }

  /**
   * @param {string} name
   */
  _getModel(name) {
    let entry = this._cache.get(name);
    if (entry) return entry;
    if (!this._fs || !this._palette) return null;
    let data;
    try {
      data = this._fs.load(name);
    } catch {
      console.warn(`[sprite] missing ${name}`);
      return null;
    }
    let model;
    try {
      model = new SpriteModel(data, this._palette, name);
    } catch (err) {
      console.warn(`[sprite] load ${name}`, err);
      return null;
    }
    entry = { model, frames: new Map() };
    this._cache.set(name, entry);
    return entry;
  }

  /**
   * @param {NonNullable<ReturnType<SpriteRenderer['_getModel']>>} entry
   * @param {import('./models/SpriteModel.js').SpriteFrame} frame
   * @param {number} frameKey
   */
  _texForFrame(entry, frame, frameKey) {
    const key = `${frameKey}:${frame.width}x${frame.height}:${frame.left}:${frame.up}`;
    let tex = entry.frames.get(key);
    if (tex) return tex;
    const texture = this._device.createTexture({
      size: [frame.width, frame.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this._device.queue.writeTexture(
      { texture },
      frame.rgba,
      { bytesPerRow: frame.width * 4 },
      [frame.width, frame.height],
    );
    const bindGroup = this._device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._uniform } },
        { binding: 1, resource: this._sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });
    tex = { texture, bindGroup };
    entry.frames.set(key, tex);
    return tex;
  }

  /**
   * @param {number} nSprites
   */
  _ensureVbo(nSprites) {
    const floats = nSprites * QUAD_VERTS * VERT_FLOATS;
    const bytes = Math.max(4, floats * 4);
    if (this._vbo && this._vboCapacity >= bytes) return;
    this._vbo?.destroy();
    this._vbo = this._device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._vboCapacity = bytes;
  }

  /**
   * Camera view axes matching Quake vpn/vright/vup for VP_PARALLEL sprites.
   * @param {{ eye: Float32Array, center: Float32Array, up: Float32Array }} camera
   */
  _viewAxes(camera) {
    const fx = camera.center[0] - camera.eye[0];
    const fy = camera.center[1] - camera.eye[1];
    const fz = camera.center[2] - camera.eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    const forward = [fx / fl, fy / fl, fz / fl];
    const up = camera.up;
    // right = Cross(forward, up) — matches AngleVectors at pitch/yaw 0
    const right = [
      forward[1] * up[2] - forward[2] * up[1],
      forward[2] * up[0] - forward[0] * up[2],
      forward[0] * up[1] - forward[1] * up[0],
    ];
    const rl = Math.hypot(right[0], right[1], right[2]) || 1;
    right[0] /= rl;
    right[1] /= rl;
    right[2] /= rl;
    return { up, right };
  }

  /**
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} colorView
   * @param {GPUTextureView} depthView
   * @param {{ eye: Float32Array, center: Float32Array, up: Float32Array }} camera
   * @param {number} width
   * @param {number} height
   * @param {SpriteDrawEnt[]} ents
   * @param {number} time
   */
  draw(encoder, colorView, depthView, camera, width, height, ents, time) {
    if (!this._pipeline) return;
    this._time = time;

    // Advance / cull explosion sprites (10 fps frame advance)
    const liveExplosions = [];
    for (const ex of this._explosions) {
      const f = 10 * (time - ex.start);
      if (f < 0) continue;
      const entry = this._getModel('progs/s_explod.spr');
      const nframes = entry?.model.frames.length ?? 6;
      if (f >= nframes) continue;
      liveExplosions.push(ex);
    }
    this._explosions = liveExplosions;

    /** @type {SpriteDrawEnt[]} */
    const all = ents.slice();
    for (const ex of this._explosions) {
      all.push({
        model: 'progs/s_explod.spr',
        origin: ex.origin,
        angles: new Float32Array(3),
        frame: (10 * (time - ex.start)) | 0,
      });
    }
    if (!all.length) return;

    const aspect = width / Math.max(1, height);
    const proj = mat4Perspective((90 * Math.PI) / 180, aspect, 1, 8192);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);
    this._device.queue.writeBuffer(this._uniform, 0, viewProj);

    const viewAxes = this._viewAxes(camera);

    /** @type {{ bindGroup: GPUBindGroup, offset: number }[]} */
    const draws = [];
    const verts = new Float32Array(all.length * QUAD_VERTS * VERT_FLOATS);
    let vi = 0;
    let drawCount = 0;

    for (const ent of all) {
      const entry = this._getModel(ent.model);
      if (!entry) continue;
      const frame = entry.model.getFrame(ent.frame, time);
      const tex = this._texForFrame(entry, frame, ent.frame | 0);

      let up;
      let right;
      if (entry.model.type === SPR_ORIENTED) {
        const axes = angleVectors([
          ent.angles[0] || 0,
          ent.angles[1] || 0,
          ent.angles[2] || 0,
        ]);
        up = axes.up;
        right = axes.right;
      } else {
        up = viewAxes.up;
        right = viewAxes.right;
      }

      const ox = ent.origin[0];
      const oy = ent.origin[1];
      const oz = ent.origin[2];
      const { left, right: fr, up: fu, down } = frame;

      const corners = [
        [
          ox + down * up[0] + left * right[0],
          oy + down * up[1] + left * right[1],
          oz + down * up[2] + left * right[2],
          0,
          1,
        ],
        [
          ox + fu * up[0] + left * right[0],
          oy + fu * up[1] + left * right[1],
          oz + fu * up[2] + left * right[2],
          0,
          0,
        ],
        [
          ox + fu * up[0] + fr * right[0],
          oy + fu * up[1] + fr * right[1],
          oz + fu * up[2] + fr * right[2],
          1,
          0,
        ],
        [
          ox + down * up[0] + fr * right[0],
          oy + down * up[1] + fr * right[1],
          oz + down * up[2] + fr * right[2],
          1,
          1,
        ],
      ];
      const tris = [0, 1, 2, 0, 2, 3];
      const firstVert = (vi / VERT_FLOATS) | 0;
      for (const ci of tris) {
        const c = corners[ci];
        verts[vi++] = c[0];
        verts[vi++] = c[1];
        verts[vi++] = c[2];
        verts[vi++] = c[3];
        verts[vi++] = c[4];
      }
      draws.push({ bindGroup: tex.bindGroup, offset: firstVert });
      drawCount++;
    }

    if (!drawCount) return;
    this._ensureVbo(drawCount);
    this._device.queue.writeBuffer(
      this._vbo,
      0,
      verts.subarray(0, drawCount * QUAD_VERTS * VERT_FLOATS),
    );

    for (const d of draws) {
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
      pass.setBindGroup(0, d.bindGroup);
      pass.setVertexBuffer(0, this._vbo);
      pass.draw(QUAD_VERTS, 1, d.offset, 0);
      pass.end();
    }
  }

  destroy() {
    for (const entry of this._cache.values()) {
      for (const fr of entry.frames.values()) fr.texture.destroy();
    }
    this._cache.clear();
    this._uniform?.destroy();
    this._vbo?.destroy();
    this._pipeline = null;
  }
}
