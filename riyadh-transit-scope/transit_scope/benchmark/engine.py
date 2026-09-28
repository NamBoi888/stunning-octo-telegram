"""Load city profiles, resolve user selections and derive comparable metrics."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from transit_scope.benchmark.models import BenchmarkDataset, CityMetrics, CityProfile
from transit_scope.errors import BenchmarkDataError, InputFileError
from transit_scope.paths import benchmark_cities_path

#: Fare burden at which the fare accessibility index reaches zero.
FARE_BURDEN_CEILING_PCT = 10.0


@dataclass(frozen=True)
class MetricSpec:
    """How a derived metric is labelled, formatted and ranked."""

    attr: str
    label: str
    unit: str
    higher_is_better: bool | None  # None = context metric, not ranked
    fmt: str = "{:,.1f}"

    def format(self, value: float) -> str:
        return self.fmt.format(value)


METRICS: list[MetricSpec] = [
    MetricSpec("urban_extent_km2", "Urban extent", "km²", None, "{:,.0f}"),
    MetricSpec("network_coverage_km2", "Network coverage area", "km²", True, "{:,.0f}"),
    MetricSpec("coverage_ratio_pct", "Coverage vs. urban extent", "%", True),
    MetricSpec("total_route_km", "Total route length", "km", True, "{:,.0f}"),
    MetricSpec("route_density_km_per_km2", "Route density", "km/km²", True, "{:,.2f}"),
    MetricSpec("rapid_route_km", "Rapid transit route length", "km", True, "{:,.0f}"),
    MetricSpec("rapid_share_of_route_km_pct", "Rapid transit share of route-km", "%", True),
    MetricSpec("mean_peak_headway_min", "Mean peak headway", "min", False),
    MetricSpec("rapid_to_bus_fleet_ratio", "Rapid transit : bus fleet ratio", "×", True, "{:.2f}"),
    MetricSpec("transit_modal_split_pct", "Public transit modal split", "%", True),
    MetricSpec("fare_burden_pct", "Monthly pass / household income", "%", False, "{:.2f}"),
    MetricSpec("fare_accessibility_index", "Fare accessibility index", "/100", True),
    MetricSpec("route_km_per_100k_pop", "Route-km per 100k residents", "km", True),
]


def load_dataset(path: str | Path | None = None) -> BenchmarkDataset:
    """Load and validate a benchmark dataset (bundled profiles by default)."""
    path = Path(path).expanduser() if path else benchmark_cities_path()
    if not path.exists():
        raise InputFileError(f"Benchmark data file not found: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BenchmarkDataError(f"{path} is not valid JSON: {exc}") from exc
    try:
        return BenchmarkDataset.model_validate(raw)
    except ValidationError as exc:
        raise BenchmarkDataError(f"{path} failed validation:\n{exc}") from exc


def merge_datasets(base: BenchmarkDataset, extra: BenchmarkDataset) -> BenchmarkDataset:
    """Overlay ``extra`` profiles on ``base`` (matching keys are replaced)."""
    cities = {c.key: c for c in base.cities}
    cities.update({c.key: c for c in extra.cities})
    return BenchmarkDataset(
        schema_version=base.schema_version,
        disclaimer=extra.disclaimer or base.disclaimer,
        cities=list(cities.values()),
    )


def resolve_cities(dataset: BenchmarkDataset, requested: list[str]) -> list[CityProfile]:
    """Resolve keys/aliases/names (case-insensitive) preserving request order."""
    lookup: dict[str, CityProfile] = {}
    for city in dataset.cities:
        for token in (city.key, city.name, *city.aliases):
            lookup[token.lower().replace(" ", "-")] = city
    resolved, unknown = [], []
    for token in requested:
        norm = token.strip().lower().replace(" ", "-")
        if not norm:
            continue
        if norm in lookup:
            if lookup[norm] not in resolved:
                resolved.append(lookup[norm])
        else:
            unknown.append(token)
    if unknown:
        available = ", ".join(c.key for c in dataset.cities)
        raise BenchmarkDataError(f"Unknown city: {', '.join(unknown)}. Available: {available}")
    if not resolved:
        raise BenchmarkDataError("No cities selected.")
    return resolved


def compute_metrics(city: CityProfile) -> CityMetrics:
    """Derive comparable indicators from a raw city profile."""
    modes = city.modes()
    total_km = sum(m.route_km for _, m in modes)
    weighted_hw = (
        sum(m.route_km * m.peak_headway_min for _, m in modes) / total_km if total_km else 0.0
    )
    rapid = city.rapid_transit
    burden = 100 * city.monthly_pass_usd / city.median_monthly_household_income_usd
    fai = max(0.0, min(100.0, 100 * (1 - burden / FARE_BURDEN_CEILING_PCT)))
    return CityMetrics(
        key=city.key,
        name=city.name,
        data_year=city.data_year,
        urban_extent_km2=city.urban_extent_km2,
        network_coverage_km2=city.network_coverage_km2,
        coverage_ratio_pct=round(100 * city.network_coverage_km2 / city.urban_extent_km2, 1),
        total_route_km=round(total_km, 1),
        route_density_km_per_km2=round(total_km / city.urban_extent_km2, 3),
        rapid_route_km=rapid.route_km,
        rapid_share_of_route_km_pct=round(100 * rapid.route_km / total_km, 1) if total_km else 0,
        mean_peak_headway_min=round(weighted_hw, 1),
        rapid_to_bus_fleet_ratio=round(rapid.fleet_vehicles / city.bus.fleet_vehicles, 3)
        if city.bus.fleet_vehicles
        else 0.0,
        transit_modal_split_pct=city.transit_modal_split_pct,
        fare_burden_pct=round(burden, 2),
        fare_accessibility_index=round(fai, 1),
        route_km_per_100k_pop=round(total_km / (city.population_m * 10), 1),
    )


def rank(metrics: list[CityMetrics], spec: MetricSpec) -> dict[str, int]:
    """Rank cities (1 = best) on one metric; empty for unranked context metrics."""
    if spec.higher_is_better is None:
        return {}
    ordered = sorted(
        metrics, key=lambda m: getattr(m, spec.attr), reverse=spec.higher_is_better
    )
    return {m.key: i + 1 for i, m in enumerate(ordered)}


def run_benchmark(
    cities: list[str], data_path: str | Path | None = None
) -> tuple[BenchmarkDataset, list[CityProfile], list[CityMetrics]]:
    """Resolve cities (bundled data overlaid with ``data_path``) and compute metrics."""
    dataset = load_dataset()
    if data_path:
        dataset = merge_datasets(dataset, load_dataset(data_path))
    profiles = resolve_cities(dataset, cities)
    return dataset, profiles, [compute_metrics(p) for p in profiles]
