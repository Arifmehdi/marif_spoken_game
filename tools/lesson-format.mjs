/**
 * A plain-text lesson format, and the converter to the JSON the game reads.
 *
 * JSON is exact but unpleasant to write by hand - quotes, commas, nested
 * arrays - and a teacher adding next week's conversation should not have to
 * count brackets. This format is line based, forgiving about spacing and case,
 * and converts to exactly the same lesson JSON.
 *
 *   topic:      At a Shop
 *   location:   shop
 *   level:      easy
 *   character:  Mr. Verma | shopkeeper
 *   intro:      You need to buy a notebook.
 *   vocabulary: how much, price, rupees
 *
 *   npc:  Welcome! What would you like to buy?
 *
 *   ask:  Say what you want to buy.
 *   ok:   I want to buy a notebook.
 *   ok:   I would like a notebook and a pen.
 *   key:  want, would, need
 *   type: state
 *   slot: item
 *   hint: Try: "I want to buy a notebook."
 *
 * `ok` repeats for each accepted answer - the first is the model answer the
 * hint teaches. `key` is one required idea; commas inside it mean "any of
 * these". Repeat `key` for a second required idea. Both `slot` and `type` are
 * optional.
 *
 * Used by the admin page at /admin/, and importable in Node.
 */

/** Roles the game knows how to cast and voice. */
export const ROLES = ["teacher", "friend", "shopkeeper", "waiter", "police", "mother", "doctor"];

/** The nine settings that exist in the world. */
export const LOCATIONS = ["home", "school", "shop", "restaurant", "hospital",
  "park", "transport", "city", "workplace"];

export const LEVELS = ["easy", "medium", "hard"];

/**
 * What each level is called on screen. The stored value stays `hard`; the
 * client asked for players to read "Difficult".
 */
export const LEVEL_LABELS = { easy: "Easy", medium: "Medium", hard: "Difficult" };

/** What `type:` may say - it tunes how relevance is judged. */
export const TYPES = ["state", "question", "yes_no", "number", "time", "name", "place", "closing", "request"];

const HEAD_KEYS = ["topic", "location", "level", "difficulty", "character", "intro", "vocabulary", "vocab", "day"];

/**
 * @param {string} text
 * @returns {{ lesson: object|null, problems: string[] }}
 */
