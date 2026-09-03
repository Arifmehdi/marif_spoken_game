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

1. Create `data/lessons/day_031.json` (or write it through the admin page at
   `/admin/`, which does this for you — see `docs/ADMIN.md`)
2. Run `npm run build:lessons`, which rebuilds `manifest.json` from whatever
   `day_*.json` files are on disk

That is the whole process. The engine picks it up on the next reload.

```json
{
  "lesson_id": "day_031",
  "day": 31,
  "topic": "At the Bus Stop",
  "location": "city",
  "difficulty": "easy",
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
| `expects` | `state`, `question`, `yes_no`, `number`, `time`, `name`, `place`, `closing`, `request` — checks the *kind* of answer |
| `slot` | Marks an open slot: the student may use their own name/town/food without being marked wrong |
| `forbidden` | Words that should cost marks |
| `hint` | Revealed by the Hint button |
| `points` | Maximum XP for the turn |

`location` may be any of the nine places: `home`, `school`, `shop`,
`restaurant`, `hospital`, `park`, `transport`, `city`, `workplace`. `role` (per character) drives both the 3D look and the voice:
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
| 1 | Daily lesson system | Done — 30 lessons (10 settings x easy/medium/hard), next-unfinished is served each day |
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
    LocationFactory.js   the 9 places
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
docs/ADMIN.md            how to add a lesson (no code changes)
tools/serve.mjs          dev server
admin/index.html         admin page: sign in, write a lesson, publish it
tools/lesson-format.mjs      the plain-text lesson format
tools/build-lessons.mjs      validate lessons, rebuild the manifest (npm run build:lessons)
tools/build-character.html   merge per-animation FBX into one character .glb
tools/fbx-to-glb.html        FBX prop -> centred, scaled .glb
tools/build-props.mjs        OBJ / .blend / .glb scenery -> small .glb (npm run build:props)
tools/blend.mjs              read-only .blend parser used by build-props
tools/optimize-models.mjs    shrink character .glb for mobile    (npm run optimize)
tests/evaluator.test.mjs scoring tests
tests/lessons.test.mjs   every lesson graded against its own model answers
```

Only `spoken_game/*/optimized/` is ever downloaded by the game. The raw artist
sources next to it are kept for rebuilds and do not need to be deployed.

Controls: **WASD / arrows** or the on-screen stick to walk, **E** or the Talk
button to start a conversation, **M** to toggle the microphone, **Esc** to leave.

---

## Third-party assets

Everything under `spoken_game/props/` came from outside the project. Licences
differ, and two of them place conditions on shipping the game.

| Asset | Used in | Licence | Obligation |
|---|---|---|---|
| "Isometric Hospital Room" by **graphyTV**, Blend Swap #89028 | hospital ward | CC BY 3.0 | **Attribution required.** Credited on the Settings screen and here. |
| "Bookshelf" by Doug C, Blend Swap #66550 | classroom shelves | CC0 (public domain) | None |
| `eb_house_plant_01` by Ernesto Bezera | classroom plant | **"NOT FOR COMMERCIAL USE"** | **Unresolved** — see below |
| `fountain.fbx`, `bus.obj` + livery, `bus_stop.blend` | park, bus stop | supplied by the client | client to confirm |

> **The plant is a problem for a paid delivery.** Its `READ_ME.txt` opens with
> "NOT FOR COMMERCIAL USE". The build pipeline does not care which plant it is,
> so swapping in a differently-licensed model and re-running
> `npm run build:props` is a one-line change.

If the hospital ward is ever removed, the Settings credit for it should go too —
it exists to satisfy that model's licence.

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
