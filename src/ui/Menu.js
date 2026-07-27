/**
 * Main menu (menu.c subset) — main / singleplayer / options / help / quit.
 * Drawn to a 320×200 canvas overlay.
 */

import { loadLmpBitmap, picToImageData } from './DrawPics.js';
import { WadFile } from '../fs/WadFile.js';

/** @typedef {'none'|'main'|'singleplayer'|'options'|'help'|'quit'|'mp'} MenuState */

const MAIN_ITEMS = 5;
const SP_ITEMS = 3;
const OPT_ITEMS = 2;

export class Menu {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} hooks
   * @param {(name: string) => void} hooks.onNewGame
   * @param {(sample: string) => void} [hooks.playSound]
   * @param {() => number} [hooks.getVolume]
   * @param {(v: number) => void} [hooks.setVolume]
   * @param {() => number} [hooks.getSensitivity]
   * @param {(v: number) => void} [hooks.setSensitivity]
   * @param {() => void} [hooks.onQuitNotice]
   */
  constructor(canvas, hooks) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    if (!this._ctx) throw new Error('2D context unavailable for menu');
    this._hooks = hooks;
    /** @type {MenuState} */
    this._state = 'none';
    this._ready = false;
    /** @type {Map<string, ImageBitmap>} */
    this._pics = new Map();
    /** @type {ImageBitmap|null} */
    this._conchars = null;
    this._mainCursor = 0;
    this._spCursor = 0;
    this._optCursor = 0;
    this._helpPage = 0;
    this._time = 0;
    this._canvas.width = 320;
    this._canvas.height = 200;
  }

  /** @returns {boolean} */
  get isOpen() {
    return this._state !== 'none';
  }

  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   */
  async load(fs) {
    const palette = fs.loadPalette();
    const names = [
      'gfx/qplaque.lmp',
      'gfx/ttl_main.lmp',
      'gfx/mainmenu.lmp',
      'gfx/ttl_sgl.lmp',
      'gfx/sp_menu.lmp',
      'gfx/p_option.lmp',
      'gfx/help0.lmp',
      'gfx/help1.lmp',
      'gfx/help2.lmp',
      'gfx/help3.lmp',
      'gfx/help4.lmp',
      'gfx/help5.lmp',
      'gfx/conback.lmp',
    ];
    for (let i = 1; i <= 6; i++) names.push(`gfx/menudot${i}.lmp`);

    for (const path of names) {
      if (!fs.has(path)) continue;
      try {
        this._pics.set(path, await loadLmpBitmap(fs, path, palette));
      } catch (err) {
        console.warn(`[menu] failed ${path}`, err);
      }
    }

    try {
      const wad = new WadFile(fs.load('gfx.wad'), 'gfx.wad');
      if (wad.has('conchars')) {
        const lump = wad.getLump('conchars');
        if (lump.length >= 128 * 128) {
          this._conchars = await createImageBitmap(
            picToImageData(
              palette,
              { width: 128, height: 128, pixels: lump.subarray(0, 128 * 128) },
              true,
            ),
          );
        }
      }
    } catch (err) {
      console.warn('[menu] conchars', err);
    }

    this._ready = true;
    console.info(`[menu] loaded ${this._pics.size} pics`);
  }

  openMain() {
    this._state = 'main';
    this._mainCursor = 0;
    this._show();
    this._snd('misc/menu2.wav');
  }

  close() {
    this._state = 'none';
    this._canvas.style.display = 'none';
  }

  /** M_ToggleMenu_f */
  toggle() {
    if (this.isOpen) {
      if (this._state !== 'main') {
        this._state = 'main';
        this._mainCursor = 0;
        this._snd('misc/menu2.wav');
        return;
      }
      this.close();
    } else {
      this.openMain();
    }
  }

  _show() {
    this._canvas.style.display = 'block';
  }

  /** @param {string} sample */
  _snd(sample) {
    this._hooks.playSound?.(sample);
  }

  /**
   * @param {string} path
   * @param {number} x
   * @param {number} y
   */
  _drawPic(path, x, y) {
    const pic = this._pics.get(path);
    if (pic && this._ctx) this._ctx.drawImage(pic, x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} num
   */
  _drawChar(x, y, num) {
    if (!this._conchars || !this._ctx) return;
    num &= 255;
    const row = num >> 4;
    const col = num & 15;
    this._ctx.drawImage(this._conchars, col * 8, row * 8, 8, 8, x, y, 8, 8);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} str
   */
  _print(x, y, str) {
    for (let i = 0; i < str.length; i++) {
      this._drawChar(x + i * 8, y, str.charCodeAt(i) | 128);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} range 0..1
   */
  _drawSlider(x, y, range) {
    const r = Math.max(0, Math.min(1, range));
    this._drawChar(x - 8, y, 128);
    for (let i = 0; i < 10; i++) this._drawChar(x + i * 8, y, 129);
    this._drawChar(x + 80, y, 130);
    this._drawChar(x + ((9 * 8 * r) | 0), y, 131);
  }

  /** @param {number} dt */
  frame(dt) {
    this._time += dt;
    if (!this._ready || !this.isOpen || !this._ctx) {
      if (!this.isOpen) this._canvas.style.display = 'none';
      return;
    }
    this._show();
    const ctx = this._ctx;
    ctx.clearRect(0, 0, 320, 200);

    const back = this._pics.get('gfx/conback.lmp');
    if (back) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(back, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 320, 200);

    const dot = 1 + (((this._time * 10) | 0) % 6);
    const blink = 12 + (((this._time * 4) | 0) & 1);

    switch (this._state) {
      case 'main': {
        this._drawPic('gfx/qplaque.lmp', 16, 4);
        const ttl = this._pics.get('gfx/ttl_main.lmp');
        if (ttl) this._drawPic('gfx/ttl_main.lmp', (320 - ttl.width) / 2, 4);
        this._drawPic('gfx/mainmenu.lmp', 72, 32);
        this._drawPic(`gfx/menudot${dot}.lmp`, 54, 32 + this._mainCursor * 20);
        break;
      }
      case 'singleplayer': {
        this._drawPic('gfx/qplaque.lmp', 16, 4);
        const ttl = this._pics.get('gfx/ttl_sgl.lmp');
        if (ttl) this._drawPic('gfx/ttl_sgl.lmp', (320 - ttl.width) / 2, 4);
        this._drawPic('gfx/sp_menu.lmp', 72, 32);
        this._drawPic(`gfx/menudot${dot}.lmp`, 54, 32 + this._spCursor * 20);
        break;
      }
      case 'options': {
        this._drawPic('gfx/qplaque.lmp', 16, 4);
        const ttl = this._pics.get('gfx/p_option.lmp');
        if (ttl) this._drawPic('gfx/p_option.lmp', (320 - ttl.width) / 2, 4);
        this._print(16, 40, '          Sound Volume');
        this._drawSlider(220, 40, this._hooks.getVolume?.() ?? 0.7);
        this._print(16, 56, '           Mouse Speed');
        {
          const sens = this._hooks.getSensitivity?.() ?? 3;
          this._drawSlider(220, 56, Math.max(0, Math.min(1, (sens - 1) / 10)));
        }
        this._drawChar(200, 40 + this._optCursor * 16, blink);
        this._print(16, 88, 'Arrows adjust  Esc back');
        break;
      }
      case 'help':
        this._drawPic(`gfx/help${this._helpPage}.lmp`, 0, 0);
        break;
      case 'quit':
        this._print(56, 80, 'Are you sure you want to');
        this._print(88, 96, 'quit this game?');
        this._print(96, 120, 'Y / N   Esc');
        break;
      case 'mp':
        this._print(40, 88, 'Multiplayer not available');
        this._print(88, 112, 'press Esc');
        break;
      default:
        break;
    }
  }

  /**
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  handleKey(e) {
    if (!this.isOpen) return false;

    const code = e.code;
    const nav =
      code === 'Escape' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Enter' ||
      code === 'KeyY' ||
      code === 'KeyN';
    if (nav) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (this._state === 'quit') {
      if (code === 'KeyY') {
        this._snd('misc/menu2.wav');
        this._hooks.onQuitNotice?.();
        return true;
      }
      if (code === 'KeyN' || code === 'Escape') {
        this._snd('misc/menu3.wav');
        this._state = 'main';
        return true;
      }
      return true;
    }

    if (this._state === 'mp') {
      if (code === 'Escape' || code === 'Enter') {
        this._snd('misc/menu3.wav');
        this._state = 'main';
      }
      return true;
    }

    if (this._state === 'help') {
      if (code === 'Escape') {
        this._snd('misc/menu3.wav');
        this._state = 'main';
        return true;
      }
      if (code === 'ArrowRight' || code === 'Enter') {
        this._snd('misc/menu2.wav');
        this._helpPage = (this._helpPage + 1) % 6;
        return true;
      }
      if (code === 'ArrowLeft') {
        this._snd('misc/menu2.wav');
        this._helpPage = (this._helpPage + 5) % 6;
        return true;
      }
      return true;
    }

    if (code === 'Escape') {
      this._snd('misc/menu3.wav');
      if (this._state === 'main') this.close();
      else {
        this._state = 'main';
        this._mainCursor = 0;
      }
      return true;
    }

    if (code === 'ArrowDown') {
      this._snd('misc/menu1.wav');
      if (this._state === 'main') {
        this._mainCursor = (this._mainCursor + 1) % MAIN_ITEMS;
      } else if (this._state === 'singleplayer') {
        this._spCursor = (this._spCursor + 1) % SP_ITEMS;
      } else if (this._state === 'options') {
        this._optCursor = (this._optCursor + 1) % OPT_ITEMS;
      }
      return true;
    }

    if (code === 'ArrowUp') {
      this._snd('misc/menu1.wav');
      if (this._state === 'main') {
        this._mainCursor = (this._mainCursor + MAIN_ITEMS - 1) % MAIN_ITEMS;
      } else if (this._state === 'singleplayer') {
        this._spCursor = (this._spCursor + SP_ITEMS - 1) % SP_ITEMS;
      } else if (this._state === 'options') {
        this._optCursor = (this._optCursor + OPT_ITEMS - 1) % OPT_ITEMS;
      }
      return true;
    }

    if (
      this._state === 'options' &&
      (code === 'ArrowLeft' || code === 'ArrowRight')
    ) {
      const dir = code === 'ArrowRight' ? 1 : -1;
      this._snd('misc/menu3.wav');
      if (this._optCursor === 0) {
        const v = (this._hooks.getVolume?.() ?? 0.7) + dir * 0.1;
        this._hooks.setVolume?.(
          Math.max(0, Math.min(1, Math.round(v * 10) / 10)),
        );
      } else {
        const s = (this._hooks.getSensitivity?.() ?? 3) + dir * 0.5;
        this._hooks.setSensitivity?.(Math.max(1, Math.min(11, s)));
      }
      return true;
    }

    if (code === 'Enter') {
      this._snd('misc/menu2.wav');
      this._enter();
      return true;
    }

    return true;
  }

  _enter() {
    if (this._state === 'main') {
      switch (this._mainCursor) {
        case 0:
          this._state = 'singleplayer';
          this._spCursor = 0;
          break;
        case 1:
          this._state = 'mp';
          break;
        case 2:
          this._state = 'options';
          this._optCursor = 0;
          break;
        case 3:
          this._state = 'help';
          this._helpPage = 0;
          break;
        case 4:
          this._state = 'quit';
          break;
        default:
          break;
      }
      return;
    }

    if (this._state === 'singleplayer') {
      if (this._spCursor === 0) {
        this.close();
        this._hooks.onNewGame('start');
      }
      // Load / Save — not implemented
    }
  }
}
