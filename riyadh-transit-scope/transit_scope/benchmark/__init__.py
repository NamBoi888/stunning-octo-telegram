"""Multi-city benchmarking engine (Riyadh, Melbourne, Los Angeles by default)."""

from transit_scope.benchmark.engine import (
    METRICS,
    compute_metrics,
    load_dataset,
    resolve_cities,
    run_benchmark,
)
from transit_scope.benchmark.models import BenchmarkDataset, CityMetrics, CityProfile
from transit_scope.benchmark.report import markdown_report, rich_table

__all__ = [
    "METRICS",
    "BenchmarkDataset",
    "CityMetrics",
    "CityProfile",
    "compute_metrics",
    "load_dataset",
    "markdown_report",
    "resolve_cities",
    "rich_table",
    "run_benchmark",
]
