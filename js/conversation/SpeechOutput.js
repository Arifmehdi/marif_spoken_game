/**
 * SpeechOutput - NPC voice using the browser's speech synthesiser.
 *
 * Every NPC gets a stable pitch/rate so the teacher and the shopkeeper do not
 * sound identical, without shipping a single audio file.
 */
const VOICE_PROFILES = {
  teacher:     { pitch: 1.15, rate: 0.90, prefer: ["female"] },
  friend:      { pitch: 1.35, rate: 1.00, prefer: ["female"] },
  shopkeeper:  { pitch: 0.85, rate: 0.95, prefer: ["male"] },
  waiter:      { pitch: 1.00, rate: 1.00, prefer: ["male"] },
  police:      { pitch: 0.80, rate: 0.90, prefer: ["male"] },
  mother:      { pitch: 1.25, rate: 0.92, prefer: ["female"] },
  doctor:      { pitch: 0.95, rate: 0.88, prefer: ["female"] },
  default:     { pitch: 1.00, rate: 0.95, prefer: [] }
};

export class SpeechOutput {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.lang = options.lang || "en-IN";
    this.voices = [];
    this.synth = window.speechSynthesis || null;
    this.current = null;
    if (this.synth) {
      this.loadVoices();
      this.synth.addEventListener("voiceschanged", () => this.loadVoices());
    }
  }

  static isSupported() {
    return !!window.speechSynthesis;
  }

  loadVoices() {
    this.voices = this.synth ? this.synth.getVoices() : [];
  }

  pickVoice(profile) {
    if (!this.voices.length) this.loadVoices();
    const english = this.voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
    if (!english.length) return null;

    const exact = english.filter((v) => v.lang.replace("_", "-") === this.lang);
    const pool = exact.length ? exact : english;

    for (const want of profile.prefer) {
      const match = pool.find((v) => v.name.toLowerCase().includes(want));
      if (match) return match;
    }
    return pool[0];
  }

  /** Resolves when the line finishes (or immediately if audio is off). */
  speak(text, role = "default") {
    return new Promise((resolve) => {
      if (!this.enabled || !this.synth || !text) return resolve();
      this.cancel();

      const profile = VOICE_PROFILES[role] || VOICE_PROFILES.default;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = this.lang;
      utter.pitch = profile.pitch;
      utter.rate = profile.rate;
      const voice = this.pickVoice(profile);
      if (voice) utter.voice = voice;

      let settled = false;
      const finish = () => { if (!settled) { settled = true; this.current = null; resolve(); } };
      utter.onend = finish;
      utter.onerror = finish;

      // Chrome sometimes drops the end event on long lines; estimate a ceiling
      // (~11 characters per second) so the conversation can never stall.
      const ceiling = Math.min(15000, 1200 + (text.length / 11) * 1000);
      setTimeout(finish, ceiling);

      this.current = utter;
      this.synth.speak(utter);
    });
  }

  cancel() {
    if (this.synth) {
      try { this.synth.cancel(); } catch (err) { /* nothing playing */ }
    }
    this.current = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.cancel();
  }

  setLanguage(lang) {
    this.lang = lang;
  }
}
