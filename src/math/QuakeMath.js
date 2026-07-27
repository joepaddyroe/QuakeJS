/**
 * Quake angle / vector helpers (mathlib.c AngleVectors).
 * Coordinates: X/Y horizontal, Z up. Angles in degrees (pitch, yaw, roll).
 */

/**
 * @param {number[]} angles [pitch, yaw, roll] degrees
 * @returns {{ forward: Float32Array, right: Float32Array, up: Float32Array }}
 */
export function angleVectors(angles) {
  const yaw = (angles[1] * Math.PI * 2) / 360;
  const pitch = (angles[0] * Math.PI * 2) / 360;
  const roll = ((angles[2] || 0) * Math.PI * 2) / 360;

  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);

  const forward = new Float32Array([cp * cy, cp * sy, -sp]);
  const right = new Float32Array([
    -1 * sr * sp * cy + -1 * cr * -sy,
    -1 * sr * sp * sy + -1 * cr * cy,
    -1 * sr * cp,
  ]);
  const up = new Float32Array([
    cr * sp * cy + -sr * -sy,
    cr * sp * sy + -sr * cy,
    cr * cp,
  ]);
  return { forward, right, up };
}

/**
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number}
 */
export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
