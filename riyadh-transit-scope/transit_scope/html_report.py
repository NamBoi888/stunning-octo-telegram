"""Compile every module's output into one self-contained HTML report.

The page bundles:

* network KPIs, route / station / transfer tables (GTFS engine);
* the rendered SVG map in both themes, swapped by the viewer's colour scheme;
* the multi-city benchmark table with in-cell bars and key findings;
* an interactive heat-walk simulator — the EWCS model from
  :mod:`transit_scope.microclimate.model` ported to JavaScript — plus the
  temperature × shade sensitivity grid;
* methodology notes.

Everything is inline except Google Fonts (with system fallbacks), so the file
opens straight from disk.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from html import escape
from pathlib import Path

from transit_scope import __version__
from transit_scope.benchmark import METRICS, run_benchmark
from transit_scope.benchmark.engine import rank
from transit_scope.benchmark.report import _findings
from transit_scope.gis_svg import RenderOptions, layers_from_analysis, load_geojson, render_svg
from transit_scope.gtfs import AnalysisConfig, AnalysisResult, analyze_feed, load_feed
from transit_scope.microclimate import CorridorInput, simulate_corridor
from transit_scope.microclimate.model import SHADE_PROPERTIES, ModelParameters
from transit_scope.paths import sample_districts_path, sample_gtfs_path

__all__ = ["ReportInputs", "build_html_report"]


@dataclass
class ReportInputs:
    gtfs: Path | None = None
    geojson: Path | None = None
    cities: tuple[str, ...] = ("riyadh", "melbourne", "la")
    benchmark_data: Path | None = None
    temp_c: float = 44.0
    shade_pct: float = 35.0
    distance_m: float = 800.0
    title: str = "Riyadh Transit Scope"


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #


def _e(value: object) -> str:
    return escape(str(value), quote=True)


def _num(value: float | None, digits: int = 1, suffix: str = "") -> str:
    return "—" if value is None else f"{value:,.{digits}f}{suffix}"


def _text_on(hex_color: str) -> str:
    """Black or white text for a line roundel of the given colour."""
    h = hex_color.lstrip("#")
    try:
        r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return "#FFFFFF"
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return "#111111" if lum > 0.6 else "#FFFFFF"


def _roundel(name: str, color: str) -> str:
    return (
        f'<span class="roundel" style="background:{_e(color)};color:{_text_on(color)}">'
        f"{_e(name)}</span>"
    )


def _prefix_svg_ids(svg: str, prefix: str) -> str:
    """Namespace ids so two inline SVGs can share one document."""
    svg = svg.split("?>", 1)[-1].strip()
    svg = re.sub(r'id="([^"]+)"', rf'id="{prefix}-\1"', svg)
    return re.sub(r"url\(#([^)]+)\)", rf"url(#{prefix}-\1)", svg)


def _md_bold(text: str) -> str:
    """Escape text and turn Markdown ``**bold**`` into ``<strong>``."""
    return re.sub(r"[*][*](.+?)[*][*]", r"<strong>\1</strong>", _e(text))


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


# --------------------------------------------------------------------------- #
# Sections
# --------------------------------------------------------------------------- #


def _network_section(result: AnalysisResult) -> str:
    rep = result.report
    s = rep.summary
    c_by_r = {c.radius_m: c for c in rep.catchments}
    largest = max(c_by_r) if c_by_r else None
    facts = [
        ("Route length", f"{s.route_km_total:,.1f}", "km one-way"),
        ("Trips", f"{s.trips_per_day:,}", "per service day"),
        ("Station nodes", f"{s.station_nodes}", f"{s.transfer_nodes} interchanges"),
        ("Peak headway", _num(s.mean_peak_headway_min), "min, mean of routes"),
        ("Off-peak headway", _num(s.mean_offpeak_headway_min), "min, mean of routes"),
    ]
    if largest is not None:
        c = c_by_r[largest]
        facts.append((f"{largest:,.0f} m catchment", f"{c.area_km2:,.1f}", "km² walkable"))
    fact_html = "".join(
        f'<div class="fact"><dt>{_e(k)}</dt><dd><span class="big">{_e(v)}</span>'
        f'<span class="unit">{_e(u)}</span></dd></div>'
        for k, v, u in facts
    )

    routes = _table(
        [("Line", ""), ("Name", ""), ("Mode", ""), ("Length km", "n"), ("Stops", "n"),
         ("Trips/day", "n"), ("Peak hw", "n"), ("Off-peak hw", "n"), ("Span", "c"),
         ("Speed km/h", "n")],
        [[_roundel(r.name, r.color), _e(r.long_name.split(":")[0] or r.name), _e(r.mode),
          f"{r.length_km:.1f}", str(r.stops), f"{r.trips_per_day:,}",
          _num(r.peak_headway_min, 1, "′"), _num(r.offpeak_headway_min, 1, "′"),
          f"{_e(r.first_departure)}–{_e(r.last_departure)}", _num(r.avg_speed_kmh)]
         for r in rep.routes],
    )
    color_of = {r.name: r.color for r in rep.routes}

    def lines(names: list[str]) -> str:
        return '<span class="roundels">' + "".join(
            _roundel(n, color_of.get(n, "#888888")) for n in names
        ) + "</span>"

    stations = _table(
        [("Station", ""), ("Lines", ""), ("Departures/day", "n"), ("Peak deps", "n"),
         ("Combined peak hw", "n")],
        [[_e(st.name), lines(st.routes), f"{st.departures_per_day:,}",
          f"{st.peak_departures:,}", _num(st.peak_headway_min, 2, "′")]
         for st in rep.stations[:10]],
    )
    by_node = {st.node_id: st for st in rep.stations}
    transfers = _table(
        [("Interchange", ""), ("Lines", ""), ("Pairs", "n"), ("Exp. wait", "n"),
         ("Spread m", "n"), ("TFI", "n"), ("Hub score", "n")],
        [[_e(t.name), lines(by_node[t.node_id].routes if t.node_id in by_node else []),
          str(t.transfer_pairs), f"{t.expected_transfer_wait_min:.1f}′",
          f"{t.intra_node_spread_m:.0f}", f"{t.transfer_friction_index:.1f}",
          f'<span class="meter" style="--v:{t.hub_score:.0f}%" '
          f'title="Hub score {t.hub_score:.0f} / 100"></span>{t.hub_score:.0f}']
         for t in rep.transfer_nodes[:10]],
    )
    warnings = "".join(f"<li>{_e(w)}</li>" for w in rep.warnings)
    return f"""
