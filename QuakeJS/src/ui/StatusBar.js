/**
 * Status bar (sbar.c) — draw health / armor / ammo / face from gfx.wad pics.
 * Renders to a 320-wide 2D canvas overlay, CSS-scaled to the viewport.
 */

import { WadFile } from '../fs/WadFile.js';

const SBAR_HEIGHT = 24;
const INV_HEIGHT = 24; // ibar row above sbar (viewsize < 110)
const TOTAL_HEIGHT = SBAR_HEIGHT + INV_HEIGHT;
const TRANSPARENT = 255;

const IT_SHELLS = 256;
const IT_NAILS = 512;
const IT_ROCKETS = 1024;
const IT_CELLS = 2048;
const IT_ARMOR1 = 8192;
const IT_ARMOR2 = 16384;
const IT_ARMOR3 = 32768;
const IT_INVISIBILITY = 524288;
const IT_INVULNERABILITY = 1048576;
const IT_QUAD = 4194304;
const IT_SHOTGUN = 1;

/**
 * @param {Uint8Array} palette
 * @param {{ width: number, height: number, pixels: Uint8Array }} pic
 * @param {boolean} [trans]
 * @returns {ImageData}
 */
function picToImageData(palette, pic, trans = true) {
  const { width, height, pixels } = pic;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = pixels[i];
    const o = i * 4;
    if (trans && idx === TRANSPARENT) {
      data[o + 3] = 0;
      continue;
    }
    data[o] = palette[idx * 3];
    data[o + 1] = palette[idx * 3 + 1];
    data[o + 2] = palette[idx * 3 + 2];
    data[o + 3] = 255;
  }
  return new ImageData(data, width, height);
}

/**
 * @param {Uint8Array} palette
 * @param {Uint8Array} indexed 128×128 conchars
 * @returns {ImageData}
 */
function concharsToImageData(palette, indexed) {
  return picToImageData(palette, { width: 128, height: 128, pixels: indexed }, true);
}

