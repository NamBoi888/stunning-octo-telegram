// compare.js — layer/basemap split-view. Spins up a second MapLibre instance
// stacked exactly over the first, clips it to a draggable divider (the
// standard swipe-compare technique), and keeps both cameras in lockstep.

import { createMap, BASEMAPS } from './map-init.js';
import { addAllLayers, applyVisibility, LAYER_DEFS } from './layers.js';

const PRESETS = {
  satellite: { basemap: 'satellite', hide: [] },
  heritage: { basemap: 'light', hide: ['environment', 'urban', 'transport', 'amenity'] },
  environment: { basemap: 'light', hide: ['heritage', 'urban', 'transport', 'hospitality', 'amenity'] },
  urban: { basemap: 'light', hide: ['heritage', 'environment', 'transport', 'hospitality', 'amenity'] },
};

export class CompareView {
  constructor({ mainMap, containerId, dividerId, data, initialView }) {
    this.mainMap = mainMap;
    this.container = document.getElementById(containerId);
    this.divider = document.getElementById(dividerId);
    this.data = data;
    this.initialView = initialView;
    this.rightMap = null;
    this.active = false;
    this._syncingFromMain = false;
    this._syncingFromRight = false;
    this._onDrag = this._onDrag.bind(this);
  }

  enable(presetKey = 'satellite') {
    if (this.active) return;
    this.active = true;
    this.container.style.display = 'block';
    this.divider.style.display = 'block';

    this.rightMap = createMap(this.container, {
      center: this.mainMap.getCenter(),
      zoom: this.mainMap.getZoom(),
      bearing: this.mainMap.getBearing(),
      pitch: this.mainMap.getPitch(),
      basemap: PRESETS[presetKey].basemap,
    });
    this.rightMap.once('load', () => {
      addAllLayers(this.rightMap, this.data);
      this.applyPreset(presetKey);
      this.rightMap.resize();
    });

    this.mainMap.on('move', this._onMainMove);
    this.rightMap.on('move', this._onRightMove);
    this._setSplit(50);
    this._dragBound = this._onDrag;
    this.divider.addEventListener('pointerdown', () => {
      window.addEventListener('pointermove', this._dragBound);
      window.addEventListener('pointerup', () => window.removeEventListener('pointermove', this._dragBound), { once: true });
    });
  }

  applyPreset(presetKey) {
    if (!this.rightMap) return;
    const preset = PRESETS[presetKey];
    addAllLayers(this.rightMap, this.data);
    for (const def of LAYER_DEFS) {
      applyVisibility(this.rightMap, def, !preset.hide.includes(def.group));
    }
  }

  setBasemap(presetKey) {
    if (!this.rightMap) return;
    this.rightMap.setStyle(BASEMAPS[PRESETS[presetKey].basemap]);
    this.rightMap.once('styledata', () => this.applyPreset(presetKey));
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.container.style.display = 'none';
    this.divider.style.display = 'none';
    this.mainMap.off('move', this._onMainMove);
    if (this.rightMap) {
      this.rightMap.remove();
      this.rightMap = null;
    }
  }

  _onMainMove = () => {
    if (!this.rightMap || this._syncingFromRight) return;
    this._syncingFromMain = true;
    this.rightMap.jumpTo({ center: this.mainMap.getCenter(), zoom: this.mainMap.getZoom(), bearing: this.mainMap.getBearing(), pitch: this.mainMap.getPitch() });
    this._syncingFromMain = false;
  };

  _onRightMove = () => {
    if (this._syncingFromMain) return;
    this._syncingFromRight = true;
    this.mainMap.jumpTo({ center: this.rightMap.getCenter(), zoom: this.rightMap.getZoom(), bearing: this.rightMap.getBearing(), pitch: this.rightMap.getPitch() });
    this._syncingFromRight = false;
  };

  _onDrag(e) {
    const rect = this.mainMap.getContainer().getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    this._setSplit(pct);
  }

  _setSplit(pct) {
    this.container.style.clipPath = `inset(0 0 0 ${pct}%)`;
    this.divider.style.left = `${pct}%`;
    if (this.rightMap) this.rightMap.resize();
  }
}
