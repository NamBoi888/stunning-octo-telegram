"""``transit`` command-line interface.

Commands
--------
analyze            Parse a GTFS feed, print network KPIs, export a JSON report.
benchmark          Compare Riyadh / Melbourne / Los Angeles (or custom) networks.
simulate-corridor  Heat-penalised walkability (EWCS) for a station access corridor.
export-svg         Render a styled standalone SVG map from GeoJSON + GTFS.
report-html        Compile everything into one self-contained HTML report.
sample-data        Copy the bundled mock data into a working directory.

Every command runs out-of-the-box against bundled Riyadh sample data.
"""

from __future__ import annotations

import functools
import json
import shutil
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from transit_scope import __version__
from transit_scope.errors import TransitScopeError
from transit_scope.paths import (
    benchmark_cities_path,
    sample_districts_path,
    sample_gtfs_path,
)

app = typer.Typer(
    name="transit",
    help="[bold]riyadh-transit-scope[/bold] — GTFS analytics, multi-city benchmarking, "
    "heat-stress walkability and SVG mapping for urban transit research.",
    no_args_is_help=True,
    rich_markup_mode="rich",
    add_completion=False,
    pretty_exceptions_show_locals=False,
)
console = Console()
err_console = Console(stderr=True)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _handle_errors(func):
    """Render expected failures as a red panel and exit with status 1."""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except TransitScopeError as exc:
            _fail(str(exc))
        except ValidationError as exc:
            lines = [
                f"• {'.'.join(str(p) for p in e['loc']) or 'input'}: {e['msg']}"
                for e in exc.errors()
            ]
            _fail("Invalid parameters:\n" + "\n".join(lines))
        except ValueError as exc:
            _fail(str(exc))
        except OSError as exc:
            _fail(f"File error: {exc}")

    return wrapper


def _fail(message: str) -> None:
    err_console.print(Panel(Text(message), title="[bold red]Error", border_style="red"))
    raise typer.Exit(code=1)


def _float_list(text: str, name: str) -> list[float]:
    try:
        values = [float(v) for v in text.split(",") if v.strip()]
    except ValueError as exc:
        raise ValueError(f"--{name} must be a comma-separated list of numbers") from exc
    if not values:
        raise ValueError(f"--{name} must not be empty")
    return values


def _fmt(value: float | None, suffix: str = "", digits: int = 1) -> str:
    return "—" if value is None else f"{value:,.{digits}f}{suffix}"


def _write(path: Path, text: str) -> Path:
    path = path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _version_callback(value: bool) -> None:
    if value:
        console.print(f"riyadh-transit-scope {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option("--version", callback=_version_callback, is_eager=True,
                     help="Show version and exit."),
    ] = False,
) -> None:
    """Urban transit research toolkit (Riyadh · Melbourne · Los Angeles)."""


# --------------------------------------------------------------------------- #
# analyze
# --------------------------------------------------------------------------- #


