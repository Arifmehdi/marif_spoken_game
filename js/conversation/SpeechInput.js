/**
 * SpeechInput - thin wrapper over the Web Speech API (SpeechRecognition).
 *
 * Chrome, Edge and Android Chrome support this. Firefox and iOS Safari do not,
 * so isSupported() is checked by the UI and the typing box becomes the primary
 * input there. The game is fully playable either way.
 *
 * Note: the API needs https:// or http://localhost - it is silently blocked on
 * a plain http:// LAN address.
 */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class SpeechInput {
  constructor(options = {}) {
    this.lang = options.lang || "en-IN";
    this.recognition = null;
    this.listening = false;
    this.handlers = { start: [], partial: [], result: [], error: [], end: [] };
    this._finalTranscript = "";
    this._confidence = null;
  }

  static isSupported() {
    return !!SR;
  }

  static get unsupportedReason() {
    if (SR) return null;
    if (!window.isSecureContext && location.hostname !== "localhost") {
      return "Speech needs https or localhost. Type your answer instead.";
    }
    return "This browser cannot listen yet. Use Chrome or Edge, or type your answer.";
  }

  on(event, fn) {
    if (this.handlers[event]) this.handlers[event].push(fn);
    return this;
  }

  emit(event, ...args) {
    (this.handlers[event] || []).forEach((fn) => fn(...args));
  }

  setLanguage(lang) {
    this.lang = lang;
    if (this.recognition) this.recognition.lang = lang;
  }

  build() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onstart = () => {
      this.listening = true;
      this._finalTranscript = "";
      this._confidence = null;
      this.emit("start");
    };

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const alt = res[0];
        if (res.isFinal) {
          this._finalTranscript += alt.transcript + " ";
          // Confidence is 0 on some builds; treat that as "unknown" rather than "bad".
          if (typeof alt.confidence === "number" && alt.confidence > 0) {
            this._confidence = alt.confidence;
          }
        } else {
          interim += alt.transcript;
        }
      }
      if (interim) this.emit("partial", interim.trim());
    };

    rec.onerror = (event) => {
      this.listening = false;
      this.emit("error", this.describeError(event.error), event.error);
    };

    rec.onend = () => {
      this.listening = false;
      const text = this._finalTranscript.trim();
      this.emit("end");
      // Always report - an empty transcript is a valid "I did not catch that".
      this.emit("result", text, this._confidence);
    };

    return rec;
  }

  describeError(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microphone blocked. Allow the mic in your browser, or type your answer.";
      case "no-speech":
        return "I did not hear anything. Try again a little louder.";
      case "audio-capture":
        return "No microphone found. You can type your answer instead.";
      case "network":
        return "Speech service is offline. Please type your answer.";
      case "aborted":
        return null;
      default:
        return "Speech input failed. Please type your answer.";
    }
  }

  start() {
    if (!SR) {
      this.emit("error", SpeechInput.unsupportedReason, "unsupported");
      return false;
    }
    if (this.listening) return false;
    try {
      this.recognition = this.build();
      this.recognition.start();
      return true;
    } catch (err) {
      this.emit("error", "Could not start the microphone. Please type your answer.", "start-failed");
      return false;
    }
  }

  stop() {
    if (this.recognition && this.listening) {
      try { this.recognition.stop(); } catch (err) { /* already stopping */ }
    }
  }

  abort() {
    if (this.recognition) {
      try { this.recognition.abort(); } catch (err) { /* nothing to abort */ }
    }
    this.listening = false;
  }
}
