// Tunable constants for the whole game.

export const ROUNDS_PER_GAME = 10;

// Country metadata. The game always starts from the bundled copy and can
// refresh it from REST Countries. Anything other than a valid country list
// (timeout, offline, error payload) leaves the bundled copy in place.
//
// The v3.1 endpoint below was retired by its operator: it now answers with an
// error message and no cross-origin headers, so browsers log a failed request
// every time it is called. For that reason the refresh does not run by itself.
// It runs when the player asks for it on the start screen, when the page is
// opened with ?live=1, or on every load if AUTO_FETCH_LIVE_DATA is set to true.
export const REST_COUNTRIES_URL =
  "https://restcountries.com/v3.1/all?fields=name,cca2,cca3,flags,region,borders,capital,latlng";
export const AUTO_FETCH_LIVE_DATA = false;
export const LIVE_DATA_TIMEOUT_MS = 4000;
export const LOCAL_COUNTRIES_PATH = "data/countries.json";
export const LOCAL_BOUNDARIES_PATH = "data/world.topo.json";

// Countries the game asks about: UN member states plus these four.
export const EXTRA_PLAYABLE = ["VAT", "PSE", "UNK", "TWN"];

// Label-free basemap, so the map never gives the answer away, and no API key.
//
// This is NASA's "Earth at night" composite, served openly by NASA GIBS. It is
// used instead of CARTO's no-label basemaps, which now return tiles stamped
// "API key required". The imagery stops at zoom level 8; Leaflet stretches it
// beyond that. The game does not depend on it: if tiles cannot be loaded the
// country outlines are drawn on a plain sea. Set TILE_URL to "" to always
// play that way.
export const TILE_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg";
export const TILE_MAX_NATIVE_ZOOM = 8;
export const TILE_ATTRIBUTION =
  'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>, Earth at Night. ' +
  'Borders: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>';

// `bounds` is [[south, west], [north, east]]; `centre` is [longitude, latitude]
// and is where the globe on the start screen turns to face.
export const REGIONS = [
  { id: "World", label: "World", bounds: [[-56, -168], [74, 180]], centre: null },
  { id: "Europe", label: "Europe", bounds: [[34, -25], [71, 45]], centre: [14, 50] },
  { id: "Asia", label: "Asia", bounds: [[-11, 26], [56, 146]], centre: [90, 32] },
  { id: "Africa", label: "Africa", bounds: [[-36, -19], [38, 52]], centre: [18, 3] },
  { id: "Americas", label: "Americas", bounds: [[-56, -128], [60, -34]], centre: [-80, 12] },
  { id: "Oceania", label: "Oceania", bounds: [[-48, 110], [22, 180]], centre: [152, -16] }
];

export const SCORING = {
  base: 100,
  typedBase: 150,          // typing the name is harder than picking from four
  streakStep: 0.2,         // each extra correct answer in a row adds this much
  maxMultiplier: 2,
  speedBonusMax: 50,
  speedWindowMs: { map: 20000, choices: 10000, typed: 20000 }
};

export const STORAGE_KEYS = {
  settings: "meridian.settings",
  best: "meridian.best",
  seenFacts: "meridian.seenFacts",
  recent: "meridian.recentCountries"
};
