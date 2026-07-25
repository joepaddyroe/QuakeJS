/**
 * Loading plaque + intermission / finale overlays (screen.c / sbar.c subset).
 */

import { loadLmpBitmap, picToImageData } from './DrawPics.js';
import { WadFile } from '../fs/WadFile.js';

export class ScreenOverlay {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    if (!this._ctx) throw new Error('2D context unavailable for screen overlay');
    this._ready = false;
    this._loading = false;
    /** @type {Map<string, ImageBitmap>} */
    this._pics = new Map();
    /** @type {Map<string, ImageBitmap>} */
    this._wadPics = new Map();
    this._canvas.width = 320;
    this._canvas.height = 200;
    /** @type {string} */
    this._centerText = '';
    /** Seconds remaining to show centerprint */
    this._centerHold = 0;
  }

  /** @returns {boolean} */
  get isLoading() {
    return this._loading;
  }

  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   */
  async load(fs) {
    const palette = fs.loadPalette();
    for (const path of [
      'gfx/loading.lmp',
      'gfx/complete.lmp',
      'gfx/inter.lmp',
      'gfx/finale.lmp',
    ]) {
      if (!fs.has(path)) continue;
      try {
        this._pics.set(path, await loadLmpBitmap(fs, path, palette));
      } catch (err) {
        console.warn(`[overlay] ${path}`, err);
      }
    }

    const wad = new WadFile(fs.load('gfx.wad'), 'gfx.wad');
    for (let i = 0; i < 10; i++) {
      for (const prefix of ['num_', 'anum_']) {
        const name = `${prefix}${i}`;
        if (!wad.has(name)) continue;
        const pic = wad.getPic(name);
        this._wadPics.set(
          name,
          await createImageBitmap(picToImageData(palette, pic, true)),
        );
      }
    }
    for (const name of ['num_colon', 'num_slash', 'num_minus']) {
      if (!wad.has(name)) continue;
      const pic = wad.getPic(name);
      this._wadPics.set(
        name,
        await createImageBitmap(picToImageData(palette, pic, true)),
      );
    }

    this._ready = true;
    console.info(
      `[overlay] loaded ${this._pics.size} lmps + ${this._wadPics.size} digits`,
    );
  }

  showLoading() {
    this._loading = true;
    this._paintLoading();
  }

  hideLoading() {
    this._loading = false;
    if (!this._intermissionActive && this._centerHold <= 0) {
      this._canvas.style.display = 'none';
    }
  }

  /**
   * Yield so the loading plaque paints before a sync map load.
   * @returns {Promise<void>}
   */
  async waitForPaint() {
    this.showLoading();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  _paintLoading() {
    if (!this._ready || !this._ctx) return;
    this._canvas.style.display = 'block';
    const ctx = this._ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 320, 200);
    const pic = this._pics.get('gfx/loading.lmp');
    if (pic) {
      const x = ((320 - pic.width) / 2) | 0;
      const y = ((200 - 48 - pic.height) / 2) | 0;
      ctx.drawImage(pic, x, y);
    } else {
      ctx.fillStyle = '#c8c4b8';
      ctx.font = '16px monospace';
      ctx.fillText('Loading…', 120, 100);
    }
  }

  /**
   * @param {string} name
   * @param {number} x
   * @param {number} y
   */
  _drawLmp(name, x, y) {
    const pic = this._pics.get(name);
    if (pic && this._ctx) this._ctx.drawImage(pic, x, y);
  }

  /**
   * @param {string} name
   * @param {number} x
   * @param {number} y
   */
  _drawWad(name, x, y) {
    const pic = this._wadPics.get(name);
    if (pic && this._ctx) this._ctx.drawImage(pic, x, y);
  }

  /**
   * Sbar_IntermissionNumber
   * @param {number} x
   * @param {number} y
   * @param {number} num
   * @param {number} digits
   */
  _drawNum(x, y, num, digits) {
    let str = String(Math.max(0, num | 0));
    if (str.length > digits) str = str.slice(str.length - digits);
    if (str.length < digits) x += (digits - str.length) * 24;
    for (let i = 0; i < str.length; i++) {
      this._drawWad(`num_${str[i]}`, x, y);
      x += 24;
    }
  }

  /** @type {boolean} */
  _intermissionActive = false;

  /**
   * SCR_CenterPrint — hold message in the middle of the screen.
   * @param {string} text
   * @param {number} [hold=3]
   */
  centerPrint(text, hold = 3) {
    this._centerText = (text || '').replace(/\r/g, '');
    this._centerHold = Math.max(0.5, hold);
    if (this._centerText && !this._loading) {
      this._canvas.style.display = 'block';
      this._paintCenter();
    }
  }

  /**
   * Advance centerprint timer; redraw when visible.
   * @param {number} dt
   */
  frame(dt) {
    if (this._loading || this._intermissionActive) return;
    if (this._centerHold <= 0) return;
    this._centerHold -= dt;
    if (this._centerHold <= 0) {
      this._centerText = '';
      this._centerHold = 0;
      this._canvas.style.display = 'none';
      if (this._ctx) {
        this._ctx.clearRect(0, 0, 320, 200);
      }
      return;
    }
    this._paintCenter();
  }

  _paintCenter() {
    if (!this._ctx || !this._centerText) return;
    this._canvas.style.display = 'block';
    const ctx = this._ctx;
    ctx.clearRect(0, 0, 320, 200);
    const lines = this._centerText.split('\n');
    ctx.fillStyle = '#f0e6d8';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const startY = 100 - ((lines.length - 1) * 10) / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 160, startY + i * 10);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Sbar_IntermissionOverlay / Finale.
   * @param {{
   *   active: boolean,
   *   finale?: boolean,
   *   completedTime?: number,
   *   secrets?: number,
   *   totalSecrets?: number,
   *   monsters?: number,
   *   totalMonsters?: number,
   * } | null} info
   */
  drawIntermission(info) {
    if (this._loading) return;

    if (!info?.active) {
      this._intermissionActive = false;
      if (this._centerHold <= 0) {
        this._canvas.style.display = 'none';
      } else {
        this._paintCenter();
      }
      return;
    }

    this._intermissionActive = true;
    if (!this._ready || !this._ctx) return;
    this._canvas.style.display = 'block';
    const ctx = this._ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 320, 200);

    if (info.finale) {
      const pic = this._pics.get('gfx/finale.lmp');
      if (pic) {
        ctx.drawImage(pic, ((320 - pic.width) / 2) | 0, 16);
      }
      return;
    }

    this._drawLmp('gfx/complete.lmp', 64, 24);
    this._drawLmp('gfx/inter.lmp', 0, 56);

    const t = Math.max(0, info.completedTime | 0);
    const dig = (t / 60) | 0;
    const sec = t - dig * 60;
    this._drawNum(160, 64, dig, 3);
    this._drawWad('num_colon', 234, 64);
    this._drawWad(`num_${((sec / 10) | 0) % 10}`, 246, 64);
    this._drawWad(`num_${sec % 10}`, 266, 64);

    this._drawNum(160, 104, info.secrets ?? 0, 3);
    this._drawWad('num_slash', 232, 104);
    this._drawNum(240, 104, info.totalSecrets ?? 0, 3);

    this._drawNum(160, 144, info.monsters ?? 0, 3);
    this._drawWad('num_slash', 232, 144);
    this._drawNum(240, 144, info.totalMonsters ?? 0, 3);
  }
}
