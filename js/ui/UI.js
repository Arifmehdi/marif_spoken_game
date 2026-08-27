/**
 * UI - the HUD, the world-anchored speech bubbles and the answer panel.
 *
 * Holds no game rules. It renders what it is told and reports what the student
 * did through callbacks, so the conversation engine stays testable in Node.
 */
const $ = (sel) => document.querySelector(sel);

export class UI {
  constructor() {
    this.el = {
      bubbles: $("#bubbles"),
      hud: $("#hud"),
      name: $("#hud-name"),
      level: $("#hud-level"),
      xpFill: $("#hud-xp-fill"),
      xpText: $("#hud-xp-text"),
      coins: $("#hud-coins"),
      streak: $("#hud-streak"),
      quest: $("#quest-card"),
      questText: $("#quest-text"),
      questCount: $("#quest-count"),
      controls: $("#controls"),
      interact: $("#btn-interact"),
      convo: $("#convo"),
      convoStep: $("#convo-step"),
      convoPrompt: $("#convo-prompt"),
      mic: $("#btn-mic"),
      micLabel: $("#mic-label"),
      micWave: $("#mic-wave"),
      input: $("#answer-input"),
      send: $("#btn-send"),
      hint: $("#btn-hint"),
      hintText: $("#hint-text"),
      leave: $("#btn-leave"),
      feedback: $("#feedback"),
      toast: $("#toast")
    };
    this.bubbleNodes = new Map();
    this.handlers = {};
    this.bind();
  }

