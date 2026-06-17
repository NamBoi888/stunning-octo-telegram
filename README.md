# Diriyah Explorer — مستكشف الدرعية 🏛️🌴

A fun, cartoony 3D exploration game set in the **historic At-Turaif district of
Diriyah (الدرعية)** — the mud-brick birthplace of the first Saudi State and a
UNESCO World Heritage Site on the banks of Wadi Hanifah.

The entire town you walk through is generated from **real
[OpenStreetMap](https://www.openstreetmap.org/) data** — its 535 building
footprints, streets, the wadi, and palm groves — then rebuilt in a warm,
low-poly Najdi style: sun-baked ochre walls crowned with the region's iconic
triangular crenellations. Built with [Three.js](https://threejs.org/), no build
step and no dependencies to install.

## Play with zero setup (no install, no terminal)

Just open **[`Diriyah-Game.html`](Diriyah-Game.html)** by double-clicking it — the
whole game, the 3D engine, and the map are bundled into that one file, so it runs
straight from your hard drive in any modern browser. Nothing to install.

To regenerate that file after changing the game: `node scripts/build-offline.mjs`

## Run it with a server (for development)

Any static file server works. From the repo root:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL (e.g. http://localhost:8000) in a browser. Three.js is
vendored locally, so no internet connection is required to play.

## How to play

You play a young explorer in a thobe and red-checked ghutra, wandering the
restored alleys of old Diriyah.

- **Move** with `WASD` / arrow keys — or drag the on-screen joystick on touch.
- **Look** by dragging to orbit the camera; **scroll** to zoom.
- **Find the golden beacons** 🔆 hovering over the landmarks. Walk up to one to
  uncover its real story — a bilingual (Arabic + English) culture card with the
  history of the site and a "did you know" fact.
- **Collect golden dates** (تمر 🌴) scattered through the streets.
- **Climb to the rooftops.** Najdi families climbed palm-wood ladders to the
  rooftop terrace (السطح) to dry dates and sleep under the stars. Stand at a
  ladder and press **Space** (or **E**) to climb up — and again at the top to
  climb down. Walk across the roofs and **raise the heritage banners** (الرايات 🏴),
  and grab the bonus trays of **drying dates** up there.
- The **compass** (top-right) always points to the nearest site you haven't
  discovered yet, with its distance.

Look out for the ambient life too: **camels** resting by the wadi, **falcons**
circling overhead (falconry is deep Najdi heritage), and a little **souq** of
market stalls.

**Goal:** discover all **8 landmarks** *and* raise all **5 rooftop banners** to
complete your journey through the birthplace of the nation.

## The landmarks — معالم الطريف

Each is a real place pulled from the map, with curated cultural content:

| Site | الاسم | What it is |
|------|-------|------------|
| At-Turaif District | حي الطريف | The UNESCO-listed mud-brick royal quarter |
| Salwa Palace | قصر سلوى | Seat of the ruling Al Saud imams |
| Historic Mosque | مسجد الطريف | Centre of community and learning |
| Thunayan bin Saud Palace | قصر ثنيان بن سعود | A historic Najdi family residence |
| Arabian Horse Museum | متحف الخيل العربي | Heritage of the Najdi horse |
| Trade & Treasury Museum | متحف التجارة والمال | Diriyah's caravan economy |
| Moudhi Endowment | وقف موضي | A charitable *waqf* |
| Visitor Centre | مركز الزوار | Gateway to today's Diriyah |

## How the city is built

`src/diriyah/map-data.json` is baked from a live
[Overpass API](https://overpass-api.de/) query over the Diriyah / At-Turaif
bounding box. Latitude/longitude are projected to local metres, building
footprints are extruded into mud-brick prisms, roads and the Wadi Hanifah become
ground ribbons, farmland and orchards become palm groves, and the named historic
buildings are tagged as landmarks. Everything is merged or instanced so the whole
town renders in a handful of draw calls.

- `index.html` — HUD, culture cards, intro veil, touch joystick.
- `src/diriyah/map.js` — turns OSM footprints into the 3D city (buildings,
  crenellations, water, palms, markers, collision grid).
- `src/diriyah/player.js` — the cartoony Najdi explorer and movement.
- `src/diriyah/culture.js` — all the bilingual landmark history and facts.
- `src/diriyah/game.js` — scene, lighting, input, collectibles, audio, loop.

Edit `src/diriyah/culture.js` to change any of the stories, or re-run the
Overpass query for a different bounding box to explore another town.

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors (ODbL).
- Rendering by [Three.js](https://threejs.org/) (MIT), vendored under `vendor/`.
