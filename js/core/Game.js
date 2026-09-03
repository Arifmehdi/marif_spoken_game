/**
 * Game - wires the world, the conversation engine and the interface together.
 *
 * Deliberately the only place that knows about all three. Each subsystem below
 * it stays independently replaceable: swap the evaluator, swap the art, or move
 * progress to a server, without touching the others.
 */
import * as THREE from "three";
import { SceneManager } from "./SceneManager.js";
import { InputManager } from "./InputManager.js";
import { Player } from "../world/Player.js";
import { NPC } from "../world/NPC.js";
import { buildLocation, disposeLocation, LOCATION_META } from "../world/LocationFactory.js";
import { ModelLibrary } from "../world/ModelLibrary.js";
import { pickNpcModel, NPC_MODEL_FALLBACK } from "../world/Casting.js";
import { LessonLoader } from "../conversation/LessonLoader.js";
import { Evaluator } from "../conversation/Evaluator.js";
import { ConversationEngine } from "../conversation/ConversationEngine.js";
import { SpeechInput } from "../conversation/SpeechInput.js";
import { SpeechOutput } from "../conversation/SpeechOutput.js";
import { ProgressStore } from "../progress/ProgressStore.js";
import { UI } from "../ui/UI.js";
import { Screens } from "../ui/Screens.js";
import { Menu, ART } from "../ui/Menu.js";
import { MobileSupport } from "../ui/MobileSupport.js";
import { SoundBoard } from "../ui/SoundBoard.js";

export class Game {
  constructor(canvas, screenRoot) {
    this.canvas = canvas;
    this.scene = new SceneManager(canvas);
    this.ui = new UI();
    this.screens = new Screens(screenRoot);
    this.menu = new Menu(document.querySelector("#menu-root"));
    this.loader = new LessonLoader();
    this.models = new ModelLibrary(this.scene.renderer);
    this.sound = new SoundBoard();
    this.input = new InputManager({
      joystick: document.querySelector("#joystick"),
      knob: document.querySelector("#knob"),
      runButton: document.querySelector("#btn-run")
    });

    this.location = null;
    this.npc = null;
    this.lesson = null;        // today's daily lesson
    this.activeLesson = null;  // what the player is actually here to do
    this.lessonEntry = null;
    this.mode = "daily";       // "daily" | "free"
    this.inConversation = false;
    this.lastTime = performance.now();
    this._headWorld = new THREE.Vector3();
  }

  /* ----------------------------------------------------------------- boot */

  async boot() {
    const cfgRes = await fetch("data/config/scoring.json", { cache: "no-cache" });
    if (!cfgRes.ok) throw new Error("Could not load data/config/scoring.json");
    this.config = await cfgRes.json();

    this.progress = new ProgressStore(this.config);
    this.evaluator = new Evaluator(this.config);
    this.speechOut = new SpeechOutput({
      enabled: this.progress.getSetting("voice"),
      lang: this.progress.getSetting("lang")
    });
    this.speechIn = new SpeechInput({ lang: this.progress.getSetting("lang") });
    this.engine = new ConversationEngine({ evaluator: this.evaluator, speechOutput: this.speechOut });

    this.manifest = await this.loader.loadManifest();

    this.player = new Player();
    this.wireSpeech();
    this.wireEngine();
    this.wireUI();

    // Start both downloads now so they finish behind the title menu, rather
    // than mid-lesson with a placeholder standing in.
    this.models.prefetch(["npcWoman1", "npcWoman2", "npcMan1", "npcMan2", "plant1", "bookshelf"]);
    this.sound.setEnabled(this.progress.getSetting("sound") !== false);
    this.sound.preload();

    await this.loadTodaysLesson();
    this.enterLocation(this.lessonEntry.location, { silent: true });
    this.applyChosenCharacter();
    this.ui.renderHud(this.progress);
    this.setupMobile();
    this.loop();

    // First run goes straight to character select; afterwards, the title menu.
    if (!this.progress.data.characterId) this.openCharacterSelect({ firstRun: true });
    else this.openMenu();
  }

  /* --------------------------------------------------------------- mobile */

