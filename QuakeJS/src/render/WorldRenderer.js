/**
 * WebGPU brush world draw (GLQuake-shaped).
 * PVS-culled solids (texture × lightmap) + sky layers + turb water.
 */

import { mat4LookAt, mat4Multiply, mat4Perspective, mat4Translate } from '../math/Mat4.js';

const BLOCK_WIDTH = 128;
const BLOCK_HEIGHT = 128;
const MAX_LIGHTMAPS = 64;
const LIGHTSTYLE_SCALE = 264;

const SOLID_WGSL = /* wgsl */ `
struct Uniforms { viewProj : mat4x4f, };
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

@vertex fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = u.viewProj * vec4f(input.position, 1.0);
  out.texCoord = input.texCoord;
  out.lmCoord = input.lmCoord;
  return out;
}
@fragment fn fsMain(input : VSOut) -> @location(0) vec4f {
  let albedo = textureSample(diffuseTex, samp, input.texCoord);
  if (albedo.a < 0.1) { discard; }
  let lm = textureSample(lightmapTex, samp, input.lmCoord).rgb;
  return vec4f(albedo.rgb * lm * 2.0, 1.0);
}
`;

// Sky: EmitSkyPolys — UV from flattened direction to camera
const SKY_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4f,
  origin : vec3f,
  time : f32,
};
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var skyTex : texture_2d<f32>;

struct VSIn { @location(0) position : vec3f, };
struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) worldPos : vec3f,
};

