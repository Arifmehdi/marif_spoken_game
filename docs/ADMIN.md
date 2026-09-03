# Admin guide — adding and editing lessons

Everything a lesson needs lives in `data/lessons/`. **No JavaScript is ever
edited to add a conversation.** That is requirement 11 of the specification, and
this guide is the whole of what an administrator has to know.

---

## What is in the game today

**30 lessons** — ten settings, three levels each.

| | easy | medium | hard |
|---|---|---|---|
| School | Day 1 · At School | Day 11 · Asking the Teacher for Help | Day 21 · Giving a Short Talk |
| Park | Day 2 · Meeting a New Friend | Day 12 · Playing a Game Together | Day 22 · Making Plans with a Friend |
| Shop | Day 3 · At a Shop | Day 13 · Buying Clothes | Day 23 · Returning Something |
| Restaurant | Day 4 · At a Restaurant | Day 14 · Ordering for Two | Day 24 · A Problem with the Order |
| City | Day 5 · Asking for Directions | Day 15 · Finding the Post Office | Day 25 · Reporting a Lost Bag |
| Home | Day 6 · Talking About Family | Day 16 · Helping at Home | Day 26 · Talking About Your Future |
| Home | Day 7 · Daily Routine | Day 17 · Talking About the Weekend | Day 27 · A Phone Call from a Relative |
| Hospital | Day 8 · At the Doctor | Day 18 · Getting Medicine | Day 28 · Explaining Your Symptoms |
| Bus Stop | Day 9 · At the Bus Stop | Day 19 · Buying a Ticket | Day 29 · Asking About a Delay |
| Workplace | Day 10 · At the Workplace | Day 20 · Meeting a New Colleague | Day 30 · A Job Interview |

Home appears twice because it carries two different conversations. That is why
there are ten rows from nine places.

---

## The admin page

```bash
npm start
```

Then open **<http://localhost:5173/admin/>** and sign in.

### Setting the password

Either an environment variable:

```bash
ADMIN_PASSWORD=your-password npm start
```

…or `admin.config.json` in the project root, which is git-ignored:

```json
{ "password": "your-password" }
```

With neither, the server invents one and prints it on startup, so it is never
left running with a default that anyone could guess.

> **The password is checked by the server, not by the page.** A login written
> only in browser JavaScript stops nobody — the code is right there to read. So
> the endpoint that writes files refuses anything without a valid session, and
> the page merely collects the password. Signing in with the wrong password,
> forging a token, or POSTing straight to the endpoint all return 401. Even
> signed in, the only thing that can be written is a `.json` inside
> `data/lessons/` — a path pointing anywhere else is refused.

### Writing a lesson

1. Pick a **day number** and a **level** (Easy / Medium / Difficult).
2. Write the conversation in the plain-text format below.
3. Press **Check**. It validates and previews the whole conversation.
4. Press **Publish to the game**. It is live immediately — the page rebuilds
   the game's lesson index itself, so there is nothing to run in a terminal.
   Just reload the game.

The **Conversations** list on the left shows every lesson in the game, grouped
under Easy / Medium / Difficult. Click any of them to load it back in as text,
so a conversation can be corrected without touching JSON. **+ New
conversation** clears the editor onto the next unused day number. **Show
JSON** displays exactly what will be written.

**Reset all to standard**, top right, undoes admin mistakes: it copies the
original 30 lessons from `data/lessons/defaults/` back over
`data/lessons/day_001.json`–`day_030.json`, discarding any edits made to them.
It asks for confirmation first, and it never touches a lesson you added beyond
day 30 — there is no "original" for those to reset to. To update what
"standard" means (e.g. after deliberately improving one of the 30), overwrite
the matching file in `data/lessons/defaults/` with the new version.

### The text format

```
topic:      At the Library
location:   school
level:      medium
character:  Mrs. Sharma | teacher
intro:      You want to borrow a book. Ask the librarian for help.
vocabulary: borrow, return, shelf, library card

npc:  Good afternoon. Are you looking for something?

ask:  Say that you want to borrow a book.
ok:   I want to borrow a book.
ok:   I would like to borrow a book, please.
key:  borrow
type: state
hint: Try: "I want to borrow a book."
```

| Key | Meaning |
|---|---|
| `npc:` | A line the character says |
| `ask:` | What the student is asked to do |
| `ok:` | An accepted answer. Repeat it for each wording you will accept. **The first one is the model answer** the hint teaches |
| `key:` | A required idea. Commas mean "any of these". Repeat `key:` for a second required idea |
| `type:` | `state`, `question`, `yes_no`, `number`, `time`, `name`, `place`, `closing` or `request` — tunes how the answer is judged |
| `slot:` | Marks an open answer, so a student may use their own name, town or food without being marked wrong |
| `hint:` | Shown by the Hint button. Left out, it quotes the first `ok:` |

Points are split evenly across the student turns and always total 100, whether
there are three turns or six.

