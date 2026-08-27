# Spoken English Adventure

A browser-based 3D conversation game for learning spoken English, built with
Three.js. The student walks around a location, approaches an NPC, and answers by
**speaking** or **typing**. Every answer is scored for correctness, and progress
is saved day by day.

No build step, no framework, no npm install. Open it and it runs.

---

## Running it

**With Laragon (Apache)** — the project already sits in `www`:

```bash
start http://localhost/freelancer/spoken_game/
```

**Without Laragon** — a zero-dependency dev server is included:

```bash
node tools/serve.mjs
```

Then open <http://localhost:5173/>.

> Do **not** open `index.html` by double-clicking. Browsers block `fetch()` on
> `file://` URLs, so the lesson JSON will not load. It must be served over http.
> If you do open it directly, the page now detects this and shows the correct
> localhost link instead of hanging on the loading spinner.

Run the scoring tests with:

```bash
node tests/evaluator.test.mjs
```

---

## Adding a new daily lesson (no code changes)

This is the core requirement from section 11 of the specification. The
conversation engine and the lesson content are completely separate.

1. Create `data/lessons/day_009.json`
2. Add one line to `data/lessons/manifest.json`

That is the whole process. The engine picks it up on the next reload.

```json
{
  "lesson_id": "day_009",
  "day": 9,
  "topic": "At the Bus Stop",
  "location": "city",
  "difficulty": "beginner",
  "characters": [{ "id": "driver", "name": "Mr. Khan", "role": "police" }],
  "intro": "Ask the driver which bus goes to the market.",
  "vocabulary": ["ticket", "bus", "how much"],
  "conversation": [
    { "speaker": "driver", "text": "Where do you want to go?" },
    {
      "speaker": "student",
      "prompt": "Say where you want to go.",
      "expected": ["I want to go to the market.", "To the market, please."],
      "keywords": [["market"]],
      "expects": "place",
      "slot": "place",
      "hint": "Try: \"I want to go to the market.\"",
      "points": 20
    }
  ]
}
```

### Student turn fields

| Field | Purpose |
|---|---|
| `prompt` | Shown to the student as the instruction |
| `expected` | Accepted answers. **Any** of them scores full marks |
| `keywords` | Required ideas. A nested array means "any one of these" |
| `expects` | `state`, `question`, `yes_no`, `number`, `time`, `name`, `place` — checks the *kind* of answer |
| `slot` | Marks an open slot: the student may use their own name/town/food without being marked wrong |
| `forbidden` | Words that should cost marks |
| `hint` | Revealed by the Hint button |
| `points` | Maximum XP for the turn |

`location` may be any of: `school`, `home`, `shop`, `restaurant`, `hospital`,
`park`, `city`. `role` (per character) drives both the 3D look and the voice:
`teacher`, `friend`, `shopkeeper`, `waiter`, `police`, `mother`, `doctor`.

---

## Tuning the scoring

Everything lives in `data/config/scoring.json` — no code changes needed:

- `weights` — how much keywords / similarity / grammar / relevance each count
- `penalties` — missing words, wrong words, too-short answers
- `bands` — the score-to-stars-to-XP table (section 6 of the spec)
- `rewards` — coins per star, perfect-lesson and streak bonuses
- `synonymGroups` — so "well" is accepted where the lesson says "fine"

---

## How an answer is scored

The evaluator never demands an exact sentence match. It blends four signals and
then applies penalties:

| Signal | What it asks |
|---|---|
| Keywords | Did the answer contain the required ideas? (synonym aware) |
| Similarity | How close is the wording to any accepted answer? (token overlap + edit distance) |
| Grammar | Does it look like a sentence? (subject, verb, word order) |
| Relevance | Is it an appropriate answer to *that* question? |

Penalties cover missing words, incorrect words, and one-word answers.

Worked examples, all verified in `tests/evaluator.test.mjs`:

| Question | Student says | Score |
|---|---|---|
| How are you today? | "I am fine, thank you." | 100% |
| How are you today? | "I'm fine." | 100% |
| How are you today? | "I am good." | 95% |
| How are you today? | "I am doing well." | 86% |
| What is your name? | "My name is Rahul." | 100% |
| What is your name? | "My name is Sameer." *(own name)* | 100% |
| What is your name? | "Name Rahul." | 73% |
| What is your name? | "I like cricket." | 8% |