@vertex fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = u.viewProj * vec4f(input.position, 1.0);
  out.worldPos = input.position;
  return out;
}
@fragment fn fsMain(input : VSOut) -> @location(0) vec4f {
  var dir = input.worldPos - u.origin;
  dir.z = dir.z * 3.0;
  let len = length(dir);
  let scale = 6.0 * 63.0 / max(len, 0.001);
  var d = dir.xy * scale;
  var speed = u.time;
  // caller sets time already scaled (solid*8 or alpha*16) and wrapped
  let s = (speed + d.x) * (1.0 / 128.0);
  let t = (speed + d.y) * (1.0 / 128.0);
  let c = textureSample(skyTex, samp, vec2f(s, t));
  return vec4f(c.rgb, c.a);
}
`;

// Turb: EmitWaterPolys UV warp
const TURB_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4f,
  time : f32,
  _pad : vec3f,
};
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var diffuseTex : texture_2d<f32>;

struct VSIn {
  @location(0) position : vec3f,
  @location(1) osOt : vec2f,
};
struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) osOt : vec2f,
};

@vertex fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = u.viewProj * vec4f(input.position, 1.0);
  out.osOt = input.osOt;
  return out;
}
@fragment fn fsMain(input : VSOut) -> @location(0) vec4f {
  let os = input.osOt.x;
  let ot = input.osOt.y;
  // EmitWaterPolys: turbsin[(ot*0.125+time)*TURBSCALE & 255] ≈ 8*sin(ot*0.125+time)
  // (TURBSCALE is only for table indexing — do NOT multiply inside sin)
  let s = (os + sin(ot * 0.125 + u.time) * 8.0) * (1.0 / 64.0);
  let t = (ot + sin(os * 0.125 + u.time) * 8.0) * (1.0 / 64.0);
  let c = textureSample(diffuseTex, samp, vec2f(s, t));
  return vec4f(c.rgb, 1.0);
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

/**
 * Split Quake sky miptex (256×128) into solid (right) + alpha (left) 128×128 RGBA.
 * @param {Uint8Array} palette
 * @param {Uint8Array} indexed
 * @param {number} width
 * @param {number} height
 * @returns {{ solid: Uint8Array, alpha: Uint8Array }}
 */
function splitSky(palette, indexed, width, height) {
  const solid = new Uint8Array(128 * 128 * 4);
  const alpha = new Uint8Array(128 * 128 * 4);
  let r = 0;
  let g = 0;
  let b = 0;
  const w = width;
  for (let i = 0; i < 128; i++) {
    for (let j = 0; j < 128; j++) {
      const p = indexed[i * w + j + 128];
      const o = (i * 128 + j) * 4;
      solid[o] = palette[p * 3];
      solid[o + 1] = palette[p * 3 + 1];
      solid[o + 2] = palette[p * 3 + 2];
      solid[o + 3] = 255;
      r += solid[o];
      g += solid[o + 1];
      b += solid[o + 2];
    }
  }
  const ar = (r / (128 * 128)) | 0;
  const ag = (g / (128 * 128)) | 0;
  const ab = (b / (128 * 128)) | 0;
  for (let i = 0; i < 128; i++) {
    for (let j = 0; j < 128; j++) {
      const p = indexed[i * w + j];
      const o = (i * 128 + j) * 4;
      if (p === 0) {
        alpha[o] = ar;
        alpha[o + 1] = ag;
        alpha[o + 2] = ab;
        alpha[o + 3] = 0;
      } else {
        alpha[o] = palette[p * 3];
        alpha[o + 1] = palette[p * 3 + 1];
        alpha[o + 2] = palette[p * 3 + 2];
        alpha[o + 3] = 255;
      }
    }
  }
  return { solid, alpha };
}

class LightmapAllocator {
  constructor() {
    /** @type {Int32Array[]} */
    this.allocated = [];
    for (let i = 0; i < MAX_LIGHTMAPS; i++) this.allocated.push(new Int32Array(BLOCK_WIDTH));
    /** @type {Uint8Array[]} */
    this.pages = [];
  }

  /**
   * @param {number} w
   * @param {number} h
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
      for (let i = 0; i < w; i++) this.allocated[texnum][bestX + i] = best + h;
      while (this.pages.length <= texnum) {
        this.pages.push(new Uint8Array(BLOCK_WIDTH * BLOCK_HEIGHT * 4));
      }
      return { texnum, x: bestX, y: best };
    }
    throw new Error('Lightmap AllocBlock: full');
  }
}

/**
 * @typedef {object} FaceDraw
 * @property {number} firstVert
 * @property {number} vertCount
 * @property {GPUBindGroup} bindGroup
 */

export class WorldRenderer {
  /**
   * @param {GPUDevice} device
   * @param {GPUTextureFormat} presentationFormat
   */
  constructor(device, presentationFormat) {
    this._device = device;
    this._format = presentationFormat;
    /** @type {import('./models/BspModel.js').BspModel|null} */
    this._bsp = null;

    this._solidPipeline = null;
    this._skyPipeline = null;
    this._skyAlphaPipeline = null;
    this._turbPipeline = null;
    this._sampler = null;
    this._solidUniform = null;
    this._skyUniform = null;
    this._turbUniform = null;
    /** Staging mat4s for brush ents — copied into _solidUniform inside the encoder */
    /** @type {GPUBuffer|null} */
    this._brushMatrixStaging = null;
    this._brushMatrixCapacity = 0;
    this._solidLayout = null;
    this._skyLayout = null;
    this._turbLayout = null;

    this._depthTexture = null;
    this._depthView = null;
    this._depthW = 0;
    this._depthH = 0;

    /** @type {GPUBuffer|null} */
    this._solidVbo = null;
    /** @type {FaceDraw[]} */
    this._solidFaces = [];
    /** @type {GPUBuffer|null} */
    this._skyVbo = null;
    /** @type {FaceDraw[]} */
    this._skyFaces = [];
    /** @type {GPUBuffer|null} */
    this._turbVbo = null;
    /** @type {FaceDraw[]} */
    this._turbFaces = [];

    /** @type {GPUTexture[]} */
    this._gpuTextures = [];
    /** @type {GPUTexture[]} */
    this._gpuLightmaps = [];
    this._skySolidTex = null;
    this._skyAlphaTex = null;
    this._skySolidBg = null;
    this._skyAlphaBg = null;

    this._solidOut = [];
    this._skyOut = [];
    this._turbOut = [];

    this.mapName = '';
    this.faceCount = 0;
    this.triCount = 0;
    this.visibleFaces = 0;
    this.viewLeaf = 0;
  }

  initPipeline() {
    const device = this._device;
    this._sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });

    this._solidUniform = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._skyUniform = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._turbUniform = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._solidLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    this._skyLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    this._turbLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });

    const solidMod = device.createShaderModule({ code: SOLID_WGSL });
    this._solidPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._solidLayout] }),
      vertex: {
        module: solidMod,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 28,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
              { shaderLocation: 2, offset: 20, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: solidMod,
        entryPoint: 'fsMain',
        targets: [{ format: this._format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    const skyMod = device.createShaderModule({ code: SKY_WGSL });
    const skyVert = {
      module: skyMod,
      entryPoint: 'vsMain',
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        },
      ],
    };
    this._skyPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._skyLayout] }),
      vertex: skyVert,
      fragment: {
        module: skyMod,
        entryPoint: 'fsMain',
        targets: [{ format: this._format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
    this._skyAlphaPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._skyLayout] }),
      vertex: skyVert,
      fragment: {
        module: skyMod,
        entryPoint: 'fsMain',
        targets: [
          {
            format: this._format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    });

    const turbMod = device.createShaderModule({ code: TURB_WGSL });
    this._turbPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._turbLayout] }),
      vertex: {
        module: turbMod,
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
        module: turbMod,
        entryPoint: 'fsMain',
        targets: [{ format: this._format }],
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
   * @param {import('./models/BspModel.js').BspModel} bsp
   * @param {Uint8Array} palette
   */
  buildFromBsp(bsp, palette) {
    this.destroyMeshes();
    this._bsp = bsp;
    this.mapName = bsp.name;
    const device = this._device;
    if (!bsp.submodels.length) throw new Error('BSP has no submodels');

    const lmAlloc = new LightmapAllocator();

    /** @type {Map<number, GPUTexture>} */
    const texCache = new Map();
    /** @type {Map<string, GPUBindGroup>} */
    const solidBgCache = new Map();
    /** @type {Map<number, GPUBindGroup>} */
    const turbBgCache = new Map();

    const solidFloats = [];
    const skyFloats = [];
    const turbFloats = [];
    /** @type {FaceDraw[]} */
    const solidFaces = [];
    /** @type {FaceDraw[]} */
    const skyFaces = [];
    /** @type {FaceDraw[]} */
    const turbFaces = [];

    /** @type {number[][]} solid face indices per submodel */
    this._subSolidFaces = bsp.submodels.map(() => []);
    /** @type {number[][]} */
    this._subTurbFaces = bsp.submodels.map(() => []);

    // Sky textures
    let skySrc = null;
    for (const t of bsp.textures) {
      if (t.sky && t.pixels && t.width >= 256 && t.height >= 128) {
        skySrc = t;
        break;
      }
    }
    if (skySrc) {
      const { solid, alpha } = splitSky(palette, skySrc.pixels, skySrc.width, skySrc.height);
      this._skySolidTex = this._uploadRgba(solid, 128, 128);
      this._skyAlphaTex = this._uploadRgba(alpha, 128, 128);
      this._skySolidBg = device.createBindGroup({
        layout: this._skyLayout,
        entries: [
          { binding: 0, resource: { buffer: this._skyUniform } },
          { binding: 1, resource: this._sampler },
          { binding: 2, resource: this._skySolidTex.createView() },
        ],
      });
      this._skyAlphaBg = device.createBindGroup({
        layout: this._skyLayout,
        entries: [
          { binding: 0, resource: { buffer: this._skyUniform } },
          { binding: 1, resource: this._sampler },
          { binding: 2, resource: this._skyAlphaTex.createView() },
        ],
      });
    }

    let faces = 0;
    let tris = 0;

    for (let smi = 0; smi < bsp.submodels.length; smi++) {
      const sm = bsp.submodels[smi];
      const first = sm.firstface;
      const last = first + sm.numfaces;

      for (let fi = first; fi < last; fi++) {
        const face = bsp.faces[fi];
        if (face.kind === 'skip' || face.numEdges < 3) continue;
        const ti = bsp.texinfo[face.texinfo];
        const tex = bsp.textures[ti.miptex];
        if (!tex || !tex.pixels) continue;

        const verts = bsp.faceVerts(face);

        if (face.kind === 'solid') {
          const smax = (face.extents[0] >> 4) + 1;
          const tmax = (face.extents[1] >> 4) + 1;
          const block = lmAlloc.alloc(smax, tmax);
          face.lightS = block.x;
          face.lightT = block.y;
          face.lightmapIndex = block.texnum;
          this._fillLightmap(bsp, face, lmAlloc.pages[block.texnum], block.x, block.y, smax, tmax);

          const key = `${ti.miptex}:${face.lightmapIndex}`;
          if (!solidBgCache.has(key)) solidBgCache.set(key, null);

          const firstVert = solidFloats.length / 7;
          for (let i = 1; i < verts.length - 1; i++) {
            this._pushSolid(solidFloats, verts[0], face, ti, tex, block);
            this._pushSolid(solidFloats, verts[i], face, ti, tex, block);
            this._pushSolid(solidFloats, verts[i + 1], face, ti, tex, block);
            tris += 1;
          }
          solidFaces.push({
            firstVert,
            vertCount: (verts.length - 2) * 3,
            bindGroup: null,
            _key: key,
            _miptex: ti.miptex,
            _lm: face.lightmapIndex,
            _face: fi,
          });
          this._subSolidFaces[smi].push(fi);
          faces += 1;
        } else if (face.kind === 'sky') {
          if (!this._skySolidBg || smi !== 0) continue;
          const firstVert = skyFloats.length / 3;
          for (let i = 1; i < verts.length - 1; i++) {
            skyFloats.push(verts[0][0], verts[0][1], verts[0][2]);
            skyFloats.push(verts[i][0], verts[i][1], verts[i][2]);
            skyFloats.push(verts[i + 1][0], verts[i + 1][1], verts[i + 1][2]);
            tris += 1;
          }
          skyFaces.push({
            firstVert,
            vertCount: (verts.length - 2) * 3,
            bindGroup: this._skySolidBg,
            _face: fi,
          });
          faces += 1;
        } else if (face.kind === 'turb') {
          let bg = turbBgCache.get(ti.miptex);
          if (!bg) {
            let gpuTex = texCache.get(ti.miptex);
            if (!gpuTex) {
              gpuTex = this._uploadRgba(
                expandIndexed(palette, tex.pixels, tex.width, tex.height),
                tex.width,
                tex.height,
              );
              texCache.set(ti.miptex, gpuTex);
              this._gpuTextures.push(gpuTex);
            }
            bg = device.createBindGroup({
              layout: this._turbLayout,
              entries: [
                { binding: 0, resource: { buffer: this._turbUniform } },
                { binding: 1, resource: this._sampler },
                { binding: 2, resource: gpuTex.createView() },
              ],
            });
            turbBgCache.set(ti.miptex, bg);
          }
          const firstVert = turbFloats.length / 5;
          for (let i = 1; i < verts.length - 1; i++) {
            this._pushTurb(turbFloats, verts[0], ti);
            this._pushTurb(turbFloats, verts[i], ti);
            this._pushTurb(turbFloats, verts[i + 1], ti);
            tris += 1;
          }
          turbFaces.push({
            firstVert,
            vertCount: (verts.length - 2) * 3,
            bindGroup: bg,
            _face: fi,
          });
          this._subTurbFaces[smi].push(fi);
          faces += 1;
        }
      }
    }

    // Upload lightmaps then fix solid bind groups
    this._gpuLightmaps = lmAlloc.pages.map((page) => this._uploadRgba(page, BLOCK_WIDTH, BLOCK_HEIGHT));
    if (this._gpuLightmaps.length === 0) {
      const page = new Uint8Array(BLOCK_WIDTH * BLOCK_HEIGHT * 4);
      page.fill(255);
      this._gpuLightmaps.push(this._uploadRgba(page, BLOCK_WIDTH, BLOCK_HEIGHT));
    }

    for (const fd of solidFaces) {
      const key = fd._key;
      let bg = solidBgCache.get(key);
      if (!bg) {
        let gpuTex = texCache.get(fd._miptex);
        if (!gpuTex) {
          const tex = bsp.textures[fd._miptex];
          gpuTex = this._uploadRgba(
            expandIndexed(palette, tex.pixels, tex.width, tex.height),
            tex.width,
            tex.height,
          );
          texCache.set(fd._miptex, gpuTex);
          this._gpuTextures.push(gpuTex);
        }
        const lmTex = this._gpuLightmaps[fd._lm] || this._gpuLightmaps[0];
        bg = device.createBindGroup({
          layout: this._solidLayout,
          entries: [
            { binding: 0, resource: { buffer: this._solidUniform } },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: gpuTex.createView() },
            { binding: 3, resource: lmTex.createView() },
          ],
        });
        solidBgCache.set(key, bg);
      }
      fd.bindGroup = bg;
      delete fd._key;
      delete fd._miptex;
      delete fd._lm;
    }

    this._solidVbo = this._createVbo(solidFloats);
    this._skyVbo = this._createVbo(skyFloats);
    this._turbVbo = this._createVbo(turbFloats);
    this._solidFaces = solidFaces;
    this._skyFaces = skyFaces;
    this._turbFaces = turbFaces;

    /** @type {Map<number, FaceDraw>} */
    this._solidByFace = new Map();
    /** @type {Map<number, FaceDraw>} */
    this._skyByFace = new Map();
    /** @type {Map<number, FaceDraw>} */
    this._turbByFace = new Map();

    for (const fd of solidFaces) {
      this._solidByFace.set(fd._face, fd);
      delete fd._face;
    }
    for (const fd of skyFaces) {
      this._skyByFace.set(fd._face, fd);
      delete fd._face;
    }
    for (const fd of turbFaces) {
      this._turbByFace.set(fd._face, fd);
      delete fd._face;
    }

    this.faceCount = faces;
    this.triCount = tris;
    console.info(
      `[world] ${bsp.name}: ${faces} faces, ${tris} tris, solid=${solidFaces.length} sky=${skyFaces.length} turb=${turbFaces.length}, lm=${this._gpuLightmaps.length}, visleafs=${bsp.numVisLeafs}`,
    );
  }

  /**
   * @param {number[]} floats
   */
  _createVbo(floats) {
    const data = new Float32Array(floats.length ? floats : [0]);
    const buf = this._device.createBuffer({
      size: Math.max(4, data.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return buf;
  }

  /**
   * @param {Uint8Array} rgba
   * @param {number} w
   * @param {number} h
   */
  _uploadRgba(rgba, w, h) {
    const tex = this._device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this._device.queue.writeTexture(
      { texture: tex },
      rgba,
      { bytesPerRow: w * 4 },
      { width: w, height: h },
    );
    return tex;
  }

  _fillLightmap(bsp, face, page, lx, ly, smax, tmax) {
    const size = smax * tmax;
    const blocklights = new Uint32Array(size);
    if (bsp.lightdata && face.lightofs !== -1 && face.styles[0] !== 255) {
      const sample = face.lightofs;
      for (let i = 0; i < size; i++) blocklights[i] = bsp.lightdata[sample + i] * LIGHTSTYLE_SCALE;
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

  _pushSolid(out, vert, face, ti, tex, block) {
    let s =
      vert[0] * ti.vecs[0] + vert[1] * ti.vecs[1] + vert[2] * ti.vecs[2] + ti.vecs[3];
    let t =
      vert[0] * ti.vecs[4] + vert[1] * ti.vecs[5] + vert[2] * ti.vecs[6] + ti.vecs[7];
    const texU = s / tex.width;
    const texV = t / tex.height;
    s -= face.texturemins[0];
    s += block.x * 16 + 8;
    t -= face.texturemins[1];
    t += block.y * 16 + 8;
    out.push(vert[0], vert[1], vert[2], texU, texV, s / (BLOCK_WIDTH * 16), t / (BLOCK_HEIGHT * 16));
  }

  _pushTurb(out, vert, ti) {
    // GL_SubdivideSurface: DotProduct xyz only (no texinfo offset)
    const s = vert[0] * ti.vecs[0] + vert[1] * ti.vecs[1] + vert[2] * ti.vecs[2];
    const t = vert[0] * ti.vecs[4] + vert[1] * ti.vecs[5] + vert[2] * ti.vecs[6];
    out.push(vert[0], vert[1], vert[2], s, t);
  }

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
   * @param {number} time  seconds (host realtime)
   * @param {{ submodel: number, origin: Float32Array }[]} [brushEntities]
   */
  draw(encoder, colorView, camera, width, height, time = 0, brushEntities = []) {
    if (!this._solidPipeline || !this._bsp) return;
    this.ensureDepth(width, height);

    const bsp = this._bsp;
    const leaf = bsp.pointInLeaf(camera.eye);
    this.viewLeaf = leaf;
    bsp.markLeaves(leaf);
    bsp.gatherVisibleFaces(camera.eye, this._solidOut, this._skyOut, this._turbOut);
    this.visibleFaces =
      this._solidOut.length + this._skyOut.length + this._turbOut.length;

    const aspect = width / Math.max(height, 1);
    const proj = mat4Perspective((90 * Math.PI) / 180, aspect, 1, 8192);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);

    const solidU = new Float32Array(16);
    solidU.set(viewProj);
    this._device.queue.writeBuffer(this._solidUniform, 0, solidU);

    // Sky uniforms: mat4 + origin.xyz + time
    const skyU = new Float32Array(20);
    skyU.set(viewProj, 0);
    skyU[16] = camera.eye[0];
    skyU[17] = camera.eye[1];
    skyU[18] = camera.eye[2];

    const turbU = new Float32Array(20);
    turbU.set(viewProj, 0);
    turbU[16] = time;

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
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

    // World solids (PVS)
    if (this._solidVbo && this._solidOut.length) {
      pass.setPipeline(this._solidPipeline);
      pass.setVertexBuffer(0, this._solidVbo);
      let lastBg = null;
      for (const fi of this._solidOut) {
        const fd = this._solidByFace.get(fi);
        if (!fd) continue;
        if (fd.bindGroup !== lastBg) {
          pass.setBindGroup(0, fd.bindGroup);
          lastBg = fd.bindGroup;
        }
        pass.draw(fd.vertCount, 1, fd.firstVert, 0);
      }
    }

    // Sky solid layer
    if (this._skyVbo && this._skyOut.length && this._skySolidBg) {
      let speed = (time * 8) % 128;
      skyU[19] = speed;
      this._device.queue.writeBuffer(this._skyUniform, 0, skyU);
      pass.setPipeline(this._skyPipeline);
      pass.setBindGroup(0, this._skySolidBg);
      pass.setVertexBuffer(0, this._skyVbo);
      for (const fi of this._skyOut) {
        const fd = this._skyByFace.get(fi);
        if (!fd) continue;
        pass.draw(fd.vertCount, 1, fd.firstVert, 0);
      }

      speed = (time * 16) % 128;
      skyU[19] = speed;
      this._device.queue.writeBuffer(this._skyUniform, 0, skyU);
      pass.setPipeline(this._skyAlphaPipeline);
      pass.setBindGroup(0, this._skyAlphaBg);
      for (const fi of this._skyOut) {
        const fd = this._skyByFace.get(fi);
        if (!fd) continue;
        pass.draw(fd.vertCount, 1, fd.firstVert, 0);
      }
    }

    // Turb water
    if (this._turbVbo && this._turbOut.length) {
      this._device.queue.writeBuffer(this._turbUniform, 0, turbU);
      pass.setPipeline(this._turbPipeline);
      pass.setVertexBuffer(0, this._turbVbo);
      let lastBg = null;
      for (const fi of this._turbOut) {
        const fd = this._turbByFace.get(fi);
        if (!fd) continue;
        if (fd.bindGroup !== lastBg) {
          pass.setBindGroup(0, fd.bindGroup);
          lastBg = fd.bindGroup;
        }
        pass.draw(fd.vertCount, 1, fd.firstVert, 0);
      }
    }

    pass.end();

    // Brush entities — each needs its own matrix. queue.writeBuffer all land before
    // the CB runs, so we stage matrices and copyBufferToBuffer inside the encoder.
    if (this._solidVbo && brushEntities.length) {
      /** @type {{ be: typeof brushEntities[0], faces: number[] }[]} */
      const draws = [];
      for (const be of brushEntities) {
        const faces = this._subSolidFaces[be.submodel];
        if (!faces || !faces.length) continue;
        draws.push({ be, faces });
      }
      if (draws.length) {
        if (
          !this._brushMatrixStaging ||
          this._brushMatrixCapacity < draws.length
        ) {
          this._brushMatrixStaging?.destroy();
          this._brushMatrixCapacity = Math.max(draws.length, 16);
          this._brushMatrixStaging = this._device.createBuffer({
            size: this._brushMatrixCapacity * 64,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          });
        }
        const blob = new Float32Array(draws.length * 16);
        for (let i = 0; i < draws.length; i++) {
          const be = draws[i].be;
          const model = mat4Translate(be.origin[0], be.origin[1], be.origin[2]);
          blob.set(mat4Multiply(viewProj, model), i * 16);
        }
        this._device.queue.writeBuffer(this._brushMatrixStaging, 0, blob);

        for (let i = 0; i < draws.length; i++) {
          encoder.copyBufferToBuffer(
            this._brushMatrixStaging,
            i * 64,
            this._solidUniform,
            0,
            64,
          );
          const { faces } = draws[i];
          const bpass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: colorView,
                loadOp: 'load',
                storeOp: 'store',
              },
            ],
            depthStencilAttachment: {
              view: this._depthView,
              depthLoadOp: 'load',
              depthStoreOp: 'store',
            },
          });
          bpass.setPipeline(this._solidPipeline);
          bpass.setVertexBuffer(0, this._solidVbo);
          let lastBg = null;
          for (const fi of faces) {
            const fd = this._solidByFace.get(fi);
            if (!fd) continue;
            if (fd.bindGroup !== lastBg) {
              bpass.setBindGroup(0, fd.bindGroup);
              lastBg = fd.bindGroup;
            }
            bpass.draw(fd.vertCount, 1, fd.firstVert, 0);
            this.visibleFaces += 1;
          }
          bpass.end();
        }
      }
    }
  }

  destroyMeshes() {
    this._solidVbo?.destroy();
    this._skyVbo?.destroy();
    this._turbVbo?.destroy();
    this._solidVbo = this._skyVbo = this._turbVbo = null;
    this._solidFaces = [];
    this._skyFaces = [];
    this._turbFaces = [];
    this._solidByFace = new Map();
    this._skyByFace = new Map();
    this._turbByFace = new Map();
    for (const t of this._gpuTextures) t.destroy();
    this._gpuTextures = [];
    for (const t of this._gpuLightmaps) t.destroy();
    this._gpuLightmaps = [];
    this._skySolidTex?.destroy();
    this._skyAlphaTex?.destroy();
    this._skySolidTex = this._skyAlphaTex = null;
    this._skySolidBg = this._skyAlphaBg = null;
    this._bsp = null;
  }

  destroy() {
    this.destroyMeshes();
    this._solidUniform?.destroy();
    this._skyUniform?.destroy();
    this._turbUniform?.destroy();
    this._brushMatrixStaging?.destroy();
    this._depthTexture?.destroy();
  }
}
