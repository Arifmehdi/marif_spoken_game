/**
 * InputManager - one movement vector, whatever the device.
 *
 * Keyboard (WASD / arrows) on desktop, an on-screen thumbstick on touch.
 * Both write into the same { x, y } so Player never branches on input type.
 */
export class InputManager {
  constructor(options = {}) {
    this.move = { x: 0, y: 0 };

    // Three independent ways to run, OR-ed together by the `running` getter:
    //   runLatched - the Run button, a sticky toggle (stays on until tapped off)
    //   runHeld    - Shift held on a keyboard, temporary
    //   stickBoost - thumbstick pushed all the way over, temporary
    this.runLatched = false;
    this.runHeld = false;
    this.stickBoost = false;

    this.keys = new Set();
    this.enabled = true;
    this.actionHandlers = [];
    this.stick = { active: false, id: null, cx: 0, cy: 0, radius: 56 };
    this.runButton = null;
    this.bind(options);
  }

  get running() {
    return this.runLatched || this.runHeld || this.stickBoost;
  }

  onAction(fn) { this.actionHandlers.push(fn); return this; }
  emitAction(name) { this.actionHandlers.forEach((fn) => fn(name)); }

  bind({ joystick, knob, runButton }) {
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => { this.keys.clear(); this.updateFromKeys(); });

    if (joystick && knob) this.bindStick(joystick, knob);

    if (runButton) {
      this.runButton = runButton;
      // Tap to select, tap again to deselect. Holding it down is no good on a
      // phone - the other thumb is busy on the joystick.
      runButton.addEventListener("click", (e) => {
        e.preventDefault();
        this.setRunLatched(!this.runLatched);
      });
      this.paintRunButton();
    }
  }

  setRunLatched(on) {
    this.runLatched = on;
    this.paintRunButton();
  }

  paintRunButton() {
    const btn = this.runButton;
    if (!btn) return;
    btn.classList.toggle("is-latched", this.runLatched);
    btn.setAttribute("aria-pressed", this.runLatched ? "true" : "false");
    const label = btn.querySelector(".btn-label");
    if (label) label.textContent = this.runLatched ? "Running" : "Run";
  }

  onKey(e, down) {
    // Never steal keys while the student is typing an answer.
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const k = e.key.toLowerCase();
    if (down) {
      if (k === "e") this.emitAction("interact");
      if (k === "m") this.emitAction("mic");
      if (k === "escape") this.emitAction("cancel");
    }
    const tracked = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"];
    if (!tracked.includes(k)) return;
    e.preventDefault();
    down ? this.keys.add(k) : this.keys.delete(k);
    this.runHeld = this.keys.has("shift");
    this.updateFromKeys();
  }

  updateFromKeys() {
    if (this.stick.active) return;
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has("a") || k.has("arrowleft")) x -= 1;
    if (k.has("d") || k.has("arrowright")) x += 1;
    if (k.has("w") || k.has("arrowup")) y -= 1;
    if (k.has("s") || k.has("arrowdown")) y += 1;
    const len = Math.hypot(x, y);
    this.move.x = len ? x / len : 0;
    this.move.y = len ? y / len : 0;
  }

  bindStick(pad, knob) {
    const reset = () => {
      this.stick.active = false;
      this.stick.id = null;
      this.stickBoost = false;      // releasing the stick must drop the boost
      knob.style.transform = "translate(-50%, -50%)";
      this.updateFromKeys();
    };

    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const rect = pad.getBoundingClientRect();
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.stick.cx = rect.left + rect.width / 2;
      this.stick.cy = rect.top + rect.height / 2;
      this.stick.radius = rect.width / 2 - 6;
      pad.setPointerCapture(e.pointerId);
      this.dragStick(e, knob);
    });

    pad.addEventListener("pointermove", (e) => {
      if (!this.stick.active || e.pointerId !== this.stick.id) return;
      this.dragStick(e, knob);
    });

    ["pointerup", "pointercancel"].forEach((ev) =>
      pad.addEventListener(ev, (e) => {
        if (e.pointerId !== this.stick.id) return;
        reset();
      }));
  }

  dragStick(e, knob) {
    let dx = e.clientX - this.stick.cx;
    let dy = e.clientY - this.stick.cy;
    const dist = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(dist, this.stick.radius);
    dx = (dx / dist) * clamped;
    dy = (dy / dist) * clamped;
    knob.style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px))";
    this.move.x = dx / this.stick.radius;
    this.move.y = dy / this.stick.radius;
    this.stickBoost = clamped / this.stick.radius > 0.85;
  }

  /**
   * Freeze movement while a conversation or menu is open. The Run toggle is a
   * deliberate choice by the player, so it survives; the momentary boosts do not.
   */
  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.move.x = 0;
      this.move.y = 0;
      this.keys.clear();
      this.runHeld = false;
      this.stickBoost = false;
    }
  }

  get vector() {
    return this.enabled ? this.move : { x: 0, y: 0 };
  }
}
