"""Deterministic generator for the bundled Riyadh sample data.

.. warning::
   This is **mock data for demonstration and testing**. Station locations
   and line alignments are simplified approximations of the Riyadh Metro
   network, and all timetables are synthetic. Do not use it for planning
   decisions — load an official GTFS feed instead.

The generator produces:

* ``riyadh_sample_gtfs.zip`` — 6 metro lines + 3 bus routes, weekday
  (Sun–Thu) and weekend (Fri–Sat) calendars, shapes and stop_times.
* ``riyadh_districts.geojson`` — Voronoi-derived district polygons clipped
  to an approximate urban boundary.

Run ``python -m transit_scope.sample_data`` to regenerate into ``data/``.
"""

from __future__ import annotations

import csv
import io
import json
import math
import zipfile
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import MultiPoint, Polygon, mapping
from shapely.ops import transform, voronoi_diagram

from transit_scope.utils.geo import RIYADH_UTM, haversine_m

# --------------------------------------------------------------------------- #
# Stations (approximate, mock)
# --------------------------------------------------------------------------- #

STATIONS: dict[str, tuple[str, float, float]] = {
    # id: (name, lat, lon)
    "SAH": ("Al Sahafah", 24.8050, 46.6320),
    "AQQ": ("Al Aqiq", 24.7840, 46.6380),
    "KAFD": ("KAFD", 24.7650, 46.6430),
    "MUR": ("Al Muruj", 24.7480, 46.6550),
    "OKA": ("Olaya – King Abdullah Rd", 24.7330, 46.6630),
    "OLY": ("Al Olaya", 24.7110, 46.6740),
    "KFR": ("King Fahd Rd South", 24.6800, 46.6880),
    "NMU": ("National Museum", 24.6470, 46.7110),
    "QHK": ("Qasr Al Hokm", 24.6310, 46.7130),
    "BTH": ("Al Batha", 24.6130, 46.7240),
    "AZZ": ("Al Aziziyah", 24.5800, 46.7480),
    "DAB": ("Dar Al Bayda", 24.5580, 46.7630),
    "KSU": ("King Saud University", 24.7200, 46.6230),
    "KSO": ("King Salman Oasis", 24.7270, 46.6420),
    "WRD": ("Al Wurud", 24.7380, 46.6800),
    "KAZ": ("King Abdulaziz Rd", 24.7420, 46.6960),
    "NZH": ("Al Nuzhah", 24.7520, 46.7180),
    "HMR": ("Al Hamra", 24.7640, 46.7500),
    "KHL": ("Al Khaleej", 24.7730, 46.7850),
    "KFS": ("King Fahd Stadium", 24.7880, 46.8380),
    "TWQ": ("Tuwaiq", 24.5970, 46.5400),
    "SWD": ("Al Suwaidi", 24.6070, 46.5900),
    "SHM": ("Al Shumaisi", 24.6240, 46.6700),
    "MRQ": ("Al Marqab", 24.6440, 46.7410),
    "JZR": ("Al Jazirah", 24.6700, 46.7780),
    "RWD": ("Al Rawdah", 24.6980, 46.8030),
    "NSM": ("Al Naseem", 24.7280, 46.8250),
    "KHA": ("Khashm Al An", 24.7400, 46.8700),
    "MRB": ("Al Murabba", 24.6640, 46.7070),
    "WZR": ("Al Wizarat", 24.6850, 46.7020),
    "SLM": ("Al Sulimaniyah", 24.7150, 46.6990),
    "GDR": ("Al Ghadir", 24.7720, 46.6710),
    "NFL": ("Al Nafl", 24.7880, 46.6900),
    "IMU": ("Imam University", 24.8150, 46.7110),
    "PNU": ("Princess Nourah University", 24.8470, 46.7230),
    "AT5": ("Airport Terminal 5", 24.9340, 46.7090),
    "AT1": ("Airport Terminals 1–2", 24.9570, 46.6990),
    "NDA": ("Al Nada", 24.7880, 46.7250),
    "RWB": ("Al Rawabi", 24.7450, 46.7850),
    # Bus-only stops
    "DIR": ("Diriyah Gate", 24.7340, 46.5760),
    "TKH": ("Al Takhassusi", 24.7050, 46.6550),
    "MLZ": ("Al Malaz", 24.6630, 46.7350),
    "MNS": ("Al Manar", 24.7300, 46.7650),
    "YRM": ("Al Yarmuk", 24.8120, 46.7750),
}

