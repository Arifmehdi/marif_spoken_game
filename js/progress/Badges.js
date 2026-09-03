/**
 * Badges - milestones earned just by playing, computed fresh from
 * ProgressStore data every time. Nothing new is tracked to earn one, so
 * adding a row here is the whole job: pick an existing icon (see
 * Menu.js ICONS), a goal, and how to read the current value out of
 * ProgressStore.badgeStats().
 *
 * `icon` is a key into Menu.js's ICONS map, so badges reuse the same art
 * already shipped for the HUD and store rather than needing new assets.
 */
export const BADGES = [
  { id: "first_lesson", name: "First Steps", icon: "badge",
    desc: "Complete your first lesson.", goal: 1, value: (s) => s.lessonsCompleted },

  { id: "perfect_score", name: "Perfectionist", icon: "star",
    desc: "Score 100% on any lesson.", goal: 1, value: (s) => s.perfectLessons },

  { id: "streak_3", name: "Warming Up", icon: "charge",
    desc: "Reach a 3-day streak.", goal: 3, value: (s) => s.bestStreak },

  { id: "streak_7", name: "One Week Strong", icon: "charge",
    desc: "Reach a 7-day streak.", goal: 7, value: (s) => s.bestStreak },

  { id: "streak_30", name: "Unstoppable", icon: "goldBadge",
    desc: "Reach a 30-day streak.", goal: 30, value: (s) => s.bestStreak },

  { id: "level_5", name: "Rising Star", icon: "gem",
    desc: "Reach Level 5.", goal: 5, value: (s) => s.level },

  { id: "level_10", name: "Dedicated Learner", icon: "gem2",
    desc: "Reach Level 10.", goal: 10, value: (s) => s.level },

  { id: "easy_all", name: "Easy, Done", icon: "star",
    desc: "Finish all 10 Easy conversations.", goal: 10, value: (s) => s.byLevel.easy },

  { id: "medium_all", name: "Getting Serious", icon: "gem",
    desc: "Finish all 10 Medium conversations.", goal: 10, value: (s) => s.byLevel.medium },

  { id: "hard_all", name: "Difficult? Easy.", icon: "goldBadge",
    desc: "Finish all 10 Difficult conversations.", goal: 10, value: (s) => s.byLevel.hard },

  { id: "graduate", name: "Graduate", icon: "goldBadge",
    desc: "Finish all 30 conversations.", goal: 30, value: (s) => s.lessonsCompleted }
];

/** @returns {Array} every badge with its current {value, earned}, value capped at goal */
export function evaluateBadges(stats) {
  return BADGES.map((b) => {
    const value = Math.min(b.value(stats), b.goal);
    return { ...b, value, earned: value >= b.goal };
  });
}

/** IDs of every badge currently earned - cheap to diff before/after an action. */
export function earnedIds(stats) {
  return evaluateBadges(stats).filter((b) => b.earned).map((b) => b.id);
}
