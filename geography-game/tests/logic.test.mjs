// Unit tests for the DOM-free game logic. Run with:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FACTS } from "../data/facts.js";
import { ROUNDS_PER_GAME, SCORING, STORAGE_KEYS } from "../src/config.js";
import {
  buildCountries, isCountryList, mergeLiveData, playableCountries, matchCountry, suggestCountries
} from "../src/countries.js";
import { generateFacts } from "../src/factgen.js";
import { createTrivia } from "../src/trivia.js";
import { memoryStore } from "../src/storage.js";
import {
  multiplierFor, speedBonusFor, pickRounds, createSession, recordAnswer, advance, summarize,
  buildChoices, currentCode, isFinished
} from "../src/game.js";
import { describeShape, distanceKm, compassDirection } from "../src/geo.js";
import { normalizeText, formatList, withArticle, possessive } from "../src/util.js";

const raw = JSON.parse(readFileSync(new URL("../data/countries.json", import.meta.url), "utf8"));
const fresh = () => buildCountries(JSON.parse(JSON.stringify(raw)));
const countries = fresh();
const playable = playableCountries(countries);

// Deterministic random numbers so failures can be reproduced.
function seeded(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/* ---------------- country data ---------------- */

test("the bundled snapshot covers 197 playable countries in five regions", () => {
  assert.equal(playable.length, 197);
  const regions = new Set(playable.map(c => c.region));
  assert.deepEqual([...regions].sort(), ["Africa", "Americas", "Asia", "Europe", "Oceania"]);
  for (const region of regions) {
    assert.ok(playableCountries(countries, region).length >= ROUNDS_PER_GAME, `${region} can fill a game`);
  }
});

test("every playable country has a flag, a capital, coordinates and known neighbours", () => {
  for (const country of playable) {
    assert.match(country.flag.src, /^flags\/[a-z]{2}\.svg$/, country.code);
    assert.ok(country.capital, `${country.code} capital`);
    assert.equal(country.latlng.length, 2);
    for (const code of country.borders) assert.ok(countries.has(code), `${country.code} borders unknown ${code}`);
  }
});

test("flag files exist for every playable country", () => {
  for (const country of playable) {
    const svg = readFileSync(new URL("../" + country.flag.src, import.meta.url), "utf8");
    assert.ok(svg.includes("<svg"), country.code);
  }
});

test("an error payload from the retired REST Countries endpoint is rejected", () => {
  const deprecated = { success: false, data: null, errors: [{ message: "This API version has been deprecated." }] };
  assert.equal(isCountryList(deprecated), false);
  assert.equal(isCountryList([]), false);
  assert.equal(isCountryList(null), false);
  assert.equal(isCountryList([{ cca3: "FRA" }]), false);
});

test("a valid live response refreshes metadata and keeps the bundled flag as fallback", () => {
  const live = raw.map(c => ({
    name: { common: c.cca3 === "TUR" ? "Turkey" : c.name.common, official: c.name.official },
    cca2: c.cca2,
    cca3: c.cca3,
    flags: { svg: `https://flagcdn.com/${c.cca2.toLowerCase()}.svg`, png: "", alt: "" },
    region: c.region,
    borders: c.borders,
    capital: c.cca3 === "FRA" ? [] : c.capital,
    latlng: c.cca3 === "DEU" ? ["bad"] : c.latlng
  }));
  assert.equal(isCountryList(live), true);
  const merged = fresh();
  assert.equal(mergeLiveData(merged, live), 250);
  const turkey = merged.get("TUR");
  assert.equal(turkey.name, "Turkey");
  assert.equal(turkey.flag.src, "https://flagcdn.com/tr.svg");
  assert.equal(turkey.flag.fallback, "flags/tr.svg");
  assert.equal(matchCountry("Türkiye", [turkey]), turkey, "old name still matches");
  assert.equal(merged.get("FRA").capital, "Paris", "empty live capital keeps the bundled one");
  assert.deepEqual(merged.get("DEU").latlng, countries.get("DEU").latlng, "malformed coordinates are ignored");
  assert.equal(merged.get("GRL").flag, null, "territories without a bundled flag stay flagless");
});

test("typed answers ignore case, accents and punctuation, and accept common aliases", () => {
  const expectMatch = (input, code) => assert.equal(matchCountry(input, playable)?.code, code, input);
  expectMatch("france", "FRA");
  expectMatch("  FRANCE ", "FRA");
  expectMatch("Cote d'Ivoire", "CIV");
  expectMatch("ivory coast", "CIV");
  expectMatch("sao tome and principe", "STP");
  expectMatch("turkey", "TUR");
  expectMatch("USA", "USA");
  expectMatch("uk", "GBR");
  expectMatch("St. Lucia", "LCA");
  expectMatch("the gambia", "GMB");
  expectMatch("DR Congo", "COD");
  expectMatch("congo", "COG");
  expectMatch("Guinea", "GIN");
  expectMatch("Niger", "NER");
  expectMatch("Dominica", "DMA");
  expectMatch("Bosnia & Herzegovina", "BIH");
  assert.equal(matchCountry("Atlantis", playable), null);
  assert.equal(matchCountry("", playable), null);
});

test("autocomplete ranks names that start with the text first", () => {
  const names = text => suggestCountries(text, playable).map(c => c.name);
  assert.equal(names("fra")[0], "France");
  assert.equal(names("united")[0], "United Arab Emirates");
  assert.ok(names("guinea").includes("Papua New Guinea"));
  assert.equal(names("guinea")[0], "Guinea");
  assert.ok(names("holl").includes("Netherlands"), "aliases are searched");
  assert.deepEqual(names(""), []);
  assert.ok(names("a").length <= 6);
});

/* ---------------- trivia ---------------- */

test("curated trivia covers 50+ countries on every continent with 3+ facts each", () => {
  const codes = Object.keys(FACTS);
  assert.ok(codes.length >= 50, `only ${codes.length} countries`);
  const regions = new Set();
  for (const code of codes) {
    const country = countries.get(code);
    assert.ok(country?.playable, `${code} is not a playable country`);
    regions.add(country.region);
    const { border, flag } = FACTS[code];
    assert.ok(Array.isArray(border) && border.length >= 1, `${code} needs a border fact`);
    assert.ok(Array.isArray(flag) && flag.length >= 1, `${code} needs a flag fact`);
    assert.ok(border.length + flag.length >= 3, `${code} has fewer than 3 facts`);
    for (const fact of [...border, ...flag]) {
      assert.equal(typeof fact, "string");
      assert.ok(fact.length >= 25 && fact.length <= 240, `${code}: odd length: ${fact}`);
      assert.match(fact, /[.!?”]$/, `${code}: should end as a sentence: ${fact}`);
    }
    assert.equal(new Set([...border, ...flag]).size, border.length + flag.length, `${code} repeats a fact`);
  }
  assert.equal(regions.size, 5);
});

test("the fallback generator gives every playable country usable facts", () => {
  for (const country of playable) {
    const { border, flag } = generateFacts(country, countries);
    assert.ok(border.length >= 2, `${country.code} has ${border.length} generated border facts`);
    if (country.flag.ratio && !["NPL"].includes(country.code)) {
      assert.ok(flag.length >= 1, `${country.code} has no generated flag fact`);
    }
    for (const fact of [...border, ...flag]) {
      assert.doesNotMatch(fact.text, /undefined|NaN|null|\s{2,}/, `${country.code}: ${fact.text}`);
      assert.ok(fact.text.includes(country.name) || fact.id.startsWith("ratio"), `${country.code}: ${fact.text}`);
      assert.doesNotMatch(fact.text, /s’s|(?<![Tt]he )(United States|United Kingdom|Netherlands|Philippines)\b/, fact.text);
    }
    assert.equal(new Set(border.map(f => f.id)).size, border.length);
  }
});

test("generated border facts agree with the data", () => {
  const text = (code, id) => generateFacts(countries.get(code), countries).border.find(f => f.id === id)?.text;
  assert.match(text("SVK", "neighbours"), /five land neighbours: Austria, Czechia, Hungary, Poland and Ukraine\./);
  assert.match(text("LIE", "landlocked"), /doubly landlocked/);
  assert.match(text("UZB", "landlocked"), /doubly landlocked/);
  assert.match(text("MLT", "neighbours"), /no land borders/);
  assert.match(text("PRT", "neighbours"), /only one land neighbour: Spain/);
  assert.match(text("BOL", "landlocked"), /Of the 35 countries in the Americas that this game covers, two are landlocked/);
  assert.match(text("EGY", "seam"), /part of Africa.*part of Asia/);
  assert.equal(text("FRA", "nearest"), undefined, "countries with several neighbours skip the nearest fact");
  assert.match(text("MLT", "nearest"), /closest neighbours across the sea are Italy, Tunisia and Libya/);
  assert.match(text("PRT", "nearest"), /After Spain, with which it shares a land border, Portugal’s closest neighbours are Morocco/);
  assert.match(text("LKA", "neighbours"), /no land borders/);
  assert.equal(text("SVK", "position"), undefined, "coordinates are only a last resort");
  assert.ok(text("MLT", "position"));
});

test("the first fact matches the game mode", () => {
  const trivia = createTrivia({ curated: FACTS, countries, store: memoryStore(), random: seeded(3) });
  assert.equal(trivia.open("FRA", "map").current.category, "border");
  assert.equal(trivia.open("FRA", "flag").current.category, "flag");
  // A country with no hand-written trivia still gets facts in both modes.
  assert.ok(!FACTS.SVK);
  assert.equal(trivia.open("SVK", "map").current.category, "border");
  assert.equal(trivia.open("SVK", "flag").current.category, "flag");
});

test("a country that comes up again leads with facts not shown before", () => {
  const store = memoryStore();
  const trivia = createTrivia({ curated: FACTS, countries, store, random: seeded(7) });
  const borderCount = trivia.factsFor("FRA").border.length;
  const shown = new Set();
  for (let game = 0; game < borderCount; game++) {
    const fact = trivia.open("FRA", "map").current;
    assert.equal(fact.category, "border");
    assert.ok(!shown.has(fact.id), `repeated ${fact.id} in game ${game + 1}`);
    shown.add(fact.id);
  }
  assert.equal(shown.size, borderCount);
  // Everything has now been seen: the oldest comes back first, not the latest.
  const again = trivia.open("FRA", "map").current;
  assert.equal(again.id, [...shown][0]);
  assert.ok(store.get(STORAGE_KEYS.seenFacts, {}).FRA.length >= borderCount);
});

test("hand-written facts are shown before generated ones", () => {
  const trivia = createTrivia({ curated: FACTS, countries, store: memoryStore(), random: seeded(11) });
  // Monaco has two hand-written border facts, so one generated fact tops it up.
  assert.equal(FACTS.MCO.border.length, 2);
  assert.deepEqual(trivia.factsFor("MCO").border.map(f => f.source), ["curated", "curated", "generated"]);
  assert.equal(trivia.open("MCO", "map").current.source, "curated");
  assert.equal(trivia.open("MCO", "map").current.source, "curated");
  assert.equal(trivia.open("MCO", "map").current.source, "generated");
});

test("generated facts top up thin categories but never crowd out hand-written ones", () => {
  const trivia = createTrivia({ curated: FACTS, countries, store: memoryStore() });
  for (const code of Object.keys(FACTS)) {
    const pool = trivia.factsFor(code);
    for (const category of ["border", "flag"]) {
      const written = FACTS[code][category].length;
      const generated = pool[category].filter(f => f.source === "generated").length;
      assert.ok(generated <= Math.max(0, 3 - written), `${code} ${category}`);
    }
    assert.ok(pool.border.length >= 3, `${code} has ${pool.border.length} border facts`);
    assert.ok(pool.border.length + pool.flag.length >= 5, code);
  }
  // Countries without hand-written trivia get the full generated set.
  assert.ok(trivia.factsFor("SVK").border.length >= 4);
});

test("rerolling cycles through the mode's facts without repeats, then wraps", () => {
  const trivia = createTrivia({ curated: FACTS, countries, store: memoryStore(), random: seeded(5) });
  for (const [mode, category] of [["flag", "flag"], ["map", "border"]]) {
    const deck = trivia.open("BRA", mode);
    assert.equal(deck.total, trivia.factsFor("BRA")[category].length);
    const ids = [deck.current.id];
    for (let i = 1; i < deck.total; i++) ids.push(trivia.reroll(deck).id);
    assert.equal(new Set(ids).size, deck.total, "each fact appears once per cycle");
    assert.equal(trivia.reroll(deck).id, ids[0], "then it wraps around");
  }
});

test("flag facts stay in Flag Mode and border facts stay in Map Mode", () => {
  const trivia = createTrivia({ curated: FACTS, countries, store: memoryStore(), random: seeded(17) });
  for (const country of playable) {
    for (const [mode, category] of [["flag", "flag"], ["map", "border"]]) {
      const deck = trivia.open(country.code, mode);
      assert.ok(deck.total >= 1, `${country.code} has no ${category} fact`);
      assert.ok(deck.facts.every(fact => fact.category === category), `${country.code} mixes categories in ${mode} mode`);
      // Rerolling all the way round never leaves the category either.
      for (let i = 0; i < deck.total + 1; i++) assert.equal(trivia.reroll(deck).category, category);
    }
  }
});

test("rerolled facts count as seen in later games", () => {
  const trivia = createTrivia({ curated: FACTS, countries, store: memoryStore(), random: seeded(9) });
  const deck = trivia.open("JPN", "map");
  const seen = [deck.current.id, trivia.reroll(deck).id];
  const next = trivia.open("JPN", "map").current;
  assert.ok(!seen.includes(next.id));
});

/* ---------------- rules ---------------- */

test("streak multiplier grows by 0.2 per answer and is capped", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 12].map(multiplierFor), [1, 1, 1.2, 1.4, 1.6, 1.8, 2, 2, 2]);
});