<section id="network" class="section">
  <header class="section-head">
    <p class="eyebrow">GTFS network</p>
    <h2>{_e(s.agency)}</h2>
    <p class="lede">{_e(s.service_day.capitalize())} · {s.routes} routes
      ({_e(", ".join(f"{n} {m}" for m, n in s.routes_by_mode.items()))}) ·
      lengths and buffers in {_e(s.metric_crs)}.</p>
  </header>
  <dl class="facts">{fact_html}</dl>
  <h3>Routes</h3>
  {routes}
  <h3>Busiest stations</h3>
  {stations}
  <h3>Transfer nodes</h3>
  {transfers}
  <p class="note">TFI = transfer pairs × expected wait × walk penalty × mode penalty.
    Higher means a heavier transfer burden. Hub score ranks importance, 0–100.</p>
  {f'<ul class="warnings">{warnings}</ul>' if warnings else ""}
</section>"""


def _map_section(light_svg: str, dark_svg: str, n_districts: int) -> str:
    return f"""
<section id="map" class="section">
  <header class="section-head">
    <p class="eyebrow">Vector map</p>
    <h2>Network over district boundaries</h2>
    <p class="lede">Rapid-transit lines with 500 m and 1,000 m walk catchments, bus routes dashed,
      {n_districts} districts. The map follows your light or dark theme; the same file is
      produced by <code>transit export-svg</code>.</p>
  </header>
  <figure class="map">
    <div class="map-light">{_prefix_svg_ids(light_svg, "lt")}</div>
    <div class="map-dark">{_prefix_svg_ids(dark_svg, "dk")}</div>
  </figure>
