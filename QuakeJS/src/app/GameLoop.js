/**
 * requestAnimationFrame driver → Host.frame(dt).
 */
export class GameLoop {
  /**
   * @param {{ frame: (dt: number) => void }} host
   */
  constructor(host) {
    this._host = host;
    this._running = false;
    this._raf = 0;
    this._last = 0;
    this._onFrame = (t) => {
      if (!this._running) return;
      const now = t * 0.001;
      let dt = now - this._last;
      this._last = now;
      if (dt > 0.1) dt = 0.1;
      if (dt < 0) dt = 0;
      this._host.frame(dt);
      this._raf = requestAnimationFrame(this._onFrame);
    };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now() * 0.001;
    this._raf = requestAnimationFrame(this._onFrame);
  }

  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }
}
