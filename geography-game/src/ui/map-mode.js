// Mode A, "Guess the Location": the game names a country and the player
// clicks it on the map.

import { $ } from "./dom.js";
import { WorldMap } from "../worldmap.js";
import { createTimer } from "./timer.js";
import { createResultCard } from "./result-card.js";
import { capitalSentence, wrongPlaceSentence } from "./phrases.js";
import { currentCode, isLastRound, speedWindowFor } from "../game.js";

// atlas, trivia: shared game data
// onAnswer({ picked, elapsedMs }): scores the answer and returns the result
// onNext(): moves to the next round or to the summary
export function createMapMode({ atlas, trivia, onAnswer, onNext }) {
  const mapElement = $("#map");
  const prompt = $("#map-prompt");
  const targetName = $("#map-target");
  const cardElement = $("#map-result");
  const fitButton = $("#map-fit");
  const timer = createTimer($("#map-timer"));
  const card = createResultCard(cardElement, { trivia, onNext });

  let map = null;       // created on first use, once the screen is visible
  let session = null;
  let target = null;    // the place being asked for

  // Space the camera keeps clear of the question and, once shown, the card.
  function clearance() {
    const mapBox = mapElement.getBoundingClientRect();
    const top = prompt.getBoundingClientRect().bottom - mapBox.top + 20;
    if (cardElement.hidden) return { topLeft: [28, top], bottomRight: [28, 36] };
    const cardBox = cardElement.getBoundingClientRect();
    const isSheet = cardBox.width > mapBox.width * 0.7;
    return isSheet
      ? { topLeft: [24, top], bottomRight: [24, mapBox.bottom - cardBox.top + 20] }
      : { topLeft: [cardBox.right - mapBox.left + 36, top], bottomRight: [72, 44] };
  }

  function pick(place) {
    const elapsedMs = timer.stop();
    const pickedName = atlas.nameOf(place);
    const result = onAnswer({ picked: { code: place.country?.code ?? place.key, name: pickedName }, elapsedMs });
    const country = target.country;

    prompt.classList.add("is-answered");
    card.show({
      tone: result.correct ? "correct" : "wrong",
      status: result.correct ? "Found it" : "Not there",
      country,
      withFlag: true,
      detail: [result.correct ? "" : wrongPlaceSentence(target, place, pickedName), capitalSentence(country)]
        .filter(Boolean)
        .join(" "),
      result,
      deck: trivia.open(country.code, "map"),
      nextLabel: isLastRound(session) ? "See results" : "Next country"
    });
    map.reveal({ target, picked: result.correct ? null : place, padding: clearance() });
  }

  fitButton.addEventListener("click", () => map?.showRegion({ padding: clearance() }));

  return {
    card,
    get worldMap() {
      return map;
    },

    startRound(currentSession, { first = false } = {}) {
      session = currentSession;
      if (!map) map = new WorldMap(mapElement, { atlas, interactive: true, onPick: pick });
      else map.resize();
      target = atlas.get(currentCode(session));
      card.hide();
      prompt.classList.remove("is-answered");
      targetName.textContent = target.country.name;
      map.startRound(session.region, { padding: clearance(), animate: !first });
      timer.start(session.speedBonus, speedWindowFor("map"));
    },

    stop() {
      timer.hide();
      card.hide();
    },

    resize() {
      map?.resize();
    }
  };
}
