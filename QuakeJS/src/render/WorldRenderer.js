/**
 * WebGPU brush world draw (GLQuake-shaped: texture + lightmap multiply).
 * First pass: all worldmodel faces, no PVS. Skips sky/turb.
 */

import { mat4LookAt, mat4Multiply, mat4Perspective } from '../math/Mat4.js';

const BLOCK_WIDTH = 128;
const BLOCK_HEIGHT = 128;
const MAX_LIGHTMAPS = 64;
/** Style scale ≈ 'm' (12*22) — gl_rsurf R_BuildLightMap */
const LIGHTSTYLE_SCALE = 264;

const WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4f,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var diffuseTex : texture_2d<f32>;
@group(0) @binding(3) var lightmapTex : texture_2d<f32>;

struct VSIn {
  @location(0) position : vec3f,
  @location(1) texCoord : vec2f,
  @location(2) lmCoord : vec2f,
};

struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) texCoord : vec2f,
  @location(1) lmCoord : vec2f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = u.viewProj * vec4f(input.position, 1.0);
  out.texCoord = input.texCoord;
  out.lmCoord = input.lmCoord;
  return out;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let albedo = textureSample(diffuseTex, samp, input.texCoord);
  if (albedo.a < 0.1) {
    discard;
  }
  let lm = textureSample(lightmapTex, samp, input.lmCoord).rgb;
  return vec4f(albedo.rgb * lm * 2.0, 1.0);
}
`;

/**
 * @param {Uint8Array} palette
 * @param {Uint8Array} indexed
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function expandIndexed(palette, indexed, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = indexed[i];
    const p = idx * 3;
    const o = i * 4;
    out[o] = palette[p];
    out[o + 1] = palette[p + 1];
    out[o + 2] = palette[p + 2];
    out[o + 3] = idx === 255 ? 0 : 255;
  }
  return out;
}

class LightmapAllocator {
  constructor() {
    /** @type {Int32Array[]} */
    this.allocated = [];
    for (let i = 0; i < MAX_LIGHTMAPS; i++) {
      this.allocated.push(new Int32Array(BLOCK_WIDTH));
    }
    /** @type {Uint8Array[]} */
    this.pages = [];
  }

  /**
   * @param {number} w
   * @param {number} h
   * @returns {{ texnum: number, x: number, y: number }}
   */
  alloc(w, h) {
    for (let texnum = 0; texnum < MAX_LIGHTMAPS; texnum++) {
      let best = BLOCK_HEIGHT;
      let bestX = 0;
      let found = false;
      for (let i = 0; i < BLOCK_WIDTH - w; i++) {
        let best2 = 0;
        let j = 0;
        for (; j < w; j++) {
          if (this.allocated[texnum][i + j] >= best) break;
          if (this.allocated[texnum][i + j] > best2) best2 = this.allocated[texnum][i + j];
        }
        if (j === w) {
          bestX = i;
          best = best2;
          found = true;
        }
      }
      if (!found || best + h > BLOCK_HEIGHT) continue;
      for (let i = 0; i < w; i++) {
        this.allocated[texnum][bestX + i] = best + h;
      }
      while (this.pages.length <= texnum) {
        this.pages.push(new Uint8Array(BLOCK_WIDTH * BLOCK_HEIGHT * 4));
      }
      return { texnum, x: bestX, y: best };
    }
    throw new Error('Lightmap AllocBlock: full');
  }
}

export class WorldRenderer {
  /**
   * @param {GPUDevice} device
   * @param {GPUTextureFormat} presentationFormat
   */
  constructor(device, presentationFormat) {
    this._device = device;
    this._format = presentationFormat;
    this._pipeline = null;
    this._sampler = null;
    this._uniformBuffer = null;
    this._bindGroupLayout = null;
    this._depthTexture = null;
    this._depthView = null;
    this._depthW = 0;
    this._depthH = 0;
    /** @type {{ vertexBuffer: GPUBuffer, count: number, bindGroup: GPUBindGroup }[]} */
    this._batches = [];
    /** @type {GPUTexture[]} */
    this._gpuTextures = [];
    /** @type {GPUTexture[]} */
    this._gpuLightmaps = [];
    this._uniformData = new Float32Array(16);
    this.mapName = '';
    this.faceCount = 0;
    this.triCount = 0;
  }

  initPipeline() {
    const device = this._device;
    const shader = device.createShaderModule({ code: WGSL });
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
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
    });

    this._uniformBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });

    this._pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this._bindGroupLayout],
      }),
      vertex: {
        module: shader,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 7 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
              { shaderLocation: 2, offset: 20, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fsMain',
        targets: [{ format: this._format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'cw',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  /**
   * @param {import('./models/BspModel.js').BspModel} bsp
   * @param {Uint8Array} palette
   */
  buildFromBsp(bsp, palette) {
    this.destroyMeshes();
    this.mapName = bsp.name;
    const device = this._device;
    const world = bsp.submodels[0];
    if (!world) throw new Error('BSP has no world submodel');

    const lmAlloc = new LightmapAllocator();
    const first = world.firstface;
    const last = first + world.numfaces;

    /** @type {Map<string, { miptex: number, lm: number, floats: number[] }>} */
    const keyed = new Map();
    let faces = 0;
    let tris = 0;

    for (let fi = first; fi < last; fi++) {
      const face = bsp.faces[fi];
      if (face.skip || face.numEdges < 3) continue;
      const ti = bsp.texinfo[face.texinfo];
      const tex = bsp.textures[ti.miptex];
      if (!tex || !tex.pixels) continue;

      const smax = (face.extents[0] >> 4) + 1;
      const tmax = (face.extents[1] >> 4) + 1;
      const block = lmAlloc.alloc(smax, tmax);
      face.lightS = block.x;
      face.lightT = block.y;
      face.lightmapIndex = block.texnum;

      this._fillLightmap(bsp, face, lmAlloc.pages[block.texnum], block.x, block.y, smax, tmax);

      const key = `${ti.miptex}:${face.lightmapIndex}`;
      let entry = keyed.get(key);
      if (!entry) {
        entry = { miptex: ti.miptex, lm: face.lightmapIndex, floats: [] };
        keyed.set(key, entry);
      }

      const verts = bsp.faceVerts(face);
      for (let i = 1; i < verts.length - 1; i++) {
        this._pushVert(entry.floats, verts[0], face, ti, tex, block);
        this._pushVert(entry.floats, verts[i], face, ti, tex, block);
        this._pushVert(entry.floats, verts[i + 1], face, ti, tex, block);
        tris += 1;
      }
      faces += 1;
    }

    this._gpuLightmaps = lmAlloc.pages.map((page) => {
      const tex = device.createTexture({
        size: { width: BLOCK_WIDTH, height: BLOCK_HEIGHT },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: tex },
        page,
        { bytesPerRow: BLOCK_WIDTH * 4 },
        { width: BLOCK_WIDTH, height: BLOCK_HEIGHT },
      );
      return tex;
    });

    if (this._gpuLightmaps.length === 0) {
      const page = new Uint8Array(BLOCK_WIDTH * BLOCK_HEIGHT * 4);
      page.fill(255);
      const tex = device.createTexture({
        size: { width: BLOCK_WIDTH, height: BLOCK_HEIGHT },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: tex },
        page,
        { bytesPerRow: BLOCK_WIDTH * 4 },
        { width: BLOCK_WIDTH, height: BLOCK_HEIGHT },
      );
      this._gpuLightmaps.push(tex);
    }

    /** @type {Map<number, GPUTexture>} */
    const texCache = new Map();

    for (const entry of keyed.values()) {
      const texInfo = bsp.textures[entry.miptex];
      let gpuTex = texCache.get(entry.miptex);
      if (!gpuTex) {
        const rgba = expandIndexed(palette, texInfo.pixels, texInfo.width, texInfo.height);
        gpuTex = device.createTexture({
          size: { width: texInfo.width, height: texInfo.height },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        device.queue.writeTexture(
          { texture: gpuTex },
          rgba,
          { bytesPerRow: texInfo.width * 4 },
          { width: texInfo.width, height: texInfo.height },
        );
        texCache.set(entry.miptex, gpuTex);
        this._gpuTextures.push(gpuTex);
      }

      const data = new Float32Array(entry.floats);
      const vertexBuffer = device.createBuffer({
        size: Math.max(4, data.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(vertexBuffer.getMappedRange()).set(data);
      vertexBuffer.unmap();

      const lmTex = this._gpuLightmaps[entry.lm] || this._gpuLightmaps[0];
      const bindGroup = device.createBindGroup({
        layout: this._bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this._uniformBuffer } },
          { binding: 1, resource: this._sampler },
          { binding: 2, resource: gpuTex.createView() },
          { binding: 3, resource: lmTex.createView() },
        ],
      });

      this._batches.push({
        vertexBuffer,
        count: data.length / 7,
        bindGroup,
      });
    }

    this.faceCount = faces;
    this.triCount = tris;
    console.info(
      `[world] ${bsp.name}: ${faces} faces, ${tris} tris, ${this._batches.length} batches, ${this._gpuLightmaps.length} lightmaps`,
    );
  }

  /**
   * @param {import('./models/BspModel.js').BspModel} bsp
   * @param {import('./models/BspModel.js').BspFace} face
   * @param {Uint8Array} page
   * @param {number} lx
   * @param {number} ly
   * @param {number} smax
   * @param {number} tmax
   */
  _fillLightmap(bsp, face, page, lx, ly, smax, tmax) {
    const size = smax * tmax;
    const blocklights = new Uint32Array(size);

    if (bsp.lightdata && face.lightofs !== -1 && face.styles[0] !== 255) {
      const sample = face.lightofs;
      const scale = LIGHTSTYLE_SCALE;
      for (let i = 0; i < size; i++) {
        blocklights[i] = bsp.lightdata[sample + i] * scale;
      }
    } else {
      blocklights.fill(255 * LIGHTSTYLE_SCALE);
    }

    for (let t = 0; t < tmax; t++) {
      for (let s = 0; s < smax; s++) {
        let val = blocklights[t * smax + s] >> 7;
        if (val > 255) val = 255;
        const o = ((ly + t) * BLOCK_WIDTH + (lx + s)) * 4;
        page[o] = val;
        page[o + 1] = val;
        page[o + 2] = val;
        page[o + 3] = 255;
      }
    }
  }

  /**
   * @param {number[]} out
   * @param {Float32Array} vert
   * @param {import('./models/BspModel.js').BspFace} face
   * @param {{ vecs: Float32Array }} ti
   * @param {{ width: number, height: number }} tex
   * @param {{ x: number, y: number }} block
   */
  _pushVert(out, vert, face, ti, tex, block) {
    let s =
      vert[0] * ti.vecs[0] +
      vert[1] * ti.vecs[1] +
      vert[2] * ti.vecs[2] +
      ti.vecs[3];
    let t =
      vert[0] * ti.vecs[4] +
      vert[1] * ti.vecs[5] +
      vert[2] * ti.vecs[6] +
      ti.vecs[7];

    const texU = s / tex.width;
    const texV = t / tex.height;

    s -= face.texturemins[0];
    s += block.x * 16 + 8;
    t -= face.texturemins[1];
    t += block.y * 16 + 8;

    out.push(
      vert[0],
      vert[1],
      vert[2],
      texU,
      texV,
      s / (BLOCK_WIDTH * 16),
      t / (BLOCK_HEIGHT * 16),
    );
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  ensureDepth(width, height) {
    if (this._depthTexture && this._depthW === width && this._depthH === height) return;
    this._depthTexture?.destroy();
    this._depthW = width;
    this._depthH = height;
    this._depthTexture = this._device.createTexture({
      size: { width, height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._depthView = this._depthTexture.createView();
  }

  /**
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} colorView
   * @param {{ eye: Float32Array, center: Float32Array, up: Float32Array }} camera
   * @param {number} width
   * @param {number} height
   */
  draw(encoder, colorView, camera, width, height) {
    if (!this._pipeline || this._batches.length === 0) return;
    this.ensureDepth(width, height);

    const aspect = width / Math.max(height, 1);
    const proj = mat4Perspective((90 * Math.PI) / 180, aspect, 1, 8192);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);
    this._uniformData.set(viewProj, 0);
    this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformData);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.05, g: 0.05, b: 0.06, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this._depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this._pipeline);
    for (const batch of this._batches) {
      pass.setBindGroup(0, batch.bindGroup);
      pass.setVertexBuffer(0, batch.vertexBuffer);
      pass.draw(batch.count);
    }
    pass.end();
  }

  destroyMeshes() {
    for (const b of this._batches) b.vertexBuffer.destroy();
    this._batches = [];
    for (const t of this._gpuTextures) t.destroy();
    this._gpuTextures = [];
    for (const t of this._gpuLightmaps) t.destroy();
    this._gpuLightmaps = [];
  }

  destroy() {
    this.destroyMeshes();
    this._uniformBuffer?.destroy();
    this._depthTexture?.destroy();
    this._pipeline = null;
  }
}
