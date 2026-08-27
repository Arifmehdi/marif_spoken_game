/**
 * ConversationEngine - walks a lesson's turns and scores the student's answers.
 *
 * It knows NOTHING about any particular lesson, NPC or location: it just reads
 * the JSON it is handed and emits events. The UI listens; the 3D world listens.
 * That separation is requirement 11 of the specification.
 *
 *   engine.on("npcLine",       ({ text, role, name }) => ...)
 *   engine.on("studentPrompt", ({ prompt, hint, index, total }) => ...)
 *   engine.on("feedback",      (result) => ...)
 *   engine.on("finished",      (summary) => ...)
 */
import { LessonLoader } from "./LessonLoader.js";

const CORRECT_THRESHOLD = 75;   // what counts as a "correct response" in the tally
const RETRY_BELOW = 50;         // offer one retry when an answer is this weak
const MAX_ATTEMPTS = 2;

export class ConversationEngine {
  constructor({ evaluator, speechOutput }) {
    this.evaluator = evaluator;
    this.speech = speechOutput;
    this.handlers = {};
    this.reset();
  }

  reset() {
    this.lesson = null;
    this.cursor = -1;
    this.results = [];
    this.attempts = 0;
    this.active = false;
    this.awaiting = false;
    this.lastResult = null;
  }

  on(event, fn) {
    (this.handlers[event] = this.handlers[event] || []).push(fn);
    return this;
  }

  emit(event, payload) {
    (this.handlers[event] || []).forEach((fn) => fn(payload));
  }

  /* ------------------------------------------------------------- helpers */

  characterFor(speaker) {
    const chars = (this.lesson && this.lesson.characters) || [];
    return chars.find((c) => c.id === speaker) || { id: speaker, name: this.titleCase(speaker), role: speaker };
  }

  titleCase(s) {
    return String(s || "").replace(/[_-]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  get studentTurnCount() {
    return this.lesson ? LessonLoader.studentTurns(this.lesson).length : 0;
  }

  get studentTurnIndex() {
    return this.results.length;
  }

  /* ---------------------------------------------------------------- flow */

  async start(lesson) {
    this.reset();
    this.lesson = lesson;
    this.active = true;
    this.emit("started", {
      lessonId: lesson.lesson_id,
      day: lesson.day,
      topic: lesson.topic,
      intro: lesson.intro,
      total: this.studentTurnCount
    });
    await this.advance();
  }

  /** Move to the next turn. NPC lines play automatically; student turns wait. */
  async advance() {
    if (!this.active) return;
    this.cursor++;

    if (this.cursor >= this.lesson.conversation.length) return this.finish();

    const turn = this.lesson.conversation[this.cursor];

    if (turn.speaker === "student") {
      this.attempts = 0;
      this.awaiting = true;
      this.emit("studentPrompt", {
        prompt: turn.prompt || "Your turn - speak or type your answer.",
        hint: turn.hint,
        index: this.studentTurnIndex + 1,
        total: this.studentTurnCount
      });
      return;
    }

    const character = this.characterFor(turn.speaker);
    this.emit("npcLine", { text: turn.text, role: character.role, name: character.name, id: character.id });
    await this.speech.speak(turn.text, character.role);
    if (!this.active) return;
    await this.advance();
  }

  /**
   * Score what the student said or typed.
   * @param {string} input
   * @param {object} opts { mode: "speak"|"type", confidence: 0..1 }
   */
  submit(input, opts = {}) {
    if (!this.active || !this.awaiting) return null;
    const turn = this.lesson.conversation[this.cursor];
    this.attempts++;

    const result = this.evaluator.evaluate(input, turn, opts);
    result.transcript = input;
    result.attempt = this.attempts;
    result.canRetry = result.correctness < RETRY_BELOW && this.attempts < MAX_ATTEMPTS;
    result.prompt = turn.prompt;
    this.lastResult = result;

    this.awaiting = false;
    this.emit("feedback", result);
    return result;
  }

  /** Student chose to try the same question again; the better attempt counts. */
  retry() {
    if (!this.active || !this.lastResult || !this.lastResult.canRetry) return;
    const turn = this.lesson.conversation[this.cursor];
    this.awaiting = true;
    this.emit("studentPrompt", {
      prompt: turn.prompt || "Try that once more.",
      hint: turn.hint,
      index: this.studentTurnIndex + 1,
      total: this.studentTurnCount,
      retry: true
    });
  }

  /** Accept the score for this question and move on. */
  async accept() {
    if (!this.active || !this.lastResult) return;
    const previous = this.results[this.results.length - 1];
    // On a retry, keep whichever attempt scored higher.
    if (previous && previous.turnCursor === this.cursor) {
      if (this.lastResult.correctness > previous.correctness) {
        this.results[this.results.length - 1] = this.withCursor(this.lastResult);
      }
    } else {
      this.results.push(this.withCursor(this.lastResult));
    }
    this.lastResult = null;
    await this.advance();
  }

  withCursor(result) {
    return Object.assign({}, result, { turnCursor: this.cursor });
  }

  /** Student walked away mid-conversation. Nothing is recorded. */
  abandon() {
    this.active = false;
    this.awaiting = false;
    this.speech.cancel();
    this.emit("abandoned", { lessonId: this.lesson && this.lesson.lesson_id });
    this.reset();
  }

  /* -------------------------------------------------------------- finish */

  finish() {
    this.active = false;
    this.awaiting = false;
    const summary = this.buildSummary();
    this.emit("finished", summary);
    return summary;
  }

  buildSummary() {
    const rows = this.results;
    const total = rows.length || 1;
    const percent = Math.round(rows.reduce((sum, r) => sum + r.correctness, 0) / total);
    const xp = rows.reduce((sum, r) => sum + r.points, 0);
    const correctResponses = rows.filter((r) => r.correctness >= CORRECT_THRESHOLD).length;

    const avg = (key) => {
      const vals = rows.map((r) => r.stats[key]).filter((v) => typeof v === "number");
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    const band = this.evaluator.bandFor(percent);

    return {
      lessonId: this.lesson.lesson_id,
      day: this.lesson.day,
      topic: this.lesson.topic,
      location: this.lesson.location,
      percent,
      xp,
      stars: band.stars,
      band,
      correctResponses,
      totalResponses: rows.length,
      rows: rows.map((r) => ({
        prompt: r.prompt,
        transcript: r.transcript,
        correctness: r.correctness,
        points: r.points,
        modelAnswer: r.modelAnswer
      })),
      stats: {
        vocabulary: avg("vocabulary"),
        sentence: avg("sentence"),
        relevance: avg("relevance"),
        pronunciation: avg("pronunciation")
      }
    };
  }
}
