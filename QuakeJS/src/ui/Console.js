/**
 * Developer console (console.c subset) — DOM overlay.
 * Toggle with ` / ~ (Backquote).
 */

const MAX_LINES = 256;

export class Console {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this._root = root;
    this._open = false;
    /** @type {string[]} */
    this._lines = [];
    this._input = '';
    /** @type {string[]} */
    this._history = [];
    this._histIdx = -1;
    this._histDraft = '';

    this._panel = document.createElement('div');
    this._panel.id = 'console-panel';
    this._logEl = document.createElement('div');
    this._logEl.id = 'console-log';
    this._inputRow = document.createElement('div');
    this._inputRow.id = 'console-input-row';
    this._prompt = document.createElement('span');
    this._prompt.textContent = ']';
    this._inputEl = document.createElement('span');
    this._inputEl.id = 'console-input';
    this._caret = document.createElement('span');
    this._caret.id = 'console-caret';
    this._caret.textContent = '_';

    this._inputRow.append(this._prompt, this._inputEl, this._caret);
    this._panel.append(this._logEl, this._inputRow);
    root.appendChild(this._panel);
    this._panel.style.display = 'none';

    this.print('QuakeJS console');
    this.print('Type "help" for commands. ` to close.');
  }

  /** @returns {boolean} */
  get isOpen() {
    return this._open;
  }

  toggle() {
    this._open = !this._open;
    this._panel.style.display = this._open ? 'flex' : 'none';
    if (this._open) {
      this._histIdx = -1;
      this._renderInput();
    }
  }

  open() {
    if (!this._open) this.toggle();
  }

  close() {
    if (this._open) this.toggle();
  }

  /**
   * @param {string} text
   */
  print(text) {
    const parts = String(text).replace(/\r/g, '').split('\n');
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i];
      if (i === parts.length - 1 && line === '' && parts.length > 1) continue;
      this._lines.push(line);
    }
    while (this._lines.length > MAX_LINES) this._lines.shift();
    this._logEl.textContent = this._lines.join('\n');
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }

  _renderInput() {
    this._inputEl.textContent = this._input;
  }

  /**
   * Handle a key while console is open.
   * @param {KeyboardEvent} e
   * @param {(line: string) => void} onSubmit
   * @returns {boolean} true if consumed
   */
  handleKey(e, onSubmit) {
    if (e.code === 'Backquote') {
      e.preventDefault();
      this.toggle();
      return true;
    }
    if (!this._open) return false;

    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') {
      this.close();
      return true;
    }
    if (e.code === 'Enter') {
      const line = this._input;
      this.print(`]${line}`);
      if (line.trim()) {
        this._history.push(line);
        if (this._history.length > 64) this._history.shift();
        onSubmit(line);
      }
      this._input = '';
      this._histIdx = -1;
      this._renderInput();
      return true;
    }
    if (e.code === 'Backspace') {
      this._input = this._input.slice(0, -1);
      this._renderInput();
      return true;
    }
    if (e.code === 'ArrowUp') {
      if (this._history.length === 0) return true;
      if (this._histIdx < 0) {
        this._histDraft = this._input;
        this._histIdx = this._history.length - 1;
      } else if (this._histIdx > 0) {
        this._histIdx--;
      }
      this._input = this._history[this._histIdx];
      this._renderInput();
      return true;
    }
    if (e.code === 'ArrowDown') {
      if (this._histIdx < 0) return true;
      if (this._histIdx < this._history.length - 1) {
        this._histIdx++;
        this._input = this._history[this._histIdx];
      } else {
        this._histIdx = -1;
        this._input = this._histDraft;
      }
      this._renderInput();
      return true;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '`' || e.key === '~') return true;
      this._input += e.key;
      this._renderInput();
      return true;
    }
    return true;
  }
}
