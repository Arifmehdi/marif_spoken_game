/**
 * Evaluator - scores a student's spoken/typed answer against a lesson turn.
 *
 * Deliberately content-agnostic: everything it knows comes from the lesson JSON
 * and data/config/scoring.json. Adding lessons never requires touching this file.
 *
 * Four signals are blended, then penalties are applied:
 *   keywords   - did the answer contain the required ideas (synonym aware)
 *   similarity - how close is the wording to any accepted answer
 *   grammar    - does it look like a sentence (subject + verb + word order)
 *   relevance  - is it an appropriate answer to THAT question
 */

const CONTRACTIONS = {
  "i'm": "i am", "im": "i am", "you're": "you are", "he's": "he is", "she's": "she is",
  "it's": "it is", "we're": "we are", "they're": "they are", "that's": "that is",
  "what's": "what is", "where's": "where is", "who's": "who is", "how's": "how is",
  "there's": "there is", "let's": "let us", "i've": "i have", "you've": "you have",
  "we've": "we have", "they've": "they have", "i'll": "i will", "you'll": "you will",
  "he'll": "he will", "she'll": "she will", "we'll": "we will", "they'll": "they will",
  "i'd": "i would", "you'd": "you would", "don't": "do not", "doesn't": "does not",
  "didn't": "did not", "isn't": "is not", "aren't": "are not", "wasn't": "was not",
  "weren't": "were not", "can't": "can not", "cannot": "can not", "won't": "will not",
  "couldn't": "could not", "shouldn't": "should not", "wouldn't": "would not",
  "haven't": "have not", "hasn't": "has not", "o'clock": "oclock"
};

const DIGITS = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
  "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten"
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty", "forty", "fifty", "sixty"];

const WH_WORDS = ["what", "where", "when", "why", "who", "which", "how", "whose"];
const MODALS = ["can", "could", "may", "might", "will", "would", "shall", "should", "do", "does", "is", "are"];

export class Evaluator {
  constructor(config) {
    this.cfg = config;
    this.syn = new Map();
    (config.synonymGroups || []).forEach((group) => {
      const head = group[0];
      group.forEach((w) => this.syn.set(w, head));
    });
    this.stop = new Set(config.stopWords || []);
    this.polite = new Set(config.politenessWords || []);
    this.verbs = new Set(config.verbHints || []);
    this.subjects = new Set(config.subjectHints || []);
  }

  /* ---------------------------------------------------------- text helpers */

