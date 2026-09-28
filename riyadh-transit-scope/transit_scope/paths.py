"""Locations of bundled sample data, with on-demand regeneration fallback.

All CLI commands default to the files in ``transit_scope/data`` so the tool
runs out-of-the-box. If a bundled file is missing (e.g. a stripped install)
it is regenerated deterministically into a user cache directory.
"""

from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

SAMPLE_GTFS_NAME = "riyadh_sample_gtfs.zip"
SAMPLE_DISTRICTS_NAME = "riyadh_districts.geojson"
BENCHMARK_CITIES_NAME = "benchmark_cities.json"


def _cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    path = Path(base) / "riyadh-transit-scope"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sample_gtfs_path() -> Path:
    """Return the bundled Riyadh sample GTFS zip, generating it if absent."""
    bundled = DATA_DIR / SAMPLE_GTFS_NAME
    if bundled.exists():
        return bundled
    from transit_scope.sample_data import build_sample_gtfs

    target = _cache_dir() / SAMPLE_GTFS_NAME
    if not target.exists():
        build_sample_gtfs(target)
    return target


def sample_districts_path() -> Path:
    """Return the bundled Riyadh district GeoJSON, generating it if absent."""
    bundled = DATA_DIR / SAMPLE_DISTRICTS_NAME
    if bundled.exists():
        return bundled
    from transit_scope.sample_data import build_sample_districts

    target = _cache_dir() / SAMPLE_DISTRICTS_NAME
    if not target.exists():
        build_sample_districts(target)
    return target


def benchmark_cities_path() -> Path:
    """Return the bundled benchmark city profile JSON."""
    return DATA_DIR / BENCHMARK_CITIES_NAME
