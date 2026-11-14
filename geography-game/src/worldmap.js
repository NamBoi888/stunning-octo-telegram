// The map: a Leaflet view of every country outline over a label-free basemap.
//
// One class serves both uses. In Map Mode it is interactive: the player clicks
// a country (or the dot that stands in for a country too small to hit) and the
// click is reported through `onPick`. In Flag Mode it is a locator that only
// ever reveals the answer.
//
// Colours live in styles.css. This file only switches state classes on and off
// (.is-correct, .is-wrong, .is-live), so feedback fades instead of snapping.

import { TILE_URL, TILE_ATTRIBUTION, TILE_MAX_NATIVE_ZOOM, REGIONS } from "./config.js";
import { distanceKm } from "./geo.js";
import { prefersReducedMotion } from "./ui/dom.js";

const WORLD_BOUNDS = [[-58, -180], [78, 180]];
const MAX_ZOOM = 9;
const DOT_CANDIDATE_SPAN = 3;    // degrees: only countries smaller than this can get a dot
const DOT_BELOW_PX = 6;          // a country drawn smaller than this gets a dot to click
const RING_BELOW_SPAN = 1.5;     // degrees: smaller answers get a pulsing ring so they are easy to spot
const SMALL_COUNTRY_SPAN = 0.6;  // degrees: zoom in less far, so there is context around it
const KEEP_GUESS_IN_VIEW_KM = 1800;

