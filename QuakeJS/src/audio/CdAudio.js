/**
 * CDAudio stub (cdaudio.c) — optional HTMLAudio under /music/.
 *
 * Available tracks are listed in music/tracks.json (e.g. [2, 4, 5, 9]).
 * An empty list means no BGM files — play() is a no-op with no network requests.
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
    /** null = not loaded yet; Set of track numbers that exist on disk */
    /** @type {Set<number>|null} */
    this._catalog = null;
    /** @type {Promise<void>|null} */
    this._catalogPromise = null;
    /** @type {number} */
    this._playGen = 0;
  }

  /**
   * CDAudio_Init
   * @returns {boolean}
   */
  init() {
    this.initialized = true;
    void this._loadCatalog();
    return true;
  }

  /**
   * @returns {Promise<void>}
   */
  _loadCatalog() {
    if (this._catalogPromise) return this._catalogPromise;
    this._catalogPromise = (async () => {
      try {
        const res = await fetch('music/tracks.json');
        if (!res.ok) {
          this._catalog = new Set();
          return;
        }
        const data = await res.json();
        this._catalog = new Set(
          (Array.isArray(data) ? data : []).map((n) => n | 0).filter((n) => n > 0),
        );
      } catch {
        this._catalog = new Set();
      }
    })();
    return this._catalogPromise;
  }

  /**
   * CDAudio_Play — no-op unless track is listed in music/tracks.json.
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

    if (this.playing && this._el && this._el.dataset.track === String(t)) {
      this._el.loop = this.looping;
      return;
    }

    this.stop();
    const gen = ++this._playGen;

    void (async () => {
      await this._loadCatalog();
      if (gen !== this._playGen) return;
      if (!this._catalog || !this._catalog.has(t)) return;

      const pad = String(t).padStart(2, '0');
      for (const ext of ['ogg', 'mp3']) {
        if (gen !== this._playGen) return;
        const url = `music/track${pad}.${ext}`;
        const el = new Audio(url);
        el.dataset.track = String(t);
        el.loop = this.looping;
        el.volume = 0.5;
        try {
          await el.play();
        } catch {
          continue;
        }
        if (gen !== this._playGen) {
          el.pause();
          return;
        }
        this._el = el;
        this.playing = true;
        return;
      }
    })();
  }

  /** CDAudio_Stop */
  stop() {
    this._playGen += 1;
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