  /**
   * Portrait phones are gated behind a "rotate your device" screen. While it is
   * up the game is paused and muted, so nothing runs behind a screen the player
   * cannot see, and no lesson audio plays into an empty room.
   */
  setupMobile() {
    this.mobile = new MobileSupport({
      onBlock: () => {
        this.rotateBlocked = true;
        this.speechOut.cancel();
        this.speechIn.abort();
        this.input.setEnabled(false);
        this.player.freeze(true);
      },
      onResume: () => {
        this.rotateBlocked = false;
        // Hand control back only if nothing else is holding it.
        const held = this.shellMode || this.paused || this.mapOpen || this.inConversation;
        this.input.setEnabled(!held);
        this.player.freeze(held);
        this.scene.resize();
        this.lastTime = performance.now();
      }
    });
  }

  /* ----------------------------------------------------------- game shell */

  /** Menu is open: freeze the player, hide the HUD, orbit the camera. */
  setShellMode(on) {
    this.shellMode = on;
    if (on) this.mapOpen = false;   // the menu shell supersedes the travel map
    this.player.freeze(on);
    this.input.setEnabled(!on);
    this.ui.setWorldUiVisible(!on);
    if (on) {
      this.ui.showInteract(false);
      this.speechOut.cancel();
    } else {
      this.scene.snapTo(this.player.group.position);
    }
  }

  openMenu() {
    this.setShellMode(true);
    this.menu.main(this.progress, this.lesson, {
      play: () => {
        this.mode = "daily";
        this.activeLesson = this.lesson;
        this.menu.close();
        this.setShellMode(false);
        this.showLessonBrief();
      },
      free: () => this.openFreePlay(),
      character: () => this.openCharacterSelect({}),
      location: () => this.openLocationSelect(),
      progress: () => this.screens.progressScreen(this.progress, this.manifest),
      settings: () => this.openSettings()
    });
  }

  openCharacterSelect({ firstRun }) {
    this.setShellMode(true);
    this.menu.characterSelect(this.progress, {
      onBack: () => this.openMenu(),
      onConfirm: (id, name) => {
        this.progress.data.characterId = id;
        this.progress.setPlayerName(name);
        this.applyChosenCharacter();
        this.ui.renderHud(this.progress);
        if (firstRun) {
          this.menu.close();
          this.setShellMode(false);
          this.showLessonBrief();
        } else {
          this.openMenu();
        }
      }
    });
  }

  /**
   * Travel map opened from the HUD while playing. Unlike the menu's location
   * sheet this does NOT enter shell mode: closing it returns you straight to
   * the world you were standing in, not to the main menu.
   */
  openTravelMap() {
    // Check the DOM, not just the flag. If anything else closed the menu while
    // the map was up, a stale flag would wedge this button shut for good.
    if (this.mapOpen && this.menu.isOpen) return;
    this.mapOpen = true;
    this.player.freeze(true);      // stop walking blind behind a full-screen sheet
    this.input.setEnabled(false);

    const close = () => this.closeTravelMap();
    this.menu.locationSelect(this.progress, this.manifest, this.location.id,
      this.lesson && this.lesson.location, {
        onBack: close,
        onTravel: (id) => {
          if (id !== this.location.id) this.travel(id);
          close();
        }
      });
  }

  closeTravelMap() {
    if (!this.mapOpen) return;
    this.mapOpen = false;
    this.menu.close();
    this.player.freeze(false);
    this.input.setEnabled(true);
    this.lastTime = performance.now();   // do not bank the open time as one frame
  }

  openLocationSelect() {
    this.setShellMode(true);
    this.menu.locationSelect(this.progress, this.manifest, this.location.id,
      this.lesson && this.lesson.location, {
        onBack: () => this.openMenu(),
        onTravel: (id) => {
          if (id !== this.location.id) this.travel(id);
          this.menu.close();
          this.setShellMode(false);
        }
      });
  }

