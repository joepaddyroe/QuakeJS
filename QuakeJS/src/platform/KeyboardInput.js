/**
 * Keyboard polling — platform layer only.
 */
export class KeyboardInput {
  constructor() {
    /** @type {Set<string>} */
    this._down = new Set();
    this._onKeyDown = (e) => {
      this._down.add(e.code);
      if (e.code === 'Tab' || e.code.startsWith('Arrow')) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => {
      this._down.delete(e.code);
    };
    this._onBlur = () => {
      this._down.clear();
    };
  }

  /** Attach window listeners. */
  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /** Detach window listeners. */
  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this._down.clear();
  }

  /**
   * @param {string} code KeyboardEvent.code
   * @returns {boolean}
   */
  isDown(code) {
    return this._down.has(code);
  }
}