</section>"""


def _benchmark_section(dataset, profiles, metrics) -> str:
    head = "".join(f'<th class="n">{_e(m.name)}<span class="yr">{m.data_year}</span></th>'
                   for m in metrics)
    rows = []
    for spec in METRICS:
        values = [getattr(m, spec.attr) for m in metrics]
        top = max(values) or 1
        ranks = rank(metrics, spec) if len(metrics) > 1 else {}
        cells = []
        for m, v in zip(metrics, values, strict=True):
            best = ranks.get(m.key) == 1
            cells.append(
                f'<td class="n{" best" if best else ""}" '
                f'title="{_e(m.name)}: {_e(spec.format(v))} {_e(spec.unit)}">'
                f'<span class="val">{_e(spec.format(v))}{" ★" if best else ""}</span>'
                f'<span class="bar" style="--w:{100 * v / top:.1f}%"></span></td>'
            )
        direction = (
            "context" if spec.higher_is_better is None
            else "higher is better" if spec.higher_is_better else "lower is better"
        )
        rows.append(
            f'<tr><th scope="row">{_e(spec.label)}<span class="dir">{_e(spec.unit)} · '
            f"{direction}</span></th>{''.join(cells)}</tr>"
        )
    findings = "".join(f"<li>{_md_bold(f[2:])}</li>" for f in _findings(metrics))
    sources = "".join(
        f"<li><strong>{_e(p.name)} ({p.data_year})</strong> — "
        + _e("; ".join(p.sources))
        + (f". {_e(p.notes)}" if p.notes else "")
        + "</li>"
        for p in profiles
    )
    return f"""
<section id="benchmark" class="section">
  <header class="section-head">
    <p class="eyebrow">Multi-city benchmark</p>
    <h2>{_e(" · ".join(m.name for m in metrics))}</h2>
    <p class="lede">Bars are scaled to the largest value in each row; ★ marks the best city
      for that metric.</p>
  </header>
  <p class="notice">{_e(dataset.disclaimer)}</p>
  <div class="table-wrap"><table class="bench"><thead><tr><th>Metric</th>{head}</tr></thead>
    <tbody>{"".join(rows)}</tbody></table></div>
  <div class="two-col">
    <div><h3>Key findings</h3><ul class="findings">{findings}</ul></div>
    <div><h3>Sources</h3><ul class="sources">{sources}</ul></div>
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


def _method_section(inputs: ReportInputs, gtfs_name: str) -> str:
    cmd = (
        f"transit report-html --temp {inputs.temp_c:g} --shade {inputs.shade_pct:g} "
        f"--distance {inputs.distance_m:g}"
    )
    return f"""
<section id="method" class="section">
  <header class="section-head">
    <p class="eyebrow">Method</p>
    <h2>How the numbers are made</h2>
  </header>
  <div class="method">
    <div>
      <h3>Network</h3>
      <p>Headway is the mean gap between consecutive departures per route and direction, split
        into peak (07:00–09:00, 16:00–19:00) and off-peak by the earlier departure. Stops within
        150 m, or sharing a parent station, form one interchange node. Catchments are dissolved
        buffers in UTM 38N.</p>
    </div>
    <div>
      <h3>Heat walk</h3>
      <p>Feels-like temperature = air + 0.30 × radiant gain (26 °C per kW/m² in sun, cut by
        shade) + humidity − wind. Walking pace drops 0.8% per °C above 32. Above 40 °C each
        unshaded metre is weighted by 1 + (T − 40)(0.12·G/1000 + 0.04·km unshaded).
        EWCS = 100 × nominal ÷ perceived walk time. This is a screening model for comparing
        designs, not a substitute for UTCI or PET simulation.</p>
    </div>
    <div>
      <h3>Rebuild this page</h3>
      <p>Source feed: <code>{_e(gtfs_name)}</code>. Regenerate with:</p>
      <pre><code>{_e(cmd)}</code></pre>
    </div>
  </div>
</section>"""


# --------------------------------------------------------------------------- #
# Static assets
# --------------------------------------------------------------------------- #

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    "family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600"
    '&family=IBM+Plex+Mono:wght@400;500&display=swap">'
)