export class WorldMap {
  // container: element to draw into
  // atlas:     from buildAtlas()
  // interactive: true for Map Mode, false for the Flag Mode locator
  // onPick(place): called when the player clicks a country while the map is live
  constructor(container, { atlas, interactive = true, onPick = null }) {
    const L = window.L;
    this.container = container;
    this.atlas = atlas;
    this.interactive = interactive;
    this.onPick = onPick;
    this.live = false;            // true while waiting for the player's click
    this.namesVisible = false;    // true once the answer is out: hovering shows names
    this.outlines = new Map();    // place key -> polygon layer
    this.dots = new Map();        // place key -> stand-in dot for a tiny country
    this.states = new Map();      // place key -> "correct" | "wrong"
    this.marks = [];              // labels and rings added for the current answer
    this.region = REGIONS[0];

    const map = (this.map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 0,
      maxZoom: MAX_ZOOM,
      zoomSnap: 0.25,
      zoomDelta: 0.75,
      wheelPxPerZoomLevel: 100,
      maxBounds: [[-74, -205], [86, 205]],
      maxBoundsViscosity: 1,
      worldCopyJump: false,
      renderer: L.svg({ padding: 0.5 }),
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      keyboard: interactive,
      boxZoom: false
    }));

    this.attribution = L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    if (interactive) L.control.zoom({ position: "bottomright" }).addTo(map);
    this.addBasemap();

    // Dots sit in their own layer above the outlines, so highlighting a large
    // country never buries the microstate inside it.
    map.createPane("dots").style.zIndex = 450;
    this.dotRenderer = L.svg({ pane: "dots" });

    const drawn = atlas.places.filter(place => place.key !== "ATA");
    L.geoJSON(
      { type: "FeatureCollection", features: drawn.map(place => place.feature) },
      {
        interactive,
        bubblingMouseEvents: false,
        style: { className: "country", weight: 1 },
        onEachFeature: (feature, layer) => {
          const place = atlas.get(feature.id ?? feature.properties.name);
          this.outlines.set(place.key, layer);
          if (interactive) this.listen(layer, place);
        }
      }
    ).addTo(map);

    // Only the playable map needs the stand-in dots: they are click targets.
    for (const place of interactive ? drawn : []) {
      if (!place.country?.playable || place.shape.span > DOT_CANDIDATE_SPAN) continue;
      const dot = L.circleMarker(place.shape.labelLatLng, {
        radius: 5,
        className: "dot",
        interactive,
        bubblingMouseEvents: false,
        pane: "dots",
        renderer: this.dotRenderer
      });
      if (interactive) this.listen(dot, place);
      this.dots.set(place.key, dot);
    }

    this.hoverTip = L.tooltip({ direction: "top", className: "map-tip", opacity: 1, offset: [0, -8] });
    map.on("zoomend", () => this.refreshDots());
    map.fitBounds(WORLD_BOUNDS, { animate: false });
    this.refreshMinZoom();
    this.refreshDots();
  }

  /* ---------------- setup ---------------- */

  addBasemap() {
    const L = window.L;
    if (!TILE_URL) {
      this.attribution.addAttribution(TILE_ATTRIBUTION.slice(TILE_ATTRIBUTION.indexOf("Borders")));
      return;
    }
    // One copy of the world only: the outlines are not repeated either.
    const tiles = L.tileLayer(TILE_URL, {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: TILE_MAX_NATIVE_ZOOM,
      noWrap: true,
      bounds: [[-85.05, -180], [85.05, 180]],
      attribution: TILE_ATTRIBUTION
    });
    let loaded = 0;
    let failed = 0;
    tiles.on("tileload", () => loaded++);
    // Offline, or the tile host is blocked: stop asking and carry on with the
    // country outlines alone, which is all the game needs.
    tiles.on("tileerror", () => {
      if (!loaded && ++failed >= 6 && this.map.hasLayer(tiles)) this.map.removeLayer(tiles);
    });
    window.addEventListener("online", () => {
      if (!this.map.hasLayer(tiles)) {
        failed = 0;
        tiles.addTo(this.map);
      }
    });
    tiles.addTo(this.map);
  }

  listen(layer, place) {
    layer.on("click", event => {
      window.L.DomEvent.stopPropagation(event);
      if (!this.live) return;
      // Dots in a tight island chain overlap when zoomed out. A click on any
      // of them goes to whichever dot's centre is closest, not whichever
      // happens to be drawn on top.
      this.onPick?.(this.dots.get(place.key) === layer ? this.nearestDot(event.latlng) ?? place : place);
    });
    layer.on("mouseover mousemove", event => {
      if (!this.namesVisible) return;
      this.hoverTip.setContent(this.atlas.nameOf(place)).setLatLng(event.latlng);
      if (!this.map.hasLayer(this.hoverTip)) this.hoverTip.addTo(this.map);
    });
    layer.on("mouseout", () => this.map.removeLayer(this.hoverTip));
  }

  nearestDot(latlng) {
    const click = this.map.latLngToLayerPoint(latlng);
    let best = null;
    let bestDistance = Infinity;
    for (const [key, dot] of this.dots) {
      if (!this.map.hasLayer(dot)) continue;
      const distance = click.distanceTo(this.map.latLngToLayerPoint(dot.getLatLng()));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = this.atlas.get(key);
      }
    }
    return best;
  }

  // The world should never be drawn much smaller than the viewport.
  refreshMinZoom() {
    this.map.setMinZoom(0);
    this.map.setMinZoom(Math.max(0, this.map.getBoundsZoom(WORLD_BOUNDS) - 0.5));
  }

  // Shows a dot for each country that is currently too small to click, and
  // hides it again once zooming in has made the outline big enough.
  refreshDots() {
    const pixelsPerDegree = (256 * 2 ** this.map.getZoom()) / 360;
    for (const [key, dot] of this.dots) {
      const needed = this.atlas.get(key).shape.span * pixelsPerDegree < DOT_BELOW_PX;
      if (needed && !this.map.hasLayer(dot)) dot.addTo(this.map);
      if (!needed && this.map.hasLayer(dot)) this.map.removeLayer(dot);
      if (needed) this.paint(dot, this.states.get(key));
    }
  }

  /* ---------------- drawing state ---------------- */

  paint(layer, state) {
    const el = layer.getElement?.();
    if (!el) return;
    el.classList.toggle("is-correct", state === "correct");
    el.classList.toggle("is-wrong", state === "wrong");
  }

  setState(place, state) {
    if (state) this.states.set(place.key, state);
    else this.states.delete(place.key);
    const outline = this.outlines.get(place.key);
    if (outline) {
      this.paint(outline, state);
      if (state) outline.bringToFront();
    }
    const dot = this.dots.get(place.key);
    if (dot && this.map.hasLayer(dot)) this.paint(dot, state);
  }

  label(place, state) {
    const L = window.L;
    const label = L.tooltip({
      permanent: true,
      direction: "top",
      className: `map-label is-${state}`,
      opacity: 1,
      offset: [0, -10]
    })
      .setLatLng(place.shape.labelLatLng)
      .setContent(this.atlas.nameOf(place))
      .addTo(this.map);
    this.marks.push(label);
  }

  // Marks an answer that is too small to see as a shape: a pulsing ring,
  // plus a dot at its centre on maps that do not already have one.
  ring(place) {
    const L = window.L;
    const ring = L.marker(place.shape.labelLatLng, {
      icon: L.divIcon({ className: "map-ring", iconSize: [56, 56] }),
      interactive: false,
      keyboard: false
    }).addTo(this.map);
    this.marks.push(ring);
    if (!this.dots.has(place.key)) {
      const dot = L.circleMarker(place.shape.labelLatLng, {
        radius: 5,
        className: "dot is-correct",
        interactive: false,
        pane: "dots",
        renderer: this.dotRenderer
      }).addTo(this.map);
      this.marks.push(dot);
    }
  }

  clearAnswer() {
    for (const mark of this.marks) this.map.removeLayer(mark);
    this.marks = [];
    for (const key of [...this.states.keys()]) this.setState(this.atlas.get(key), null);
    this.map.removeLayer(this.hoverTip);
  }

  /* ---------------- camera ---------------- */

  // Frames a box of the map inside the area left clear by `padding`.
  // `minZoom` stops a large region from being shown too small to use on a
  // narrow screen: the view then centres on the region and the player pans.
  fit(bounds, { padding = {}, maxZoom = 8, minZoom = 0, animate = true } = {}) {
    const L = window.L;
    const map = this.map;
    const box = L.latLngBounds(bounds);
    const topLeft = L.point(padding.topLeft ?? [24, 24]);
    const bottomRight = L.point(padding.bottomRight ?? [24, 24]);
    const fitted = map.getBoundsZoom(box, false, topLeft.add(bottomRight));
    const zoom = Math.max(minZoom, Math.min(maxZoom, fitted));
    const middle = map.project(box.getSouthWest(), zoom).add(map.project(box.getNorthEast(), zoom)).divideBy(2);
    const centre = map.unproject(middle.add(bottomRight.subtract(topLeft).divideBy(2)), zoom);
    if (animate && !prefersReducedMotion()) map.flyTo(centre, zoom, { duration: 1.1, easeLinearity: 0.3 });
    else map.setView(centre, zoom, { animate: false });
  }

  /* ---------------- rounds ---------------- */

  // Clears the last answer and frames the region for a new round.
  startRound(regionId, { padding, animate = true } = {}) {
    this.region = REGIONS.find(region => region.id === regionId) ?? REGIONS[0];
    this.clearAnswer();
    this.namesVisible = false;
    this.live = this.interactive;
    this.container.classList.toggle("is-live", this.live);
    this.showRegion({ padding, animate });
  }

  showRegion({ padding, animate = true } = {}) {
    this.fit(this.region.bounds, { padding, animate, minZoom: this.interactive ? 1 : 0 });
  }

  // Shows the answer: the target turns green, a wrong guess turns red, both
  // are labelled, and the view travels to the target. Tiny countries get a
  // pulsing ring and a gentler zoom so their surroundings stay in view.
  //   target:  the place that was asked for
  //   picked:  the place the player chose, if it was a wrong guess
  //   padding: { topLeft: [x, y], bottomRight: [x, y] } kept clear of panels
  reveal({ target, picked = null, padding }) {
    const L = window.L;
    this.live = false;
    this.namesVisible = true;
    this.container.classList.remove("is-live");

    if (picked) {
      this.setState(picked, "wrong");
      this.label(picked, "wrong");
    }
    this.setState(target, "correct");
    this.label(target, "correct");

    const small = target.shape.span < SMALL_COUNTRY_SPAN;
    if (target.shape.span < RING_BELOW_SPAN) this.ring(target);

    const bounds = L.latLngBounds(target.shape.focus);
    if (picked && distanceKm(picked.shape.labelLatLng, target.shape.labelLatLng) < KEEP_GUESS_IN_VIEW_KM) {
      bounds.extend(picked.shape.labelLatLng);
    }
    // Generous margins, so the neighbours that give the answer its context are in view.
    this.fit(bounds.pad(0.6), { padding, maxZoom: small ? 5.75 : 6.75 });
  }

  // Call after the container has been shown or resized.
  resize() {
    this.map.invalidateSize({ animate: false });
    this.refreshMinZoom();
  }
}
