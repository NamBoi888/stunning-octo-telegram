#!/usr/bin/env node
// Regenerates the data the game ships with:
//
//   data/countries.json   REST Countries v3.1-shaped snapshot (offline fallback)
//   data/world.topo.json  country boundaries, keyed by ISO 3166-1 alpha-3
//   flags/xx.svg          one flag per playable country
//
// You only need this if you want to refresh the bundled data. The game itself
// has no build step and no dependencies.
//
//   cd tools && npm install && node prepare-data.mjs [--refresh-flags]
//
// Sources: mledoze/countries (the dataset REST Countries was built on),
// Natural Earth 1:50m via world-atlas, and flagcdn.com for the SVG flags.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as topoClient from "topojson-client";
import * as topoServer from "topojson-server";
import polygonClipping from "polygon-clipping";
import { describeShape } from "../src/geo.js";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const refreshFlags = process.argv.includes("--refresh-flags");

// Countries the game asks about: UN members, the two UN observer states, and
// two widely recognised states that have their own outline and flag.
const EXTRA_PLAYABLE = new Set(["VAT", "PSE", "UNK", "TWN"]);

const source = require("world-countries/countries.json");
const byNumeric = new Map(source.filter(c => c.ccn3).map(c => [c.ccn3, c]));
const isPlayable = c => c.unMember || EXTRA_PLAYABLE.has(c.cca3);

/* ------------------------------------------------------------------ */
/* Boundaries                                                          */
/* ------------------------------------------------------------------ */

const asPolygons = geometry =>
  geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

const bboxOf = polygon => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0]) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
};

function loadFeatures(file) {
  const topology = require(file);
  return topoClient.feature(topology, topology.objects.countries).features;
}

// The upstream outlines are stitched for globes: a shape that crosses the 180°
// meridian (Russia, Fiji, Wrangel Island) is one ring whose longitudes jump from
// +180 to -180. Drawn on a flat map that jump becomes a line across the whole
// world, so each such ring is cut into an eastern and a western piece here.
function cutAtAntimeridian(polygon) {
  const pieces = polygon.map(cutRing);
  const outers = pieces[0];
  if (outers.length === 1 && pieces.every(piece => piece.length === 1)) return [polygon];
  // Keep any holes with the piece of the outline they sit in.
  const result = outers.map(outer => [outer]);
  for (const holes of pieces.slice(1)) {
    for (const hole of holes) {
      const home = result.find(([outer]) => Math.sign(outer[1][0]) === Math.sign(hole[1][0])) ?? result[0];
      home.push(hole);
    }
  }
  return result;
}

function cutRing(ring) {
  const points = ring.slice(0, -1);
  const count = points.length;
  const at = index => points[((index % count) + count) % count];
  const crossings = [];
  for (let i = 0; i < count; i++) if (Math.abs(at(i + 1)[0] - at(i)[0]) > 180) crossings.push(i);
  if (!crossings.length) return [ring];

  // Latitude at which the edge a -> b meets the meridian.
  const crossingLatitude = (a, b) => {
    const meridian = a[0] > 0 ? 180 : -180;
    const unwrapped = b[0] + (a[0] > 0 ? 360 : -360);
    const run = unwrapped - a[0];
    return run ? a[1] + ((meridian - a[0]) / run) * (b[1] - a[1]) : a[1];
  };

  // One chain per stretch between crossings; each starts and ends on the meridian.
  const chains = crossings.map((startEdge, c) => {
    const endEdge = crossings[(c + 1) % crossings.length];
    const side = at(startEdge + 1)[0] > 0 ? 1 : -1;
    const chain = [[side * 180, crossingLatitude(at(startEdge), at(startEdge + 1))]];
    for (let i = startEdge + 1; ; i++) {
      chain.push(at(i));
      if (((i % count) + count) % count === endEdge) break;
    }
    chain.push([side * 180, crossingLatitude(at(endEdge), at(endEdge + 1))]);
    return { side, points: chain, used: false };
  });

  // Along the meridian, crossing points pair up from south to north: between
  // each pair the meridian runs through the inside of the shape. Following
  // those links from chain to chain rebuilds closed rings on each side.
  const rings = [];
  for (const side of [1, -1]) {
    const mine = chains.filter(chain => chain.side === side);
    const ends = mine
      .flatMap(chain => [
        { chain, isStart: true, lat: chain.points[0][1] },
        { chain, isStart: false, lat: chain.points[chain.points.length - 1][1] }
      ])
      .sort((a, b) => a.lat - b.lat);
    const partnerOf = end => ends[ends.indexOf(end) ^ 1];
    for (const first of mine) {
      if (first.used) continue;
      const outline = [];
      let chain = first;
      while (chain && !chain.used) {
        chain.used = true;
        outline.push(...chain.points);
        const next = partnerOf(ends.find(end => end.chain === chain && !end.isStart));
        chain = next?.isStart ? next.chain : null;
      }
      outline.push(outline[0]);
      if (outline.length >= 4) rings.push(outline);
    }
  }
  return rings;
}