def _analysis_tables(report, top: int) -> list:
    s = report.summary
    overview = Table.grid(padding=(0, 2))
    overview.add_column(style="bold cyan")
    overview.add_column()
    rows = [
        ("Agency", s.agency),
        ("Service day", s.service_day),
        ("Metric CRS", s.metric_crs),
        ("Routes", ", ".join(f"{n} {m}" for m, n in s.routes_by_mode.items())),
        ("Stops / station nodes", f"{s.stops:,} / {s.station_nodes:,}"),
        ("Trips per day", f"{s.trips_per_day:,}"),
        ("Route-km (one-way)", f"{s.route_km_total:,.1f} km  ("
         + ", ".join(f"{m} {k:,.1f}" for m, k in s.route_km_by_mode.items()) + ")"),
        ("Vehicle-km per day", f"{s.vehicle_km_per_day:,.0f} km"),
        ("Mean headway", f"peak {_fmt(s.mean_peak_headway_min, ' min')} · "
         f"off-peak {_fmt(s.mean_offpeak_headway_min, ' min')}"),
        ("Transfer nodes", f"{s.transfer_nodes}"),
    ]
    for c in report.catchments:
        rows.append((f"{c.radius_m:,.0f} m catchment",
                     f"{c.area_km2:,.1f} km²  (rapid transit {c.rapid_transit_area_km2:,.1f} km²)"))
    for k, v in rows:
        overview.add_row(k, v)

    routes = Table(title="Routes", header_style="bold magenta", title_justify="left")
    for col, just in [("Route", "left"), ("Mode", "left"), ("Length km", "right"),
                      ("Stops", "right"), ("Trips/day", "right"), ("Peak hw", "right"),
                      ("Off-peak hw", "right"), ("Peak tph/dir", "right"),
                      ("Span", "center"), ("Speed km/h", "right")]:
        routes.add_column(col, justify=just)
    for r in report.routes:
        routes.add_row(
            f"[{r.color}]■[/] {r.name}", r.mode, f"{r.length_km:.1f}", str(r.stops),
            f"{r.trips_per_day:,}", _fmt(r.peak_headway_min, "′"),
            _fmt(r.offpeak_headway_min, "′"), f"{r.peak_trips_per_hour:.1f}",
            f"{r.first_departure}–{r.last_departure}", _fmt(r.avg_speed_kmh),
        )

    stations = Table(title=f"Busiest stations (top {top})", header_style="bold magenta",
                     title_justify="left")
    for col, just in [("Station", "left"), ("Modes", "left"), ("Routes", "left"),
                      ("Departures/day", "right"), ("Peak deps", "right"),
                      ("Combined peak hw", "right")]:
        stations.add_column(col, justify=just)
    for st in report.stations[:top]:
        stations.add_row(st.name, ", ".join(st.modes), ", ".join(st.routes),
                         f"{st.departures_per_day:,}", f"{st.peak_departures:,}",
                         _fmt(st.peak_headway_min, "′", 2))

    transfers = Table(title=f"Transfer nodes (top {top} by hub score)",
                      header_style="bold magenta", title_justify="left",
                      caption="TFI = transfer pairs × expected wait × walk penalty × mode penalty")
    for col, just in [("Node", "left"), ("Routes", "right"), ("Modes", "left"),
                      ("Exp. wait", "right"), ("Spread m", "right"), ("TFI", "right"),
                      ("Hub score", "right")]:
        transfers.add_column(col, justify=just)
    for t in report.transfer_nodes[:top]:
        transfers.add_row(t.name, str(t.routes_served), ", ".join(t.modes),
                          f"{t.expected_transfer_wait_min:.1f}′", f"{t.intra_node_spread_m:.0f}",
                          f"{t.transfer_friction_index:.1f}", f"{t.hub_score:.0f}")

    return [Panel(overview, title="[bold]Network summary", border_style="cyan"),
            routes, stations, transfers]


@app.command()
@_handle_errors
def analyze(
    gtfs_path: Annotated[
        Path | None,
        typer.Argument(help="GTFS .zip or directory. Defaults to the bundled Riyadh sample."),
    ] = None,
    out: Annotated[Path, typer.Option("--out", "-o", help="JSON report path.")] = Path(
        "transit_report.json"
    ),
    peaks: Annotated[
        str, typer.Option(help="Comma-separated peak windows (HH:MM-HH:MM).")
    ] = "07:00-09:00,16:00-19:00",
    radii: Annotated[str, typer.Option(help="Catchment radii in metres.")] = "500,1000",
    crs: Annotated[
        str | None, typer.Option(help="Metric CRS (default: auto UTM, EPSG:32638 for Riyadh).")
    ] = None,
    date: Annotated[
        str | None, typer.Option(help="Service date YYYYMMDD (default: busiest weekday).")
    ] = None,
    cluster_radius: Annotated[
        float, typer.Option(help="Radius (m) for grouping stops into interchange nodes.")
    ] = 150.0,
    top: Annotated[int, typer.Option(help="Rows shown in station/transfer tables.")] = 10,
    catchments_geojson: Annotated[
        Path | None, typer.Option(help="Also export catchment polygons as GeoJSON.")
    ] = None,
) -> None:
    """Parse a GTFS feed, print network KPIs and export a structured JSON report."""
    from transit_scope.gtfs import AnalysisConfig, TimeWindow, analyze_feed, load_feed

    windows = [TimeWindow.parse(w.strip()) for w in peaks.split(",") if w.strip()]
    config = AnalysisConfig(
        peak_windows=windows,
        catchment_radii_m=_float_list(radii, "radii"),
        metric_crs=crs,
        service_date=date,
        transfer_cluster_radius_m=cluster_radius,
        top_n=top,
    )
    path = gtfs_path or sample_gtfs_path()
    if gtfs_path is None:
        console.print(f"[dim]No feed given — using bundled sample: {path}[/dim]")

    with console.status("[cyan]Loading and validating GTFS feed…"):
        feed = load_feed(path)
    with console.status("[cyan]Computing network KPIs…"):
        result = analyze_feed(feed, config)
    report = result.report

    for renderable in _analysis_tables(report, top):
        console.print(renderable)
    for warning in report.warnings:
        console.print(f"[yellow]⚠ {warning}[/yellow]")

    written = _write(out, report.model_dump_json(indent=2))
    console.print(f"[green]✓[/green] JSON report written to [bold]{written}[/bold]")
    if catchments_geojson:
        geo = _write(catchments_geojson, result.catchments_geojson())
        console.print(f"[green]✓[/green] Catchment polygons written to [bold]{geo}[/bold]")


