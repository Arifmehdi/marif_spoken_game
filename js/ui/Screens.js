/**
 * Screens - the full-screen panels: start, lesson brief, results, progress,
 * travel map and settings. All rendered into #screen-root.
 */
import { LOCATION_META } from "../world/LocationFactory.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const stars = (n, max = 5) => {
  let out = "";
  for (let i = 0; i < max; i++) out += '<span class="star' + (i < n ? " is-on" : "") + '">★</span>';
  return out;
};

export class Screens {
  constructor(root) {
    this.root = root;
    this.onClose = null;
  }

  /**
   * A dismissable popup closes three ways: its own Done/Close button, clicking
   * the dark area outside it, or the Escape key. There is deliberately no X in
   * the corner - every popup carries an explicit button instead.
   *
   * Screens opened with { dismissable: false } (results, errors) get none of
   * these - the player has to make a choice.
   */
  show(html, { dismissable = true } = {}) {
    this.root.innerHTML = '<div class="screen-backdrop"><div class="screen-card">' + html + "</div></div>";
    this.root.classList.remove("hidden");
    requestAnimationFrame(() => this.root.classList.add("is-in"));

    if (dismissable) {
      const back = this.root.querySelector(".screen-backdrop");
      back.addEventListener("click", (e) => { if (e.target === back) this.hide(); });
      this.bindEscape();
    }
    return this.root.querySelector(".screen-card");
  }