// shapes: key -> { id (alpha-3 or null), name (only for shapes without a code), polygons }
const shapes = new Map();
const addPolygons = (key, polygons, name) => {
  if (!shapes.has(key)) shapes.set(key, { id: name ? null : key, name, polygons: [] });
  shapes.get(key).polygons.push(...polygons);
};

// Antarctica wraps the pole and is only ever drawn on the globe, so it is left stitched.
const flatPolygons = feature =>
  feature.id === "010" ? asPolygons(feature.geometry) : asPolygons(feature.geometry).flatMap(cutAtAntimeridian);

for (const feature of loadFeatures("world-atlas/countries-50m.json")) {
  const polygons = flatPolygons(feature);
  const label = feature.properties.name;
  switch (label) {
    // Natural Earth draws these de facto entities separately; the game follows
    // the UN-recognised states, so they are folded into Cyprus and Somalia.
    case "N. Cyprus": addPolygons("CYP", polygons); break;
    case "Somaliland": addPolygons("SOM", polygons); break;
    case "Kosovo": addPolygons("UNK", polygons); break;
    // Uninhabited Australian external territory that shares Australia's numeric code.
    case "Ashmore and Cartier Is.": addPolygons("AUS", polygons); break;
    // Christmas Island and the Cocos (Keeling) Islands are lumped together upstream.
    case "Indian Ocean Ter.":
      for (const polygon of polygons) addPolygons(bboxOf(polygon)[0] > 100 ? "CXR" : "CCK", [polygon]);
      break;
    case "Siachen Glacier": addPolygons("x-siachen", polygons, "Siachen Glacier"); break;
    default: {
      const country = byNumeric.get(feature.id);
      if (!country) throw new Error(`No ISO match for boundary "${label}" (${feature.id})`);
      addPolygons(country.cca3, polygons);
    }
  }
}

// Tuvalu is too small to appear at 1:50m, so borrow it from the 1:10m set.
const tuvalu = loadFeatures("world-atlas/countries-10m.json").find(f => f.id === "798");
addPolygons("TUV", flatPolygons(tuvalu));

// Tokelau is drawn as part of New Zealand upstream; give it its own shape so
// New Zealand is just New Zealand.
{
  const newZealand = shapes.get("NZL").polygons;
  const tokelau = newZealand.filter(polygon => bboxOf(polygon)[3] > -15);
  if (!tokelau.length) throw new Error("Could not locate Tokelau in the New Zealand shape");
  shapes.get("NZL").polygons = newZealand.filter(polygon => !tokelau.includes(polygon));
  addPolygons("TKL", tokelau);
}

// Crimea: Natural Earth assigns it to Russia (de facto control). Move it back to
// Ukraine, matching UN General Assembly resolution 68/262 and the border lists
// in the country data.
{
  const russia = shapes.get("RUS").polygons;
  const index = russia.findIndex(polygon => {
    const [minX, minY, maxX, maxY] = bboxOf(polygon);
    return minX > 32 && maxX < 37 && minY > 44 && maxY < 46.5;
  });
  if (index === -1) throw new Error("Could not locate Crimea in the Russia shape");
  const [crimea] = russia.splice(index, 1);
  shapes.get("UKR").polygons.push(crimea);
}

// Western Sahara: Natural Earth gives the Moroccan-administered part to Morocco.
// Restore the UN-map boundary along 27°40'N.
{
  const south = [[[[-18, 20], [-8, 20], [-8, 27 + 2 / 3], [-18, 27 + 2 / 3], [-18, 20]]]];
  const morocco = shapes.get("MAR").polygons;
  const moved = polygonClipping.intersection(morocco, south);
  if (!moved.length) throw new Error("Western Sahara clip removed nothing");
  shapes.get("MAR").polygons = polygonClipping.difference(morocco, south);
  shapes.get("ESH").polygons.push(...moved);
}

