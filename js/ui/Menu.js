/**
 * Menu - the front end of the game: title menu, character select, location select.
 *
 * Structured like a real game shell (main menu -> pick character -> pick place ->
 * play) and drawn OVER the live 3D scene, so the world keeps moving behind it.
 *
 * All artwork comes from the client's asset pack in spoken_game/. Those PNGs have
 * no alpha channel, so every image sits on a light card - the same way the
 * original artwork sheet presents them - and the baked background disappears.
 */
import { LOCATION_META } from "../world/LocationFactory.js";
import { BADGES, evaluateBadges } from "../progress/Badges.js";

export const ART = "spoken_game/";

/**
 * The three levels, in order. `id` is what the lesson JSON stores; `label` is
 * what the player reads - the client asked for "Difficult" rather than "Hard".
 */
export const LEVELS = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Difficult" }
];

/**
 * `model` names an entry in ModelLibrary. Every character now has its own
 * rigged model with idle / walk / run / talk clips, so all four are distinct in
 * the world as well as on their portrait. If a portrait and its 3D model do not
 * look like the same person, swap the `model` values here - nothing else
 * depends on the pairing.
 */
export const CHARACTERS = [
  // Pairings verified by reading each model's texture atlas:
  //   boy_1  = yellow jacket + glasses      -> Rohan
  //   boy_2  = denim jacket + blue eyes     -> Arjun
  //   girl_1 = pink hoodie + headband       -> Priya
  //   girl_2 = purple pinafore + pigtails   -> Meera
  { id: "arjun", name: "Arjun", art: "character/main_character/main_carecter_boy.png", model: "boy2",
    blurb: "Confident and friendly", colors: { top: "#4a6fa5", bottom: "#2f4f8f", hair: "#1b1b1f", skin: 1 } },
  { id: "priya", name: "Priya", art: "character/main_character/main_crecter_girl.png", model: "girl1",
    blurb: "Curious and quick", colors: { top: "#ff6fa5", bottom: "#3b6ea5", hair: "#2b2118", skin: 1 } },
  { id: "rohan", name: "Rohan", art: "character/main_character/carecter_1_boy.png", model: "boy1",
    blurb: "Clever and careful", colors: { top: "#f2b33d", bottom: "#3b5f9e", hair: "#241a12", skin: 1 } },
  { id: "meera", name: "Meera", art: "character/main_character/carecter_girl.png", model: "girl2",
    blurb: "Cheerful and bold", colors: { top: "#c86fd6", bottom: "#a4508f", hair: "#1b1b1f", skin: 1 } }
];

/**
 * Transparent icon set (spoken_game/icons/). The opaque originals are kept in
 * spoken_game/icons/with_background/ and are no longer used.
 *
 * Note: microphone.png is actually a SPEAKER graphic despite its name - the
 * real microphone is mic.png.
 */
export const ICONS = {
  coin: "icons/coin.png",
  gem: "icons/green_diamond.png",
  gem2: "icons/green_diamond_2.png",
  heart: "icons/love.png",
  star: "icons/star.png",
  cup: "icons/cup.png",
  map: "icons/map.png",
  pin: "icons/location.png",
  book: "icons/book.png",
  chat: "icons/chat.png",
  mic: "icons/mic.png",
  speaker: "icons/microphone.png",
  lock: "icons/lock.png",
  key: "icons/key.png",
  badge: "icons/badge.png",
  goldBadge: "icons/gold_badge.png",
  calendar: "icons/calendar.png",
  gift: "icons/box.png",
  charge: "icons/charge.png"
};

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const icon = (key, cls = "") =>
  '<img class="ico-img ' + cls + '" src="' + ART + ICONS[key] + '" alt="" />';

export class Menu {
  constructor(root) {
    this.root = root;
    this.page = null;
  }

  get isOpen() { return !!this.page; }

  render(page, html) {
    this.unbindEscape();
    this.page = page;
    this.root.innerHTML = html;
    this.root.classList.remove("hidden");
    requestAnimationFrame(() => this.root.classList.add("is-in"));
    return this.root;
  }

  /** Escape backs out of a sub-sheet. Capture phase so the world's Escape
   *  binding (leave conversation) never fires at the same time. */
  bindEscape(fn) {
    this.unbindEscape();
    this.escHandler = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    window.addEventListener("keydown", this.escHandler, true);
  }

  unbindEscape() {
    if (!this.escHandler) return;
    window.removeEventListener("keydown", this.escHandler, true);
    this.escHandler = null;
  }

