/**
 * View frustum + R_CullBox / BoxOnPlaneSide (gl_rmain / mathlib).
 */

/**
 * @typedef {{ normal: Float32Array, dist: number, signbits: number }} FrustumPlane
 */

/**
 * @param {Float32Array|number[]} n
 * @returns {number}
 */
function signbitsForNormal(n) {
  let bits = 0;
  if (n[0] < 0) bits |= 1;
  if (n[1] < 0) bits |= 2;
  if (n[2] < 0) bits |= 4;
  return bits;
}

/**
 * Normalize in place; return length.
 * @param {Float32Array} v
 */
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= len;
  v[1] /= len;
  v[2] /= len;
  return len;
}

/**
 * Build side plane: normalize(forward * sin(half) ± axis * cos(half)).
 * At half=45° this matches Quake's vpn ± vright / vpn ± vup.
 * @param {Float32Array|number[]} forward
 * @param {Float32Array|number[]} axis
 * @param {number} sinHalf
 * @param {number} cosHalf
 * @param {number} sign +1 or -1
 * @returns {Float32Array}
 */
function sideNormal(forward, axis, sinHalf, cosHalf, sign) {
  const n = new Float32Array([
    forward[0] * sinHalf + sign * axis[0] * cosHalf,
    forward[1] * sinHalf + sign * axis[1] * cosHalf,
    forward[2] * sinHalf + sign * axis[2] * cosHalf,
  ]);
  normalize(n);
  return n;
}

/**
 * R_SetFrustum matching mat4Perspective(fovY, aspect, …).
 * Vertical FOV is `fovYDeg`; horizontal FOV widens with aspect
 * (so widescreen does not over-cull the sides).
 *
 * @param {Float32Array|number[]} origin
 * @param {Float32Array|number[]} forward vpn
 * @param {Float32Array|number[]} right
 * @param {Float32Array|number[]} up
 * @param {number} [fovYDeg=90]
 * @param {number} [aspect=1]
 * @returns {FrustumPlane[]}
 */
export function setFrustum(origin, forward, right, up, fovYDeg = 90, aspect = 1) {
  const fovY = Math.max(1, Math.min(179, fovYDeg)) * (Math.PI / 180);
  const halfY = fovY * 0.5;
  // Horizontal half-angle from vertical FOV + aspect (matches perspective matrix)
  const halfX = Math.atan(Math.tan(halfY) * Math.max(aspect, 0.01));
  const sx = Math.sin(halfX);
  const cx = Math.cos(halfX);
  const sy = Math.sin(halfY);
  const cy = Math.cos(halfY);

  const normals = [
    sideNormal(forward, right, sx, cx, 1),
    sideNormal(forward, right, sx, cx, -1),
    sideNormal(forward, up, sy, cy, 1),
    sideNormal(forward, up, sy, cy, -1),
  ];

  /** @type {FrustumPlane[]} */
  const frustum = [];
  for (let i = 0; i < 4; i++) {
    const n = normals[i];
    const dist = n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2];
    frustum.push({
      normal: n,
      dist,
      signbits: signbitsForNormal(n),
    });
  }
  return frustum;
}

/**
 * @deprecated use setFrustum — kept for 90° square aspect callers
 */
export function setFrustum90(origin, forward, right, up) {
  return setFrustum(origin, forward, right, up, 90, 1);
}

/**
 * BoxOnPlaneSide — 1 front, 2 back, 3 straddles.
 * @param {Float32Array|number[]} emins
 * @param {Float32Array|number[]} emaxs
 * @param {FrustumPlane} p
 */
export function boxOnPlaneSide(emins, emaxs, p) {
  const n = p.normal;
  let dist1;
  let dist2;
  switch (p.signbits) {
    case 0:
      dist1 = n[0] * emaxs[0] + n[1] * emaxs[1] + n[2] * emaxs[2];
      dist2 = n[0] * emins[0] + n[1] * emins[1] + n[2] * emins[2];
      break;
    case 1:
      dist1 = n[0] * emins[0] + n[1] * emaxs[1] + n[2] * emaxs[2];
      dist2 = n[0] * emaxs[0] + n[1] * emins[1] + n[2] * emins[2];
      break;
    case 2:
      dist1 = n[0] * emaxs[0] + n[1] * emins[1] + n[2] * emaxs[2];
      dist2 = n[0] * emins[0] + n[1] * emaxs[1] + n[2] * emins[2];
      break;
    case 3:
      dist1 = n[0] * emins[0] + n[1] * emins[1] + n[2] * emaxs[2];
      dist2 = n[0] * emaxs[0] + n[1] * emaxs[1] + n[2] * emins[2];
      break;
    case 4:
      dist1 = n[0] * emaxs[0] + n[1] * emaxs[1] + n[2] * emins[2];
      dist2 = n[0] * emins[0] + n[1] * emins[1] + n[2] * emaxs[2];
      break;
    case 5:
      dist1 = n[0] * emins[0] + n[1] * emaxs[1] + n[2] * emins[2];
      dist2 = n[0] * emaxs[0] + n[1] * emins[1] + n[2] * emaxs[2];
      break;
    case 6:
      dist1 = n[0] * emaxs[0] + n[1] * emins[1] + n[2] * emins[2];
      dist2 = n[0] * emins[0] + n[1] * emaxs[1] + n[2] * emaxs[2];
      break;
    case 7:
      dist1 = n[0] * emins[0] + n[1] * emins[1] + n[2] * emins[2];
      dist2 = n[0] * emaxs[0] + n[1] * emaxs[1] + n[2] * emins[2];
      break;
    default:
      dist1 = dist2 = 0;
      break;
  }
  let sides = 0;
  if (dist1 >= p.dist) sides = 1;
  if (dist2 < p.dist) sides |= 2;
  return sides || 3;
}

/**
 * R_CullBox — true if completely outside frustum.
 * @param {Float32Array|number[]} mins
 * @param {Float32Array|number[]} maxs
 * @param {FrustumPlane[]} frustum
 */
export function cullBox(mins, maxs, frustum) {
  for (let i = 0; i < frustum.length; i++) {
    if (boxOnPlaneSide(mins, maxs, frustum[i]) === 2) return true;
  }
  return false;
}
