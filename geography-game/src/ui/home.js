// The start screen: mode selector and settings.

import { $, $$, h } from "./dom.js";
import { createGlobe } from "./globe.js";
import { showFlag } from "../assets.js";
import { playableCountries } from "../countries.js";
import { REGIONS } from "../config.js";
import { formatNumber, shuffle } from "../util.js";

const FLAGS_ON_WALL = 14;

// settings:          { region, speedBonus, answerStyle }, mutated in place
// onChange():        settings were edited
// onStart(mode):     a Start button was pressed
// onRefresh():       the player asked to check REST Countries
// bestFor(mode):     best score for a mode under the current settings, or 0
export function createHome({ atlas, countries, settings, onChange, onStart, onRefresh, bestFor }) {
  const chips = $("#region-chips");
  const speedToggle = $("#speed-toggle");
  const flagWall = $("#flag-wall");
  const globe = createGlobe($("#globe"), atlas);

  chips.replaceChildren(
    ...REGIONS.map(region =>
      h("label", { class: "chip" },
        h("input", { type: "radio", name: "region", value: region.id, checked: region.id === settings.region }),
        h("span", {}, region.label))
    )
  );
  speedToggle.checked = settings.speedBonus;
  for (const radio of $$("input[name=answer-style]")) radio.checked = radio.value === settings.answerStyle;

  function paintBest() {
    for (const mode of ["map", "flag"]) {
      const best = bestFor(mode);
      $(`#best-${mode}`).textContent = best > 0 ? `Your best: ${formatNumber(best)}` : "";
    }
  }

  // A handful of flags from the chosen region, as a taste of what is coming.
  function paintFlagWall() {
    const sample = shuffle(playableCountries(countries, settings.region)).slice(0, FLAGS_ON_WALL);
    flagWall.replaceChildren(
      ...sample.map(country => {
        const img = h("img", { class: "flag-wall__flag", alt: "", draggable: "false" });
        showFlag(img, country);
        return img;
      })
    );
  }

  function applyRegion() {
    const region = REGIONS.find(r => r.id === settings.region) ?? REGIONS[0];
    globe.face(region.centre, region.id);
    paintFlagWall();
    paintBest();
  }

  chips.addEventListener("change", event => {
    settings.region = event.target.value;
    onChange();
    applyRegion();
  });
  speedToggle.addEventListener("change", () => {
    settings.speedBonus = speedToggle.checked;
    onChange();
  });
  $("#answer-style").addEventListener("change", event => {
    settings.answerStyle = event.target.value;
    onChange();
    paintBest();
  });
  $("#start-map").addEventListener("click", () => onStart("map"));
  $("#start-flag").addEventListener("click", () => onStart("flag"));
  $("#data-refresh").addEventListener("click", onRefresh);

  return {
    show() {
      applyRegion();
      globe.start();
    },
    hide() {
      globe.stop();
    },
    // message: what to say about where the country data came from.
    // busy:    a check is in progress.
    setDataSource(message, { busy = false, canRefresh = true } = {}) {
      $("#data-source").textContent = message;
      const button = $("#data-refresh");
      button.disabled = busy;
      button.hidden = !canRefresh;
      button.textContent = busy ? "Checking…" : "Check REST Countries for updates";
    },
    refreshFlags: paintFlagWall
  };
}
