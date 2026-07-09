// story.js — time-agnostic guided tour: flies the camera through each
// landmark in a sensible walking order and shows its curated bilingual story,
// reusing src/diriyah/culture.js.

import { LANDMARKS } from '../diriyah/culture.js';
import { t, getLang } from './i18n.js';

// Curated walking order through At-Turaif (visitor centre in, core sites,
// mosque, palaces, museums) rather than raw JSON order.
const TOUR_ORDER = ['visitor', 'turaif', 'mosque', 'salwa', 'palace', 'horse', 'treasury', 'moudhi'];

export class StoryTour {
  constructor(map, landmarksFc, { onStep, onExit }) {
    this.map = map;
    this.onStep = onStep;
    this.onExit = onExit;
    this.byId = Object.fromEntries(landmarksFc.features.map((f) => [f.properties.id, f]));
    this.order = TOUR_ORDER.filter((id) => this.byId[id]);
    this.index = -1;
    this.playing = false;
  }

  start() {
    this.playing = true;
    this.index = 0;
    this._goTo(this.index);
  }

  next() {
    if (this.index >= this.order.length - 1) return this.exit();
    this.index += 1;
    this._goTo(this.index);
  }

  prev() {
    if (this.index <= 0) return;
    this.index -= 1;
    this._goTo(this.index);
  }

  exit() {
    this.playing = false;
    this.index = -1;
    this.onExit();
  }

  // Re-render the current step's captions (e.g. after a language switch)
  // without re-flying the camera.
  refresh() {
    if (!this.playing || this.index < 0) return;
    const id = this.order[this.index];
    const feature = this.byId[id];
    const content = LANDMARKS[id];
    this.onStep({
      index: this.index,
      total: this.order.length,
      id,
      icon: content?.icon || feature.properties.icon,
      title: getLang() === 'ar' ? content?.ar : content?.en,
      tag: content?.tag,
      body: content?.body,
      fact: content?.fact,
    });
  }

  _goTo(i) {
    const id = this.order[i];
    const feature = this.byId[id];
    const content = LANDMARKS[id];
    this.map.flyTo({ center: feature.geometry.coordinates, zoom: 18.5, pitch: 45, bearing: (i * 37) % 360, essential: true, speed: 0.8 });
    this.onStep({
      index: i,
      total: this.order.length,
      id,
      icon: content?.icon || feature.properties.icon,
      title: getLang() === 'ar' ? content?.ar : content?.en,
      tag: content?.tag,
      body: content?.body,
      fact: content?.fact,
    });
  }
}
