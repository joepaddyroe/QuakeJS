/**
 * Pointer-lock mouse look. Accumulates pitch/yaw in **degrees** (Quake angles).
 *
 * Note: while locked, the browser consumes Escape to exit lock and often does not
 * deliver a keydown — use `onUserUnlock` to treat that as “open menu”.
 */
export class PointerLook {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this.yaw = 0;
    this.pitch = 0;
    /** Degrees per pixel */
    this.sensitivity = 0.12;
    this._locked = false;
    /** When true, canvas click will not request pointer lock (demos / UI) */
    this.suppressLock = false;
    /** Set by exitLock — unlock was intentional, not user Esc */
    this._exitRequested = false;
    /**
     * Fired when the user leaves pointer lock (typically Esc) without exitLock().
     * @type {(() => void)|null}
     */
    this.onUserUnlock = null;
    /** Fire / attack (QC button0) */
    this.attack = false;
    /** Mouse2 bound to +forward in default.cfg */
    this.forward = false;
    /** Mouse3 / +mlook latch (look always on while locked) */
    this.mlook = false;

    this._onClick = () => {
      if (this.suppressLock || this._locked) return;
      this._canvas.requestPointerLock?.();
    };
    this._onLockChange = () => {
      const nowLocked = document.pointerLockElement === this._canvas;
      const wasLocked = this._locked;
      this._locked = nowLocked;
      if (wasLocked && !nowLocked) {
        const intentional = this._exitRequested;
        this._exitRequested = false;
        this.attack = false;
        this.forward = false;
        this.mlook = false;
        if (!intentional) this.onUserUnlock?.();
      }
    };
    this._onMouseMove = (e) => {
      if (!this._locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch += e.movementY * this.sensitivity; // Quake: +pitch looks down
      const limit = 89;
      if (this.pitch > limit) this.pitch = limit;
      if (this.pitch < -limit) this.pitch = -limit;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) this.attack = true;
      if (e.button === 1) this.forward = true;
      if (e.button === 2) this.mlook = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.attack = false;
      if (e.button === 1) this.forward = false;
      if (e.button === 2) this.mlook = false;
    };
  }

  get locked() {
    return this._locked;
  }

  /** Release pointer lock (e.g. when opening console / menu). */
  exitLock() {
    if (document.pointerLockElement === this._canvas) {
      this._exitRequested = true;
      document.exitPointerLock?.();
    }
    this.attack = false;
    this.forward = false;
    this.mlook = false;
  }

  attach() {
    this._canvas.addEventListener('click', this._onClick);
    this._canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  detach() {
    this._canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    if (document.pointerLockElement === this._canvas) {
      document.exitPointerLock?.();
    }
  }
}
