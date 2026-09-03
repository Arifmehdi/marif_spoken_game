/**
 * Build the lesson set: ten settings x three levels = thirty days.
 *
 *   days  1-10   easy     already written by hand, only re-tiered here
 *   days 11-20   medium   from tools/lessons/medium.mjs
 *   days 21-30   hard     from tools/lessons/hard.mjs
 *
 * The compact definitions in tools/lessons/*.mjs are expanded into the full
 * lesson JSON the game reads, and the manifest is rewritten to match. Editing a
 * lesson by hand in data/lessons/ still works exactly as before - this only
 * exists so twenty files stay consistent with each other.
 *
 *   npm run build:lessons              # validate every lesson, rebuild the manifest
 *   npm run build:lessons -- --check   # validate only, write nothing
 *   npm run build:lessons -- --force   # also regenerate days 11-30 from tools/lessons/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import medium from "./lessons/medium.mjs";
import hard from "./lessons/hard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data/lessons");
const CHECK_ONLY = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");

const POINTS_PER_TURN = 20;

/** Turn the compact form into the shape the game loads. */
function expand(def, level) {
  const conversation = [];
  for (const turn of def.turns) {
    if (turn.npc) {
      conversation.push({ speaker: def.character.id, text: turn.npc });
      continue;
    }
    const student = {
      speaker: "student",
      prompt: turn.prompt,
      expected: turn.expected,
      keywords: turn.keywords,
      expects: turn.expects,
      hint: turn.hint,
      points: turn.points || POINTS_PER_TURN
    };
    if (turn.slot) student.slot = turn.slot;
    conversation.push(student);
  }

  return {
    lesson_id: "day_" + String(def.day).padStart(3, "0"),
    day: def.day,
    topic: def.topic,
    location: def.location,
    difficulty: level,
    characters: [def.character],
    intro: def.intro,
    vocabulary: def.vocabulary,
    conversation
  };
}

/* ------------------------------------------------------------- validation */

/** The same rules LessonLoader enforces, plus the ones that only bite later. */
function check(lesson) {
  const problems = [];
  if (!lesson.lesson_id) problems.push("missing lesson_id");
  if (!lesson.location) problems.push("missing location");
  if (!["easy", "medium", "hard"].includes(lesson.difficulty)) {
    problems.push("difficulty must be easy, medium or hard");
  }
  if (!Array.isArray(lesson.conversation) || !lesson.conversation.length) {
    problems.push("conversation must be a non-empty array");
    return problems;
  }

  const speakers = new Set(lesson.characters.map((c) => c.id));
  let studentTurns = 0;
  let points = 0;

  lesson.conversation.forEach((turn, i) => {
    const at = "turn " + i;
    if (!turn.speaker) { problems.push(at + ": missing speaker"); return; }

    if (turn.speaker !== "student") {
      if (!turn.text) problems.push(at + ": NPC turn needs text");
      if (!speakers.has(turn.speaker)) problems.push(at + ": speaker '" + turn.speaker + "' is not in characters[]");
      return;
    }

    studentTurns++;
    points += turn.points || 0;
    if (!Array.isArray(turn.expected) || !turn.expected.length) {
      problems.push(at + ": student turn needs an expected[] array");
    }
    if (!turn.prompt) problems.push(at + ": student turn needs a prompt");
    if (!turn.hint) problems.push(at + ": student turn needs a hint");

    // A keyword that appears in no model answer can never be earned - the
    // evaluator checks it against the best-matching expected sentence.
    const words = new Set((turn.expected || []).join(" ").toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean));
    // An entry is either one required word, or an array meaning "any of these".
    (turn.keywords || []).forEach((entry, g) => {
      const group = Array.isArray(entry) ? entry : [entry];
      if (!group.length || group.some((k) => typeof k !== "string" || !k.trim())) {
        problems.push(at + ": keyword " + g + " is empty");
        return;
      }
      if (!group.some((k) => words.has(k.toLowerCase()))) {
        problems.push(at + ": no model answer contains any of [" + group.join(", ") + "]");
      }
    });
  });

  if (studentTurns < 3) problems.push("needs at least 3 student turns, found " + studentTurns);
  if (points !== 100) problems.push("points should total 100, found " + points);
  return problems;
}

/* ------------------------------------------------------------------- main */

function main() {
  /*
   * --force regenerates days 11-30 from the definitions in tools/lessons/.
   * Without it nothing already on disk is touched: an admin who edits a lesson
   * by hand, or adds one through the editor, must not have it silently
   * overwritten the next time someone rebuilds the manifest.
   */
  if (FORCE) {
    for (const def of [...medium, ...hard]) {
      const lesson = expand(def, medium.includes(def) ? "medium" : "hard");
      fs.writeFileSync(path.join(DIR, lesson.lesson_id + ".json"),
        JSON.stringify(lesson, null, 2) + "\n");
    }
  }

  // The manifest is always rebuilt from whatever is actually in the folder, so
  // adding a file is the only step needed to add a lesson.
  const built = fs.readdirSync(DIR)
    .filter((f) => /^day_\d+\.json$/.test(f))
    .map((f) => {
      const file = path.join(DIR, f);
      let lesson;
      try {
        lesson = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        console.error(f + " is not valid JSON: " + err.message);
        process.exit(1);
      }
      return { lesson, file };
    });

  if (!built.length) { console.error("no day_*.json files in " + DIR); process.exit(1); }
  built.sort((a, b) => a.lesson.day - b.lesson.day);

  const days = built.map(({ lesson }) => lesson.day);
  const duplicate = days.find((d, i) => days.indexOf(d) !== i);
  if (duplicate !== undefined) {
    console.error("two lessons both claim day " + duplicate);
    process.exit(1);
  }

  let bad = 0;
  for (const { lesson } of built) {
    const problems = check(lesson);
    if (!problems.length) continue;
    bad++;
    console.error("\n" + lesson.lesson_id + " (" + lesson.topic + ")");
    problems.forEach((p) => console.error("   - " + p));
  }
  if (bad) { console.error("\n" + bad + " lesson(s) failed validation - nothing written"); process.exit(1); }

  if (CHECK_ONLY) {
    console.log("All " + built.length + " lessons valid.");
    return;
  }

  const manifest = {
    version: 1,
    title: "Spoken English Adventure",
    description: "Daily conversation lessons. Ten places, three levels each. " +
      "Add a file here and the game picks it up - no code changes.",
    lessons: built.map(({ lesson }) => ({
      day: lesson.day,
      file: lesson.lesson_id + ".json",
      topic: lesson.topic,
      location: lesson.location,
      difficulty: lesson.difficulty
    }))
  };
  fs.writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const tally = {};
  built.forEach(({ lesson }) => {
    tally[lesson.difficulty] = (tally[lesson.difficulty] || 0) + 1;
  });
  const places = new Set(built.map(({ lesson }) => lesson.location));

  console.log("Manifest rebuilt from " + built.length + " lesson files.");
  console.log("  levels   : " + Object.entries(tally).map(([k, v]) => k + " " + v).join(", "));
  console.log("  settings : " + places.size + " (" + [...places].join(", ") + ")");
}

main();
