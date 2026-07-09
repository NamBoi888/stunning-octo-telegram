// layers.js — the thematic layer registry: source/layer wiring, color logic,
// and the legend definitions the UI renders from. Grouped exactly per the
// six requested categories plus a boundary reference layer.

export const PALETTE = {
  building: '#caa06a',
  buildingStroke: '#8a6a3e',
  landmarkBuilding: '#e0a72e',
  water: '#2f9fd6',
  green: '#5a9e44',
  roadPed: '#c9ad78',
  roadVeh: '#8d7852',
  heritage: '#c8442c',
  hospitality: '#e2703a',
  amenity: '#2f8f8f',
  boundary: '#6b5b95',
  buffer: '#4b8f8c',
};

// Each entry: { id, group, kind, sourceKey, paint/legend }. `group` maps 1:1
// onto the requested layer categories so the side panel can render one
// accordion section per group with one legend swatch per layer inside it.
export const LAYER_DEFS = [
  {
    id: 'lyr-boundary',
    group: 'boundary',
    sourceKey: 'boundary',
    type: 'line',
    defaultVisible: true,
    legend: { swatch: PALETTE.boundary, labelKey: 'layerBoundary' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-boundary',
        type: 'line',
        source: sourceId,
        paint: { 'line-color': PALETTE.boundary, 'line-width': 2, 'line-dasharray': [3, 2] },
      });
    },
  },
  {
    id: 'lyr-green',
    group: 'environment',
    sourceKey: 'green',
    type: 'mixed',
    defaultVisible: true,
    legend: { swatch: PALETTE.green, labelKey: 'layerEnvironment' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-green-fill',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': PALETTE.green, 'fill-opacity': 0.55 },
      });
      map.addLayer({
        id: 'lyr-green-line',
        type: 'line',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': PALETTE.green, 'line-width': 3, 'line-opacity': 0.6 },
      });
    },
    hoverable: ['lyr-green-fill'],
  },
  {
    id: 'lyr-water',
    group: 'environment',
    sourceKey: 'water',
    type: 'mixed',
    defaultVisible: true,
    legend: { swatch: PALETTE.water, labelKey: 'layerEnvironment' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-water-fill',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': PALETTE.water, 'fill-opacity': 0.75 },
      });
      map.addLayer({
        id: 'lyr-water-line',
        type: 'line',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': PALETTE.water, 'line-width': ['coalesce', ['/', ['get', 'width_m'], 3], 4] },
      });
    },
    hoverable: ['lyr-water-fill', 'lyr-water-line'],
  },
  {
    id: 'lyr-buildings',
    group: 'urban',
    sourceKey: 'buildings',
    type: 'fill',
    defaultVisible: true,
    legend: { swatch: PALETTE.building, labelKey: 'layerUrban' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-buildings-fill',
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['case', ['==', ['get', 'category'], 'landmark_scale'], PALETTE.landmarkBuilding, PALETTE.building],
          'fill-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'lyr-buildings-line',
        type: 'line',
        source: sourceId,
        paint: { 'line-color': PALETTE.buildingStroke, 'line-width': 0.6 },
      });
      map.addLayer({
        id: 'lyr-buildings-3d',
        type: 'fill-extrusion',
        source: sourceId,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['case', ['==', ['get', 'category'], 'landmark_scale'], PALETTE.landmarkBuilding, PALETTE.building],
          'fill-extrusion-height': ['get', 'height_m'],
          'fill-extrusion-opacity': 0.9,
        },
      });
    },
    hoverable: ['lyr-buildings-fill'],
  },
  {
    id: 'lyr-roads',
    group: 'transport',
    sourceKey: 'roads',
    type: 'line',
    defaultVisible: true,
    legend: { swatch: PALETTE.roadVeh, labelKey: 'layerTransport' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-roads-line',
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['match', ['get', 'kind'], 'pedestrian', PALETTE.roadPed, PALETTE.roadVeh],
          'line-width': ['coalesce', ['/', ['get', 'width_m'], 2.5], 2],
        },
      });
    },
    hoverable: ['lyr-roads-line'],
  },
  {
    id: 'lyr-landmarks',
    group: 'heritage',
    sourceKey: 'landmarks',
    type: 'point',
    defaultVisible: true,
    legend: { swatch: PALETTE.heritage, labelKey: 'layerHeritage' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-landmarks-halo',
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 12,
          'circle-color': PALETTE.heritage,
          'circle-opacity': 0.25,
        },
      });
      map.addLayer({
        id: 'lyr-landmarks-point',
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': PALETTE.heritage,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
      // Deliberately no permanent text label here: a symbol layer needs a
      // `glyphs` PBF fetch from a remote font server before it renders, which
      // adds a fragile network dependency for very little value over the
      // hover tooltip + click drawer this dashboard already gives every
      // landmark.
    },
    hoverable: ['lyr-landmarks-point'],
  },
  {
    id: 'lyr-poi-hospitality',
    group: 'hospitality',
    sourceKey: 'poi',
    type: 'point',
    filterCategory: 'hospitality',
    defaultVisible: true,
    legend: { swatch: PALETTE.hospitality, labelKey: 'layerHospitality' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-poi-hospitality-point',
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'category'], 'hospitality'],
        paint: {
          'circle-radius': 5.5,
          'circle-color': PALETTE.hospitality,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.2,
        },
      });
    },
    hoverable: ['lyr-poi-hospitality-point'],
  },
  {
    id: 'lyr-poi-amenity',
    group: 'amenity',
    sourceKey: 'poi',
    type: 'point',
    filterCategory: 'amenity',
    defaultVisible: true,
    legend: { swatch: PALETTE.amenity, labelKey: 'layerAmenity' },
    build: (map, sourceId) => {
      map.addLayer({
        id: 'lyr-poi-amenity-point',
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'category'], 'amenity'],
        paint: {
          'circle-radius': 5,
          'circle-color': PALETTE.amenity,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.2,
        },
      });
    },
    hoverable: ['lyr-poi-amenity-point'],
  },
];

