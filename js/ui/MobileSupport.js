/**
 * MobileSupport - makes the game playable on a phone.
 *
 * This is an isometric 3D game: in portrait the camera aspect drops to ~0.46
 * and you can barely see the world. Rather than fight that, portrait phones get
 * a "turn your device" gate, and the game runs in landscape where it belongs.
 *
 * Also offers fullscreen, which on Android both removes the browser chrome
 * (worth ~15% of the screen) and allows the orientation lock.
 */
const PHONE_MAX_SHORT_SIDE = 560;   // tablets are wide enough to play in portrait

export class MobileSupport {
  constructor({ onBlock, onResume } = {}) {
    this.onBlock = onBlock || (() => {});
    this.onResume = onResume || (() => {});
    this.gate = document.querySelector("#rotate-gate");
    this.blocked = false;

    this.bind();
    this.check();
  }

  /** Touch device? Desktop browsers resized small should not get the gate. */
  static isTouch() {
    return (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  }

  static isPortrait() {
    return window.innerHeight > window.innerWidth;
  }

  /** A phone, not a tablet - judged by the shorter side in CSS pixels. */
  static isSmallScreen() {
    return Math.min(window.innerWidth, window.innerHeight) <= PHONE_MAX_SHORT_SIDE;
  }

  static shouldBlock() {
    return MobileSupport.isTouch() && MobileSupport.isPortrait() && MobileSupport.isSmallScreen();
  }

  bind() {
    const recheck = () => this.check();
    window.addEventListener("resize", recheck);
    window.addEventListener("orientationchange", () => setTimeout(recheck, 250));
    if (screen.orientation) screen.orientation.addEventListener("change", () => setTimeout(recheck, 250));

    // A media-query listener fires in cases a plain resize event does not
    // (some in-app browsers, devtools emulation, split-screen changes).
    if (typeof matchMedia === "function") {
      const mq = matchMedia("(orientation: portrait)");
      if (mq.addEventListener) mq.addEventListener("change", () => setTimeout(recheck, 120));
      else if (mq.addListener) mq.addListener(() => setTimeout(recheck, 120));
    }
    if (window.visualViewport) window.visualViewport.addEventListener("resize", recheck);

    // Safety net: orientation is too important to leave to events alone. This
    // only compares a few booleans, and check() returns immediately when
    // nothing has changed.
    this.timer = setInterval(recheck, 500);

    const btn = document.querySelector("#rotate-fullscreen");
    if (btn) btn.addEventListener("click", () => this.enterFullscreen());
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
  }

  check() {
    const block = MobileSupport.shouldBlock();
    if (block === this.blocked) return;
    this.blocked = block;

    if (this.gate) this.gate.classList.toggle("hidden", !block);
    document.body.classList.toggle("is-rotate-blocked", block);
    block ? this.onBlock() : this.onResume();
  }

  /**
   * Fullscreen + landscape lock. Must be called from a user gesture, and the
   * lock only works while fullscreen. Both are best-effort: iOS Safari supports
   * neither, which is why the gate text asks the player to rotate manually.
   */
  async enterFullscreen() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    } catch (err) {
      // Refused (often iOS) - the player can still rotate by hand.
    }
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock("landscape");
      }
    } catch (err) {
      // Not supported or not permitted; harmless.
    }
    setTimeout(() => this.check(), 300);
  }

  static isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  static async toggleFullscreen() {
    if (MobileSupport.isFullscreen()) {
      try { await document.exitFullscreen(); } catch (err) { /* ignore */ }
      return false;
    }
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      if (screen.orientation && screen.orientation.lock && MobileSupport.isTouch()) {
        try { await screen.orientation.lock("landscape"); } catch (e) { /* ignore */ }
      }
      return true;
    } catch (err) {
      return false;
    }
  }
}