  openSettings({ returnToPause = false } = {}) {
    // Closing Settings from the pause menu must return to the pause menu,
    // not drop the player back into a running lesson.
    if (returnToPause) {
      this.screens.onClose = () => {
        // Not if Settings sent us somewhere else entirely (a progress reset
        // jumps to character select, which owns the screen from then on).
        if (this.shellMode) return;
        this.paused = false;
        this.pauseGame();
      };
    }
    this.screens.settings(this.progress, SpeechInput.isSupported(), {
      onChange: (key, value) => {
        this.progress.setSetting(key, value);
        if (key === "voice") this.speechOut.setEnabled(value);
        if (key === "sound") this.sound.setEnabled(value);
        if (key === "lang") { this.speechOut.setLanguage(value); this.speechIn.setLanguage(value); }
      },
      onReset: async () => {
        this.progress.reset();
        this.speechOut.setEnabled(this.progress.getSetting("voice"));
        this.speechOut.setLanguage(this.progress.getSetting("lang"));
        this.speechIn.setLanguage(this.progress.getSetting("lang"));

        // Put the world back to day one, not wherever the player happened to be.
        await this.loadTodaysLesson();
        this.enterLocation(this.lessonEntry.location, { silent: true });
        this.applyChosenCharacter();
        this.ui.renderHud(this.progress);
        this.ui.setQuest(null);
        this.ui.toast("Progress cleared - starting again from Day 1", "info", 3600);
        this.openCharacterSelect({ firstRun: true });
      }
    });
  }

  /* ---------------------------------------------------------------- pause */

  togglePause() {
    if (this.shellMode) return;              // already in the menu shell
    this.paused ? this.resumeGame() : this.pauseGame();
  }

  pauseGame() {
    if (this.paused || this.shellMode || this.screens.isOpen || this.menu.isOpen) return;
    this.paused = true;

    this.player.freeze(true);
    this.input.setEnabled(false);
    this.speechOut.pause();                  // holds the line, does not cancel it
    this.speechIn.abort();
    this.ui.lockAnswering(true);
    this.ui.setMicState("idle");

    this.screens.pause({
      topic: this.activeLesson && this.activeLesson.topic,
      day: this.activeLesson && this.activeLesson.day,
      step: this.engine.studentTurnIndex + 1,
      total: this.engine.studentTurnCount,
      inConversation: this.inConversation
    }, {
      onResume: () => this.resumeGame(),
      onRestart: () => this.restartConversation(),
      onSettings: () => this.openSettings({ returnToPause: true }),
      onQuit: () => this.confirmQuit()
    });
  }

  resumeGame() {
    if (!this.paused) return;
    this.paused = false;
    this.screens.hide();

    this.player.freeze(false);
    this.input.setEnabled(true);
    this.speechOut.resume();
    // Only hand the controls back if the engine is actually waiting for an answer.
    this.ui.lockAnswering(!(this.inConversation && this.engine.awaiting));
    this.lastTime = performance.now();       // do not bank the paused time as one frame
  }

  restartConversation() {
    this.paused = false;
    this.screens.hide();
    this.engine.abandon();
    this.endConversationUi();
    this.startConversation();
  }

  confirmQuit() {
    if (!this.inConversation) return this.quitToMenu();
    this.screens.confirm(
      "You are in the middle of a conversation. Your score for it will not be saved.",
      {
        title: "Quit this lesson?",
        yes: "Quit to menu",
        no: "Keep playing",
        onYes: () => this.quitToMenu(),
        onNo: () => { this.paused = false; this.pauseGame(); }
      });
  }

  quitToMenu() {
    this.paused = false;
    this.screens.hide();
    if (this.inConversation) {
      this.engine.abandon();
      this.endConversationUi();
      if (this.npc) this.npc.setMarker("quest");
    }
    this.ui.setQuest(null);
    this.openMenu();
  }

  /**
   * Dress the 3D student as the chosen character, and update the HUD portrait.
   * The .glb model loads in the background; the procedural body is shown until
   * it arrives, and stays if the download fails.
   */
  applyChosenCharacter() {
    const hero = this.menu.characterById(this.progress.data.characterId);
    this.player.setAppearance(hero.colors);
    this.ui.setAvatar(ART + hero.art);

    if (!hero.model) return;
    this.player.character.expectModel();
    this.models.get(hero.model).then((model) => {
      // The player may have changed character again while this downloaded.
      const current = this.menu.characterById(this.progress.data.characterId);
      if (current.model !== hero.model) return;
      if (model) this.player.character.useModel(model);
      else this.player.character.cancelExpectedModel();
    });
  }

