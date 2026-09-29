"""OpenStreetMap snapshots for Riyadh: fetching (Overpass) and parsing.

Snapshots are stored gzipped in ``transit_scope/data/osm`` so builds are
reproducible offline; ``transit fetch-osm`` refreshes them. OSM data is
© OpenStreetMap contributors, ODbL 1.0.
"""

from __future__ import annotations

import gzip
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import linemerge, polygonize, unary_union

from transit_scope.errors import InputFileError
from transit_scope.paths import DATA_DIR

OSM_DIR = DATA_DIR / "osm"

#: Overpass mirrors tried in order.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

BBOX = "24.4,46.3,25.1,47.1"
DISTRICT_BBOX = "24.5,46.45,25.0,47.0"

#: snapshot name -> Overpass QL (``{metro_ids}`` / ``{bus_ids}`` filled at fetch time)
QUERIES: dict[str, str] = {
    "metro_relations": "[out:json][timeout:180];relation(id:{metro_ids});out geom;",
    "metro_stop_nodes": "[out:json][timeout:180];relation(id:{metro_ids});node(r);out;",
    "stations": (
        f"[out:json][timeout:180];(node[\"railway\"=\"station\"]({BBOX});"
        f"node[\"public_transport\"=\"station\"]({BBOX});way[\"railway\"=\"station\"]({BBOX});"
        f"way[\"public_transport\"=\"station\"]({BBOX}););out center tags;"
    ),
    "bus_index": f"[out:json][timeout:180];relation[\"route\"=\"bus\"]({BBOX});out tags;",
    "bus_routes": "[out:json][timeout:280];relation(id:{bus_id});out geom;",
    "bus_stops": f"[out:json][timeout:240];node[\"highway\"=\"bus_stop\"]({BBOX});out;",
    "areas": (
        f"[out:json][timeout:280];(way[\"aeroway\"=\"aerodrome\"]({DISTRICT_BBOX});"
        f"relation[\"aeroway\"=\"aerodrome\"]({DISTRICT_BBOX});"
        f"way[\"amenity\"=\"university\"]({DISTRICT_BBOX});"
        f"relation[\"amenity\"=\"university\"]({DISTRICT_BBOX}););out geom;"
    ),
    "districts": (
        "[out:json][timeout:380];relation[\"boundary\"=\"administrative\"]"
        f"[\"admin_level\"~\"^(9|10)$\"]({DISTRICT_BBOX});out geom;"
    ),
}


# --------------------------------------------------------------------------- #
# Snapshot I/O
# --------------------------------------------------------------------------- #


