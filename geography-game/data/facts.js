// Curated trivia dataset.
//
// Schema
// ------
//   FACTS[code] = {
//     border: string[],   // shown after a Map Mode round
//     flag:   string[]    // shown after a Flag Mode round
//   }
//
//   code    ISO 3166-1 alpha-3, matching `cca3` in the country data.
//   border  Facts about the country's borders, neighbours, enclaves and position.
//   flag    Facts about the flag: symbolism, history, proportions, hidden details.
//
// Each fact is one self-contained piece of plain text. It should make sense
// once the country has been named on screen, and it must not depend on any
// other fact having been read first, because the game shows them one at a
// time in a random order.
//
// Every country in the game has an entry with at least two facts in each
// category. If one is ever missing, the game falls back to facts generated
// from the country data (see src/factgen.js) for that category.
//
// Facts should be worth telling someone: a piece of history, an oddity, a
// record. Plain statistics (how many neighbours, the flag's proportions) are
// what the generator produces, and are best left out.
//
// To add or edit trivia, change the region files in data/facts/. Run
// `node --test` afterwards: the tests check codes and minimum counts.

import { EUROPE } from "./facts/europe.js";
import { ASIA } from "./facts/asia.js";
import { AFRICA } from "./facts/africa.js";
import { AMERICAS } from "./facts/americas.js";
import { OCEANIA } from "./facts/oceania.js";

export const FACTS = { ...EUROPE, ...ASIA, ...AFRICA, ...AMERICAS, ...OCEANIA };
