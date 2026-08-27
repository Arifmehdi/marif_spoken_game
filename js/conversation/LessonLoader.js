/**
 * LessonLoader - reads the lesson manifest and lesson files.
 *
 * This is the ONLY module that knows where lesson content lives. Adding a new
 * daily lesson means: drop day_0NN.json in data/lessons/ and add one line to
 * manifest.json. No engine code changes - requirement 11 of the specification.
 */
export class LessonLoader {
  constructor(basePath = "data/lessons/") {
    this.basePath = basePath;
    this.manifest = null;
    this.cache = new Map();
  }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    const res = await fetch(this.basePath + "manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load manifest.json (" + res.status + ")");
    this.manifest = await res.json();
    this.manifest.lessons.sort((a, b) => a.day - b.day);
    return this.manifest;
  }

  async loadLesson(entry) {
    const key = entry.file;
    if (this.cache.has(key)) return this.cache.get(key);
    const res = await fetch(this.basePath + key, { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load " + key + " (" + res.status + ")");
    const lesson = await res.json();
    this.validate(lesson, key);
    this.cache.set(key, lesson);
    return lesson;
  }

  async loadByDay(day) {
    const manifest = await this.loadManifest();
    const entry = manifest.lessons.find((l) => l.day === day);
    if (!entry) throw new Error("No lesson defined for day " + day);
    return this.loadLesson(entry);
  }

  /** Fails loudly on malformed content so a bad lesson file is obvious. */
  validate(lesson, file) {
    const problems = [];
    if (!lesson.lesson_id) problems.push("missing lesson_id");
    if (!Array.isArray(lesson.conversation) || !lesson.conversation.length) {
      problems.push("conversation must be a non-empty array");
    } else {
      lesson.conversation.forEach((turn, i) => {
        if (!turn.speaker) problems.push("turn " + i + ": missing speaker");
        if (turn.speaker === "student") {
          if (!Array.isArray(turn.expected) || !turn.expected.length) {
            problems.push("turn " + i + ": student turn needs an expected[] array");
          }
        } else if (!turn.text) {
          problems.push("turn " + i + ": NPC turn needs text");
        }
      });
    }
    if (problems.length) {
      throw new Error("Invalid lesson " + file + ":\n  - " + problems.join("\n  - "));
    }
  }

  /** Only the student turns - these are the ones that get scored. */
  static studentTurns(lesson) {
    return lesson.conversation.filter((t) => t.speaker === "student");
  }

  /**
   * Which lesson should the student play now? The first one they have not
   * finished. Once everything is done we cycle back for revision.
   */
  async nextLessonEntry(progress) {
    const manifest = await this.loadManifest();
    const done = progress.completedLessonIds();
    const pending = manifest.lessons.find((l) => !done.includes("day_" + String(l.day).padStart(3, "0")));
    return pending || manifest.lessons[0];
  }
}
