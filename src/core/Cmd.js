/**
 * Command buffer / tokenizer (cmd.c subset).
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  /** @type {string[]} */
  const args = [];
  let i = 0;
  const s = text.trim();
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      i++;
      let out = '';
      while (i < s.length && s[i] !== '"') {
        out += s[i++];
      }
      if (i < s.length) i++;
      args.push(out);
      continue;
    }
    let out = '';
    while (i < s.length && !/\s/.test(s[i])) {
      out += s[i++];
    }
    args.push(out);
  }
  return args;
}

export class Cmd {
  constructor() {
    /** @type {Map<string, (args: string[]) => void>} */
    this._cmds = new Map();
    /** @type {string[]} */
    this._buf = [];
    /** @type {string[]} */
    this._argv = [];
  }

  /**
   * @param {string} name
   * @param {(args: string[]) => void} fn
   */
  add(name, fn) {
    this._cmds.set(name.toLowerCase(), fn);
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._cmds.has(name.toLowerCase());
  }

  /**
   * @returns {string[]}
   */
  list() {
    return [...this._cmds.keys()].sort();
  }

  /** @returns {string[]} */
  get argv() {
    return this._argv;
  }

  /**
   * Queue text (may contain `;` or newlines). Semicolons inside quotes are kept.
   * @param {string} text
   */
  addText(text) {
    if (!text) return;
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        inQuote = !inQuote;
        cur += c;
        continue;
      }
      if (!inQuote && (c === '\n' || c === '\r' || c === ';')) {
        const t = cur.trim();
        if (t) this._buf.push(t);
        cur = '';
        continue;
      }
      cur += c;
    }
    const t = cur.trim();
    if (t) this._buf.push(t);
  }

  /**
   * @param {string} line
   * @param {(args: string[]) => boolean} [cvarHandler]
   * @param {(msg: string) => void} [unknown]
   */
  executeLine(line, cvarHandler, unknown) {
    this._argv = tokenize(line);
    if (this._argv.length === 0) return;
    const name = this._argv[0].toLowerCase();
    const fn = this._cmds.get(name);
    if (fn) {
      fn(this._argv);
      return;
    }
    if (cvarHandler && cvarHandler(this._argv)) return;
    if (unknown) unknown(`Unknown command "${this._argv[0]}"\n`);
  }

  /**
   * Drain buffer.
   * @param {(args: string[]) => boolean} [cvarHandler]
   * @param {(msg: string) => void} [unknown]
   */
  executeBuffer(cvarHandler, unknown) {
    while (this._buf.length) {
      const line = this._buf.shift();
      if (line) this.executeLine(line, cvarHandler, unknown);
    }
  }
}
