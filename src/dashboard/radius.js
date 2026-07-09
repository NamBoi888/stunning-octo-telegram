// radius.js — spatial "within N metres of this point" filter. Draws a
// geodesic buffer circle with Turf and filters the landmark/POI point layers
// down to whatever falls inside it, using a plain point-in-polygon test
// (deterministic, no server round-trip).

const turf = window.turf;
const SOURCE_ID = 'src-radius';
const FILL_LAYER = 'lyr-radius-fill';
const LINE_LAYER = 'lyr-radius-line';

export class RadiusTool {
  constructor(map, data, onResult) {
    this.map = map;
    this.data = data; // { landmarks, poi } feature collections
    this.onResult = onResult;
    this.center = null;
    this.radiusMeters = 400;
    this._onClick = this._onClick.bind(this);
  }

  ensureLayers() {
    const map = this.map;
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: emptyFc() });
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        paint: { 'fill-color': '#4b8f8c', 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#4b8f8c', 'line-width': 2 },
      });
    }
    this._render();
  }

  start() {
    this.active = true;
    this.map.getCanvas().style.cursor = 'crosshair';
    this.map.on('click', this._onClick);
  }

  stop() {
    this.active = false;
    this.map.off('click', this._onClick);
    this.map.getCanvas().style.cursor = '';
  }

  setRadius(meters) {
    this.radiusMeters = meters;
    if (this.center) this._recompute();
  }

  clear() {
    this.center = null;
    this._render();
    this._restoreFilters();
    this.onResult(null);
  }

  _onClick(e) {
    this.center = [e.lngLat.lng, e.lngLat.lat];
    this._recompute();
  }

  _recompute() {
    this._render();
    const circle = turf.circle(this.center, this.radiusMeters / 1000, { units: 'kilometers', steps: 64 });
    const within = [];
    for (const f of [...this.data.landmarks.features, ...this.data.poi.features]) {
      if (turf.booleanPointInPolygon(f.geometry, circle)) within.push(f);
    }
    this._applyFilters(within.map((f) => f.properties.id));
    this.onResult({ center: this.center, radiusMeters: this.radiusMeters, features: within });
  }

  _applyFilters(ids) {
    const map = this.map;
    const filter = ['in', ['get', 'id'], ['literal', ids]];
    for (const id of ['lyr-landmarks-point', 'lyr-landmarks-halo', 'lyr-landmarks-label', 'lyr-poi-hospitality-point', 'lyr-poi-amenity-point']) {
      if (map.getLayer(id)) map.setFilter(id, this.center ? combineFilter(id, filter) : baseFilter(id));
    }
  }

  _restoreFilters() {
    const map = this.map;
    for (const id of ['lyr-landmarks-point', 'lyr-landmarks-halo', 'lyr-landmarks-label', 'lyr-poi-hospitality-point', 'lyr-poi-amenity-point']) {
      if (map.getLayer(id)) map.setFilter(id, baseFilter(id));
    }
  }

  _render() {
    const map = this.map;
    if (!map.getSource(SOURCE_ID)) return;
    if (!this.center) {
      map.getSource(SOURCE_ID).setData(emptyFc());
      return;
    }
    const circle = turf.circle(this.center, this.radiusMeters / 1000, { units: 'kilometers', steps: 64 });
    map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features: [circle] });
  }
}

function baseFilter(layerId) {
  if (layerId === 'lyr-poi-hospitality-point') return ['==', ['get', 'category'], 'hospitality'];
  if (layerId === 'lyr-poi-amenity-point') return ['==', ['get', 'category'], 'amenity'];
  return null;
}

function combineFilter(layerId, extra) {
  const base = baseFilter(layerId);
  return base ? ['all', base, extra] : extra;
}

function emptyFc() {
  return { type: 'FeatureCollection', features: [] };
}
