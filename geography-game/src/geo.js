// Geometry helpers for country shapes. Coordinates are GeoJSON order,
// [longitude, latitude], unless a name says "latlng".

const RADIANS = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

// Great-circle distance between two [lat, lng] points.
export function distanceKm(a, b) {
  const dLat = (b[0] - a[0]) * RADIANS;
  const dLng = (b[1] - a[1]) * RADIANS;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * RADIANS) * Math.cos(b[0] * RADIANS) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

// Which way you would set off from one [lat, lng] point to reach another.
export function compassDirection(from, to) {
  const lat1 = from[0] * RADIANS;
  const lat2 = to[0] * RADIANS;
  const dLng = (to[1] - from[1]) * RADIANS;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) / RADIANS + 360) % 360;
  return COMPASS[Math.round(bearing / 45) % 8];
}

function ringStats(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let twiceArea = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
    if (x2 < minX) minX = x2;
    if (x2 > maxX) maxX = x2;
    if (y2 < minY) minY = y2;
    if (y2 > maxY) maxY = y2;
  }
  const centre = twiceArea
    ? [cx / (3 * twiceArea), cy / (3 * twiceArea)]
    : [(minX + maxX) / 2, (minY + maxY) / 2];
  // Scale by latitude so that a degree of longitude near the poles counts for less.
  const area = Math.abs(twiceArea / 2) * Math.cos(((minY + maxY) / 2) * RADIANS);
  return { bbox: [minX, minY, maxX, maxY], centre, area };
}

// Gap in degrees between two boxes (0 if they overlap), measured the short
// way round the globe.
function boxGap(a, b) {
  const gap = (lo1, hi1, lo2, hi2) => Math.max(0, lo2 - hi1, lo1 - hi2);
  const lngGap = Math.min(
    gap(a[0], a[2], b[0], b[2]),
    gap(a[0], a[2], b[0] + 360, b[2] + 360),
    gap(a[0], a[2], b[0] - 360, b[2] - 360)
  );
  return Math.max(lngGap, gap(a[1], a[3], b[1], b[3]));
}

const FOCUS_REACH_DEGREES = 25;
const FOCUS_AREA_SHARE = 0.9;

// Summarises a Polygon or MultiPolygon for the map:
//
//   labelLatLng  where to pin a label or a hit target ([lat, lng])
//   focus        the box to zoom to, [[south, west], [north, east]]
//   span         rough size of the largest landmass in degrees; decides when
//                a country is too small to click and needs a dot
//
// `focus` covers the country's main landmasses and leaves out far-flung
// territory, so France zooms to Europe and not to a view spanning the Atlantic.
export function describeShape(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const parts = polygons.map(polygon => ringStats(polygon[0])).sort((a, b) => b.area - a.area);
  const anchor = parts[0];

  const nearby = parts.filter(part => boxGap(anchor.bbox, part.bbox) <= FOCUS_REACH_DEGREES);
  const nearbyArea = nearby.reduce((sum, part) => sum + part.area, 0);
  let [west, south, east, north] = anchor.bbox;
  let covered = 0;
  for (const part of nearby) {
    if (covered >= nearbyArea * FOCUS_AREA_SHARE) break;
    covered += part.area;
    // Unwrap longitudes so islands just across the antimeridian stay adjacent.
    let shift = 0;
    if (part.bbox[0] - anchor.bbox[2] > 180) shift = -360;
    else if (anchor.bbox[0] - part.bbox[2] > 180) shift = 360;
    west = Math.min(west, part.bbox[0] + shift);
    east = Math.max(east, part.bbox[2] + shift);
    south = Math.min(south, part.bbox[1]);
    north = Math.max(north, part.bbox[3]);
  }
  west = Math.max(west, -180);
  east = Math.min(east, 180);

  // Geometric mean of the box sides, so a long thin country (The Gambia)
  // counts as small even though it is wide.
  const midLat = (anchor.bbox[1] + anchor.bbox[3]) / 2;
  const span = Math.sqrt(
    (anchor.bbox[2] - anchor.bbox[0]) * Math.cos(midLat * RADIANS) * (anchor.bbox[3] - anchor.bbox[1])
  );

  return {
    labelLatLng: [anchor.centre[1], anchor.centre[0]],
    focus: [[south, west], [north, east]],
    span
  };
}