# --------------------------------------------------------------------------- #
# benchmark
# --------------------------------------------------------------------------- #


@app.command()
@_handle_errors
def benchmark(
    cities: Annotated[
        str, typer.Option(help="Comma-separated city keys or aliases.")
    ] = "riyadh,melbourne,la",
    out: Annotated[Path, typer.Option("--out", "-o", help="Markdown report path.")] = Path(
        "benchmark_report.md"
    ),
    data: Annotated[
        Path | None,
        typer.Option(help="Extra/override city profiles JSON (same schema as bundled data)."),
    ] = None,
    json_out: Annotated[
        Path | None, typer.Option("--json", help="Also export derived metrics as JSON.")
    ] = None,
) -> None:
    """Compare transit networks side by side and export a Markdown report."""
    from transit_scope.benchmark import markdown_report, rich_table, run_benchmark

    dataset, profiles, metrics = run_benchmark(cities.split(","), data)
    console.print(rich_table(metrics))
    if dataset.disclaimer:
        console.print(Panel(dataset.disclaimer, title="Data note", border_style="yellow"))

    written = _write(out, markdown_report(dataset, profiles, metrics))
    console.print(f"[green]✓[/green] Markdown report written to [bold]{written}[/bold]")
    if json_out:
        payload = json.dumps([m.model_dump() for m in metrics], indent=2)
        written_json = _write(json_out, payload)
        console.print(f"[green]✓[/green] Metrics JSON written to [bold]{written_json}[/bold]")


# --------------------------------------------------------------------------- #
# simulate-corridor
# --------------------------------------------------------------------------- #


def _ewcs_style(score: float) -> str:
    return "green" if score >= 80 else "yellow" if score >= 60 else "red"