**Pronunciation** uses the confidence score returned by the speech recogniser.
Typed answers report `null` rather than 0, so typing never drags the speaking
average down. Accent is not penalised, per section 8 of the spec.

---

## Specification coverage

| # | Requirement | Status |
|---|---|---|
| 1 | Daily lesson system | Done — 8 lessons, next-unfinished is served each day |
| 2 | Lessons stored in JSON | Done — `data/lessons/`, validated on load |
| 3 | Interactive conversation, speak or type | Done — Web Speech API + typing fallback |
| 4 | Response evaluation (not exact match) | Done — see above |
| 5 | Correctness percentage | Done — shown after every answer |
| 6 | Conversation score + immediate feedback | Done — bands, stars, XP per answer |
| 7 | Complete conversation score | Done — results screen with per-question table |
| 8 | Speaking performance stats | Done — vocabulary, sentence, relevance, pronunciation |
| 9 | Daily reward | Done — XP, coins, stars, streak and perfect-lesson bonuses |
| 10 | Progress tracking | Done — average, best, streak, improvement trend, per-day history |
| 11 | Engine separate from content | Done — adding a lesson touches no JavaScript |

---

## Browser support

| Browser | Speaking | Typing |
|---|---|---|
| Chrome / Edge (desktop) | Yes | Yes |
| Chrome (Android) | Yes | Yes |
| Safari (macOS/iOS) | No | Yes |
| Firefox | No | Yes |

Speech recognition needs `https://` or `localhost`. On a plain `http://` LAN
address the browser silently blocks the microphone — the game detects this and
switches to typing with an explanation.

---

## Project layout

```
index.html               page shell
css/style.css            all interface styling
js/
  main.js                boot + error screen
  core/
    Game.js              wires world + conversation + UI together
    SceneManager.js      renderer, lights, follow camera
    InputManager.js      keyboard and on-screen thumbstick
  world/
    CharacterFactory.js  procedural cartoon characters
    LocationFactory.js   the 7 places
    Player.js            movement and collision
    NPC.js               proximity, markers, facing
  conversation/
    LessonLoader.js      reads + validates lesson JSON
    ConversationEngine.js turn flow, retries, summary
    Evaluator.js         the scoring engine
    SpeechInput.js       Web Speech API wrapper
    SpeechOutput.js      NPC voices
  progress/
    ProgressStore.js     XP, coins, streak, history (localStorage)
  ui/
    UI.js                HUD, speech bubbles, answer panel
    Screens.js           start, brief, results, progress, map, settings
data/
  lessons/               lesson content + manifest
  config/scoring.json    all scoring knobs
tools/serve.mjs          dev server
tests/evaluator.test.mjs scoring tests
```

Controls: **WASD / arrows** or the on-screen stick to walk, **E** or the Talk
button to start a conversation, **M** to toggle the microphone, **Esc** to leave.

---

## Troubleshooting

**"Blocked by CORS policy" / "file: URLs are treated as unique security
origins" / the loading spinner never finishes.**
The game was opened straight from disk. `file://` is a unique origin, so the
browser blocks both the ES modules and the lesson JSON before any game code
runs. Serve it over http instead — see *Running it* above. The page detects this
case and shows the right link.

**An edit to a `.js` file seems to have no effect.**
Browsers cache ES modules very aggressively. `.htaccess` in the project root
sends `Cache-Control: no-store` for js/json/css/html to prevent this. If you
still get a stale file, do a hard reload (Ctrl+F5) or open a private window.
Relax that `.htaccess` block before deploying to production.

**The microphone button does nothing.**
Speech recognition needs Chrome or Edge, and an `https://` or `localhost`
address. On a plain `http://192.168.x.x` LAN address the browser blocks it
silently. The game falls back to typing and explains why.

---

## Known limits of this build

- Characters are built from primitives, not modelled art. `CharacterFactory`
  keeps standard part names so a GLB rig can replace it without touching
  gameplay code.
- Progress is stored in `localStorage` (per browser, per device).
  `ProgressStore` holds plain serialisable data, so moving it behind a login and
  a REST call is a contained change.
- Grammar checking is heuristic (subject/verb/word order), not a parser. It is
  deliberately forgiving, which suits beginners.
- NPC audio uses the browser's built-in voices. Recorded audio per line would
  sound better and would be a drop-in addition to `SpeechOutput`.
