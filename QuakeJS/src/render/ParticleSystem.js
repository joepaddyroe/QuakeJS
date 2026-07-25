/**
 * Client particles (r_part.c subset) — R_RunParticleEffect + GL-style tris.
 */

import {
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
} from '../math/Mat4.js';

const MAX_PARTICLES = 2048;
const PT_SLOWGRAV = 0;
const PT_GRAV = 1;
const PT_STATIC = 2;
const PT_EXPLODE = 3;
const PT_EXPLODE2 = 4;

const WGSL = /* wgsl */ `
struct Uniforms { viewProj : mat4x4f, };
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) color : vec3f,
};
struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) color : vec3f,
};

@vertex fn vsMain(input : VSIn) -> VSOut {
  var o : VSOut;
  o.clip = u.viewProj * vec4f(input.pos, 1.0);
  o.color = input.color;
  return o;
}
@fragment fn fsMain(input : VSOut) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`;

/**
 * @typedef {{
 *   org: Float32Array,
 *   vel: Float32Array,
 *   color: number,
 *   die: number,
 *   type: number,
 *   ramp: number,
 *   active: boolean,
 * }} Particle
 */

export class ParticleSystem {
  /**
   * @param {GPUDevice} device
   * @param {GPUTextureFormat} format
   */
  constructor(device, format) {
    this._device = device;
    this._format = format;
    /** @type {GPURenderPipeline|null} */
    this._pipeline = null;
    /** @type {GPUBuffer|null} */
    this._uniform = null;
    /** @type {GPUBuffer|null} */
    this._vbo = null;
    /** @type {GPUBindGroup|null} */
    this._bindGroup = null;
    /** @type {Uint8Array|null} */
    this._palette = null;
    this._time = 0;
    /** @type {Particle[]} */
    this._particles = [];
    /** @type {number[]} */
    this._free = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._particles.push({
        org: new Float32Array(3),
        vel: new Float32Array(3),
        color: 0,
        die: 0,
        type: PT_SLOWGRAV,
        ramp: 0,
        active: false,
      });
      this._free.push(i);
    }
    // 6 floats per vertex (pos3 + color3), 3 verts per particle
    this._cpuVerts = new Float32Array(MAX_PARTICLES * 3 * 6);
  }

  /**
   * @param {Uint8Array} palette RGB 768
   */
  setPalette(palette) {
    this._palette = palette;
  }

  initPipeline() {
    const device = this._device;
    const module = device.createShaderModule({ code: WGSL });
    const bgl = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this._pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: {
        module,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [{ format: this._format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    });
    this._uniform = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._vbo = device.createBuffer({
      size: this._cpuVerts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [{ binding: 0, resource: { buffer: this._uniform } }],
    });
  }

  clear() {
    this._free.length = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._particles[i].active = false;
      this._free.push(i);
    }
    this._time = 0;
  }

  /**
   * @returns {Particle|null}
   */
  _alloc() {
    const i = this._free.pop();
    if (i === undefined) return null;
    const p = this._particles[i];
    p.active = true;
    return p;
  }

  /**
   * R_RunParticleEffect
   * @param {Float32Array|number[]} org
   * @param {Float32Array|number[]} dir
   * @param {number} color
   * @param {number} count
   */
  runEffect(org, dir, color, count) {
    for (let i = 0; i < count; i++) {
      const p = this._alloc();
      if (!p) return;
      if (count === 1024) {
        p.die = this._time + 5;
        p.color = 0x6f;
        p.ramp = Math.random() * 4;
        p.type = i & 1 ? PT_EXPLODE : PT_EXPLODE2;
        p.org[0] = org[0] + (Math.random() * 32 - 16);
        p.org[1] = org[1] + (Math.random() * 32 - 16);
        p.org[2] = org[2] + (Math.random() * 32 - 16);
        p.vel[0] = Math.random() * 512 - 256;
        p.vel[1] = Math.random() * 512 - 256;
        p.vel[2] = Math.random() * 512 - 256;
      } else {
        p.die = this._time + 0.1 * ((Math.random() * 5) | 0);
        p.color = (color & ~7) + ((Math.random() * 8) | 0);
        p.type = PT_SLOWGRAV;
        p.org[0] = org[0] + ((Math.random() * 16) | 0) - 8;
        p.org[1] = org[1] + ((Math.random() * 16) | 0) - 8;
        p.org[2] = org[2] + ((Math.random() * 16) | 0) - 8;
        p.vel[0] = dir[0] * 15;
        p.vel[1] = dir[1] * 15;
        p.vel[2] = dir[2] * 15;
      }
    }
  }

  /**
   * R_ParticleExplosion (rocket-scale burst).
   * @param {Float32Array|number[]} org
   */
  explosion(org) {
    this.runEffect(org, [0, 0, 0], 0, 1024);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    this._time += dt;
    const grav = dt * 800 * 0.05;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this._particles[i];
      if (!p.active) continue;
      if (p.die < this._time) {
        p.active = false;
        this._free.push(i);
        continue;
      }
      p.org[0] += p.vel[0] * dt;
      p.org[1] += p.vel[1] * dt;
      p.org[2] += p.vel[2] * dt;
      if (p.type === PT_SLOWGRAV || p.type === PT_GRAV) {
        p.vel[2] -= grav;
      } else if (p.type === PT_EXPLODE) {
        p.vel[0] += p.vel[0] * dt * 4;
        p.vel[1] += p.vel[1] * dt * 4;
        p.vel[2] += p.vel[2] * dt * 4;
        p.vel[2] -= grav;
      } else if (p.type === PT_EXPLODE2) {
        p.vel[0] -= p.vel[0] * dt * 4;
        p.vel[1] -= p.vel[1] * dt * 4;
        p.vel[2] -= p.vel[2] * dt * 4;
        p.vel[2] -= grav;
      }
    }
  }

  /**
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} colorView
   * @param {GPUTextureView} depthView
   * @param {{ eye: Float32Array, center: Float32Array, up: Float32Array }} camera
   * @param {number} width
   * @param {number} height
   */
  draw(encoder, colorView, depthView, camera, width, height) {
    if (!this._pipeline || !this._vbo || !this._uniform || !this._bindGroup) {
      return;
    }
    if (!this._palette) return;

    const eye = camera.eye;
    const forward = new Float32Array([
      camera.center[0] - eye[0],
      camera.center[1] - eye[1],
      camera.center[2] - eye[2],
    ]);
    const fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
    forward[0] /= fl;
    forward[1] /= fl;
    forward[2] /= fl;

    // GLQuake: VectorScale(vup/vright, 1.5)
    const upIn = camera.up;
    const ul = Math.hypot(upIn[0], upIn[1], upIn[2]) || 1;
    const ux = (upIn[0] / ul) * 1.5;
    const uy = (upIn[1] / ul) * 1.5;
    const uz = (upIn[2] / ul) * 1.5;
    // right ≈ forward × up
    let rx = forward[1] * uz - forward[2] * uy;
    let ry = forward[2] * ux - forward[0] * uz;
    let rz = forward[0] * uy - forward[1] * ux;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx = (rx / rl) * 1.5;
    ry = (ry / rl) * 1.5;
    rz = (rz / rl) * 1.5;

    const verts = this._cpuVerts;
    let vo = 0;
    let triVerts = 0;
    const pal = this._palette;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this._particles[i];
      if (!p.active) continue;
      const scaleDist =
        (p.org[0] - eye[0]) * forward[0] +
        (p.org[1] - eye[1]) * forward[1] +
        (p.org[2] - eye[2]) * forward[2];
      const scale = scaleDist < 20 ? 1 : 1 + scaleDist * 0.004;
      const ci = (p.color & 255) * 3;
      const cr = pal[ci] / 255;
      const cg = pal[ci + 1] / 255;
      const cb = pal[ci + 2] / 255;
      // tri: org, org+up*scale, org+right*scale
      verts[vo++] = p.org[0];
      verts[vo++] = p.org[1];
      verts[vo++] = p.org[2];
      verts[vo++] = cr;
      verts[vo++] = cg;
      verts[vo++] = cb;
      verts[vo++] = p.org[0] + ux * scale;
      verts[vo++] = p.org[1] + uy * scale;
      verts[vo++] = p.org[2] + uz * scale;
      verts[vo++] = cr;
      verts[vo++] = cg;
      verts[vo++] = cb;
      verts[vo++] = p.org[0] + rx * scale;
      verts[vo++] = p.org[1] + ry * scale;
      verts[vo++] = p.org[2] + rz * scale;
      verts[vo++] = cr;
      verts[vo++] = cg;
      verts[vo++] = cb;
      triVerts += 3;
    }

    if (!triVerts) return;

    const aspect = width / Math.max(1, height);
    const proj = mat4Perspective((90 * Math.PI) / 180, aspect, 4, 4096);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);
    this._device.queue.writeBuffer(this._uniform, 0, viewProj);
    this._device.queue.writeBuffer(
      this._vbo,
      0,
      verts.subarray(0, triVerts * 6),
    );

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
    pass.setBindGroup(0, this._bindGroup);
    pass.setVertexBuffer(0, this._vbo);
    pass.draw(triVerts);
    pass.end();
  }

  destroy() {
    this._uniform?.destroy();
    this._vbo?.destroy();
  }
}
