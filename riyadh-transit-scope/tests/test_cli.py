"""End-to-end CLI smoke tests (each command runs against bundled sample data)."""

from __future__ import annotations

import json

from typer.testing import CliRunner

from transit_scope.cli import app

runner = CliRunner()


def invoke(*args: str):
    return runner.invoke(app, list(args), env={"COLUMNS": "160"})


def test_analyze_default_sample(tmp_path):
    out = tmp_path / "report.json"
    geo = tmp_path / "catchments.geojson"
    res = invoke("analyze", "--out", str(out), "--catchments-geojson", str(geo))
    assert res.exit_code == 0, res.output
    assert "Network summary" in res.output and "EPSG:32638" in res.output
    report = json.loads(out.read_text())
    assert report["summary"]["routes"] == 6
    assert json.loads(geo.read_text())["type"] == "FeatureCollection"


def test_analyze_missing_file(tmp_path):
    res = invoke("analyze", str(tmp_path / "nope.zip"))
    assert res.exit_code == 1
    assert "not found" in res.output


def test_validate_accepts_bundled_data(tmp_path):
    js = tmp_path / "validation.json"
    res = invoke("validate", "--json", str(js))
    assert res.exit_code == 0, res.output
    assert "accepted" in res.output
    data = json.loads(js.read_text())
    assert not [f for f in data["findings"] if f["status"] in ("mismatch", "error")]


def test_simulate_corridor(tmp_path):
    js = tmp_path / "sim.json"
    res = invoke("simulate-corridor", "--temp", "44", "--shade", "35", "--distance", "800",
                 "--json", str(js))
    assert res.exit_code == 0, res.output
    assert "EWCS" in res.output and "Catchment area loss" in res.output
    data = json.loads(js.read_text())
    assert data["penalty_active"] is True and "sensitivity" in data


def test_simulate_corridor_invalid():
    res = invoke("simulate-corridor", "--shade", "150")
    assert res.exit_code == 1 and "shade_pct" in res.output


def test_export_svg(tmp_path):
    out = tmp_path / "map.svg"
    res = invoke("export-svg", "--out", str(out), "--theme", "light", "--catchment", "500,1000",
                 "--labels", "all")
    assert res.exit_code == 0, res.output
    svg = out.read_text()
    assert svg.startswith("<?xml") and svg.rstrip().endswith("</svg>")
    assert svg.count('data-route="') == 6  # six metro lines
    assert "KAFD" in svg  # interchange labels placed


def test_export_svg_geojson_only(tmp_path):
    out = tmp_path / "districts.svg"
    res = invoke("export-svg", "--no-gtfs", "--out", str(out))
    assert res.exit_code == 0, res.output
    assert 'id="routes"' not in out.read_text()


def test_export_svg_bad_theme(tmp_path):
    res = invoke("export-svg", "--theme", "neon", "--out", str(tmp_path / "x.svg"))
    assert res.exit_code == 1


def test_sample_data(tmp_path):
    res = invoke("sample-data", str(tmp_path / "data"))
    assert res.exit_code == 0, res.output
    assert (tmp_path / "data" / "riyadh_metro_gtfs.zip").exists()
    assert (tmp_path / "data" / "riyadh_stations.geojson").exists()
    again = invoke("sample-data", str(tmp_path / "data"))
    assert "exists" in again.output


def test_version():
    res = invoke("--version")
    assert res.exit_code == 0 and "0.1.0" in res.output


def test_report_html(tmp_path):
    out = tmp_path / "report.html"
    res = invoke("report-html", "--out", str(out), "--temp", "46")
    assert res.exit_code == 0, res.output
    html = out.read_text()
    assert html.startswith("<!doctype html>") and html.rstrip().endswith("</html>")
    for anchor in ('id="map"', 'id="validation"', 'id="network"', 'id="heat"', 'id="sources"'):
        assert anchor in html
    assert 'id="map-svg"' in html and "0 mismatches" in html
    assert "قصر الحكم" in html  # Arabic station names reach the map data
    assert '"in-temp": 46.0' in html  # scenario defaults reach the simulator
    assert "Melbourne" not in html
    frag = tmp_path / "frag.html"
    assert invoke("report-html", "--fragment", "--out", str(frag)).exit_code == 0
    assert frag.read_text().startswith("<title>")
