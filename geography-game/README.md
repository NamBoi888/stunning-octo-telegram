# Meridian

A geography game for the browser. Find countries on an unlabelled map, or name
them from their flags. Ten rounds a game, and every round ends with a fact
about that country's borders or its flag.

It is plain HTML, CSS and JavaScript with no build step, no API keys and no
account needed anywhere. Country data, borders and flags are all bundled, so
it also works with no network connection.

## Run it

**One file, no server.** Open `meridian.html` (double-click it). Everything is
inside that file.

**From source.** Serve this folder with any static web server and open the
address it prints:

```bash
python3 -m http.server 8000     # or: npx serve .
```

`index.html` needs a server because browsers will not load JavaScript modules
or JSON straight from disk. `meridian.html` has no such limit.

## How to play

Pick a region (World, Europe, Asia, Africa, Americas or Oceania), then a mode.
You can switch mode at any time from the top bar.

| Mode | What you do |
| --- | --- |
| **Map** | The game names a country and you click it. A wrong guess turns red and is labelled, the right answer turns green, and the map travels to it. |
| **Flags, Casual** | Pick the country from four options. Lookalike flags are deliberately offered together. |
| **Flags, Hardcore** | Type the name. Autocomplete suggests countries as you type; common aliases such as "UK" or "Ivory Coast" are accepted. |

Countries too small to click at the current zoom (Monaco, Tuvalu) get a dot you
can click instead. The dots disappear as you zoom in.

Keys: `1` to `4` choose an option, `Enter` moves to the next round, `R` rerolls
the fact, and the arrow keys move through the autocomplete list.

### Scoring

| | Points |
| --- | --- |
| Correct answer | 100 (150 when typed) |
| Streak | ×1.2 for two in a row, ×1.4 for three, up to ×2 from six |
| Speed bonus (optional) | up to +50, fading to nothing over 20 s (10 s for four options) |

A wrong answer scores nothing and resets the streak. The speed bonus never
ends a round; a slow answer just earns no bonus. Best scores are kept per
mode and region in the browser.

## Trivia

Facts come in two categories and each belongs to one mode: **border facts**
appear in the map game and **flag facts** in the flag game. The two never mix.

- `data/facts.js` (split by region under `data/facts/`) holds hand-written
  facts for every country in the game: just over 1,000 in total, at least two
  border facts and two flag facts each. They are meant to be worth repeating:
  history, oddities and records, not statistics.
- `src/trivia.js` chooses what to show. The first fact for a round is drawn at
  random from the ones you have not seen this session; **Reroll Fact ↻**
  steps through the rest of that category. What you have seen is kept in
  `sessionStorage`, so a country that comes up again in a later game leads
  with a different fact.
- `src/factgen.js` is a safety net. If a country has no hand-written facts in
  a category, it writes some from the country data (neighbours, whether the
  country is landlocked, its closest neighbours across the sea, the flag's
  proportions). With the bundled data it is never needed.

To add trivia, edit the region files. The schema is:

```js
FRA: {
  border: ["One self-contained fact.", "Another."],
  flag:   ["One self-contained fact.", "Another."]
}
```

Keys are ISO 3166-1 alpha-3 codes. Run `node --test` afterwards; the tests
check that every country has facts in both categories.

## Data and what differs from a textbook setup

**Countries.** The game asks about 196 countries: 192 of the 193 UN members,
the two UN observer states (Vatican City and Palestine), Kosovo and Taiwan.
`data/countries.json` is a snapshot in the REST Countries v3.1 shape, built
from [mledoze/countries](https://github.com/mledoze/countries), the dataset
REST Countries itself is based on.

**Excluded countries.** Israel is left out of this game. It has no record,
outline, flag or trivia, it is not listed as anyone's neighbour, and that part
of the map shows only the basemap. The list lives in `EXCLUDED` at the top of
`tools/prepare-data.mjs`; change it and rerun that script to add or remove a
country. A live refresh from REST Countries cannot bring an excluded country
back.

**REST Countries is not called by default.** The v3.1 endpoint
(`restcountries.com/v3.1/all`) has been retired: it now answers with an error
message and without cross-origin headers, so a browser cannot read it and logs
a failed request. Its replacement needs an API key. The live refresh is still
fully implemented (fetch with a timeout, check that the answer really is a
country list, merge it over the bundled copy field by field) and runs when you:

- press **Check REST Countries for updates** on the start screen,
- open the page with `?live=1`, or
- set `AUTO_FETCH_LIVE_DATA = true` in `src/config.js`.

Anything other than a valid list leaves the bundled data untouched.

**Basemap.** The map draws every country outline itself, over NASA's label-free
"Earth at Night" imagery from [NASA GIBS](https://earthdata.nasa.gov/gibs),
which needs no key. CARTO's no-label basemaps are not used because they now
return tiles stamped "API key required". If the imagery cannot be loaded the
outlines are shown on a plain sea and the game plays the same. To change or
remove the basemap, edit `TILE_URL` in `src/config.js`.

**Borders.** `data/world.topo.json` is Natural Earth 1:50m, adjusted in
`tools/prepare-data.mjs` to follow UN-recognised borders where Natural Earth
shows de facto control: Crimea is part of Ukraine, Western Sahara is separate
from Morocco, and Northern Cyprus and Somaliland are part of Cyprus and
Somalia. Other disputed lines are as Natural Earth draws them and are not a
statement on any dispute. Tuvalu, missing at that scale, is added from the
1:10m set.

**Flags.** `flags/` holds one SVG per country from
[Flagpedia](https://flagpedia.net) (flagcdn.com), the same files REST Countries
links to.

## Layout

```
index.html              page shell (multi-file version)
meridian.html           generated single-file version
styles.css
build-standalone.mjs    builds meridian.html
data/
  countries.json        country snapshot (offline fallback)
  world.topo.json       boundaries, keyed by ISO alpha-3
  facts.js, facts/      hand-written trivia
flags/                  196 SVG flags
src/
  main.js               start-up and the ten-round game loop
  config.js             rounds, scoring, regions, data sources
  game.js               rules: picking countries, scoring, multiple choice
  trivia.js             which fact to show, and remembering what was shown
  factgen.js            generated facts
  countries.js          country records, live-data merge, name matching
  worldmap.js           the Leaflet map
  atlas.js, geo.js      boundaries joined to countries; geometry helpers
  assets.js, storage.js loading files; safe web storage
  ui/                   screens: start, map mode, flag mode, result card, summary, HUD
tests/logic.test.mjs    unit tests for the rules, trivia and data
tools/prepare-data.mjs  regenerates data/ and flags/
vendor/                 Leaflet, topojson-client, fonts
```

## Development

```bash
node --test                  # unit tests (no dependencies)
node build-standalone.mjs    # rebuild meridian.html after any change
```

Opening the page with `?debug` exposes the running game as `window.meridian`,
which is handy in the console and for automated browser checks.

To refresh the bundled data (only needed to pick up upstream changes):

```bash
cd tools && npm install && node prepare-data.mjs
```

## Credits

- Map engine: [Leaflet](https://leafletjs.com) (BSD-2-Clause);
  [topojson-client](https://github.com/topojson/topojson-client) (ISC).
- Boundaries: [Natural Earth](https://www.naturalearthdata.com), public domain,
  via [world-atlas](https://github.com/topojson/world-atlas).
- Country data: [mledoze/countries](https://github.com/mledoze/countries) (ODbL).
- Imagery: NASA Earth Observatory / NASA GIBS.
- Typefaces: Alegreya and Barlow (SIL Open Font License).
