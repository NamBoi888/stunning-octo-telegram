"""Compile the Riyadh analysis into one self-contained, interactive HTML report.

Sections
--------
* **Map** — a zero-dependency interactive SVG map (pan, zoom, pinch, keyboard):
  metro lines, stations, OSM neighbourhoods with a catchment-coverage
  choropleth, adjustable walk catchments (optionally heat-adjusted by the
  EWCS model), the partial OSM bus layer, search and detail panels.
* **Validation** — the dataset checked against official figures.
* **Network** — GTFS KPIs, lines, stations and transfer nodes.
* **Heat walk** — the EWCS model ported to JavaScript.
* **Sources & method**.

Only Google Fonts are external (with system fallbacks); the page works offline.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from html import escape
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import transform, unary_union

from transit_scope import __version__
from transit_scope.gtfs import AnalysisConfig, AnalysisResult, analyze_feed, load_feed
from transit_scope.microclimate import CorridorInput, simulate_corridor
from transit_scope.microclimate.model import SHADE_PROPERTIES, ModelParameters
from transit_scope.paths import (
    DATA_DIR,
    VALIDATION_NAME,
    riyadh_bus_path,
    riyadh_gtfs_path,
    riyadh_stations_path,
    sample_districts_path,
)
from transit_scope.riyadh.reference import load_reference
from transit_scope.utils.geo import resolve_metric_crs

__all__ = ["ReportInputs", "build_html_report"]

#: Radius used for the district coverage choropleth.
COVERAGE_RADIUS_M = 800


@dataclass
class ReportInputs:
    gtfs: Path | None = None
    geojson: Path | None = None
    temp_c: float = 44.0
    shade_pct: float = 35.0
    distance_m: float = 800.0
    title: str = "Riyadh Transit Scope"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _e(value: object) -> str:
    return escape(str(value), quote=True)


def _num(value: float | None, digits: int = 1, suffix: str = "") -> str:
    return "—" if value is None else f"{value:,.{digits}f}{suffix}"


def _text_on(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    try:
        r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return "#FFFFFF"
    return "#111111" if 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 else "#FFFFFF"


def _roundel(name: str, color: str) -> str:
    return (
        f'<span class="roundel" style="background:{_e(color)};color:{_text_on(color)}">'
        f"{_e(name)}</span>"
    )


def _table(head: list[tuple[str, str]], rows: list[list[str]], cls: str = "") -> str:
    ths = "".join(f'<th class="{a}">{_e(h)}</th>' for h, a in head)
    body = "".join(
        "<tr>" + "".join(f'<td class="{a}">{c}</td>' for c, (_, a) in zip(r, head, strict=True))
        + "</tr>"
        for r in rows
    )
    return (
        f'<div class="table-wrap"><table class="{cls}"><thead><tr>{ths}</tr></thead>'
        f"<tbody>{body}</tbody></table></div>"
    )


def _path_d(geom, fwd, ox: float, oy: float) -> str:
    """SVG path data in local metres (x east, y *down*) for WGS84 (multi)lines/polygons."""
    return _path_d_local(transform(fwd, geom), ox, oy)


def _path_d_local(g, ox: float, oy: float) -> str:
    """SVG path data for geometry already in the metric CRS."""
    def ring(coords, close):
        pts = [f"{round(x - ox)} {round(oy - y)}" for x, y, *_ in coords]
        return ("M" + "L".join(pts) + ("Z" if close else "")) if len(pts) > 1 else ""

    if g.geom_type == "LineString":
        return ring(g.coords, False)
    if g.geom_type == "Polygon":
        return "".join(ring(r.coords, True) for r in (g.exterior, *g.interiors))
    if hasattr(g, "geoms"):
        return "".join(_path_d_local(p, ox, oy) for p in g.geoms)
    return ""


# --------------------------------------------------------------------------- #
# Map payload
# --------------------------------------------------------------------------- #


def _load_fc(path: Path) -> list[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("features", [])
    except (OSError, json.JSONDecodeError):
        return []


def _map_payload(result: AnalysisResult, districts_path: Path, reference) -> dict:
    """Everything the interactive map needs, pre-projected to local UTM metres."""
    from pyproj import Transformer

    rep = result.report
    nodes = result.nodes_wgs84()
    cx = float(nodes.geometry.x.mean())
    cy = float(nodes.geometry.y.mean())
    crs = resolve_metric_crs(None, cx, cy)
    fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    ox, oy = fwd(cx, cy)

    def xy(lon: float, lat: float) -> tuple[int, int]:
        x, y = fwd(lon, lat)
        return round(x - ox), round(oy - y)

    ref_lines = {line.ref: line for line in reference.lines} if reference else {}
    plan = reference.service_plan.headways_min if reference else {}

    # ---- lines
    lines_wgs = result.route_lines_wgs84()
    kpi = {r.route_id: r for r in rep.routes}
    lines = []
    for row in lines_wgs.itertuples():
        r = kpi[row.route_id]
        lref = ref_lines.get(r.name)
        lines.append({
            "id": r.route_id, "ref": r.name, "name": r.long_name or r.name,
            "name_ar": lref.name_ar if lref else "", "color": r.color,
            "text": _text_on(r.color), "d": _path_d(row.geometry, fwd, ox, oy),
            "km": round(r.length_km, 2), "stops": r.stops, "trips": r.trips_per_day,
            "hw_peak": r.peak_headway_min, "hw_off": r.offpeak_headway_min,
            "span": f"{r.first_departure}–{r.last_departure}", "speed": r.avg_speed_kmh,
            "official_km": lref.length_km if lref else None,
            "urbanrail_km": lref.measured_km_urbanrail if lref else None,
            "official_stations": lref.stations if lref else None,
            "termini": list(lref.termini) if lref else [],
            "opened": lref.opened if lref else None,
            "stations_order": list(lref.station_list) if lref else [],
            "plan_peak": plan[r.name].peak if r.name in plan else None,
        })

    # ---- stations (analysis nodes enriched with the stations layer)
    extra = {f["properties"]["name"]: f["properties"] for f in _load_fc(riyadh_stations_path())}
    tfi = {t.node_id: t for t in rep.transfer_nodes}
    kpis = {s.node_id: s for s in rep.stations}
    route_ref = {r.route_id: r.name for r in rep.routes}
    stations = []
    for row, geo in zip(result.nodes.itertuples(), nodes.geometry, strict=True):
        s = kpis.get(row.node_id)
        props = extra.get(row.name, {})
        t = tfi.get(row.node_id)
        x, y = xy(geo.x, geo.y)
        stations.append({
            "id": row.node_id, "n": row.name, "ar": props.get("name_ar") or "",
            "l": sorted({route_ref.get(r, r) for r in row.route_ids}, key=lambda v: (len(v), v)),
            "x": x, "y": y, "c": props.get("codes", []),
            "d": props.get("district") or "", "dar": props.get("district_ar") or "",
            "m": props.get("municipality") or props.get("area") or "",
            "dep": s.departures_per_day if s else 0, "pk": s.peak_departures if s else 0,
            "hw": s.peak_headway_min if s else None,
            "tfi": t.transfer_friction_index if t else None,
            "hub": t.hub_score if t else None,
            "al": props.get("aliases", []),
            "lat": round(geo.y, 5), "lon": round(geo.x, 5),
        })

    # ---- districts with catchment coverage
    st_utm = unary_union([
        transform(fwd, g).buffer(COVERAGE_RADIUS_M, quad_segs=24) for g in nodes.geometry
    ])
    districts = []
    for f in _load_fc(districts_path):
        geom = shape(f["geometry"])
        if geom.is_empty:
            continue
        g_utm = transform(fwd, geom)
        area = g_utm.area
        cover = g_utm.intersection(st_utm).area / area if area else 0
        c = g_utm.representative_point()
        p = f.get("properties", {})
        name = p.get("name") or p.get("NAME") or p.get("name_en") or ""
        districts.append({
            "n": name, "ar": p.get("name_ar") or "", "mu": p.get("municipality") or "",
            "km2": round(area / 1e6, 2), "cov": round(100 * cover, 1),
            "st": sum(1 for s in stations if s["d"] == name),
            "d": _path_d_local(g_utm.simplify(8), ox, oy),
            "cx": round(c.x - ox), "cy": round(oy - c.y),
        })

    # ---- bus (partial OSM layer)
    bus_routes, bus_stops = [], []
    for f in _load_fc(riyadh_bus_path()):
        p = f["properties"]
        if p.get("kind") == "route":
            bus_routes.append({"ref": p.get("ref", ""), "brt": bool(p.get("brt")),
                               "d": _path_d(shape(f["geometry"]), fwd, ox, oy)})
        elif p.get("kind") == "stop":
            lon, lat = f["geometry"]["coordinates"]
            bus_stops.append(xy(lon, lat))

    all_x = [s["x"] for s in stations] + [d["cx"] for d in districts]
    all_y = [s["y"] for s in stations] + [d["cy"] for d in districts]
    bounds = [min(s["x"] for s in stations) - 1500, min(s["y"] for s in stations) - 1500,
              max(s["x"] for s in stations) + 1500, max(s["y"] for s in stations) + 1500]
    world = [min(all_x) - 3000, min(all_y) - 3000, max(all_x) + 3000, max(all_y) + 3000]
    return {"crs": crs.to_string(), "bounds": bounds, "world": world, "lines": lines,
            "stations": stations, "districts": districts,
            "bus": {"routes": bus_routes, "stops": bus_stops},
            "coverage_radius": COVERAGE_RADIUS_M}


# --------------------------------------------------------------------------- #
# Sections
# --------------------------------------------------------------------------- #


def _map_section(payload: dict) -> str:
    chips = "".join(
        f'<button type="button" class="chip line-chip" data-line="{_e(ln["id"])}" '
        f'aria-pressed="true" title="Show or hide the {_e(ln["name"])}">'
        f'{_roundel(ln["ref"], ln["color"])}<span>{_e(ln["name"].replace(" Line", ""))}</span>'
        "</button>"
        for ln in payload["lines"]
    )
    options = "".join(
        f'<option value="{_e(s["n"])}">{_e(s["ar"])}</option>' for s in payload["stations"]
    ) + "".join(
        f'<option value="{_e(d["n"])}">{_e(d["ar"])} · district</option>'
        for d in payload["districts"] if d["n"]
    )
    return f"""
