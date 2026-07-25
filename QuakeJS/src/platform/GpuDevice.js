/**
 * WebGPU adapter / device / canvas context bootstrap.
 */

/**
 * @typedef {object} GpuContext
 * @property {GPUAdapter} adapter
 * @property {GPUDevice} device
 * @property {GPUCanvasContext} context
 * @property {GPUTextureFormat} presentationFormat
 * @property {HTMLCanvasElement} canvas
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<GpuContext>}
 */
export async function createGpuContext(canvas) {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('Failed to acquire a WebGPU adapter.');
  }

  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
  });

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to get WebGPU canvas context.');
  }

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'opaque',
  });

  return { adapter, device, context, presentationFormat, canvas };
}

/**
 * Resize canvas drawing buffer to match CSS size × devicePixelRatio.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ width: number, height: number, resized: boolean }}
 */
export function syncCanvasSize(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const resized = canvas.width !== width || canvas.height !== height;
  if (resized) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, resized };
}
