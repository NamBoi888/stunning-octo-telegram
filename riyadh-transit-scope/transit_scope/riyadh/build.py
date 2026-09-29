"""Build the Riyadh dataset from OSM snapshots + official reference.

Outputs (written to ``transit_scope/data`` by default):

* ``riyadh_metro_gtfs.zip`` — GTFS for the six metro lines: real station
  positions and alignments from OSM, official station names/order, parent
  stations for interchanges, Arabic names in ``translations.txt`` and a
  timetable generated from the documented service plan;
* ``riyadh_stations.geojson`` — one point per physical station (EN/AR name,
  codes, lines, district);
* ``riyadh_districts.geojson`` — OSM neighbourhood boundaries (admin level 10);
* ``riyadh_bus_osm.geojson`` — the Riyadh Bus routes and stops mapped in OSM
  (partial coverage, see validation).
"""

from __future__ import annotations

import csv
import difflib
import io
import json
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point, mapping
from shapely.ops import substring, transform

from transit_scope.paths import DATA_DIR
from transit_scope.riyadh.osm import (
    OSM_DIR,
    OsmRouteDirection,
    OsmStop,
    load_snapshot,
    parse_areas,
    parse_bus,
    parse_districts,
    parse_metro,
    snapshot_timestamp,
)
from transit_scope.riyadh.reference import RiyadhReference, load_reference
from transit_scope.utils.timeutil import parse_hhmm

UTM = "EPSG:32638"
_FWD = Transformer.from_crs("EPSG:4326", UTM, always_xy=True).transform
_INV = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True).transform

from transit_scope.paths import (  # noqa: E402
    BUS_NAME,
    DISTRICTS_NAME,
    GTFS_NAME,
    STATIONS_NAME,
)

#: Similarity at or above which an OSM English name is treated as the same
#: station as the reference name at the same position.
NAME_MATCH = 0.72

_SPELLING = [
    (r"\bfahad\b", "fahd"), (r"\brasheed\b", "rashid"), (r"\bdefence\b", "defense"),
    (r"\bmuorabba\b", "murabba"), (r"\bbat'?ha\b", "batha"), (r"\bsab bank\b", "sabb"),
    (r"\bking abdullah financial district\b", "kafd"),
    (r"\bking abdulaziz city for science and technology\b", "kacst"),
    (r"\bking fahad? (sports city|stadium)( station)?\b", "king fahd sports city"),
    (r"\bdr\.? ", "dr "), (r"\bsulaiman al habib group\b", "sulaiman al habib"),
    (r"\bt(\d)[-–](\d)\b", r"t\1 \2"),
]
_STOPWORDS = {"al", "ad", "an", "ar", "as", "at", "station", "the"}