def load_snapshot(name: str, directory: Path = OSM_DIR) -> dict:
    path = directory / f"{name}.json.gz"
    if not path.exists():
        raise InputFileError(f"OSM snapshot missing: {path}. Run `transit fetch-osm`.")
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def save_snapshot(name: str, data: dict, directory: Path = OSM_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.json.gz"
    payload = {"elements": data.get("elements", []), "osm3s": data.get("osm3s", {})}
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
    return path


def snapshot_timestamp(directory: Path = OSM_DIR) -> str:
    return load_snapshot("metro_relations", directory).get("osm3s", {}).get(
        "timestamp_osm_base", "unknown"
    )


def _overpass(query: str, retries: int = 3, timeout: int = 400) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for url in OVERPASS_URLS:
        for attempt in range(retries):
            try:
                req = urllib.request.Request(
                    url, data=body, headers={"User-Agent": "riyadh-transit-scope/0.2"}
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception as exc:  # network errors, 429/504, bad JSON
                last = exc
                time.sleep(5 * (attempt + 1))
    raise InputFileError(f"All Overpass mirrors failed: {last}")


def fetch_snapshots(metro_relation_ids: list[int], directory: Path = OSM_DIR, log=print) -> None:
    """Download fresh snapshots from Overpass (slow; minutes)."""
    ids = ",".join(str(i) for i in metro_relation_ids)
    for name in ("metro_relations", "metro_stop_nodes", "stations", "bus_stops", "districts",
                 "areas"):
        log(f"fetching {name}…")
        save_snapshot(name, _overpass(QUERIES[name].format(metro_ids=ids)), directory)
    log("fetching bus route index…")
    index = _overpass(QUERIES["bus_index"])
    elements = []
    for rel in index.get("elements", []):
        if rel.get("tags", {}).get("ref"):
            log(f"  bus route {rel['tags']['ref']}")
            elements += _overpass(QUERIES["bus_routes"].format(bus_id=rel["id"]))["elements"]
    save_snapshot("bus_routes", {"elements": elements, "osm3s": index.get("osm3s", {})},
                  directory)


# --------------------------------------------------------------------------- #
# Parsed structures
# --------------------------------------------------------------------------- #


@dataclass
class OsmStop:
    node_id: int
    lat: float
    lon: float
    name_en: str | None
    name_ar: str | None
    code: str | None
    tags: dict = field(default_factory=dict)


@dataclass
class OsmRouteDirection:
    relation_id: int
    ref: str
    name: str
    colour: str | None
    stops: list[OsmStop]
    geometry: LineString  # WGS84, stitched in stop order
    parts: int  # connected pieces before choosing the main alignment


@dataclass
class OsmBusRoute:
    relation_id: int
    ref: str
    name: str
    geometry: LineString | object
    stops: list[OsmStop]


def _stop_from(node: dict) -> OsmStop:
    tags = node.get("tags", {})
    return OsmStop(
        node_id=node["id"], lat=node["lat"], lon=node["lon"],
        name_en=tags.get("name:en"), name_ar=tags.get("name:ar") or tags.get("name"),
        code=tags.get("ref"), tags=tags,
    )


def _stitch(members: list[dict]) -> tuple[object, int]:
    segs = [
        LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
        for m in members
        if m["type"] == "way" and m["role"] in ("", "route", "forward", "backward")
        and len(m.get("geometry", [])) >= 2
    ]
    merged = linemerge(segs) if segs else LineString()
    parts = list(getattr(merged, "geoms", [merged]))
    return merged, len(parts)


def parse_metro(directory: Path = OSM_DIR) -> list[OsmRouteDirection]:
    rels = load_snapshot("metro_relations", directory)["elements"]
    nodes = {n["id"]: n for n in load_snapshot("metro_stop_nodes", directory)["elements"]}
    out = []
    for rel in rels:
        tags = rel.get("tags", {})
        stops = [
            _stop_from(nodes.get(m["ref"], {"id": m["ref"], "lat": m["lat"], "lon": m["lon"]}))
            for m in rel["members"]
            if m["type"] == "node" and m["role"].startswith("stop")
        ]
        merged, parts = _stitch(rel["members"])
        pieces = list(getattr(merged, "geoms", [merged]))
        main = max(pieces, key=lambda g: g.length)
        out.append(OsmRouteDirection(
            relation_id=rel["id"], ref=str(tags.get("ref", "")),
            name=tags.get("name:en") or tags.get("name", ""), colour=tags.get("colour"),
            stops=stops, geometry=main, parts=parts,
        ))
    return out


def parse_bus(directory: Path = OSM_DIR) -> tuple[list[OsmBusRoute], list[OsmStop]]:
    routes = []
    for rel in load_snapshot("bus_routes", directory)["elements"]:
        tags = rel.get("tags", {})
        merged, _ = _stitch(rel["members"])
        stops = [
            OsmStop(node_id=m["ref"], lat=m["lat"], lon=m["lon"], name_en=None, name_ar=None,
                    code=None)
            for m in rel["members"]
            if m["type"] == "node" and m["role"].startswith(("stop", "platform")) and "lat" in m
        ]
        routes.append(OsmBusRoute(
            relation_id=rel["id"], ref=str(tags.get("ref", "")).replace(" ", ""),
            name=tags.get("name:en") or tags.get("name") or f"Route {tags.get('ref', '')}",
            geometry=merged, stops=stops,
        ))
    stops = [_stop_from(n) for n in load_snapshot("bus_stops", directory)["elements"]]
    return routes, stops


#: Largest gap (degrees, ≈500 m) bridged when a boundary ring is broken in OSM.
RING_GAP_TOLERANCE = 0.0045


def _chain_rings(lines: list[LineString], tol: float) -> tuple[list[Polygon], float]:
    """Greedily chain open line parts into closed rings, bridging gaps ≤ ``tol``.

    Returns the rings as polygons and the largest gap bridged (degrees)."""
    parts = [list(p.coords) for p in lines]
    rings, worst = [], 0.0

    def gap(a, b):
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5

    while parts:
        ring = parts.pop(0)
        while True:
            if len(ring) > 3 and gap(ring[0], ring[-1]) <= tol:
                worst = max(worst, gap(ring[0], ring[-1]))
                rings.append(Polygon(ring + [ring[0]]))
                break
            best = None  # (gap, index, oriented coords, attach at end?)
            for i, p in enumerate(parts):
                for rev in (False, True):
                    q = p[::-1] if rev else p
                    for at_end, d in ((True, gap(ring[-1], q[0])), (False, gap(q[-1], ring[0]))):
                        if best is None or d < best[0]:
                            best = (d, i, q, at_end)
            if best is None or best[0] > tol:
                break  # cannot close: drop this fragment
            d, i, q, at_end = best
            worst = max(worst, d)
            if at_end:
                ring += q[1:] if d == 0 else q
            else:
                ring = (q[:-1] if d == 0 else q) + ring
            parts.pop(i)
    return [r if r.is_valid else r.buffer(0) for r in rings if r.area > 0], worst


def _relation_polygon(rel: dict) -> Polygon | MultiPolygon | None:
    shape, _ = relation_polygon_with_repair(rel)
    return shape


def relation_polygon_with_repair(rel: dict) -> tuple[Polygon | MultiPolygon | None, float]:
    """Assemble a boundary relation; returns (geometry, largest gap bridged in degrees)."""
    outer = [
        LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
        for m in rel["members"]
        if m["type"] == "way" and m["role"] in ("outer", "") and len(m.get("geometry", [])) >= 2
    ]
    inner = [
        LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
        for m in rel["members"]
        if m["type"] == "way" and m["role"] == "inner" and len(m.get("geometry", [])) >= 2
    ]
    polys = list(polygonize(unary_union(outer))) if outer else []
    repaired = 0.0
    if not polys and outer:
        union = unary_union(outer)
        merged = linemerge(union) if union.geom_type == "MultiLineString" else union
        pieces = list(getattr(merged, "geoms", [merged]))
        polys, repaired = _chain_rings(pieces, RING_GAP_TOLERANCE)
    if not polys:
        return None, repaired
    shape = unary_union(polys)
    if inner:
        holes = list(polygonize(unary_union(inner)))
        if holes:
            shape = shape.difference(unary_union(holes))
    return (shape if shape.is_valid else shape.buffer(0)), repaired


def parse_districts(directory: Path = OSM_DIR) -> list[dict]:
    """Admin level 10 (neighbourhoods) and 9 (municipalities) as dicts with geometry."""
    out = []
    for rel in load_snapshot("districts", directory)["elements"]:
        tags = rel.get("tags", {})
        geom, repaired = relation_polygon_with_repair(rel)
        if geom is None or geom.is_empty:
            out.append({"osm_id": rel["id"], "admin_level": int(tags.get("admin_level", 0)),
                        "name_en": tags.get("name:en") or tags.get("name", ""),
                        "name_ar": tags.get("name:ar") or tags.get("name", ""),
                        "geometry": None, "repaired_gap_m": None})
            continue
        out.append({
            "osm_id": rel["id"],
            "admin_level": int(tags.get("admin_level", 0)),
            "name_en": tags.get("name:en") or tags.get("name", ""),
            "name_ar": tags.get("name:ar") or tags.get("name", ""),
            "geometry": geom,
            "repaired_gap_m": round(repaired * 111_000, 1) if repaired else 0.0,
        })
    return out


def parse_areas(directory: Path = OSM_DIR) -> list[dict]:
    """Named airport and campus polygons (fallback areas outside municipal districts)."""
    out = []
    for e in load_snapshot("areas", directory)["elements"]:
        tags = e.get("tags", {})
        name = tags.get("name:en") or tags.get("name")
        if not name:
            continue
        if e["type"] == "way" and len(e.get("geometry", [])) >= 4:
            geom = Polygon([(p["lon"], p["lat"]) for p in e["geometry"]])
        elif e["type"] == "relation":
            geom = _relation_polygon(e)
        else:
            continue
        if geom is None or geom.is_empty:
            continue
        out.append({"name_en": name, "name_ar": tags.get("name:ar") or tags.get("name"),
                    "kind": tags.get("aeroway") or tags.get("amenity"),
                    "geometry": geom if geom.is_valid else geom.buffer(0)})
    return out


def point_of(stop: OsmStop) -> Point:
    return Point(stop.lon, stop.lat)