  async loadTodaysLesson() {
    this.lessonEntry = await this.loader.nextLessonEntry(this.progress);
    this.lesson = await this.loader.loadLesson(this.lessonEntry);
    this.mode = "daily";
    this.activeLesson = this.lesson;
  }

  showLessonBrief(lesson = this.lesson) {
    this.screens.lessonBrief(lesson, this.progress.lessonRecord(lesson.lesson_id), {
      onGo: () => {
        if (this.location.id !== lesson.location) this.enterLocation(lesson.location);
        const meta = LOCATION_META[lesson.location];
        const who = (lesson.characters && lesson.characters[0]) || {};
        const where = meta ? meta.label : lesson.location;
        this.ui.setQuest((this.mode === "free" ? "Practice: talk to " : "Find ") +
          (who.name || "your teacher") + " at the " + where + ".", "0/1");
        this.ui.toast("Walk up to " + (who.name || "them") + " and press Talk", "info", 3800);
      }
    });
  }

  /* ------------------------------------------------------------ free play */

  openFreePlay() {
    this.setShellMode(true);
    this.menu.locationSelect(this.progress, this.manifest, this.location.id, null, {
      free: true,
      onBack: () => this.openMenu(),
      onTravel: (id) => this.startFreePlay(id)
    });
  }

  /** Pick any place and practise the conversation set there, in any order. */
  async startFreePlay(id) {
    const entry = this.manifest.lessons
      .filter((l) => l.location === id)
      .sort((a, b) => a.day - b.day)[0];

    if (!entry) {
      this.ui.toast("There is no conversation here yet", "warn");
      return;
    }

    this.mode = "free";
    this.activeLesson = await this.loader.loadLesson(entry);
    this.menu.close();
    this.setShellMode(false);
    this.enterLocation(id, { silent: true });
    this.showLessonBrief(this.activeLesson);
  }

  /* ------------------------------------------------------------- location */

  enterLocation(id, { silent = false } = {}) {
    if (this.location) {
      this.scene.scene.remove(this.location.group);
      disposeLocation(this.location);
    }
    if (this.npc) {
      this.scene.scene.remove(this.npc.group);
      this.npc.dispose();
      this.npc = null;
    }

    this.location = buildLocation(id, this.models);
    this.scene.scene.add(this.location.group);
    this.scene.setAtmosphere(this.location.sky, this.location.fog);

    this.player.placeAt(this.location.spawn);
    if (!this.player.group.parent) this.scene.scene.add(this.player.group);
    this.scene.snapTo(this.player.group.position);

    this.spawnNpc();
    if (!silent) this.ui.toast("Welcome to the " + this.location.label, "info");
  }

  spawnNpc() {
    const spot = this.location.npcSpots[0];
    const isLessonHere = this.activeLesson && this.activeLesson.location === this.location.id;

    const def = isLessonHere && this.activeLesson.characters && this.activeLesson.characters[0]
      ? this.activeLesson.characters[0]
      // The wandering guide. "friend" would default to the female pool, but
      // Ravi is a man - state it so the casting matches the name.
      : { id: "guide", name: "Ravi", role: "friend", gender: "male" };

    this.npc = new NPC({ id: def.id, name: def.name, role: def.role, spot });
    this.npc.setMarker(isLessonHere ? "quest" : "talk");
    this.scene.scene.add(this.npc.group);

    // Every NPC gets a real 3D model. The placeholder body is hidden up front
    // so it never flashes on screen, and only comes back if the load fails.
    const npcModel = pickNpcModel(def, this.location.id) || NPC_MODEL_FALLBACK;
    if (npcModel) {
      const spawned = this.npc;
      spawned.character.expectModel();
      this.models.get(npcModel).then((model) => {
        if (this.npc !== spawned) return;
        if (model) this.npc.character.useModel(model);
        else this.npc.character.cancelExpectedModel();
      });
    }
  }

  travel(id) {
    this.enterLocation(id);
    this.ui.renderHud(this.progress);
  }

  /* ----------------------------------------------------------------- wire */

