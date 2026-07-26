/**
 * Key bindings (keys.c subset) — bind / unbind + default Quake-style +commands.
 */

/** @type {Record<string, string>} Quake key name → KeyboardEvent.code (or Mouse1) */
const KEY_NAME_TO_CODE = {
  tab: 'Tab',
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  uparrow: 'ArrowUp',
  downarrow: 'ArrowDown',
  leftarrow: 'ArrowLeft',
  rightarrow: 'ArrowRight',
  alt: 'AltLeft',
  ctrl: 'ControlLeft',
  shift: 'ShiftLeft',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
  mouse1: 'Mouse1',
  mouse2: 'Mouse2',
  mouse3: 'Mouse3',
  mwheelup: 'MouseWheelUp',
  mwheeldown: 'MouseWheelDown',
  pause: 'Pause',
  semicolon: 'Semicolon',
};

/** @type {Record<string, string>} code → Quake name for config write */
const CODE_TO_KEY_NAME = {
  Tab: 'TAB',
  Enter: 'ENTER',
  Escape: 'ESCAPE',
  Space: 'SPACE',
  Backspace: 'BACKSPACE',
  ArrowUp: 'UPARROW',
  ArrowDown: 'DOWNARROW',
  ArrowLeft: 'LEFTARROW',
  ArrowRight: 'RIGHTARROW',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  Mouse1: 'MOUSE1',
  Mouse2: 'MOUSE2',
  Mouse3: 'MOUSE3',
  Semicolon: 'SEMICOLON',
};

/**
 * @param {string} name
 * @returns {string|null} KeyboardEvent.code or Mouse1
 */
export function keyNameToCode(name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (KEY_NAME_TO_CODE[n]) return KEY_NAME_TO_CODE[n];
  if (n.length === 1) {
    const ch = n.toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return `Key${ch}`;
    if (ch >= '0' && ch <= '9') return `Digit${ch}`;
  }
  // Already a code?
  if (/^(Key|Digit|Arrow|F\d|Control|Alt|Shift|Mouse)/.test(name)) return name;
  return null;
}

/**
 * @param {string} code
 */
export function codeToKeyName(code) {
  if (CODE_TO_KEY_NAME[code]) return CODE_TO_KEY_NAME[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('F') && /^F\d+$/.test(code)) return code;
  return code.toLowerCase();
}

export class KeyBindings {
  constructor() {
    /** @type {Map<string, string>} */
    this.map = new Map();
    /** @type {Set<string>} */
    this._prevDown = new Set();
    this.pendingImpulse = 0;
    this.setDefaults();
  }

  setDefaults() {
    this.map.clear();
    /** @type {[string, string][]} */
    const defaults = [
      ['KeyW', '+forward'],
      ['ArrowUp', '+forward'],
      ['KeyS', '+back'],
      ['ArrowDown', '+back'],
      ['KeyA', '+moveleft'],
      ['ArrowLeft', '+moveleft'],
      ['KeyD', '+moveright'],
      ['ArrowRight', '+moveright'],
      ['Space', '+jump'],
      ['ControlLeft', '+attack'],
      ['ControlRight', '+attack'],
      ['Mouse1', '+attack'],
      ['KeyC', '+movedown'],
      ['KeyN', 'noclip'],
      ['Digit1', 'impulse 1'],
      ['Digit2', 'impulse 2'],
      ['Digit3', 'impulse 3'],
      ['Digit4', 'impulse 4'],
      ['Digit5', 'impulse 5'],
      ['Digit6', 'impulse 6'],
      ['Digit7', 'impulse 7'],
      ['Digit8', 'impulse 8'],
    ];
    for (const [code, cmd] of defaults) this.map.set(code, cmd);
  }

  /**
   * @param {string} keyName Quake key name or single char
   * @param {string} command
   * @returns {boolean}
   */
  bind(keyName, command) {
    const code = keyNameToCode(keyName);
    if (!code) return false;
    this.map.set(code, command.trim());
    return true;
  }

  /**
   * @param {string} keyName
   * @returns {boolean}
   */
  unbind(keyName) {
    const code = keyNameToCode(keyName);
    if (!code) return false;
    this.map.delete(code);
    return true;
  }

  /**
   * @returns {string[]}
   */
  listLines() {
    /** @type {string[]} */
    const lines = [];
    for (const [code, cmd] of this.map) {
      lines.push(`bind "${codeToKeyName(code)}" "${cmd}"`);
    }
    lines.sort();
    return lines;
  }

  /** config.cfg bind block */
  writeConfig() {
    return this.listLines().join('\n') + (this.map.size ? '\n' : '');
  }

  /**
   * @param {import('../platform/KeyboardInput.js').KeyboardInput} kb
   * @param {{ attack?: boolean }} [pointer]
   * @param {(cmd: string) => void} [execOneShot]
   */
  sample(kb, pointer, execOneShot) {
    this.pendingImpulse = 0;
    for (const [code, cmd] of this.map) {
      const down = this._codeDown(code, kb, pointer);
      const was = this._prevDown.has(code);
      if (down && !was) {
        const c = cmd.trim();
        if (c.startsWith('impulse ')) {
          this.pendingImpulse = parseInt(c.slice(8), 10) || 0;
        } else if (c && !c.startsWith('+') && !c.startsWith('-')) {
          execOneShot?.(c);
        }
      }
      if (down) this._prevDown.add(code);
      else this._prevDown.delete(code);
    }
  }

  /**
   * True if any key bound to +action (or bare action) is held.
   * @param {import('../platform/KeyboardInput.js').KeyboardInput} kb
   * @param {{ attack?: boolean }} [pointer]
   * @param {string} action e.g. forward, attack, jump
   */
  isDown(kb, pointer, action) {
    const plus = `+${action}`;
    for (const [code, cmd] of this.map) {
      const c = cmd.trim();
      if (c !== plus && c !== action) continue;
      if (this._codeDown(code, kb, pointer)) return true;
    }
    return false;
  }

  /**
   * @param {string} code
   * @param {import('../platform/KeyboardInput.js').KeyboardInput} kb
   * @param {{ attack?: boolean }} [pointer]
   */
  _codeDown(code, kb, pointer) {
    if (code === 'Mouse1') return !!(pointer && pointer.attack);
    if (code === 'Mouse2' || code === 'Mouse3') return false;
    return kb.isDown(code);
  }
}
