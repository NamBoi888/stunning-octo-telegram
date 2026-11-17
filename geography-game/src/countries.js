// Country data: turns REST Countries-shaped records into the objects the game
// uses, merges a live response over the bundled copy, and matches typed names.
// Everything here is pure, so it runs in tests without a browser.

import { EXTRA_PLAYABLE } from "./config.js";
import { formatList, normalizeText } from "./util.js";

// Names people type that differ from the dataset's common name.
const ALIASES = {
  ARE: ["UAE", "Emirates"],
  BHS: ["The Bahamas"],
  BIH: ["Bosnia", "Bosnia-Herzegovina"],
  CAF: ["CAR"],
  CIV: ["Côte d'Ivoire", "Cote d'Ivoire"],
  COD: ["Democratic Republic of the Congo", "DRC", "Congo-Kinshasa", "Congo Kinshasa", "Zaire"],
  COG: ["Congo", "Congo-Brazzaville", "Congo Brazzaville", "Congo Republic"],
  CPV: ["Cabo Verde"],
  CZE: ["Czech Republic"],
  FSM: ["Federated States of Micronesia"],
  GBR: ["UK", "Great Britain", "Britain"],
  GMB: ["The Gambia"],
  KOR: ["Korea", "Republic of Korea"],
  LAO: ["Lao"],
  MKD: ["Macedonia"],
  MMR: ["Burma"],
  NLD: ["Holland", "The Netherlands"],
  PRK: ["DPRK"],
  PSE: ["Palestinian Territories", "State of Palestine"],
  RUS: ["Russian Federation"],
  STP: ["Sao Tome"],
  SWZ: ["Swaziland"],
  SYR: ["Syrian Arab Republic"],
  TLS: ["East Timor"],
  TTO: ["Trinidad"],
  TUR: ["Turkey", "Turkiye"],
  TWN: ["Republic of China", "Chinese Taipei"],
  USA: ["USA", "US", "United States of America", "America"],
  VAT: ["Vatican", "Holy See", "The Vatican"],
  VCT: ["St Vincent"],
  KNA: ["St Kitts"],
  ATG: ["Antigua"]
};

function toCountry(record) {
  const code = record.cca3;
  const names = [record.name.common, record.name.official, ...(ALIASES[code] ?? [])];
  return {
    code,
    cca2: record.cca2,
    name: record.name.common,
    official: record.name.official,
    capitals: record.capital ?? [],
    capital: formatList(record.capital ?? []),
    region: record.region,
    subregion: record.subregion ?? record.region,
    latlng: record.latlng,
    landlocked: Boolean(record.landlocked),
    borders: record.borders ?? [],
    area: record.area ?? 0,
    // Codes of the closest places that are not land neighbours (bundled data only).
    nearest: record.nearest ?? [],
    playable: Boolean(record.flags?.svg) && (record.unMember === true || EXTRA_PLAYABLE.includes(code)),
    // `src` is what the game shows; `fallback` is tried if that fails to load.
    flag: record.flags?.svg ? { src: record.flags.svg, fallback: null, ratio: record.flags.ratio ?? null } : null,
    searchKeys: [...new Set(names.map(normalizeText))]
  };
}

// raw: array of REST Countries v3.1-shaped records (the bundled snapshot).
export function buildCountries(raw) {
  const byCode = new Map();
  for (const record of raw) byCode.set(record.cca3, toCountry(record));
  return byCode;
}

// A live response is only trusted if it really is a country list. The retired
// v3.1 endpoint answers 200 with an error object, which must not pass.
export function isCountryList(data) {
  return (
    Array.isArray(data) &&
    data.length >= 150 &&
    data.every(item => typeof item?.cca3 === "string" && typeof item?.name?.common === "string")
  );
}

// Overlays live metadata on the bundled countries, field by field, keeping the
// bundled value wherever the live one is missing or malformed. Returns how
// many countries were refreshed.
export function mergeLiveData(countries, live) {
  let merged = 0;
  for (const item of live) {
    const country = countries.get(item.cca3);
    if (!country) continue;
    country.name = item.name.common;
    if (typeof item.name.official === "string") country.official = item.name.official;
    if (Array.isArray(item.capital) && item.capital.length) {
      country.capitals = item.capital;
      country.capital = formatList(item.capital);
    }
    if (typeof item.region === "string" && item.region) country.region = item.region;
    // Only neighbours the game knows about: a live list may name countries
    // that are not part of this game's data.
    if (Array.isArray(item.borders)) country.borders = item.borders.filter(code => countries.has(code));
    if (Array.isArray(item.latlng) && item.latlng.length === 2 && item.latlng.every(Number.isFinite)) {
      country.latlng = item.latlng;
    }
    if (country.flag && typeof item.flags?.svg === "string" && /^https:\/\//.test(item.flags.svg)) {
      if (!country.flag.fallback) country.flag.fallback = country.flag.src;
      country.flag.src = item.flags.svg;
    }
    country.searchKeys = [...new Set([normalizeText(country.name), ...country.searchKeys, normalizeText(country.official)])];
    merged++;
  }
  return merged;
}

export function playableCountries(countries, regionId = "World") {
  return [...countries.values()].filter(
    country => country.playable && (regionId === "World" || country.region === regionId)
  );
}

// Exact match of a typed answer against names and aliases, ignoring case,
// accents and punctuation. Returns the country or null.
export function matchCountry(input, list) {
  const key = normalizeText(input);
  if (!key) return null;
  return list.find(country => country.searchKeys.includes(key)) ?? null;
}

// Autocomplete: best matches first (name starts with the text, then a word in
// the name does, then an alias, then anywhere in the name).
export function suggestCountries(input, list, limit = 6) {
  const key = normalizeText(input);
  if (!key) return [];
  const ranked = [];
  for (const country of list) {
    const [name, ...others] = country.searchKeys;
    let rank = -1;
    if (name.startsWith(key)) rank = 0;
    else if (name.split(" ").some(word => word.startsWith(key))) rank = 1;
    else if (others.some(other => other.startsWith(key))) rank = 2;
    else if (key.length >= 3 && name.includes(key)) rank = 3;
    if (rank >= 0) ranked.push({ country, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name));
  return ranked.slice(0, limit).map(entry => entry.country);
}
