"""Riyadh data pipeline: reference schema, OSM reconciliation, build and validation."""

from __future__ import annotations

import json
import zipfile

import pytest
from shapely.geometry import LineString

from transit_scope.paths import DATA_DIR, riyadh_gtfs_path, riyadh_stations_path
from transit_scope.riyadh.build import (
    assemble,
    build_gtfs_tables,
    clean_arabic,
    normalise,
    similarity,
)
from transit_scope.riyadh.osm import _chain_rings
from transit_scope.riyadh.reference import RiyadhReference, load_reference
from transit_scope.riyadh.validate import validate_dataset


@pytest.fixture(scope="module")
def dataset():
    return assemble()


def test_reference_consistency():
    ref = load_reference()
    assert [line.ref for line in ref.lines] == ["1", "2", "3", "4", "5", "6"]
    assert sum(line.stations for line in ref.lines) == 94
    assert ref.system.total_length_km == 176 and ref.system.stations == 85


def test_reference_rejects_inconsistent_lists():
    raw = json.loads((DATA_DIR / "riyadh_reference.json").read_text(encoding="utf-8"))
    raw["lines"][0]["station_list"] = raw["lines"][0]["station_list"][:-1]
    with pytest.raises(ValueError, match="station_list"):
        RiyadhReference.model_validate(raw)


def test_reconciliation_matches_official_lists(dataset):
    for line in dataset.lines:
        lref = dataset.reference.line(line.ref)
        assert [m.reference_name for m in line.matches] == lref.station_list
        assert set(line.directions) == {0, 1}
        assert not line.issues
    kinds = {m.resolution for line in dataset.lines for m in line.matches}
    assert kinds <= {"exact", "fuzzy", "filled", "renamed"}


def test_stations_and_interchanges(dataset):
    assert len(dataset.stations) == 83
    x = {s.name: s.lines for s in dataset.stations if len(s.lines) > 1}
    assert x == {k: sorted(v) for k, v in dataset.reference.interchanges.items()}
    assert all(s.spread_m < 350 for s in dataset.stations)


def test_arabic_names_are_arabic(dataset):
    for s in dataset.stations:
        if s.name_ar:
            assert clean_arabic(s.name_ar) == s.name_ar
    named = sum(1 for s in dataset.stations if s.name_ar)
    assert named >= 82  # only a station whose name is disputed between sources lacks one


def test_validation_accepts_build(dataset):
    rep = validate_dataset(dataset, riyadh_gtfs_path())
    bad = [f for f in rep.findings if f.status in ("mismatch", "error")]
    assert rep.ok, bad
    assert rep.counts["pass"] > 100


def test_validation_catches_a_wrong_station_count(dataset):
    lref = dataset.reference.line("5")
    broken = lref.model_copy(update={"stations": 13})
    ref = dataset.reference.model_copy(update={"lines": [
        broken if line.ref == "5" else line for line in dataset.reference.lines]})
    tampered = type(dataset)(ref, dataset.lines, dataset.stations, dataset.districts,
                             dataset.bus_routes, dataset.bus_stops, dataset.gtfs_tables)
    rep = validate_dataset(tampered)
    assert not rep.ok
    assert any(f.check == "station-count" and f.status == "mismatch" for f in rep.findings)


def test_bundled_gtfs_matches_rebuild(dataset):
    tables = build_gtfs_tables(dataset.reference, dataset.lines, dataset.stations)
    with zipfile.ZipFile(riyadh_gtfs_path()) as z:
        for name, text in tables.items():
            assert z.read(name).decode("utf-8") == text, name


def test_stations_layer(dataset):
    fc = json.loads(riyadh_stations_path().read_text(encoding="utf-8"))
    assert len(fc["features"]) == 83
    assert "OpenStreetMap" in fc["attribution"]


def test_ring_repair_bridges_small_gaps_only():
    a = LineString([(0, 0), (1, 0), (1, 1)])
    b = LineString([(1, 1.001), (0, 1), (0, 0.001)])  # ~110 m gaps at both joins
    rings, gap = _chain_rings([a, b], tol=0.0045)
    assert len(rings) == 1 and 0 < gap < 0.0045
    rings, _ = _chain_rings([a, LineString([(1, 1.2), (0, 1.2)])], tol=0.0045)
    assert rings == []  # fragments too far apart are dropped, not invented


def test_name_normalisation():
    assert similarity("King Fahad District", "King Fahd District") == 1.0
    assert similarity("Al Inma Bank", "Alinma Bank") > 0.85
    assert normalise("King Abdullah Financial District") == "kafd"
    assert clean_arabic("محطة قصر الحكم") == "قصر الحكم"
    assert clean_arabic("SABIC") is None and clean_arabic("محطة") is None
