"""Validate the built Riyadh dataset against official figures and internal consistency.

Every check yields a :class:`Finding` with a status:

* ``pass`` — agrees with the reference within tolerance;
* ``resolved`` — OSM disagreed with the official source and the build used the
  official value (the provenance is recorded);
* ``note`` — a documented limitation or a disagreement *between* published
  sources that cannot be settled from available data;
* ``mismatch`` — the dataset disagrees with the official reference;
* ``error`` — the dataset is internally broken.

The build is accepted only with zero ``mismatch`` and ``error`` findings.
"""

from __future__ import annotations

import re
import zipfile
from collections import Counter
from typing import Literal

from pydantic import BaseModel, Field
from shapely.geometry import Point
from shapely.ops import transform

from transit_scope.gtfs import AnalysisConfig, TimeWindow, analyze_feed, load_feed
from transit_scope.riyadh.build import _FWD, FEATURE_RADIUS_M, RiyadhDataset

Status = Literal["pass", "resolved", "note", "mismatch", "error"]

#: Official line lengths include tail/depot track beyond the terminal stations,
#: so station-to-station alignment may be shorter, never materially longer.
OFFICIAL_LENGTH_TOLERANCE = (-0.06, 0.01)
URBANRAIL_TOLERANCE = 0.02
#: Sanity bounds only: airport runs are long (Yellow Line averages 3.7 km per stop).
MIN_SPACING_M, MAX_SPACING_M = 400, 12000
MAX_STOP_OFFSET_M = 30
MAX_INTERCHANGE_SPREAD_M = 350
_ARABIC = re.compile(r"[؀-ۿ]")


class Finding(BaseModel):
    check: str
    subject: str
    status: Status
    detail: str
    expected: str | None = None
    actual: str | None = None


class ValidationReport(BaseModel):
    findings: list[Finding] = Field(default_factory=list)
    osm_timestamp: str = ""

    @property
    def counts(self) -> dict[str, int]:
        c = Counter(f.status for f in self.findings)
        return {s: c.get(s, 0) for s in ("pass", "resolved", "note", "mismatch", "error")}

    @property
    def ok(self) -> bool:
        return self.counts["mismatch"] == 0 and self.counts["error"] == 0

    def add(self, check: str, subject: str, status: Status, detail: str,
            expected: object = None, actual: object = None) -> None:
        self.findings.append(Finding(
            check=check, subject=subject, status=status, detail=detail,
            expected=None if expected is None else str(expected),
            actual=None if actual is None else str(actual),
        ))


def _pct(a: float, b: float) -> float:
    return (a - b) / b


