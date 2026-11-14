// Game rules: picking the ten countries, scoring answers and summing up.
// No DOM in here, so the rules can be tested on their own.

import { ROUNDS_PER_GAME, SCORING } from "./config.js";
import { clamp, shuffle } from "./util.js";

// 1 correct answer in a row scores x1, 2 score x1.2, and so on up to the cap.
export function multiplierFor(streak) {
  if (streak <= 1) return 1;
  const raw = 1 + SCORING.streakStep * (streak - 1);
  return Math.min(SCORING.maxMultiplier, Math.round(raw * 10) / 10);
}

// Full bonus for an instant answer, fading to nothing over the time window.
export function speedBonusFor(elapsedMs, windowMs) {
  return Math.round(SCORING.speedBonusMax * clamp(1 - elapsedMs / windowMs, 0, 1));
}

// variant: "map", "choices" or "typed".
export function speedWindowFor(variant) {
  return SCORING.speedWindowMs[variant];
}

// Chooses the countries for one game. Countries asked about recently are held
// back while there are enough others to fill the game, so consecutive games
// feel different; within a game no country appears twice.
export function pickRounds(pool, recentCodes = [], random = Math.random, count = ROUNDS_PER_GAME) {
  const codes = pool.map(country => country.code);
  const fresh = shuffle(codes.filter(code => !recentCodes.includes(code)), random);
  const stale = shuffle(codes.filter(code => recentCodes.includes(code)), random);
  return [...fresh, ...stale].slice(0, count);
}

export function createSession({ mode, variant, region, codes, speedBonus }) {
  return {
    mode,            // "map" | "flag"
    variant,         // "map" | "choices" | "typed"
    region,
    codes,           // the countries to ask about, in order
    speedBonus,      // whether fast answers earn extra points
    index: 0,        // which round is being played
    score: 0,
    streak: 0,
    bestStreak: 0,
    results: []      // one entry per answered round
  };
}

export const currentCode = session => session.codes[session.index];
export const isLastRound = session => session.index >= session.codes.length - 1;
export const isFinished = session => session.results.length >= session.codes.length;
export const hasProgress = session => session.results.length > 0 && !isFinished(session);

// Records the answer to the current round and returns its result.
//   picked:    { code, name } of what the player chose, or null if they skipped
//   elapsedMs: time taken to answer
export function recordAnswer(session, { picked, elapsedMs }) {
  const code = currentCode(session);
  const correct = picked?.code === code;
  const streakBefore = session.streak;
  const result = {
    code,
    correct,
    picked,
    elapsedMs,
    base: 0,
    multiplier: 1,
    speed: 0,
    points: 0,
    streak: 0,
    streakLost: !correct && streakBefore >= 2
  };

  if (correct) {
    session.streak += 1;
    result.streak = session.streak;
    result.base = session.variant === "typed" ? SCORING.typedBase : SCORING.base;
    result.multiplier = multiplierFor(session.streak);
    result.speed = session.speedBonus ? speedBonusFor(elapsedMs, speedWindowFor(session.variant)) : 0;
    result.points = Math.round(result.base * result.multiplier) + result.speed;
    session.score += result.points;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
  } else {
    session.streak = 0;
  }

  session.results.push(result);
  return result;
}

export function advance(session) {
  session.index += 1;
}

export function summarize(session) {
  const total = session.results.length;
  const correct = session.results.filter(result => result.correct).length;
  return {
    score: session.score,
    correct,
    total,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    bestStreak: session.bestStreak,
    missed: session.results.filter(result => !result.correct)
  };
}

/* ------------------------------------------------------------------ */
/* Multiple choice                                                     */
/* ------------------------------------------------------------------ */

// Groups of flags that are easy to confuse. A wrong option is drawn from the
// target's group when possible, which makes multiple choice a real test.
const LOOKALIKE_GROUPS = [
  ["TCD", "ROU", "AND", "MDA"],
  ["IDN", "MCO", "POL"],
  ["IRL", "CIV", "ITA"],
  ["NLD", "LUX", "PRY", "HRV"],
  ["RUS", "SVN", "SVK", "SRB"],
  ["AUS", "NZL", "FJI", "TUV"],
  ["COL", "ECU", "VEN"],
  ["MLI", "GIN", "SEN", "CMR"],
  ["SWE", "FIN", "NOR", "ISL", "DNK"],
  ["EGY", "YEM", "SYR", "IRQ"],
  ["JOR", "PSE", "SDN", "KWT", "ARE"],
  ["HND", "SLV", "NIC", "ARG", "GTM"],
  ["QAT", "BHR"],
  ["BEL", "DEU"],
  ["HUN", "BGR", "TJK", "IRN"],
  ["BOL", "GHA", "ETH", "LTU"],
  ["AUT", "LVA", "LBN", "PER"],
  ["THA", "CRI"],
  ["USA", "LBR", "MYS"],
  ["TUR", "TUN"],
  ["NER", "IND"],
  ["CHE", "TON", "GEO"],
  ["PAK", "MRT", "DZA", "TKM"],
  ["VNM", "CHN", "MAR"],
  ["JPN", "BGD", "PLW"],
  ["CZE", "PHL"],
  ["KEN", "MWI", "SSD"],
  ["CUB", "CHL"],
  ["BFA", "GNB", "BEN"],
  ["MEX", "ITA"]
];

const lookalikes = new Map();
for (const group of LOOKALIKE_GROUPS) {
  for (const code of group) {
    lookalikes.set(code, [...(lookalikes.get(code) ?? []), ...group.filter(other => other !== code)]);
  }
}

// Four answer options for a flag: the target plus three wrong ones, chosen
// from lookalike flags first, then the same part of the world, then anywhere
// in the pool. Returned in random order.
export function buildChoices(target, pool, random = Math.random) {
  const available = new Map(pool.filter(c => c.code !== target.code).map(c => [c.code, c]));
  const chosen = [];
  const take = (candidates, max) => {
    for (const country of shuffle(candidates, random)) {
      if (chosen.length >= max) return;
      if (available.delete(country.code)) chosen.push(country);
    }
  };

  take((lookalikes.get(target.code) ?? []).map(code => available.get(code)).filter(Boolean), 2);
  take([...available.values()].filter(c => c.subregion === target.subregion), 3);
  take([...available.values()].filter(c => c.region === target.region), 3);
  take([...available.values()], 3);

  return shuffle([target, ...chosen], random);
}
