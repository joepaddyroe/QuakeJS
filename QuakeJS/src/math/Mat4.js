/**
 * Column-major 4×4 matrix helpers (WebGPU / gl-matrix style).
 * Float32Array[16] — not Quake's affine matrix layout; demo-room only.
 */

/**
 * @returns {Float32Array}
 */
export function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/**
 * Perspective projection. FOV in radians. Depth range [zNear, zFar].
 * @param {number} fovY
 * @param {number} aspect
 * @param {number} zNear
 * @param {number} zFar
 * @returns {Float32Array}
 */
export function mat4Perspective(fovY, aspect, zNear, zFar) {
  const f = 1 / Math.tan(fovY * 0.5);
  const rangeInv = 1 / (zNear - zFar);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (zFar + zNear) * rangeInv;
  out[11] = -1;
  out[14] = 2 * zFar * zNear * rangeInv;
  return out;
}

/**
 * Look-at view matrix (right-handed, Y-up — demo room convention).
 * Quake world is Z-up; this helper is temporary scaffolding.
 * @param {Float32Array|number[]} eye
 * @param {Float32Array|number[]} center
 * @param {Float32Array|number[]} up
 * @returns {Float32Array}
 */
export function mat4LookAt(eye, center, up) {
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / len;
  const z1 = zy / len;
  const z2 = zz / len;

  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2) || 1;
  x0 /= len;
  x1 /= len;
  x2 /= len;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  const out = new Float32Array(16);
  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

/**
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {Float32Array}
 */
export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/**
 * Translation matrix (column-major).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {Float32Array}
 */
export function mat4Translate(x, y, z) {
  const out = mat4Identity();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

/**
 * Rotation about Z (Quake yaw), radians.
 * @param {number} yawRad
 * @returns {Float32Array}
 */
export function mat4RotateZ(yawRad) {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  const out = mat4Identity();
  out[0] = c;
  out[1] = s;
  out[4] = -s;
  out[5] = c;
  return out;
}
