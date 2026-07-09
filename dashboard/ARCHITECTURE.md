# Diriyah Geospatial Dashboard — Architecture

A map-first, client-only geospatial dashboard for At-Turaif / Bujairi / Wadi
Hanifah, built from public OpenStreetMap geometry. No backend, no build step,
no API keys — a static site served over `http(s)`.

## 1. System architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser                                                              │
│                                                                       │
│  dashboard/index.html                                                │
│    ├─ vendor/maplibre/maplibre-gl.js   (MapLibre GL JS, BSD-3)       │
│    ├─ vendor/turf/turf.min.js          (Turf.js, MIT — spatial calc) │
│    └─ src/dashboard/main.js  (ES module, glue/bootstrap)             │
│         ├─ data.js          fetch + index data/diriyah/*.geojson     │
│         ├─ map-init.js      MapLibre Map + basemap styles            │
│         ├─ layers.js        layer registry: sources, paint, legend   │
│         ├─ interactions.js  hover tooltip + click → drawer           │
│         ├─ search.js        client-side name search                 │
│         ├─ measure.js       distance/area draw-and-measure           │
│         ├─ radius.js        radius spatial filter                    │
│         ├─ compare.js       synced dual-map split view               │
│         ├─ story.js         guided tour (flyTo + captions)           │
│         ├─ analytics.js     heatmap, buffers, land-use, walkability  │
│         ├─ share.js         URL view-state + PNG screenshot          │
│         ├─ charts.js        hand-rolled SVG donut / bar charts       │
│         ├─ i18n.js          EN/AR strings + RTL                       │
│         └─ ui.js            drawer/legend/toast DOM helpers          │
│                                                                       │
│  Basemap tiles (raster, public, key-less):                           │
│    CARTO Positron/Dark Matter · Esri World Imagery                   │
└─────────────────────────────────────────────────────────────────────┘
          ▲
          │ generated once, offline, checked into the repo
          │
  scripts/convert-map-data.mjs   src/diriyah/map-data.json (baked OSM/Overpass)
  scripts/generate-poi.mjs   →   data/diriyah/*.geojson (buildings, roads,
                                  water, green, landmarks, poi, boundary)
```

**Data flow:** the two `scripts/*.mjs` files are offline, one-shot generators
(Node, no dependencies) that turn the game's baked local-metres OSM footprints
back into geo-referenced GeoJSON. The dashboard itself never runs them — it
just `fetch()`s the resulting static `.geojson` files at `data/diriyah/` once
on load (`data.js`), then everything else is client-side rendering and
computation against that in-memory data.

There is no server component and no database. This is a deliberate choice for
a public-data civic dashboard: every number on screen is reproducible from the
checked-in GeoJSON with the formulas in `analytics.js`, and the whole thing
can be hosted on any static file host (GitHub Pages, S3, etc.).

## 2. Component breakdown

| File | Responsibility |
|---|---|
| `dashboard/index.html` / `style.css` | Page shell: top bar, layer/tools/analytics side panel with tabs, map area, drawer, story overlay, toast. |
| `src/dashboard/data.js` | Fetches the 7 GeoJSON layers; builds the flat search index; computes the study-area centroid. |
| `src/dashboard/map-init.js` | `createMap()` and the three `BASEMAPS` style objects (light/dark/satellite), each a plain raster-tile MapLibre style — no vector tile schema, no token. |
| `src/dashboard/layers.js` | `LAYER_DEFS`: one entry per thematic layer (source key, MapLibre paint, legend swatch, hover targets). `addAllLayers()` (re)builds every source/layer and is idempotent, so it's safe to call again after a basemap swap. |
| `src/dashboard/interactions.js` | Map-wide `mousemove`/`click` delegation over every hoverable layer id; builds the tooltip and the drawer HTML (landmarks pull bilingual copy from `src/diriyah/culture.js`, shared with the 3D game). |
| `src/dashboard/search.js` | Filters the flat search index client-side and flies the camera to the selected result. |
| `src/dashboard/measure.js` | Click-to-place distance/area tool; renders the in-progress geometry live and reports `turf.length`/`turf.area`. |
| `src/dashboard/radius.js` | Click-to-place radius filter; draws a `turf.circle` buffer and filters the landmark/POI layers to whatever falls inside it via `turf.booleanPointInPolygon`. |
| `src/dashboard/compare.js` | A second, camera-synced MapLibre instance clipped by a draggable divider (`clip-path: inset(...)`), for basemap/layer-preset split comparison. |
| `src/dashboard/story.js` | A curated landmark visiting order; `flyTo` + caption per stop, content again from `culture.js`. |
| `src/dashboard/analytics.js` | All analytics computation (see §4) plus the heatmap/accessibility-buffer map layers. |
| `src/dashboard/charts.js` | Two dependency-free SVG chart primitives (donut, horizontal bar) used by the analytics panel. |
| `src/dashboard/share.js` | Encodes camera + basemap + language into a URL hash; PNG export via `canvas.toBlob`. |
| `src/dashboard/i18n.js` / `ui.js` | Static EN/AR string table + RTL toggling; small DOM helpers for the drawer, legend/layer panel, and toasts. |
| `src/dashboard/main.js` | Wires all of the above to DOM events. No business logic of its own. |

## 3. Data schema & layer definitions

`data/diriyah/*.geojson` — plain `FeatureCollection`s, WGS84 lon/lat:

| File | Geometry | Key properties |
|---|---|---|
| `buildings.geojson` | Polygon | `height_m`, `category` (`landmark_scale` if ≥5.5 m, else `residential`) |
| `roads.geojson` | LineString | `kind` (`pedestrian`/`vehicular`), `width_m` |
| `water.geojson` | Polygon \| LineString | `category` (`pond` or `wadi_channel`), `width_m` on channels |
| `green.geojson` | Polygon \| LineString | `category` (`palm_grove` / `palm_grove_edge`) |
| `landmarks.geojson` | Point | `id`, `category: "heritage"`, `name_en`, `name_ar`, `tag`, `icon` |
| `poi.geojson` | Point | `id`, `category` (`hospitality`/`amenity`), `subcategory`, `name_en`, `name_ar`, `tag`, `data_quality: "approximate"` |
| `boundary.geojson` | Polygon | Convex hull of every footprint; `id`, `name_en`, `name_ar` |

`landmarks.geojson`/`poi.geojson`'s `id` is the join key back into
`src/diriyah/culture.js`'s `LANDMARKS` map for the full bilingual story shown
in the drawer.

Each thematic map layer is declared once in `layers.js` as a `LAYER_DEF`:

```js
{
  id: 'lyr-landmarks',
  group: 'heritage',                 // maps 1:1 to a legend/category section
  sourceKey: 'landmarks',            // which data/diriyah/*.geojson to bind
  defaultVisible: true,
  legend: { swatch: PALETTE.heritage, labelKey: 'layerHeritage' },
  build: (map, sourceId) => {
    map.addLayer({ id: 'lyr-landmarks-halo', type: 'circle', source: sourceId, paint: {...} });
    map.addLayer({ id: 'lyr-landmarks-point', type: 'circle', source: sourceId, paint: {...} });
  },
  hoverable: ['lyr-landmarks-point'], // which sub-layer(s) hover/click hit-test
}
```

Adding a new layer means adding one more entry to `LAYER_DEFS` (and, if it's a
new dataset, a new `.geojson` file + a line in `SOURCE_IDS`) — the legend, the
toggle checkbox, and hover/click all wire up automatically from that one
definition (see `renderLayerPanel` in `ui.js` and `addAllLayers` in
`layers.js`).

## 4. Core map initialization

`map-init.js` intentionally uses only free, key-less raster tile services —
MapLibre (unlike Mapbox GL JS) never requires an account or token even for
vector styles, but plain raster tiles keep this dashboard to zero third-party
dependencies beyond attribution:

```js
export const BASEMAPS = {
  light: {
    version: 8,
    sources: { carto: { type: 'raster', tiles: [ 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', /* b, c */ ], tileSize: 256 } },
    layers: [{ id: 'carto-light', type: 'raster', source: 'carto' }],
  },
  dark: { /* CARTO Dark Matter */ },
  satellite: { /* Esri World Imagery */ },
};