// Dissolve the internal lines left behind by the merges above.
for (const key of ["CYP", "SOM", "UKR", "ESH"]) {
  const shape = shapes.get(key);
  shape.polygons = polygonClipping.union(...shape.polygons.map(polygon => [polygon]));
}

const collection = {
  type: "FeatureCollection",
  features: [...shapes.values()].map(shape => ({
    type: "Feature",
    id: shape.id ?? undefined,
    properties: shape.name ? { name: shape.name } : {},
    geometry: shape.polygons.length === 1
      ? { type: "Polygon", coordinates: shape.polygons[0] }
      : { type: "MultiPolygon", coordinates: shape.polygons }
  }))
};

for (const shape of shapes.values()) {
  if (shape.id === "ATA") continue;
  for (const polygon of shape.polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) throw new Error(`${shape.id ?? shape.name} still crosses the antimeridian`);
      }
    }
  }
}

const topology = topoServer.topology({ countries: collection }, 1e5);
for (const geometry of topology.objects.countries.geometries) {
  if (geometry.properties && !Object.keys(geometry.properties).length) delete geometry.properties;
}
delete topology.bbox;

const mapped = new Set([...shapes.values()].map(s => s.id).filter(Boolean));
const unmapped = source.filter(c => isPlayable(c) && !mapped.has(c.cca3));
if (unmapped.length) throw new Error("Playable countries without a boundary: " + unmapped.map(c => c.cca3));

mkdirSync(root + "data", { recursive: true });
writeFileSync(root + "data/world.topo.json", JSON.stringify(topology));
console.log(`world.topo.json: ${shapes.size} shapes, ${topology.arcs.length} arcs`);

/* ------------------------------------------------------------------ */
/* Closest neighbours                                                  */
/* ------------------------------------------------------------------ */

// Corrections to the upstream neighbour lists. Sri Lanka is listed as bordering
// India, but the two are separated by the Palk Strait.
const BORDER_FIXES = { LKA: [] };

// For countries with at most one land neighbour (islands, peninsulas, enclaves)
// the generated trivia names the closest other places. That needs coast-to-coast
// distances, so they are measured here from the boundary data.
//
// Only the names are kept, not the distances: islets too small for the 1:50m
// boundaries would make any figure unreliable. Distances are measured from the
// country's main landmass, and a country's own dependencies do not count.
const DEPENDENCIES = {
  GBR: ["IMN", "JEY", "GGY", "GIB", "BMU", "AIA", "MSR", "VGB", "CYM", "TCA", "FLK", "SGS", "SHN", "IOT", "PCN"],
  DNK: ["GRL", "FRO"],
  AUS: ["NFK", "CXR", "CCK", "HMD"],
  NZL: ["COK", "NIU", "TKL"]
};

const RADIANS = Math.PI / 180;
function kmBetween([lng1, lat1], [lng2, lat2]) {
  const dLat = (lat2 - lat1) * RADIANS, dLng = (lng2 - lng1) * RADIANS;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RADIANS) * Math.cos(lat2 * RADIANS) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Every point of every outer ring, thinned so the largest countries stay fast.
const thin = (points, max) => {
  const step = Math.ceil(points.length / max);
  return step <= 1 ? points : points.filter((_, index) => index % step === 0);
};
const outlineOf = polygons => polygons.flatMap(polygon => polygon[0]);

function closestNeighbours(country, borders, count = 3) {
  const shape = shapes.get(country.cca3);
  const geometry = shape.polygons.length === 1
    ? { type: "Polygon", coordinates: shape.polygons[0] }
    : { type: "MultiPolygon", coordinates: shape.polygons };
  const [[south, west], [north, east]] = describeShape(geometry).focus;
  const mainland = shape.polygons.filter(polygon => {
    const [minX, minY, maxX, maxY] = bboxOf(polygon);
    const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
    return x >= west && x <= east && y >= south && y <= north;
  });
  const own = thin(outlineOf(mainland), 800);
  const excluded = new Set([country.cca3, "ATA", ...borders, ...(DEPENDENCIES[country.cca3] ?? [])]);

  const distances = [];
  for (const other of shapes.values()) {
    if (!other.id || excluded.has(other.id)) continue;
    let best = Infinity;
    for (const b of thin(outlineOf(other.polygons), 2500)) {
      for (const a of own) {
        // Cheap reject before the trigonometry: a degree of latitude is ~111 km.
        if (Math.abs(a[1] - b[1]) * 111 >= best) continue;
        const km = kmBetween(a, b);
        if (km < best) best = km;
      }
    }
    distances.push([other.id, best]);
  }
  return distances.sort((a, b) => a[1] - b[1]).slice(0, count).map(([code]) => code);
}

