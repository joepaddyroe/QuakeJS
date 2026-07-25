/**
 * CDAudio stub (cdaudio.c) — optional HTMLAudio tracks; silent if missing.
 */

export class CdAudio {
  constructor() {
    this.initialized = false;
    this.enabled = true;
    this.playing = false;
    this.track = 0;
    this.looping = false;
    /** @type {HTMLAudioElement|null} */
    this._el = null;
  }

  /**
   * CDAudio_Init
   * @returns {boolean}
   */
  init() {
    this.initialized = true;
    return true;
  }

  /**
   * CDAudio_Play — try common web paths; no-op if unavailable.
   * @param {number} track
   * @param {boolean} [looping=false]
   */
  play(track, looping = false) {
    if (!this.initialized || !this.enabled) return;
    const t = track | 0;
    if (t <= 0) {
      this.stop();
      return;
    }
    this.track = t;
    this.looping = !!looping;
    this.stop();

    const candidates = [
      `music/track${String(t).padStart(2, '0')}.ogg`,
      `music/track${String(t).padStart(2, '0')}.mp3`,
      `./music/track${String(t).padStart(2, '0')}.ogg`,
    ];
    const el = new Audio();
    el.loop = this.looping;
    el.volume = 0.5;
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        this._el = null;
        this.playing = false;
        return;
      }
      el.src = candidates[i++];
      el.play().then(
        () => {
          this._el = el;
          this.playing = true;
        },
        () => tryNext(),
      );
    };
    el.addEventListener('error', () => tryNext(), { once: true });
    tryNext();
  }

  /** CDAudio_Stop */
  stop() {
    if (this._el) {
      try {
        this._el.pause();
        this._el.removeAttribute('src');
        this._el.load();
      } catch {
        /* ignore */
      }
      this._el = null;
    }
    this.playing = false;
  }

  /** CDAudio_Update — reserved for volume / pause sync */
  update() {}

  /** CDAudio_Shutdown */
  shutdown() {
    this.stop();
    this.initialized = false;
  }
}
