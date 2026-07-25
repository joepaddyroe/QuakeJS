/**
 * Client sound (snd_dma.c / snd_mem.c subset) → Web Audio.
 * Loads Quake WAVs from PAK (`sound/…`), spatializes like SND_Spatialize.
 */

const CLIP_DIST = 1000;
const MAX_CHANNELS = 128;

/**
 * @param {string} sample QC path e.g. "doors/dr1_strt.wav"
 * @returns {string} PAK path
 */
function soundPath(sample) {
  let s = sample.replace(/\\/g, '/').toLowerCase();
  if (s.startsWith('sound/')) return s;
  return `sound/${s}`;
}

/**
 * Manual decode for Quake-style PCM WAVs if decodeAudioData fails.
 * @param {ArrayBuffer} buf
 * @param {AudioContext} ctx
 * @returns {AudioBuffer|null}
 */
function decodeWavPcm(buf, ctx) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 44) return null;
  const view = new DataView(buf);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'RIFF') {
    return null;
  }
  if (String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let format = 1;
  let channels = 1;
  let sampleRate = 11025;
  let bitsPerSample = 8;
  /** @type {Uint8Array|null} */
  let pcm = null;

  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(dataStart, true);
      channels = view.getUint16(dataStart + 2, true);
      sampleRate = view.getUint32(dataStart + 4, true);
      bitsPerSample = view.getUint16(dataStart + 14, true);
    } else if (id === 'data') {
      pcm = bytes.subarray(dataStart, Math.min(dataStart + size, bytes.length));
      break;
    }
    offset = dataStart + ((size + 1) & ~1);
  }

  if (!pcm || format !== 1 || channels < 1) return null;

  const frames = (pcm.length / channels / (bitsPerSample / 8)) | 0;
  if (frames <= 0) return null;

  const audio = ctx.createBuffer(1, frames, sampleRate);
  const out = audio.getChannelData(0);
  if (bitsPerSample === 8) {
    for (let i = 0; i < frames; i++) {
      out[i] = (pcm[i * channels] - 128) / 128;
    }
  } else if (bitsPerSample === 16) {
    const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < frames; i++) {
      out[i] = dv.getInt16(i * channels * 2, true) / 32768;
    }
  } else {
    return null;
  }
  return audio;
}

export class SoundSystem {
  /**
   * @param {import('../fs/FileSystem.js').FileSystem} fs
   */
  constructor(fs) {
    this._fs = fs;
    /** @type {AudioContext|null} */
    this._ctx = null;
    /** @type {GainNode|null} */
    this._master = null;
    /** @type {Map<string, AudioBuffer>} */
    this._buffers = new Map();
    /** @type {Map<string, Promise<AudioBuffer|null>>} */
    this._loading = new Map();
    /** @type {Set<string>} */
    this._failed = new Set();
    /** @type {Map<string, { stop: () => void }>} */
    this._active = new Map();
    /** @type {{ sample: string, origin: number[], vol: number, atten: number, stop: (() => void)|null }[]} */
    this._statics = [];
    this._volume = 0.7;
    this._enabled = true;
    this._listenerOrigin = new Float32Array(3);
    this._listenerRight = new Float32Array([0, -1, 0]);
    this._viewEntity = 1;
    this._autoSeq = 0;
  }