CSS = r"""
/* Layout: one reading column; the sticky nav is drawn as a metro line whose stops are the sections */
:root {
  --bg: #F3F5F6; --surface: #FFFFFF; --ink: #14202B; --muted: #5B6875; --rule: #D8DEE3;
  --accent: #0068BD; --heat: #C2410C; --on-heat: #FFFFFF;
  --good: #1D7A4C; --warn: #A86A0C; --crit: #B42318;
  --display: "Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif;
  --body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0B1016; --surface: #111922; --ink: #E4EAF0; --muted: #93A1AF; --rule: #243140;
  --accent: #5AA9F2; --heat: #F28C4E; --on-heat: #1B0D04;
  --good: #4FC08A; --warn: #E3AE4F; --crit: #F07468; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0B1016; --surface: #111922; --ink: #E4EAF0; --muted: #93A1AF; --rule: #243140;
  --accent: #5AA9F2; --heat: #F28C4E; --on-heat: #1B0D04;
  --good: #4FC08A; --warn: #E3AE4F; --crit: #F07468; color-scheme: dark; }

* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--body); margin: 0; }
.page { max-width: 1120px; margin: 0 auto; padding: 0 20px 64px; }
h1, h2, h3 { font-family: var(--display); font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(2.4rem, 6vw, 3.6rem); line-height: 1; letter-spacing: -0.01em; }
h2 { font-size: 2rem; line-height: 1.1; }
h3 { font-size: 1.3rem; margin: 28px 0 10px; }
p { margin: 0; }
code, pre { font-family: var(--mono); font-size: 0.86em; }
pre { background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px;
  overflow-x: auto; margin-top: 8px; }
.muted { color: var(--muted); }
.eyebrow { font: 600 0.74rem/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--accent); }
.lede { color: var(--muted); max-width: 68ch; }
.note { color: var(--muted); font-size: 0.86rem; margin-top: 8px; max-width: 70ch; }

/* Masthead */
.masthead { padding-block: 40px 20px; display: grid; gap: 12px; }
.masthead .meta { font: 0.8rem var(--mono); color: var(--muted); }
.notice { border-left: 3px solid var(--warn); padding: 8px 12px; background: var(--surface);
  color: var(--muted); font-size: 0.88rem; max-width: 80ch; }

/* Metro-line nav */
.linenav { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5;
  background: var(--bg); border-bottom: 1px solid var(--rule); margin: 0 -20px; padding: 0 20px; }
.linenav ol { list-style: none; margin: 0; padding: 14px 0 10px; display: flex; gap: 0;
  overflow-x: auto; position: relative; }
.linenav li { flex: 1 0 auto; position: relative; min-width: 96px; }
.linenav li::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 4px;
  background: var(--accent); }
.linenav li:first-child::before { left: 7px; }
.linenav li:last-child::before { right: calc(100% - 11px); }
.linenav a { position: relative; display: grid; gap: 6px; justify-items: start;
  color: var(--ink); text-decoration: none; font: 600 0.95rem var(--display);
  letter-spacing: 0.04em; text-transform: uppercase; padding-right: 12px; }
.linenav a::before { content: ""; width: 18px; height: 18px; border-radius: 50%;
  background: var(--surface); border: 4px solid var(--accent); box-sizing: border-box; }
.linenav a:hover::before, .linenav a:focus-visible::before { background: var(--accent); }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; }

/* Sections */
.section { padding-block: 44px 8px; border-bottom: 1px solid var(--rule); scroll-margin-top: 70px; }
.section-head { display: grid; gap: 8px; margin-bottom: 20px; }
.two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0 32px; }
.two-col > div { min-width: 0; }

/* Facts strip */
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin: 0; border-top: 4px solid var(--accent); background: var(--surface); }
.fact { padding: 14px 16px; border-right: 1px solid var(--rule); display: grid; gap: 4px; }
.fact dt { font: 600 0.72rem var(--mono); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted); }
.fact dd { margin: 0; display: grid; }
.fact .big { font: 600 1.9rem/1 var(--display); font-variant-numeric: tabular-nums; }
.fact .unit { font-size: 0.8rem; color: var(--muted); }

/* Tables */
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--rule);
  border-radius: 6px; }
table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--rule);
  white-space: nowrap; vertical-align: middle; }
thead th { font: 600 0.7rem var(--mono); letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--muted); background: var(--bg); }
tbody tr:last-child td, tbody tr:last-child th { border-bottom: 0; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
td.c { text-align: center; font-variant-numeric: tabular-nums; }
.roundel { display: inline-grid; place-items: center; min-width: 24px; height: 24px;
  padding: 0 6px; border-radius: 12px; font: 700 0.82rem var(--display); }
.roundels { display: inline-flex; gap: 4px; }
.meter { display: inline-block; width: 44px; height: 6px; border-radius: 3px; margin-right: 8px;
  vertical-align: middle; background: linear-gradient(90deg, var(--accent) var(--v), var(--rule) var(--v)); }
.warnings { color: var(--warn); }

/* Map */
.map { margin: 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--rule); }
.map svg { display: block; width: 100%; height: auto; }
.map-dark { display: none; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .map-dark { display: block; }
  :root:not([data-theme="light"]) .map-light { display: none; } }
:root[data-theme="dark"] .map-dark { display: block; }
:root[data-theme="dark"] .map-light { display: none; }

/* Benchmark */
.bench tbody th { font-weight: 500; white-space: normal; min-width: 180px; }
.bench .dir { display: block; font: 0.7rem var(--mono); color: var(--muted); }
.bench .yr { display: block; font-weight: 400; letter-spacing: 0; }
.bench td { min-width: 120px; }
.bench .val { display: block; }
.bench .bar { display: block; height: 6px; margin-top: 4px; margin-left: auto; width: var(--w);
  border-radius: 0 3px 3px 0; background: var(--muted); opacity: 0.45; }
.bench td.best .val { font-weight: 600; color: var(--ink); }
.bench td.best .bar { background: var(--accent); opacity: 1; }
.findings, .sources { padding-left: 18px; display: grid; gap: 6px; font-size: 0.9rem; }
.sources { color: var(--muted); }

/* Simulator */
.sim { display: grid; grid-template-columns: minmax(0, 330px) minmax(0, 1fr); gap: 24px; }
@media (max-width: 760px) { .sim { grid-template-columns: 1fr; } }
.controls { display: grid; gap: 6px; align-content: start; background: var(--surface);
  border: 1px solid var(--rule); border-radius: 6px; padding: 16px; }
.controls label { display: flex; justify-content: space-between; gap: 8px; font-size: 0.86rem;
  font-weight: 500; }
.controls output { font: 500 0.86rem var(--mono); color: var(--accent); }
.controls input[type=range] { width: 100%; accent-color: var(--accent); margin-bottom: 8px; }
.controls .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.controls .row label { display: block; margin-bottom: 4px; font-size: 0.78rem; }
.controls select, .controls input[type=number] { width: 100%; font: inherit; font-size: 0.86rem;
  padding: 5px 6px; border: 1px solid var(--rule); border-radius: 4px; background: var(--bg);
  color: var(--ink); }
.controls button { margin-top: 10px; font: 500 0.84rem var(--body); padding: 7px 10px;
  border: 1px solid var(--accent); color: var(--accent); background: transparent;
  border-radius: 4px; cursor: pointer; }
.controls button:hover { background: var(--accent); color: var(--surface); }
.result { display: grid; gap: 16px; min-width: 0; align-content: start; }
.score { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.score-num { font: 700 4.2rem/0.9 var(--display); font-variant-numeric: tabular-nums; }
.score-meta { display: grid; gap: 6px; font-size: 0.86rem; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
  border-radius: 999px; border: 1px solid currentColor; font-weight: 600; width: max-content; }
.pill .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.pill.good { color: var(--good); } .pill.warn { color: var(--warn); } .pill.crit { color: var(--crit); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0;
  margin: 0; border-top: 1px solid var(--rule); }
.stats div { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--rule); }
.stats dt { font-size: 0.76rem; color: var(--muted); }
.stats dd { margin: 0; font: 600 1.15rem var(--display); font-variant-numeric: tabular-nums; }

/* Heat grid */
table.heat td { text-align: center; font-variant-numeric: tabular-nums; min-width: 56px;
  background: color-mix(in oklab, var(--heat) var(--p), var(--surface)); color: var(--ink);
  border: 2px solid var(--surface); }
table.heat td.deep { color: var(--on-heat); }
table.heat td.here { outline: 2px solid var(--ink); outline-offset: -3px; }
table.heat th { text-align: center; }
table.heat tbody th { text-align: right; }

.method { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
.method p { font-size: 0.9rem; color: var(--muted); }
.method h3 { margin-top: 0; }
footer.colophon { padding-block: 24px; font: 0.78rem var(--mono); color: var(--muted); }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
"""

