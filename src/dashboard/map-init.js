// map-init.js — MapLibre GL JS bootstrap. Deliberately uses only free, public,
// key-less raster tile services (OSM standard, CARTO Positron/Dark Matter,
// Esri World Imagery) so the dashboard needs no API tokens or accounts —
// MapLibre (BSD-3, vendored under vendor/maplibre/) never requires one, unlike
// Mapbox GL JS.

const maplibregl = window.maplibregl;

export const BASEMAPS = {
  light: {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [{ id: 'carto-light', type: 'raster', source: 'carto' }],
  },
  dark: {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [{ id: 'carto-dark', type: 'raster', source: 'carto' }],
  },
  satellite: {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri' }],
  },
};

export function createMap(container, { center, zoom, basemap = 'light', pitch = 0, bearing = 0 } = {}) {
  return new maplibregl.Map({
    container,
    style: BASEMAPS[basemap],
    center,
    zoom,
    pitch,
    bearing,
    attributionControl: { compact: true },
    maxPitch: 70,
    preserveDrawingBuffer: true, // required so canvas.toDataURL() works for the screenshot tool
  });
}

export function setBasemap(map, key) {
  map.setStyle(BASEMAPS[key]);
}
