from __future__ import annotations

import json

import pytest

from transit_scope.benchmark import (
    METRICS,
    compute_metrics,
    load_dataset,
    markdown_report,
    resolve_cities,
    run_benchmark,
)
from transit_scope.benchmark.engine import rank
from transit_scope.errors import BenchmarkDataError, InputFileError


def test_bundled_dataset_valid():
    ds = load_dataset()
    assert {c.key for c in ds.cities} == {"riyadh", "melbourne", "la"}


def test_alias_resolution_preserves_order():
    ds = load_dataset()
    cities = resolve_cities(ds, ["Los Angeles", "RIYADH", "mel", "riyadh"])
    assert [c.key for c in cities] == ["la", "riyadh", "melbourne"]


def test_unknown_city():
    with pytest.raises(BenchmarkDataError, match="tokyo"):
        resolve_cities(load_dataset(), ["tokyo"])


def test_derived_metrics_riyadh():
    riyadh = resolve_cities(load_dataset(), ["riyadh"])[0]
    m = compute_metrics(riyadh)
    assert m.total_route_km == 176 + 1900
    assert m.route_density_km_per_km2 == pytest.approx(2076 / 1800, abs=1e-3)
    assert m.coverage_ratio_pct == 40.0
    assert m.rapid_to_bus_fleet_ratio == pytest.approx(452 / 842, abs=1e-3)
    weighted = (176 * 5 + 1900 * 15) / 2076
    assert m.mean_peak_headway_min == pytest.approx(weighted, abs=0.05)
    assert 0 <= m.fare_accessibility_index <= 100


def test_ranking_directions():
    _, _, metrics = run_benchmark(["riyadh", "melbourne", "la"])
    headway = next(s for s in METRICS if s.attr == "mean_peak_headway_min")
    ranks = rank(metrics, headway)
    best = min(metrics, key=lambda m: m.mean_peak_headway_min)
    assert ranks[best.key] == 1  # lower headway is better
    extent = next(s for s in METRICS if s.attr == "urban_extent_km2")
    assert rank(metrics, extent) == {}  # context metric is not ranked


def test_markdown_report_contents():
    ds, profiles, metrics = run_benchmark(["riyadh", "melbourne", "la"])
    md = markdown_report(ds, profiles, metrics)
    assert md.startswith("# Multi-City Transit Benchmark")
    assert "| Metric | Unit | Riyadh | Melbourne | Los Angeles |" in md
    assert "## Key findings" in md and "## Methodology" in md
    assert "Urban extent:**" not in md  # unranked rows produce no finding


def test_custom_override(tmp_path):
    ds = load_dataset()
    riyadh = ds.cities[0].model_dump()
    riyadh["transit_modal_split_pct"] = 15.0
    extra = {"cities": [riyadh]}
    path = tmp_path / "override.json"
    path.write_text(json.dumps(extra))
    _, _, metrics = run_benchmark(["riyadh"], path)
    assert metrics[0].transit_modal_split_pct == 15.0


def test_invalid_profile(tmp_path):
    bad = load_dataset().cities[0].model_dump()
    bad["network_coverage_km2"] = 1e6
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"cities": [bad]}))
    with pytest.raises(BenchmarkDataError, match="implausibly"):
        load_dataset(path)


def test_missing_data_file():
    with pytest.raises(InputFileError):
        load_dataset("nope.json")