JS = r"""
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


def build_html_report(inputs: ReportInputs | None = None, fragment: bool = False) -> str:
    """Run every module and return the complete report as one HTML string.

    ``fragment=True`` omits the ``<!doctype>/<html>/<head>/<body>`` wrapper
    (for hosts that supply their own document skeleton).
    """
    inputs = inputs or ReportInputs()
    gtfs_path = inputs.gtfs or sample_gtfs_path()
    geo_path = inputs.geojson or sample_districts_path()

    result = analyze_feed(load_feed(gtfs_path), AnalysisConfig())
    geo = load_geojson(geo_path)
    layers = layers_from_analysis(result, geo)
    svgs = {
        theme: render_svg(layers, RenderOptions(
            theme=theme, catchment_radii_m=[500.0, 1000.0],
            source_note=f"GTFS: {gtfs_path.name}"))
        for theme in ("light", "dark")
    }
    dataset, profiles, metrics = run_benchmark(list(inputs.cities), inputs.benchmark_data)
    # Validate the default scenario through the Python model (raises on bad input).
    simulate_corridor(CorridorInput(
        distance_m=inputs.distance_m, shade_pct=inputs.shade_pct, temp_c=inputs.temp_c))

    defaults = {
        "in-temp": inputs.temp_c, "in-shade": inputs.shade_pct, "in-dist": inputs.distance_m,
        "in-solar": 950, "in-type": "mixed", "in-rh": 15, "in-wind": 1.5,
    }
    js = (
        JS.replace("__PARAMS__", ModelParameters().model_dump_json())
        .replace("__SHADE__", json.dumps({k.value: list(v) for k, v in SHADE_PROPERTIES.items()}))
        .replace("__DEFAULTS__", json.dumps(defaults))
    )
    today = date.today().isoformat()
    body = f"""
