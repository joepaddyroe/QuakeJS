/**
 * Shared 2D pic helpers (draw.c Draw_CachePic / Wad pics).
 */

const TRANSPARENT = 255;

/**
 * @param {Uint8Array} palette
 * @param {{ width: number, height: number, pixels: Uint8Array }} pic
 * @param {boolean} [trans]
 * @returns {ImageData}
 */
export function picToImageData(palette, pic, trans = true) {
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
 * Parse qpic LMP (int width, height, then indexed pixels).
 * @param {Uint8Array} data
 * @param {string} [label]
 * @returns {{ width: number, height: number, pixels: Uint8Array }}
 */
export function parseQPic(data, label = 'pic') {
  if (data.length < 8) throw new Error(`${label}: too small`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getInt32(0, true);
  const height = view.getInt32(4, true);
  if (width <= 0 || height <= 0 || 8 + width * height > data.length) {
    throw new Error(`${label}: bad dimensions`);
  }
  return {
    width,
    height,
    pixels: data.subarray(8, 8 + width * height),
  };
}

/**
 * @param {import('../fs/FileSystem.js').FileSystem} fs
 * @param {string} path e.g. gfx/mainmenu.lmp
 * @param {Uint8Array} palette
 * @returns {Promise<ImageBitmap>}
 */
export async function loadLmpBitmap(fs, path, palette) {
  const data = fs.load(path);
  const pic = parseQPic(data, path);
  return createImageBitmap(picToImageData(palette, pic, true));
}
