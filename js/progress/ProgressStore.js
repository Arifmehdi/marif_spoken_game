/**
 * ProgressStore - everything the student has earned, saved in localStorage.
 *
 * Kept deliberately serialisable and free of DOM/Three references so the same
 * object can later be POSTed to a server without touching the rest of the game.
 */
const KEY = "spoken_english_game_v1";

const EMPTY = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  playerName: "Student",
  characterId: null,        // which of the four students the player picked
  lastPlayedDate: null,
  streak: 0,
  bestStreak: 0,
  xp: 0,
  coins: 0,
  lessons: {},   // lesson_id -> { bestScore, lastScore, attempts, stars, completedAt }
  history: [],   // one entry per completed conversation
  settings: { voice: true, music: true, lang: "en-IN" }
});

export class ProgressStore {
  constructor(config) {
    this.config = config;
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return EMPTY();
      const parsed = JSON.parse(raw);
      return Object.assign(EMPTY(), parsed);
    } catch (err) {
      console.warn("Saved progress was unreadable, starting fresh.", err);
      return EMPTY();
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch (err) {
      // Private-browsing quota errors must never crash a lesson.
      console.warn("Could not save progress.", err);
      return false;
    }
  }

  reset() {
    this.data = EMPTY();
    this.save();
  }

  /* ------------------------------------------------------------- getters */

  get xp() { return this.data.xp; }
  get coins() { return this.data.coins; }
  get streak() { return this.data.streak; }

  get level() {
    return Math.floor(this.data.xp / this.config.xpPerLevel) + 1;
  }

  get xpIntoLevel() {
    return this.data.xp % this.config.xpPerLevel;
  }

  get xpForLevel() {
    return this.config.xpPerLevel;
  }

  completedLessonIds() {
    return Object.keys(this.data.lessons).filter((id) => this.data.lessons[id].completedAt);
  }

  lessonRecord(lessonId) {
    return this.data.lessons[lessonId] || null;
  }

  static todayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  static daysBetween(a, b) {
    const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((parse(b) - parse(a)) / 86400000);
  }

  /* ------------------------------------------------------------- writers */

  /** Daily streak: +1 for a new consecutive day, reset if a day was skipped. */
  touchStreak() {
    const today = ProgressStore.todayKey();
    const last = this.data.lastPlayedDate;
    if (last === today) return this.data.streak;

    if (!last) this.data.streak = 1;
    else {
      const gap = ProgressStore.daysBetween(last, today);
      this.data.streak = gap === 1 ? this.data.streak + 1 : 1;
    }
    this.data.lastPlayedDate = today;
    this.data.bestStreak = Math.max(this.data.bestStreak, this.data.streak);
    return this.data.streak;
  }

  /**
   * @param {object} summary from ConversationEngine.finish()
   * @returns {object} what was awarded, for the results screen
   */
  recordLesson(summary) {
    const streak = this.touchStreak();
    const r = this.config.rewards;

    let xp = summary.xp;
    let bonuses = [];
    if (summary.percent >= 100) {
      xp += r.perfectLessonBonusXp;
      bonuses.push({ label: "Perfect lesson", xp: r.perfectLessonBonusXp });
    }
    const streakBonus = Math.min(r.maxStreakBonusXp, (streak - 1) * r.streakBonusXpPerDay);
    if (streakBonus > 0) {
      xp += streakBonus;
      bonuses.push({ label: streak + "-day streak", xp: streakBonus });
    }
    const coins = summary.stars * r.coinsPerStar;

    const beforeLevel = this.level;
    this.data.xp += xp;
    this.data.coins += coins;
    const afterLevel = this.level;

    const prev = this.data.lessons[summary.lessonId] || { attempts: 0, bestScore: 0 };
    this.data.lessons[summary.lessonId] = {
      attempts: prev.attempts + 1,
      lastScore: summary.percent,
      bestScore: Math.max(prev.bestScore, summary.percent),
      stars: Math.max(prev.stars || 0, summary.stars),
      completedAt: new Date().toISOString()
    };

    this.data.history.push({
      date: ProgressStore.todayKey(),
      lessonId: summary.lessonId,
      day: summary.day,
      topic: summary.topic,
      percent: summary.percent,
      correctResponses: summary.correctResponses,
      totalResponses: summary.totalResponses,
      xp, coins,
      stars: summary.stars,
      stats: summary.stats
    });
    if (this.data.history.length > 400) this.data.history = this.data.history.slice(-400);

    this.save();
    return { xp, coins, stars: summary.stars, streak, bonuses, leveledUp: afterLevel > beforeLevel, level: afterLevel };
  }

