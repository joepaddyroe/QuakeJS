/**
 * Client lightstyles (cl_lightstyle / R_AnimateLight).
 * 'a' = dark … 'm' = normal … 'z' = double bright.
 */

export const MAX_LIGHTSTYLES = 64;

export class LightStyles {
  constructor() {
    /** @type {{ map: string, length: number }[]} */
    this.styles = [];
    /** d_lightstylevalue — 8.8 scale (256 ≈ identity for empty) */
    this.values = new Int32Array(MAX_LIGHTSTYLES);
    for (let i = 0; i < MAX_LIGHTSTYLES; i++) {
      this.styles.push({ map: '', length: 0 });
      this.values[i] = 256;
    }
  }

  clear() {
    for (let i = 0; i < MAX_LIGHTSTYLES; i++) {
      this.styles[i].map = '';
      this.styles[i].length = 0;
      this.values[i] = 256;
    }
  }

  /**
   * PF_lightstyle / svc_lightstyle
   * @param {number} index
   * @param {string} map
   */
  set(index, map) {
    if (index < 0 || index >= MAX_LIGHTSTYLES) return;
    const s = map || '';
    this.styles[index].map = s;
    this.styles[index].length = s.length;
  }

  /**
   * R_AnimateLight — update values from cl.time.
   * @param {number} time seconds
   */
  animate(time) {
    const i = (time * 10) | 0;
    for (let j = 0; j < MAX_LIGHTSTYLES; j++) {
      const ls = this.styles[j];
      if (!ls.length) {
        this.values[j] = 256;
        continue;
      }
      let k = ls.map.charCodeAt(i % ls.length) - 97; // 'a'
      if (k < 0) k = 0;
      this.values[j] = k * 22;
    }
  }
}
