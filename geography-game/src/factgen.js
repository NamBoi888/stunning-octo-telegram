// Fallback trivia. Builds border and flag facts for any country from the
// country data alone (neighbours, region, coordinates, flag proportions), so
// countries without hand-written trivia still get something true and specific.
//
// Every generator returns { id, text } or null when it has nothing worth
// saying. Ids are stable, which lets the game remember what it has shown.

import { formatList, numberWord, capitalize, withArticle, possessive } from "./util.js";

const regionPhrase = region => (region === "Americas" ? "the Americas" : region);
const byName = (a, b) => a.name.localeCompare(b.name);

// Names as they read in a sentence: "the Netherlands", "The Bahamas has ...".
const the = country => withArticle(country.name);
const The = country => withArticle(country.name, true);
const listOf = places => formatList(places.map(the));

const statsCache = new WeakMap();

// Figures shared by every country, worked out once per dataset.
function statsFor(countries) {
  let stats = statsCache.get(countries);
  if (!stats) {
    const playable = [...countries.values()].filter(country => country.playable);
    const ratioCounts = new Map();
    for (const country of playable) {
      const ratio = country.flag?.ratio;
      if (ratio) ratioCounts.set(ratio, (ratioCounts.get(ratio) ?? 0) + 1);
    }
    const commonestRatio = [...ratioCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    stats = { playable, ratioCounts, commonestRatio };
    statsCache.set(countries, stats);
  }
  return stats;
}

const neighboursOf = (country, countries) =>
  country.borders.map(code => countries.get(code)).filter(Boolean).sort(byName);

/* ------------------------------------------------------------------ */
/* Border facts                                                        */
/* ------------------------------------------------------------------ */

function landlockedFact(country, countries, { playable }) {
  if (!country.landlocked) return null;
  const neighbours = neighboursOf(country, countries);
  if (neighbours.length && neighbours.every(neighbour => neighbour.landlocked)) {
    return {
      id: "landlocked",
      text: `${The(country)} is doubly landlocked: it has no coast, and neither does any of its neighbours.`
    };
  }
  const inRegion = playable.filter(other => other.region === country.region);
  const landlocked = inRegion.filter(other => other.landlocked).length;
  const region = regionPhrase(country.region);
  const tally = landlocked === 1
    ? `No other country in ${region} is landlocked.`
    : `Of the ${inRegion.length} countries in ${region} that this game covers, ${numberWord(landlocked)} are landlocked.`;
  return {
    id: "landlocked",
    text: `${The(country)} has no coastline, so the sea can only be reached by crossing another country. ${tally}`
  };
}

function neighboursFact(country, countries) {
  const neighbours = neighboursOf(country, countries);
  if (!neighbours.length) {
    return { id: "neighbours", text: `${The(country)} has no land borders. Every one of its frontiers is at sea.` };
  }
  if (neighbours.length === 1) {
    return { id: "neighbours", text: `${The(country)} has only one land neighbour: ${the(neighbours[0])}.` };
  }
  return {
    id: "neighbours",
    text: `${The(country)} has ${numberWord(neighbours.length)} land neighbours: ${listOf(neighbours)}.`
  };
}

function rankFact(country, countries, { playable }) {
  const count = country.borders.length;
  if (!count) return null;
  const region = regionPhrase(country.region);
  const peers = playable.filter(other => other.region === country.region && other.code !== country.code);

  if (count === 1) {
    const alike = peers.filter(other => other.borders.length === 1).length + 1;
    return {
      id: "rank",
      text: alike === 1
        ? `${The(country)} is the only country in ${region} with exactly one land neighbour.`
        : `${The(country)} is one of ${numberWord(alike)} countries in ${region} with exactly one land neighbour.`
    };
  }

  const more = peers.filter(other => other.borders.length > count).length;
  const tied = peers.filter(other => other.borders.length === count).sort(byName);
  if (more === 0 && !tied.length) {
    return {
      id: "rank",
      text: `No other country in ${region} has as many land neighbours as ${the(country)}, which has ${numberWord(count)}.`
    };
  }
  if (more === 0 && tied.length <= 3) {
    return {
      id: "rank",
      text: `${The(country)} has ${numberWord(count)} land neighbours, tied with ${listOf(tied)} for the most in ${region}.`
    };
  }
  if (more >= 1 && more <= 5) {
    return {
      id: "rank",
      text: `Only ${numberWord(more)} ${more === 1 ? "country" : "countries"} in ${region} ${more === 1 ? "has" : "have"} more land neighbours than ${the(country)}, which has ${numberWord(count)}.`
    };
  }
  return null;
}

function sharedNeighboursFact(country, countries) {
  let best = null;
  for (const neighbour of neighboursOf(country, countries)) {
    const shared = neighbour.borders
      .filter(code => country.borders.includes(code))
      .map(code => countries.get(code))
      .filter(Boolean)
      .sort(byName);
    if (shared.length >= 2 && (!best || shared.length > best.shared.length)) best = { neighbour, shared };
  }
  if (!best) return null;
  return {
    id: "shared",
    text: `${The(country)} and ${the(best.neighbour)} have ${numberWord(best.shared.length)} neighbours in common: ${listOf(best.shared)}.`
  };
}

function busiestNeighbourFact(country, countries) {
  const neighbours = neighboursOf(country, countries);
  if (neighbours.length < 2) return null;
  const [busiest, runnerUp] = [...neighbours].sort((a, b) => b.borders.length - a.borders.length);
  if (busiest.borders.length < 5 || busiest.borders.length === runnerUp.borders.length) return null;
  if (busiest.borders.length <= country.borders.length) return null;
  return {
    id: "busiest",
    text: `Of ${possessive(the(country))} neighbours, ${the(busiest)} has the most borders of its own, with ${numberWord(busiest.borders.length)} land neighbours.`
  };
}

function seamFact(country, countries) {
  const across = neighboursOf(country, countries).filter(n => n.region && n.region !== country.region);
  if (!across.length) return null;
  const other = across[0];
  return {
    id: "seam",
    text: `${The(country)} sits on the edge of a continent. It is counted as part of ${regionPhrase(country.region)}, but its neighbour ${the(other)} is counted as part of ${regionPhrase(other.region)}.`
  };
}

// Uses the closest-neighbour list measured from the boundary data (see
// tools/prepare-data.mjs). Only countries with at most one land neighbour have one.
function nearestFact(country, countries) {
  const nearest = country.nearest.map(code => countries.get(code)).filter(Boolean);
  if (nearest.length < 2 || country.borders.length > 1) return null;
  const names = listOf(nearest);
  const [neighbour] = neighboursOf(country, countries);
  return {
    id: "nearest",
    text: neighbour
      ? `After ${the(neighbour)}, with which it shares a land border, ${possessive(the(country))} closest neighbours are ${names}.`
      : `${possessive(The(country))} closest neighbours across the sea are ${names}.`
  };
}

// Plain coordinates: only used when a country has little else to offer.
function positionFact(country) {
  const [lat, lng] = country.latlng;
  const latText = `${Math.abs(Math.round(lat))}°${lat >= 0 ? "N" : "S"}`;
  const lngText = `${Math.abs(Math.round(lng))}°${lng >= 0 ? "E" : "W"}`;
  const equator = Math.abs(lat) < 1.5 ? "almost on the Equator" : `${lat > 0 ? "north" : "south"} of the Equator`;
  const meridian = Math.abs(lng) < 1.5
    ? "almost on the Greenwich meridian"
    : `${lng > 0 ? "east" : "west"} of the Greenwich meridian`;
  return {
    id: "position",
    text: `On the globe, ${the(country)} is centred near ${latText}, ${lngText}. That puts it ${equator} and ${meridian}.`
  };
}

/* ------------------------------------------------------------------ */
/* Flag facts                                                          */
/* ------------------------------------------------------------------ */

// "2:3" -> "2:3, two units tall for every three wide"
function describeRatio(ratio) {
  const [height, width] = ratio.split(":").map(Number);
  if (height === width) return "1:1, a perfect square";
  if (height > 12 || width > 12) return ratio;
  return `${ratio}, ${numberWord(height)} ${height === 1 ? "unit" : "units"} tall for every ${numberWord(width)} wide`;
}

function isWiderThanTall(ratio) {
  const [height, width] = ratio.split(":").map(Number);
  return width >= height;
}

function ratioFact(country, countries, { playable, ratioCounts, commonestRatio }) {
  const ratio = country.flag?.ratio;
  if (!ratio || !isWiderThanTall(ratio)) return null;
  const count = ratioCounts.get(ratio);
  const described = describeRatio(ratio);

  if (ratio === commonestRatio) {
    return {
      id: "ratio",
      text: `This flag is usually drawn in the proportions ${described}. That is the most common shape for a national flag: ${count} of the ${playable.length} flags in this game use it.`
    };
  }
  if (count === 1) {
    return {
      id: "ratio",
      text: `No other flag in this game has the same proportions as this one, which is usually drawn ${described}.`
    };
  }
  // Name flags the player is most likely to know: neighbours first, then the
  // same region, then anywhere.
  const closeness = other =>
    country.borders.includes(other.code) ? 0 : other.region === country.region ? 1 : 2;
  const others = playable
    .filter(other => other.code !== country.code && other.flag?.ratio === ratio)
    .sort((a, b) => closeness(a) - closeness(b) || byName(a, b));
  const sharing = others.length <= 3
    ? `the ${others.length === 1 ? "flag" : "flags"} of ${listOf(others)}`
    : `${others.length} other flags in this game, including those of ${listOf(others.slice(0, 3))}`;
  return {
    id: "ratio",
    text: `This flag is usually drawn in the proportions ${described}. It shares that shape with ${sharing}.`
  };
}

function neighbourRatioFact(country, countries) {
  const ratio = country.flag?.ratio;
  if (!ratio || !isWiderThanTall(ratio)) return null;
  const neighbours = neighboursOf(country, countries).filter(n => n.playable && n.flag?.ratio);
  if (neighbours.length < 2) return null;
  const same = neighbours.filter(n => n.flag.ratio === ratio);

  if (same.length === neighbours.length) {
    return {
      id: "ratio-neighbours",
      text: `${capitalize(numberWord(neighbours.length))} countries border ${the(country)}, and all of their flags are usually drawn in the same ${ratio} proportions as this one.`
    };
  }
  if (!same.length) {
    const other = neighbours[0];
    return {
      id: "ratio-neighbours",
      text: `None of ${possessive(the(country))} land neighbours flies a flag with the same proportions. This one is usually drawn ${ratio}, while ${possessive(the(other))} is ${other.flag.ratio}.`
    };
  }
  return {
    id: "ratio-neighbours",
    text: `Of ${possessive(the(country))} ${numberWord(neighbours.length)} land neighbours, ${numberWord(same.length)} ${same.length === 1 ? "flies a flag" : "fly flags"} with the same ${ratio} proportions as this one: ${listOf(same)}.`
  };
}

function regionRatioFact(country, countries, { playable }) {
  const ratio = country.flag?.ratio;
  if (!ratio || !isWiderThanTall(ratio)) return null;
  const inRegion = playable.filter(other => other.region === country.region);
  const same = inRegion.filter(other => other.flag?.ratio === ratio).length;
  if (same < 2) return null;
  return {
    id: "ratio-region",
    text: `In ${regionPhrase(country.region)}, ${numberWord(same)} of the ${inRegion.length} national flags in this game share this flag’s ${ratio} proportions.`
  };
}

/* ------------------------------------------------------------------ */

// Most distinctive first: this is the order facts are offered in.
const BORDER_GENERATORS = [
  landlockedFact,
  neighboursFact,
  nearestFact,
  rankFact,
  seamFact,
  sharedNeighboursFact,
  busiestNeighbourFact
];
const FLAG_GENERATORS = [ratioFact, neighbourRatioFact, regionRatioFact];
const MIN_BORDER_FACTS = 3;

// country: a country object; countries: Map of every country by code.
// Returns { border: [{ id, text }], flag: [{ id, text }] }.
export function generateFacts(country, countries) {
  const stats = statsFor(countries);
  const run = generators =>
    generators.map(generate => generate(country, countries, stats)).filter(Boolean);
  const border = run(BORDER_GENERATORS);
  if (border.length < MIN_BORDER_FACTS) border.push(positionFact(country));
  return { border, flag: run(FLAG_GENERATORS) };
}