<section id="map" class="section section-map">
  <header class="section-head">
    <p class="eyebrow">Interactive map</p>
    <h2>Riyadh Metro, station by station</h2>
    <p class="lede">Drag to pan, scroll or pinch to zoom, and select a station, line or
      neighbourhood for details. Catchments can follow the heat-walk model further down.</p>
  </header>
  <div class="mapbox">
    <div class="map-tools">
      <div class="search">
        <label for="map-search" class="sr">Find a station or neighbourhood</label>
        <input id="map-search" type="search" list="map-places" placeholder="Find a station or neighbourhood"
          autocomplete="off">
        <datalist id="map-places">{options}</datalist>
      </div>
      <div class="chips" role="group" aria-label="Metro lines">{chips}</div>
      <details class="layers" open>
        <summary>Layers</summary>
        <div class="layer-grid">
          <label><input type="checkbox" id="lyr-districts" checked> Neighbourhoods</label>
          <label><input type="checkbox" id="lyr-coverage"> Coverage choropleth</label>
          <label><input type="checkbox" id="lyr-catch" checked> Walk catchments</label>
          <label><input type="checkbox" id="lyr-heat"> Heat-adjusted catchments</label>
          <label><input type="checkbox" id="lyr-bus"> Bus routes (OSM, partial)</label>
          <label><input type="checkbox" id="lyr-busstops"> Bus stops (OSM, partial)</label>
          <label><input type="checkbox" id="lyr-labels" checked> Station labels</label>
        </div>
        <label for="catch-r" class="range-label">Catchment radius <output id="catch-o">800 m</output></label>
        <input id="catch-r" type="range" min="250" max="1500" step="50" value="800">
      </details>
    </div>
    <div class="map-stage">
      <svg id="map-svg" role="application" tabindex="0"
        aria-label="Interactive map of the Riyadh Metro. Use arrow keys to pan and plus or minus to zoom.">
        <g id="world">
          <g id="g-districts"></g><g id="g-catch"></g><g id="g-bus"></g><g id="g-busstops"></g>
          <g id="g-lines"></g><g id="g-stations"></g>
        </g>
        <g id="g-labels"></g>
      </svg>
      <div class="map-ui">
        <div class="zoom">
          <button type="button" id="z-in" aria-label="Zoom in">+</button>
          <button type="button" id="z-out" aria-label="Zoom out">−</button>
          <button type="button" id="z-fit" aria-label="Show the whole network">⤢</button>
        </div>
        <div class="scale" aria-hidden="true"><span id="scale-bar"></span><span id="scale-t"></span></div>
        <div class="legend-cov" id="legend-cov" hidden>
          <span>Share within {payload["coverage_radius"]} m of a station</span>
          <span class="grad"></span><span class="ends"><span>0%</span><span>100%</span></span>
        </div>
        <p class="attrib">© OpenStreetMap contributors (ODbL) · {_e(payload["crs"])}</p>
      </div>
      <div id="map-tip" class="tip" hidden></div>
    </div>
    <aside id="map-panel" class="panel" aria-live="polite">
      <div class="panel-empty">
        <h3>Select something on the map</h3>
        <p>Stations show departures, headways, codes and their neighbourhood. Lines compare the
          official length with the mapped alignment. Neighbourhoods show how much of their area
          lies within {payload["coverage_radius"]} m of a station.</p>
      </div>
    </aside>
  </div>
</section>"""


_STATUS_LABEL = {"pass": "Pass", "resolved": "Resolved", "note": "Note", "mismatch": "Mismatch",
                 "error": "Error"}


def _validation_section(validation: dict | None, payload: dict, reference) -> str:
    if not validation:
        return """
<section id="validation" class="section"><header class="section-head">
  <p class="eyebrow">Validation</p><h2>Not validated</h2>
  <p class="lede">This report was built from a custom GTFS feed; the official-figure checks
    apply to the bundled Riyadh dataset only. Run <code>transit validate</code>.</p></header>
</section>"""
    findings = validation["findings"]
    counts = {k: sum(1 for f in findings if f["status"] == k) for k in _STATUS_LABEL}
    ok = counts["mismatch"] == 0 and counts["error"] == 0
    pills = "".join(
        f'<span class="count st-{k}"><strong>{v}</strong> {_STATUS_LABEL[k].lower()}</span>'
        for k, v in counts.items()
    )
    rows = []
    for line in payload["lines"]:
        off = line["official_km"]
        ind = line["urbanrail_km"]
        d_off = (line["km"] - off) / off if off else None
        d_ind = (line["km"] - ind) / ind if ind else None
        rows.append([
            _roundel(line["ref"], line["color"]) + " " + _e(line["name"]),
            _num(off, 1), _num(ind, 1), f"{line['km']:.2f}",
            f"{d_off:+.1%}" if d_off is not None else "—",
            f"{d_ind:+.1%}" if d_ind is not None else "—",
            f"{line['official_stations']}", f"{line['stops']}",
        ])
    compare = _table(
        [("Line", ""), ("Official km", "n"), ("Independent km", "n"), ("Mapped km", "n"),
         ("vs official", "n"), ("vs independent", "n"), ("Official stations", "n"),
         ("Mapped stations", "n")],
        rows, "compare")
    open_items = [f for f in findings if f["status"] != "pass"]
    issue_rows = "".join(
        f'<tr><td><span class="status st-{f["status"]}">{_STATUS_LABEL[f["status"]]}</span></td>'
        f'<td>{_e(f["subject"])}</td><td class="wrap">{_e(f["detail"])}</td>'
        f'<td class="wrap">{_e(f.get("expected") or "")}</td>'
        f'<td class="wrap">{_e(f.get("actual") or "")}</td></tr>'
        for f in open_items
    )
    all_rows = "".join(
        f'<tr><td><span class="status st-{f["status"]}">{_STATUS_LABEL[f["status"]]}</span></td>'
        f'<td>{_e(f["check"])}</td><td>{_e(f["subject"])}</td>'
        f'<td class="wrap">{_e(f["detail"])}</td><td class="wrap">{_e(f.get("expected") or "")}</td>'
        f'<td class="wrap">{_e(f.get("actual") or "")}</td></tr>'
        for f in findings
    )
    verdict = (
        '<span class="verdict ok">Accepted: no mismatches or errors</span>' if ok
        else '<span class="verdict bad">Rejected: mismatches or errors remain</span>'
    )
    total = sum(counts.values())
    return f"""
<section id="validation" class="section">
  <header class="section-head">
    <p class="eyebrow">Validation</p>
    <h2>Checked against official figures</h2>
    <p class="lede">{total} checks compare the mapped network with RCRC figures, the official
      per-line station lists and an independent length survey. The build is accepted only with
      zero mismatches and zero errors. OSM snapshot {_e(validation.get("osm_timestamp", ""))}.</p>
  </header>
  <div class="verdict-row">{verdict}<div class="counts">{pills}</div></div>
  <h3>Line by line</h3>
  {compare}
  <p class="note">Official lengths include tail tracks beyond the terminal stations, so the
    station-to-station alignment is expected to be slightly shorter. The independent figures
    are UrbanRail.net's measurements.</p>
  <h3>Everything that is not a plain pass</h3>
  <div class="table-wrap"><table class="findings-t"><thead><tr><th>Status</th><th>Subject</th>
    <th>Finding</th><th>Expected</th><th>Actual</th></tr></thead><tbody>{issue_rows}</tbody></table></div>
  <details class="all-checks"><summary>All {total} checks</summary>
    <div class="table-wrap"><table class="findings-t"><thead><tr><th>Status</th><th>Check</th>
      <th>Subject</th><th>Finding</th><th>Expected</th><th>Actual</th></tr></thead>
      <tbody>{all_rows}</tbody></table></div></details>
</section>"""


def _network_section(result: AnalysisResult, payload: dict) -> str:
    rep = result.report
    s = rep.summary
    c_by_r = {c.radius_m: c for c in rep.catchments}
    facts = [
        ("Lines", f"{s.routes}", "automated metro"),
        ("Route length", f"{s.route_km_total:,.1f}", "km, station to station"),
        ("Stations", f"{s.station_nodes}", f"{s.transfer_nodes} interchanges, {s.stops} platforms"),
        ("Trips", f"{s.trips_per_day:,}", "per weekday, both directions"),
        ("Peak headway", _num(s.mean_peak_headway_min), "min, mean of lines"),
    ]
    if 1000.0 in c_by_r:
        facts.append(("1 km catchment", f"{c_by_r[1000.0].area_km2:,.0f}", "km² within 1 km"))
    fact_html = "".join(
        f'<div class="fact"><dt>{_e(k)}</dt><dd><span class="big">{_e(v)}</span>'
        f'<span class="unit">{_e(u)}</span></dd></div>' for k, v, u in facts
    )
    color_of = {r.name: r.color for r in rep.routes}
    routes = _table(
        [("Line", ""), ("Name", ""), ("Length km", "n"), ("Stations", "n"), ("Trips/day", "n"),
         ("Peak hw", "n"), ("Off-peak hw", "n"), ("Span", "c"), ("Speed km/h", "n")],
        [[_roundel(r.name, r.color), _e(r.long_name), f"{r.length_km:.1f}", str(r.stops),
          f"{r.trips_per_day:,}", _num(r.peak_headway_min, 1, "′"),
          _num(r.offpeak_headway_min, 1, "′"),
          f"{_e(r.first_departure)}–{_e(r.last_departure)}", _num(r.avg_speed_kmh)]
         for r in rep.routes])

    def lines(names: list[str]) -> str:
        return '<span class="roundels">' + "".join(
            _roundel(n, color_of.get(n, "#888888")) for n in names) + "</span>"

    ar = {st["n"]: st["ar"] for st in payload["stations"]}
    stations = _table(
        [("Station", ""), ("Arabic", "ar"), ("Lines", ""), ("Departures/day", "n"),
         ("Peak deps", "n"), ("Combined peak hw", "n")],
        [[f'<button type="button" class="linkish" data-goto="{_e(st.name)}">{_e(st.name)}</button>',
          f'<span lang="ar" dir="rtl">{_e(ar.get(st.name, ""))}</span>', lines(st.routes),
          f"{st.departures_per_day:,}", f"{st.peak_departures:,}",
          _num(st.peak_headway_min, 2, "′")] for st in rep.stations[:12]])
    by_node = {st.node_id: st for st in rep.stations}
    transfers = _table(
        [("Interchange", ""), ("Lines", ""), ("Pairs", "n"), ("Exp. wait", "n"),
         ("Spread m", "n"), ("TFI", "n"), ("Hub score", "n")],
        [[f'<button type="button" class="linkish" data-goto="{_e(t.name)}">{_e(t.name)}</button>',
          lines(by_node[t.node_id].routes if t.node_id in by_node else []),
          str(t.transfer_pairs), f"{t.expected_transfer_wait_min:.1f}′",
          f"{t.intra_node_spread_m:.0f}", f"{t.transfer_friction_index:.1f}",
          f'<span class="meter" style="--v:{t.hub_score:.0f}%" '
          f'title="Hub score {t.hub_score:.0f} / 100"></span>{t.hub_score:.0f}']
         for t in rep.transfer_nodes])
    return f"""
