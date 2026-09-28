from __future__ import annotations

import json

import pytest

from transit_scope.errors import GTFSValidationError, InputFileError
from transit_scope.gtfs import AnalysisConfig, TimeWindow, analyze_feed, load_feed
from transit_scope.gtfs.kpis import natural_key
from transit_scope.gtfs.models import mode_from_route_type
from transit_scope.utils.timeutil import format_seconds, parse_hhmm

# --------------------------------------------------------------------------- #
# Sample feed
# --------------------------------------------------------------------------- #


def test_sample_summary(sample_result):
    s = sample_result.report.summary
    assert s.metric_crs == "EPSG:32638"  # UTM 38N for Riyadh
    assert s.routes_by_mode == {"metro": 6, "bus": 3}
    assert s.service_day == "busiest weekday (sunday)"
    assert 140 < s.route_km_by_mode["metro"] < 170
    assert s.trips_per_day > 1000
    assert s.transfer_nodes >= 10


def test_sample_headways_match_generator(sample_result):
    by_name = {r.name: r for r in sample_result.report.routes}
    assert by_name["1"].peak_headway_min == pytest.approx(4.0, abs=0.1)
    assert by_name["1"].offpeak_headway_min == pytest.approx(8.0, abs=0.1)
    assert by_name["150"].peak_headway_min == pytest.approx(15.0, abs=0.1)
    assert by_name["1"].avg_speed_kmh < 42  # dwell times slow the 42 km/h cruise


def test_routes_are_naturally_sorted(sample_result):
    names = [r.name for r in sample_result.report.routes if r.mode == "bus"]
    assert names == ["7", "9", "150"]


def test_interchange_clusters_bus_and_metro(sample_result):
    stations = {s.name: s for s in sample_result.report.stations}
    qhk = stations["Qasr Al Hokm"]
    assert set(qhk.stop_ids) == {"QHK", "BUS_QHK"}
    assert set(qhk.modes) == {"bus", "metro"}
    assert qhk.routes == ["1", "3", "9"]


def test_transfer_friction_index(sample_result):
    nodes = {t.name: t for t in sample_result.report.transfer_nodes}
    kafd = nodes["KAFD"]
    assert kafd.routes_served == 3 and kafd.transfer_pairs == 3
    # Metro-only, zero spread: TFI = pairs × wait exactly.
    assert kafd.transfer_friction_index == pytest.approx(3 * kafd.expected_transfer_wait_min)
    assert max(t.hub_score for t in nodes.values()) == 100


def test_catchments_grow_with_radius(sample_result):
    c500, c1000 = sample_result.report.catchments
    assert c500.radius_m == 500 and c1000.radius_m == 1000
    assert c1000.area_km2 > c500.area_km2 > 0
    assert c500.rapid_transit_area_km2 <= c500.area_km2
    geo = json.loads(sample_result.catchments_geojson())
    assert len(geo["features"]) == 2


def test_report_json_roundtrip(sample_result):
    from transit_scope.gtfs import NetworkReport

    text = sample_result.report.model_dump_json()
    assert NetworkReport.model_validate_json(text).summary.routes == 9


def test_service_date_selects_weekend(sample_gtfs):
    feed = load_feed(sample_gtfs)
    fri = analyze_feed(feed, AnalysisConfig(service_date="20260925")).report
    assert "friday" in fri.summary.service_day
    sun = analyze_feed(feed).report
    assert fri.summary.trips_per_day < sun.summary.trips_per_day


# --------------------------------------------------------------------------- #
# Edge-case feed
# --------------------------------------------------------------------------- #


def test_edge_feed(edge_feed_zip):
    feed = load_feed(edge_feed_zip)
    assert feed.calendar is None and feed.shapes is None
    report = analyze_feed(feed).report
    s = report.summary
    assert s.service_day == "busiest date (20260104)"  # OTHER service excluded
    routes = {r.route_id: r for r in report.routes}
    # frequencies: 12 departures 07–09 @10 min + 3 departures 09–10 @20 min
    assert routes["F"].trips_per_day == 15
    assert routes["F"].peak_headway_min == pytest.approx(10.0)
    assert routes["F"].offpeak_headway_min == pytest.approx(20.0)
    assert routes["F"].color == "#0072CE"  # invalid colour → mode palette
    # S2 runs past midnight (25:10) and is still counted
    assert routes["S"].trips_per_day == 2
    assert routes["S"].last_departure == "25:10"
    # parent station groups platforms A and B (~250 m apart) into one node
    central = next(n for n in report.stations if "A" in n.stop_ids)
    assert set(central.stop_ids) == {"A", "B"}
    assert central.name.startswith("Central")


def test_missing_required_table(write_feed):
    folder = write_feed({"routes.txt": None})
    with pytest.raises(GTFSValidationError, match="routes.txt"):
        load_feed(folder)


def test_missing_required_column(write_feed):
    folder = write_feed({"trips.txt": "route_id,trip_id\nF,F1\n"})
    with pytest.raises(GTFSValidationError, match="service_id"):
        load_feed(folder)


def test_invalid_coordinates(write_feed):
    folder = write_feed({"stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nA,X,124.0,46.0\n"})
    with pytest.raises(GTFSValidationError, match="stop_lat"):
        load_feed(folder)


def test_missing_file():
    with pytest.raises(InputFileError):
        load_feed("does/not/exist.zip")


def test_orphan_rows_warn(write_feed):
    extra = "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
    extra += "F1,07:00:00,07:00:00,A,1\nF1,07:05:00,07:05:00,C,2\nGHOST,07:00:00,07:00:00,A,1\n"
    feed = load_feed(write_feed({"stop_times.txt": extra}))
    assert any("unknown trips" in w for w in feed.warnings)


def test_geographic_crs_rejected(edge_feed_zip):
    with pytest.raises(GTFSValidationError, match="geographic"):
        analyze_feed(load_feed(edge_feed_zip), AnalysisConfig(metric_crs="EPSG:4326"))


# --------------------------------------------------------------------------- #
# Units
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("code", "mode"),
    [(1, "metro"), (3, "bus"), (0, "tram"), (2, "rail"), (401, "metro"), (700, "bus"),
     (109, "rail"), (900, "tram"), (1500, "other")],
)
def test_mode_mapping(code, mode):
    assert mode_from_route_type(code) == mode


def test_time_helpers():
    assert parse_hhmm("07:30") == 27000
    assert parse_hhmm("25:00:00") == 90000
    assert format_seconds(90000) == "25:00"
    with pytest.raises(ValueError):
        parse_hhmm("7h30")
    with pytest.raises(ValueError):
        TimeWindow.parse("09:00-07:00")


def test_overlapping_peaks_rejected():
    with pytest.raises(ValueError, match="overlap"):
        AnalysisConfig(peak_windows=[TimeWindow.parse("07:00-09:00"),
                                     TimeWindow.parse("08:00-10:00")])


def test_natural_key():
    assert sorted(["150", "7", "M10", "M2"], key=natural_key) == ["7", "150", "M2", "M10"]
