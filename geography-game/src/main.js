// Meridian: entry point. Loads the data, builds the screens and runs the
// game loop (ten rounds, then a summary).

import {
  AUTO_FETCH_LIVE_DATA, LOCAL_BOUNDARIES_PATH, LOCAL_COUNTRIES_PATH, STORAGE_KEYS
} from "./config.js";
import { FACTS } from "../data/facts.js";
import { fetchLiveCountries, loadJSON } from "./assets.js";
import { buildAtlas } from "./atlas.js";
import { buildCountries, mergeLiveData, playableCountries } from "./countries.js";
import {
  advance, createSession, hasProgress, isFinished, pickRounds, recordAnswer, summarize
} from "./game.js";
import { localStore, sessionStore } from "./storage.js";
import { createTrivia } from "./trivia.js";
import { $, $$ } from "./ui/dom.js";
import { createFlagMode } from "./ui/flag-mode.js";
import { createHome } from "./ui/home.js";
import { createHud } from "./ui/hud.js";
import { createMapMode } from "./ui/map-mode.js";
import { renderSummary } from "./ui/summary.js";

const RECENT_COUNTRIES_KEPT = 40;
const MODE_NAME = { map: "map game", flag: "flag game" };

const settings = {
  region: "World",
  speedBonus: true,
  answerStyle: "choices",      // "choices" (Casual) or "typed" (Hardcore)
  ...localStore.get(STORAGE_KEYS.settings, {})
};

let countries, atlas, trivia, hud, home;
let session = null;
const modes = {};               // "map" and "flag" screens

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

function showScreen(name) {
  document.body.dataset.screen = name;
  for (const screen of $$(".screen")) screen.hidden = screen.dataset.screen !== name;
  const inGame = name === "map" || name === "flag";
  $("#mode-tabs").hidden = !(inGame || name === "summary");
  hud.show(inGame);
  for (const tab of $$("#mode-tabs button")) {
    tab.setAttribute("aria-pressed", String(inGame && tab.dataset.mode === name));
  }
  if (name === "home") home.show();
  else home.hide();
}

// Asks before throwing away a game in progress. Resolves to true to go ahead.
function confirmLeaving(title, action) {
  if (!session || !hasProgress(session)) return Promise.resolve(true);
  const dialog = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent =
    `This ${MODE_NAME[session.mode]} is on round ${session.index + 1} of ${session.codes.length}. Its score will not be kept.`;
  $("#confirm-ok").textContent = action;
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
}

/* ------------------------------------------------------------------ */
/* Game loop                                                           */
/* ------------------------------------------------------------------ */

const variantFor = mode => (mode === "map" ? "map" : settings.answerStyle);
const bestKey = (mode, variant, region) => `${mode}/${variant}/${region}`;
const bestFor = mode => localStore.get(STORAGE_KEYS.best, {})[bestKey(mode, variantFor(mode), settings.region)] ?? 0;

function startGame(mode) {
  for (const other of Object.values(modes)) other.stop();
  const pool = playableCountries(countries, settings.region);
  const recent = sessionStore.get(STORAGE_KEYS.recent, []);
  const codes = pickRounds(pool, recent);
  sessionStore.set(STORAGE_KEYS.recent, [...recent, ...codes].slice(-RECENT_COUNTRIES_KEPT));

  session = createSession({
    mode,
    variant: variantFor(mode),
    region: settings.region,
    codes,
    speedBonus: settings.speedBonus
  });
  showScreen(mode);
  hud.update(session);
  modes[mode].startRound(session, { first: true });
}

function handleAnswer({ picked, elapsedMs }) {
  const result = recordAnswer(session, { picked, elapsedMs });
  hud.update(session, { celebrate: result.correct });
  return result;
}

function handleNext() {
  if (isFinished(session)) {
    finishGame();
    return;
  }
  advance(session);
  hud.update(session);
  modes[session.mode].startRound(session);
}

function finishGame() {
  const { score } = summarize(session);
  const key = bestKey(session.mode, session.variant, session.region);
  const bests = localStore.get(STORAGE_KEYS.best, {});
  const previous = bests[key] ?? 0;
  const isNew = score > previous;
  if (isNew) localStore.set(STORAGE_KEYS.best, { ...bests, [key]: score });

  modes[session.mode].stop();
  showScreen("summary");
  renderSummary($("#summary"), {
    session,
    countries,
    best: { previous, isNew },
    onReplay: () => startGame(session.mode),
    onSwitch: mode => startGame(mode),
    onHome: goHome
  });
  window.scrollTo({ top: 0 });
}

