import { Game } from "./core/Game.js";
import { Screens } from "./ui/Screens.js";

const canvas = document.querySelector("#scene");
const screenRoot = document.querySelector("#screen-root");

function hideLoader() {
  const loader = document.querySelector("#boot");
  if (loader) loader.classList.add("hidden");
}

/**
 * Build stamp. Browsers cache ES modules very aggressively, and a stale copy
 * looks exactly like "the fix did not work". Open the console (F12) and check
 * this line matches what you expect before reporting a visual problem.
 */
export const BUILD = "2026-08-31v · no sky gap under the room";
console.log("%c Spoken English Adventure ", "background:#3b82f6;color:#fff;font-weight:bold",
  "build:", BUILD);

const game = new Game(canvas, screenRoot);

game.boot()
  .then(hideLoader)
  .catch((err) => {
    hideLoader();
    console.error(err);
    const detail = /Failed to fetch|NetworkError|Could not load/i.test(err.message)
      ? "The lesson files could not be read.\n\nOpen the game through a web server " +
        "(for example http://localhost/freelancer/spoken_game/) rather than by " +
        "double-clicking index.html - browsers block fetch() on file:// URLs.\n\n" + err.message
      : err.stack || err.message;
    new Screens(screenRoot).error("The game could not start.", detail);
  });

// Handy while the client is reviewing: window.game.progress.reset() etc.
window.game = game;