const nearestByCode = new Map();
for (const country of source.filter(isPlayable)) {
  const borders = BORDER_FIXES[country.cca3] ?? country.borders ?? [];
  if (borders.length <= 1) nearestByCode.set(country.cca3, closestNeighbours(country, borders));
}
console.log(`closest neighbours: computed for ${nearestByCode.size} countries`);

/* ------------------------------------------------------------------ */
/* Flags                                                               */
/* ------------------------------------------------------------------ */

mkdirSync(root + "flags", { recursive: true });

async function fetchFlag(cca2) {
  const path = `${root}flags/${cca2}.svg`;
  if (existsSync(path) && !refreshFlags) return readFileSync(path, "utf8");
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`https://flagcdn.com/${cca2}.svg`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const svg = await response.text();
      if (!svg.includes("<svg")) throw new Error("not an SVG");
      writeFileSync(path, svg);
      return svg;
    } catch (error) {
      if (attempt === 4) throw new Error(`Flag ${cca2}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, attempt * 800));
    }
  }
}

// Height:width as the smallest whole-number ratio that matches the artwork,
// e.g. "2:3". Flags that are not a simple rectangle ratio return null.
// The width/height attributes win over the viewBox: a few files (Qatar) stretch
// their viewBox with preserveAspectRatio="none".
function flagRatio(svg) {
  const tag = svg.slice(svg.indexOf("<svg"), svg.indexOf(">", svg.indexOf("<svg")));
  const attr = name => tag.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];
  let width = parseFloat(attr("width")), height = parseFloat(attr("height"));
  if (!(width > 0 && height > 0)) {
    const viewBox = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4) [, , width, height] = viewBox;
  }
  if (!(width > 0 && height > 0)) return null;
  for (let w = 1; w <= 40; w++) {
    const h = Math.round((height / width) * w);
    if (h >= 1 && Math.abs(h / w - height / width) < 0.0008) return `${h}:${w}`;
  }
  return null;
}

// Artwork whose proportions differ from the official specification, so no
// ratio is recorded (Oman's flag is officially 1:2; the file is drawn 4:7).
const RATIO_UNRELIABLE = new Set(["OMN"]);

const playable = source.filter(isPlayable);
const flagInfo = new Map();
const queue = [...playable];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let country; (country = queue.shift());) {
    const cca2 = country.cca2.toLowerCase();
    const svg = await fetchFlag(cca2);
    const ratio = RATIO_UNRELIABLE.has(country.cca3) ? null : flagRatio(svg);
    flagInfo.set(country.cca3, { svg: `flags/${cca2}.svg`, ratio });
  }
}));
console.log(`flags: ${flagInfo.size} files`);

/* ------------------------------------------------------------------ */
/* Country snapshot                                                    */
/* ------------------------------------------------------------------ */

const snapshot = source
  .map(c => ({
    name: { common: c.name.common, official: c.name.official },
    cca2: c.cca2,
    cca3: c.cca3,
    unMember: c.unMember,
    capital: c.capital ?? [],
    region: c.region,
    subregion: c.subregion,
    latlng: c.latlng.map(v => Math.round(v * 100) / 100),
    landlocked: c.landlocked,
    borders: BORDER_FIXES[c.cca3] ?? c.borders ?? [],
    area: c.area,
    ...(nearestByCode.has(c.cca3) ? { nearest: nearestByCode.get(c.cca3) } : {}),
    ...(flagInfo.has(c.cca3) ? { flags: flagInfo.get(c.cca3) } : {})
  }))
  .sort((a, b) => a.cca3.localeCompare(b.cca3));

writeFileSync(
  root + "data/countries.json",
  "[\n" + snapshot.map(c => "  " + JSON.stringify(c)).join(",\n") + "\n]\n"
);
console.log(`countries.json: ${snapshot.length} entries, ${playable.length} playable`);