function goHome() {
  for (const mode of Object.values(modes)) mode.stop();
  session = null;
  showScreen("home");
  window.scrollTo({ top: 0 });
}

/* ------------------------------------------------------------------ */
/* Country data                                                        */
/* ------------------------------------------------------------------ */

// Tries REST Countries and, if it sends a real country list, lays it over the
// bundled data. Any failure leaves the game exactly as it was.
async function refreshLiveData() {
  home.setDataSource("Country data: bundled copy.", { busy: true });
  const { data, reason } = await fetchLiveCountries();
  if (data) {
    const refreshed = mergeLiveData(countries, data);
    trivia.clear();
    home.refreshFlags();
    home.setDataSource(`Country data: live from REST Countries (${refreshed} entries refreshed).`, { canRefresh: false });
  } else {
    home.setDataSource(`Country data: bundled copy. ${reason}`);
  }
}

/* ------------------------------------------------------------------ */
/* Start-up                                                            */
/* ------------------------------------------------------------------ */

function wireControls() {
  $("#brand").addEventListener("click", async () => {
    if (document.body.dataset.screen === "home") return;
    if (await confirmLeaving("Leave this game?", "Leave game")) goHome();
  });

  $("#mode-tabs").addEventListener("click", async event => {
    const mode = event.target.closest("button")?.dataset.mode;
    if (!mode) return;
    const playing = session && !isFinished(session) && session.mode === mode;
    if (playing && document.body.dataset.screen === mode) return;
    if (await confirmLeaving(`Switch to the ${MODE_NAME[mode]}?`, "Switch")) startGame(mode);
  });

  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if ($("#confirm-dialog").open) return;
    const screen = document.body.dataset.screen;
    const mode = modes[screen];
    if (!mode) return;
    const typing = event.target.matches?.("input, textarea");
    const onControl = event.target.matches?.("button, a, input, textarea, select");

    if (mode.card.visible) {
      if (event.key.toLowerCase() === "r" && !typing) {
        mode.card.reroll();
        event.preventDefault();
      } else if ((event.key === "Enter" || event.key === " ") && !onControl) {
        mode.card.next();
        event.preventDefault();
      }
    } else if (screen === "flag" && !typing && /^[1-4]$/.test(event.key)) {
      if (modes.flag.chooseByNumber(Number(event.key))) event.preventDefault();
    }
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => modes[document.body.dataset.screen]?.resize(), 150);
  });
}

async function boot() {
  try {
    const [rawCountries, topology] = await Promise.all([
      loadJSON(LOCAL_COUNTRIES_PATH),
      loadJSON(LOCAL_BOUNDARIES_PATH)
    ]);
    countries = buildCountries(rawCountries);
    atlas = buildAtlas(topology, countries);
  } catch (error) {
    console.error(error);
    $("#loading-text").textContent =
      "The map data could not be loaded. If you opened index.html straight from a folder, open meridian.html instead, or serve this folder with a local web server.";
    return;
  }

  trivia = createTrivia({ curated: FACTS, countries, store: sessionStore });
  hud = createHud();
  home = createHome({
    atlas,
    countries,
    settings,
    onChange: () => localStore.set(STORAGE_KEYS.settings, settings),
    onStart: startGame,
    onRefresh: refreshLiveData,
    bestFor
  });
  modes.map = createMapMode({ atlas, trivia, onAnswer: handleAnswer, onNext: handleNext });
  modes.flag = createFlagMode({ atlas, countries, trivia, onAnswer: handleAnswer, onNext: handleNext });

  wireControls();
  showScreen("home");

  const query = new URLSearchParams(window.location.search);
  if (AUTO_FETCH_LIVE_DATA || query.has("live")) refreshLiveData();

  // Open the page with ?debug to inspect the running game from the console
  // (and to let automated checks find the right country on the map).
  if (query.has("debug")) {
    window.meridian = {
      atlas,
      countries,
      trivia,
      modes,
      get session() {
        return session;
      }
    };
  }
}

boot();
