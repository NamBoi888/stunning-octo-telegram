// measure.js — click-to-place distance & area measurement, computed
// deterministically with Turf.js (great-circle length / spherical area) so
// results are explainable and reproducible from the drawn geometry alone.

const turf = window.turf;
const SOURCE_ID = 'src-measure';
const LINE_LAYER = 'lyr-measure-line';
const FILL_LAYER = 'lyr-measure-fill';
const POINT_LAYER = 'lyr-measure-points';

export class MeasureTool {
  constructor(map, onResult) {
    this.map = map;
    this.onResult = onResult;
    this.mode = null; // 'distance' | 'area' | null
    this.points = [];
    this._onClick = this._onClick.bind(this);
    this._onDblClick = this._onDblClick.bind(this);
    this._onMove = this._onMove.bind(this);
  }

  ensureLayers() {
    const map = this.map;
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: emptyFc() });
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#e0a72e', 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: { 'line-color': '#e0a72e', 'line-width': 2.5, 'line-dasharray': [1, 1] },
      });
      map.addLayer({
        id: POINT_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4.5, 'circle-color': '#e0a72e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
      });
    }
    this._render();
  }

  start(mode) {
    this.stop();
    this.mode = mode;
    this.points = [];
    this.map.getCanvas().style.cursor = 'crosshair';
    this.map.on('click', this._onClick);
    this.map.on('dblclick', this._onDblClick);
    this.map.on('mousemove', this._onMove);
    this._render();
  }

  stop() {
    this.map.off('click', this._onClick);
    this.map.off('dblclick', this._onDblClick);
    this.map.off('mousemove', this._onMove);
    this.map.getCanvas().style.cursor = '';
    this.mode = null;
  }

  clear() {
    this.points = [];
    this._render();
    this.onResult(null);
  }

  _onClick(e) {
    if (!this.mode) return;
    e.preventDefault();
    this.points.push([e.lngLat.lng, e.lngLat.lat]);
    this._render();
    this._reportResult();
  }

  _onMove(e) {
    if (!this.mode || !this.points.length) return;
    this._render([...this.points, [e.lngLat.lng, e.lngLat.lat]]);
  }

  _onDblClick(e) {
    if (!this.mode) return;
    e.preventDefault();
    this._reportResult();
    this.stop();
  }

  _reportResult() {
    if (this.mode === 'distance' && this.points.length >= 2) {
      const line = turf.lineString(this.points);
      this.onResult({ mode: 'distance', meters: turf.length(line, { units: 'kilometers' }) * 1000 });
    } else if (this.mode === 'area' && this.points.length >= 3) {
      const ring = [...this.points, this.points[0]];
      const poly = turf.polygon([ring]);
      this.onResult({ mode: 'area', sqMeters: turf.area(poly) });
    } else {
      this.onResult(null);
    }
  }

  _render(previewPoints) {
    const map = this.map;
    if (!map.getSource(SOURCE_ID)) return;
    const pts = previewPoints || this.points;
    const features = pts.map((c) => turf.point(c));
    if (this.mode === 'distance' && pts.length >= 2) {
      features.push(turf.lineString(pts));
    } else if (this.mode === 'area' && pts.length >= 3) {
      features.push(turf.polygon([[...pts, pts[0]]]));
    } else if (this.mode === 'area' && pts.length === 2) {
      features.push(turf.lineString(pts));
    }
    map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features });
  }
}

function emptyFc() {
  return { type: 'FeatureCollection', features: [] };
}
