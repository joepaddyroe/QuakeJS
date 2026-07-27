/**
 * WebGPU alias (MDL) entity draw — textured triangles, yaw + origin.
 *
 * Important: do NOT queue.writeBuffer a shared uniform between encoded draws and
 * then submit once — all writes land before the CB runs, so every draw gets the
 * last matrix (enemies stacked on the view weapon / camera). Copy uniforms
 * inside the command encoder instead.
 */

import { AliasModel } from './models/AliasModel.js';
import { angleVectors } from '../math/QuakeMath.js';
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
  return vec4f(c.rgb * 0.9, 1.0);
}
`;

const MAT4_BYTES = 64;

/**
 * @typedef {{
 *   model: string,
 *   origin: Float32Array,
 *   yaw: number,
 *   frame: number,
 *   id?: number|string,
 *   oldframe?: number,
 *   blend?: number,
 * }} AliasDrawEnt
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
    /** @type {GPURenderPipeline|null} */
    this._viewPipeline = null;
    /** @type {GPUBindGroupLayout|null} */
    this._bindGroupLayout = null;
    /** @type {GPUSampler|null} */
    this._sampler = null;
    /** Live uniform read by world-alias shaders */
    /** @type {GPUBuffer|null} */
    this._uniform = null;
    /** Dedicated view-weapon uniform (single draw — no staging race with aliases) */
    /** @type {GPUBuffer|null} */
    this._viewUniform = null;
    /** Staging: one mat4 per world-alias draw, copied into _uniform inside the encoder */
    /** @type {GPUBuffer|null} */
    this._matrixStaging = null;
    this._matrixStagingCapacity = 0;
    /** Scratch VBOs for lerped frames (one per draw slot, resized as needed) */
    /** @type {GPUBuffer[]} */
    this._lerpVbos = [];
    /** @type {Map<string|number, { frame: number, oldframe: number, start: number }>} */
    this._anim = new Map();
    /**
     * Origin/yaw smoothing for STEP monsters (walkmove jumps ~10 Hz).
     * @type {Map<string|number, {
     *   x: number, y: number, z: number, yaw: number, last: number,
     * }>}
     */
    this._move = new Map();
    /** Client/render clock for frame blend */
    this._time = 0;
    /** Pose blend duration (matches typical monster nextthink) */
    this._lerpTime = 0.1;
    /** Exp-smooth time constant for origin/yaw (seconds) */
    this._moveSmoothTau = 0.07;
    /** @type {import('../fs/FileSystem.js').FileSystem|null} */
    this._fs = null;
    /** @type {Uint8Array|null} */
    this._palette = null;
    /** @type {Map<string, { model: AliasModel, texture: GPUTexture, bindGroup: GPUBindGroup, viewBindGroup: GPUBindGroup, frameCache: Map<number, { vbo: GPUBuffer, vertCount: number }> }>} */
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
      size: MAT4_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._viewUniform = device.createBuffer({
      size: MAT4_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const vertex = {
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
    };
    const fragment = {
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
    };
    const primitive = { topology: 'triangle-list', cullMode: 'none' };
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
      vertex,
      fragment,
      primitive,
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
    this._viewPipeline = device.createRenderPipeline({
      layout,
      vertex,
      fragment,
      primitive,
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  /**
   * @param {number} count
   */
  _ensureMatrixStaging(count) {
    if (this._matrixStaging && this._matrixStagingCapacity >= count) return;
    this._matrixStaging?.destroy();
    this._matrixStagingCapacity = Math.max(count, 32);
    this._matrixStaging = this._device.createBuffer({
      size: this._matrixStagingCapacity * MAT4_BYTES,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * @param {GPUCommandEncoder} encoder
   * @param {number} slot
   */
  _copyUniformSlot(encoder, slot) {
    encoder.copyBufferToBuffer(
      this._matrixStaging,
      slot * MAT4_BYTES,
      this._uniform,
      0,
      MAT4_BYTES,
    );
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
    this._anim.clear();
    this._move.clear();
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
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._uniform } },
        { binding: 1, resource: this._sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });
    const viewBindGroup = this._device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._viewUniform } },
        { binding: 1, resource: this._sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });

    entry = { model, texture, bindGroup, viewBindGroup, frameCache: new Map() };
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
   * Resolve pose blend for an entity (tracks previous frame over time).
   * @param {AliasDrawEnt} ent
   * @returns {{ frame0: number, frame1: number, blend: number }}
   */
  _poseBlend(ent) {
    const frame1 = ent.frame | 0;
    if (ent.blend != null && ent.oldframe != null) {
      return {
        frame0: ent.oldframe | 0,
        frame1,
        blend: ent.blend,
      };
    }
    const key = ent.id != null ? ent.id : ent.model;
    let s = this._anim.get(key);
    if (!s) {
      s = { frame: frame1, oldframe: frame1, start: this._time };
      this._anim.set(key, s);
    } else if (frame1 !== s.frame) {
      s.oldframe = s.frame;
      s.frame = frame1;
      s.start = this._time;
    }
    const blend = Math.min(
      1,
      Math.max(0, (this._time - s.start) / this._lerpTime),
    );
    return { frame0: s.oldframe, frame1: s.frame, blend };
  }

  /**
   * Smooth origin/yaw toward server pose (handles walkmove steps + freefall).
   * @param {AliasDrawEnt} ent
   * @returns {{ origin: Float32Array, yaw: number }}
   */
  _smoothMove(ent) {
    const key = ent.id != null ? ent.id : ent.model;
    const ox = ent.origin[0];
    const oy = ent.origin[1];
    const oz = ent.origin[2];
    const yaw = ent.yaw || 0;
    let s = this._move.get(key);
    if (!s) {
      s = { x: ox, y: oy, z: oz, yaw, last: this._time };
      this._move.set(key, s);
      return {
        origin: new Float32Array([ox, oy, oz]),
        yaw,
      };
    }

    const dist = Math.hypot(ox - s.x, oy - s.y, oz - s.z);
    if (dist > 80) {
      // Teleport — snap
      s.x = ox;
      s.y = oy;
      s.z = oz;
      s.yaw = yaw;
      s.last = this._time;
      return {
        origin: new Float32Array([ox, oy, oz]),
        yaw,
      };
    }

    let dt = this._time - s.last;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    s.last = this._time;
    // 1 - e^(-dt/tau): settles in ~3τ, tracks 10 Hz steps without hitching
    const a =
      dt <= 0 ? 1 : 1 - Math.exp(-dt / Math.max(0.001, this._moveSmoothTau));
    s.x += (ox - s.x) * a;
    s.y += (oy - s.y) * a;
    s.z += (oz - s.z) * a;
    let dyaw = yaw - s.yaw;
    if (dyaw > 180) dyaw -= 360;
    else if (dyaw < -180) dyaw += 360;
    s.yaw += dyaw * a;

    return {
      origin: new Float32Array([s.x, s.y, s.z]),
      yaw: s.yaw,
    };
  }

  /**
   * @param {number} slot
   * @param {Float32Array} data
   * @returns {{ vbo: GPUBuffer, vertCount: number }}
   */
  _uploadLerpMesh(slot, data) {
    const bytes = Math.max(4, data.byteLength);
    let vbo = this._lerpVbos[slot];
    if (!vbo || vbo.size < bytes) {
      vbo?.destroy();
      vbo = this._device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this._lerpVbos[slot] = vbo;
    }
    if (data.byteLength) this._device.queue.writeBuffer(vbo, 0, data);
    return { vbo, vertCount: (data.length / 5) | 0 };
  }

  /**
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} colorView
   * @param {GPUTextureView} depthView
   * @param {{ eye: Float32Array, center: Float32Array, up: Float32Array }} camera
   * @param {number} width
   * @param {number} height
   * @param {AliasDrawEnt[]} ents
   * @param {number} [time]
   */
  draw(encoder, colorView, depthView, camera, width, height, ents, time) {
    if (!this._pipeline || !ents.length) return;
    if (time != null) this._time = time;

    const aspect = width / Math.max(1, height);
    const proj = mat4Perspective((90 * Math.PI) / 180, aspect, 1, 8192);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);

    /** @type {{ entry: NonNullable<ReturnType<AliasRenderer['_getEntry']>>, mesh: { vbo: GPUBuffer, vertCount: number }, matrix: Float32Array }[]} */
    const draws = [];
    let lerpSlot = 0;
    for (const ent of ents) {
      const entry = this._getEntry(ent.model);
      if (!entry) continue;
      const pose = this._poseBlend(ent);
      const move = this._smoothMove(ent);
      /** @type {{ vbo: GPUBuffer, vertCount: number }} */
      let mesh;
      if (pose.blend > 0 && pose.blend < 1 && pose.frame0 !== pose.frame1) {
        const data = entry.model.buildMeshLerped(
          pose.frame0,
          pose.frame1,
          pose.blend,
        );
        mesh = this._uploadLerpMesh(lerpSlot++, data);
      } else {
        mesh = this._meshForFrame(entry, pose.frame1);
      }
      if (!mesh.vertCount) continue;
      const yaw = (move.yaw * Math.PI) / 180;
      const model = mat4Multiply(
        mat4Translate(move.origin[0], move.origin[1], move.origin[2]),
        mat4RotateZ(yaw),
      );
      draws.push({
        entry,
        mesh,
        matrix: mat4Multiply(viewProj, model),
      });
    }
    if (!draws.length) return;

    this._ensureMatrixStaging(draws.length);
    const blob = new Float32Array(draws.length * 16);
    for (let i = 0; i < draws.length; i++) blob.set(draws[i].matrix, i * 16);
    this._device.queue.writeBuffer(this._matrixStaging, 0, blob);

    for (let i = 0; i < draws.length; i++) {
      this._copyUniformSlot(encoder, i);
      const { entry, mesh } = draws[i];
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

  /**
   * First-person weapon (R_DrawViewModel / cl.viewent).
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} colorView
   * @param {GPUTextureView} depthView
   * @param {{ eye: Float32Array, center: Float32Array, up: Float32Array }} camera
   * @param {number} width
   * @param {number} height
   * @param {{ model: string, origin: Float32Array, pitch: number, yaw: number, frame: number } | null} gun
   */
  drawViewModel(encoder, colorView, depthView, camera, width, height, gun) {
    if (!this._viewPipeline || !gun || !gun.model) return;

    const entry = this._getEntry(gun.model);
    if (!entry) return;
    const mesh = this._meshForFrame(entry, gun.frame);
    if (!mesh.vertCount) return;

    const aspect = width / Math.max(1, height);
    // Depth-cleared pass (R_DrawViewModel). Near=4 matches WinQuake MYgluPerspective.
    const proj = mat4Perspective((90 * Math.PI) / 180, aspect, 4, 4096);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);

    const { forward, right, up } = angleVectors([gun.pitch, gun.yaw, 0]);
    const o = camera.eye;
    const model = new Float32Array([
      forward[0],
      forward[1],
      forward[2],
      0,
      -right[0],
      -right[1],
      -right[2],
      0,
      up[0],
      up[1],
      up[2],
      0,
      o[0],
      o[1],
      o[2],
      1,
    ]);
    const matrix = mat4Multiply(viewProj, model);
    // Single draw — direct write is fine (nothing else shares _viewUniform this frame).
    this._device.queue.writeBuffer(this._viewUniform, 0, matrix);

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
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this._viewPipeline);
    pass.setBindGroup(0, entry.viewBindGroup);
    pass.setVertexBuffer(0, mesh.vbo);
    pass.draw(mesh.vertCount);
    pass.end();
  }

  destroy() {
    for (const entry of this._cache.values()) {
      entry.texture.destroy();
      for (const fr of entry.frameCache.values()) fr.vbo.destroy();
    }
    this._cache.clear();
    this._anim.clear();
    this._move.clear();
    for (const vbo of this._lerpVbos) vbo.destroy();
    this._lerpVbos.length = 0;
    this._uniform?.destroy();
    this._viewUniform?.destroy();
    this._matrixStaging?.destroy();
  }
}
