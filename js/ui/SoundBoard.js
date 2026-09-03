/**
 * SoundBoard - short interface sounds.
 *
 * Uses the Web Audio API rather than <audio> elements because the same cue can
 * retrigger before the previous one has finished (walk out of range and back in
 * quickly), and an <audio> element can only play one instance of itself.
 *
 * Browsers refuse to start audio before the player has interacted with the
 * page, so the context starts suspended and is resumed on the first tap, click
 * or key press. Nothing here ever throws into the game loop: if audio is
 * blocked or a file is missing, the game simply stays silent.
 */
const SOUNDS = {
  talkReady: "spoken_game/ui_elements/sound/bell_ringtone.wav"
};

export class SoundBoard {
  constructor({ enabled = true, volume = 0.5 } = {}) {
    this.enabled = enabled;
    this.volume = volume;
    this.buffers = new Map();
    this.lastPlayed = new Map();
    this.ctx = null;
    this.unlocked = false;
    this.bindUnlock();
  }

  static get names() { return Object.keys(SOUNDS); }

  /** The audio context can only start from a user gesture. */
  bindUnlock() {
    const unlock = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      this.unlocked = true;
    };
    ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
      window.addEventListener(ev, unlock, { once: false, passive: true }));
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { this.ctx = new Ctx(); } catch (err) { this.ctx = null; }
    return this.ctx;
  }

  /** Fetch + decode once, then keep the buffer. Failures are remembered. */
  async load(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const url = SOUNDS[name];
    const ctx = this.ensureContext();
    if (!url || !ctx) return null;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(name, buffer);
      return buffer;
    } catch (err) {
      console.warn("Sound '" + name + "' could not be loaded (" + url + ")", err);
      this.buffers.set(name, null);
      return null;
    }
  }

  preload() {
    SoundBoard.names.forEach((n) => this.load(n));
  }

  /**
   * @param {string} name
   * @param {object} [opts] { cooldown: ms before this cue may repeat, volume }
   */
  play(name, { cooldown = 400, volume } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Walking in and out of range repeatedly must not machine-gun the bell.
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) || -Infinity) < cooldown) return;

    const buffer = this.buffers.get(name);
    if (buffer === undefined) { this.load(name); return; }   // not ready yet
    if (!buffer) return;                                     // known failure

    if (ctx.state === "suspended") { ctx.resume().catch(() => {}); }

    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = volume != null ? volume : this.volume;
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.start(0);
      this.lastPlayed.set(name, now);
    } catch (err) {
      // A blocked or closed context must never break the frame it happened in.
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
  }
}