  wireUI() {
    this.ui.on("interact", () => this.tryInteract());
    this.ui.on("leave", () => this.leaveConversation());
    this.ui.on("mic", () => this.startListening());
    this.ui.on("answer", ({ text, mode, confidence }) => this.answer(text, mode, confidence));

    this.input.onAction((name) => {
      // A popup or the menu owns the keyboard while it is open.
      if (this.screens.isOpen || this.menu.isOpen) return;
      if (name === "interact") this.tryInteract();
      if (name === "mic" && this.inConversation) this.startListening();
      // Escape pauses. Resuming is handled by the pause screen's own binding.
      if (name === "cancel") this.togglePause();
    });

    const guard = (fn) => () => {
      if (this.inConversation) return this.ui.toast("Finish your conversation first", "warn");
      fn();
    };

    // Menu is NOT guarded: pausing mid-conversation is the whole point.
    document.querySelector("#btn-menu").addEventListener("click", () => this.togglePause());
    document.querySelector("#btn-map").addEventListener("click", guard(() => this.openTravelMap()));
    document.querySelector("#btn-lesson").addEventListener("click", guard(() => this.showLessonBrief()));
    document.querySelector("#btn-progress").addEventListener("click", () =>
      this.screens.progressScreen(this.progress, this.manifest));
    document.querySelector("#btn-settings").addEventListener("click", () => this.openSettings());
    document.querySelector("#btn-fullscreen").addEventListener("click", async () => {
      const on = await MobileSupport.toggleFullscreen();
      this.ui.toast(on ? "Fullscreen on" : "Fullscreen off", "info", 1500);
    });
  }

  wireSpeech() {
    this.speechIn.on("start", () => this.ui.setMicState("listening"));
    this.speechIn.on("partial", (text) => this.ui.showPartial(text));
    this.speechIn.on("error", (message) => {
      if (!message) return;
      this.ui.setMicState("idle");
      this.ui.toast(message, "warn", 4000);
    });
    this.speechIn.on("result", (text, confidence) => {
      if (!this.inConversation) return;
      if (!text) { this.ui.setMicState("idle", "I did not catch that - try again"); return; }
      this.answer(text, "speak", confidence);
    });
  }

  wireEngine() {
    this.engine.on("npcLine", ({ text, name }) => {
      this.ui.hideBubble("student");
      this.ui.showBubble("npc", "npc", name, text);
      if (this.npc) this.npc.setState("talk");
      this.player.setState("listen");
    });

    this.engine.on("studentPrompt", (payload) => {
      if (this.npc) this.npc.setState("listen");
      this.player.setState("idle");
      this.ui.askStudent(payload);
      this.ui.setQuest(payload.prompt, payload.index + "/" + payload.total);
      if (!SpeechInput.isSupported()) {
        this.ui.setMicState("disabled", SpeechInput.unsupportedReason);
      }
    });

    this.engine.on("feedback", (result) => {
      this.ui.lockAnswering(false);
      this.ui.showBubble("student", "student", this.progress.data.playerName, result.transcript || "...");
      if (this.npc) this.npc.setState(result.correctness >= 75 ? "talk" : "think");
      this.player.setState(result.correctness >= 75 ? "wave" : "idle");

      this.ui.showFeedback(result, {
        onContinue: () => { this.player.setState("idle"); this.engine.accept(); },
        onRetry: () => { this.ui.hideBubble("student"); this.engine.retry(); }
      });
    });

    this.engine.on("finished", (summary) => this.finishLesson(summary));
  }

  /* --------------------------------------------------------- conversation */

  tryInteract() {
    if (this.inConversation || this.screens.isOpen) return;
    if (!this.npc || !this.npc.inRange) return;

    if (!this.activeLesson || this.activeLesson.location !== this.location.id) {
      const meta = LOCATION_META[this.activeLesson.location];
      this.ui.toast("Today's lesson is at the " + (meta ? meta.label : this.activeLesson.location) + ". Open the map to travel.", "info", 4200);
      return;
    }
    this.startConversation();
  }

  startConversation() {
    this.inConversation = true;
    this.npc.busy = true;
    this.npc.hideMarker();
    this.npc.faceTo(this.player.group.position);
    this.player.faceTowards(this.npc.group.position);
    this.player.freeze(true);
    this.input.setEnabled(false);
    this.scene.setConversationFraming(true);
    this.ui.setControlsVisible(false);
    this.ui.showInteract(false);
    this.ui.openConversation();
    this.engine.start(this.activeLesson);
  }

