import fs from "node:fs";
import { pathToFileURL } from "node:url";

import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Evaluator } = await import(pathToFileURL(ROOT + "/js/conversation/Evaluator.js").href);
const cfg = JSON.parse(fs.readFileSync(ROOT + "/data/config/scoring.json", "utf8"));
const ev = new Evaluator(cfg);

const howAreYou = {
  expected: ["I am fine, thank you.", "I am good, thank you.", "I am fine.", "Good morning, I am fine."],
  keywords: [["fine", "good", "well"]],
  expects: "state",
  points: 20
};
const yourName = {
  expected: ["My name is Rahul.", "My name is Arjun.", "I am Rahul.", "My name is Priya."],
  keywords: ["name"],
  expects: "name",
  slot: "name",
  points: 20
};

const cases = [
  // [label, turn, input, expectedBandLow, expectedBandHigh]
  ["spec: I am fine, thank you.", howAreYou, "I am fine, thank you.", 90, 100],
  ["spec: I am good.", howAreYou, "I am good.", 75, 100],
  ["spec: I'm fine.", howAreYou, "I'm fine.", 85, 100],
  ["spec: I am doing well. (synonym)", howAreYou, "I am doing well.", 70, 100],
  ["spec: My name is Rahul. => 100%", yourName, "My name is Rahul.", 90, 100],
  ["spec: Name Rahul. => ~65%", yourName, "Name Rahul.", 50, 74],
  ["wrong topic", howAreYou, "I like cricket very much.", 0, 40],
  ["gibberish", howAreYou, "banana table purple", 0, 30],
  ["empty", howAreYou, "", 0, 0],
  ["one word", howAreYou, "fine", 40, 75],
  ["own name (open slot)", yourName, "My name is Sameer.", 85, 100],
  ["own name, short form", yourName, "I am Sameer.", 75, 100],
  ["slot must not rescue nonsense", yourName, "I like cricket.", 0, 50],
  ["no subject/verb", yourName, "Rahul", 0, 55]
];

let pass = 0, fail = 0;
console.log("");
console.log("  score  range     case");
console.log("  -----  --------  ----------------------------------------");
for (const [label, turn, input, lo, hi] of cases) {
  const r = ev.evaluate(input, turn, { mode: "type" });
  const ok = r.correctness >= lo && r.correctness <= hi;
  ok ? pass++ : fail++;
  console.log(
    "  " + String(r.correctness).padStart(3) + "%  " +
    (ok ? " ok " : "FAIL") + "  " + (lo + "-" + hi).padEnd(8) + "  " + label
  );
  if (!ok) {
    const b = r.breakdown;
    console.log("         kw=" + b.keywords.toFixed(2) + " sim=" + b.similarity.toFixed(2) +
      " gram=" + b.grammar.toFixed(2) + " rel=" + b.relevance.toFixed(2) + " pen=" + b.penalty.toFixed(2));
  }
}
console.log("");
console.log("  " + pass + " passed, " + fail + " failed");

// Show a full result object once, so the UI contract is visible.
console.log("\n  sample result for \"I am good.\":");
const sample = ev.evaluate("I am good.", howAreYou, { mode: "speak", confidence: 0.88 });
console.log("   ", JSON.stringify({
  correctness: sample.correctness, band: sample.band.label, points: sample.points,
  stars: sample.stars, stats: sample.stats, feedback: sample.feedback
}));
process.exit(fail ? 1 : 0);