export class StatusBar {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    if (!this._ctx) throw new Error('2D context unavailable for status bar');
    this._ready = false;
    /** @type {Map<string, ImageBitmap|HTMLCanvasElement>} */
    this._pics = new Map();
    /** @type {ImageBitmap|HTMLCanvasElement|null} */
    this._conchars = null;
    this._faceAnimUntil = 0;
    this._lastHealth = 100;
  }

  /**
   * Load gfx.wad pics (Sbar_Init subset).
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   */
  async load(fs) {
    const wadBytes = fs.load('gfx.wad');
    const wad = new WadFile(wadBytes, 'gfx.wad');
    const palette = fs.loadPalette();

    /** @type {string[]} */
    const names = [
      'sbar',
      'ibar',
      'sb_shells',
      'sb_nails',
      'sb_rocket',
      'sb_cells',
      'sb_armor1',
      'sb_armor2',
      'sb_armor3',
      'face_invis',
      'face_invul2',
      'face_inv2',
      'face_quad',
      'num_minus',
      'anum_minus',
      'inv_shotgun',
      'inv_sshotgun',
      'inv_nailgun',
      'inv_snailgun',
      'inv_rlaunch',
      'inv_srlaunch',
      'inv_lightng',
      'inv2_shotgun',
      'inv2_sshotgun',
      'inv2_nailgun',
      'inv2_snailgun',
      'inv2_rlaunch',
      'inv2_srlaunch',
      'inv2_lightng',
    ];
    for (let i = 0; i < 10; i++) {
      names.push(`num_${i}`, `anum_${i}`);
    }
    for (let f = 1; f <= 5; f++) {
      names.push(`face${f}`, `face_p${f}`);
    }

    for (const name of names) {
      if (!wad.has(name)) continue;
      const pic = wad.getPic(name);
      const img = picToImageData(palette, pic, true);
      this._pics.set(name, await createImageBitmap(img));
    }

    if (wad.has('conchars')) {
      const lump = wad.getLump('conchars');
      if (lump.length >= 128 * 128) {
        const img = concharsToImageData(palette, lump.subarray(0, 128 * 128));
        this._conchars = await createImageBitmap(img);
      }
    }

    this._canvas.width = 320;
    this._canvas.height = TOTAL_HEIGHT;
    this._ready = true;
    console.info(`[sbar] loaded ${this._pics.size} pics from gfx.wad`);
  }

  /**
   * @param {string} name
   * @returns {ImageBitmap|HTMLCanvasElement|undefined}
   */
  _pic(name) {
    return this._pics.get(name);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} name
   */
  _drawPic(x, y, name) {
    const pic = this._pic(name);
    if (!pic || !this._ctx) return;
    this._ctx.drawImage(pic, x, y);
  }

  /**
   * Console character (Draw_Character / Sbar_DrawCharacter).
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
   * Sbar_DrawNum — big digits from wad.
   * @param {number} x
   * @param {number} y
   * @param {number} num
   * @param {number} digits
   * @param {number} color 0 yellow, 1 red
   */
  _drawNum(x, y, num, digits, color) {
    const prefix = color ? 'anum_' : 'num_';
    let str = String(num | 0);
    if (str.length > digits) str = str.slice(str.length - digits);
    if (str.length < digits) x += (digits - str.length) * 24;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const name = ch === '-' ? `${prefix}minus` : `${prefix}${ch}`;
      this._drawPic(x, y, name);
      x += 24;
    }
  }

  /**
   * @param {number} items
   * @param {number} health
   * @param {number} time
   */
  _drawFace(items, health, time) {
    const y = INV_HEIGHT;
    if (
      (items & (IT_INVISIBILITY | IT_INVULNERABILITY)) ===
      (IT_INVISIBILITY | IT_INVULNERABILITY)
    ) {
      this._drawPic(112, y, 'face_inv2');
      return;
    }
    if (items & IT_QUAD) {
      this._drawPic(112, y, 'face_quad');
      return;
    }
    if (items & IT_INVISIBILITY) {
      this._drawPic(112, y, 'face_invis');
      return;
    }
    if (items & IT_INVULNERABILITY) {
      this._drawPic(112, y, 'face_invul2');
      return;
    }

    let f;
    if (health >= 100) f = 4;
    else f = Math.max(0, (health / 20) | 0);
    // face1 = healthy … face5 = near death → index 4..0 maps to face(5-f)
    const faceIdx = 5 - f; // 1..5
    const anim = time <= this._faceAnimUntil ? 1 : 0;
    const name = anim ? `face_p${faceIdx}` : `face${faceIdx}`;
    this._drawPic(112, y, name);
  }

  /**
   * Inventory strip (Sbar_DrawInventory subset — weapons + ammo counts).
   * @param {{ items: number, weapon: number, shells: number, nails: number, rockets: number, cells: number }} stats
   */
  _drawInventory(stats) {
    this._drawPic(0, 0, 'ibar');

    const weaponNames = [
      'shotgun',
      'sshotgun',
      'nailgun',
      'snailgun',
      'rlaunch',
      'srlaunch',
      'lightng',
    ];
    for (let i = 0; i < 7; i++) {
      if (!(stats.items & (IT_SHOTGUN << i))) continue;
      const active = stats.weapon === (IT_SHOTGUN << i);
      const prefix = active ? 'inv2_' : 'inv_';
      this._drawPic(i * 24, 8, `${prefix}${weaponNames[i]}`);
    }

    const ammos = [stats.shells, stats.nails, stats.rockets, stats.cells];
    for (let i = 0; i < 4; i++) {
      const n = Math.max(0, Math.min(999, ammos[i] | 0));
      const str = String(n).padStart(3, ' ');
      for (let d = 0; d < 3; d++) {
        const ch = str[d];
        if (ch === ' ') continue;
        // yellow small digits: char 18 + digit
        this._drawChar((6 * i + 1 + d) * 8 - 2, 0, 18 + (ch.charCodeAt(0) - 48));
      }
    }
  }

  /**
   * @param {{
   *   health: number,
   *   armor: number,
   *   ammo: number,
   *   items: number,
   *   weapon: number,
   *   shells: number,
   *   nails: number,
   *   rockets: number,
   *   cells: number,
   *   time?: number,
   * } | null} stats
   */
  draw(stats) {
    const ctx = this._ctx;
    if (!this._ready || !ctx) {
      this._canvas.style.display = 'none';
      return;
    }
    if (!stats || stats.health <= 0) {
      this._canvas.style.display = 'none';
      return;
    }

    this._canvas.style.display = 'block';
    ctx.clearRect(0, 0, 320, TOTAL_HEIGHT);

    const time = stats.time ?? 0;
    if (stats.health !== this._lastHealth) {
      this._faceAnimUntil = time + 0.2;
      this._lastHealth = stats.health;
    }

    this._drawInventory(stats);

    const y = INV_HEIGHT;
    this._drawPic(0, y, 'sbar');

    // armor
    this._drawNum(24, y, stats.armor, 3, stats.armor <= 25 ? 1 : 0);
    if (stats.items & IT_ARMOR3) this._drawPic(0, y, 'sb_armor3');
    else if (stats.items & IT_ARMOR2) this._drawPic(0, y, 'sb_armor2');
    else if (stats.items & IT_ARMOR1) this._drawPic(0, y, 'sb_armor1');

    this._drawFace(stats.items, stats.health, time);

    this._drawNum(136, y, stats.health, 3, stats.health <= 25 ? 1 : 0);

    if (stats.items & IT_SHELLS) this._drawPic(224, y, 'sb_shells');
    else if (stats.items & IT_NAILS) this._drawPic(224, y, 'sb_nails');
    else if (stats.items & IT_ROCKETS) this._drawPic(224, y, 'sb_rocket');
    else if (stats.items & IT_CELLS) this._drawPic(224, y, 'sb_cells');

    this._drawNum(248, y, stats.ammo, 3, stats.ammo <= 10 ? 1 : 0);
  }
}

export { SBAR_HEIGHT, TOTAL_HEIGHT };
