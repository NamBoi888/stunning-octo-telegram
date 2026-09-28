# riyadh-transit-scope

A terminal toolkit for urban transit research. It brings four workflows together behind one `transit` command:

| Module | What it does |
|---|---|
| **GTFS engine** (`transit_scope/gtfs/`) | Reads a GTFS feed and computes network KPIs: route-km, headways, station activity, walk catchments and transfer friction |
| **Benchmarking** (`transit_scope/benchmark/`) | Compares Riyadh, Melbourne and Los Angeles (or your own profiles) side by side |
| **Microclimate** (`transit_scope/microclimate/`) | Models walkability to a station in extreme heat and scores it with the Effective Walkable Catchment Score (EWCS) |
| **GIS → SVG** (`transit_scope/gis_svg/`) | Draws print-quality vector maps (dark or light theme) from GeoJSON and GTFS |

Every command works immediately after install because the package ships with mock sample data for Riyadh.

![Riyadh sample network, dark theme](docs/riyadh_map_dark.svg)

> **Sample data notice.** The bundled Riyadh GTFS feed and district polygons are **mock data** for demonstration and testing. Station positions and alignments roughly follow the Riyadh Metro, and the timetables are synthetic. The benchmark figures are rounded, indicative values. Check them against primary sources before you cite them.

---

## Installation

You need Python 3.11 or newer.

```bash
cd riyadh-transit-scope
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"      # installs the `transit` and `riyadh-transit-scope` commands
```

Dependencies: `typer`, `rich`, `pandas`, `geopandas`, `shapely`, `pyproj`, `pydantic`. The SVG output is plain XML written by the tool, so no drawing library is needed.

## Quick start

```bash
transit analyze                                         # KPIs for the bundled Riyadh sample
transit benchmark --cities riyadh,melbourne,la          # comparison table + benchmark_report.md
transit simulate-corridor --temp 44 --shade 35 --distance 800
transit export-svg --out map.svg --theme dark           # map over the bundled district boundaries
transit sample-data ./data                              # copy the sample files so you can edit them
```

To use your own inputs, pass their paths:

```bash
transit analyze path/to/gtfs.zip --out report.json --catchments-geojson catchments.geojson
transit export-svg --geojson districts.geojson --gtfs path/to/gtfs.zip --out map.svg --theme light
```

---

## Commands

### `transit analyze [GTFS_PATH]`

Reads a GTFS `.zip` or an unzipped directory, prints summary tables with Rich, and writes a JSON report.

| Option | Default | Meaning |
|---|---|---|
| `--out, -o` | `transit_report.json` | Where to write the JSON report |
| `--peaks` | `07:00-09:00,16:00-19:00` | Peak windows. They must not overlap |
| `--radii` | `500,1000` | Walk-catchment radii in metres |
| `--crs` | auto | Metric CRS used for lengths and buffers. By default the tool picks the local UTM zone (**EPSG:32638** for Riyadh) |
| `--date` | busiest weekday | Service date as `YYYYMMDD`. Applies `calendar.txt` and `calendar_dates.txt` |
| `--cluster-radius` | `150` | Stops within this many metres of each other are grouped into one interchange node |
| `--top` | `10` | Number of rows in the station and transfer tables |
| `--catchments-geojson` | – | Also write the dissolved catchment polygons as WGS84 GeoJSON |

