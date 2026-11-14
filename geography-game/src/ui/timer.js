// The speed-bonus countdown shown beside the question: a bar that drains
// while the bonus on offer ticks down. It never ends the round; when it runs
// out the answer simply earns no bonus.

import { speedBonusFor } from "../game.js";

export function createTimer(root) {
  const bar = root.querySelector(".timer__bar");
  const value = root.querySelector(".timer__value");
  let startedAt = 0;
  let windowMs = 0;
  let frame = 0;
  let running = false;

  function paint() {
    const elapsed = performance.now() - startedAt;
    const left = Math.max(0, 1 - elapsed / windowMs);
    bar.style.transform = `scaleX(${left})`;
    const bonus = speedBonusFor(elapsed, windowMs);
    value.textContent = bonus > 0 ? `+${bonus}` : "no bonus";
    root.classList.toggle("is-spent", bonus === 0);
    frame = running && left > 0 ? requestAnimationFrame(paint) : 0;
  }

  return {
    // enabled: whether the speed bonus is switched on for this game.
    start(enabled, speedWindowMs) {
      cancelAnimationFrame(frame);
      root.hidden = !enabled;
      startedAt = performance.now();
      windowMs = speedWindowMs;
      running = enabled;
      if (enabled) paint();
    },
    // Freezes the display and returns the time taken, in milliseconds.
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
      return performance.now() - startedAt;
    },
    hide() {
      this.stop();
      root.hidden = true;
    }
  };
}
