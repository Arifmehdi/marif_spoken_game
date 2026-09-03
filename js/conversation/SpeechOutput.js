/**
 * SpeechOutput - NPC voice using the browser's speech synthesiser.
 *
 * The voice follows the character's GENDER, which is decided once in Casting.js
 * and is the same value that chose their 3D model, so nobody speaks with the
 * wrong voice for their body. Role only adds personality on top: a small pitch
 * offset and a speaking rate, so the teacher and the shopkeeper do not sound
 * identical without shipping a single audio file.
 */
const ROLE_STYLE = {
  teacher:     { rate: 0.90, pitch:  0.08 },
  friend:      { rate: 1.00, pitch:  0.18 },
  shopkeeper:  { rate: 0.95, pitch: -0.05 },
  waiter:      { rate: 1.00, pitch:  0.00 },
  police:      { rate: 0.90, pitch: -0.12 },
  mother:      { rate: 0.92, pitch:  0.12 },
  doctor:      { rate: 0.88, pitch: -0.02 },
  default:     { rate: 0.95, pitch:  0.00 }
};

const BASE_PITCH = { female: 1.15, male: 0.80 };

/**
 * Which gender a system voice sounds like.
 *
 * The old matcher did name.includes("male"), and "female" contains "male" - so
 * asking for a man returned "Google UK English Female", which sits before
 * "Google UK English Male" in Chrome's list. That is why every character spoke
 * with a woman's voice. \b stops that: in "female" there is no word boundary in
 * front of "male". Female is still tested first as a second line of defence.
 *
 * Most voices never state a gender at all ("Microsoft David", "Zira",
 * "Samantha"), so the common names ship here too - without them there is
 * nothing to match on and everyone falls back to whichever voice is first.
 */
const FEMALE_VOICE = /\b(female|woman|girl)\b|zira|susan|hazel|heera|veena|samantha|karen|moira|tessa|fiona|victoria|allison|ava|serena|catherine|linda|aria|jenny|michelle|sonia|libby|neerja|kalpana|swara|salli|joanna|kendra|kimberly|amy|emma|nicole|raveena|aditi/i;
const MALE_VOICE = /\b(male|man|boy)\b|david|mark|george|james|daniel|alex|fred|guy|ryan|thomas|william|arthur|oliver|liam|brian|eric|christopher|roger|steffan|hemant|madhur|prabhat|ravi|rishi|matthew|joey|justin|russell|geraint|aaron|nathan/i;

function voiceGender(voice) {
  const name = (voice && voice.name) || "";
  if (FEMALE_VOICE.test(name)) return "female";
  if (MALE_VOICE.test(name)) return "male";
  return null;
}

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

  /**
   * @returns {{ voice: SpeechSynthesisVoice|null, matched: boolean }}
   *   `matched` is false when the device simply has no voice of that gender -
   *   many Android builds ship exactly one. speak() then widens the pitch gap
   *   so a man and a woman are still told apart by ear.
   */
  pickVoice(gender) {
    if (!this.voices.length) this.loadVoices();
    const english = this.voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
    if (!english.length) return { voice: null, matched: false };

    const exact = english.filter((v) => v.lang.replace("_", "-") === this.lang);

    // Prefer the requested accent, but a correctly gendered voice in another
    // English accent beats the right accent in the wrong voice.
    for (const pool of [exact, english]) {
      const match = pool.find((v) => voiceGender(v) === gender);
      if (match) return { voice: match, matched: true };
    }

    // Nothing identifiable: take a voice that is at least not known to be the
    // opposite gender, else whatever is available.
    const pool = exact.length ? exact : english;
    const neutral = pool.find((v) => voiceGender(v) === null);
    return { voice: neutral || pool[0], matched: false };
  }

  /**
   * Resolves when the line finishes (or immediately if audio is off).
   * @param {string} text
   * @param {string} role     personality only - pitch offset and rate
   * @param {"male"|"female"} gender  chooses the actual voice
   */
  speak(text, role = "default", gender = "female") {
    return new Promise((resolve) => {
      if (!this.enabled || !this.synth || !text) return resolve();
      this.cancel();

      const style = ROLE_STYLE[role] || ROLE_STYLE.default;
      const picked = this.pickVoice(gender);

      // With a properly gendered voice the pitch only has to carry the
      // character's personality. Without one it has to carry the gender too, so
      // push it much further from neutral.
      const base = BASE_PITCH[gender] != null ? BASE_PITCH[gender] : 1;
      const spread = picked.matched ? 1 : 1.8;
      const pitch = 1 + (base + style.pitch - 1) * spread;

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = this.lang;
      utter.pitch = Math.min(2, Math.max(0.1, pitch));
      utter.rate = style.rate;
      // Chrome throws if this is not a live SpeechSynthesisVoice - which can
      // happen when the voice list is swapped out underneath us. The device
      // default is a fine substitute; a thrown error here is not.
      try { if (picked.voice) utter.voice = picked.voice; } catch (err) { /* device default */ }

      let settled = false;
      const finish = () => {
        if (settled) return;
        // While paused, hold the promise open. Resolving here would let the
        // conversation advance to the next turn behind the pause screen.
        if (this.paused) { setTimeout(finish, 250); return; }
        settled = true;
        this.current = null;
        resolve();
      };
      utter.onend = finish;
      utter.onerror = finish;

      // Chrome sometimes drops the end event on long lines; estimate a ceiling
      // (~11 characters per second) so the conversation can never stall.
      const ceiling = Math.min(15000, 1200 + (text.length / 11) * 1000);
      setTimeout(finish, ceiling);

      this.current = utter;
      try {
        this.synth.speak(utter);
      } catch (err) {
        // ConversationEngine awaits this promise, so a throwing synthesiser
        // would leave the lesson stuck on the NPC's line forever. Losing the
        // audio is survivable; losing the conversation is not.
        console.warn("Speech synthesis refused a line; continuing silently", err);
        finish();
      }
    });
  }

  cancel() {
    if (this.synth) {
      try { this.synth.cancel(); } catch (err) { /* nothing playing */ }
    }
    this.current = null;
  }

  /**
   * Hold the current line mid-sentence. Deliberately NOT cancel(): cancelling
   * fires onend, which would resolve speak() and advance the conversation
   * while the pause screen is up.
   */
  pause() {
    this.paused = true;
    if (this.synth) {
      try { this.synth.pause(); } catch (err) { /* not speaking */ }
    }
  }

  resume() {
    this.paused = false;
    if (this.synth) {
      try { this.synth.resume(); } catch (err) { /* nothing to resume */ }
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.cancel();
  }

  setLanguage(lang) {
    this.lang = lang;
  }
}
