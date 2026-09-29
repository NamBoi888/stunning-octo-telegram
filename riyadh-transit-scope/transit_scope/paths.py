"""Locations of the bundled Riyadh data, with on-demand rebuild fallback.

The bundled files are built from OpenStreetMap snapshots plus published
official figures (see :mod:`transit_scope.riyadh`). If a built file is
missing, it is rebuilt from the snapshots into a user cache directory.
"""

from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

GTFS_NAME = "riyadh_metro_gtfs.zip"
DISTRICTS_NAME = "riyadh_districts.geojson"
STATIONS_NAME = "riyadh_stations.geojson"
BUS_NAME = "riyadh_bus_osm.geojson"
VALIDATION_NAME = "riyadh_validation.json"


def _cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    path = Path(base) / "riyadh-transit-scope"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve(name: str) -> Path:
    bundled = DATA_DIR / name
    if bundled.exists():
        return bundled
    target = _cache_dir() / name
    if not target.exists():
        from transit_scope.riyadh.build import assemble, write_dataset

        write_dataset(assemble(), _cache_dir())
    return target


def riyadh_gtfs_path() -> Path:
    """GTFS for the six Riyadh Metro lines (built from OSM + official figures)."""
    return _resolve(GTFS_NAME)


def riyadh_districts_path() -> Path:
    """OSM neighbourhood boundaries (admin level 10) for Riyadh."""
    return _resolve(DISTRICTS_NAME)


def riyadh_stations_path() -> Path:
    return _resolve(STATIONS_NAME)


def riyadh_bus_path() -> Path:
    return _resolve(BUS_NAME)


# Backwards-compatible names used across the CLI and tests.
sample_gtfs_path = riyadh_gtfs_path
sample_districts_path = riyadh_districts_path