test("speed bonus fades from the maximum to zero over the window", () => {
  assert.equal(speedBonusFor(0, 10000), SCORING.speedBonusMax);
  assert.equal(speedBonusFor(5000, 10000), SCORING.speedBonusMax / 2);
  assert.equal(speedBonusFor(10000, 10000), 0);
  assert.equal(speedBonusFor(60000, 10000), 0);
});

test("a game has ten different countries and avoids recent ones when it can", () => {
  const random = seeded(21);
  const first = pickRounds(playable, [], random);
  assert.equal(first.length, ROUNDS_PER_GAME);
  assert.equal(new Set(first).size, ROUNDS_PER_GAME);
  const second = pickRounds(playable, first, random);
  assert.equal(second.filter(code => first.includes(code)).length, 0);

  // A small region cannot avoid repeats entirely, but still never duplicates.
  const oceania = playableCountries(countries, "Oceania");
  const recent = pickRounds(oceania, [], random);
  const next = pickRounds(oceania, recent, random);
  assert.equal(new Set(next).size, ROUNDS_PER_GAME);
  assert.equal(next.filter(code => !recent.includes(code)).length, oceania.length - ROUNDS_PER_GAME);
});

test("scoring adds base points, streak multiplier and speed bonus", () => {
  const codes = pickRounds(playable, [], seeded(2));
  const session = createSession({ mode: "map", variant: "map", region: "World", codes, speedBonus: true });
  const right = () => ({ code: currentCode(session), name: "x" });

  let result = recordAnswer(session, { picked: right(), elapsedMs: 0 });
  assert.deepEqual([result.points, result.multiplier, result.speed, result.streak], [150, 1, 50, 1]);
  advance(session);

  result = recordAnswer(session, { picked: right(), elapsedMs: 10000 });
  assert.deepEqual([result.points, result.multiplier, result.speed, result.streak], [145, 1.2, 25, 2]);
  advance(session);

  result = recordAnswer(session, { picked: { code: "XXX", name: "Nowhere" }, elapsedMs: 1000 });
  assert.deepEqual([result.correct, result.points, result.streakLost], [false, 0, true]);
  assert.equal(session.streak, 0);
  advance(session);

  result = recordAnswer(session, { picked: null, elapsedMs: 1000 });
  assert.equal(result.correct, false);
  assert.equal(result.streakLost, false);
  advance(session);

  while (!isFinished(session)) {
    recordAnswer(session, { picked: right(), elapsedMs: 999999 });
    if (!isFinished(session)) advance(session);
  }
  const summary = summarize(session);
  assert.equal(summary.total, 10);
  assert.equal(summary.correct, 8);
  assert.equal(summary.accuracy, 80);
  assert.equal(summary.bestStreak, 6);
  assert.equal(summary.missed.length, 2);
  assert.equal(summary.score, 150 + 145 + 100 + 120 + 140 + 160 + 180 + 200);
});