  on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); return this; }
  emit(event, payload) { (this.handlers[event] || []).forEach((fn) => fn(payload)); }

  bind() {
    this.el.mic.addEventListener("click", () => this.emit("mic"));
    this.el.send.addEventListener("click", () => this.submitTyped());
    this.el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.submitTyped(); }
    });
    this.el.hint.addEventListener("click", () => {
      this.el.hintText.classList.toggle("hidden");
      this.el.hint.classList.toggle("is-active");
    });
    this.el.leave.addEventListener("click", () => this.emit("leave"));
    this.el.interact.addEventListener("click", () => this.emit("interact"));
  }

  submitTyped() {
    const text = this.el.input.value.trim();
    this.el.input.value = "";
    this.emit("answer", { text, mode: "type", confidence: null });
  }

  /* ----------------------------------------------------------------- HUD */

  renderHud(progress) {
    this.el.name.textContent = progress.data.playerName;
    this.el.level.textContent = "Level " + progress.level;
    const pct = Math.round((progress.xpIntoLevel / progress.xpForLevel) * 100);
    this.el.xpFill.style.width = pct + "%";
    this.el.xpText.textContent = progress.xpIntoLevel + " / " + progress.xpForLevel + " XP";
    this.el.coins.textContent = progress.coins;
    this.el.streak.textContent = progress.streak;
  }

  setQuest(text, count) {
    if (!text) { this.el.quest.classList.add("hidden"); return; }
    this.el.quest.classList.remove("hidden");
    this.el.questText.textContent = text;
    this.el.questCount.textContent = count || "";
  }

  showInteract(show, label) {
    this.el.interact.classList.toggle("hidden", !show);
    if (label) this.el.interact.querySelector(".btn-label").textContent = label;
  }

  setControlsVisible(on) {
    this.el.controls.classList.toggle("hidden", !on);
  }

  /** Hide the whole in-world interface while the title menu is showing. */
  setWorldUiVisible(on) {
    this.el.hud.classList.toggle("hidden", !on);
    this.el.controls.classList.toggle("hidden", !on);
    if (!on) { this.el.convo.classList.add("hidden"); this.clearBubbles(); }
  }

  /** Swap the HUD avatar for the chosen character's portrait. */
  setAvatar(src) {
    const el = document.querySelector("#hud .avatar");
    if (el) el.innerHTML = '<img src="' + src + '" alt="" />';
  }

  /* ------------------------------------------------------------- bubbles */

  /** @param {"npc"|"student"|"thought"} kind */
  showBubble(id, kind, name, text) {
    let node = this.bubbleNodes.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "bubble";
      this.el.bubbles.appendChild(node);
      this.bubbleNodes.set(id, node);
    }
    node.className = "bubble bubble-" + kind;
    node.innerHTML =
      '<span class="bubble-name">' + this.escape(name) + "</span>" +
      '<span class="bubble-text">' + this.escape(text) + "</span>";
    node.classList.remove("hidden");
    requestAnimationFrame(() => node.classList.add("is-in"));
    return node;
  }

  hideBubble(id) {
    const node = this.bubbleNodes.get(id);
    if (node) { node.classList.remove("is-in"); node.classList.add("hidden"); }
  }

  clearBubbles() {
    this.bubbleNodes.forEach((node) => { node.classList.add("hidden"); node.classList.remove("is-in"); });
  }

  /** Called every frame with screen coordinates from SceneManager.project(). */
  positionBubble(id, screen) {
    const node = this.bubbleNodes.get(id);
    if (!node || node.classList.contains("hidden")) return;
    node.style.left = screen.x + "px";
    node.style.top = screen.y + "px";
    node.style.opacity = screen.visible ? "1" : "0";
  }

  /* -------------------------------------------------------- answer panel */

  openConversation() {
    this.el.convo.classList.remove("hidden");
    this.el.feedback.classList.add("hidden");
  }

  closeConversation() {
    this.el.convo.classList.add("hidden");
    this.el.feedback.classList.add("hidden");
    this.clearBubbles();
    this.setMicState("idle");
  }

  askStudent({ prompt, hint, index, total, retry }) {
    this.el.convo.classList.remove("hidden");
    this.el.feedback.classList.add("hidden");
    this.el.convoStep.textContent = "Question " + index + " of " + total + (retry ? "  ·  one more try" : "");
    this.el.convoPrompt.textContent = prompt;
    this.el.hintText.textContent = hint || "";
    this.el.hintText.classList.add("hidden");
    this.el.hint.classList.remove("is-active");
    this.el.hint.classList.toggle("hidden", !hint);
    this.el.input.value = "";
    this.el.input.disabled = false;
    this.el.send.disabled = false;
    this.setMicState("idle");
    this.el.convo.classList.add("is-asking");
  }

  /** @param {"idle"|"listening"|"thinking"|"disabled"} state */
  setMicState(state, message) {
    const el = this.el;
    el.mic.classList.toggle("is-listening", state === "listening");
    el.mic.classList.toggle("is-disabled", state === "disabled");
    el.mic.disabled = state === "disabled" || state === "thinking";
    el.micWave.classList.toggle("is-on", state === "listening");
    const labels = {
      idle: "Tap to Speak",
      listening: "Listening...",
      thinking: "Checking...",
      disabled: message || "Type your answer"
    };
    el.micLabel.textContent = message && state !== "disabled" ? message : labels[state];
  }

  showPartial(text) {
    this.el.micLabel.textContent = text ? "“" + text + "”" : "Listening...";
  }

  lockAnswering(on) {
    this.el.input.disabled = on;
    this.el.send.disabled = on;
    this.el.mic.disabled = on;
  }

  /* ------------------------------------------------------------ feedback */

  showFeedback(result, { onContinue, onRetry }) {
    const el = this.el.feedback;
    const stars = this.starRow(result.stars);
    const chips = [];
    if (result.matchedKeywords && result.matchedKeywords.length) {
      chips.push('<span class="chip chip-good">' + result.matchedKeywords.map((k) => this.escape(k)).join(", ") + "</span>");
    }
    if (result.missingWords && result.missingWords.length) {
      chips.push('<span class="chip chip-miss">missing: ' + result.missingWords.map((k) => this.escape(k)).join(", ") + "</span>");
    }

    el.innerHTML =
      '<div class="fb-card ' + result.band.class + '">' +
        '<div class="fb-head">' +
          '<span class="fb-emoji">' + result.band.emoji + "</span>" +
          '<span class="fb-label">' + this.escape(result.band.label) + "</span>" +
          '<span class="fb-xp">+' + result.points + " XP</span>" +
        "</div>" +
        '<div class="fb-meter"><div class="fb-meter-fill" style="width:' + result.correctness + '%"></div></div>' +
        '<div class="fb-percent">Correctness: <strong>' + result.correctness + "%</strong></div>" +
        '<div class="fb-stars">' + stars + "</div>" +
        (result.transcript ? '<div class="fb-said">You said: “' + this.escape(result.transcript) + "”</div>" : "") +
        '<div class="fb-msg">' + this.escape(result.feedback) + "</div>" +
        (chips.length ? '<div class="fb-chips">' + chips.join("") + "</div>" : "") +
        '<div class="fb-actions">' +
          (result.canRetry ? '<button class="btn btn-ghost" id="fb-retry">Try Again</button>' : "") +
          '<button class="btn btn-primary" id="fb-next">Continue</button>' +
        "</div>" +
      "</div>";

    el.classList.remove("hidden");
    this.el.convo.classList.remove("is-asking");

    const next = el.querySelector("#fb-next");
    next.addEventListener("click", () => { el.classList.add("hidden"); onContinue(); });
    next.focus();
    const retry = el.querySelector("#fb-retry");
    if (retry) retry.addEventListener("click", () => { el.classList.add("hidden"); onRetry(); });
  }

  starRow(count, max = 5) {
    let out = "";
    for (let i = 0; i < max; i++) out += '<span class="star' + (i < count ? " is-on" : "") + '">★</span>';
    return out;
  }

  /* --------------------------------------------------------------- toast */

  toast(message, kind = "info", ms = 2600) {
    const node = document.createElement("div");
    node.className = "toast-item toast-" + kind;
    node.textContent = message;
    this.el.toast.appendChild(node);
    requestAnimationFrame(() => node.classList.add("is-in"));
    setTimeout(() => {
      node.classList.remove("is-in");
      setTimeout(() => node.remove(), 400);
    }, ms);
  }

  escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
}