# (route_id, short, long, route_type, colour, stations, peak_hw_min, offpeak_hw_min)
LINES: list[tuple[str, str, str, int, str, list[str], float, float]] = [
    ("M1", "1", "Blue Line: Al Sahafah – Dar Al Bayda", 1, "0072CE",
     ["SAH", "AQQ", "KAFD", "MUR", "OKA", "OLY", "KFR", "NMU", "QHK", "BTH", "AZZ", "DAB"],
     4, 8),
    ("M2", "2", "Red Line: King Saud University – King Fahd Stadium", 1, "E4002B",
     ["KSU", "KSO", "OKA", "WRD", "KAZ", "NZH", "HMR", "KHL", "KFS"], 5, 10),
    ("M3", "3", "Orange Line: Tuwaiq – Khashm Al An", 1, "FF8200",
     ["TWQ", "SWD", "SHM", "QHK", "MRQ", "JZR", "RWD", "NSM", "KHA"], 5, 10),
    ("M4", "4", "Yellow Line: KAFD – Airport", 1, "FFC72C",
     ["KAFD", "GDR", "NFL", "IMU", "PNU", "AT5", "AT1"], 6, 12),
    ("M5", "5", "Green Line: National Museum – Al Ghadir", 1, "009A44",
     ["NMU", "MRB", "WZR", "SLM", "KAZ", "GDR"], 6, 12),
    ("M6", "6", "Purple Line: KAFD – Al Naseem", 1, "8A3FA0",
     ["KAFD", "NFL", "NDA", "HMR", "RWB", "NSM"], 8, 12),
    ("B7", "7", "Diriyah – Olaya Connector", 3, "5E6A71",
     ["DIR", "KSU", "KSO", "TKH", "OLY", "SLM"], 10, 20),
    ("B9", "9", "Batha Circulator", 3, "7A8B94",
     ["BTH", "QHK", "NMU", "MRB", "MLZ", "MRQ", "BTH"], 12, 20),
    ("B150", "150", "Eastern Crosstown", 3, "98A4AE",
     ["YRM", "NDA", "HMR", "MNS", "NSM", "RWD", "JZR", "MLZ"], 15, 30),
]

PEAKS = [(7 * 3600, 9 * 3600), (16 * 3600, 19 * 3600)]
METRO_SPEED_KMH = 42.0
BUS_SPEED_KMH = 20.0
DWELL_S = {1: 30, 3: 20}
BUS_STOP_OFFSET_M = 60.0  # bus bays sit beside metro stations


def _in_peak(t: int) -> bool:
    return any(a <= t < b for a, b in PEAKS)


def _bus_stop_id(station: str) -> str:
    return f"BUS_{station}"


def _bus_coords(lat: float, lon: float) -> tuple[float, float]:
    dlon = BUS_STOP_OFFSET_M / (111_320 * math.cos(math.radians(lat)))
    return lat, lon + dlon


def _fmt(t: int) -> str:
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def _stop_for(route_type: int, station: str) -> str:
    return _bus_stop_id(station) if route_type == 3 else station


