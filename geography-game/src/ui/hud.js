// The heads-up display in the top bar: round, score and streak.
//
// Rounds are drawn as a map scale bar, one segment per round, which fills in
// green or red as the game goes on.

import { $, h, animateNumber, replay } from "./dom.js";
import { multiplierFor, isFinished } from "../game.js";
import { formatNumber } from "../util.js";

export function createHud() {
  const root = $("#hud");
  const scale = $("#hud-scale");
  const round = $("#hud-round");
  const score = $("#hud-score");
  const streak = $("#hud-streak");
  const streakLabel = $("#hud-streak-label");
  const streakBox = $("#hud-streak-box");

  return {
    show(visible) {
      root.hidden = !visible;
    },

    // Redraws everything from the session. Pass `celebrate` after a correct
    // answer to give the streak counter a small bump.
    update(session, { celebrate = false } = {}) {
      const total = session.codes.length;
      scale.replaceChildren(
        ...session.codes.map((code, index) => {
          const result = session.results[index];
          const state = result ? (result.correct ? "is-correct" : "is-wrong") : index === session.index ? "is-current" : "";
          return h("li", { class: `scalebar__segment ${state}` });
        })
      );
      const shown = Math.min(session.index + 1, total);
      round.textContent = `Round ${shown} of ${total}`;
      root.setAttribute(
        "aria-label",
        `Round ${shown} of ${total}. ${formatNumber(session.score)} points. ${session.streak} correct in a row.`
      );

      animateNumber(score, session.score, formatNumber);

      streak.textContent = session.streak;
      const next = multiplierFor(session.streak + 1);
      streakLabel.textContent = isFinished(session) || next === 1 ? "in a row" : `in a row, next ×${next}`;
      streakBox.classList.toggle("is-hot", session.streak >= 2);
      if (celebrate) replay(streakBox, "is-bumped");
    }
  };
}
