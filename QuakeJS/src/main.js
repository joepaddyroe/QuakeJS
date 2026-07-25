/**
 * Composition root — wires platform + filesystem + renderer + host loop.
 */

import { GameLoop } from './app/GameLoop.js';
import { Host } from './app/Host.js';
import { FileSystem } from './fs/FileSystem.js';
import { createGpuContext } from './platform/GpuDevice.js';
import { KeyboardInput } from './platform/KeyboardInput.js';
import { PointerLook } from './platform/PointerLook.js';
import { WebGpuRenderer } from './render/WebGpuRenderer.js';

/**
 * @param {string} message
 */
function showError(message) {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

async function main() {
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('viewport'));
  const hud = document.getElementById('hud');
  if (!canvas || !hud) {
    throw new Error('Missing #viewport or #hud');
  }

  let gpu;
  try {
    gpu = await createGpuContext(canvas);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError(
      `WebGPU init failed.\n\n${msg}\n\nUse a recent Chrome/Edge build with WebGPU enabled.`,
    );
    return;
  }

  const fs = new FileSystem();
  try {
    await fs.initId1('./assets/id1');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError(`Failed to load Quake data.\n\n${msg}\n\nPlace pak0.pak under assets/id1/`);
    return;
  }

  const keyboard = new KeyboardInput();
  const pointer = new PointerLook(canvas);
  keyboard.attach();
  pointer.attach();

  const renderer = new WebGpuRenderer(gpu);
  renderer.init();

  const mapCandidates = ['maps/start.bsp', 'maps/e1m1.bsp'];
  let loaded = false;
  let lastErr = '';
  for (const map of mapCandidates) {
    if (!fs.has(map)) continue;
    try {
      renderer.loadMap(fs, map);
      loaded = true;
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.error(err);
    }
  }
  if (!loaded) {
    console.warn('Map load failed, using demo room:', lastErr);
  }

  const host = new Host({ canvas, hud, keyboard, pointer, renderer, fs });
  host.syncPointerFromCamera();

  const loop = new GameLoop(host);
  loop.start();
}

main().catch((err) => {
  console.error(err);
  showError(err instanceof Error ? err.message : String(err));
});