  /**
   * Master volume 0..1 (cvar `volume`).
   * @param {number} v
   */
  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._master) this._master.gain.value = this._volume;
  }

  /** Ensure AudioContext exists (may still be suspended until gesture). */
  _ensureCtx() {
    if (this._ctx) return this._ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this._enabled = false;
      return null;
    }
    this._ctx = new AC();
    this._master = this._ctx.createGain();
    this._master.gain.value = this._volume;
    this._master.connect(this._ctx.destination);
    return this._ctx;
  }

  /**
   * Browsers require a user gesture before audio starts.
   * @returns {Promise<void>}
   */
  async unlock() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * @param {string} sample
   */
  precache(sample) {
    if (!sample) return;
    void this._loadBuffer(sample);
  }

  /**
   * @param {string} sample
   * @returns {Promise<AudioBuffer|null>}
   */
  async _loadBuffer(sample) {
    const key = soundPath(sample);
    const cached = this._buffers.get(key);
    if (cached) return cached;
    if (this._failed.has(key)) return null;
    const pending = this._loading.get(key);
    if (pending) return pending;

    const ctx = this._ensureCtx();
    if (!ctx) return null;

    const promise = (async () => {
      try {
        if (!this._fs.has(key)) {
          this._failed.add(key);
          return null;
        }
        const data = this._fs.load(key);
        const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        let buffer = null;
        try {
          buffer = await ctx.decodeAudioData(copy.slice(0));
        } catch {
          buffer = decodeWavPcm(copy, ctx);
        }
        if (!buffer) {
          this._failed.add(key);
          return null;
        }
        this._buffers.set(key, buffer);
        return buffer;
      } catch (err) {
        console.warn(`[sound] failed ${key}`, err);
        this._failed.add(key);
        return null;
      } finally {
        this._loading.delete(key);
      }
    })();

    this._loading.set(key, promise);
    return promise;
  }

  /**
   * Quake SND_Spatialize → { left, right } in 0..1 master-scaled.
   * @param {number} entnum
   * @param {number[]|Float32Array} origin
   * @param {number} masterVol 0..255
   * @param {number} attenuation
   */
  _spatialize(entnum, origin, masterVol, attenuation) {
    const master = Math.max(0, Math.min(255, masterVol)) / 255;
    if (entnum === this._viewEntity || attenuation <= 0) {
      return { left: master, right: master };
    }
    const lx = this._listenerOrigin[0];
    const ly = this._listenerOrigin[1];
    const lz = this._listenerOrigin[2];
    let sx = origin[0] - lx;
    let sy = origin[1] - ly;
    let sz = origin[2] - lz;
    const len = Math.hypot(sx, sy, sz) || 1;
    sx /= len;
    sy /= len;
    sz /= len;
    const dist = len * (attenuation / CLIP_DIST);
    const dot =
      this._listenerRight[0] * sx +
      this._listenerRight[1] * sy +
      this._listenerRight[2] * sz;
    const rscale = 1 + dot;
    const lscale = 1 - dot;
    let right = master * (1 - dist) * rscale;
    let left = master * (1 - dist) * lscale;
    if (right < 0) right = 0;
    if (left < 0) left = 0;
    return { left, right };
  }

  /**
   * Play a loaded buffer with L/R gains.
   * @param {AudioBuffer} buffer
   * @param {number} left
   * @param {number} right
   * @param {boolean} loop
   * @returns {{ stop: () => void, setVol: (l: number, r: number) => void } | null}
   */
  _playBuffer(buffer, left, right, loop) {
    const ctx = this._ensureCtx();
    if (!ctx || !this._master) return null;
    if (left <= 0 && right <= 0) return null;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gL = ctx.createGain();
    const gR = ctx.createGain();
    gL.gain.value = left;
    gR.gain.value = right;

    const merger = ctx.createChannelMerger(2);
    source.connect(gL);
    source.connect(gR);
    gL.connect(merger, 0, 0);
    gR.connect(merger, 0, 1);
    merger.connect(this._master);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
        gL.disconnect();
        gR.disconnect();
        merger.disconnect();
      } catch {
        /* ignore */
      }
    };
    source.onended = () => stop();
    try {
      source.start(0);
    } catch {
      return null;
    }
    return {
      stop,
      setVol(l, r) {
        gL.gain.value = l;
        gR.gain.value = r;
      },
    };
  }

  /**
   * UI / weapon local sound (S_LocalSound) — full volume, no attenuation.
   * @param {string} sample
   */
  playLocal(sample) {
    if (!sample) return;
    void this.unlock();
    this.startSound(
      this._viewEntity,
      0,
      sample,
      this._listenerOrigin,
      255,
      0,
    );
  }

  /**
   * S_StartSound — volume is 0..255 (SV_StartSound / PF_sound).
   * @param {number} entnum
   * @param {number} entchannel 0 = auto
   * @param {string} sample
   * @param {number[]|Float32Array} origin
   * @param {number} volume255
   * @param {number} attenuation
   */
  startSound(entnum, entchannel, sample, origin, volume255, attenuation) {
    if (!this._enabled || !sample) return;
    void this.unlock();

    const key =
      entchannel === 0
        ? `auto:${entnum}:${this._autoSeq++}`
        : `${entnum}:${entchannel}`;

    const prev = this._active.get(key);
    if (prev) {
      prev.stop();
      this._active.delete(key);
    }

    const org = [origin[0], origin[1], origin[2]];
    const { left, right } = this._spatialize(entnum, org, volume255, attenuation);
    if (left <= 0 && right <= 0) return;

    void this._loadBuffer(sample).then((buffer) => {
      if (!buffer) return;
      // Recompute spatialize in case listener moved while loading
      const vols = this._spatialize(entnum, org, volume255, attenuation);
      if (vols.left <= 0 && vols.right <= 0) return;
      if (this._active.size >= MAX_CHANNELS) {
        const first = this._active.keys().next().value;
        if (first != null) {
          this._active.get(first)?.stop();
          this._active.delete(first);
        }
      }
      const play = this._playBuffer(buffer, vols.left, vols.right, false);
      if (!play) return;
      this._active.set(key, play);
      // Drop from map when finished (onended → stop)
      const origStop = play.stop;
      play.stop = () => {
        origStop();
        if (this._active.get(key) === play) this._active.delete(key);
      };
    });
  }

  /**
   * Ambient / static loop (svc_spawnstaticsound / S_StaticSound).
   * @param {string} sample
   * @param {number[]|Float32Array} origin
   * @param {number} vol 0..1 (QC ambientsound)
   * @param {number} attenuation
   */
  startStaticSound(sample, origin, vol, attenuation) {
    if (!this._enabled || !sample) return;
    const entry = {
      sample,
      origin: [origin[0], origin[1], origin[2]],
      vol: Math.max(0, Math.min(1, vol)),
      atten: attenuation,
      /** @type {(() => void)|null} */
      stop: null,
      /** @type {{ setVol: (l: number, r: number) => void }|null} */
      play: null,
    };
    this._statics.push(entry);
    void this._loadBuffer(sample).then((buffer) => {
      if (!buffer) return;
      const vols = this._spatialize(
        0,
        entry.origin,
        entry.vol * 255,
        entry.atten,
      );
      const play = this._playBuffer(buffer, vols.left, vols.right, true);
      if (!play) return;
      entry.play = play;
      entry.stop = play.stop;
    });
  }

  /**
   * S_Update — set listener and refresh static volumes.
   * @param {number[]|Float32Array} origin
   * @param {number[]|Float32Array} forward
   * @param {number[]|Float32Array} right
   * @param {number[]|Float32Array} _up
   */
  update(origin, forward, right, _up) {
    this._listenerOrigin[0] = origin[0];
    this._listenerOrigin[1] = origin[1];
    this._listenerOrigin[2] = origin[2];
    this._listenerRight[0] = right[0];
    this._listenerRight[1] = right[1];
    this._listenerRight[2] = right[2];

    for (const s of this._statics) {
      if (!s.play) continue;
      const vols = this._spatialize(0, s.origin, s.vol * 255, s.atten);
      s.play.setVol(vols.left, vols.right);
    }
    void forward;
  }

  stopAll() {
    for (const play of this._active.values()) play.stop();
    this._active.clear();
    for (const s of this._statics) {
      if (s.stop) s.stop();
    }
    this._statics = [];
  }
}
