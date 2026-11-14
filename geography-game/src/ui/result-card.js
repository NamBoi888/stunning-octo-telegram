// The post-round summary card, shared by both modes: how the answer went,
// the points earned, a fact about the country with a "Reroll Fact" button,
// and the button that moves the game on.

import { h } from "./dom.js";
import { showFlag } from "../assets.js";
import { formatNumber } from "../util.js";

const CATEGORY_LABEL = { border: "Border fact", flag: "Flag fact" };

// Buttons ignore clicks for a moment after the card appears, so a key held
// down to answer cannot also skip the card.
const ARM_DELAY_MS = 350;

// root:     element the card is drawn into
// trivia:   the trivia system (for rerolling)
// onNext(): called when the player moves on
export function createResultCard(root, { trivia, onNext }) {
  let deck = null;
  let shownAt = 0;
  let factText, factKind, factCount, nextButton, rerollButton;

  function paintFact(animate) {
    const fact = deck.current;
    factKind.textContent = fact ? CATEGORY_LABEL[fact.category] : "";
    factKind.dataset.category = fact?.category ?? "";
    factCount.textContent = deck.total > 1 ? `${deck.index + 1} of ${deck.total}` : "";
    factText.textContent = fact?.text ?? "";
    if (animate) {
      factText.classList.remove("is-fresh");
      void factText.offsetWidth;
      factText.classList.add("is-fresh");
    }
  }

  function reroll() {
    if (!deck || deck.total < 2) return;
    trivia.reroll(deck);
    paintFact(true);
  }

  function next() {
    if (root.hidden || performance.now() - shownAt < ARM_DELAY_MS) return;
    onNext();
  }

  return {
    get visible() {
      return !root.hidden;
    },

    // view: {
    //   tone:     "correct" | "wrong"
    //   status:   short verdict, e.g. "Found it"
    //   country:  the country that was asked for
    //   withFlag: show the country's flag next to its name (Map Mode)
    //   detail:   one or two sentences about the answer
    //   result:   the scored result from game.js
    //   deck:     fact deck from trivia.open()
    //   nextLabel: text for the button that moves on
    // }
    show(view) {
      deck = view.deck;
      shownAt = performance.now();
      const { result, country } = view;

      const points = result.correct
        ? h("p", { class: "result__points" },
            h("strong", {}, `+${formatNumber(result.points)}`),
            " ",
            h("span", {}, describePoints(result)))
        : h("p", { class: "result__points result__points--none" },
            h("span", {}, result.streakLost ? "No points, and the streak is over." : "No points this round."));

      const flag = view.withFlag ? h("img", { class: "result__flag", alt: `Flag of ${country.name}` }) : null;
      if (flag) showFlag(flag, country);

      factKind = h("span", { class: "fact__kind" });
      factCount = h("span", { class: "fact__count" });
      factText = h("p", { class: "fact__text" });
      rerollButton = h("button", { class: "button button--quiet fact__reroll", type: "button", onClick: reroll }, "Reroll Fact ↻");
      rerollButton.hidden = deck.total < 2;
      nextButton = h("button", { class: "button button--primary result__next", type: "button", onClick: next }, view.nextLabel);

      root.className = root.className.replace(/\s*is-(correct|wrong)/g, "") + ` is-${view.tone}`;
      root.replaceChildren(
        h("div", { class: "result__head" },
          h("p", { class: "result__status" }, view.status),
          h("div", { class: "result__title" }, flag, h("h2", { class: "result__name" }, country.name)),
          h("p", { class: "result__detail" }, view.detail),
          points),
        h("section", { class: "fact", "aria-label": "Did you know" },
          h("div", { class: "fact__head" }, factKind, factCount),
          factText,
          rerollButton),
        nextButton
      );
      paintFact(false);
      root.hidden = false;
      // Focus the way forward so Enter or Space continues the game.
      nextButton.focus({ preventScroll: true });
    },

    hide() {
      root.hidden = true;
      deck = null;
    },

    reroll,
    next
  };
}

function describePoints(result) {
  const parts = [`${result.base} base`];
  if (result.multiplier > 1) parts.push(`×${result.multiplier} for ${result.streak} in a row`);
  if (result.speed > 0) parts.push(`+${result.speed} speed`);
  return parts.join(", ");
}
