/**
 * Composition root — wires platform + filesystem + renderer + host loop.
 */

import { GameLoop } from './app/GameLoop.js';
import { Host } from './app/Host.js';
import { SoundSystem } from './audio/SoundSystem.js';
import { FileSystem } from './fs/FileSystem.js';
import { createGpuContext } from './platform/GpuDevice.js';
import { KeyboardInput } from './platform/KeyboardInput.js';
import { PointerLook } from './platform/PointerLook.js';
import { WebGpuRenderer } from './render/WebGpuRenderer.js';
import { StatusBar } from './ui/StatusBar.js';
import { Menu } from './ui/Menu.js';
import { ScreenOverlay } from './ui/ScreenOverlay.js';
import { Console } from './ui/Console.js';

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
  const sbarCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('sbar'));
  const menuCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('menu'));
  const overlayCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('overlay'));
  const consoleCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('console'));
  const hud = document.getElementById('hud');
  if (!canvas || !hud || !sbarCanvas || !menuCanvas || !overlayCanvas || !consoleCanvas) {
    throw new Error('Missing #viewport, #sbar, #menu, #overlay, #console, or #hud');
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

  const sound = new SoundSystem(fs);

  const statusBar = new StatusBar(sbarCanvas);
  try {
    await statusBar.load(fs);
  } catch (err) {
    console.warn('Status bar load failed:', err);
  }

  /** @type {Host|null} */
  let hostRef = null;

  const menu = new Menu(menuCanvas, {
    onNewGame: (map) => {
      void hostRef?.changeMap(map);
    },
    playSound: (sample) => sound.playLocal(sample),
    getVolume: () => hostRef?.cvars.value('volume') ?? 0.7,
    setVolume: (v) => {
      hostRef?.cvars.set('volume', v);
    },
    getSensitivity: () => hostRef?.cvars.value('sensitivity') ?? 3,
    setSensitivity: (v) => {
      hostRef?.cvars.set('sensitivity', v);
    },
    onQuitNotice: () => {
      hostRef?.con.print('Close the browser tab to quit.\n');
    },
  });
  try {
    await menu.load(fs);
  } catch (err) {
    console.warn('Menu load failed:', err);
  }

  const overlay = new ScreenOverlay(overlayCanvas);
  try {
    await overlay.load(fs);
  } catch (err) {
    console.warn('Screen overlay load failed:', err);
  }

  const consoleUi = new Console(consoleCanvas);
  try {
    await consoleUi.load(fs);
  } catch (err) {
    console.warn('Console load failed:', err);
  }

  const mapCandidates = ['maps/start.bsp', 'maps/e1m1.bsp'];
  let loaded = false;
  let lastErr = '';
  for (const map of mapCandidates) {
    if (!fs.has(map)) continue;
    try {
      renderer.loadMap(fs, map, sound);
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

  const host = new Host({
    canvas,
    hud,
    keyboard,
    pointer,
    renderer,
    fs,
    statusBar,
    sound,
    menu,
    overlay,
    console: consoleUi,
  });
  hostRef = host;
  host.syncPointerFromCamera();
  menu.openMain();

  const loop = new GameLoop(host);
  loop.start();
}

main().catch((err) => {
  console.error(err);
  showError(err instanceof Error ? err.message : String(err));
});