<section id="network" class="section">
  <header class="section-head">
    <p class="eyebrow">GTFS network</p>
    <h2>Six lines, {s.station_nodes} stations</h2>
    <p class="lede">{_e(s.service_day.capitalize())}. Lengths and catchments computed in
      {_e(s.metric_crs)} (UTM 38N). Timetables follow the published hours and headway range;
      per-line headways are modelled within it.</p>
  </header>
  <dl class="facts">{fact_html}</dl>
  <h3>Lines</h3>
  {routes}
  <h3>Busiest stations</h3>
  {stations}
  <h3>Interchanges</h3>
  {transfers}
  <p class="note">TFI = transfer pairs × expected wait × walk penalty × mode penalty.
    Higher means a heavier transfer burden. Hub score ranks importance, 0–100. Select a
    station name to show it on the map.</p>
</section>"""


def _sources_section(reference, gtfs_name: str, inputs: ReportInputs) -> str:
    items = "".join(
        f'<li><a href="{_e(s.url)}" rel="noopener" target="_blank">{_e(s.title)}</a></li>'
        for s in reference.sources.values()
    ) if reference else ""
    cmd = (f"transit report-html --temp {inputs.temp_c:g} --shade {inputs.shade_pct:g} "
           f"--distance {inputs.distance_m:g}")
    note = reference.service_plan.note if reference else ""
    return f"""
<section id="sources" class="section">
  <header class="section-head">
    <p class="eyebrow">Sources &amp; method</p>
    <h2>Where every number comes from</h2>
  </header>
  <div class="method">
    <div>
      <h3>Sources</h3>
      <ul class="sources">{items}</ul>
      <p class="note">RCRC and Riyadh Metro sites block automated access, and no official
        GTFS feed is published (none is listed in the Mobility Database). Official figures are
        taken from RCRC statements as reported by SPA and news outlets.</p>
    </div>
    <div>
      <h3>Data build</h3>
      <p>Station positions, codes, Arabic names and alignments come from OSM route relations
        and are cross-checked against separately mapped OSM station features. Station names and
        order follow the official per-line lists. Broken OSM boundary rings are repaired only
        across gaps under 500 m.</p>
      <p>{_e(note)}</p>
    </div>
    <div>
      <h3>Rebuild</h3>
      <p>Feed: <code>{_e(gtfs_name)}</code>.</p>
      <pre><code>transit fetch-osm      # refresh snapshots (network)
transit build-riyadh   # rebuild + validate
{_e(cmd)}</code></pre>
    </div>
  </div>
</section>"""


def _heat_section(inputs: ReportInputs) -> str:
    return f"""
<section id="heat" class="section">
  <header class="section-head">
    <p class="eyebrow">Heat walk</p>
    <h2>Effective Walkable Catchment Score</h2>
    <p class="lede">How far people will walk to a station in summer heat. Above 40 °C each
      unshaded metre counts for more. Adjust the corridor and the score updates.</p>
  </header>
  <div class="sim">
    <form id="sim-form" class="controls" autocomplete="off">
      <label for="in-temp">Air temperature <output id="o-temp"></output></label>
      <input id="in-temp" name="temp" type="range" min="30" max="52" step="0.5"
        value="{inputs.temp_c}">
      <label for="in-shade">Shaded share <output id="o-shade"></output></label>
      <input id="in-shade" name="shade" type="range" min="0" max="100" step="1"
        value="{inputs.shade_pct}">
      <label for="in-dist">Corridor length <output id="o-dist"></output></label>
      <input id="in-dist" name="dist" type="range" min="100" max="2000" step="50"
        value="{inputs.distance_m}">
      <label for="in-solar">Solar irradiance <output id="o-solar"></output></label>
      <input id="in-solar" name="solar" type="range" min="0" max="1100" step="25" value="950">
      <div class="row">
        <div><label for="in-type">Shade type</label>
          <select id="in-type" name="type">
            <option value="mixed">Mixed</option><option value="trees">Trees</option>
            <option value="arcade">Arcade</option><option value="sail">Shade sail</option>
          </select></div>
        <div><label for="in-rh">Humidity %</label>
          <input id="in-rh" name="rh" type="number" min="0" max="100" step="1" value="15"></div>
        <div><label for="in-wind">Wind m/s</label>
          <input id="in-wind" name="wind" type="number" min="0" max="15" step="0.5"
            value="1.5"></div>
      </div>
      <button type="button" id="reset">Reset to report scenario</button>
    </form>
    <div class="result" aria-live="polite">
      <div class="score">
        <span class="score-num" id="r-ewcs">–</span>
        <span class="score-meta"><span class="pill" id="r-pill"><span class="dot"></span>
          <span id="r-grade">–</span></span><span id="r-penalty" class="muted"></span></span>
      </div>
      <dl class="stats" id="r-stats"></dl>
      <div class="table-wrap"><table id="r-segs"><thead><tr><th>Segment</th>
        <th class="n">Length m</th><th class="n">Tmrt °C</th><th class="n">Feels °C</th>
        <th>Heat stress</th><th class="n">Pace ×</th><th class="n">Penalty ×</th>
        <th class="n">Perceived min</th></tr></thead><tbody></tbody></table></div>
    </div>
  </div>
  <h3>Sensitivity: EWCS by temperature and shade</h3>
  <p class="note">Deeper cells lose more of the walkable catchment. The outlined cell is
    nearest the scenario above. Length, sun and shade type as set above.</p>
  <div class="table-wrap"><table class="heat" id="heat-grid"></table></div>
</section>"""


# --------------------------------------------------------------------------- #
# Static assets
# --------------------------------------------------------------------------- #

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    "family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600"
    "&family=IBM+Plex+Sans+Arabic:wght@400;500&family=IBM+Plex+Mono:wght@400;500"
    '&display=swap">'
)

CSS = r"""
/* Layout: one reading column; the sticky nav is drawn as a metro line whose stops are the sections.
   The map breaks out to the full column width with a detail panel beside it. */
:root {
  --bg: #F3F5F6; --surface: #FFFFFF; --ink: #14202B; --muted: #5B6875; --rule: #D8DEE3;
  --accent: #0068BD; --heat: #C2410C; --on-heat: #FFFFFF;
  --land: #ECEFEA; --land-edge: #C9CFC7; --casing: #FFFFFF; --bus: #6B7A88;
  --good: #1D7A4C; --warn: #A86A0C; --crit: #B42318; --info: #1F6FAE;
  --display: "Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif;
  --body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --arabic: "IBM Plex Sans Arabic", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0B1016; --surface: #111922; --ink: #E4EAF0; --muted: #93A1AF; --rule: #243140;
  --accent: #5AA9F2; --heat: #F28C4E; --on-heat: #1B0D04;
  --land: #141C25; --land-edge: #2A3746; --casing: #0B1016; --bus: #8C9BAB;
  --good: #4FC08A; --warn: #E3AE4F; --crit: #F07468; --info: #6FB3EE; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0B1016; --surface: #111922; --ink: #E4EAF0; --muted: #93A1AF; --rule: #243140;
  --accent: #5AA9F2; --heat: #F28C4E; --on-heat: #1B0D04;
  --land: #141C25; --land-edge: #2A3746; --casing: #0B1016; --bus: #8C9BAB;
  --good: #4FC08A; --warn: #E3AE4F; --crit: #F07468; --info: #6FB3EE; color-scheme: dark; }

* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--body); margin: 0; }
.page { max-width: 1240px; margin: 0 auto; padding: 0 20px 64px; }
h1, h2, h3 { font-family: var(--display); font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(2.4rem, 6vw, 3.6rem); line-height: 1; letter-spacing: -0.01em; }
h2 { font-size: 2rem; line-height: 1.1; }
h3 { font-size: 1.3rem; margin: 28px 0 10px; }
p { margin: 0; }
a { color: var(--accent); }
[lang="ar"] { font-family: var(--arabic); }
code, pre { font-family: var(--mono); font-size: 0.86em; }
pre { background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px;
  overflow-x: auto; margin-top: 8px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.muted { color: var(--muted); }
.eyebrow { font: 600 0.74rem/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--accent); }
.lede { color: var(--muted); max-width: 72ch; }
.note { color: var(--muted); font-size: 0.86rem; margin-top: 8px; max-width: 80ch; }
.notice { border-left: 3px solid var(--info); padding: 8px 12px; background: var(--surface);
  color: var(--muted); font-size: 0.88rem; max-width: 90ch; }

.masthead { padding-block: 40px 20px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.masthead .meta { font: 0.8rem var(--mono); color: var(--muted); }
.masthead .title-ar { font: 500 1.4rem var(--arabic); color: var(--muted); }

.linenav { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20;
  background: var(--bg); border-bottom: 1px solid var(--rule); margin: 0 -20px; padding: 0 20px; }
.linenav ol { list-style: none; margin: 0; padding: 14px 0 10px; display: flex; overflow-x: auto; }
.linenav li { flex: 1 0 auto; position: relative; min-width: 104px; }
.linenav li::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 4px;
  background: var(--accent); }