export function createMap(container, { center, zoom, basemap = 'light' }) {
  return new maplibregl.Map({ container, style: BASEMAPS[basemap], center, zoom, preserveDrawingBuffer: true });
}
```

Basemap switching calls `map.setStyle(BASEMAPS[key])`, which discards every
custom source/layer MapLibre didn't put there itself. `main.js` re-adds
everything on the map's `styledata` event (guarded to skip any firing before
the very first `load`, since a style can emit several premature `styledata`
events while still assembling):

```js
map.on('load', () => { initialLoadDone = true; addEverything(); /* … */ });
map.on('styledata', () => { if (initialLoadDone) addEverything(); });
```

`addEverything()` calls `addAllLayers`, `ensureAnalyticsLayers`,
`measureTool.ensureLayers()` and `radiusTool.ensureLayers()` — every one of
them is guarded by `getSource`/`getLayer` checks, so calling them again after
a basemap swap is a safe no-op where nothing actually changed.

## 5. Example interactive layer implementation

Click-to-drawer, generalized over every hoverable layer (`interactions.js`):

```js
map.on('click', (e) => {
  const features = map.queryRenderedFeatures(e.point, { layers: existingLayers(map) });
  if (!features.length) return;
  openDrawer(drawerHtml(features[0]));
});
```

`drawerHtml()` special-cases `category === 'heritage'` to pull the full
bilingual story from `culture.js`; every other layer falls back to a generic
card built from whatever properties that feature has (category, height,
width, an "approximate location" notice for demo POIs, and the OSM
attribution line). This is why adding a new layer to `LAYER_DEFS` gets a
working drawer for free — no per-layer drawer template needed.

## 6. Scalability & extensibility notes

- **Swapping in live data.** `data/diriyah/*.geojson` are static snapshots.
  To go live, point `data.js`'s `fetch()` calls at a live Overpass API query
  (or a Saudi open-data portal endpoint) with the same property names, or add
  a thin refresh script that re-runs the Overpass query and re-writes these
  files on a schedule. No other file needs to change.
- **Scaling past a few thousand features.** GeoJSON sources are fine at
  today's scale (≈900 features total). For a city-scale dataset, swap the
  `type: 'geojson'` sources in `layers.js` for hosted vector tiles (e.g.
  `.pmtiles` served statically, or a tile server) — the `LAYER_DEFS` paint
  definitions are unchanged, only `SOURCE_IDS`/`addAllLayers`'s source
  construction needs to point at a `{type: 'vector', tiles: [...]}` source.
- **New layer categories.** Add a `GROUP_ORDER` entry, a `PALETTE` color, and
  one or more `LAYER_DEFS` entries; the legend, toggle panel, and hover/click
  behavior all follow automatically.
- **New languages.** `i18n.js`'s `STRINGS` map takes a third locale key
  directly; `dir` controls RTL/LTR per-language, independent of which two
  exist today.
- **Analytics.** Every metric in `analytics.js` is a pure function of the
  GeoJSON in memory (Turf.js only, no server round-trip), so new metrics are
  just new pure functions plus a chart call in `main.js`'s `renderAnalytics()`
  — they inherit the same "deterministic and explainable from public geometry"
  property the brief asks for.
- **Compare mode presets.** `compare.js`'s `PRESETS` object is a flat map of
  `{ basemap, hide: [...groups] }`; new presets are one more entry.

## 7. Known assumptions & data-quality notes

- **Projection.** `src/diriyah/map-data.json` stores footprints as local
  (x, z) metres relative to `meta.lat0/lon0` from an Overpass bake script that
  isn't in this repo. `scripts/convert-map-data.mjs` assumes the standard ENU
  convention (x = east metres, z = north metres) to reproject back to WGS84;
  `meta.lat0/lon0` itself is accurately anchored on At-Turaif
  (24.7383° N, 46.5753° E), so every layer is centred correctly even if a
  future audit finds the original bake script used a rotated frame — see
  `ORIENTATION_DEG` in that script to correct it.
- **POI layer.** `data/diriyah/poi.geojson` (Bujairi Terrace dining/tourism
  points, parking, prayer rooms, etc.) is hand-curated from well-known public
  facts about the Diriyah Gate development, not a surveyed dataset — every
  feature is flagged `"data_quality": "approximate"` and surfaced as such in
  the drawer. Replace with a live Overpass `tourism=*`/`amenity=*` export over
  the same bounding box for production-grade precision.
- **Walkability score.** A simple, explainable proxy — pedestrian-path length
  inside a 300 m buffer around each landmark, divided by the buffer's area,
  normalised against a 40 km/km² reference density — not a calibrated
  walkability index. The formula is documented in `analytics.js` next to the
  code.