@app.command("simulate-corridor")
@_handle_errors
def simulate_corridor_cmd(
    temp: Annotated[float, typer.Option(help="Ambient air temperature (°C).")] = 44.0,
    shade: Annotated[float, typer.Option(help="Shaded share of the corridor (%).")] = 35.0,
    distance: Annotated[float, typer.Option(help="Corridor length to the station (m).")] = 800.0,
    solar: Annotated[
        float, typer.Option(help="Global solar irradiance (W/m²); 1000 ≈ index 1.0.")
    ] = 950.0,
    humidity: Annotated[float, typer.Option(help="Relative humidity (%).")] = 15.0,
    wind: Annotated[float, typer.Option(help="Wind speed (m/s).")] = 1.5,
    walk_speed: Annotated[float, typer.Option(help="Nominal walking speed (m/s).")] = 1.34,
    shade_type: Annotated[
        str, typer.Option(help="Shade type: mixed, trees, arcade or sail.")
    ] = "mixed",
    target: Annotated[
        float, typer.Option(help="Target EWCS for the shade-requirement solver.")
    ] = 70.0,
    sensitivity: Annotated[
        bool, typer.Option(help="Show the temperature × shade EWCS sensitivity grid.")
    ] = True,
    json_out: Annotated[
        Path | None, typer.Option("--json", help="Export full results as JSON.")
    ] = None,
) -> None:
    """Heat-penalised first/last-mile walkability: EWCS and thermal comfort loss."""
    from transit_scope.microclimate import (
        CorridorInput,
        ShadeType,
        sensitivity_grid,
        simulate_corridor,
    )

    try:
        stype = ShadeType(shade_type.lower())
    except ValueError as exc:
        raise ValueError(
            f"Unknown shade type {shade_type!r}; choose from "
            + ", ".join(s.value for s in ShadeType)
        ) from exc
    inp = CorridorInput(
        distance_m=distance, shade_pct=shade, temp_c=temp, solar_wm2=solar,
        humidity_pct=humidity, wind_ms=wind, walk_speed_ms=walk_speed, shade_type=stype,
    )
    res = simulate_corridor(inp, target_ewcs=target)

    header = (
        f"{inp.distance_m:,.0f} m corridor · {inp.shade_pct:.0f}% shaded ({stype.value}) · "
        f"{inp.temp_c:.1f} °C · {inp.solar_wm2:.0f} W/m² · RH {inp.humidity_pct:.0f}% · "
        f"wind {inp.wind_ms:.1f} m/s"
    )
    style = _ewcs_style(res.ewcs)
    score = Text.assemble(
        ("EWCS ", "bold"), (f"{res.ewcs:.1f}", f"bold {style}"), (" / 100   grade ", "bold"),
        (res.rating, f"bold {style}"),
        ("   (heat penalty active)" if res.penalty_active else "   (below 40 °C: no penalty)",
         "dim"),
    )
    console.print(Panel(score, title="[bold]Corridor thermal walkability", subtitle=header,
                        border_style=style))

    seg = Table(title="Segments", header_style="bold magenta", title_justify="left")
    for col in ("Segment", "Length m", "Tmrt °C", "Thermal index °C", "Heat stress",
                "Speed ×", "Penalty ×", "Walk min", "Perceived min"):
        seg.add_column(col, justify="left" if col in ("Segment", "Heat stress") else "right")
    for s in res.segments:
        seg.add_row(s.kind, f"{s.distance_m:,.0f}", f"{s.mrt_c:.1f}", f"{s.thermal_index_c:.1f}",
                    s.stress_category, f"{s.speed_factor:.2f}", f"{s.distance_penalty:.2f}",
                    f"{s.walk_time_min:.1f}", f"{s.perceived_time_min:.1f}")
    console.print(seg)

    loss = Table(title="Thermal comfort loss", header_style="bold magenta", title_justify="left",
                 show_header=False)
    loss.add_column(style="bold cyan")
    loss.add_column(justify="right")
    shade_msg = (
        f"{res.shade_needed_for_target_pct:.0f}%"
        if res.shade_needed_for_target_pct is not None
        else "not reachable by shade alone"
    )
    for k, v in [
        ("Nominal walk time", f"{res.nominal_walk_time_min:.1f} min"),
        ("Heat-adjusted walk time (slower pace)", f"{res.heat_adjusted_walk_time_min:.1f} min"),
        ("Perceived walk time", f"{res.perceived_walk_time_min:.1f} min"),
        ("Extra perceived time", f"+{res.extra_time_min:.1f} min"),
        ("Perceived distance", f"{res.perceived_distance_m:,.0f} m"),
        ("Comfort loss", f"{res.comfort_loss_pct:.1f}%"),
        ("Effective catchment radius", f"{res.effective_catchment_radius_m:,.0f} m"),
        ("Catchment area loss", f"{res.catchment_area_loss_pct:.1f}%"),
        ("Heat exposure dose", f"{res.heat_exposure_dose:.0f} °C·min"),
        (f"Shade needed for EWCS ≥ {target:.0f}", shade_msg),
    ]:
        loss.add_row(k, v)
    console.print(loss)

    if sensitivity:
        grid = sensitivity_grid(inp)
        shades = list(next(iter(grid.values())).keys())
        sens = Table(title="EWCS sensitivity (rows: °C, columns: shade %)",
                     header_style="bold magenta", title_justify="left")
        sens.add_column("Temp", justify="right", style="bold")
        for s in shades:
            sens.add_column(f"{s:.0f}%", justify="right")
        for t, row in grid.items():
            sens.add_row(f"{t:.0f} °C", *(f"[{_ewcs_style(v)}]{v:.0f}[/]" for v in row.values()))
        console.print(sens)

    if json_out:
        payload = res.model_dump(mode="json")
        if sensitivity:
            payload["sensitivity"] = {
                str(t): {str(s): v for s, v in row.items()}
                for t, row in sensitivity_grid(inp).items()
            }
        path = _write(json_out, json.dumps(payload, indent=2))
        console.print(f"[green]✓[/green] Results written to [bold]{path}[/bold]")