.linenav li:first-child::before { left: 7px; }
.linenav li:last-child::before { right: calc(100% - 11px); }
.linenav a { position: relative; display: grid; gap: 6px; justify-items: start; color: var(--ink);
  text-decoration: none; font: 600 0.95rem var(--display); letter-spacing: 0.04em;
  text-transform: uppercase; padding-right: 12px; }
.linenav a::before { content: ""; width: 18px; height: 18px; border-radius: 50%;
  background: var(--surface); border: 4px solid var(--accent); }
.linenav a:hover::before, .linenav a:focus-visible::before { background: var(--accent); }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible,
summary:focus-visible, #map-svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.section { padding-block: 44px 8px; border-bottom: 1px solid var(--rule); scroll-margin-top: 70px; }
.section-head { display: grid; gap: 8px; margin-bottom: 20px; }

/* Facts */
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin: 0;
  border-top: 4px solid var(--accent); background: var(--surface); }
.fact { padding: 14px 16px; border-right: 1px solid var(--rule); display: grid; gap: 4px; }
.fact dt { font: 600 0.72rem var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.fact dd { margin: 0; display: grid; }
.fact .big { font: 600 1.9rem/1 var(--display); font-variant-numeric: tabular-nums; }
.fact .unit { font-size: 0.8rem; color: var(--muted); }

/* Tables */
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; }
table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--rule);
  white-space: nowrap; vertical-align: middle; }
td.wrap { white-space: normal; min-width: 180px; }
td.ar { font-family: var(--arabic); }
thead th { font: 600 0.7rem var(--mono); letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--muted); background: var(--bg); }
tbody tr:last-child td { border-bottom: 0; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
td.c { text-align: center; font-variant-numeric: tabular-nums; }
.roundel { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px;
  border-radius: 11px; font: 700 0.82rem var(--display); vertical-align: middle; }
.roundels { display: inline-flex; gap: 4px; }
.meter { display: inline-block; width: 44px; height: 6px; border-radius: 3px; margin-right: 8px;
  vertical-align: middle; background: linear-gradient(90deg, var(--accent) var(--v), var(--rule) var(--v)); }
.linkish { font: inherit; color: var(--ink); background: none; border: 0; padding: 0; cursor: pointer;
  text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
.linkish:hover { text-decoration-color: var(--accent); color: var(--accent); }

/* Validation */
.verdict-row { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; margin-bottom: 8px; }
.verdict { justify-self: start; width: fit-content; max-width: 100%; text-decoration: none;
  font: 600 1.05rem var(--display); letter-spacing: 0.03em; padding: 6px 12px;
  border-radius: 999px; border: 2px solid currentColor; }
.verdict.ok { color: var(--good); } .verdict.bad { color: var(--crit); }
.counts { display: flex; flex-wrap: wrap; gap: 8px; }
.count { font-size: 0.85rem; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--rule);
  background: var(--surface); }
.count strong { font-variant-numeric: tabular-nums; }
.status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 0.8rem; }
.status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.st-pass { color: var(--good); } .st-resolved { color: var(--info); } .st-note { color: var(--warn); }
.st-mismatch { color: var(--crit); } .st-error { color: var(--crit); }
.count.st-pass, .count.st-resolved, .count.st-note, .count.st-mismatch, .count.st-error { color: var(--ink); }
.count.st-pass strong { color: var(--good); } .count.st-resolved strong { color: var(--info); }
.count.st-note strong { color: var(--warn); } .count.st-mismatch strong, .count.st-error strong { color: var(--crit); }
.findings-t td { vertical-align: top; }
.all-checks { margin-top: 16px; }
.all-checks summary { cursor: pointer; font-weight: 600; padding: 6px 0; }

/* Map */
.mapbox { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 0; background: var(--surface);
  border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
.map-tools { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-start;
  padding: 12px; border-bottom: 1px solid var(--rule); }
.search input { font: inherit; font-size: 0.9rem; padding: 7px 10px; width: min(300px, 100%);
  border: 1px solid var(--rule); border-radius: 6px; background: var(--bg); color: var(--ink); }
.search { flex: 1 1 220px; min-width: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; font: 500 0.84rem var(--body);
  color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 999px;
  padding: 3px 10px 3px 4px; cursor: pointer; }
.chip[aria-pressed="false"] { opacity: 0.45; }
.chip[aria-pressed="false"] span:last-child { text-decoration: line-through; }
.chip:hover { border-color: var(--ink); }
.layers { flex: 1 1 100%; font-size: 0.86rem; }
.layers summary { cursor: pointer; font-weight: 600; width: max-content; }
.layer-grid { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 8px 0; }
.layer-grid label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
.layer-grid input, .layers input[type=range] { accent-color: var(--accent); }
.range-label { display: inline-flex; gap: 8px; margin-right: 10px; }
.range-label output { font-family: var(--mono); color: var(--accent); }
#catch-r { width: min(260px, 100%); vertical-align: middle; }

.map-stage { position: relative; min-width: 0; height: clamp(440px, 72vh, 780px); background: var(--land); }
#map-svg { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; user-select: none; }
#map-svg.dragging { cursor: grabbing; }
#map-svg path, #map-svg circle { vector-effect: non-scaling-stroke; }
#g-districts path { fill: var(--land); stroke: var(--land-edge); stroke-width: 0.8; }
#g-districts.choropleth path { fill: color-mix(in oklab, var(--accent) calc(var(--p) * 0.85), var(--land)); }
#g-districts path.hi { stroke: var(--ink); stroke-width: 2; }
#g-catch circle { fill: var(--accent); fill-opacity: 0.08; stroke: var(--accent); stroke-opacity: 0.35; stroke-width: 0.8; }
#g-catch.heat circle { fill: var(--heat); stroke: var(--heat); }
#g-bus path { fill: none; stroke: var(--bus); stroke-width: 2; stroke-dasharray: 5 4; stroke-linecap: round; }
#g-bus path.brt { stroke-dasharray: none; stroke-width: 2.4; }
#g-busstops circle { fill: var(--bus); stroke: var(--land); stroke-width: 0.6; }
#g-lines .casing { fill: none; stroke: var(--casing); stroke-width: 8; stroke-linecap: round; stroke-linejoin: round; }
#g-lines .ln { fill: none; stroke-width: 4.5; stroke-linecap: round; stroke-linejoin: round; transition: opacity .15s; }
#g-lines .hit { fill: none; stroke: transparent; stroke-width: 16; cursor: pointer; }
#g-lines.dim .ln:not(.hi), #g-lines.dim .casing:not(.hi) { opacity: 0.18; }
#g-lines .ln.hi { stroke-width: 7; }
#g-stations circle.mk { fill: var(--surface); stroke-width: 2.2; }
#g-stations circle.mk.x { fill: var(--surface); stroke: var(--ink); stroke-width: 2.6; }
#g-stations circle.hit { fill: transparent; cursor: pointer; }
#g-stations g.dim { opacity: 0.2; }
#g-stations g.sel circle.mk { stroke: var(--ink); stroke-width: 3.4; }
#g-stations circle.ring { fill: none; stroke: var(--ink); stroke-width: 1.5; stroke-dasharray: 3 3; }
#g-labels text { font: 600 12px var(--body); fill: var(--ink); stroke: var(--land); stroke-width: 3.5;
  paint-order: stroke; stroke-linejoin: round; pointer-events: none; }
#g-labels text.minor { font-weight: 500; font-size: 11px; }
#g-labels text.dist { font: 500 10px var(--mono); letter-spacing: 0.08em; fill: var(--muted); text-transform: uppercase; }
.map-ui { position: absolute; inset: 0; pointer-events: none; }
.zoom { position: absolute; top: 12px; right: 12px; display: grid; gap: 4px; pointer-events: auto; }
.zoom button { width: 34px; height: 34px; font: 600 1.1rem var(--body); color: var(--ink);
  background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; cursor: pointer; }
.zoom button:hover { border-color: var(--ink); }
.scale { position: absolute; left: 12px; bottom: 12px; display: grid; gap: 2px; font: 0.72rem var(--mono); color: var(--ink); }
#scale-bar { display: block; height: 6px; border: 1.5px solid var(--ink); border-top: 0; }
.legend-cov { position: absolute; left: 12px; bottom: 44px; background: var(--surface); border: 1px solid var(--rule);
  border-radius: 6px; padding: 6px 8px; font-size: 0.72rem; display: grid; gap: 4px; width: 180px; }
.legend-cov .grad { height: 8px; border-radius: 2px;
  background: linear-gradient(90deg, var(--land), color-mix(in oklab, var(--accent) 85%, var(--land))); }
.legend-cov .ends { display: flex; justify-content: space-between; color: var(--muted); font-family: var(--mono); }
.attrib { position: absolute; right: 12px; bottom: 8px; font: 0.66rem var(--mono); color: var(--muted); }
.tip { position: absolute; z-index: 5; pointer-events: none; background: var(--surface); color: var(--ink);
  border: 1px solid var(--rule); border-radius: 6px; padding: 6px 9px; font-size: 0.8rem; max-width: 260px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.14); }
.tip strong { display: block; }
.panel { border-left: 1px solid var(--rule); padding: 16px; overflow-y: auto; height: clamp(440px, 72vh, 780px);
  display: grid; align-content: start; gap: 12px; min-width: 0; }
.panel h3 { margin: 0; font-size: 1.5rem; line-height: 1.1; }
.panel .ar { font: 500 1.1rem var(--arabic); color: var(--muted); }
.panel dl { display: grid; grid-template-columns: minmax(6.5em, 38%) minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 0.86rem; }
.panel dt { color: var(--muted); } .panel dd { margin: 0; font-variant-numeric: tabular-nums; }
.panel .order { list-style: none; padding: 0; margin: 0; display: grid; gap: 0; font-size: 0.85rem; }
.panel .order li { display: flex; gap: 8px; align-items: center; padding: 3px 0; border-left: 4px solid var(--lc); padding-left: 10px; }
.panel .bar { height: 8px; border-radius: 4px; background: linear-gradient(90deg, var(--accent) var(--v), var(--rule) var(--v)); }
.panel .actions { display: flex; flex-wrap: wrap; gap: 6px; }
.panel .actions button { font: 500 0.82rem var(--body); padding: 5px 10px; border: 1px solid var(--accent);
  color: var(--accent); background: transparent; border-radius: 4px; cursor: pointer; }
