/**
 * TEMP scaffolding — hard-coded box room for WebGPU bring-up.
 * NOT Quake BSP. Replace with WorldRenderer (gl_rsurf path) once PAK/BSP land.
 */

import { mat4LookAt, mat4Multiply, mat4Perspective } from '../math/Mat4.js';

const WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4f,
  lightDir : vec3f,
  _pad0 : f32,
  camPos : vec3f,
  _pad1 : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSIn {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) color : vec3f,
};

struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) normal : vec3f,
  @location(2) color : vec3f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = u.viewProj * vec4f(input.position, 1.0);
  out.worldPos = input.position;
  out.normal = input.normal;
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let n = normalize(input.normal);
  let l = normalize(u.lightDir);
  let ndotl = max(dot(n, l), 0.0);
  let ambient = 0.22;
  let diffuse = ndotl * 0.78;
  // Cheap distance darkening toward room corners
  let toCam = u.camPos - input.worldPos;
  let dist = length(toCam);
  let fog = clamp(1.0 - dist * 0.035, 0.35, 1.0);
  let lit = input.color * (ambient + diffuse) * fog;
  return vec4f(lit, 1.0);
}
`;

/**
 * Push one quad (two triangles) as interleaved pos/normal/color floats.
 * @param {number[]} out
 * @param {number[]} p0
 * @param {number[]} p1
 * @param {number[]} p2
 * @param {number[]} p3
 * @param {number[]} normal
 * @param {number[]} color
 */
function pushQuad(out, p0, p1, p2, p3, normal, color) {
  const verts = [p0, p1, p2, p0, p2, p3];
  for (const p of verts) {
    out.push(p[0], p[1], p[2], normal[0], normal[1], normal[2], color[0], color[1], color[2]);
  }
}

/**
 * Build an inward-facing box centered at origin.
 * @returns {Float32Array}
 */
function buildRoomMesh() {
  const hx = 5;
  const hy = 2.5;
  const hz = 6;
  const out = [];

  const floor = [0.28, 0.26, 0.22];
  const ceiling = [0.18, 0.2, 0.22];
  const wallA = [0.42, 0.38, 0.32];
  const wallB = [0.35, 0.4, 0.38];
  const wallAccent = [0.55, 0.22, 0.14];
  const trim = [0.12, 0.12, 0.14];

  // Floor (y = -hy)
  pushQuad(
    out,
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, -hy, hz],
    [-hx, -hy, hz],
    [0, 1, 0],
    floor,
  );
  // Ceiling (y = +hy)
  pushQuad(
    out,
    [-hx, hy, hz],
    [hx, hy, hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [0, -1, 0],
    ceiling,
  );
  // −Z wall
  pushQuad(
    out,
    [-hx, -hy, -hz],
    [-hx, hy, -hz],
    [hx, hy, -hz],
    [hx, -hy, -hz],
    [0, 0, 1],
    wallA,
  );
  // +Z wall (accent — "exit" feel)
  pushQuad(
    out,
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
    [-hx, -hy, hz],
    [0, 0, -1],
    wallAccent,
  );
  // −X wall
  pushQuad(
    out,
    [-hx, -hy, hz],
    [-hx, hy, hz],
    [-hx, hy, -hz],
    [-hx, -hy, -hz],
    [1, 0, 0],
    wallB,
  );
  // +X wall
  pushQuad(
    out,
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [hx, hy, hz],
    [hx, -hy, hz],
    [-1, 0, 0],
    wallB,
  );

  // Low pedestal in the middle for depth cue
  const px = 0.7;
  const py = -hy + 0.4;
  const pz = 0.7;
  const topY = -hy + 0.8;
  pushQuad(
    out,
    [-px, topY, -pz],
    [px, topY, -pz],
    [px, topY, pz],
    [-px, topY, pz],
    [0, 1, 0],
    trim,
  );
  pushQuad(
    out,
    [-px, -hy, -pz],
    [-px, topY, -pz],
    [px, topY, -pz],
    [px, -hy, -pz],
    [0, 0, 1],
    trim,
  );
  pushQuad(
    out,
    [px, -hy, pz],
    [px, topY, pz],
    [-px, topY, pz],
    [-px, -hy, pz],
    [0, 0, -1],
    trim,
  );
  pushQuad(
    out,
    [-px, -hy, pz],
    [-px, topY, pz],
    [-px, topY, -pz],
    [-px, -hy, -pz],
    [1, 0, 0],
    trim,
  );
  pushQuad(
    out,
    [px, -hy, -pz],
    [px, topY, -pz],
    [px, topY, pz],
    [px, -hy, pz],
    [-1, 0, 0],
    trim,
  );

  return new Float32Array(out);
}

export class DemoRoomRenderer {
  /**
   * @param {GPUDevice} device
   * @param {GPUTextureFormat} presentationFormat
   */
  constructor(device, presentationFormat) {
    this._device = device;
    this._format = presentationFormat;
    this._pipeline = null;
    this._vertexBuffer = null;
    this._vertexCount = 0;
    this._uniformBuffer = null;
    this._bindGroup = null;
    this._depthTexture = null;
    this._depthView = null;
    this._depthW = 0;
    this._depthH = 0;
    this._uniformData = new Float32Array(16 + 4 + 4); // viewProj + lightDir/pad + camPos/pad
  }

  /** Build pipelines and GPU buffers. */
  init() {
    const device = this._device;
    const mesh = buildRoomMesh();
    this._vertexCount = mesh.length / 9;

    this._vertexBuffer = device.createBuffer({
      size: mesh.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this._vertexBuffer.getMappedRange()).set(mesh);
    this._vertexBuffer.unmap();

    this._uniformBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shader = device.createShaderModule({ code: WGSL });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    this._bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this._pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shader,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 9 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x3' },
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
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  ensureDepth(width, height) {
    if (this._depthTexture && this._depthW === width && this._depthH === height) {
      return;
    }
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
    this.ensureDepth(width, height);

    const aspect = width / Math.max(height, 1);
    const proj = mat4Perspective((75 * Math.PI) / 180, aspect, 0.05, 200);
    const view = mat4LookAt(camera.eye, camera.center, camera.up);
    const viewProj = mat4Multiply(proj, view);

    this._uniformData.set(viewProj, 0);
    // Light from upper-front corner
    this._uniformData[16] = 0.35;
    this._uniformData[17] = 0.85;
    this._uniformData[18] = 0.25;
    this._uniformData[19] = 0;
    this._uniformData[20] = camera.eye[0];
    this._uniformData[21] = camera.eye[1];
    this._uniformData[22] = camera.eye[2];
    this._uniformData[23] = 0;
    this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformData);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
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
    pass.setBindGroup(0, this._bindGroup);
    pass.setVertexBuffer(0, this._vertexBuffer);
    pass.draw(this._vertexCount);
    pass.end();
  }

  destroy() {
    this._vertexBuffer?.destroy();
    this._uniformBuffer?.destroy();
    this._depthTexture?.destroy();
    this._pipeline = null;
  }
}
