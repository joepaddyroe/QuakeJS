/**
 * Pointer-lock mouse look. Accumulates pitch/yaw in **degrees** (Quake angles).
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
    /** Fire / attack (QC button0) */
    this.attack = false;

    this._onClick = () => {
      if (!this._locked) {
        this._canvas.requestPointerLock?.();
      }
    };
    this._onLockChange = () => {
      this._locked = document.pointerLockElement === this._canvas;
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
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.attack = false;
    };
  }

  get locked() {
    return this._locked;
  }

  /** Release pointer lock (e.g. when opening console). */
  exitLock() {
    if (document.pointerLockElement === this._canvas) {
      document.exitPointerLock?.();
    }
    this.attack = false;
  }

  attach() {
    this._canvas.addEventListener('click', this._onClick);
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
