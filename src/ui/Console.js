/**
 * Developer console (console.c / Draw_ConsoleBackground subset).
 * Canvas overlay: gfx/conback.lmp + gfx.wad conchars.
 * Toggle with ` / ~ (Backquote).
 */

import { WadFile } from '../fs/WadFile.js';
import {
  parseQPic,
  picToImageData,
  drawConChar,
  drawConString,
} from './DrawPics.js';

const MAX_LINES = 256;
const CON_WIDTH = 320;
const CON_HEIGHT = 100; // half of classic 200 — Con_DrawConsole lines

export class Console {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    if (!this._ctx) throw new Error('2D context unavailable for console');
    this._canvas.width = CON_WIDTH;
    this._canvas.height = CON_HEIGHT;
    this._ready = false;
    this._open = false;
    this._time = 0;
    /** @type {string[]} */
    this._lines = [];
    this._input = '';
    /** @type {string[]} */
    this._history = [];
    this._histIdx = -1;
    this._histDraft = '';
    /** @type {ImageBitmap|null} */
    this._conback = null;
    /** @type {ImageBitmap|null} */
    this._conchars = null;

    this._canvas.style.display = 'none';
    this.print('QuakeJS console');
    this.print('Type "help" for commands. ` to close.');
  }

  /** @returns {boolean} */
  get isOpen() {
    return this._open;
  }

  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   */
  async load(fs) {
    const palette = fs.loadPalette();
    try {
      const pic = parseQPic(fs.load('gfx/conback.lmp'), 'gfx/conback.lmp');
      this._conback = await createImageBitmap(picToImageData(palette, pic, false));
    } catch (err) {
      console.warn('[console] conback load failed', err);
    }
    try {
      const wad = new WadFile(fs.load('gfx.wad'), 'gfx.wad');
      if (wad.has('conchars')) {
        const lump = wad.getLump('conchars');
        const img = picToImageData(
          palette,
          { width: 128, height: 128, pixels: lump.subarray(0, 128 * 128) },
          true,
        );
        this._conchars = await createImageBitmap(img);
      }
    } catch (err) {
      console.warn('[console] conchars load failed', err);
    }
    this._ready = true;
  }

  toggle() {
    this._open = !this._open;
    this._canvas.style.display = this._open ? 'block' : 'none';
    if (this._open) this._histIdx = -1;
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
  }

  /**
   * Con_DrawConsole — redraw when open.
   * @param {number} dt
   */
  frame(dt) {
    this._time += dt;
    if (!this._open || !this._ctx) {
      this._canvas.style.display = 'none';
      return;
    }
    this._canvas.style.display = 'block';
    const ctx = this._ctx;
    ctx.clearRect(0, 0, CON_WIDTH, CON_HEIGHT);

    // Draw_ConsoleBackground — stretch conback into console rect
    if (this._conback) {
      ctx.drawImage(this._conback, 0, 0, CON_WIDTH, CON_HEIGHT);
    } else {
      ctx.fillStyle = '#1a1510';
      ctx.fillRect(0, 0, CON_WIDTH, CON_HEIGHT);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, CON_WIDTH, CON_HEIGHT);

    const charH = 8;
    const inputRows = 1;
    const textRows = ((CON_HEIGHT - 16) >> 3) - inputRows;
    const startY = CON_HEIGHT - 16 - textRows * charH;
    const lineWidth = (CON_WIDTH >> 3) - 2; // leave margin like (x+1)<<3

    const visible = this._lines.slice(-Math.max(1, textRows));
    let y = startY + (textRows - visible.length) * charH;
    for (const line of visible) {
      const clipped =
        line.length > lineWidth ? line.slice(0, lineWidth) : line;
      if (this._conchars) {
        drawConString(ctx, this._conchars, 8, y, clipped);
      } else {
        ctx.fillStyle = '#d4cfc4';
        ctx.font = '8px monospace';
        ctx.fillText(clipped, 8, y + 7);
      }
      y += charH;
    }

    // Con_DrawInput
    const inputY = CON_HEIGHT - 16;
    const prompt = `]${this._input}`;
    const blink = ((this._time * 4) | 0) & 1;
    if (this._conchars) {
      drawConString(ctx, this._conchars, 8, inputY, prompt);
      if (blink) {
        drawConChar(ctx, this._conchars, 8 + prompt.length * 8, inputY, 11);
      }
    } else {
      ctx.fillStyle = '#f0e6d8';
      ctx.font = '8px monospace';
      ctx.fillText(prompt + (blink ? '_' : ''), 8, inputY + 7);
    }
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
      return true;
    }
    if (e.code === 'Backspace') {
      this._input = this._input.slice(0, -1);
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
      return true;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '`' || e.key === '~') return true;
      this._input += e.key;
      return true;
    }
    return true;
  }
}
