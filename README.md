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

### Superpowers from Arabian folklore

Three folk-powers are bound to keys (or tap the buttons on the right — they have
cooldowns):

| Power | الاسم | Key | What it does |
|-------|-------|-----|--------------|
| 🧞 Flying carpet | بساط الريح | **F** | Summon a magic carpet and glide up over the rooftops (press again to land) |
| 🦅 Falcon's leap | وثبة الصقر | **J** | A high jump to hop walls and gaps |
| 🌀 Jinn whirlwind | زوبعة الجن | **K** | A whirlwind dash — a burst of speed in a swirl of dust |

### A living town

The map is full of life: **camels** resting by the wadi, **goats** milling about,
**villagers** strolling the alleys, **falcons** circling, glowing **jinn wisps**
(جن) haunting quiet corners, the colossal **Roc** (الرخ) from the tales of Sindbad
crossing the sky, drifting clouds, a little **souq** of market stalls, and the
shimmering Wadi Hanifah.

**Goal:** discover all **8 landmarks** *and* raise all **5 rooftop banners** to
complete your journey through the birthplace of the nation.

## Plays on phones too 📱

The game is fully touch-enabled and responsive: a left-thumb **joystick**, a big
**climb** button, tappable **power** buttons, drag anywhere to rotate the camera,
and pinch to zoom. It also drops the render resolution, shadow quality and prop
density on phones to keep things smooth.

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

---

# Diriyah Geospatial Dashboard

Alongside the game, `dashboard/` is a browser-based **geospatial analytics
dashboard** for the same At-Turaif / Bujairi / Wadi Hanifah area — a 2D
map-first tool for planners, researchers and the public, built entirely from
public OpenStreetMap geometry plus free, key-less public basemaps (CARTO
Positron/Dark Matter, Esri World Imagery).

## Run it

Any static file server works (the dashboard uses ES modules and `fetch()`,
which need `http(s)://`, not `file://`):

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000/dashboard/`.

## What's in it

- Six toggleable layer categories with a legend: Heritage & Culture,
  Environment & Wadi, Urban Fabric, Transportation & Mobility, Hospitality &
  Tourism, Public Amenities — plus a Study Area Boundary reference layer.
- Light / dark / satellite basemaps, hover tooltips, a click-to-expand info
  drawer (landmark entries reuse the same bilingual stories as the game, from
  `src/diriyah/culture.js`), search, a distance-radius spatial filter,
  distance/area measurement, a split-view layer/basemap comparison mode, a
  guided tour, screenshot export, and a shareable URL view-state.
- An analytics panel: a POI density heatmap, a land-use donut (built vs. green
  vs. water vs. open) with the green:built ratio, a walkability approximation
  per landmark, and 400 m walkable-accessibility buffers around every
  landmark — all computed client-side and deterministically from the public
  geometry with [Turf.js](https://turfjs.org/).
- Arabic / English UI toggle with full RTL layout mirroring.

Full write-up — architecture, component breakdown, data schema, and
extensibility notes — is in [`dashboard/ARCHITECTURE.md`](dashboard/ARCHITECTURE.md).

## Regenerating the data

The dashboard's GeoJSON layers (`data/diriyah/*.geojson`) are derived from the
same baked `src/diriyah/map-data.json` the game uses:

```bash
node scripts/convert-map-data.mjs   # buildings, roads, water, green, landmarks, boundary
node scripts/generate-poi.mjs       # curated hospitality/amenity points
```