  normalize(text) {
    let t = String(text || "").toLowerCase().trim();
    t = t.replace(/[‘’ʼ]/g, "'");
    t = t.replace(/[^a-z0-9'\s]/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    if (!t) return "";
    const out = t.split(" ").filter(Boolean).map((w) => {
      if (CONTRACTIONS[w]) return CONTRACTIONS[w];
      if (DIGITS[w]) return DIGITS[w];
      return w.replace(/'/g, "");
    });
    return out.join(" ").replace(/\s+/g, " ").trim();
  }

  /** Light stemmer - keeps notebook/notebooks and play/playing comparable. */
  stem(w) {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("es")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  }

  /** Map a word onto its canonical synonym-group head. */
  canon(w) {
    if (this.syn.has(w)) return this.syn.get(w);
    const s = this.stem(w);
    if (this.syn.has(s)) return this.syn.get(s);
    return s;
  }

  tokens(text) {
    const n = this.normalize(text);
    return n ? n.split(" ") : [];
  }

  canonTokens(text) {
    return this.tokens(text).map((w) => this.canon(w));
  }

  contentTokens(text) {
    return this.tokens(text)
      .filter((w) => !this.stop.has(w) && !this.polite.has(w))
      .map((w) => this.canon(w));
  }

  stripPoliteness(text) {
    return this.tokens(text).filter((w) => !this.polite.has(w)).join(" ");
  }

  /* --------------------------------------------------------- math helpers */

  static levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  static charSimilarity(a, b) {
    const max = Math.max(a.length, b.length);
    if (!max) return 1;
    return 1 - Evaluator.levenshtein(a, b) / max;
  }

  static setF1(a, b) {
    const A = new Set(a), B = new Set(b);
    if (!A.size && !B.size) return 1;
    if (!A.size || !B.size) return 0;
    let hit = 0;
    A.forEach((x) => { if (B.has(x)) hit++; });
    const p = hit / A.size, r = hit / B.size;
    return p + r === 0 ? 0 : (2 * p * r) / (p + r);
  }

  /** Longest common subsequence ratio - rewards correct word ORDER. */
  static lcsRatio(a, b) {
    if (!a.length || !b.length) return 0;
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[a.length][b.length] / Math.min(a.length, b.length);
  }

  /* ------------------------------------------------------------- scoring */

  /**
   * @param {string[]} studentCanon canonical tokens of the answer
   * @param {string[]} keywords     required ideas; a nested array means "any of these"
   * @param {Set<string>} [target]  canonical tokens of the accepted answer that
   *   matched best. A keyword the target itself does not use is not applicable -
   *   e.g. "name" is required for "My name is Rahul." but not for "I am Rahul."
   */
  scoreKeywords(studentCanon, keywords, target) {
    if (!keywords || !keywords.length) return null;
    const bag = new Set(studentCanon);
    const has = (set, opt) =>
      String(opt).toLowerCase().split(/\s+/).every((part) => set.has(this.canon(part)));

    const matched = [], missing = [];
    let applicable = 0;
    keywords.forEach((entry) => {
      const options = Array.isArray(entry) ? entry : [entry];
      if (target && !options.some((opt) => has(target, opt))) return;
      applicable++;
      const hit = options.find((opt) => has(bag, opt));
      if (hit) matched.push(hit); else missing.push(options[0]);
    });
    if (!applicable) return null;
    return { score: matched.length / applicable, matched, missing };
  }

  /**
   * Open slots let a student answer with their OWN value - their name, their
   * town, their favourite food - without it counting as a wrong word. A turn
   * opts in with "slot": "name" in the lesson JSON. Any student word that is
   * not in the accepted vocabulary is swapped for the word the model answer
   * uses in the same gap, so the rest of the sentence is judged normally.
   */
  substituteSlots(studentTokens, expectedTokens, slotFillers) {
    if (!slotFillers.length) return studentTokens;
    const studentSet = new Set(studentTokens.map((t) => this.canon(t)));
    const gaps = expectedTokens.filter((t) =>
      !this.stop.has(t) && !this.polite.has(t) && !studentSet.has(this.canon(t)));
    if (!gaps.length) return studentTokens;

    // A slot fills a gap in an otherwise-matching sentence. If the words AROUND
    // the slot do not fit this answer, the student is off topic - do not rescue it.
    const fillerSet = new Set(slotFillers);
    const expectedContent = new Set(expectedTokens
      .filter((t) => !this.stop.has(t) && !this.polite.has(t))
      .map((t) => this.canon(t)));
    const frameFits = studentTokens
      .filter((t) => !this.stop.has(t) && !this.polite.has(t))
      .map((t) => this.canon(t))
      .filter((t) => !fillerSet.has(t))
      .every((t) => expectedContent.has(t));
    if (!frameFits) return studentTokens;

    const fill = slotFillers.slice();
    const open = gaps.slice();
    return studentTokens.map((t) => {
      const c = this.canon(t);
      const idx = fill.indexOf(c);
      if (idx !== -1 && open.length) { fill.splice(idx, 1); return open.shift(); }
      return t;
    });
  }

  scoreSimilarity(studentTokens, expectedList, slotFillers) {
    let best = {
      score: 0,
      sentence: expectedList[0] || "",
      containment: 0,
      studentTokens
    };
    expectedList.forEach((sentence) => {
      const variants = [sentence, this.stripPoliteness(sentence)];
      variants.forEach((v) => {
        const eTokens = this.tokens(v);
        const filled = this.substituteSlots(studentTokens, eTokens, slotFillers);
        const sContent = filled.filter((t) => !this.stop.has(t) && !this.polite.has(t)).map((t) => this.canon(t));
        const eContent = this.contentTokens(v);
        const f1 = Evaluator.setF1(sContent, eContent);
        const cs = Evaluator.charSimilarity(filled.join(" "), this.normalize(v));
        const score = 0.55 * f1 + 0.45 * cs;
        if (score > best.score) {
          const eSet = new Set(eContent);
          const hit = sContent.filter((t) => eSet.has(t)).length;
          best = {
            score,
            sentence,
            containment: sContent.length ? hit / sContent.length : 0,
            studentTokens: filled
          };
        }
      });
    });
    return best;
  }

  scoreGrammar(studentTokens, expectedTokens) {
    if (!studentTokens.length) return 0;
    const sSet = new Set(studentTokens), eSet = new Set(expectedTokens);
    const has = (set, hints) => [...set].some((w) => hints.has(w));

    const needsSubject = has(eSet, this.subjects);
    const needsVerb = has(eSet, this.verbs);
    const subjOk = needsSubject ? (has(sSet, this.subjects) ? 1 : 0) : 1;
    const verbOk = needsVerb ? (has(sSet, this.verbs) ? 1 : 0) : 1;
    const order = Evaluator.lcsRatio(studentTokens, expectedTokens);

    let score = 0.35 * subjOk + 0.35 * verbOk + 0.30 * order;

    // A one-word answer to a full-sentence question is not a sentence.
    const ratio = studentTokens.length / Math.max(1, expectedTokens.length);
    if (ratio < 0.4) score *= 0.6 + ratio;
    return Math.max(0, Math.min(1, score));
  }

  scoreRelevance(studentTokens, studentContent, allExpectedContent, expects) {
    if (!studentTokens.length) return 0;
    const pool = new Set(allExpectedContent);
    const hit = studentContent.filter((t) => pool.has(t)).length;
    const precision = studentContent.length ? hit / studentContent.length : 0;
    const overlap = Math.min(1, precision * 1.25);

    const isNumber = (t) => /^\d+$/.test(t) || NUMBER_WORDS.includes(t);
    let typeOk = 1;
    const first = studentTokens[0];
    switch (expects) {
      case "yes_no":
        typeOk = studentTokens.some((t) => ["yes", "no", "sure", "course", "not", "yeah", "nope"].includes(t)) ? 1 : 0.5;
        break;
      case "question":
        typeOk = studentTokens.some((t) => WH_WORDS.includes(t)) || MODALS.includes(first) ? 1 : 0.4;
        break;
      case "number":
        typeOk = studentTokens.some((t) => isNumber(t) || ["many", "few", "several"].includes(t)) ? 1 : 0.5;
        break;
      case "time":
        typeOk = studentTokens.some((t) => isNumber(t) ||
          ["oclock", "morning", "evening", "night", "afternoon", "yesterday", "today",
            "since", "after", "before", "noon", "week", "day", "days"].includes(t)) ? 1 : 0.5;
        break;
      default:
        typeOk = 1;
    }
    return 0.55 * overlap + 0.45 * typeOk;
  }

  /* --------------------------------------------------------------- public */

  /**
   * @param {string} input  what the student said or typed
   * @param {object} turn   the "student" entry from the lesson JSON
   * @param {object} [opts] { confidence: 0..1 from speech recognition, mode: 'speak'|'type' }
   */
  evaluate(input, turn, opts = {}) {
    const w = this.cfg.weights;
    const expectedList = (turn.expected && turn.expected.length ? turn.expected : [turn.prompt || ""]).slice();
    const studentNorm = this.normalize(input);
    const studentTokens = this.tokens(input);
    const studentCanon = this.canonTokens(input);
    const studentContent = this.contentTokens(input);

    if (!studentTokens.length) {
      return this.buildResult(0,
        { keywords: 0, similarity: 0, grammar: 0, relevance: 0, penalty: 0 },
        { matched: [], missing: [], extraWords: [], missingWords: [], best: expectedList[0], turn, opts, empty: true });
    }

    const allExpectedContent = expectedList.flatMap((s) => this.contentTokens(s));

    // Words the student used that no accepted answer contains. On a turn with an
    // open slot these are the student's own name/town/food, not mistakes.
    const expectedPool = new Set(allExpectedContent);
    const slotCount = turn.slot ? (turn.slotCount || 1) : 0;
    // Take fillers from the END of the answer - the personal value almost always
    // lands last ("My name is ___", "I live in ___"), so this avoids swapping a verb.
    const slotFillers = slotCount
      ? studentContent.filter((t) => !expectedPool.has(t)).slice(-slotCount)
      : [];

    // --- signals
    const sim = this.scoreSimilarity(studentTokens, expectedList, slotFillers);
    const filledTokens = sim.studentTokens;
    const filledContent = filledTokens.filter((t) => !this.stop.has(t) && !this.polite.has(t)).map((t) => this.canon(t));
    const bestTokens = this.tokens(sim.sentence);
    const kw = this.scoreKeywords(studentCanon, turn.keywords, new Set(bestTokens.map((t) => this.canon(t))));
    const grammar = this.scoreGrammar(filledTokens, bestTokens);
    const relevance = this.scoreRelevance(filledTokens, filledContent, allExpectedContent, turn.expects);

    // A grammatical answer that stays inside the accepted vocabulary and hits every
    // keyword should not be punished for being shorter than the model answer.
    let similarity = sim.score;
    if (kw && kw.score === 1 && sim.containment >= 0.999 && grammar >= 0.9) {
      similarity = Math.max(similarity, 0.95);
    }

    // --- keyword weight is redistributed to similarity when a turn declares none
    let wk = w.keywords, ws = w.similarity;
    let keywordScore = kw ? kw.score : 0;
    if (!kw) { ws += wk; wk = 0; keywordScore = 0; }

    // --- penalties
    const p = this.cfg.penalties;
    const bestAll = this.tokens(this.stripPoliteness(sim.sentence));
    const bestContent = this.contentTokens(this.stripPoliteness(sim.sentence));
    const studentSet = new Set(filledTokens.map((t) => this.canon(t)));
    const missingTokens = bestAll.filter((t) => !studentSet.has(this.canon(t)));
    const missingRatio = bestAll.length ? missingTokens.length / bestAll.length : 0;

    // Words that belong to no accepted answer - spec calls these "incorrect words".
    // Capped so a chatty-but-correct answer is never wrecked by one stray word.
    const bestSet = new Set(bestContent);
    const extraWords = filledContent.filter((t) => !bestSet.has(t) && !expectedPool.has(t));
    const missingWords = missingTokens.filter((t) => !this.stop.has(t));

    let penalty = missingRatio * p.missingExpectedTokens;
    penalty += Math.min(extraWords.length * (p.extraWord || 0), p.maxExtraWordPenalty || 0);
    const forbidden = (turn.forbidden || []).filter((f) => studentSet.has(this.canon(String(f).toLowerCase())));
    penalty += forbidden.length * p.forbiddenWord;
    if (studentTokens.length < 2 && bestAll.length >= 3) penalty += p.tooShort;

    // --- blend
    let total = wk * keywordScore + ws * similarity + w.grammar * grammar + w.relevance * relevance - penalty;
    total = Math.max(0, Math.min(1, total));

    return this.buildResult(Math.round(total * 100),
      { keywords: keywordScore, similarity, grammar, relevance, penalty },
      { matched: kw ? kw.matched : [], missing: kw ? kw.missing : [],
        extraWords, missingWords, best: sim.sentence, turn, opts });
  }

  bandFor(correctness) {
    return this.cfg.bands.find((b) => correctness >= b.min) || this.cfg.bands[this.cfg.bands.length - 1];
  }

  buildResult(correctness, breakdown, extra) {
    const band = this.bandFor(correctness);
    const maxPoints = (extra.turn && extra.turn.points) || 20;
    const points = Math.round((band.points / 20) * maxPoints);
    const conf = extra.opts && typeof extra.opts.confidence === "number" ? extra.opts.confidence : null;

    return {
      correctness,
      band,
      points,
      stars: band.stars,
      mode: (extra.opts && extra.opts.mode) || "type",
      matchedKeywords: extra.matched,
      missingKeywords: extra.missing,
      missingWords: (extra.missingWords || []).slice(0, 6),
      extraWords: (extra.extraWords || []).slice(0, 6),
      modelAnswer: extra.best,
      hint: extra.turn && extra.turn.hint,
      empty: !!extra.empty,
      breakdown,
      stats: {
        vocabulary: Math.round(breakdown.keywords * 100),
        sentence: Math.round(breakdown.grammar * 100),
        relevance: Math.round(breakdown.relevance * 100),
        // Speech-API confidence stands in for pronunciation on the MVP.
        // Typed answers report null so they never skew the speaking average.
        pronunciation: conf === null ? null : Math.round(Math.max(0.35, conf) * 100)
      },
      feedback: this.feedbackFor(correctness, extra)
    };
  }

  feedbackFor(correctness, extra) {
    if (extra.empty) return "I did not catch that. Tap the mic and try again.";
    if (correctness >= 90) return "Perfect! That is exactly right.";
    if (correctness >= 75) {
      const m = extra.missingWords && extra.missingWords.length;
      return m ? "Very good! Try adding: " + extra.missingWords.slice(0, 3).join(", ") : "Very good answer!";
    }
    if (correctness >= 50) return "Good try. A fuller answer would be: “" + extra.best + "”";
    if (correctness >= 25) return "Almost there. Say it like this: “" + extra.best + "”";
    return "Let us try again. Listen and repeat: “" + extra.best + "”";
  }
}
