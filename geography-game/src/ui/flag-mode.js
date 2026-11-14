// Mode B, "Guess the Flag": the game shows a flag and the player says whose
// it is, either by picking one of four options (Casual) or by typing the name
// with autocomplete (Hardcore). After the answer a locator map flies to the
// country.

import { $, $$, h, replay } from "./dom.js";
import { WorldMap } from "../worldmap.js";
import { createTimer } from "./timer.js";
import { createResultCard } from "./result-card.js";
import { capitalSentence } from "./phrases.js";
import { showFlag } from "../assets.js";
import { matchCountry, playableCountries, suggestCountries } from "../countries.js";
import { buildChoices, currentCode, isLastRound, speedWindowFor } from "../game.js";
import { withArticle } from "../util.js";

// atlas, countries, trivia: shared game data
// onAnswer({ picked, elapsedMs }): scores the answer and returns the result
// onNext(): moves to the next round or to the summary
export function createFlagMode({ atlas, countries, trivia, onAnswer, onNext }) {
  const image = $("#flag-image");
  const choicesBox = $("#flag-choices");
  const form = $("#flag-typed");
  const input = $("#flag-input");
  const list = $("#flag-suggestions");
  const hint = $("#flag-hint");
  const skipButton = $("#flag-skip");
  const locatorBox = $("#locator");
  const locatorHint = $("#locator-hint");
  const aside = $(".flagmode__aside");
  const timer = createTimer($("#flag-timer"));
  const card = createResultCard($("#flag-result"), { trivia, onNext });

  let locator = null;     // the mini-map, created on first use
  let session = null;
  let target = null;      // the country whose flag is showing
  let answered = true;
  let suggestions = [];
  let active = -1;        // highlighted suggestion
  let roundToken = 0;     // guards against a slow image from an earlier round

  /* ---------------- answering ---------------- */

  function finish(picked) {
    if (answered) return;
    answered = true;
    const elapsedMs = timer.stop();
    timer.hide();
    const result = onAnswer({ picked: picked ? { code: picked.code, name: picked.name } : null, elapsedMs });

    if (session.variant === "choices") {
      for (const button of $$(".choice", choicesBox)) {
        const code = button.dataset.code;
        button.disabled = true;
        button.classList.toggle("is-correct", code === target.code);
        button.classList.toggle("is-wrong", code === picked?.code && !result.correct);
        button.classList.toggle("is-dim", code !== target.code && code !== picked?.code);
      }
    } else {
      closeSuggestions();
      input.disabled = true;
      skipButton.disabled = true;
      form.querySelector("[type=submit]").disabled = true;
      form.classList.add(result.correct ? "is-correct" : "is-wrong");
      hint.textContent = "";
    }

    const belongs = `This is the flag of ${withArticle(target.name)}.`;
    const detail = result.correct
      ? capitalSentence(target)
      : [picked ? `You answered ${withArticle(picked.name)}.` : "", belongs, capitalSentence(target)].filter(Boolean).join(" ");

    locatorBox.classList.add("is-revealed");
    locatorHint.hidden = true;
    card.show({
      tone: result.correct ? "correct" : "wrong",
      status: result.correct ? "Correct" : picked ? "Not this one" : "Skipped",
      country: target,
      withFlag: false,
      detail,
      result,
      deck: trivia.open(target.code, "flag"),
      nextLabel: isLastRound(session) ? "See results" : "Next flag"
    });
    locator.resize();
    locator.reveal({ target: atlas.get(target.code), padding: { topLeft: [20, 20], bottomRight: [20, 20] } });

    // On narrow screens the map and card sit below the answers: bring them into view.
    if (aside.getBoundingClientRect().bottom > window.innerHeight) {
      aside.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ---------------- Casual: four options ---------------- */

  function renderChoices() {
    const pool = playableCountries(countries, session.region);
    const options = buildChoices(target, pool);
    choicesBox.replaceChildren(
      ...options.map((country, index) =>
        h("button", { class: "choice", type: "button", "data-code": country.code, onClick: () => finish(country) },
          h("kbd", { class: "choice__key", "aria-hidden": "true" }, String(index + 1)),
          h("span", { class: "choice__name" }, country.name))
      )
    );
  }

  /* ---------------- Hardcore: type the name ---------------- */

  const everyCountry = () => playableCountries(countries);

  function paintSuggestions() {
    list.replaceChildren(
      ...suggestions.map((country, index) =>
        h("li", {
          class: `typed__option${index === active ? " is-active" : ""}`,
          id: `flag-option-${index}`,
          role: "option",
          "aria-selected": index === active ? "true" : "false",
          // mousedown, not click: it fires before the input loses focus.
          onMousedown: event => {
            event.preventDefault();
            input.value = country.name;
            finish(country);
          }
        }, country.name)
      )
    );
    const open = suggestions.length > 0;
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (active >= 0) input.setAttribute("aria-activedescendant", `flag-option-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function closeSuggestions() {
    suggestions = [];
    active = -1;
    paintSuggestions();
  }

  function submitTyped() {
    if (answered) return;
    const text = input.value.trim();
    let country = active >= 0 ? suggestions[active] : matchCountry(text, everyCountry());
    if (!country && suggestions.length === 1) country = suggestions[0];
    if (country) {
      input.value = country.name;
      finish(country);
      return;
    }
    if (suggestions.length) {
      active = 0;
      paintSuggestions();
      hint.textContent = "Choose a country from the list, then press Enter.";
    } else {
      hint.textContent = text
        ? "No country matches that. Check the spelling, or choose “I don’t know”."
        : "Type a country name first.";
      replay(input, "is-shaking");
    }
  }

  input.addEventListener("input", () => {
    hint.textContent = "";
    suggestions = suggestCountries(input.value, everyCountry());
    active = -1;
    paintSuggestions();
  });
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + suggestions.length + (active < 0 && step < 0 ? 1 : 0)) % suggestions.length;
      paintSuggestions();
    } else if (event.key === "Escape") {
      closeSuggestions();
    }
  });
  input.addEventListener("blur", closeSuggestions);
  form.addEventListener("submit", event => {
    event.preventDefault();
    submitTyped();
  });
  skipButton.addEventListener("click", () => finish(null));

  /* ---------------- rounds ---------------- */

  function beginTiming(token) {
    if (token !== roundToken || answered) return;
    image.classList.remove("is-loading");
    timer.start(session.speedBonus, speedWindowFor(session.variant));
  }

  return {
    card,
    get worldMap() {
      return locator;
    },

    startRound(currentSession, { first = false } = {}) {
      session = currentSession;
      target = countries.get(currentCode(session));
      answered = false;
      const token = ++roundToken;

      card.hide();
      locatorBox.classList.remove("is-revealed");
      locatorHint.hidden = false;
      if (!locator) locator = new WorldMap($("#mini-map"), { atlas, interactive: false });
      else locator.resize();
      locator.startRound(session.region, { animate: !first, padding: { topLeft: [12, 12], bottomRight: [12, 12] } });

      const typed = session.variant === "typed";
      choicesBox.hidden = typed;
      form.hidden = !typed;
      if (typed) {
        form.classList.remove("is-correct", "is-wrong");
        input.disabled = false;
        skipButton.disabled = false;
        form.querySelector("[type=submit]").disabled = false;
        input.value = "";
        hint.textContent = "";
        closeSuggestions();
        input.focus({ preventScroll: true });
      } else {
        renderChoices();
      }

      // The clock starts when the flag is on screen, not while it is loading.
      timer.hide();
      image.classList.add("is-loading");
      showFlag(image, target);
      image.decode().then(() => beginTiming(token), () => beginTiming(token));
      window.scrollTo({ top: 0, behavior: first ? "auto" : "smooth" });
    },

    // Number keys 1 to 4 choose an option in Casual play.
    chooseByNumber(number) {
      if (answered || session?.variant !== "choices") return false;
      const button = $$(".choice", choicesBox)[number - 1];
      if (!button) return false;
      button.click();
      return true;
    },

    stop() {
      answered = true;
      roundToken++;
      timer.hide();
      card.hide();
    },

    resize() {
      locator?.resize();
    }
  };
}