def normalise(name: str | None) -> str:
    """Normalise a station name for fuzzy comparison."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    for pattern, repl in _SPELLING:
        text = re.sub(pattern, repl, text)
    text = re.sub(r"[-_'’.,&()]", " ", text)
    return " ".join(t for t in text.split() if t not in _STOPWORDS)


def similarity(a: str | None, b: str | None) -> float:
    na, nb = normalise(a), normalise(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


def slug(name: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", normalise(name).upper()).strip("_") or "X"


# --------------------------------------------------------------------------- #
# Reconciliation
# --------------------------------------------------------------------------- #


@dataclass
class StopMatch:
    position: int
    reference_name: str
    osm_name_en: str | None
    osm_name_ar: str | None
    code: str | None
    score: float
    resolution: str  # exact | fuzzy | filled | renamed
    lat: float
    lon: float


@dataclass
class ReconciledLine:
    ref: str
    name: str
    name_ar: str
    colour: str
    directions: dict[int, OsmRouteDirection]  # 0 = reference order, 1 = reverse
    matches: list[StopMatch]
    issues: list[str] = field(default_factory=list)
    lengths_km: dict[int, float] = field(default_factory=dict)
    shapes: dict[int, LineString] = field(default_factory=dict)  # UTM, oriented, clipped
    stop_offsets_m: dict[int, list[float]] = field(default_factory=dict)  # along-track per dir


def _direction_score(direction: OsmRouteDirection, ref_list: list[str]) -> float:
    if not direction.stops:
        return -1
    first, last = direction.stops[0], direction.stops[-1]
    return similarity(first.name_en, ref_list[0]) + similarity(last.name_en, ref_list[-1])


def _orient_directions(
    dirs: list[OsmRouteDirection], ref_list: list[str]
) -> dict[int, OsmRouteDirection]:
    """Assign direction 0 to the relation running in reference order."""
    if len(dirs) == 1:
        return {0: dirs[0]}
    scored = sorted(dirs, key=lambda d: _direction_score(d, ref_list), reverse=True)
    forward = scored[0]
    # The reverse relation is the one whose first stop is the forward relation's last stop.
    rest = [d for d in dirs if d is not forward]
    reverse = min(
        rest,
        key=lambda d: Point(d.stops[0].lon, d.stops[0].lat).distance(
            Point(forward.stops[-1].lon, forward.stops[-1].lat)) if d.stops else 1e9,
    )
    return {0: forward, 1: reverse}


def _oriented_shape(direction: OsmRouteDirection) -> tuple[LineString, list[float]]:
    """UTM alignment clipped to first..last stop, plus along-track stop offsets."""
    line = transform(_FWD, direction.geometry)
    pts = [transform(_FWD, Point(s.lon, s.lat)) for s in direction.stops]
    d = [line.project(p) for p in pts]
    if d[0] > d[-1]:
        line = LineString(list(line.coords)[::-1])
        d = [line.project(p) for p in pts]
    clipped = substring(line, d[0], d[-1])
    offsets = [clipped.project(p) for p in pts]
    return clipped, offsets


def reconcile(reference: RiyadhReference, osm_dir: Path = OSM_DIR) -> list[ReconciledLine]:
    by_relation = {d.relation_id: d for d in parse_metro(osm_dir)}
    out = []
    for lref in reference.lines:
        dirs = [by_relation[r] for r in lref.osm_relations if r in by_relation]
        issues = []
        if len(dirs) != len(lref.osm_relations):
            issues.append(f"missing OSM relations for line {lref.ref}")
        if not dirs:
            out.append(ReconciledLine(lref.ref, lref.name, lref.name_ar, "#888888", {}, [], issues))
            continue
        oriented = _orient_directions(dirs, lref.station_list)
        forward = oriented[0]
        matches = []
        if len(forward.stops) == len(lref.station_list):
            pairs = zip(forward.stops, lref.station_list, strict=True)
            for i, (stop, ref_name) in enumerate(pairs):
                score = similarity(stop.name_en, ref_name)
                if not stop.name_en:
                    resolution = "filled"
                elif score == 1.0:
                    resolution = "exact"
                elif score >= NAME_MATCH:
                    resolution = "fuzzy"
                else:
                    resolution = "renamed"
                matches.append(StopMatch(i, ref_name, stop.name_en, stop.name_ar, stop.code,
                                         round(score, 3), resolution, stop.lat, stop.lon))
        else:
            issues.append(
                f"line {lref.ref}: OSM has {len(forward.stops)} stops, reference lists "
                f"{len(lref.station_list)}"
            )
        colour = forward.colour or "#888888"
        rec = ReconciledLine(lref.ref, lref.name, lref.name_ar, colour.upper(), oriented, matches,
                             issues)
        for idx, direction in oriented.items():
            shape, offsets = _oriented_shape(direction)
            rec.shapes[idx] = shape
            rec.stop_offsets_m[idx] = offsets
            rec.lengths_km[idx] = shape.length / 1000
        out.append(rec)
    return out


# --------------------------------------------------------------------------- #
# Stations
# --------------------------------------------------------------------------- #


@dataclass
class Station:
    key: str  # slug of the canonical name
    name: str
    name_ar: str | None
    lines: list[str]
    codes: list[str]
    platforms: dict[str, tuple[float, float]]  # line ref -> (lat, lon)
    lat: float
    lon: float
    spread_m: float
    district_en: str | None = None
    district_ar: str | None = None
    municipality: str | None = None
    area: str | None = None  # airport / campus when outside municipal districts
    feature_name_en: str | None = None  # nearest independently mapped OSM station feature
    feature_distance_m: float | None = None
    feature_agrees: bool | None = None
    aliases: list[str] = field(default_factory=list)


def _mean(points: list[tuple[float, float]]) -> tuple[float, float]:
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def build_stations(lines: list[ReconciledLine]) -> list[Station]:
    """Group stops by canonical (official) name into physical stations."""
    groups: dict[str, dict] = {}
    for line in lines:
        rev = line.directions.get(1)
        for m in line.matches:
            g = groups.setdefault(slug(m.reference_name), {
                "name": m.reference_name, "ar": [], "codes": [], "platforms": {}, "lines": []})
            coords = [(m.lat, m.lon)]
            if rev is not None and len(rev.stops) == len(line.matches):
                opp = rev.stops[len(line.matches) - 1 - m.position]
                coords.append((opp.lat, opp.lon))
                if opp.name_ar:
                    g["ar"].append(opp.name_ar)
            g["platforms"][line.ref] = _mean(coords)
            g["lines"].append(line.ref)
            if m.osm_name_en and m.resolution == "renamed":
                g.setdefault("aliases", []).append(m.osm_name_en)
            if m.osm_name_ar and m.resolution != "renamed":
                g["ar"].append(m.osm_name_ar)
            if m.code:
                g["codes"].extend(c for c in m.code.split("/") if c)
    stations = []
    for key, g in groups.items():
        pts = list(g["platforms"].values())
        utm = [transform(_FWD, Point(lon, lat)) for lat, lon in pts]
        spread = max((a.distance(b) for a in utm for b in utm), default=0.0)
        lat, lon = _mean(pts)
        ar_names = [clean_arabic(a) for a in g["ar"]]
        ar_names = [a for a in ar_names if a]
        # Most frequent spelling; ties broken deterministically (shortest, then lexical).
        ar = min(set(ar_names), key=lambda a: (-ar_names.count(a), len(a), a)) if ar_names else None
        stations.append(Station(
            key=key, name=g["name"], name_ar=ar, lines=sorted(set(g["lines"])),
            codes=sorted(set(g["codes"])), platforms=g["platforms"], lat=lat, lon=lon,
            spread_m=round(spread, 1), aliases=sorted(set(g.get("aliases", []))),
        ))
    return sorted(stations, key=lambda s: (s.lines[0], s.name))


_ARABIC = re.compile(r"[\u0600-\u06FF]")


def clean_arabic(text: str | None) -> str | None:
    """Keep only genuine Arabic-script names, without the generic "محطة" (station) prefix."""
    if not text or not _ARABIC.search(text):
        return None
    text = re.sub(r"[A-Za-z][A-Za-z .'-]*", " ", text)  # drop embedded Latin transliterations
    text = re.sub(r"^\s*محطة\s+", "", " ".join(text.split())).strip(" -–")
    return text if _ARABIC.search(text) and text != "محطة" else None


#: Max distance from a station to an independently mapped OSM station feature.
FEATURE_RADIUS_M = 250


def cross_check_features(stations: list[Station], osm_dir: Path = OSM_DIR) -> None:
    """Match each station to the nearest OSM station feature (a second, independent
    OSM object class) to confirm position and name and to source Arabic names."""
    feats = []
    for e in load_snapshot("stations", osm_dir)["elements"]:
        tags = e.get("tags", {})
        if tags.get("station") not in ("subway", None) or tags.get("railway") not in (
                "station", "halt", None):
            continue
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        if lat is None or not (tags.get("station") == "subway"
                               or tags.get("network") == "Riyadh Metro"):
            continue
        en = tags.get("name:en") or (tags.get("name") if not _ARABIC.search(
            tags.get("name", "")) else None)
        ar = clean_arabic(tags.get("name:ar")) or clean_arabic(tags.get("name"))
        feats.append((transform(_FWD, Point(lon, lat)), en, ar))
    for st in stations:
        p = transform(_FWD, Point(st.lon, st.lat))
        near = sorted(((p.distance(f[0]), f) for f in feats), key=lambda x: x[0])
        near = [(d, f) for d, f in near if d <= FEATURE_RADIUS_M]
        if not near:
            continue
        agreeing = [(d, f) for d, f in near if similarity(f[1], st.name) >= NAME_MATCH]
        d, f = (agreeing or near)[0]
        st.feature_name_en, st.feature_distance_m = f[1], round(d, 1)
        st.feature_agrees = bool(agreeing)
        if st.feature_agrees and f[2] and not st.name_ar:
            st.name_ar = f[2]
        if not st.feature_agrees and f[1] and f[1] not in st.aliases:
            st.aliases.append(f[1])


def assign_districts(
    stations: list[Station], districts: list[dict], areas: list[dict] | None = None
) -> None:
    level10 = [d for d in districts if d["admin_level"] == 10]
    level9 = [d for d in districts if d["admin_level"] == 9]
    for st in stations:
        p = Point(st.lon, st.lat)
        muni = next((d for d in level9 if d["geometry"].contains(p)), None)
        st.municipality = muni["name_en"] if muni else None
        hit = next((d for d in level10 if d["geometry"].contains(p)), None)
        if hit is None and level10:  # on a boundary road: nearest polygon within ~300 m
            near = min(level10, key=lambda d: d["geometry"].distance(p))
            if near["geometry"].distance(p) < 0.003:
                hit = near
        if hit:
            st.district_en, st.district_ar = hit["name_en"], hit["name_ar"]
        if not hit and not muni and areas:
            # Stations serving the airport/campus sit outside municipal districts; use the
            # containing (or adjacent, ≤ 500 m) named area.
            near = min(areas, key=lambda a: a["geometry"].distance(p))
            if near["geometry"].distance(p) < 0.0045:
                st.area = near["name_en"]


# --------------------------------------------------------------------------- #
# GTFS
# --------------------------------------------------------------------------- #


def _csv(rows: list[dict], fields: list[str]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def _fmt(t: int) -> str:
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def _in_windows(t: int, windows: list[tuple[int, int]]) -> bool:
    return any(a <= t < b for a, b in windows)


def build_gtfs_tables(
    reference: RiyadhReference, lines: list[ReconciledLine], stations: list[Station]
) -> dict[str, str]:
    plan = reference.service_plan
    windows = []
    for w in plan.peak_windows:
        a, b = w.split("-")
        windows.append((parse_hhmm(a), parse_hhmm(b)))

    stops, translations = [], []
    for st in stations:
        parent = f"ST_{st.key}"
        stops.append({"stop_id": parent, "stop_code": "", "stop_name": st.name,
                      "stop_lat": f"{st.lat:.6f}", "stop_lon": f"{st.lon:.6f}",
                      "location_type": 1, "parent_station": ""})
        if st.name_ar:
            translations.append({"table_name": "stops", "field_name": "stop_name",
                                 "language": "ar", "translation": st.name_ar,
                                 "record_id": parent})
        for ref, (lat, lon) in sorted(st.platforms.items()):
            pid = f"L{ref}_{st.key}"
            code = next((c for c in st.codes if c.startswith(ref)), "")
            stops.append({"stop_id": pid, "stop_code": code, "stop_name": st.name,
                          "stop_lat": f"{lat:.6f}", "stop_lon": f"{lon:.6f}",
                          "location_type": 0, "parent_station": parent})
            if st.name_ar:
                translations.append({"table_name": "stops", "field_name": "stop_name",
                                     "language": "ar", "translation": st.name_ar,
                                     "record_id": pid})

    routes, trips, stop_times, shapes, calendar = [], [], [], [], []
    for cal_id, cal in plan.calendars.items():
        row = {d: 0 for d in ("monday", "tuesday", "wednesday", "thursday", "friday",
                              "saturday", "sunday")}
        row.update({d: 1 for d in cal.days})
        calendar.append({"service_id": cal_id, **row, "start_date": "20250101",
                         "end_date": "20271231"})

    speed = plan.running_speed_kmh / 3.6
    for line in lines:
        routes.append({"route_id": f"M{line.ref}", "agency_id": "RM",
                       "route_short_name": line.ref, "route_long_name": line.name,
                       "route_type": 1, "route_color": line.colour.lstrip("#"),
                       "route_text_color": "000000" if line.ref == "4" else "FFFFFF"})
        translations.append({"table_name": "routes", "field_name": "route_long_name",
                             "language": "ar", "translation": line.name_ar,
                             "record_id": f"M{line.ref}"})
        names = [m.reference_name for m in line.matches]
        hw = plan.headways_min[line.ref]
        for direction, shape in line.shapes.items():
            seq = names if direction == 0 else names[::-1]
            shape_id = f"M{line.ref}_{direction}"
            wgs = transform(_INV, shape.simplify(3.0))
            for i, (lon, lat) in enumerate(wgs.coords):
                shapes.append({"shape_id": shape_id, "shape_pt_lat": f"{lat:.6f}",
                               "shape_pt_lon": f"{lon:.6f}", "shape_pt_sequence": i})
            offsets = line.stop_offsets_m[direction]
            if len(offsets) != len(seq):  # fall back to forward offsets mirrored
                fwd = line.stop_offsets_m[0]
                offsets = [fwd[-1] - o for o in fwd[::-1]] if direction else fwd
            for cal_id, cal in plan.calendars.items():
                start, end = parse_hhmm(cal.start), parse_hhmm(cal.end)
                friday = cal_id == "FRI"
                t, n = start, 0
                while t < end:
                    trip_id = f"M{line.ref}_{cal_id}_{direction}_{n:03d}"
                    trips.append({"route_id": f"M{line.ref}", "service_id": cal_id,
                                  "trip_id": trip_id, "direction_id": direction,
                                  "shape_id": shape_id, "trip_headsign": seq[-1]})
                    clock = t
                    for i, name in enumerate(seq):
                        dep = clock if i in (0, len(seq) - 1) else clock + int(plan.dwell_s)
                        stop_times.append({
                            "trip_id": trip_id, "arrival_time": _fmt(clock),
                            "departure_time": _fmt(dep), "stop_id": f"L{line.ref}_{slug(name)}",
                            "stop_sequence": i + 1,
                            "shape_dist_traveled": f"{offsets[i]:.1f}"})
                        if i < len(seq) - 1:
                            clock = dep + int(round((offsets[i + 1] - offsets[i]) / speed))
                    step = plan.friday_headway_min if friday else (
                        hw.peak if _in_windows(t, windows) else hw.offpeak)
                    t += int(step * 60)
                    n += 1

    agency = [{"agency_id": "RM", "agency_name": "Riyadh Metro (unofficial feed derived from "
               "OpenStreetMap + published figures)", "agency_url":
               "https://www.openstreetmap.org/copyright", "agency_timezone": "Asia/Riyadh",
               "agency_lang": "en"}]
    feed_info = [{"feed_publisher_name": "riyadh-transit-scope",
                  "feed_publisher_url": "https://www.openstreetmap.org/copyright",
                  "feed_lang": "en", "feed_version": f"osm-{snapshot_timestamp()}"}]
    return {
        "agency.txt": _csv(agency, list(agency[0])),
        "stops.txt": _csv(stops, list(stops[0])),
        "routes.txt": _csv(routes, list(routes[0])),
        "trips.txt": _csv(trips, list(trips[0])),
        "stop_times.txt": _csv(stop_times, list(stop_times[0])),
        "shapes.txt": _csv(shapes, list(shapes[0])),
        "calendar.txt": _csv(calendar, list(calendar[0])),
        "translations.txt": _csv(translations, list(translations[0])),
        "feed_info.txt": _csv(feed_info, list(feed_info[0])),
    }


# --------------------------------------------------------------------------- #
# GeoJSON layers
# --------------------------------------------------------------------------- #


def _round(obj):
    if isinstance(obj, float):
        return round(obj, 6)
    if isinstance(obj, (list, tuple)):
        return [_round(o) for o in obj]
    if isinstance(obj, dict):
        return {k: _round(v) for k, v in obj.items()}
    return obj


def _fc(features: list[dict], name: str) -> str:
    data = {"type": "FeatureCollection", "name": name,
            "attribution": "© OpenStreetMap contributors, ODbL 1.0", "features": features}
    return json.dumps(_round(data), ensure_ascii=False, separators=(",", ":")) + "\n"


def stations_geojson(stations: list[Station]) -> str:
    return _fc([{
        "type": "Feature",
        "properties": {"station_id": f"ST_{s.key}", "name": s.name, "name_ar": s.name_ar,
                       "lines": s.lines, "codes": s.codes, "interchange": len(s.lines) > 1,
                       "spread_m": s.spread_m, "district": s.district_en,
                       "district_ar": s.district_ar, "municipality": s.municipality,
                       "area": s.area,
                       "aliases": s.aliases},
        "geometry": {"type": "Point", "coordinates": [s.lon, s.lat]},
    } for s in stations], "riyadh_metro_stations")


def districts_geojson(districts: list[dict]) -> str:
    level9 = [d for d in districts if d["admin_level"] == 9]
    feats = []
    for d in sorted((d for d in districts if d["admin_level"] == 10), key=lambda d: d["name_en"]):
        rp = d["geometry"].representative_point()
        muni = next((m for m in level9 if m["geometry"].contains(rp)), None)
        area = transform(_FWD, d["geometry"]).area / 1e6
        feats.append({
            "type": "Feature",
            "properties": {"osm_id": d["osm_id"], "name": d["name_en"], "name_ar": d["name_ar"],
                           "municipality": muni["name_en"] if muni else None,
                           "area_km2": round(area, 2)},
            "geometry": mapping(d["geometry"].simplify(0.00012, preserve_topology=True)),
        })
    return _fc(feats, "riyadh_districts_osm")


def bus_geojson(routes, stops: list[OsmStop]) -> str:
    feats = []
    seen = set()
    for r in routes:
        base = re.sub(r"_?d1$", "", r.ref)
        if base in seen or r.geometry.is_empty:
            continue  # one direction per route is enough for mapping
        seen.add(base)
        feats.append({"type": "Feature",
                      "properties": {"kind": "route", "ref": base, "name": r.name,
                                     "brt": base.upper().startswith("BRT"),
                                     "osm_id": r.relation_id},
                      "geometry": mapping(r.geometry.simplify(0.00003))})
    for s in stops:
        feats.append({"type": "Feature",
                      "properties": {"kind": "stop", "name": s.name_en or s.name_ar,
                                     "osm_id": s.node_id},
                      "geometry": {"type": "Point", "coordinates": [s.lon, s.lat]}})
    return _fc(feats, "riyadh_bus_osm")


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


@dataclass
class RiyadhDataset:
    reference: RiyadhReference
    lines: list[ReconciledLine]
    stations: list[Station]
    districts: list[dict]
    bus_routes: list
    bus_stops: list[OsmStop]
    gtfs_tables: dict[str, str]
    failed_districts: list[dict] = field(default_factory=list)


def assemble(osm_dir: Path = OSM_DIR) -> RiyadhDataset:
    reference = load_reference()
    lines = reconcile(reference, osm_dir)
    stations = build_stations(lines)
    cross_check_features(stations, osm_dir)
    parsed = parse_districts(osm_dir)
    districts = [d for d in parsed if d["geometry"] is not None]
    failed = [d for d in parsed if d["geometry"] is None]
    assign_districts(stations, districts, parse_areas(osm_dir))
    bus_routes, bus_stops = parse_bus(osm_dir)
    tables = build_gtfs_tables(reference, lines, stations)
    return RiyadhDataset(reference, lines, stations, districts, bus_routes, bus_stops, tables,
                         failed_districts=failed)


def write_dataset(ds: RiyadhDataset, out_dir: Path = DATA_DIR) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    gtfs = out_dir / GTFS_NAME
    with zipfile.ZipFile(gtfs, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, text in ds.gtfs_tables.items():
            info = zipfile.ZipInfo(name, date_time=(2025, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, text)
    paths = {"gtfs": gtfs}
    for key, name, text in (
        ("stations", STATIONS_NAME, stations_geojson(ds.stations)),
        ("districts", DISTRICTS_NAME, districts_geojson(ds.districts)),
        ("bus", BUS_NAME, bus_geojson(ds.bus_routes, ds.bus_stops)),
    ):
        path = out_dir / name
        path.write_text(text, encoding="utf-8")
        paths[key] = path
    return paths