.panel .actions button:hover { background: var(--accent); color: var(--surface); }
.panel-empty p { color: var(--muted); font-size: 0.88rem; }
@media (max-width: 820px) {
  .mapbox { grid-template-columns: 1fr; }
  .panel { border-left: 0; border-top: 1px solid var(--rule); height: auto; max-height: 60vh; }
  .map-stage { height: 62vh; min-height: 380px; }
}

/* Simulator */
.sim { display: grid; grid-template-columns: minmax(0, 330px) minmax(0, 1fr); gap: 24px; }
@media (max-width: 760px) { .sim { grid-template-columns: 1fr; } }
.controls { display: grid; gap: 6px; align-content: start; background: var(--surface);
  border: 1px solid var(--rule); border-radius: 6px; padding: 16px; }
.controls label { display: flex; justify-content: space-between; gap: 8px; font-size: 0.86rem; font-weight: 500; }
.controls output { font: 500 0.86rem var(--mono); color: var(--accent); }
.controls input[type=range] { width: 100%; accent-color: var(--accent); margin-bottom: 8px; }
.controls .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.controls .row label { display: block; margin-bottom: 4px; font-size: 0.78rem; }
.controls select, .controls input[type=number] { width: 100%; font: inherit; font-size: 0.86rem;
  padding: 5px 6px; border: 1px solid var(--rule); border-radius: 4px; background: var(--bg); color: var(--ink); }
.controls button { margin-top: 10px; font: 500 0.84rem var(--body); padding: 7px 10px;
  border: 1px solid var(--accent); color: var(--accent); background: transparent; border-radius: 4px; cursor: pointer; }
.controls button:hover { background: var(--accent); color: var(--surface); }
.result { display: grid; gap: 16px; min-width: 0; align-content: start; }
.score { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.score-num { font: 700 4.2rem/0.9 var(--display); font-variant-numeric: tabular-nums; }
.score-meta { display: grid; gap: 6px; font-size: 0.86rem; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
  border: 1px solid currentColor; font-weight: 600; width: max-content; }
.pill .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.pill.good { color: var(--good); } .pill.warn { color: var(--warn); } .pill.crit { color: var(--crit); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0; margin: 0;
  border-top: 1px solid var(--rule); }
.stats div { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--rule); }
.stats dt { font-size: 0.76rem; color: var(--muted); }
.stats dd { margin: 0; font: 600 1.15rem var(--display); font-variant-numeric: tabular-nums; }
table.heat td { text-align: center; font-variant-numeric: tabular-nums; min-width: 56px;
  background: color-mix(in oklab, var(--heat) var(--p), var(--surface)); color: var(--ink); border: 2px solid var(--surface); }
table.heat td.deep { color: var(--on-heat); }
table.heat td.here { outline: 2px solid var(--ink); outline-offset: -3px; }
table.heat th { text-align: center; } table.heat tbody th { text-align: right; }