  close() {
    this.unbindEscape();
    this.page = null;
    this.root.classList.remove("is-in");
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
  }

  characterById(id) {
    return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
  }

  /* ------------------------------------------------------------ main menu */

  main(progress, lesson, manifest, handlers) {
    const hero = this.characterById(progress.data.characterId);
    const pct = Math.round((progress.xpIntoLevel / progress.xpForLevel) * 100);
    const earnedBadges = evaluateBadges(progress.badgeStats(manifest)).filter((b) => b.earned);
    const badgeCount = earnedBadges.length;
    // BADGES runs easiest to hardest, so the last earned entry is the best one held.
    const topBadge = earnedBadges[earnedBadges.length - 1] || null;

    const items = [
      { id: "play", label: "Play", sub: lesson ? "Day " + lesson.day + " · " + lesson.topic : "Start today's lesson", big: true },
      { id: "free", label: "Free Play", sub: "Any place, any time" },
      { id: "store", label: "Store", sub: "Spend your coins" },
      { id: "character", label: "Character", sub: hero.name },
      { id: "location", label: "Location", sub: "Choose where to go" },
      { id: "progress", label: "Progress", sub: "Scores and streak" },
      { id: "badges", label: "Badges", sub: badgeCount + " of " + BADGES.length + " earned" },
      { id: "settings", label: "Settings", sub: "Voice and accent" }
    ];

    const list = items.map((it) =>
      '<button class="menu-item' + (it.big ? " is-big" : "") + '" data-act="' + it.id + '">' +
        '<span class="menu-label">' + esc(it.label) + "</span>" +
        '<span class="menu-sub">' + esc(it.sub) + "</span>" +
      "</button>").join("");

    this.render("main",
      '<div class="menu-shell">' +
        '<div class="menu-left">' +
          '<div class="game-logo">' +
            '<span class="logo-top">SPOKEN ENGLISH</span>' +
            '<span class="logo-bottom">ADVENTURE</span>' +
          "</div>" +
          '<nav class="menu-list">' + list + "</nav>" +
        "</div>" +

        '<div class="menu-topright">' +
          '<div class="hero-card">' +
            '<div class="hero-portrait"><img src="' + ART + hero.art + '" alt="' + esc(hero.name) + '" /></div>' +
            '<div class="hero-meta">' +
              '<div class="hero-name">' +
                (topBadge ? '<img class="hero-badge" src="' + ART + ICONS[topBadge.icon] + '" title="' + esc(topBadge.name) + '" alt="" />' : "") +
                esc(progress.data.playerName) +
              "</div>" +
              '<div class="hero-level">Level ' + progress.level + "</div>" +
              '<div class="hero-xp"><span style="width:' + pct + '%"></span></div>' +
              '<div class="hero-xp-text">' + progress.xpIntoLevel + " / " + progress.xpForLevel + " XP</div>" +
            "</div>" +
          "</div>" +
          '<div class="currency-row">' +
            '<div class="cur-pill">' + icon("coin") + "<b>" + progress.coins + "</b></div>" +
            '<div class="cur-pill">' + icon("star") + "<b>" + progress.data.history.length + "</b></div>" +
            '<div class="cur-pill">' + icon("calendar") + "<b>" + progress.streak + "</b></div>" +
          "</div>" +
        "</div>" +
      "</div>");

    this.root.querySelectorAll(".menu-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fn = handlers[btn.dataset.act];
        if (fn) fn();
      });
    });
  }

  /* ---------------------------------------------------- character select */

  characterSelect(progress, { onConfirm, onBack }) {
    let chosen = progress.data.characterId || CHARACTERS[0].id;

    const cards = CHARACTERS.map((c) =>
      '<button class="pick-card' + (c.id === chosen ? " is-on" : "") + '" data-id="' + c.id + '">' +
        '<div class="pick-art"><img src="' + ART + c.art + '" alt="' + esc(c.name) + '" /></div>' +
        '<div class="pick-name">' + esc(c.name) + "</div>" +
        '<div class="pick-blurb">' + esc(c.blurb) + "</div>" +
      "</button>").join("");

    this.render("character",
      '<div class="sheet">' +
        '<button class="sheet-back" data-act="back">‹ Back</button>' +
        '<h2 class="sheet-title">Choose your character</h2>' +
        '<p class="sheet-sub">This is who you will play as in every conversation.</p>' +
        '<div class="pick-grid">' + cards + "</div>" +
        '<label class="sheet-field"><span>Your name</span>' +
          '<input id="pick-name" maxlength="20" value="' + esc(progress.data.playerName) + '" /></label>' +
        '<div class="sheet-actions">' +
          '<button class="gbtn gbtn-primary" data-act="confirm">Confirm</button>' +
        "</div>" +
      "</div>");

    const grid = this.root.querySelector(".pick-grid");
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".pick-card");
      if (!card) return;
      chosen = card.dataset.id;
      grid.querySelectorAll(".pick-card").forEach((c) => c.classList.toggle("is-on", c.dataset.id === chosen));
    });

    this.root.querySelector('[data-act="back"]').addEventListener("click", onBack);
    this.bindEscape(onBack);
    this.root.querySelector('[data-act="confirm"]').addEventListener("click", () => {
      const name = this.root.querySelector("#pick-name").value.trim() || "Student";
      onConfirm(chosen, name);
    });
  }

  /* ----------------------------------------------------- location select */

  /**
   * @param {boolean} free  Free Play: every place is open and every card shows
   *   the conversation waiting there. Otherwise places unlock day by day.
   */
  /**
   * @param {object} opts
   *   free   - Free Play: choose a level, then a place, and play that one
   *   level  - which level Free Play is showing
   *   onLevel- called when the player switches level
   */
  locationSelect(progress, manifest, currentId, todayLocation,
                 { onTravel, onBack, onLevel, free = false, level = "easy" }) {
    /*
     * One card per PLACE, but a place can hold more than one day - home has
     * both day 6 and day 7. Keeping only the first made day 7 invisible: the
     * cards read 1,2,3,4,5,6,8,9,10 and looked like a lesson had gone missing.
     * Every day at a place is collected, so the card can say so.
     */
    const daysAt = {}, topicsAt = {};
    manifest.lessons.forEach((l) => {
      if (!daysAt[l.location]) { daysAt[l.location] = []; topicsAt[l.location] = []; }
      daysAt[l.location].push(l.day);
      topicsAt[l.location].push(l.topic);
    });
    Object.values(daysAt).forEach((days) => days.sort((a, b) => a - b));

    // A place opens once the student reaches the FIRST lesson set there.
    const firstDay = {};
    Object.keys(daysAt).forEach((id) => { firstDay[id] = daysAt[id][0]; });
    const nextDay = progress.completedLessonIds().length + 1;

    /*
     * Free Play lists LESSONS, not places.
     *
     * Keying the grid on the location hid any second conversation set in the
     * same place - home has two at every level, and only the later one showed.
     * One card per lesson means every conversation in the game can be reached,
     * and each card carries a single short line: its own topic.
     */
    if (free) {
      const picks = manifest.lessons
        .filter((l) => l.difficulty === level)
        .sort((a, b) => a.day - b.day);

      const cards = picks.map((entry) => {
        const meta = LOCATION_META[entry.location];
        if (!meta) return "";
        const played = progress.lessonRecord("day_" + String(entry.day).padStart(3, "0"));
        return '<button class="loc-card' + (entry.location === currentId ? " is-here" : "") +
            '" data-day="' + entry.day + '" data-loc="' + entry.location + '">' +
          '<div class="loc-art"><img src="' + ART + meta.art + '" alt="' + esc(meta.label) + '" />' +
            (played ? '<div class="loc-badge loc-badge-done">' + played.bestScore + "%</div>" : "") +
            (entry.location === currentId ? '<div class="loc-here">You are here</div>' : "") +
          "</div>" +
          '<div class="loc-name">' + esc(meta.label) + "</div>" +
          '<div class="loc-blurb">' + esc(entry.topic) + "</div>" +
        "</button>";
      }).join("");

      this.render("location",
        '<div class="sheet sheet-wide">' +
          '<button class="sheet-back" data-act="back">‹ Back</button>' +
          '<h2 class="sheet-title">Free Play</h2>' +
          '<p class="sheet-sub">Choose how hard you want it, then pick a conversation.</p>' +
          '<div class="level-row">' + LEVELS.map((l) =>
            '<button class="level-btn' + (l.id === level ? " is-on" : "") +
              '" data-level="' + l.id + '">' + l.label + "</button>").join("") + "</div>" +
          '<div class="loc-grid">' + (cards || '<p class="sheet-sub">Nothing at this level yet.</p>') + "</div>" +
        "</div>");

      this.root.querySelector('[data-act="back"]').addEventListener("click", onBack);
      this.bindEscape(onBack);
      this.root.querySelectorAll(".level-btn").forEach((btn) => {
        btn.addEventListener("click", () => onLevel && onLevel(btn.dataset.level));
      });
      this.root.querySelectorAll(".loc-card").forEach((tile) => {
        tile.addEventListener("click", () => onTravel(tile.dataset.loc, Number(tile.dataset.day)));
      });
      return;
    }

    const tiles = Object.keys(LOCATION_META).map((id) => {
      const meta = LOCATION_META[id];
      const day = firstDay[id];
      const days = daysAt[id] || [];
      const locked = !free && day != null && day > nextDay;
      const isToday = !free && id === todayLocation;
      const done = day != null &&
        progress.lessonRecord("day_" + String(day).padStart(3, "0"));

      const badge = isToday ? '<div class="loc-badge">TODAY</div>' : "";

      return '<button class="loc-card' + (locked ? " is-locked" : "") +
          (id === currentId ? " is-here" : "") + (isToday ? " is-today" : "") +
          '" data-loc="' + id + '"' + (locked ? " disabled" : "") + ">" +
        '<div class="loc-art"><img src="' + ART + meta.art + '" alt="' + esc(meta.label) + '" />' +
          (locked ? '<div class="loc-lock">' + icon("lock") + "<span>Day " + day + "</span></div>" : "") +
          badge +
          (id === currentId ? '<div class="loc-here">You are here</div>' : "") +
        "</div>" +
        '<div class="loc-name">' + esc(meta.label) + "</div>" +
        '<div class="loc-blurb">' + esc(meta.blurb) + "</div>" +
        // How much is set here. Listing all six days a place can now hold was
        // longer than the card, so it is a count once there is more than one -
        // Free Play lists them individually, which is where you choose anyway.
        (days.length ? '<div class="loc-days">' +
          (days.length === 1 ? "Day " + days[0] : days.length + " lessons") + "</div>" : "") +
      "</button>";
    }).join("");

    this.render("location",
      '<div class="sheet sheet-wide">' +
        '<button class="sheet-back" data-act="back">‹ Back</button>' +
        '<h2 class="sheet-title">Where do you want to go?</h2>' +
        '<p class="sheet-sub">Travel to a place, find someone, and start talking.</p>' +
        '<div class="loc-grid">' + tiles + "</div>" +
      "</div>");

    this.root.querySelector('[data-act="back"]').addEventListener("click", onBack);
    this.bindEscape(onBack);
    this.root.querySelectorAll(".loc-card").forEach((tile) => {
      tile.addEventListener("click", () => onTravel(tile.dataset.loc));
    });
  }

  /* --------------------------------------------------------------- store */

  /**
   * @param {object} config the loaded data/config/scoring.json - `store` holds
   *   the item list, so pricing changes need no code changes.
   */
  store(progress, config, { onBack, onBuy }) {
    const owned = {
      streakFreeze: progress.streakFreezes,
      hintPack: progress.hintCredits
    };

    const cards = Object.entries(config.store || {}).map(([id, item]) => {
      const afford = progress.coins >= item.price;
      const have = owned[id];
      return '<div class="store-card">' +
        '<div class="store-icon">' + item.icon + "</div>" +
        '<div class="store-name">' + esc(item.name) + "</div>" +
        '<div class="store-desc">' + esc(item.desc) + "</div>" +
        (have != null ? '<div class="store-owned">You have ' + have + "</div>" : "") +
        '<button class="store-buy' + (afford ? "" : " is-off") + '" data-id="' + id + '"' + (afford ? "" : " disabled") + ">" +
          icon("coin") + "<span>" + item.price + "</span>" +
        "</button>" +
      "</div>";
    }).join("");

    this.render("store",
      '<div class="sheet sheet-wide">' +
        '<button class="sheet-back" data-act="back">‹ Back</button>' +
        '<h2 class="sheet-title">Store</h2>' +
        '<p class="sheet-sub">Spend your coins on a little help.</p>' +
        '<div class="currency-row store-balance">' +
          '<div class="cur-pill">' + icon("coin") + "<b>" + progress.coins + "</b></div>" +
        "</div>" +
        '<div class="store-grid">' + cards + "</div>" +
      "</div>");

    this.root.querySelector('[data-act="back"]').addEventListener("click", onBack);
    this.bindEscape(onBack);
    this.root.querySelectorAll(".store-buy").forEach((btn) => {
      btn.addEventListener("click", () => { if (!btn.disabled) onBuy(btn.dataset.id); });
    });
  }
}