# --------------------------------------------------------------------------- #
# export-svg
# --------------------------------------------------------------------------- #


@app.command("export-svg")
@_handle_errors
def export_svg(
    geojson: Annotated[
        Path | None,
        typer.Option(help="GeoJSON with district polygons (and optional points/lines). "
                     "Defaults to the bundled Riyadh districts."),
    ] = None,
    gtfs: Annotated[
        Path | None,
        typer.Option(help="GTFS feed for routes and stations. Defaults to the bundled sample."),
    ] = None,
    out: Annotated[Path, typer.Option("--out", "-o", help="Output SVG path.")] = Path(
        "transit_map.svg"
    ),
    theme: Annotated[str, typer.Option(help="dark or light.")] = "dark",
    title: Annotated[str, typer.Option(help="Map title.")] = "Riyadh Transit Network",
    subtitle: Annotated[str | None, typer.Option(help="Override the auto subtitle.")] = None,
    width: Annotated[int, typer.Option(help="Canvas width (px).")] = 1600,
    height: Annotated[int, typer.Option(help="Canvas height (px).")] = 1200,
    catchment: Annotated[
        str, typer.Option(help="Catchment radii (m) to overlay, comma-separated; '0' for none.")
    ] = "500",
    all_station_catchments: Annotated[
        bool, typer.Option(help="Draw catchments for bus stops too (default: rapid transit only).")
    ] = False,
    labels: Annotated[str, typer.Option(help="Station labels: all, interchanges or none.")] = (
        "interchanges"
    ),
    district_labels: Annotated[bool, typer.Option(help="Label district polygons.")] = True,
    show_bus_stops: Annotated[bool, typer.Option(help="Draw bus-only stops.")] = False,
    no_gtfs: Annotated[
        bool, typer.Option("--no-gtfs", help="Render the GeoJSON only (ignore GTFS).")
    ] = False,
    crs: Annotated[str | None, typer.Option(help="Metric CRS for projection.")] = None,
) -> None:
    """Render a styled, standalone vector SVG map of the network over district boundaries."""
    from transit_scope.gis_svg import RenderOptions, layers_from_analysis, load_geojson, render_svg
    from transit_scope.gtfs import AnalysisConfig, analyze_feed, load_feed

    radii = [r for r in _float_list(catchment, "catchment") if r > 0]
    options = RenderOptions(
        width=width, height=height, theme=theme, title=title, subtitle=subtitle,
        catchment_radii_m=radii, catchment_rapid_only=not all_station_catchments,
        station_labels=labels, district_labels=district_labels, show_bus_stops=show_bus_stops,
        metric_crs=crs,
    )
    if options.theme not in ("dark", "light"):
        raise ValueError("--theme must be 'dark' or 'light'")

    geo_path = geojson or sample_districts_path()
    with console.status("[cyan]Reading GeoJSON…"):
        geo_layers = load_geojson(geo_path)

    result = None
    if not no_gtfs:
        gtfs_path = gtfs or sample_gtfs_path()
        with console.status("[cyan]Analysing GTFS network…"):
            result = analyze_feed(load_feed(gtfs_path), AnalysisConfig(
                metric_crs=crs, catchment_radii_m=radii or [500.0]))
        options.source_note = f"GTFS: {gtfs_path.name}"

    with console.status("[cyan]Rendering SVG…"):
        svg = render_svg(layers_from_analysis(result, geo_layers), options)
    path = _write(out, svg)

    summary = Table.grid(padding=(0, 2))
    summary.add_column(style="bold cyan")
    summary.add_column()
    summary.add_row("Output", str(path))
    summary.add_row("Size", f"{len(svg.encode()) / 1024:,.1f} KB · {width}×{height}px")
    summary.add_row("Theme", options.theme)
    summary.add_row("Districts", f"{len(geo_layers.polygons)} polygons ({geo_path.name})")
    if result is not None:
        network = f"{len(result.route_lines)} routes · {len(result.nodes)} stations"
        summary.add_row("Network", network)
    console.print(Panel(summary, title="[bold green]✓ SVG map exported", border_style="green"))