.method { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
.method > div { min-width: 0; }
.method p { font-size: 0.9rem; color: var(--muted); margin-top: 8px; }
.method h3 { margin-top: 0; }
.sources { padding-left: 18px; display: grid; gap: 6px; font-size: 0.9rem; }
footer.colophon { padding-block: 24px; font: 0.78rem var(--mono); color: var(--muted); }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
"""

MAP_JS = r"""
(() => {
  const D = __MAP__;
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const svg = $("map-svg"), world = $("world"), stage = svg.parentElement;
  const G = { dist: $("g-districts"), catch: $("g-catch"), bus: $("g-bus"), busStops: $("g-busstops"),
              lines: $("g-lines"), st: $("g-stations"), labels: $("g-labels") };
  const tip = $("map-tip"), panel = $("map-panel");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const fmt = (v, d = 1) => (v === null || v === undefined) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  const lineById = Object.fromEntries(D.lines.map((l) => [l.id, l]));
  const lineByRef = Object.fromEntries(D.lines.map((l) => [l.ref, l]));
  const stByName = new Map(D.stations.map((s) => [s.n.toLowerCase(), s]));
  const distByName = new Map(D.districts.filter((d) => d.n).map((d) => [d.n.toLowerCase(), d]));
  const roundel = (ref) => { const l = lineByRef[ref]; if (!l) return "";
    return `<span class="roundel" style="background:${l.color};color:${l.text}">${esc(ref)}</span>`; };

  let W = 1, H = 1, k = 1, tx = 0, ty = 0, kFit = 1;
  const hiddenLines = new Set();
  let selected = null, radius = 800, heat = window.__heat || null;

  // ---------------------------------------------------------------- build
  const distEls = D.districts.map((d, i) => el("path", { d: d.d, style: `--p:${d.cov}%`, "data-kind": "district", "data-i": i }, G.dist));
  const catchEls = D.stations.map((s) => el("circle", { cx: s.x, cy: s.y, r: radius }, G.catch));
  D.bus.routes.forEach((r, i) => el("path", { d: r.d, class: r.brt ? "brt" : "", "data-kind": "bus", "data-i": i }, G.bus));
  const busStopEls = D.bus.stops.map(([x, y]) => el("circle", { cx: x, cy: y, r: 2 }, G.busStops));
  const lineEls = {};
  for (const l of D.lines) {
    const casing = el("path", { d: l.d, class: "casing", "data-line": l.id }, G.lines);
    const ln = el("path", { d: l.d, class: "ln", stroke: l.color, "data-line": l.id }, G.lines);
    const hit = el("path", { d: l.d, class: "hit", "data-kind": "line", "data-id": l.id }, G.lines);
    lineEls[l.id] = [casing, ln, hit];
  }
  const stEls = D.stations.map((s, i) => {
    const g = el("g", { "data-kind": "station", "data-i": i }, G.st);
    const x = s.l.length > 1;
    const color = x ? "" : (lineByRef[s.l[0]] || {}).color || "currentColor";
    const mk = el("circle", { cx: s.x, cy: s.y, r: 4, class: "mk" + (x ? " x" : "") }, g);
    if (!x) mk.setAttribute("stroke", color);
    const hit = el("circle", { cx: s.x, cy: s.y, r: 10, class: "hit", "data-kind": "station", "data-i": i }, g);
    return { g, mk, hit, x };
  });
  const show = (g, on) => { g.style.display = on ? "" : "none"; };
  show(G.busStops, false); show(G.bus, false);

  // ---------------------------------------------------------------- view
  function resize() {
    const r = svg.getBoundingClientRect();
    const first = W === 1;
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const [x0, y0, x1, y1] = D.bounds;
    kFit = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.94;
    if (first) fit(false); else apply();
  }
  function fit(animate = true) {
    const [x0, y0, x1, y1] = D.bounds;
    flyTo((x0 + x1) / 2, (y0 + y1) / 2, kFit, animate);
  }
  const clampK = (v) => Math.min(kFit * 80, Math.max(kFit * 0.6, v));
  function zoomAt(sx, sy, f) {
    const k2 = clampK(k * f); f = k2 / k;
    tx = sx - (sx - tx) * f; ty = sy - (sy - ty) * f; k = k2; apply();
  }
  let anim = 0;
  function flyTo(x, y, k2, animate = true) {
    k2 = clampK(k2);
    const end = { k: k2, tx: W / 2 - x * k2, ty: H / 2 - y * k2 };
    cancelAnimationFrame(anim);
    if (!animate || reduce) { k = end.k; tx = end.tx; ty = end.ty; apply(); return; }
    const start = { k, tx, ty }, t0 = performance.now(), dur = 480;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // interpolate in log-zoom for a steady feel, keep the target centred
      k = Math.exp(Math.log(start.k) + (Math.log(end.k) - Math.log(start.k)) * e);
      const cx0 = (W / 2 - start.tx) / start.k, cy0 = (H / 2 - start.ty) / start.k;
      const cx = cx0 + (x - cx0) * e, cy = cy0 + (y - cy0) * e;
      tx = W / 2 - cx * k; ty = H / 2 - cy * k; apply();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  let pending = false;
  function apply() {
    world.setAttribute("transform", `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(6)})`);
    const px = 1 / k;
    for (const s of stEls) {
      s.mk.setAttribute("r", ((s.x ? 6.5 : 4.2) * px).toFixed(2));
      s.hit.setAttribute("r", (12 * px).toFixed(2));
    }
    const bs = (k > kFit * 3 ? 2.6 : 1.8) * px;
    for (const c of busStopEls) c.setAttribute("r", bs.toFixed(2));
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; labels(); scale(); }); }
  }
  function scale() {
    let m = 90 / k; const p = Math.pow(10, Math.floor(Math.log10(m)));
    m = [5, 2.5, 2, 1].map((f) => f * p).find((v) => v <= m) || p;
    $("scale-bar").style.width = (m * k).toFixed(0) + "px";
    $("scale-t").textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
  }

  // ---------------------------------------------------------------- labels
  function stationVisible(s) { return s.l.some((r) => !hiddenLines.has((lineByRef[r] || {}).id)); }
  function labels() {
    G.labels.replaceChildren();
    if (!$("lyr-labels").checked) return;
    const boxes = [];  // [x0, y0, x1, y1, owner station index or -1]
    const hitBox = (b, own = -2) => boxes.some((o) => o[4] !== own && !(b[2] < o[0] || o[2] < b[0] || b[3] < o[1] || o[3] < b[1]));
    const onScreen = (sx, sy) => sx > -40 && sx < W + 40 && sy > -20 && sy < H + 20;
    const scr = (s) => [s.x * k + tx, s.y * k + ty];
    D.stations.forEach((s, i) => { if (!stationVisible(s)) return; const [sx, sy] = scr(s); const r = s.l.length > 1 ? 7 : 5; boxes.push([sx - r, sy - r, sx + r, sy + r, i]); });
    const order = D.stations.map((s, i) => ({ s, i, pri: (selected && selected.kind === "station" && selected.i === i ? 1e9 : 0) + (s.l.length > 1 ? 1e6 : 0) + s.dep }))
      .sort((a, b) => b.pri - a.pri);
    const showMinor = k >= kFit * 1.7;
    for (const { s, i } of order) {
      if (!stationVisible(s)) continue;
      const major = s.l.length > 1 || (selected && selected.kind === "station" && selected.i === i);
      if (!major && !showMinor) continue;
      const [sx, sy] = scr(s); if (!onScreen(sx, sy)) continue;
      const fs = major ? 12 : 11, w = s.n.length * fs * (major ? 0.62 : 0.58), h = fs;
      const cand = [[sx + 9, sy + 4, "start"], [sx - 9, sy + 4, "end"], [sx, sy - 10, "middle"], [sx, sy + fs + 8, "middle"],
                    [sx + 7, sy - 8, "start"], [sx - 7, sy - 8, "end"], [sx + 7, sy + fs + 4, "start"], [sx - 7, sy + fs + 4, "end"]];
      for (const [lx, ly, a] of cand) {
        const x0 = a === "start" ? lx : a === "end" ? lx - w : lx - w / 2;
        const b = [x0 - 2, ly - h, x0 + w + 2, ly + 3];
        if (b[0] < 2 || b[2] > W - 2 || b[1] < 2 || b[3] > H - 2 || hitBox(b, i)) continue;
        boxes.push([...b, -1]);
        const t = el("text", { x: lx.toFixed(1), y: ly.toFixed(1), "text-anchor": a, class: major ? "" : "minor" }, G.labels);
        t.textContent = s.n; break;
      }
    }
    if ($("lyr-districts").checked && k >= kFit * 2.4) {
      for (const d of D.districts) {
        if (!d.n) continue;
        const sx = d.cx * k + tx, sy = d.cy * k + ty; if (!onScreen(sx, sy)) continue;
        const text = d.n.replace(/ District$/, ""), w = text.length * 6.6;
        const b = [sx - w / 2, sy - 9, sx + w / 2, sy + 3];
        if (hitBox(b)) continue; boxes.push([...b, -1]);
        const t = el("text", { x: sx.toFixed(1), y: sy.toFixed(1), "text-anchor": "middle", class: "dist" }, G.labels);
        t.textContent = text;
      }
    }
  }

  // ---------------------------------------------------------------- catchments
  function updateCatch() {
    const heatOn = $("lyr-heat").checked && heat;
    const r = heatOn ? radius * heat.ewcs / 100 : radius;
    catchEls.forEach((c, i) => { c.setAttribute("r", r.toFixed(0)); c.style.display = stationVisible(D.stations[i]) ? "" : "none"; });
    G.catch.classList.toggle("heat", !!heatOn);
    $("catch-o").textContent = heatOn ? `${radius} m → ${Math.round(r)} m at ${heat.temp.toFixed(1)} °C` : `${radius} m`;
    if (selected) showPanel(selected, false);
  }
  window.addEventListener("heatchange", (e) => { heat = e.detail; updateCatch(); });

  // ---------------------------------------------------------------- selection & panels
  function highlightLine(id) {
    G.lines.classList.toggle("dim", !!id);
    for (const [lid, els] of Object.entries(lineEls)) els.slice(0, 2).forEach((e) => e.classList.toggle("hi", lid === id));
    const ref = id ? lineById[id].ref : null;
    D.stations.forEach((s, i) => stEls[i].g.classList.toggle("dim", !!ref && !s.l.includes(ref)));
  }
  function clearSel() {
    selected = null; highlightLine(null);
    stEls.forEach((s) => s.g.classList.remove("sel"));
    distEls.forEach((d) => d.classList.remove("hi"));
    panel.innerHTML = panel.dataset.empty; labels();
  }
  function heatLine() {
    if (!heat) return "";
    const eff = Math.round(radius * heat.ewcs / 100);
    return `<dt>Heat-adjusted walk</dt><dd>${eff.toLocaleString()} m of ${radius} m at ${heat.temp.toFixed(1)} °C, ${Math.round(heat.shade)}% shade (EWCS ${fmt(heat.ewcs)})</dd>`;
  }
  function stationPanel(s) {
    const lines = s.l.map(roundel).join(" ");
    const place = [s.d && `${esc(s.d)}${s.dar ? ` · <span lang="ar" dir="rtl">${esc(s.dar)}</span>` : ""}`, s.m && esc(s.m)].filter(Boolean).join("<br>");
    return `<div><p class="eyebrow">Station</p><h3>${esc(s.n)}</h3>${s.ar ? `<p class="ar" lang="ar" dir="rtl">${esc(s.ar)}</p>` : ""}</div>
      <div class="roundels">${lines}</div>
      <dl>
        ${s.c.length ? `<dt>Station code</dt><dd>${s.c.map(esc).join(", ")}</dd>` : ""}
        ${place ? `<dt>Area</dt><dd>${place}</dd>` : ""}
        <dt>Departures</dt><dd>${s.dep.toLocaleString()} per weekday</dd>
        <dt>Peak departures</dt><dd>${s.pk.toLocaleString()}</dd>
        <dt>Combined peak headway</dt><dd>${fmt(s.hw, 2)} min</dd>
        ${s.tfi !== null ? `<dt>Transfer friction</dt><dd>${fmt(s.tfi)} (hub score ${fmt(s.hub, 0)})</dd>` : ""}
        <dt>Walk catchment</dt><dd>${radius.toLocaleString()} m</dd>
        ${heatLine()}
        ${s.al.length ? `<dt>Also mapped as</dt><dd>${s.al.map(esc).join(", ")} (OSM)</dd>` : ""}
        <dt>Coordinates</dt><dd>${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</dd>
      </dl>
      <div class="actions"><button type="button" data-act="zoom">Zoom to station</button>
        ${s.l.map((r) => `<button type="button" data-act="line" data-ref="${esc(r)}">Line ${esc(r)}</button>`).join("")}</div>`;
  }
  function linePanel(l) {
    const off = l.official_km, dOff = off ? (l.km - off) / off * 100 : null;
    const order = l.stations_order.map((n) => `<li style="--lc:${l.color}"><button type="button" class="linkish" data-goto="${esc(n)}">${esc(n)}</button>${(stByName.get(n.toLowerCase()) || { l: [] }).l.filter((r) => r !== l.ref).map(roundel).join("")}</li>`).join("");
    return `<div><p class="eyebrow">Line ${esc(l.ref)}</p><h3>${esc(l.name)}</h3>${l.name_ar ? `<p class="ar" lang="ar" dir="rtl">${esc(l.name_ar)}</p>` : ""}</div>
      <dl>
        <dt>Termini</dt><dd>${l.termini.map(esc).join(" ↔ ")}</dd>
        <dt>Opened</dt><dd>${esc(l.opened || "—")}</dd>
        <dt>Official length</dt><dd>${fmt(off)} km</dd>
        <dt>Independent survey</dt><dd>${fmt(l.urbanrail_km)} km</dd>
        <dt>Mapped (OSM)</dt><dd>${fmt(l.km, 2)} km${dOff !== null ? ` (${dOff > 0 ? "+" : ""}${fmt(dOff)}% vs official)` : ""}</dd>
        <dt>Stations</dt><dd>${l.stops} mapped · ${l.official_stations ?? "—"} official</dd>
        <dt>Headway</dt><dd>${fmt(l.hw_peak)} min peak · ${fmt(l.hw_off)} min off-peak (modelled)</dd>
        <dt>Service</dt><dd>${esc(l.span)} · ${l.trips.toLocaleString()} trips/day</dd>
        <dt>Avg speed</dt><dd>${fmt(l.speed)} km/h (modelled)</dd>
      </dl>
      <div class="actions"><button type="button" data-act="zoomline">Zoom to line</button><button type="button" data-act="clear">Clear</button></div>
      <ol class="order">${order}</ol>`;
  }
  function districtPanel(d) {
    const inside = D.stations.filter((s) => s.d === d.n);
    return `<div><p class="eyebrow">Neighbourhood</p><h3>${esc(d.n || "Unnamed")}</h3>${d.ar ? `<p class="ar" lang="ar" dir="rtl">${esc(d.ar)}</p>` : ""}</div>
      <dl>${d.mu ? `<dt>Municipality</dt><dd>${esc(d.mu)}</dd>` : ""}
        <dt>Area</dt><dd>${fmt(d.km2, 2)} km²</dd>
        <dt>Metro stations</dt><dd>${inside.length}</dd>
        <dt>Within ${D.coverage_radius} m</dt><dd>${fmt(d.cov)}% of its area</dd></dl>
      <div class="bar" style="--v:${d.cov}%" role="img" aria-label="${fmt(d.cov)} percent covered"></div>
      ${inside.length ? `<ol class="order">${inside.map((s) => `<li style="--lc:${(lineByRef[s.l[0]] || {}).color}"><button type="button" class="linkish" data-goto="${esc(s.n)}">${esc(s.n)}</button>${s.l.map(roundel).join("")}</li>`).join("")}</ol>` : `<p class="muted">No metro station inside this neighbourhood.</p>`}`;
  }
  function showPanel(sel, move = true) {
    selected = sel;
    stEls.forEach((s) => s.g.classList.remove("sel"));
    distEls.forEach((d) => d.classList.remove("hi"));
    if (sel.kind === "station") {
      const s = D.stations[sel.i]; stEls[sel.i].g.classList.add("sel"); highlightLine(null);
      panel.innerHTML = stationPanel(s);
      if (move) flyTo(s.x, s.y, Math.max(k, kFit * 3.2));
    } else if (sel.kind === "line") {
      const l = lineById[sel.id]; highlightLine(sel.id); panel.innerHTML = linePanel(l);
      if (move) zoomToLine(l);
    } else if (sel.kind === "district") {
      const d = D.districts[sel.i]; distEls[sel.i].classList.add("hi"); highlightLine(null);
      panel.innerHTML = districtPanel(d);
      if (move) { const bb = distEls[sel.i].getBBox(); flyTo(bb.x + bb.width / 2, bb.y + bb.height / 2, Math.min(W / bb.width, H / bb.height) * 0.6); }
    }
    labels();
  }
  function zoomToLine(l) {
    const bb = lineEls[l.id][1].getBBox();
    flyTo(bb.x + bb.width / 2, bb.y + bb.height / 2, Math.min(W / bb.width, H / bb.height) * 0.85);
  }
  panel.dataset.empty = panel.innerHTML;
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.goto) return gotoName(b.dataset.goto);
    const act = b.dataset.act;
    if (act === "clear") return clearSel();
    if (act === "zoom" && selected && selected.kind === "station") { const s = D.stations[selected.i]; return flyTo(s.x, s.y, kFit * 6); }
    if (act === "line") return showPanel({ kind: "line", id: lineByRef[b.dataset.ref].id });
    if (act === "zoomline" && selected) return zoomToLine(lineById[selected.id]);
  });
  function gotoName(name) {
    const key = String(name).trim().toLowerCase();
    let i = D.stations.findIndex((s) => s.n.toLowerCase() === key || s.ar === name.trim());
    if (i >= 0) return showPanel({ kind: "station", i });
    i = D.districts.findIndex((d) => d.n.toLowerCase() === key || d.ar === name.trim());
    if (i >= 0) return showPanel({ kind: "district", i });
    i = D.stations.findIndex((s) => s.n.toLowerCase().includes(key));
    if (i >= 0 && key.length > 2) return showPanel({ kind: "station", i });
    return false;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b && !panel.contains(b)) { gotoName(b.dataset.goto); document.getElementById("map").scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); }
  });
  const search = $("map-search");
  let lastQuery = "";
  const runSearch = () => {
    const q = search.value.trim();
    if (!q || q === lastQuery) return;  // blur after Enter fires "change" again; ignore repeats
    lastQuery = q;
    if (gotoName(q) === false) { search.setCustomValidity("No station or neighbourhood by that name"); search.reportValidity(); }
    else search.setCustomValidity("");
  };
  search.addEventListener("change", runSearch);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });
  search.addEventListener("input", () => { search.setCustomValidity(""); lastQuery = ""; });

  // ---------------------------------------------------------------- hover
  function targetInfo(t) {
    const n = t && t.closest && t.closest("[data-kind]"); if (!n) return null;
    const kind = n.dataset.kind;
    if (kind === "station") return { kind, i: +n.dataset.i };
    if (kind === "line") return { kind, id: n.dataset.id };
    if (kind === "district") return { kind, i: +n.dataset.i };
    if (kind === "bus") return { kind, i: +n.dataset.i };
    return null;
  }
  function tipHtml(info) {
    if (info.kind === "station") { const s = D.stations[info.i];
      return `<strong>${esc(s.n)}</strong>${s.ar ? `<span lang="ar" dir="rtl">${esc(s.ar)}</span><br>` : ""}${s.l.map(roundel).join(" ")} · ${s.dep.toLocaleString()} departures/day`; }
    if (info.kind === "line") { const l = lineById[info.id];
      return `<strong>${esc(l.name)}</strong>${fmt(l.km)} km mapped · ${l.stops} stations`; }
    if (info.kind === "district") { const d = D.districts[info.i];
      return `<strong>${esc(d.n || "Unnamed")}</strong>${d.ar ? `<span lang="ar" dir="rtl">${esc(d.ar)}</span><br>` : ""}${fmt(d.cov)}% within ${D.coverage_radius} m of a station`; }
    if (info.kind === "bus") { const r = D.bus.routes[info.i];
      return `<strong>Bus ${esc(r.ref)}</strong>${r.brt ? "Bus rapid transit" : "Community bus"} · OSM (partial network)`; }
    return "";
  }
  let hoverLine = null;
  function hover(e) {
    const info = targetInfo(document.elementFromPoint(e.clientX, e.clientY));
    if (!info) { tip.hidden = true; if (hoverLine && !(selected && selected.kind === "line")) highlightLine(null); hoverLine = null; return; }
    tip.innerHTML = tipHtml(info); tip.hidden = false;
    const r = stage.getBoundingClientRect();
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + tip.offsetWidth > r.width - 8) x = e.clientX - r.left - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > r.height - 8) y = e.clientY - r.top - tip.offsetHeight - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
    if (info.kind === "line" && !selected) { hoverLine = info.id; highlightLine(info.id); }
    else if (hoverLine && !(selected && selected.kind === "line")) { highlightLine(null); hoverLine = null; }
  }

  // ---------------------------------------------------------------- pointer / wheel / keys
  const pts = new Map(); let moved = 0, last = null, pinch = null;
  svg.addEventListener("pointerdown", (e) => {
    svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    moved = 0; last = [e.clientX, e.clientY]; svg.classList.add("dragging"); tip.hidden = true;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) { if (e.pointerType === "mouse") hover(e); return; }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const r = svg.getBoundingClientRect();
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      tx += m[0] - pinch.m[0]; ty += m[1] - pinch.m[1];
      zoomAt(m[0] - r.left, m[1] - r.top, d / pinch.d); pinch = { d, m }; moved += 10; return;
    }
    const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY];
    moved += Math.abs(dx) + Math.abs(dy); tx += dx; ty += dy; apply();
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      svg.classList.remove("dragging");
      if (moved < 6) {
        const info = targetInfo(document.elementFromPoint(e.clientX, e.clientY));
        if (info && info.kind !== "bus") showPanel(info, info.kind !== "district");
        else if (!info) clearSel();
      }
    }
  };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
  svg.addEventListener("pointerleave", () => { if (!pts.size) tip.hidden = true; });
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0016))); }, { passive: false });
  svg.addEventListener("dblclick", (e) => { const r = svg.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 2); });
  svg.addEventListener("keydown", (e) => {
    const step = 60, map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (map[e.key]) { tx += map[e.key][0]; ty += map[e.key][1]; apply(); e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") { zoomAt(W / 2, H / 2, 1.4); e.preventDefault(); }
    else if (e.key === "-" || e.key === "_") { zoomAt(W / 2, H / 2, 1 / 1.4); e.preventDefault(); }
    else if (e.key === "0") { fit(); e.preventDefault(); }
    else if (e.key === "Escape") clearSel();
  });
  $("z-in").addEventListener("click", () => zoomAt(W / 2, H / 2, 1.6));
  $("z-out").addEventListener("click", () => zoomAt(W / 2, H / 2, 1 / 1.6));
  $("z-fit").addEventListener("click", () => fit());

  // ---------------------------------------------------------------- controls
  for (const chip of document.querySelectorAll(".line-chip")) {
    const id = chip.dataset.line;
    chip.addEventListener("click", () => {
      const off = !hiddenLines.has(id);
      if (off) hiddenLines.add(id); else hiddenLines.delete(id);
      chip.setAttribute("aria-pressed", String(!off));
      lineEls[id].forEach((e) => { e.style.display = off ? "none" : ""; });
      D.stations.forEach((s, i) => { stEls[i].g.style.display = stationVisible(s) ? "" : "none"; });
      updateCatch(); labels();
    });
    chip.addEventListener("mouseenter", () => { if (!selected) highlightLine(id); });
    chip.addEventListener("mouseleave", () => { if (!selected) highlightLine(null); });
    chip.addEventListener("dblclick", () => showPanel({ kind: "line", id }));
  }
  const bind = (id, fn) => $(id).addEventListener("change", fn);
  bind("lyr-districts", () => { G.dist.style.display = $("lyr-districts").checked ? "" : "none"; labels(); });
  bind("lyr-coverage", () => { const on = $("lyr-coverage").checked; G.dist.classList.toggle("choropleth", on); $("legend-cov").hidden = !on;
    if (on && !$("lyr-districts").checked) { $("lyr-districts").checked = true; G.dist.style.display = ""; } });
  bind("lyr-catch", () => { G.catch.style.display = $("lyr-catch").checked ? "" : "none"; });
  bind("lyr-heat", () => { if ($("lyr-heat").checked && !$("lyr-catch").checked) { $("lyr-catch").checked = true; G.catch.style.display = ""; } updateCatch(); });
  bind("lyr-bus", () => show(G.bus, $("lyr-bus").checked));
  bind("lyr-busstops", () => show(G.busStops, $("lyr-busstops").checked));
  bind("lyr-labels", labels);
  $("catch-r").addEventListener("input", () => { radius = +$("catch-r").value; updateCatch(); });

  new ResizeObserver(() => resize()).observe(svg);
  resize(); updateCatch();
})();
"""

HEAT_JS = r"""
(() => {
  const P = __PARAMS__;
  const SHADE = __SHADE__;
  const DEFAULTS = __DEFAULTS__;
  const $ = (id) => document.getElementById(id);

  function band(c) {
    if (c > 46) return "extreme heat stress";
    if (c > 38) return "very strong heat stress";
    if (c > 32) return "strong heat stress";
    if (c > 26) return "moderate heat stress";
    if (c > 9) return "no thermal stress";
    return "cold stress";
  }
  function grade(e) {
    for (const [t, g] of [[90, "A"], [80, "B"], [70, "C"], [60, "D"], [50, "E"]]) if (e >= t) return g;
    return "F";
  }
  function segment(kind, dist, s, unshadedM) {
    const [q, evap] = SHADE[s.type];
    const solarIdx = s.solar / 1000;
    const dSun = P.radiant_gain_c_per_kw * solarIdx;
    const ta = kind === "unshaded" ? s.temp : s.temp - evap;
    const dMrt = kind === "unshaded" ? dSun : dSun * (1 - 0.85 * q);
    const w = Math.max(0, Math.min(s.wind, 6) - 0.5);
    const relief = s.temp < 35 ? 0.6 * w : 0.2 * w;
    const hum = 0.04 * Math.max(0, s.rh - 40);
    const cti = ta + P.radiant_weight * dMrt + hum - relief;
    let pace = 1 - P.speed_decay_per_c * Math.max(0, cti - P.comfort_threshold_c);
    pace = Math.min(1, Math.max(P.min_speed_factor, pace));
    const excess = Math.max(0, s.temp - P.penalty_threshold_c);
    const pen = kind === "unshaded"
      ? 1 + excess * (P.unshaded_penalty_per_c * solarIdx + P.exposure_amplification_per_c_km * unshadedM / 1000)
      : 1 + P.shaded_penalty_per_c * excess;
    const walk = dist / (s.walk * pace) / 60;
    return { kind, dist, mrt: ta + dMrt, cti, stress: band(cti), pace, pen, walk, perceived: walk * pen };
  }
  function simulate(s) {
    const shaded = s.dist * s.shade / 100, unshaded = s.dist - shaded;
    const segs = [["shaded", shaded], ["unshaded", unshaded]].filter(([, d]) => d > 0)
      .map(([k, d]) => segment(k, d, s, unshaded));
    const t0 = s.dist / s.walk / 60;
    const perceived = segs.reduce((a, g) => a + g.perceived, 0);
    const heat = segs.reduce((a, g) => a + g.walk, 0);
    const ewcs = Math.min(100, perceived ? 100 * t0 / perceived : 100);
    const dose = segs.reduce((a, g) => a + Math.max(0, g.cti - P.comfort_threshold_c) * g.walk, 0);
    return { segs, t0, heat, perceived, ewcs, dose, rEff: s.dist * ewcs / 100,
             areaLoss: 100 * (1 - (ewcs / 100) ** 2), penalty: s.temp > P.penalty_threshold_c };
  }
  function shadeNeeded(s, target) {
    const at = (x) => simulate({ ...s, shade: x }).ewcs;
    if (at(100) < target) return null;
    if (at(0) >= target) return 0;
    let lo = 0, hi = 100;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (at(m) >= target) hi = m; else lo = m; }
    return hi;
  }
  const f1 = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const f0 = (v) => Math.round(v).toLocaleString();

  function read() {
    const num = (id, fb) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : fb; };
    return { temp: num("in-temp", 44), shade: num("in-shade", 35), dist: num("in-dist", 800),
             solar: num("in-solar", 950), type: $("in-type").value,
             rh: Math.min(100, Math.max(0, num("in-rh", 15))),
             wind: Math.min(15, Math.max(0, num("in-wind", 1.5))), walk: 1.34 };
  }
  const TEMPS = [36, 40, 42, 44, 46, 48], SHADES = [0, 20, 40, 60, 80, 100];

  function render() {
    const s = read();
    $("o-temp").textContent = s.temp.toFixed(1) + " °C";
    $("o-shade").textContent = Math.round(s.shade) + "%";
    $("o-dist").textContent = f0(s.dist) + " m";
    $("o-solar").textContent = f0(s.solar) + " W/m²";
    const r = simulate(s);
    const g = grade(r.ewcs), cls = r.ewcs >= 80 ? "good" : r.ewcs >= 60 ? "warn" : "crit";
    const label = cls === "good" ? "Comfortable" : cls === "warn" ? "Degraded" : "Severe loss";
    $("r-ewcs").textContent = f1(r.ewcs);
    $("r-pill").className = "pill " + cls;
    $("r-grade").textContent = "Grade " + g + " · " + label;
    $("r-penalty").textContent = r.penalty ? "Heat penalty active (air above 40 °C)" : "Below 40 °C: no distance penalty";
    const need = shadeNeeded(s, 70);
    const stats = [
      ["Nominal walk", f1(r.t0) + " min"], ["Heat-adjusted walk", f1(r.heat) + " min"],
      ["Perceived walk", f1(r.perceived) + " min"], ["Extra perceived time", "+" + f1(r.perceived - r.t0) + " min"],
      ["Effective catchment radius", f0(r.rEff) + " m"], ["Catchment area lost", f1(r.areaLoss) + "%"],
      ["Heat exposure dose", f0(r.dose) + " °C·min"],
      ["Shade needed for EWCS 70", need === null ? "Not reachable" : Math.ceil(need) + "%"],
    ];
    $("r-stats").innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    $("r-segs").tBodies[0].innerHTML = r.segs.map((x) => `<tr><td>${x.kind}</td><td class="n">${f0(x.dist)}</td>
      <td class="n">${f1(x.mrt)}</td><td class="n">${f1(x.cti)}</td><td>${x.stress}</td>
      <td class="n">${x.pace.toFixed(2)}</td><td class="n">${x.pen.toFixed(2)}</td><td class="n">${f1(x.perceived)}</td></tr>`).join("");

    const nearT = TEMPS.reduce((a, b) => Math.abs(b - s.temp) < Math.abs(a - s.temp) ? b : a);
    const nearS = SHADES.reduce((a, b) => Math.abs(b - s.shade) < Math.abs(a - s.shade) ? b : a);
    let html = "<thead><tr><th>Air °C \\ shade</th>" + SHADES.map((x) => `<th class="n">${x}%</th>`).join("") + "</tr></thead><tbody>";
    for (const t of TEMPS) {
      html += `<tr><th scope="row">${t} °C</th>`;
      for (const sh of SHADES) {
        const e = simulate({ ...s, temp: t, shade: sh }).ewcs;
        const p = Math.max(0, Math.min(100, (100 - e) / 65 * 100));
        const here = t === nearT && sh === nearS ? " here" : "";
        html += `<td class="${p > 55 ? "deep" : ""}${here}" style="--p:${p.toFixed(0)}%" title="${t} °C, ${sh}% shade: EWCS ${f1(e)}">${Math.round(e)}</td>`;
      }
      html += "</tr>";
    }
    $("heat-grid").innerHTML = html + "</tbody>";
    window.__heat = { ewcs: r.ewcs, temp: s.temp, shade: s.shade, type: s.type, dist: s.dist };
    window.dispatchEvent(new CustomEvent("heatchange", { detail: window.__heat }));
  }
  $("sim-form").addEventListener("input", render);
  $("sim-form").addEventListener("submit", (ev) => ev.preventDefault());
  $("reset").addEventListener("click", () => {
    for (const [id, v] of Object.entries(DEFAULTS)) $(id).value = v;
    render();
  });
  render();
})();
"""


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #


def _json_for_script(data: object) -> str:
    """JSON safe to inline in a <script> element."""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def build_html_report(inputs: ReportInputs | None = None, fragment: bool = False) -> str:
    """Run the analysis and return the complete report as one HTML string.

    ``fragment=True`` omits the ``<!doctype>/<html>/<head>/<body>`` wrapper
    (for hosts that supply their own document skeleton).
    """
    inputs = inputs or ReportInputs()
    gtfs_path = inputs.gtfs or riyadh_gtfs_path()
    districts_path = inputs.geojson or sample_districts_path()
    bundled = inputs.gtfs is None

    reference = load_reference()
    plan = reference.service_plan
    from transit_scope.gtfs import TimeWindow

    config = AnalysisConfig(peak_windows=[TimeWindow.parse(w) for w in plan.peak_windows])
    result = analyze_feed(load_feed(gtfs_path), config)
    payload = _map_payload(result, districts_path, reference if bundled else None)
    validation = None
    vpath = DATA_DIR / VALIDATION_NAME
    if bundled and vpath.exists():
        validation = json.loads(vpath.read_text(encoding="utf-8"))
    simulate_corridor(CorridorInput(
        distance_m=inputs.distance_m, shade_pct=inputs.shade_pct, temp_c=inputs.temp_c))

    defaults = {
        "in-temp": inputs.temp_c, "in-shade": inputs.shade_pct, "in-dist": inputs.distance_m,
        "in-solar": 950, "in-type": "mixed", "in-rh": 15, "in-wind": 1.5,
    }
    heat_js = (
        HEAT_JS.replace("__PARAMS__", ModelParameters().model_dump_json())
        .replace("__SHADE__", json.dumps({k.value: list(v) for k, v in SHADE_PROPERTIES.items()}))
        .replace("__DEFAULTS__", json.dumps(defaults))
    )
    map_js = MAP_JS.replace("__MAP__", _json_for_script(payload))
    today = date.today().isoformat()
    counts = ""
    if validation:
        c = {k: sum(1 for f in validation["findings"] if f["status"] == k) for k in _STATUS_LABEL}
        ok = c["mismatch"] == 0 and c["error"] == 0
        counts = (f'<a class="verdict {"ok" if ok else "bad"}" href="#validation">'
                  f'{"Validated" if ok else "Validation failed"}: {c["pass"]} pass · '
                  f'{c["resolved"]} resolved · {c["note"]} notes · {c["mismatch"]} mismatches · '
                  f'{c["error"]} errors</a>')
    osm_ts = validation.get("osm_timestamp", "") if validation else ""
    body = f"""
