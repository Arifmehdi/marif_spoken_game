/**
 * Every lesson's own model answers must score well.
 *
 * A lesson whose `expected` sentences do not pass its own `keywords` and
 * `expects` rules is broken content: the student is being marked down for
 * saying exactly what the lesson told them to say. This walks all thirty
 * lessons and scores every accepted answer against its turn.
 *
 *   node tests/lessons.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Evaluator } = await import(pathToFileURL(ROOT + "/js/conversation/Evaluator.js").href);
const cfg = JSON.parse(fs.readFileSync(ROOT + "/data/config/scoring.json", "utf8"));
const ev = new Evaluator(cfg);

const DIR = path.join(ROOT, "data/lessons");
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));

/** The first model answer is the one the hint teaches, so hold it highest. */
const PRIMARY_MIN = 85;
const ALTERNATE_MIN = 70;

let checked = 0;
const failures = [];
const byLevel = {};

for (const entry of manifest.lessons) {
  const lesson = JSON.parse(fs.readFileSync(path.join(DIR, entry.file), "utf8"));
  const level = lesson.difficulty;
  byLevel[level] = byLevel[level] || { n: 0, total: 0, worst: 100, worstAt: "" };

  lesson.conversation.forEach((turn, i) => {
    if (turn.speaker !== "student") return;
    turn.expected.forEach((answer, k) => {
      const result = ev.evaluate(answer, turn, { mode: "speak", confidence: 0.9 });
      const floor = k === 0 ? PRIMARY_MIN : ALTERNATE_MIN;
      checked++;
      byLevel[level].n++;
      byLevel[level].total += result.correctness;
      if (result.correctness < byLevel[level].worst) {
        byLevel[level].worst = result.correctness;
        byLevel[level].worstAt = lesson.lesson_id + " turn " + i;
      }
      if (result.correctness < floor) {
        failures.push({
          lesson: lesson.lesson_id, topic: lesson.topic, turn: i, which: k,
          answer, percent: result.correctness, floor,
          prompt: turn.prompt
        });
      }
    });
  });
}

console.log("Scored " + checked + " model answers across " + manifest.lessons.length + " lessons\n");
for (const [level, s] of Object.entries(byLevel)) {
  console.log("  " + level.padEnd(7) + s.n + " answers   average " +
    (s.total / s.n).toFixed(1) + "%   lowest " + s.worst + "% (" + s.worstAt + ")");
}

if (failures.length) {
  console.error("\n" + failures.length + " model answer(s) scored below their floor:\n");
  failures.forEach((f) => {
    console.error("  " + f.lesson + " turn " + f.turn + (f.which === 0 ? " (primary)" : " (alternate)"));
    console.error("     prompt : " + f.prompt);
    console.error("     answer : \"" + f.answer + "\"");
    console.error("     scored : " + f.percent + "%  (needs " + f.floor + "%)\n");
  });
  process.exit(1);
}

console.log("\nAll model answers pass their own lesson.");