export const GROUP_ORDER = ['heritage', 'environment', 'urban', 'transport', 'hospitality', 'amenity', 'boundary'];

const SOURCE_IDS = {
  buildings: 'src-buildings',
  roads: 'src-roads',
  water: 'src-water',
  green: 'src-green',
  landmarks: 'src-landmarks',
  poi: 'src-poi',
  boundary: 'src-boundary',
};

// Rebuild every source + layer. Called on first load and again after every
// setStyle() basemap swap, since MapLibre discards custom sources/layers when
// the base style changes.
export function addAllLayers(map, data) {
  for (const [key, sourceId] of Object.entries(SOURCE_IDS)) {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'geojson', data: data[key] });
    }
  }
  for (const def of LAYER_DEFS) {
    if (!map.getLayer(def.id) && !layerGroupExists(map, def)) {
      def.build(map, SOURCE_IDS[def.sourceKey]);
    }
    applyVisibility(map, def, def.defaultVisible !== false);
  }
}

function layerGroupExists(map, def) {
  // fill/line pairs use suffixed ids; treat "exists" as "first sub-layer exists"
  const candidates = [def.id, `${def.id}-fill`, `${def.id}-line`, `${def.id}-point`];
  return candidates.some((id) => map.getLayer(id));
}

function subLayerIds(def) {
  switch (def.id) {
    case 'lyr-green':
      return ['lyr-green-fill', 'lyr-green-line'];
    case 'lyr-water':
      return ['lyr-water-fill', 'lyr-water-line'];
    case 'lyr-buildings':
      return ['lyr-buildings-fill', 'lyr-buildings-line'];
    case 'lyr-landmarks':
      return ['lyr-landmarks-halo', 'lyr-landmarks-point'];
    case 'lyr-roads':
      return ['lyr-roads-line'];
    case 'lyr-poi-hospitality':
      return ['lyr-poi-hospitality-point'];
    case 'lyr-poi-amenity':
      return ['lyr-poi-amenity-point'];
    case 'lyr-boundary':
      return ['lyr-boundary'];
    default:
      return [def.id];
  }
}

export function applyVisibility(map, def, visible) {
  for (const id of subLayerIds(def)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

export function setLayerVisible(map, layerId, visible) {
  const def = LAYER_DEFS.find((d) => d.id === layerId);
  if (def) applyVisibility(map, def, visible);
}

export function set3DBuildings(map, enabled) {
  if (map.getLayer('lyr-buildings-3d')) {
    map.setLayoutProperty('lyr-buildings-3d', 'visibility', enabled ? 'visible' : 'none');
  }
  if (map.getLayer('lyr-buildings-fill')) {
    map.setLayoutProperty('lyr-buildings-fill', 'visibility', enabled ? 'none' : 'visible');
  }
}

export const HOVERABLE_LAYER_IDS = LAYER_DEFS.flatMap((d) => d.hoverable || []);