<div class="page">
  <header class="masthead">
    <p class="eyebrow">Riyadh public transport · research report</p>
    <h1>{_e(inputs.title)}</h1>
    <p class="title-ar" lang="ar" dir="rtl">مترو الرياض: الشبكة والمحطات وسهولة المشي في الحر</p>
    <p class="lede">The six Riyadh Metro lines mapped from OpenStreetMap, checked against RCRC's
      published figures, and analysed for service, interchanges and walkability in summer heat.</p>
    <p class="meta">Generated {today} · riyadh-transit-scope {__version__} · feed
      {_e(gtfs_path.name)}{f" · OSM {_e(osm_ts)}" if osm_ts else ""}</p>
    {counts}
    <p class="notice">Station positions, alignments and Arabic names are real, from OpenStreetMap.
      Station names and counts follow the official lists. RCRC publishes no timetable, so
      per-line headways and running times are modelled within the published 3–7 minute range
      and operating hours. Bus data in OSM covers 7 of 80 routes and is shown as a partial layer.</p>
  </header>
  <nav class="linenav" aria-label="Sections"><ol>
    <li><a href="#map">Map</a></li><li><a href="#validation">Validation</a></li>
    <li><a href="#network">Network</a></li><li><a href="#heat">Heat walk</a></li>
    <li><a href="#sources">Sources</a></li></ol></nav>
  {_map_section(payload)}
  {_validation_section(validation, payload, reference)}
  {_network_section(result, payload)}
  {_heat_section(inputs)}
  {_sources_section(reference if bundled else None, gtfs_path.name, inputs)}
  <footer class="colophon">riyadh-transit-scope {__version__} · generated {today} ·
    map data © OpenStreetMap contributors, ODbL 1.0</footer>
</div>
<script>{heat_js}</script>
<script>{map_js}</script>
"""
    head = f"<title>{_e(inputs.title)}</title>\n{FONTS}\n<style>{CSS}</style>"
    if fragment:
        return f"{head}\n{body}"
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        f"{head}\n</head>\n<body>{body}</body>\n</html>\n"
    )
