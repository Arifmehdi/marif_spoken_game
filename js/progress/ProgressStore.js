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
  streakFreezes: 0,
  hintCredits: 0,
  dailyReward: { day: 0, lastClaimDate: null },
  lessons: {},   // lesson_id -> { bestScore, lastScore, attempts, stars, completedAt }
  history: [],   // one entry per completed conversation
  settings: { voice: true, sound: true, music: true, lang: "en-IN" }
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
  get streakFreezes() { return this.data.streakFreezes || 0; }
  get hintCredits() { return this.data.hintCredits || 0; }

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

  /**
   * Daily streak: +1 for a new consecutive day, reset if a day was skipped -
   * unless exactly one day was missed and a Streak Freeze is in stock, in
   * which case one is spent automatically and the streak carries on.
   *
   * @returns {{streak:number, usedFreeze:boolean}}
   */
  touchStreak() {
    const today = ProgressStore.todayKey();
    const last = this.data.lastPlayedDate;
    if (last === today) return { streak: this.data.streak, usedFreeze: false };

    let usedFreeze = false;
    if (!last) {
      this.data.streak = 1;
    } else {
      const gap = ProgressStore.daysBetween(last, today);
      if (gap === 1) {
        this.data.streak += 1;
      } else if (gap === 2 && (this.data.streakFreezes || 0) > 0) {
        this.data.streakFreezes -= 1;
        this.data.streak += 1;
        usedFreeze = true;
      } else {
        this.data.streak = 1;
      }
    }
    this.data.lastPlayedDate = today;
    this.data.bestStreak = Math.max(this.data.bestStreak, this.data.streak);
    return { streak: this.data.streak, usedFreeze };
  }

  /**
   * @param {object} summary from ConversationEngine.finish()
   * @returns {object} what was awarded, for the results screen
   */
  recordLesson(summary) {
    const { streak, usedFreeze } = this.touchStreak();
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
    return {
      xp, coins, stars: summary.stars, streak, bonuses,
      leveledUp: afterLevel > beforeLevel, level: afterLevel, usedStreakFreeze: usedFreeze
    };
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

  /* --------------------------------------------------------------- store */

  /**
   * Spend coins on a `data/config/scoring.json` `store` item. `skipLesson`
   * costs coins the same way but its effect (completing a lesson) needs the
   * lesson content, which this store knows nothing about - Game.js applies
   * that one itself after checking `canAfford`.
   *
   * @returns {{ok:boolean, error?:string}}
   */
  buy(itemId) {
    const item = this.config.store && this.config.store[itemId];
    if (!item) return { ok: false, error: "That item does not exist." };
    if (!this.canAfford(itemId)) return { ok: false, error: "Not enough coins." };

    this.data.coins -= item.price;
    if (itemId === "streakFreeze") this.data.streakFreezes = (this.data.streakFreezes || 0) + 1;
    else if (itemId === "hintPack") this.data.hintCredits = (this.data.hintCredits || 0) + (item.grants || 1);
    // skipLesson: coins are spent here; Game.js completes the lesson itself.

    this.save();
    return { ok: true };
  }

  canAfford(itemId) {
    const item = this.config.store && this.config.store[itemId];
    return !!item && this.data.coins >= item.price;
  }

  /** One hint credit reveals a model answer. @returns {boolean} whether one was spent */
  useHintCredit() {
    if ((this.data.hintCredits || 0) <= 0) return false;
    this.data.hintCredits -= 1;
    this.save();
    return true;
  }

  /* ---------------------------------------------------------- daily reward */

  /**
   * What today's login reward would be, without claiming it. Returns null if
   * it has already been claimed today. A 7-day cycle: consecutive days climb
   * the reward table, and missing a day resets to day 1 - the same rule the
   * lesson streak uses, kept as a separate counter so opening the app on a
   * day you do not finish a lesson still earns something.
   */
  previewDailyReward() {
    const cycle = (this.config.dailyReward && this.config.dailyReward.coins) || [10, 15, 20, 25, 30, 40, 60];
    const today = ProgressStore.todayKey();
    const dr = this.data.dailyReward || { day: 0, lastClaimDate: null };
    if (dr.lastClaimDate === today) return null;

    let day;
    if (!dr.lastClaimDate) {
      day = 1;
    } else {
      const gap = ProgressStore.daysBetween(dr.lastClaimDate, today);
      day = gap === 1 ? (dr.day % cycle.length) + 1 : 1;
    }
    const bonusFreeze = day === cycle.length;
    return { day, coins: cycle[day - 1], bonusFreeze, cycle };
  }

  /** @returns {object|null} the reward claimed, or null if today's was already taken */
  claimDailyReward() {
    const preview = this.previewDailyReward();
    if (!preview) return null;
    this.data.coins += preview.coins;
    if (preview.bonusFreeze) this.data.streakFreezes = (this.data.streakFreezes || 0) + 1;
    this.data.dailyReward = { day: preview.day, lastClaimDate: ProgressStore.todayKey() };
    this.save();
    return preview;
  }

  /* -------------------------------------------------------------- badges */

  /**
   * Everything Badges.js needs to work out which badges are earned.
   * Needs the manifest to know which level each lesson belongs to - that
   * pairing lives outside a lesson's own save record.
   */
  badgeStats(manifest) {
    const byLevel = { easy: 0, medium: 0, hard: 0 };
    manifest.lessons.forEach((l) => {
      const id = "day_" + String(l.day).padStart(3, "0");
      if (this.data.lessons[id] && this.data.lessons[id].completedAt) {
        byLevel[l.difficulty] = (byLevel[l.difficulty] || 0) + 1;
      }
    });
    const perfectLessons = Object.values(this.data.lessons).filter((l) => l.bestScore >= 100).length;

    return {
      lessonsCompleted: this.completedLessonIds().length,
      level: this.level,
      bestStreak: this.data.bestStreak,
      perfectLessons,
      byLevel
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