<div class="page">
  <header class="masthead">
    <p class="eyebrow">Urban transit research report</p>
    <h1>{_e(inputs.title)}</h1>
    <p class="lede">GTFS network analysis, a Riyadh–Melbourne–Los Angeles benchmark, heat-stress
      walkability and a vector network map, compiled from one run of
      <code>riyadh-transit-scope</code>.</p>
    <p class="meta">Generated {today} · riyadh-transit-scope {__version__} ·
      feed {_e(gtfs_path.name)} · districts {_e(geo_path.name)}</p>
    <p class="notice">The bundled Riyadh GTFS feed and district polygons are mock data: stations
      approximate the Riyadh Metro and timetables are synthetic. Benchmark figures are rounded,
      indicative values. Check primary sources before citing.</p>
  </header>
  <nav class="linenav" aria-label="Sections"><ol>
    <li><a href="#network">Network</a></li><li><a href="#map">Map</a></li>
    <li><a href="#benchmark">Benchmark</a></li><li><a href="#heat">Heat walk</a></li>
    <li><a href="#method">Method</a></li></ol></nav>
  {_network_section(result)}
  {_map_section(svgs["light"], svgs["dark"], len(geo.polygons))}
  {_benchmark_section(dataset, profiles, metrics)}
  {_heat_section(inputs)}
  {_method_section(inputs, gtfs_path.name)}
  <footer class="colophon">riyadh-transit-scope {__version__} · generated {today}</footer>
</div>
<script>{js}</script>
"""
    head = f"<title>{_e(inputs.title)}</title>\n{FONTS}\n<style>{CSS}</style>"
    if fragment:
        return f"{head}\n{body}"
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        f"{head}\n</head>\n<body>{body}</body>\n</html>\n"
    )