export function parseLessonText(text) {
  const problems = [];
  const head = {};
  const conversation = [];
  let current = null;          // the student turn being built

  const flush = () => {
    if (!current) return;
    if (!current.expected.length) {
      problems.push('line ' + current.line + ': "ask" has no "ok" answers under it');
    }
    conversation.push(current.turn());
    current = null;
  };

  const lines = String(text).replace(/\r\n/g, "\n").split("\n");

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const no = i + 1;
    if (!line || line.startsWith("#") || line.startsWith("//")) return;

    const at = line.indexOf(":");
    if (at === -1) {
      problems.push("line " + no + ': expected "key: value" but found "' + line.slice(0, 40) + '"');
      return;
    }
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();

    if (HEAD_KEYS.includes(key)) {
      if (conversation.length || current) {
        problems.push("line " + no + ': "' + key + '" belongs at the top, before the conversation');
        return;
      }
      head[key === "vocab" ? "vocabulary" : key === "difficulty" ? "level" : key] = value;
      return;
    }

    switch (key) {
      case "npc":
        flush();
        if (!value) { problems.push("line " + no + ': "npc" line is empty'); return; }
        conversation.push({ npc: value });
        return;

      case "ask": {
        flush();
        if (!value) { problems.push("line " + no + ': "ask" line is empty'); return; }
        const expected = [], keywords = [];
        let type = "state", hint = "", slot = "";
        current = {
          line: no, expected, keywords,
          set: (k, v) => {
            if (k === "ok") expected.push(v);
            else if (k === "key") keywords.push(v.split(",").map((s) => s.trim()).filter(Boolean));
            else if (k === "type") type = v.toLowerCase();
            else if (k === "hint") hint = v;
            else if (k === "slot") slot = v;
          },
          turn: () => {
            const t = {
              speaker: "student", prompt: value, expected,
              keywords: keywords.map((g) => (g.length === 1 ? g[0] : g)),
              expects: type,
              hint: hint || 'Try: "' + (expected[0] || "") + '"',
              points: 0        // filled in once the total turn count is known
            };
            if (slot) t.slot = slot;
            return t;
          }
        };
        return;
      }

      case "ok": case "key": case "type": case "hint": case "slot":
        if (!current) {
          problems.push("line " + no + ': "' + key + '" must come after an "ask" line');
          return;
        }
        if (!value) { problems.push("line " + no + ': "' + key + '" is empty'); return; }
        if (key === "type" && !TYPES.includes(value.toLowerCase())) {
          problems.push("line " + no + ': type "' + value + '" is not one of ' + TYPES.join(", "));
          return;
        }
        current.set(key, value);
        return;

      default:
        problems.push("line " + no + ': unknown key "' + key + '"');
    }
  });
  flush();

  /* ------------------------------------------------------------- the head */

  if (!head.topic) problems.push('missing "topic"');
  if (!head.location) problems.push('missing "location"');
  else if (!LOCATIONS.includes(head.location)) {
    problems.push('location "' + head.location + '" is not one of ' + LOCATIONS.join(", "));
  }
  const level = (head.level || "").toLowerCase();
  if (!level) problems.push('missing "level"');
  else if (!LEVELS.includes(level)) problems.push('level must be easy, medium or hard');

  let character = { id: "friend", name: "Friend", role: "friend" };
  if (!head.character) problems.push('missing "character"');
  else {
    const [name, role = "friend"] = head.character.split("|").map((s) => s.trim());
    const r = role.toLowerCase();
    if (!ROLES.includes(r)) problems.push('role "' + role + '" is not one of ' + ROLES.join(", "));
    character = { id: r, name: name || "Friend", role: r };
  }

  const studentTurns = conversation.filter((t) => t.speaker === "student");
  if (!studentTurns.length) problems.push("the lesson has no student turns");

  // Points are split evenly so any number of turns still totals 100.
  if (studentTurns.length) {
    const each = Math.floor(100 / studentTurns.length);
    let left = 100 - each * studentTurns.length;
    studentTurns.forEach((t) => { t.points = each + (left-- > 0 ? 1 : 0); });
  }

  conversation.forEach((t) => {
    if (t.npc !== undefined) { t.speaker = character.id; t.text = t.npc; delete t.npc; }
  });

  if (problems.length) return { lesson: null, problems };

  return {
    problems: [],
    lesson: {
      lesson_id: "",                       // assigned when the day is chosen
      day: Number(head.day) || 0,
      topic: head.topic,
      location: head.location,
      difficulty: level,
      characters: [character],
      intro: head.intro || "",
      vocabulary: (head.vocabulary || "").split(",").map((s) => s.trim()).filter(Boolean),
      conversation
    }
  };
}

/** The reverse, so an existing lesson can be opened and edited as text. */
export function lessonToText(lesson) {
  const c = (lesson.characters && lesson.characters[0]) || { name: "Friend", role: "friend" };
  const out = [
    "topic:      " + lesson.topic,
    "location:   " + lesson.location,
    "level:      " + (lesson.difficulty || "easy"),
    "character:  " + c.name + " | " + c.role,
    "intro:      " + (lesson.intro || ""),
    "vocabulary: " + (lesson.vocabulary || []).join(", "),
    ""
  ];

  for (const turn of lesson.conversation) {
    if (turn.speaker !== "student") { out.push("npc:  " + turn.text, ""); continue; }
    out.push("ask:  " + turn.prompt);
    (turn.expected || []).forEach((e) => out.push("ok:   " + e));
    (turn.keywords || []).forEach((k) => out.push("key:  " + (Array.isArray(k) ? k.join(", ") : k)));
    if (turn.expects) out.push("type: " + turn.expects);
    if (turn.slot) out.push("slot: " + turn.slot);
    if (turn.hint) out.push("hint: " + turn.hint);
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}