def validate_dataset(ds: RiyadhDataset, gtfs_path=None) -> ValidationReport:
    ref = ds.reference
    rep = ValidationReport()

    # ---------------------------------------------------------------- lines
    rep.add("lines", "network", "pass" if len(ds.lines) == len(ref.lines) else "error",
            "metro lines present in OSM", len(ref.lines), len(ds.lines))
    total_km = 0.0
    for line in ds.lines:
        lref = ref.line(line.ref)
        subj = f"Line {line.ref} {line.name}"
        for issue in line.issues:
            rep.add("osm-structure", subj, "error", issue)
        rep.add("directions", subj, "pass" if len(line.directions) == 2 else "mismatch",
                "both directions mapped", 2, len(line.directions))
        n_osm = len(line.directions[0].stops) if 0 in line.directions else 0
        rep.add("station-count", subj, "pass" if n_osm == lref.stations else "mismatch",
                "stations on the line (official)", lref.stations, n_osm)
        if 1 in line.directions and 0 in line.directions:
            fwd = [s.node_id for s in line.directions[0].stops]
            rev = line.directions[1].stops
            same_count = len(rev) == len(fwd)
            rep.add("direction-symmetry", subj, "pass" if same_count else "error",
                    "reverse direction serves the same number of stops", len(fwd), len(rev))
        # names
        by_res = Counter(m.resolution for m in line.matches)
        for m in line.matches:
            if m.resolution == "renamed":
                rep.add("station-name", f"{subj} · stop {m.position + 1}", "resolved",
                        "OSM name differs from the official list at this position; official "
                        "name used", m.reference_name, m.osm_name_en)
        filled = [m.reference_name for m in line.matches if m.resolution == "filled"]
        if filled:
            feats = {s.name: s for s in ds.stations}
            confirmed = [n for n in filled if feats[n].feature_agrees]
            rep.add("station-name", subj, "resolved" if len(confirmed) < len(filled) else "pass",
                    f"{len(filled)} stops lack an English name on the route relation; official "
                    f"names applied by position, {len(confirmed)} confirmed by a separately "
                    "mapped OSM station feature", len(filled), len(confirmed))
        if by_res.get("fuzzy"):
            rep.add("station-name", subj, "pass",
                    f"{by_res['fuzzy']} spelling variants matched (e.g. transliteration)")
        # termini
        names = [m.reference_name for m in line.matches]
        ok_termini = bool(names) and (names[0], names[-1]) == tuple(lref.termini)
        rep.add("termini", subj, "pass" if ok_termini else "mismatch", "terminal stations",
                " ↔ ".join(lref.termini), " ↔ ".join([names[0], names[-1]]) if names else "–")
        # geometry
        if 0 in line.directions:
            direction = line.directions[0]
            shape = line.shapes[0]
            offs = [shape.distance(transform(_FWD, Point(s.lon, s.lat))) for s in direction.stops]
            worst = max(offs) if offs else 0
            rep.add("stop-on-alignment", subj, "pass" if worst <= MAX_STOP_OFFSET_M else "error",
                    "max distance from stop to alignment (m)", f"≤ {MAX_STOP_OFFSET_M}",
                    f"{worst:.1f}")
            along = line.stop_offsets_m[0]
            monotonic = all(b > a for a, b in zip(along, along[1:], strict=False))
            rep.add("stop-order", subj, "pass" if monotonic else "error",
                    "stops ordered along the alignment")
            gaps = [b - a for a, b in zip(along, along[1:], strict=False)]
            bad = [(names[i], names[i + 1], g) for i, g in enumerate(gaps)
                   if not MIN_SPACING_M <= g <= MAX_SPACING_M] if len(names) == len(along) else []
            rep.add("stop-spacing", subj, "pass" if not bad else "mismatch",
                    f"inter-station spacing within {MIN_SPACING_M}–{MAX_SPACING_M} m"
                    + ("" if not bad else ": " + "; ".join(
                        f"{a}→{b} {g:.0f} m" for a, b, g in bad)),
                    None, f"{min(gaps):.0f}–{max(gaps):.0f} m" if gaps else None)
            km = line.lengths_km[0]
            total_km += km
            d_off = _pct(km, lref.length_km)
            lo, hi = OFFICIAL_LENGTH_TOLERANCE
            rep.add("length-official", subj, "pass" if lo <= d_off <= hi else "mismatch",
                    "station-to-station length vs official route length (official includes "
                    "tail tracks)", f"{lref.length_km} km", f"{km:.2f} km ({d_off:+.1%})")
            if lref.measured_km_urbanrail:
                d_ur = _pct(km, lref.measured_km_urbanrail)
                rep.add("length-independent", subj,
                        "pass" if abs(d_ur) <= URBANRAIL_TOLERANCE else "mismatch",
                        "length vs independent measurement (UrbanRail.net)",
                        f"{lref.measured_km_urbanrail} km", f"{km:.2f} km ({d_ur:+.1%})")
            if 1 in line.lengths_km:
                d_dir = abs(line.lengths_km[1] - km) / km
                rep.add("direction-length", subj, "pass" if d_dir < 0.01 else "mismatch",
                        "both directions within 1% length", None, f"{d_dir:.2%}")
        rep.add("colour", subj, "pass" if line.colour.startswith("#") and line.colour != "#888888"
                else "mismatch", "line colour tagged in OSM", None, line.colour)

    d_total = _pct(total_km, ref.system.total_length_km)
    lo, hi = OFFICIAL_LENGTH_TOLERANCE
    rep.add("length-official", "network", "pass" if lo <= d_total <= hi else "mismatch",
            "total station-to-station length vs official network length",
            f"{ref.system.total_length_km} km", f"{total_km:.1f} km ({d_total:+.1%})")

    # ---------------------------------------------------------------- stations
    line_sum = sum(len(line.matches) for line in ds.lines)
    ref_sum = sum(lref.stations for lref in ref.lines)
    rep.add("station-count", "network (per-line sum)",
            "pass" if line_sum == ref_sum else "mismatch",
            "sum of per-line station counts", ref_sum, line_sum)
    distinct = len(ds.stations)
    expected_distinct = ref_sum - sum(len(v) - 1 for v in ref.interchanges.values())
    rep.add("station-count", "network (distinct)",
            "pass" if distinct == expected_distinct else "mismatch",
            "distinct stations implied by the official per-line lists and interchanges",
            expected_distinct, distinct)
    if distinct != ref.system.stations:
        rep.add("station-count", "network (headline)", "note",
                f"RCRC's headline total is {ref.system.stations}, but the official per-line "
                f"counts ({ref_sum}) minus shared interchange stations give {expected_distinct}. "
                "No published source reconciles the two; the per-line lists are used.",
                ref.system.stations, distinct)

    got_x = {s.name: set(s.lines) for s in ds.stations if len(s.lines) > 1}
    want_x = {k: set(v) for k, v in ref.interchanges.items()}
    missing = {k: v for k, v in want_x.items() if got_x.get(k) != v}
    extra = set(got_x) - set(want_x)
    rep.add("interchanges", "network", "pass" if not missing and not extra else "mismatch",
            "interchange stations and the lines they join",
            f"{len(want_x)} interchanges", f"{len(got_x)} interchanges"
            + (f"; differ: {sorted(missing)}" if missing else "")
            + (f"; unexpected: {sorted(extra)}" if extra else ""))
    for st in ds.stations:
        if len(st.lines) > 1:
            rep.add("interchange-spread", st.name,
                    "pass" if st.spread_m <= MAX_INTERCHANGE_SPREAD_M else "mismatch",
                    "distance between the lines' platforms", f"≤ {MAX_INTERCHANGE_SPREAD_M} m",
                    f"{st.spread_m:.0f} m")
    # distinct names must not sit on top of each other
    utm = {s.key: transform(_FWD, Point(s.lon, s.lat)) for s in ds.stations}
    close = [(a.name, b.name, utm[a.key].distance(utm[b.key]))
             for i, a in enumerate(ds.stations) for b in ds.stations[i + 1:]
             if utm[a.key].distance(utm[b.key]) < MIN_SPACING_M]
    rep.add("duplicate-stations", "network", "pass" if not close else "error",
            "no two differently named stations closer than "
            f"{MIN_SPACING_M} m" + ("" if not close else ": " + "; ".join(
                f"{a}/{b} {d:.0f} m" for a, b, d in close)))
    for st in ds.stations:
        if st.feature_distance_m is None:
            rep.add("station-feature", st.name, "mismatch",
                    f"no OSM station feature within {FEATURE_RADIUS_M} m to confirm position")
        elif not st.feature_agrees:
            rep.add("station-feature", st.name, "note",
                    "the OSM station feature at this position uses a different name; the "
                    "official list name is used and the OSM name kept as an alias",
                    st.name, f"{st.feature_name_en} ({st.feature_distance_m:.0f} m)")
    confirmed = sum(1 for s in ds.stations if s.feature_agrees)
    rep.add("station-feature", "network", "pass",
            f"stations whose position and name are confirmed by an independent OSM station "
            f"feature within {FEATURE_RADIUS_M} m", distinct, confirmed)
    conflicted = {s.name for s in ds.stations if s.feature_agrees is False}
    no_ar = [s.name for s in ds.stations if not s.name_ar or not _ARABIC.search(s.name_ar)]
    unexplained = [n for n in no_ar if n not in conflicted]
    withheld = sorted(set(no_ar) - set(unexplained))
    latin = [s.name for s in ds.stations if s.name_ar and re.search(r"[A-Za-z]", s.name_ar)]
    rep.add("arabic-script", "network", "pass" if not latin else "error",
            "Arabic names contain no Latin script" + (f": {', '.join(latin)}" if latin else ""))
    rep.add("arabic-names", "network", "pass" if not unexplained else "mismatch",
            "every station has an Arabic name"
            + (f"; missing: {', '.join(unexplained)}" if unexplained else "")
            + (f"; withheld where sources disagree on the name: {', '.join(withheld)}"
               if withheld else ""),
            distinct, distinct - len(no_ar))
    no_d = [s.name for s in ds.stations if not s.district_en]
    no_m = [s.name for s in ds.stations
            if not s.district_en and not s.municipality and not s.area]
    rep.add("district-join", "network", "note" if no_d else "pass",
            "stations inside an OSM neighbourhood polygon"
            + (f"; OSM has no neighbourhood boundary at {len(no_d)} stations "
               f"({', '.join(no_d)}); municipality or airport/campus area used instead"
               if no_d else ""),
            distinct, distinct - len(no_d))
    rep.add("municipality-join", "network", "pass" if not no_m else "mismatch",
            "every station inside a neighbourhood, municipality or named airport/campus area"
            + (f"; none for: {', '.join(no_m)}" if no_m else ""), distinct, distinct - len(no_m))

    # ---------------------------------------------------------------- GTFS
    if gtfs_path is not None:
        feed = load_feed(gtfs_path)
        rep.add("gtfs-load", "riyadh_metro_gtfs.zip", "pass" if not feed.warnings else "error",
                "feed loads with no warnings" + (f": {feed.warnings}" if feed.warnings else ""))
        with zipfile.ZipFile(gtfs_path) as z:
            names = set(z.namelist())
        need = {"agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt",
                "shapes.txt", "calendar.txt"}
        rep.add("gtfs-files", "riyadh_metro_gtfs.zip", "pass" if need <= names else "error",
                "required and shape files present", ", ".join(sorted(need)),
                ", ".join(sorted(names)))
        plan = ref.service_plan
        cfg = AnalysisConfig(peak_windows=[TimeWindow.parse(w) for w in plan.peak_windows])
        result = analyze_feed(feed, cfg)
        lo_h, hi_h = ref.system.headway_min_range
        for r in result.report.routes:
            lref = ref.line(r.name)
            measured = next(line.lengths_km[0] for line in ds.lines if line.ref == r.name)
            d = abs(r.length_km - measured) / measured
            rep.add("gtfs-shape-length", f"Line {r.name}", "pass" if d < 0.005 else "error",
                    "GTFS shape length equals the OSM alignment", f"{measured:.2f} km",
                    f"{r.length_km:.2f} km")
            hws = [h for h in (r.peak_headway_min, r.offpeak_headway_min) if h is not None]
            in_band = all(lo_h - 0.05 <= h <= hi_h + 0.05 for h in hws)
            rep.add("headway-band", f"Line {r.name}", "pass" if in_band else "mismatch",
                    "timetabled headways within the published 3–7 min range",
                    f"{lo_h:g}–{hi_h:g} min", ", ".join(f"{h:.1f}" for h in hws))
            want_first = plan.calendars["SATTHU"].start
            rep.add("service-hours", f"Line {r.name}",
                    "pass" if r.first_departure == want_first else "mismatch",
                    "first departure matches published opening time", want_first,
                    r.first_departure)
            spd = r.avg_speed_kmh or 0
            rep.add("commercial-speed", f"Line {r.name}",
                    "pass" if 30 <= spd <= 60 else "mismatch",
                    "end-to-end commercial speed plausible for an automated metro "
                    "(30–60 km/h)", "30–60 km/h", f"{spd:.1f} km/h")
            n_stops = r.stops
            rep.add("gtfs-stations", f"Line {r.name}",
                    "pass" if n_stops == lref.stations else "error",
                    "GTFS stops served per line", lref.stations, n_stops)
        nodes = result.report.summary.station_nodes
        rep.add("gtfs-stations", "network", "pass" if nodes == distinct else "error",
                "GTFS station nodes (parent stations) equal distinct stations", distinct, nodes)
        rep.add("service-plan", "network", "note", plan.note)

    # ---------------------------------------------------------------- bus
    base_refs = {re.sub(r"_?d1$", "", r.ref) for r in ds.bus_routes if r.ref}
    rep.add("bus-coverage", "Riyadh Bus", "note",
            f"OSM maps {len(base_refs)} of {ref.bus.routes} official bus routes and "
            f"{len(ds.bus_stops):,} of {ref.bus.stops:,} stops "
            f"({len(ds.bus_stops) / ref.bus.stops:.0%}). Bus data is shown as a partial layer "
            "and excluded from timetable KPIs.",
            f"{ref.bus.routes} routes / {ref.bus.stops:,} stops",
            f"{len(base_refs)} routes / {len(ds.bus_stops):,} stops")
    # ---------------------------------------------------------------- districts
    fixed = [d for d in ds.districts if d.get("repaired_gap_m")]
    if fixed:
        worst = max(fixed, key=lambda d: d["repaired_gap_m"])
        rep.add("district-repair", "OSM boundaries", "resolved",
                f"{len(fixed)} boundary relations have broken rings in OSM; gaps bridged "
                f"(largest {worst['repaired_gap_m']:.0f} m, {worst['name_en']})",
                None, ", ".join(sorted(d["name_en"] or str(d["osm_id"]) for d in fixed)))
    if ds.failed_districts:
        rep.add("district-repair", "OSM boundaries", "note",
                f"{len(ds.failed_districts)} boundary relations could not be assembled "
                "(fragments too far apart) and are omitted",
                None, ", ".join(d["name_en"] or str(d["osm_id"]) for d in ds.failed_districts))
    lvl10 = [d for d in ds.districts if d["admin_level"] == 10]
    invalid = [d["name_en"] for d in lvl10 if not d["geometry"].is_valid]
    rep.add("districts", "OSM neighbourhoods", "pass" if lvl10 and not invalid else "error",
            f"{len(lvl10)} neighbourhood polygons, all valid" if not invalid else
            f"invalid polygons: {invalid}")
    rep.osm_timestamp = ds.gtfs_tables["feed_info.txt"].strip().split(",")[-1]
    return rep
