"""The bundled data must match what the generator produces (determinism)."""

from __future__ import annotations

import json
import zipfile

from transit_scope.sample_data import build_districts_geojson, build_gtfs_tables, build_sample_gtfs


def test_bundled_gtfs_matches_generator(sample_gtfs, tmp_path):
    rebuilt = build_sample_gtfs(tmp_path / "rebuilt.zip")
    with zipfile.ZipFile(sample_gtfs) as a, zipfile.ZipFile(rebuilt) as b:
        assert sorted(a.namelist()) == sorted(b.namelist())
        for name in a.namelist():
            assert a.read(name) == b.read(name), name


def test_tables_have_expected_files():
    tables = build_gtfs_tables()
    assert {"stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "shapes.txt",
            "calendar.txt", "agency.txt"} <= set(tables)


def test_districts_are_valid(sample_districts):
    data = json.loads(sample_districts.read_text())
    assert data["type"] == "FeatureCollection"
    names = [f["properties"]["name"] for f in data["features"]]
    assert "Al Olaya" in names and len(names) == len(set(names))
    assert len(build_districts_geojson()["features"]) == len(names)
