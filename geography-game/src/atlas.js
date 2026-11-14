// The atlas joins the boundary file to the country data: one "place" per
// outline on the map, with the geometry facts the map needs to zoom to it.

import { describeShape } from "./geo.js";

// topology:  the TopoJSON from data/world.topo.json
// countries: Map of country objects by code
export function buildAtlas(topology, countries) {
  const features = window.topojson.feature(topology, topology.objects.countries).features;
  const places = features.map(feature => {
    const country = feature.id ? countries.get(feature.id) : null;
    return {
      key: feature.id ?? feature.properties.name,
      country,                                   // null for the few outlines with no ISO code
      fallbackName: feature.properties?.name ?? "an unnamed territory",
      feature,
      shape: describeShape(feature.geometry)
    };
  });
  const byKey = new Map(places.map(place => [place.key, place]));
  return {
    places,
    get: key => byKey.get(key),
    // Read at use, so names refreshed from live data are picked up.
    nameOf: place => place.country?.name ?? place.fallbackName
  };
}
