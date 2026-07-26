/**
 * V_SetContentsColor — full-viewport liquid tint (view.c).
 */

import {
  CONTENTS_EMPTY,
  CONTENTS_WATER,
  CONTENTS_SLIME,
  CONTENTS_LAVA,
} from '../server/World.js';

/** @type {Record<number, { r: number, g: number, b: number, a: number }>} */
const SHIFTS = {
  [CONTENTS_LAVA]: { r: 255, g: 80, b: 0, a: 150 },
  [CONTENTS_SLIME]: { r: 0, g: 25, b: 5, a: 150 },
  [CONTENTS_WATER]: { r: 130, g: 80, b: 50, a: 128 },
};

export class ContentsShift {
  /**
   * @param {HTMLElement|null} el
   */
  constructor(el) {
    this._el = el;
  }

  /**
   * @param {number} contents CONTENTS_* (eye leaf)
   */
  setContents(contents) {
    if (!this._el) return;
    const s = SHIFTS[contents];
    if (!s) {
      this._el.style.display = 'none';
      this._el.style.backgroundColor = '';
      return;
    }
    this._el.style.display = 'block';
    this._el.style.backgroundColor = `rgba(${s.r},${s.g},${s.b},${(s.a / 255).toFixed(3)})`;
  }

  clear() {
    this.setContents(CONTENTS_EMPTY);
  }
}
