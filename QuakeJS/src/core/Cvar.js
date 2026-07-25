/**
 * Console variables (cvar.c subset).
 */

export class Cvar {
  /**
   * @param {string} name
   * @param {string} string
   * @param {{ archive?: boolean, onChange?: (v: Cvar) => void }} [opts]
   */
  constructor(name, string, opts = {}) {
    this.name = name;
    this.string = String(string);
    this.value = parseFloat(this.string) || 0;
    this.archive = !!opts.archive;
    this.onChange = opts.onChange || null;
  }
}

export class CvarStore {
  constructor() {
    /** @type {Map<string, Cvar>} */
    this._vars = new Map();
  }

  /**
   * @param {Cvar} variable
   * @returns {Cvar}
   */
  register(variable) {
    const key = variable.name.toLowerCase();
    if (this._vars.has(key)) {
      console.warn(`[cvar] already registered: ${variable.name}`);
      return /** @type {Cvar} */ (this._vars.get(key));
    }
    this._vars.set(key, variable);
    return variable;
  }

  /**
   * @param {string} name
   * @returns {Cvar|null}
   */
  find(name) {
    return this._vars.get(name.toLowerCase()) || null;
  }

  /**
   * @param {string} name
   * @returns {number}
   */
  value(name) {
    const v = this.find(name);
    return v ? v.value : 0;
  }

  /**
   * @param {string} name
   * @returns {string}
   */
  string(name) {
    const v = this.find(name);
    return v ? v.string : '';
  }

  /**
   * @param {string} name
   * @param {string|number} value
   * @returns {boolean}
   */
  set(name, value) {
    const v = this.find(name);
    if (!v) return false;
    v.string = String(value);
    v.value = parseFloat(v.string);
    if (Number.isNaN(v.value)) v.value = 0;
    if (v.onChange) v.onChange(v);
    return true;
  }

  /**
   * @returns {Cvar[]}
   */
  list() {
    return [...this._vars.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Cvar_WriteVariables — archived cvars as `name "value"\n`
   * @returns {string}
   */
  writeArchived() {
    let out = '';
    for (const v of this.list()) {
      if (!v.archive) continue;
      out += `${v.name} "${v.string}"\n`;
    }
    return out;
  }

  /**
   * Apply lines from config (name value or name "value").
   * @param {string} text
   * @returns {number} count applied
   */
  applyConfigText(text) {
    let n = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      const m = line.match(/^(\S+)\s+"([^"]*)"\s*$/) || line.match(/^(\S+)\s+(\S+)\s*$/);
      if (!m) continue;
      if (this.set(m[1], m[2])) n += 1;
    }
    return n;
  }
}