---

## The other way: write the JSON directly

`data/lessons/day_031.json`, in the same shape as every existing lesson. Copy
the nearest one and edit it. Then:

```bash
npm run build:lessons
```

That rebuilds `manifest.json` **from whatever files are in the folder**, so
adding a file is genuinely the only step. It never overwrites a lesson you
wrote — use `--force` only if you want days 11–30 regenerated from the
templates in `tools/lessons/`.

---

## Checking your work

```bash
npm run check:lessons     # validates every lesson, writes nothing
node tests/lessons.test.mjs
```

`check:lessons` catches the structural mistakes: a missing hint, a level that is
not easy/medium/hard, points that do not total 100, a speaker who is not in
`characters`, two lessons claiming the same day.

`tests/lessons.test.mjs` catches the content mistake that matters most: it plays
**every accepted answer of every lesson** through the real scoring engine and
fails if any of them scores badly. A lesson whose own model answer does not pass
is a lesson that punishes a student for saying exactly what they were told to
say. All 455 answers currently average 99.6–99.9%.

The trap it exists to catch: a `key:` word that appears in **none** of your
`ok:` answers can never be earned, so that turn is capped no matter what the
student says. Both tools report it by name.

---

## Reference

**Locations** — `home`, `school`, `shop`, `restaurant`, `hospital`, `park`,
`transport`, `city`, `workplace`.

**Roles** — `teacher`, `friend`, `shopkeeper`, `waiter`, `police`, `mother`,
`doctor`. The role picks the character's 3D model **and** their voice, and it is
gender-aware: a name beginning `Mr.` gets a man's voice and body whatever the
role says. See `js/world/Casting.js`.

**Scoring knobs** — `data/config/scoring.json` holds the weights, penalties,
score bands, rewards and synonym groups. Changing "well" to count as "fine"
happens there, not in code.

---

## Where this runs

The admin page works both ways, with no setup step either way:

- **`npm start`**, then <http://localhost:5173/admin/> — the small Node server
  in `tools/serve.mjs` checks the password and writes the file.
- **Laragon/Apache**, then `http://localhost/.../admin/` — the same two jobs
  are done by PHP (`admin/api/login.php`, `admin/api/save.php`, etc.), reading
  and writing the exact same files Apache serves. Needs a password set with
  `npm run admin:password` first (see above); PHP has no access to a
  Node-only `ADMIN_PASSWORD` environment variable.

Either way, Publish writes straight to `data/lessons/` and rebuilds
`manifest.json` itself — the lesson is live the moment the game is reloaded,
nothing to run in a terminal. The lessons themselves are plain JSON files:
they can also be edited in any text editor and committed like code, but then
`npm run build:lessons` does need to be run by hand to pick the change up.

---

## Store and daily reward

Both live under **Store** and open automatically as **Daily Reward** in the
main menu, and both are priced/tuned entirely from `data/config/scoring.json`
— no code changes to add an item or change what a day pays out.

- **`store`** — one entry per item (`name`, `icon`, `price`, `desc`). Two of
  the three (`streakFreeze`, `hintPack`) are generic: buying them just
  increments a counter in `ProgressStore` (`streakFreezes`, `hintCredits`).
  `skipLesson` is the one exception - `Game.buyStoreItem()` handles it
  specially because completing a lesson needs the lesson content, which
  `ProgressStore` deliberately knows nothing about.
- **`dailyReward.coins`** — a 7-day array of coin amounts. Opening the game on
  consecutive days climbs the array; missing a day resets to day 1. The last
  day also grants a Streak Freeze. Shown once per session, the first time the
  main menu is reached.
- **Streak Freeze** is spent automatically the first time a student returns
  after missing exactly one day — `ProgressStore.touchStreak()` — and the
  Results screen says so when it happens. Missing two or more days still
  resets the streak; a freeze only ever covers one.
- **Hint credits** add a second, stronger help button next to the existing
  free hint during a conversation: it fills in the model answer, but the
  student still has to press Send. The always-free text hint is unchanged.

---

## Badges

`js/progress/Badges.js` is the entire catalog — one entry per badge, each
naming an existing icon (`js/ui/Menu.js`'s `ICONS`, the same art the HUD and
Store use), a goal, and a `value()` function reading it out of
`ProgressStore.badgeStats()`. Add a row there and it appears everywhere
automatically: the **Badges** screen, its "N of 11 earned" count on the main
menu, and the toast that fires the moment it is crossed.

No badge is tracked separately - `badgeStats()` re-derives everything
(lessons completed, best streak, level, perfect scores, completions per
level) from data `ProgressStore` already keeps, cross-referenced against the
manifest for which lesson belongs to which level. That is also why
`Game.announceNewBadges()` takes a snapshot of earned badge IDs *before*
`recordLesson()` runs and diffs it against the state *after* - there is no
stored "already told the player about this one" flag to check instead.