# --------------------------------------------------------------------------- #
# report-html
# --------------------------------------------------------------------------- #


@app.command("report-html")
@_handle_errors
def report_html(
    out: Annotated[Path, typer.Option("--out", "-o", help="Output HTML path.")] = Path(
        "riyadh_transit_scope.html"
    ),
    gtfs: Annotated[
        Path | None, typer.Option(help="GTFS feed. Defaults to the bundled sample.")
    ] = None,
    geojson: Annotated[
        Path | None, typer.Option(help="District GeoJSON. Defaults to the bundled sample.")
    ] = None,
    cities: Annotated[str, typer.Option(help="Benchmark cities.")] = "riyadh,melbourne,la",
    data: Annotated[Path | None, typer.Option(help="Extra benchmark profiles JSON.")] = None,
    temp: Annotated[float, typer.Option(help="Heat-walk scenario air temperature (°C).")] = 44.0,
    shade: Annotated[float, typer.Option(help="Heat-walk scenario shade (%).")] = 35.0,
    distance: Annotated[float, typer.Option(help="Heat-walk scenario length (m).")] = 800.0,
    title: Annotated[str, typer.Option(help="Report title.")] = "Riyadh Transit Scope",
    fragment: Annotated[
        bool, typer.Option(help="Omit the <html>/<head>/<body> wrapper (for embedding).")
    ] = False,
) -> None:
    """Compile network KPIs, map, benchmark and heat-walk simulator into one HTML file."""
    from transit_scope.html_report import ReportInputs, build_html_report

    inputs = ReportInputs(
        gtfs=gtfs, geojson=geojson, cities=tuple(c for c in cities.split(",") if c.strip()),
        benchmark_data=data, temp_c=temp, shade_pct=shade, distance_m=distance, title=title,
    )
    with console.status("[cyan]Running every module and compiling the report…"):
        html = build_html_report(inputs, fragment=fragment)
    path = _write(out, html)
    size_kb = len(html.encode()) / 1024
    console.print(f"[green]✓[/green] Single-file HTML report written to [bold]{path}[/bold] "
                  f"({size_kb:,.0f} KB)")


# --------------------------------------------------------------------------- #
# sample-data
# --------------------------------------------------------------------------- #


@app.command("sample-data")
@_handle_errors
def sample_data(
    out_dir: Annotated[Path, typer.Argument(help="Destination directory.")] = Path("data"),
    force: Annotated[bool, typer.Option(help="Overwrite existing files.")] = False,
) -> None:
    """Copy the bundled mock Riyadh GTFS, districts and benchmark profiles to a directory."""
    out_dir = out_dir.expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    table = Table("File", "Status", header_style="bold magenta")
    for src in (sample_gtfs_path(), sample_districts_path(), benchmark_cities_path()):
        dest = out_dir / src.name
        if dest.exists() and not force:
            table.add_row(str(dest), "[yellow]exists (use --force)[/yellow]")
            continue
        shutil.copyfile(src, dest)
        table.add_row(str(dest), "[green]copied[/green]")
    console.print(table)
    console.print("[dim]Note: sample GTFS and districts are mock data for demonstration.[/dim]")


if __name__ == "__main__":  # pragma: no cover
    app()