**What the GTFS loader handles:**
- zips with the files inside a sub-folder
- UTF-8 files with a byte-order mark (BOM)
- `frequencies.txt` (template trips are expanded into individual departures)
- feeds that only have `calendar_dates.txt`
- trips that run past midnight (e.g. `25:10:00`)
- stops with blank times (non-timepoints)
- missing `shapes.txt` (route geometry is rebuilt from the stop sequence)
- platforms grouped under `parent_station`
- invalid `route_color` values (a colour is chosen from the route's mode)

Rows that point to unknown trips or stops are skipped, and each skip is listed in the report's warnings.

### `transit benchmark --cities riyadh,melbourne,la`

Prints the comparison as a Rich table (★ marks the best value in each row) and writes `benchmark_report.md`. The report contains the comparison table, key findings, a per-mode supply breakdown, the methodology and sources.

- City names are matched without regard to case, and aliases work: `la`, `los-angeles`, `mel`, `ruh`.
- `--data custom.json` adds new cities or replaces bundled ones. The file uses the same schema as `transit_scope/data/benchmark_cities.json`, and every profile is checked by Pydantic when loaded.
- `--json metrics.json` also exports the derived metrics.

### `transit simulate-corridor --temp 44 --shade 35 --distance 800`

Runs the heat-penalised walking model for one access corridor.

**Options:**
- `--solar` — irradiance in W/m² (default 950)
- `--humidity`, `--wind`, `--walk-speed`
- `--shade-type` — one of `mixed`, `trees`, `arcade`, `sail`
- `--target` — the EWCS you want; the tool solves for the shade % needed to reach it
- `--no-sensitivity` — hide the temperature × shade grid
- `--json out.json` — save the results

### `transit export-svg --geojson <path> --gtfs <path> --out <file.svg> --theme dark`

Writes a single self-contained SVG file.

**What the map shows:**
- route lines coloured by line (rapid transit is drawn thick with an outline; buses are dashed)
- station markers, with interchanges highlighted
- walk-catchment circles
- district boundaries and names
- an automatic legend, scale bar, north arrow and title block

Labels are placed so they don't overlap each other or the legend. Each layer is a named `<g id="…">` group, so the file can be edited in Inkscape or Illustrator.

| Option | Default | Meaning |
|---|---|---|
| `--theme` | `dark` | `dark` or `light` |
| `--catchment` | `500` | Catchment radii to draw, comma-separated. Use `0` for none |
| `--labels` | `interchanges` | Which stations get labels: `all`, `interchanges` or `none` |
| `--width / --height` | `1600 × 1200` | Canvas size in pixels |
| `--show-bus-stops` | off | Also draw stops served only by buses |
| `--all-station-catchments` | off | Draw catchments around bus stops too, not only rapid transit |
| `--no-gtfs` | off | Draw only the GeoJSON layers |

GeoJSON input is sorted by geometry type:
- **Polygons** become districts.
- **Points and lines** are drawn as overlay features. A line's `color` property is used as its colour.

Feature names are read from `name`, `NAME`, `name_en`, `district`, `label` or `title`, whichever each feature has.

### `transit sample-data [DIR]`

Copies the bundled GTFS zip, district GeoJSON and benchmark profiles into `DIR` (default `./data`), so you can inspect or edit them.

---

## Methodology

### GTFS network KPIs

- **Service day.** The analysis uses one service day. By default this is the weekday with the most trips (ties go to Sunday, the first day of Riyadh's working week). Pass `--date` to choose a specific date.
- **Route length.** For each route and direction, the most common shape is used. If there is no `shapes.txt`, the most common stop sequence is used instead. Lengths are measured in the metric CRS. `length_km` is the average of the directions, and the route-km total adds these up across routes.
- **Vehicle-km per day.** The sum of the lengths of all trips that run on the service day.
- **Headway.** The average gap between consecutive trip departures within the same route and direction. Each gap is counted in the peak or off-peak period according to when the earlier departure leaves. Gaps longer than 2 hours are treated as breaks in service and ignored. A route's headway is the average of its directions.
- **Station nodes.** Stops are first grouped by `parent_station`. The remaining stops are clustered by starting from the busiest rapid-transit stops and pulling in every unassigned stop within the cluster radius. This keeps a node no wider than twice the radius, even along dense bus corridors. A node's combined headway includes every route and direction serving it.
- **Walk catchments.** Buffers of 500 m and 1000 m are drawn around each node in UTM (EPSG:32638 for Riyadh) and merged. The area is reported for all nodes and for rapid-transit nodes only.
- **Transfer Friction Index (TFI).** Computed for every node served by two or more routes:

  `TFI = pairs × expected_wait × (1 + spread_m/200) × (1 + 0.25 × (modes − 1))`

  Here `pairs = n(n−1)/2`, and `expected_wait` is the average of half the peak headway of the routes at the node. A higher TFI means a larger transfer burden.

  The **hub score** (0–100) ranks how important a node is, separately from friction: `routes × √(peak departures)`, scaled so the busiest node is 100.

### Benchmark metrics

**How the metrics are calculated:**
- **Coverage vs. urban extent** = catchment area ÷ built-up urban area.
- **Route density** = route-km across all modes ÷ urban extent.
- **Mean peak headway** = modal peak headways averaged, weighted by route-km.
- **Rapid : bus fleet ratio** = rapid-transit vehicles ÷ buses.
- **Fare accessibility index** = `100 × (1 − burden / 10%)`, clamped to 0–100, where burden = monthly pass ÷ median monthly household income.

Urban extent is shown for context and is not ranked.

### Corridor microclimate model (EWCS)

This is a simple screening model for comparing corridor designs. It does not replace a full UTCI or PET simulation. It walks the shaded and unshaded parts of the corridor separately:

1. **Radiant load.**
   - In sun: `ΔTmrt = 26 °C × G/1000`.
   - In shade: this is reduced by `85% × q`, where `q` is the shade quality (trees 1.0 > arcade 0.95 > mixed 0.9 > sail 0.8).
   - Trees and mixed shade also cool the air slightly through evaporation.
2. **Corridor Thermal Index (a "feels-like" temperature):**

   `CTI = Ta + 0.30·ΔTmrt + humidity term − wind relief`

   Above 35 °C, wind gives only a little relief. CTI is mapped to UTCI-style heat-stress bands.
3. **Walking pace.** `f = clamp(1 − 0.008·(CTI − 32), 0.6, 1)`.
4. **Distance penalty.** This applies only when **Ta > 40 °C**:
   - Unshaded: `p_u = 1 + (Ta − 40)·(0.12·G/1000 + 0.04·D_unshaded_km)`.
   - Shaded: `p_s = 1 + 0.03·(Ta − 40)`.

   The penalty rises smoothly from zero at 40 °C, so there is no jump at the threshold.
5. **Results:**
   - nominal, heat-adjusted and perceived walk times
   - **EWCS = 100 × nominal ÷ perceived time**, graded A–F
   - effective catchment radius and the lost catchment area `1 − (r_eff/r)²`
   - heat exposure dose in °C·min above 32 °C
   - the shade % needed to reach a target EWCS

All calibration constants are in `ModelParameters`, so they can be changed for sensitivity studies.

---

## Python API

```python
from transit_scope.gtfs import load_feed, analyze_feed, AnalysisConfig
from transit_scope.microclimate import CorridorInput, simulate_corridor
from transit_scope.gis_svg import layers_from_analysis, load_geojson, render_svg, RenderOptions

result = analyze_feed(load_feed("gtfs.zip"), AnalysisConfig(catchment_radii_m=[400, 800]))
print(result.report.summary.route_km_total)

sim = simulate_corridor(CorridorInput(distance_m=600, shade_pct=50, temp_c=46))
print(sim.ewcs, sim.shade_needed_for_target_pct)

svg = render_svg(layers_from_analysis(result, load_geojson("districts.geojson")),
                 RenderOptions(theme="light", title="My Network"))
```

## Project layout

```
riyadh-transit-scope/
├── pyproject.toml
├── transit_scope/
│   ├── cli.py                 # Typer app (`transit …`)
│   ├── errors.py, paths.py    # error types, locations of the bundled data
│   ├── sample_data.py         # deterministic generator for the mock Riyadh data
│   ├── data/                  # riyadh_sample_gtfs.zip, riyadh_districts.geojson, benchmark_cities.json
│   ├── gtfs/                  # loader.py, service.py, kpis.py, models.py
│   ├── benchmark/             # engine.py, report.py, models.py
│   ├── microclimate/          # model.py
│   ├── gis_svg/               # geojson_io.py, projection.py, renderer.py, themes.py
│   └── utils/                 # time parsing, geodesy / UTM selection
├── docs/                      # example maps and benchmark report
└── tests/                     # pytest suite (unit + CLI end-to-end)
```

## Development

```bash
pytest                               # 76 tests
ruff check .
python -m transit_scope.sample_data  # rebuild the bundled sample data (the output is identical each run)
```

A synthetic feed with 900k `stop_times` rows (150 routes, 4.5k stops) loads and analyses in about 7 seconds.