  bindEscape(fn) {
    this.unbindEscape();
    this.escHandler = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Capture phase + stopPropagation so the world's Escape binding (which
      // would abandon a conversation) never also fires.
      e.stopPropagation();
      if (fn) fn(); else this.hide();
    };
    window.addEventListener("keydown", this.escHandler, true);
  }

  /**
   * In-game confirmation, replacing the browser's native confirm(). Native
   * dialogs are blocked in some embedded contexts and look nothing like the
   * game. Not dismissable by clicking away - the player must choose - but
   * Escape maps to the safe option.
   */
  confirm(message, { title = "Are you sure?", yes = "Yes", no = "Cancel", danger = true, onYes, onNo } = {}) {
    // A confirm is a fresh decision - never inherit the previous screen's
    // onClose, or dismissing it would also fire that screen's return handler.
    this.onClose = null;
    const card = this.show(
      '<h2 class="screen-title">' + esc(title) + "</h2>" +
      '<p class="screen-sub confirm-msg">' + esc(message) + "</p>" +
      '<div class="screen-actions">' +
        '<button class="btn btn-ghost" id="cf-no">' + esc(no) + "</button>" +
        '<button class="btn ' + (danger ? "btn-danger-solid" : "btn-primary") + '" id="cf-yes">' + esc(yes) + "</button>" +
      "</div>",
      { dismissable: false });

    const cancel = () => { this.hide(); if (onNo) onNo(); };
    card.querySelector("#cf-no").addEventListener("click", cancel);
    card.querySelector("#cf-yes").addEventListener("click", () => { this.hide(); if (onYes) onYes(); });
    card.querySelector("#cf-no").focus();
    this.bindEscape(cancel);
    return card;
  }

  unbindEscape() {
    if (!this.escHandler) return;
    window.removeEventListener("keydown", this.escHandler, true);
    this.escHandler = null;
  }

  hide() {
    this.unbindEscape();
    this.root.classList.remove("is-in");
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    if (this.onClose) { const fn = this.onClose; this.onClose = null; fn(); }
  }

  get isOpen() { return !this.root.classList.contains("hidden"); }

  /* --------------------------------------------------------------- pause */

  /**
   * Pause menu. Not dismissable by clicking away - a stray tap on the backdrop
   * should never silently resume a paused lesson - but Escape resumes, which is
   * what every game does.
   *
   * @param {object} info { topic, day, step, total, inConversation }
   */
  pause(info, { onResume, onRestart, onSettings, onQuit }) {
    const where = info.topic
      ? '<div class="pause-where">Day ' + info.day + " · " + esc(info.topic) + "</div>" : "";
    const step = info.inConversation && info.total
      ? '<div class="pause-step">Question ' + info.step + " of " + info.total + "</div>" : "";

    const card = this.show(
      '<div class="pause-head">' +
        '<div class="pause-bars"><i></i><i></i></div>' +
        '<h2 class="screen-title">Paused</h2>' +
        where + step +
      "</div>" +
      '<div class="pause-actions">' +
        '<button class="btn btn-big btn-primary" id="pz-resume">Resume</button>' +
        (info.inConversation
          ? '<button class="btn btn-ghost" id="pz-restart">Restart Conversation</button>' : "") +
        '<button class="btn btn-ghost" id="pz-settings">Settings</button>' +
        '<button class="btn btn-danger" id="pz-quit">Quit to Menu</button>' +
      "</div>",
      { dismissable: false });

    card.querySelector("#pz-resume").addEventListener("click", onResume);
    card.querySelector("#pz-settings").addEventListener("click", onSettings);
    card.querySelector("#pz-quit").addEventListener("click", onQuit);
    const restart = card.querySelector("#pz-restart");
    if (restart) restart.addEventListener("click", onRestart);

    card.querySelector("#pz-resume").focus();
    this.bindEscape(onResume);
    return card;
  }

  /* --------------------------------------------------------------- start */

  start(progress, { onPlay, onName }) {
    const returning = progress.data.history.length > 0;
    const card = this.show(
      '<div class="screen-hero">' +
        '<h1 class="screen-title">Spoken English Adventure</h1>' +
        '<p class="screen-sub">Walk, meet people, and talk your way to better English.</p>' +
      "</div>" +
      '<label class="field"><span>What is your name?</span>' +
        '<input id="start-name" maxlength="20" value="' + esc(progress.data.playerName) + '" /></label>' +
      '<div class="screen-actions">' +
        '<button class="btn btn-big btn-primary" id="start-play">' +
          (returning ? "Continue" : "Start Playing") + "</button>" +
      "</div>" +
      '<p class="screen-note">Works best in Chrome or Edge. You can speak your answers, or type them.</p>',
      { dismissable: false });

    const input = card.querySelector("#start-name");
    card.querySelector("#start-play").addEventListener("click", () => {
      onName(input.value.trim() || "Student");
      this.hide();
      onPlay();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") card.querySelector("#start-play").click(); });
  }

  /* --------------------------------------------------------- lesson brief */

  lessonBrief(lesson, record, { onGo }) {
    const meta = LOCATION_META[lesson.location] || { label: lesson.location, icon: "\u{1F4CD}" };
    const vocab = (lesson.vocabulary || []).map((v) => '<span class="chip">' + esc(v) + "</span>").join("");
    const best = record && record.bestScore
      ? '<div class="brief-best">Your best so far: <strong>' + record.bestScore + "%</strong></div>" : "";

    const card = this.show(
      '<div class="brief-day">Day ' + lesson.day + "</div>" +
      '<h2 class="screen-title">' + esc(lesson.topic) + "</h2>" +
      '<div class="brief-loc">' + meta.icon + " " + esc(meta.label) +
        '<span class="pill">' + esc(lesson.difficulty || "beginner") + "</span></div>" +
      '<p class="brief-intro">' + esc(lesson.intro || "") + "</p>" +
      (vocab ? '<div class="brief-vocab"><h4>Words you will use</h4><div class="chips">' + vocab + "</div></div>" : "") +
      best +
      '<div class="screen-actions"><button class="btn btn-big btn-primary" id="brief-go">Let’s Go</button></div>');

    card.querySelector("#brief-go").addEventListener("click", () => { this.hide(); onGo(); });
  }

  /* ------------------------------------------------------------- results */

  results(summary, award, progress, { onAgain, onMap }) {
    const rows = summary.rows.map((r) =>
      '<tr><td class="r-prompt">' + esc(r.prompt || "") + '</td><td class="r-score ' +
      (r.correctness >= 75 ? "good" : r.correctness >= 50 ? "ok" : "low") + '">' + r.correctness + "%</td></tr>").join("");

    const bonuses = award.bonuses.map((b) =>
      '<div class="bonus-row"><span>' + esc(b.label) + "</span><span>+" + b.xp + " XP</span></div>").join("");

    const stat = (label, val) =>
      val == null ? "" :
      '<div class="stat"><div class="stat-bar"><div class="stat-fill" style="width:' + val + '%"></div></div>' +
      '<div class="stat-label">' + label + "</div><div class=\"stat-val\">" + val + "%</div></div>";

    const card = this.show(
      '<div class="result-head ' + summary.band.class + '">' +
        '<div class="result-emoji">' + summary.band.emoji + "</div>" +
        '<h2 class="screen-title">' + (award.practice ? 'Practice Complete!' : 'Lesson Complete!') + '</h2>' +
        '<div class="result-topic">Day ' + summary.day + " · " + esc(summary.topic) + "</div>" +
        '<div class="result-percent">' + summary.percent + "%</div>" +
        '<div class="result-band">' + esc(summary.band.label) + "</div>" +
        '<div class="result-stars">' + stars(summary.stars) + "</div>" +
      "</div>" +

      '<div class="result-grid">' +
        '<div class="result-kpi"><span>' + summary.correctResponses + "/" + summary.totalResponses + "</span><small>correct</small></div>" +
        '<div class="result-kpi"><span>+' + award.xp + "</span><small>XP</small></div>" +
        '<div class="result-kpi"><span>+' + award.coins + "</span><small>coins</small></div>" +
        '<div class="result-kpi"><span>' + award.streak + "</span><small>day streak</small></div>" +
      "</div>" +

      (bonuses ? '<div class="bonuses">' + bonuses + "</div>" : "") +
      (award.leveledUp ? '<div class="levelup">Level Up! You are now level ' + award.level + "</div>" : "") +

      '<h4 class="section-h">Your answers</h4>' +
      '<table class="result-table"><tbody>' + rows + "</tbody></table>" +

      '<h4 class="section-h">Speaking performance</h4>' +
      '<div class="stats">' +
        stat("Vocabulary", summary.stats.vocabulary) +
        stat("Sentence", summary.stats.sentence) +
        stat("Relevance", summary.stats.relevance) +
        stat("Pronunciation", summary.stats.pronunciation) +
      "</div>" +

      '<div class="screen-actions">' +
        '<button class="btn btn-ghost" id="res-again">Practise Again</button>' +
        '<button class="btn btn-primary" id="res-map">' + (award.practice ? 'Back to Free Play' : 'Next Lesson') + '</button>' +
      "</div>",
      { dismissable: false });

    card.querySelector("#res-again").addEventListener("click", () => { this.hide(); onAgain(); });
    card.querySelector("#res-map").addEventListener("click", () => { this.hide(); onMap(); });
  }

  /* ------------------------------------------------------------ progress */

  progressScreen(progress, manifest) {
    const o = progress.overview();

    const history = manifest.lessons.map((entry) => {
      const id = "day_" + String(entry.day).padStart(3, "0");
      const rec = progress.lessonRecord(id);
      const score = rec ? rec.bestScore : null;
      return '<div class="hist-row' + (rec ? "" : " is-locked") + '">' +
        '<span class="hist-day">Day ' + entry.day + "</span>" +
        '<span class="hist-topic">' + esc(entry.topic) + "</span>" +
        '<span class="hist-bar"><span class="hist-fill" style="width:' + (score || 0) + '%"></span></span>' +
        '<span class="hist-score">' + (score == null ? "—" : score + "%") + "</span></div>";
    }).join("");

    const stat = (label, val) =>
      '<div class="stat"><div class="stat-bar"><div class="stat-fill" style="width:' + (val || 0) + '%"></div></div>' +
      '<div class="stat-label">' + label + '</div><div class="stat-val">' + (val == null ? "—" : val + "%") + "</div></div>";

    const trend = o.improvement > 0 ? '<span class="trend up">▲ +' + o.improvement + "%</span>"
      : o.improvement < 0 ? '<span class="trend down">▼ ' + o.improvement + "%</span>"
      : '<span class="trend">—</span>';

    this.show(
      '<h2 class="screen-title">Your Progress</h2>' +
      '<div class="result-grid">' +
        '<div class="result-kpi"><span>' + o.averageScore + "%</span><small>average</small></div>" +
        '<div class="result-kpi"><span>' + o.bestScore + "%</span><small>best</small></div>" +
        '<div class="result-kpi"><span>' + o.lessonsCompleted + "</span><small>lessons</small></div>" +
        '<div class="result-kpi"><span>' + o.streak + "</span><small>streak</small></div>" +
        '<div class="result-kpi"><span>' + o.totalXp + "</span><small>total XP</small></div>" +
        '<div class="result-kpi"><span>' + trend + "</span><small>improvement</small></div>" +
      "</div>" +

      '<h4 class="section-h">Speaking performance</h4>' +
      '<div class="stats">' +
        stat("Vocabulary", o.speaking.vocabulary) +
        stat("Sentence", o.speaking.sentence) +
        stat("Relevance", o.speaking.relevance) +
        stat("Pronunciation", o.speaking.pronunciation) +
      "</div>" +

      '<h4 class="section-h">Daily lessons</h4>' +
      '<div class="hist">' + history + "</div>" +

      '<div class="screen-actions"><button class="btn btn-primary" id="prog-close">Close</button></div>')
      .querySelector("#prog-close").addEventListener("click", () => this.hide());
  }

  /* ----------------------------------------------------------------- map */

  map(manifest, progress, currentLocation, { onTravel }) {
    const unlocked = new Set(manifest.lessons.map((l) => l.location));
    const tiles = Object.keys(LOCATION_META).map((id) => {
      const meta = LOCATION_META[id];
      const open = unlocked.has(id);
      return '<button class="map-tile' + (id === currentLocation ? " is-here" : "") +
        (open ? "" : " is-soon") + '" data-loc="' + id + '"' + (open ? "" : " disabled") + ">" +
        '<span class="map-icon">' + meta.icon + "</span>" +
        '<span class="map-label">' + esc(meta.label) + "</span>" +
        '<span class="map-blurb">' + esc(meta.blurb) + "</span>" +
        (id === currentLocation ? '<span class="map-here">You are here</span>' : "") + "</button>";
    }).join("");

    const card = this.show(
      '<h2 class="screen-title">Where to?</h2>' +
      '<p class="screen-sub">Travel to a place and find someone to talk to.</p>' +
      '<div class="map-grid">' + tiles + "</div>" +
      '<div class="screen-actions"><button class="btn btn-ghost" id="map-close">Stay Here</button></div>');

    card.querySelectorAll(".map-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const loc = tile.dataset.loc;
        this.hide();
        if (loc !== currentLocation) onTravel(loc);
      });
    });
    card.querySelector("#map-close").addEventListener("click", () => this.hide());
  }

  /* ------------------------------------------------------------ settings */

  settings(progress, speechSupported, { onChange, onReset }) {
    const s = progress.data.settings;
    const langs = [["en-IN", "English (India)"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["en-AU", "English (Australia)"]];
    const card = this.show(
      '<h2 class="screen-title">Settings</h2>' +
      '<label class="row-toggle"><span>NPC voice</span>' +
        '<input type="checkbox" id="set-voice"' + (s.voice ? " checked" : "") + "></label>" +
      '<label class="row-toggle"><span>Sound effects</span>' +
        '<input type="checkbox" id="set-sound"' + (s.sound !== false ? " checked" : "") + "></label>" +
      '<label class="field"><span>Speech accent</span><select id="set-lang">' +
        langs.map(([v, l]) => '<option value="' + v + '"' + (s.lang === v ? " selected" : "") + ">" + l + "</option>").join("") +
      "</select></label>" +
      '<p class="screen-note">' + (speechSupported
        ? "Microphone input is available in this browser."
        : "This browser cannot listen. Answers can still be typed.") + "</p>" +
      // The hospital ward is Creative Commons Attribution: crediting its author
      // is a condition of the licence, not a courtesy, so it ships in the game
      // and not only in the repository's README.
      '<p class="screen-credit">Hospital ward model: &ldquo;Isometric Hospital Room&rdquo; ' +
        "by graphyTV, Blend Swap, CC&nbsp;BY&nbsp;3.0.</p>" +
      '<div class="screen-actions">' +
        '<button class="btn btn-danger" id="set-reset">Reset Progress</button>' +
        '<button class="btn btn-primary" id="set-close">Done</button>' +
      "</div>");

    card.querySelector("#set-voice").addEventListener("change", (e) => onChange("voice", e.target.checked));
    card.querySelector("#set-sound").addEventListener("change", (e) => onChange("sound", e.target.checked));
    card.querySelector("#set-lang").addEventListener("change", (e) => onChange("lang", e.target.value));
    card.querySelector("#set-close").addEventListener("click", () => this.hide());
    card.querySelector("#set-reset").addEventListener("click", () => {
      this.confirm(
        "This erases all XP, coins, stars, streak and lesson history. " +
        "You will start again from Day 1. This cannot be undone.",
        {
          title: "Reset your progress?",
          yes: "Yes, reset everything",
          no: "Keep my progress",
          onYes: () => onReset(),
          // Cancelling returns to Settings rather than dumping the player out.
          onNo: () => this.settings(progress, speechSupported, { onChange, onReset })
        });
    });
  }

  /* --------------------------------------------------------------- error */

  error(message, detail) {
    this.show(
      '<h2 class="screen-title">Something went wrong</h2>' +
      '<p class="screen-sub">' + esc(message) + "</p>" +
      (detail ? '<pre class="error-detail">' + esc(detail) + "</pre>" : ""),
      { dismissable: false });
  }
}
