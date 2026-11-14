// The globe on the start screen: an orthographic view of the same country
// outlines the game uses, drawn on a canvas. It turns slowly while "World" is
// selected and swings round to face a region when one is chosen.

import { prefersReducedMotion } from "./dom.js";

const RADIANS = Math.PI / 180;
const SPIN_DEGREES_PER_SECOND = 5;
const DEFAULT_TILT = 16;
// Only the upper part of the globe shows above the panel's edge, so the view
// is centred this many degrees south of a region to lift it into sight.
const LOOK_SOUTH_OF_REGION = 28;

const COLOURS = {
  ocean: ["#17475a", "#0b2531"],
  land: "rgba(239, 230, 208, 0.20)",
  coast: "rgba(239, 230, 208, 0.55)",
  regionLand: "rgba(226, 173, 76, 0.62)",
  regionCoast: "rgba(245, 214, 150, 0.95)",
  graticule: "rgba(239, 230, 208, 0.09)",
  meridian: "rgba(226, 173, 76, 0.85)",
  rim: "rgba(239, 230, 208, 0.35)"
};

// Keeps roughly `max` points of a ring: plenty for a globe a few hundred pixels wide.
function thin(ring, max) {
  const step = Math.ceil(ring.length / max);
  const kept = step <= 1 ? ring : ring.filter((_, index) => index % step === 0);
  return kept.map(([lng, lat]) => ({
    lng: lng * RADIANS,
    sinLat: Math.sin(lat * RADIANS),
    cosLat: Math.cos(lat * RADIANS)
  }));
}

export function createGlobe(canvas, atlas) {
  const context = canvas.getContext("2d");

  // Outer rings only, grouped by region so one region can be lit up.
  const lands = [];
  for (const place of atlas.places) {
    const geometry = place.feature.geometry;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      const ring = polygon[0];
      if (ring.length < 8) continue;   // specks that would only add noise at this size
      lands.push({ region: place.country?.region ?? null, points: thin(ring, 90) });
    }
  }

  const graticule = [];
  for (let lng = -180; lng < 180; lng += 30) {
    graticule.push({ highlight: lng === 0, points: thin(range(-84, 84, 4).map(lat => [lng, lat]), 99) });
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    graticule.push({ highlight: false, points: thin(range(-180, 180, 4).map(lng => [lng, lat]), 99) });
  }

  let centre = { lng: 10, lat: DEFAULT_TILT };   // where the globe faces, in degrees
  let target = null;                             // set while turning to a region
  let region = null;                             // region id to light up, or null
  let running = false;
  let frame = 0;
  let last = 0;
  let width = 0;
  let height = 0;

  function resize() {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  // Traces a line or ring. Points on the far side are slid to the rim, which
  // closes shapes cleanly at the horizon. Returns false if nothing was visible.
  function trace(points, cx, cy, radius, closed) {
    const lng0 = centre.lng * RADIANS;
    const sin0 = Math.sin(centre.lat * RADIANS);
    const cos0 = Math.cos(centre.lat * RADIANS);
    let visible = false;
    let pen = false;
    for (const point of points) {
      const dLng = point.lng - lng0;
      const cosD = Math.cos(dLng);
      let x = point.cosLat * Math.sin(dLng);
      let y = cos0 * point.sinLat - sin0 * point.cosLat * cosD;
      const z = sin0 * point.sinLat + cos0 * point.cosLat * cosD;
      if (z < 0) {
        if (!closed) {
          pen = false;       // open lines simply stop at the horizon
          continue;
        }
        const length = Math.hypot(x, y) || 1;
        x /= length;
        y /= length;
      } else {
        visible = true;
      }
      const px = cx + radius * x;
      const py = cy - radius * y;
      if (pen) context.lineTo(px, py);
      else context.moveTo(px, py);
      pen = true;
    }
    if (closed) context.closePath();
    return visible;
  }

  function draw() {
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);
    // The globe is larger than its window and rises from the bottom edge.
    const radius = Math.min(width * 0.46, height * 0.82);
    const cx = width / 2;
    const cy = radius + height * 0.08;

    const ocean = context.createRadialGradient(cx - radius * 0.35, cy - radius * 0.45, radius * 0.1, cx, cy, radius);
    ocean.addColorStop(0, COLOURS.ocean[0]);
    ocean.addColorStop(1, COLOURS.ocean[1]);
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = ocean;
    context.fill();

    context.lineWidth = 1;
    context.strokeStyle = COLOURS.graticule;
    context.beginPath();
    for (const line of graticule) if (!line.highlight) trace(line.points, cx, cy, radius, false);
    context.stroke();

    const paint = (group, fill, stroke) => {
      context.beginPath();
      for (const land of group) traceLand(land.points, cx, cy, radius);
      context.fillStyle = fill;
      context.fill("evenodd");
      context.strokeStyle = stroke;
      context.lineWidth = 0.75;
      context.stroke();
    };
    paint(lands.filter(land => !region || land.region !== region), COLOURS.land, COLOURS.coast);
    if (region) paint(lands.filter(land => land.region === region), COLOURS.regionLand, COLOURS.regionCoast);

    // The prime meridian, picked out in brass.
    context.beginPath();
    for (const line of graticule) if (line.highlight) trace(line.points, cx, cy, radius, false);
    context.strokeStyle = COLOURS.meridian;
    context.lineWidth = 1.5;
    context.stroke();

    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.strokeStyle = COLOURS.rim;
    context.lineWidth = 1;
    context.stroke();
  }

  // A ring is only added to the current path if part of it faces the viewer:
  // clamped to the rim, a shape wholly on the far side would collapse into slivers.
  function traceLand(points, cx, cy, radius) {
    const lng0 = centre.lng * RADIANS;
    const sin0 = Math.sin(centre.lat * RADIANS);
    const cos0 = Math.cos(centre.lat * RADIANS);
    for (const point of points) {
      const z = sin0 * point.sinLat + cos0 * point.cosLat * Math.cos(point.lng - lng0);
      if (z > 0) {
        trace(points, cx, cy, radius, true);
        return;
      }
    }
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (target) {
      // Ease towards the region, taking the short way round.
      const dLng = ((target.lng - centre.lng + 540) % 360) - 180;
      const dLat = target.lat - centre.lat;
      const ease = 1 - Math.exp(-dt * 4);
      centre = { lng: centre.lng + dLng * ease, lat: centre.lat + dLat * ease };
    } else {
      centre = { lng: centre.lng + SPIN_DEGREES_PER_SECOND * dt, lat: centre.lat + (DEFAULT_TILT - centre.lat) * dt };
    }
    centre.lng = ((centre.lng + 540) % 360) - 180;
    draw();
    const settled = target && Math.abs(target.lng - centre.lng) < 0.05 && Math.abs(target.lat - centre.lat) < 0.05;
    frame = running && !settled ? requestAnimationFrame(tick) : 0;
  }

  function wake() {
    if (frame || !running) return;
    if (prefersReducedMotion()) {
      if (target) centre = { ...target };
      draw();
      return;
    }
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  new ResizeObserver(resize).observe(canvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      wake();
    }
  });

  return {
    // Face a region ([lng, lat] centre and its id), or pass null to spin freely.
    face(regionCentre, regionId) {
      target = regionCentre ? { lng: regionCentre[0], lat: regionCentre[1] - LOOK_SOUTH_OF_REGION } : null;
      region = regionCentre ? regionId : null;
      wake();
      if (!frame) draw();
    },
    start() {
      running = true;
      resize();
      wake();
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

function range(from, to, step) {
  const values = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}
