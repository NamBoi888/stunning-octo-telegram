// The end-of-game screen: total score, accuracy, and the countries that were
// missed, ready to review.

import { h, animateNumber } from "./dom.js";
import { showFlag } from "../assets.js";
import { summarize } from "../game.js";
import { formatNumber } from "../util.js";
import { capitalSentence, missedSentence } from "./phrases.js";

const MODE_NAME = { map: "map game", flag: "flag game" };

// root:    element to draw into
// session: the finished session
// best:    { previous, isNew } best score for this kind of game
// actions: { onReplay, onSwitch, onHome }
export function renderSummary(root, { session, countries, best, onReplay, onSwitch, onHome }) {
  const summary = summarize(session);
  const otherMode = session.mode === "map" ? "flag" : "map";
  const where = session.region === "World" ? "" : ` (${session.region})`;

  const score = h("span", { class: "summary__number" }, "0");
  const bestLine = best.isNew
    ? summary.score > 0 ? "That is a new best for this game." : ""
    : `Your best for this game is ${formatNumber(best.previous)}.`;

  const stats = [
    ["Accuracy", `${summary.accuracy}%`],
    ["Correct", `${summary.correct} of ${summary.total}`],
    ["Best streak", String(summary.bestStreak)]
  ];

  const missed = summary.missed.map(result => {
    const country = countries.get(result.code);
    const flag = h("img", { class: "missed__flag", alt: "", loading: "lazy" });
    showFlag(flag, country);
    return h("li", { class: "missed__item" },
      flag,
      h("div", { class: "missed__text" },
        h("strong", { class: "missed__name" }, country.name),
        h("span", {}, [missedSentence(result, session.mode), capitalSentence(country)].filter(Boolean).join(" "))));
  });

  const replayButton = h("button", { class: "button button--primary", type: "button", onClick: onReplay }, "Play again");

  root.replaceChildren(
    h("header", { class: "summary__head" },
      h("p", { class: "summary__kind" }, `Your ${MODE_NAME[session.mode]}${where} is over.`),
      h("h1", { class: "summary__score" }, score, h("span", { class: "summary__unit" }, "points")),
      bestLine ? h("p", { class: `summary__best${best.isNew ? " is-new" : ""}` }, bestLine) : null),

    h("ol", { class: "scalebar scalebar--large", "aria-label": "Round by round" },
      session.results.map((result, index) =>
        h("li", {
          class: `scalebar__segment ${result.correct ? "is-correct" : "is-wrong"}`,
          title: `Round ${index + 1}: ${countries.get(result.code).name}, ${result.correct ? "correct" : "missed"}`
        }))),

    h("dl", { class: "summary__stats" },
      stats.map(([label, value]) => h("div", { class: "summary__stat" }, h("dt", {}, label), h("dd", {}, value)))),

    h("section", { class: "missed" },
      h("h2", { class: "missed__title" }, missed.length ? "Countries to review" : "Nothing to review"),
      missed.length
        ? h("ul", { class: "missed__list" }, missed)
        : h("p", { class: "missed__none" }, "You got every country right. Try another region, or type the names in the flag game.")),

    h("div", { class: "summary__actions" },
      replayButton,
      h("button", { class: "button", type: "button", onClick: () => onSwitch(otherMode) }, `Play the ${MODE_NAME[otherMode]}`),
      h("button", { class: "button button--quiet", type: "button", onClick: onHome }, "Back to start"))
  );

  animateNumber(score, summary.score, formatNumber);
  replayButton.focus({ preventScroll: true });
}