def _csv(rows: list[dict[str, object]], fields: list[str]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def _schedule(
    first: int, last: int, peak_hw: float, off_hw: float, weekend: bool
) -> list[int]:
    starts, t = [], first
    while t <= last:
        starts.append(t)
        hw = off_hw * 1.5 if weekend else (peak_hw if _in_peak(t) else off_hw)
        t += int(hw * 60)
    return starts


def build_gtfs_tables() -> dict[str, str]:
    """Return the sample GTFS as ``{filename: csv text}``."""
    bus_served = {s for _, _, _, rt, _, seq, _, _ in LINES if rt == 3 for s in seq}
    metro_served = {s for _, _, _, rt, _, seq, _, _ in LINES if rt != 3 for s in seq}

    stops = []
    for sid in sorted(metro_served):
        name, lat, lon = STATIONS[sid]
        stops.append({"stop_id": sid, "stop_name": name, "stop_lat": lat, "stop_lon": lon,
                      "location_type": 0})
    for sid in sorted(bus_served):
        name, lat, lon = STATIONS[sid]
        if sid in metro_served:
            lat, lon = _bus_coords(lat, lon)
            name = f"{name} (Bus)"
        stops.append({"stop_id": _bus_stop_id(sid), "stop_name": name,
                      "stop_lat": round(lat, 6), "stop_lon": round(lon, 6), "location_type": 0})
    coords = {s["stop_id"]: (float(s["stop_lat"]), float(s["stop_lon"])) for s in stops}

    routes, trips, stop_times, shapes = [], [], [], []
    calendars = [
        {"service_id": "WKD", "monday": 0, "tuesday": 0, "wednesday": 0, "thursday": 1,
         "friday": 0, "saturday": 0, "sunday": 1, "start_date": "20250101",
         "end_date": "20271231"},
        {"service_id": "WKE", "monday": 0, "tuesday": 0, "wednesday": 0, "thursday": 0,
         "friday": 1, "saturday": 1, "sunday": 0, "start_date": "20250101",
         "end_date": "20271231"},
    ]
    # Sun–Thu working week: enable Mon–Wed too.
    for day in ("monday", "tuesday", "wednesday"):
        calendars[0][day] = 1

    for route_id, short, long_name, rtype, color, seq, peak_hw, off_hw in LINES:
        routes.append({"route_id": route_id, "agency_id": "RTS", "route_short_name": short,
                       "route_long_name": long_name, "route_type": rtype,
                       "route_color": color, "route_text_color": "FFFFFF"})
        speed = (METRO_SPEED_KMH if rtype == 1 else BUS_SPEED_KMH) / 3.6
        first, last = (6 * 3600, 23 * 3600 + 30 * 60) if rtype == 1 else (
            6 * 3600, 22 * 3600)

        for direction in (0, 1):
            ids = [_stop_for(rtype, s) for s in (seq if direction == 0 else seq[::-1])]
            shape_id = f"{route_id}_{direction}"
            for i, sid in enumerate(ids):
                lat, lon = coords[sid]
                shapes.append({"shape_id": shape_id, "shape_pt_lat": lat,
                               "shape_pt_lon": lon, "shape_pt_sequence": i})
            hops = [
                haversine_m(*coords[a], *coords[b]) * (1.0 if rtype == 1 else 1.2)
                for a, b in zip(ids, ids[1:], strict=False)
            ]
            for service in ("WKD", "WKE"):
                weekend = service == "WKE"
                day_first = first + (2 * 3600 if weekend else 0)
                for n, start in enumerate(_schedule(day_first, last, peak_hw, off_hw, weekend)):
                    trip_id = f"{route_id}_{service}_{direction}_{n:03d}"
                    trips.append({"route_id": route_id, "service_id": service,
                                  "trip_id": trip_id, "direction_id": direction,
                                  "shape_id": shape_id,
                                  "trip_headsign": STATIONS[seq[-1 if direction == 0 else 0]][0]})
                    t = start
                    for i, sid in enumerate(ids):
                        arr = t
                        dep = t if i in (0, len(ids) - 1) else t + DWELL_S[rtype]
                        stop_times.append({"trip_id": trip_id, "arrival_time": _fmt(arr),
                                           "departure_time": _fmt(dep), "stop_id": sid,
                                           "stop_sequence": i + 1})
                        if i < len(hops):
                            t = dep + int(round(hops[i] / speed))

    agency = [{"agency_id": "RTS", "agency_name": "Riyadh Transit Sample (mock data)",
               "agency_url": "https://example.org/riyadh-transit-scope",
               "agency_timezone": "Asia/Riyadh", "agency_lang": "en"}]
    feed_info = [{"feed_publisher_name": "riyadh-transit-scope", "feed_publisher_url":
                  "https://example.org/riyadh-transit-scope", "feed_lang": "en",
                  "feed_version": "sample-1"}]
    return {
        "agency.txt": _csv(agency, list(agency[0])),
        "stops.txt": _csv(stops, list(stops[0])),
        "routes.txt": _csv(routes, list(routes[0])),
        "trips.txt": _csv(trips, list(trips[0])),
        "stop_times.txt": _csv(stop_times, list(stop_times[0])),
        "shapes.txt": _csv(shapes, list(shapes[0])),
        "calendar.txt": _csv(calendars, list(calendars[0])),
        "feed_info.txt": _csv(feed_info, list(feed_info[0])),
    }


def build_sample_gtfs(path: str | Path) -> Path:
    """Write the sample GTFS zip to ``path``."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, text in build_gtfs_tables().items():
            info = zipfile.ZipInfo(name, date_time=(2025, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, text)
    return path


# --------------------------------------------------------------------------- #
# Districts
# --------------------------------------------------------------------------- #

DISTRICT_SEEDS: list[tuple[str, float, float]] = [
    ("Al Olaya", 24.7050, 46.6800), ("Al Sulimaniyah", 24.7120, 46.7050),
    ("Al Malaz", 24.6650, 46.7380), ("Al Murabba", 24.6580, 46.7050),
    ("Al Batha", 24.6250, 46.7200), ("Al Aziziyah", 24.5750, 46.7500),
    ("Al Shumaisi", 24.6200, 46.6600), ("Al Suwaidi", 24.6050, 46.5850),
    ("Tuwaiq", 24.5850, 46.5350), ("Diriyah", 24.7400, 46.5700),
    ("King Saud University", 24.7200, 46.6250), ("Al Muruj", 24.7500, 46.6550),
    ("Al Aqiq", 24.7800, 46.6300), ("Al Sahafah", 24.8100, 46.6400),
    ("Al Ghadir", 24.7750, 46.6700), ("Al Nafl", 24.7900, 46.6950),
    ("Al Wurud", 24.7350, 46.6850), ("Al Nuzhah", 24.7500, 46.7200),
    ("Al Hamra", 24.7650, 46.7550), ("Al Nada", 24.7950, 46.7300),
    ("Al Yarmuk", 24.8150, 46.7750), ("Al Khaleej", 24.7750, 46.7900),
    ("Al Rawabi", 24.7400, 46.7900), ("Al Rawdah", 24.7000, 46.7800),
    ("Al Jazirah", 24.6650, 46.7800), ("Al Naseem", 24.7300, 46.8300),
    ("Khashm Al An", 24.7450, 46.8750), ("Al Qadisiyah", 24.8000, 46.8450),
    ("Imam University", 24.8300, 46.7150), ("Al Qirawan", 24.8650, 46.6650),
    ("Airport", 24.9400, 46.7050), ("Al Marqab", 24.6450, 46.7500),
    ("Al Faisaliyah", 24.6050, 46.7900), ("Namar", 24.5700, 46.6800),
]

URBAN_BOUNDARY: list[tuple[float, float]] = [  # (lon, lat)
    (46.50, 24.58), (46.60, 24.54), (46.74, 24.53), (46.84, 24.57), (46.91, 24.68),
    (46.91, 24.80), (46.82, 24.90), (46.74, 24.98), (46.64, 24.97), (46.58, 24.86),
    (46.52, 24.76), (46.49, 24.66),
]


def build_districts_geojson() -> dict[str, object]:
    """Voronoi district polygons (computed in UTM 38N) clipped to the boundary."""
    fwd = Transformer.from_crs("EPSG:4326", RIYADH_UTM, always_xy=True).transform
    inv = Transformer.from_crs(RIYADH_UTM, "EPSG:4326", always_xy=True).transform
    boundary = transform(fwd, Polygon(URBAN_BOUNDARY))
    seeds = [transform(fwd, MultiPoint([(lon, lat)])).geoms[0] for _, lat, lon in DISTRICT_SEEDS]
    cells = voronoi_diagram(MultiPoint(seeds), envelope=boundary.buffer(5000))

    features = []
    for n, (name, _, _) in enumerate(DISTRICT_SEEDS):
        cell = next(c for c in cells.geoms if c.contains(seeds[n]))
        clipped = cell.intersection(boundary)
        if clipped.is_empty:
            continue
        geo = transform(inv, clipped)
        geo = geo.simplify(0.00001)
        features.append({
            "type": "Feature",
            "properties": {
                "district_id": f"D{n + 1:02d}",
                "name": name,
                "area_km2": round(clipped.area / 1e6, 2),
            },
            "geometry": json.loads(json.dumps(mapping(geo), default=list)),
        })
    return {
        "type": "FeatureCollection",
        "name": "riyadh_districts_mock",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }


def _round_coords(obj: object) -> object:
    if isinstance(obj, float):
        return round(obj, 6)
    if isinstance(obj, (list, tuple)):
        return [_round_coords(o) for o in obj]
    if isinstance(obj, dict):
        return {k: _round_coords(v) for k, v in obj.items()}
    return obj


def build_sample_districts(path: str | Path) -> Path:
    """Write the sample district GeoJSON to ``path``."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _round_coords(build_districts_geojson())
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":  # pragma: no cover
    from transit_scope.paths import DATA_DIR, SAMPLE_DISTRICTS_NAME, SAMPLE_GTFS_NAME

    print("wrote", build_sample_gtfs(DATA_DIR / SAMPLE_GTFS_NAME))
    print("wrote", build_sample_districts(DATA_DIR / SAMPLE_DISTRICTS_NAME))
