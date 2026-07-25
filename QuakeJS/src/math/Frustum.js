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
 * R_SetFrustum for 90° FOV (vpn ± vright / vpn ± vup).
 * @param {Float32Array|number[]} origin
 * @param {Float32Array|number[]} forward vpn
 * @param {Float32Array|number[]} right
 * @param {Float32Array|number[]} up
 * @returns {FrustumPlane[]}
 */
export function setFrustum90(origin, forward, right, up) {
  /** @type {FrustumPlane[]} */
  const frustum = [];
  const sides = [
    [forward[0] + right[0], forward[1] + right[1], forward[2] + right[2]],
    [forward[0] - right[0], forward[1] - right[1], forward[2] - right[2]],
    [forward[0] + up[0], forward[1] + up[1], forward[2] + up[2]],
    [forward[0] - up[0], forward[1] - up[1], forward[2] - up[2]],
  ];
  for (let i = 0; i < 4; i++) {
    const n = new Float32Array(sides[i]);
    normalize(n);
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
      dist2 = n[0] * emaxs[0] + n[1] * emaxs[1] + n[2] * emaxs[2];
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
