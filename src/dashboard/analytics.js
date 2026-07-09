// analytics.js — deterministic, explainable insights computed client-side
// from the public OSM-derived geometry only (no hidden model, no external
// service). Every number here can be reproduced from data/diriyah/*.geojson
// with the formulas documented inline.

const turf = window.turf;

const HEATMAP_SOURCE = 'src-poi-density';
const HEATMAP_LAYER = 'lyr-poi-heatmap';
const BUFFER_SOURCE = 'src-access-buffers';
const BUFFER_LAYER = 'lyr-access-buffers';

export function ensureAnalyticsLayers(map, data) {
  if (!map.getSource(HEATMAP_SOURCE)) {
    // Deep-clone: this source must never share feature object references with
    // src-landmarks/src-poi, since GeoJSON sources are known to mutate the
    // feature objects they're given (internal ids, etc.) and two sources
    // fighting over the same objects can silently corrupt one of them.
    const points = {
      type: 'FeatureCollection',
      features: JSON.parse(JSON.stringify([...data.landmarks.features, ...data.poi.features])),
    };
    map.addSource(HEATMAP_SOURCE, { type: 'geojson', data: points });
    map.addLayer({
      id: HEATMAP_LAYER,
      type: 'heatmap',
      source: HEATMAP_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-radius': 40,
        'heatmap-intensity': 1,
        'heatmap-opacity': 0.65,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, '#fef0d9',
          0.4, '#fdcc8a',
          0.6, '#fc8d59',
          0.8, '#e34a33',
          1, '#b30000',
        ],
      },
    });
  }
  if (!map.getSource(BUFFER_SOURCE)) {
    const buffers = buildAccessibilityBuffers(data);
    map.addSource(BUFFER_SOURCE, { type: 'geojson', data: buffers });
    map.addLayer({
      id: BUFFER_LAYER,
      type: 'fill',
      source: BUFFER_SOURCE,
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#4b8f8c', 'fill-opacity': 0.12 },
    });
    map.addLayer({
      id: `${BUFFER_LAYER}-line`,
      type: 'line',
      source: BUFFER_SOURCE,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#4b8f8c', 'line-width': 1, 'line-dasharray': [2, 2] },
    });
  }
}

export function toggleHeatmap(map, visible) {
  if (map.getLayer(HEATMAP_LAYER)) map.setLayoutProperty(HEATMAP_LAYER, 'visibility', visible ? 'visible' : 'none');
}

export function toggleBuffers(map, visible) {
  for (const id of [BUFFER_LAYER, `${BUFFER_LAYER}-line`]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

// 400 m ~= a comfortable 5-minute walk; the conventional planning radius for
// "immediate access" to a landmark.
const WALK_BUFFER_M = 400;

function buildAccessibilityBuffers(data) {
  const features = data.landmarks.features.map((f) =>
    turf.buffer(f, WALK_BUFFER_M / 1000, { units: 'kilometers', steps: 32 }),
  );
  return { type: 'FeatureCollection', features };
}

// Land-use split: sum polygon area (m²) for buildings, water ponds, and green
// (palm groves), each clipped to nothing extra — plain turf.area over the
// baked footprints. "Other" fills the remainder of the study-area boundary.
export function computeLandUse(data) {
  const areaOf = (fc) =>
    fc.features.filter((f) => f.geometry.type === 'Polygon').reduce((sum, f) => sum + turf.area(f), 0);

  const buildingArea = areaOf(data.buildings);
  const waterArea = areaOf(data.water);
  const greenArea = areaOf(data.green);
  const boundaryArea = turf.area(data.boundary.features[0]);
  const otherArea = Math.max(0, boundaryArea - buildingArea - waterArea - greenArea);

  return {
    boundaryArea,
    segments: [
      { key: 'buildings', label_en: 'Built-up', label_ar: 'مساحة مبنية', color: '#caa06a', area: buildingArea },
      { key: 'green', label_en: 'Green / palm groves', label_ar: 'مساحات خضراء', color: '#5a9e44', area: greenArea },
      { key: 'water', label_en: 'Wadi / water', label_ar: 'الوادي والمياه', color: '#2f9fd6', area: waterArea },
      { key: 'other', label_en: 'Open / unclassified', label_ar: 'مساحات مفتوحة', color: '#d8d2c4', area: otherArea },
    ],
  };
}

export function computeGreenBuiltRatio(landUse) {
  const green = landUse.segments.find((s) => s.key === 'green').area;
  const built = landUse.segments.find((s) => s.key === 'buildings').area;
  return built > 0 ? green / built : 0;
}

// Walkability approximation: pedestrian-path length within a 300 m buffer of
// each landmark, divided by the buffer's area -> km of path per km².
// Normalised against a 40 km/km² reference density (a well-served, walkable
// historic core) to a 0-100 score. This is a simple, explainable proxy, not a
// calibrated walkability index.
const WALKABILITY_BUFFER_M = 300;
const REFERENCE_DENSITY_KM_PER_KM2 = 40;

export function computeWalkability(data) {
  const pedestrianRoads = data.roads.features.filter((f) => f.properties.kind === 'pedestrian');
  const results = data.landmarks.features.map((lm) => {
    const buffer = turf.buffer(lm, WALKABILITY_BUFFER_M / 1000, { units: 'kilometers', steps: 32 });
    const bufferAreaKm2 = turf.area(buffer) / 1_000_000;
    let pathKm = 0;
    for (const road of pedestrianRoads) pathKm += lengthWithinPolygon(road, buffer);
    const density = bufferAreaKm2 > 0 ? pathKm / bufferAreaKm2 : 0;
    const score = Math.max(0, Math.min(100, Math.round((density / REFERENCE_DENSITY_KM_PER_KM2) * 100)));
    return { id: lm.properties.id, name_en: lm.properties.name_en, name_ar: lm.properties.name_ar, density, score };
  });
  const avgScore = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
  return { perLandmark: results, avgScore };
}

// Length of `line` that falls inside `polygon`, approximated per-segment:
// a segment with both endpoints inside counts in full, one endpoint inside
// counts at half length, and a fully-outside segment counts as zero (it may
// still clip a corner of the buffer, but roads here are short baked segments
// so the error this introduces is small and the method stays simple and
// auditable without a full line/polygon clipping routine).
function lengthWithinPolygon(line, polygon) {
  const coords = line.geometry.coordinates;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const aIn = turf.booleanPointInPolygon(a, polygon);
    const bIn = turf.booleanPointInPolygon(b, polygon);
    if (!aIn && !bIn) continue;
    const segKm = turf.distance(a, b, { units: 'kilometers' });
    total += aIn && bIn ? segKm : segKm / 2;
  }
  return total;
}