  answer(text, mode, confidence) {
    if (!this.inConversation) return;
    this.speechIn.abort();
    this.ui.lockAnswering(true);
    this.ui.setMicState("thinking");
    const result = this.engine.submit(text, { mode, confidence });
    if (!result) this.ui.lockAnswering(false);
  }

  startListening() {
    if (!this.inConversation) return;
    if (this.speechIn.listening) { this.speechIn.stop(); return; }
    this.speechOut.cancel();
    this.speechIn.start();
  }

  leaveConversation() {
    if (!this.inConversation) return;
    this.engine.abandon();
    this.endConversationUi();
    this.ui.toast("Conversation left. Nothing was saved.", "warn");
    this.ui.setQuest("Talk to " + this.npc.name + " to start today's lesson.", "0/1");
    if (this.npc) this.npc.setMarker("quest");
  }

  endConversationUi() {
    this.inConversation = false;
    if (this.npc) { this.npc.busy = false; this.npc.setState("idle"); }
    this.player.freeze(false);
    this.player.setState("idle");
    this.input.setEnabled(true);
    this.scene.setConversationFraming(false);
    this.ui.setControlsVisible(true);
    this.ui.closeConversation();
    this.speechIn.abort();
    this.speechOut.cancel();
  }

  async finishLesson(summary) {
    // Free Play awards reduced XP and never advances the daily progression.
    const practice = this.mode === "free";
    const award = practice
      ? this.progress.recordPractice(summary)
      : this.progress.recordLesson(summary);

    this.endConversationUi();
    this.ui.renderHud(this.progress);
    this.ui.setQuest(null);
    if (this.npc) this.npc.setMarker("done");

    this.screens.results(summary, award, this.progress, {
      onAgain: () => this.startConversationAfterReset(),
      onMap: async () => {
        if (practice) { this.openFreePlay(); return; }
        await this.loadTodaysLesson();
        this.openMenu();
      }
    });
  }

  startConversationAfterReset() {
    if (this.npc) this.npc.setMarker("quest");
    this.startConversation();
  }

  /* ----------------------------------------------------------------- loop */

  loop() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // Rotate gate is up: the player cannot see the game, so do not run it.
    if (this.rotateBlocked) {
      requestAnimationFrame(() => this.loop());
      return;
    }

    // Paused: hold the frame exactly as it was. No movement, no animation, no
    // proximity checks - so nothing can change behind the pause screen.
    if (this.paused) {
      this.scene.render();
      requestAnimationFrame(() => this.loop());
      return;
    }

    // Title menu: orbit the location as a living backdrop, nothing else runs.
    if (this.shellMode) {
      if (this.npc) this.npc.character.update(dt);
      this.player.character.update(dt);
      this.scene.orbit({ x: 0, z: 0 }, dt);
      this.scene.render();
      requestAnimationFrame(() => this.loop());
      return;
    }

    this.player.update(dt, this.input.vector, this.input.running, this.location, this.scene.yaw);

    if (this.npc) {
      const entered = this.npc.update(dt, this.player.group.position);
      if (!this.inConversation) {
        this.ui.showInteract(this.npc.inRange, "Talk");
        if (entered) {
          // Same instant the marker turns green and the Talk button appears.
          this.sound.play("talkReady", { cooldown: 1200 });
          if (this.activeLesson && this.activeLesson.location === this.location.id) {
            this.ui.toast("Press Talk to start the conversation", "info", 2200);
          }
        }
      }
    }

    this.scene.follow(this.player.group.position, dt);
    this.updateBubbles();
    this.scene.render();
    requestAnimationFrame(() => this.loop());
  }

  updateBubbles() {
    if (this.npc) {
      this._headWorld.copy(this.npc.headPosition).setY(this.npc.headPosition.y + 0.55);
      this.ui.positionBubble("npc", this.scene.project(this._headWorld));
    }
    const p = this.player.group.position;
    this._headWorld.set(p.x, 2.25, p.z);
    this.ui.positionBubble("student", this.scene.project(this._headWorld));
  }
}
