// convert-map-data.mjs — projects the game's baked local-metres OSM footprints
// (src/diriyah/map-data.json) back into real WGS84 GeoJSON for the geospatial
// dashboard.
//
// map-data.json stores every footprint as (x, z) metres on a local tangent
// plane centred on meta.lat0/lon0. The original Overpass bake script (not
// checked into this repo) is lost, so the axis convention has to be assumed;
// we use the standard local ENU convention (x = east metres, z = north
// metres), which is what every common lon/lat -> local-metres converter
// (mapbox's `@mapbox/tiny-sdf`-adjacent scripts, turf, geodesy libs) produces
// by default. meta.lat0/lon0 (24.7383 N, 46.5753 E) is itself real and
// precisely anchored on At-Turaif, so this reprojection keeps every
// building/road/wadi footprint geographically consistent and centred on the
// correct real-world location even if a future audit finds the bake script
// used a rotated frame (see ORIENTATION_DEG below to correct that).
//
// Run: node scripts/convert-map-data.mjs

import fs from 'fs';
import path from 'path';

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, 'src/diriyah/map-data.json'), 'utf8'));
const outDir = path.join(root, 'data/diriyah');
fs.mkdirSync(outDir, { recursive: true });

const { lat0, lon0 } = data.meta;

// If ground-truth survey ever reveals the bake script's frame was rotated
// relative to true north, adjust this and every layer re-projects correctly.
const ORIENTATION_DEG = 0;

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos(lat0 * DEG);
const rot = ORIENTATION_DEG * DEG;
const cosR = Math.cos(rot);
const sinR = Math.sin(rot);

// local (x east metres, z north metres) -> [lon, lat]
function toLonLat([x, z]) {
  const xr = x * cosR - z * sinR;
  const zr = x * sinR + z * cosR;
  const lon = lon0 + xr / M_PER_DEG_LON;
  const lat = lat0 + zr / M_PER_DEG_LAT;
  return [round(lon, 7), round(lat, 7)];
}

function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function ring(points) {
  const r = points.map(toLonLat);
  const [fx, fy] = r[0];
  const [lx, ly] = r[r.length - 1];
  if (fx !== lx || fy !== ly) r.push([fx, fy]);
  return r;
}

function fc(features) {
  return { type: 'FeatureCollection', features };
}

function feature(geometry, properties) {
  return { type: 'Feature', properties, geometry };
}

// ---- buildings -------------------------------------------------------
const buildings = fc(
  data.buildings.map((b, i) =>
    feature(
      { type: 'Polygon', coordinates: [ring(b.p)] },
      { id: `bld-${i}`, height_m: b.h, category: b.h >= 5.5 ? 'landmark_scale' : 'residential' },
    ),
  ),
);

// ---- roads -------------------------------------------------------------
const KIND_LABEL = { ped: 'pedestrian', veh: 'vehicular', road: 'vehicular' };
const roads = fc(
  data.roads.map((r, i) =>
    feature(
      { type: 'LineString', coordinates: r.l.map(toLonLat) },
      { id: `road-${i}`, kind: KIND_LABEL[r.k] || r.k || 'vehicular', width_m: r.w },
    ),
  ),
);

// ---- water (Wadi Hanifah) ------------------------------------------------
// Baked as a mix of filled ponds (`p`) and the wadi's stroked channel
// centreline (`l` + width `w`) — keep each in its native geometry type.
const water = fc(
  data.water.map((w, i) =>
    w.p
      ? feature({ type: 'Polygon', coordinates: [ring(w.p)] }, { id: `water-${i}`, category: 'pond' })
      : feature(
          { type: 'LineString', coordinates: w.l.map(toLonLat) },
          { id: `water-${i}`, category: 'wadi_channel', width_m: w.w },
        ),
  ),
);

// ---- green (palm groves / farmland) -------------------------------------
const green = fc(
  data.green.map((g, i) =>
    g.p
      ? feature({ type: 'Polygon', coordinates: [ring(g.p)] }, { id: `green-${i}`, category: 'palm_grove' })
      : feature(
          { type: 'LineString', coordinates: g.l.map(toLonLat) },
          { id: `green-${i}`, category: 'palm_grove_edge', width_m: g.w },
        ),
  ),
);

// ---- landmarks -----------------------------------------------------------
// Bilingual names/tags mirror src/diriyah/culture.js so the dashboard's
// drawer and the 3D game tell the same curated story from one source of truth.
const LANDMARK_META = {
  turaif: { en: 'At-Turaif District', ar: 'حي الطريف', tag: 'UNESCO World Heritage Site', icon: '\u{1F3DB}️' },
  salwa: { en: 'Salwa Palace', ar: 'قصر سلوى', tag: 'Seat of the Imams', icon: '\u{1F451}' },
  mosque: { en: 'Historic Mosque', ar: 'مسجد الطريف', tag: 'Mosque of At-Turaif', icon: '\u{1F54C}' },
  palace: { en: 'Thunayan bin Saud Palace', ar: 'قصر ثنيان بن سعود', tag: 'Najdi residence', icon: '\u{1F3F0}' },
  horse: { en: 'Arabian Horse Museum', ar: 'متحف الخيل العربي', tag: 'Heritage of the Najdi horse', icon: '\u{1F40E}' },
  treasury: { en: 'Trade & Treasury Museum', ar: 'متحف التجارة والمال', tag: "Diriyah's caravan economy", icon: '⚖️' },
  moudhi: { en: 'Moudhi Endowment', ar: 'وقف موضي', tag: 'Charitable waqf', icon: '\u{1F4DC}' },
  visitor: { en: 'Visitor Centre', ar: 'مركز الزوار', tag: 'Gateway to At-Turaif', icon: 'ℹ️' },
};

const landmarks = fc(
  data.landmarks.map((l) => {
    const meta = LANDMARK_META[l.key] || { en: l.n, ar: l.ar || l.n, tag: '', icon: '\u{1F4CD}' };
    return feature(
      { type: 'Point', coordinates: toLonLat(l.at) },
      { id: l.key, category: 'heritage', name_en: meta.en, name_ar: meta.ar, tag: meta.tag, icon: meta.icon },
    );
  }),
);

// ---- study-area boundary (convex hull of every footprint) ---------------
function crossZ(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function convexHull(points) {
  const pts = [...new Map(points.map((p) => [p.join(','), p])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

const allLocalPoints = [
  ...data.buildings.flatMap((b) => b.p),
  ...data.water.flatMap((w) => w.p || w.l),
  ...data.green.flatMap((g) => g.p || g.l),
];
const hull = convexHull(allLocalPoints).map(toLonLat);
hull.push(hull[0]);
const boundary = fc([
  feature(
    { type: 'Polygon', coordinates: [hull] },
    { id: 'diriyah-at-turaif-study-area', name_en: 'At-Turaif / Diriyah study area', name_ar: 'منطقة الدراسة – حي الطريف بالدرعية' },
  ),
]);

const files = { buildings, roads, water, green, landmarks, boundary };
for (const [name, geo] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, `${name}.geojson`), JSON.stringify(geo));
  console.log(`wrote data/diriyah/${name}.geojson (${geo.features.length} features)`);
}