  /**
   * Free Play. Awards reduced XP and coins, and deliberately does NOT mark the
   * lesson complete or touch the daily streak: practising must never skip the
   * student forward through the daily progression, and must not let them farm
   * the streak bonus by replaying one easy conversation.
   */
  recordPractice(summary) {
    const r = this.config.rewards;
    const xp = Math.round(summary.xp * 0.5);
    const coins = Math.round(summary.stars * r.coinsPerStar * 0.5);

    const beforeLevel = this.level;
    this.data.xp += xp;
    this.data.coins += coins;
    const afterLevel = this.level;

    // A better score still counts - it is the same conversation. Only update a
    // lesson that was already completed, so practice never creates a record
    // that would read as "finished".
    const prev = this.data.lessons[summary.lessonId];
    if (prev && prev.completedAt) {
      prev.bestScore = Math.max(prev.bestScore, summary.percent);
      prev.stars = Math.max(prev.stars || 0, summary.stars);
      prev.attempts = (prev.attempts || 0) + 1;
    }

    this.data.history.push({
      date: ProgressStore.todayKey(),
      lessonId: summary.lessonId,
      day: summary.day,
      topic: summary.topic,
      percent: summary.percent,
      correctResponses: summary.correctResponses,
      totalResponses: summary.totalResponses,
      xp, coins,
      stars: summary.stars,
      stats: summary.stats,
      practice: true
    });
    if (this.data.history.length > 400) this.data.history = this.data.history.slice(-400);

    this.save();
    return {
      xp, coins, stars: summary.stars, streak: this.data.streak, bonuses: [],
      leveledUp: afterLevel > beforeLevel, level: afterLevel, practice: true
    };
  }

  /* ---------------------------------------------------------- statistics */

  /** Powers the Progress screen (specification section 10). */
  overview() {
    const h = this.data.history;
    const scores = h.map((e) => e.percent);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const best = scores.length ? Math.max(...scores) : 0;

    const avgOf = (key) => {
      const vals = h.map((e) => e.stats && e.stats[key]).filter((v) => typeof v === "number");
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    // "Speaking improvement": recent average minus the earliest average.
    let improvement = 0;
    if (scores.length >= 4) {
      const half = Math.floor(scores.length / 2);
      const early = scores.slice(0, half);
      const late = scores.slice(-half);
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      improvement = Math.round(mean(late) - mean(early));
    }

    return {
      lessonsCompleted: this.completedLessonIds().length,
      conversations: h.length,
      averageScore: avg,
      bestScore: best,
      totalXp: this.data.xp,
      coins: this.data.coins,
      level: this.level,
      streak: this.data.streak,
      bestStreak: this.data.bestStreak,
      improvement,
      speaking: {
        vocabulary: avgOf("vocabulary"),
        sentence: avgOf("sentence"),
        relevance: avgOf("relevance"),
        pronunciation: avgOf("pronunciation")
      },
      recent: h.slice(-12).reverse()
    };
  }

  /* ------------------------------------------------------------ settings */

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
  }

  getSetting(key) {
    return this.data.settings[key];
  }

  setPlayerName(name) {
    this.data.playerName = String(name || "Student").slice(0, 20);
    this.save();
  }
}
