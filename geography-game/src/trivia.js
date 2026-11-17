// The re-rolled trivia system.
//
// Every country has a pool of facts in two categories, "border" and "flag".
// The facts are hand-written (data/facts.js). The generator in factgen.js is
// only a safety net: it supplies a category when a country has no hand-written
// facts in it at all, so a new or half-filled entry never leaves the card empty.
//
// The two categories never mix: Map Mode only ever shows border facts and
// Flag Mode only ever shows flag facts. When a round ends the game opens a
// deck of that mode's facts for the country:
//
//   - the first fact is picked at random from the ones the player has not
//     seen yet this session;
//   - "Reroll Fact" steps through the rest of the same category and wraps
//     around;
//   - everything shown is remembered in session storage, so when the same
//     country comes up in a later game it leads with something new. Once every
//     fact has been seen, the one shown longest ago comes back first.

import { generateFacts } from "./factgen.js";
import { shuffle } from "./util.js";
import { STORAGE_KEYS } from "./config.js";

const CATEGORIES = ["border", "flag"];
export const CATEGORY_FOR_MODE = { map: "border", flag: "flag" };

// curated:   the FACTS object from data/facts.js
// countries: Map of country objects by code
// store:     a storage wrapper with get/set (see storage.js)
export function createTrivia({ curated, countries, store, random = Math.random }) {
  const cache = new Map();

  // All facts for one country: the hand-written ones, or generated ones for
  // a category that has none.
  function factsFor(code) {
    if (!cache.has(code)) {
      const country = countries.get(code);
      const pool = {};
      let generated = null;
      for (const category of CATEGORIES) {
        const written = (curated[code]?.[category] ?? []).map((text, index) => ({
          id: `${category}:${index}`,
          text,
          category,
          source: "curated"
        }));
        if (written.length || !country) {
          pool[category] = written;
          continue;
        }
        generated ??= generateFacts(country, countries);
        pool[category] = generated[category].map(fact => ({
          id: `${category}:auto:${fact.id}`,
          text: fact.text,
          category,
          source: "generated"
        }));
      }
      cache.set(code, pool);
    }
    return cache.get(code);
  }

  // Seen ids per country, oldest first.
  const readSeen = () => store.get(STORAGE_KEYS.seenFacts, {});

  function markSeen(code, id) {
    const seen = readSeen();
    seen[code] = [...(seen[code] ?? []).filter(other => other !== id), id];
    store.set(STORAGE_KEYS.seenFacts, seen);
  }

  // Unseen facts first, then everything already seen, starting with whatever
  // was shown longest ago. Hand-written facts are shuffled; generated ones
  // keep the generator's order, which puts the most distinctive first.
  function order(facts, seenIds) {
    const unseen = facts.filter(fact => !seenIds.includes(fact.id));
    const seen = facts
      .filter(fact => seenIds.includes(fact.id))
      .sort((a, b) => seenIds.indexOf(a.id) - seenIds.indexOf(b.id));
    return [
      ...shuffle(unseen.filter(fact => fact.source === "curated"), random),
      ...unseen.filter(fact => fact.source === "generated"),
      ...seen
    ];
  }

  // Opens the fact deck for a finished round and returns it with the first
  // fact already marked as seen. `deck.current` is the fact to display.
  //   mode: "map" (border facts) or "flag" (flag facts)
  function open(code, mode) {
    const category = CATEGORY_FOR_MODE[mode];
    const seenIds = readSeen()[code] ?? [];
    const facts = order(factsFor(code)[category], seenIds);
    const deck = {
      code,
      facts,
      index: 0,
      get current() {
        return this.facts[this.index] ?? null;
      },
      get total() {
        return this.facts.length;
      }
    };
    if (deck.current) markSeen(code, deck.current.id);
    return deck;
  }

  // Moves the deck on to the next fact for the same country and returns it.
  function reroll(deck) {
    if (deck.total > 1) {
      deck.index = (deck.index + 1) % deck.total;
      markSeen(deck.code, deck.current.id);
    }
    return deck.current;
  }

  // Forget cached facts, for when country names have been refreshed.
  const clear = () => cache.clear();

  return { factsFor, open, reroll, clear };
}