test("typed answers are worth more and the speed bonus can be switched off", () => {
  const codes = pickRounds(playable, [], seeded(4));
  const session = createSession({ mode: "flag", variant: "typed", region: "World", codes, speedBonus: false });
  const result = recordAnswer(session, { picked: { code: codes[0], name: "x" }, elapsedMs: 0 });
  assert.equal(result.points, SCORING.typedBase);
  assert.equal(result.speed, 0);
});

test("multiple choice offers four different countries including the answer", () => {
  const random = seeded(13);
  for (const target of playable) {
    const options = buildChoices(target, playable, random);
    assert.equal(options.length, 4);
    assert.equal(new Set(options.map(o => o.code)).size, 4);
    assert.ok(options.includes(target));
  }
  const chad = buildChoices(countries.get("TCD"), playable, random).map(o => o.code);
  assert.ok(chad.some(code => ["ROU", "AND", "MDA"].includes(code)), "lookalike flags are offered");
  const europe = playableCountries(countries, "Europe");
  const inRegion = buildChoices(countries.get("IRL"), europe, random);
  assert.ok(inRegion.every(o => o.region === "Europe"), "options respect the region filter");
});

/* ---------------- helpers ---------------- */

test("text and geometry helpers", () => {
  assert.equal(normalizeText("São Tomé & Príncipe"), "sao tome and principe");
  assert.equal(normalizeText("St. Kitts"), "saint kitts");
  assert.equal(formatList(["a", "b", "c"]), "a, b and c");
  assert.equal(withArticle("Netherlands"), "the Netherlands");
  assert.equal(withArticle("Solomon Islands", true), "The Solomon Islands");
  assert.equal(withArticle("France"), "France");
  assert.equal(withArticle("Republic of the Congo"), "the Republic of the Congo");
  assert.equal(possessive("Solomon Islands"), "Solomon Islands’");
  assert.equal(possessive("France"), "France’s");
  assert.ok(Math.abs(distanceKm([48.85, 2.35], [51.5, -0.12]) - 343) < 5);
  assert.equal(compassDirection([48.85, 2.35], [51.5, -0.12]), "north-west");

  const square = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
  const shape = describeShape(square);
  assert.deepEqual(shape.labelLatLng, [1, 1]);
  assert.deepEqual(shape.focus, [[0, 0], [2, 2]]);

  // A distant territory is left out of the zoom box; a nearby island is kept.
  const withTerritory = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 40], [10, 40], [10, 50], [0, 50], [0, 40]]],
      [[[11, 41], [12, 41], [12, 42], [11, 42], [11, 41]]],
      [[[-60, 0], [-55, 0], [-55, 5], [-60, 5], [-60, 0]]]
    ]
  };
  const focus = describeShape(withTerritory).focus;
  assert.ok(focus[0][1] >= 0 && focus[1][1] <= 12, JSON.stringify(focus));
});
