"""Shared fixtures: bundled sample paths and a tiny hand-built edge-case feed."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from transit_scope.paths import sample_districts_path, sample_gtfs_path


@pytest.fixture(scope="session")
def sample_gtfs() -> Path:
    return sample_gtfs_path()


@pytest.fixture(scope="session")
def sample_districts() -> Path:
    return sample_districts_path()


@pytest.fixture(scope="session")
def sample_result(sample_gtfs):
    from transit_scope.gtfs import analyze_feed, load_feed

    return analyze_feed(load_feed(sample_gtfs))


# A minimal feed exercising the less common GTFS paths:
#  * frequencies.txt template trips (route F, 10-min headway 07:00–09:00)
#  * no shapes.txt (geometry from stop patterns)
#  * calendar_dates.txt only (no calendar.txt)
#  * parent_station grouping (P1 platforms A/B → one node, ~250 m apart)
#  * blank times at a non-timepoint stop
#  * a nested folder inside the zip and a BOM on stops.txt
EDGE_FILES = {
    "stops.txt": "﻿stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
    "P1,Central,24.7000,46.7000,1,\n"
    "A,Central Platform A,24.7000,46.7000,0,P1\n"
    "B,Central Platform B,24.7000,46.7025,0,P1\n"
    "C,North,24.7200,46.7000,0,\n"
    "D,Far East,24.7000,46.7400,0,\n",
    "routes.txt": "route_id,route_short_name,route_long_name,route_type,route_color\n"
    "F,F,Frequency line,1,zz12\n"
    "S,S,Scheduled bus,3,\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id\n"
    "F,SVC,F1,0\n"
    "S,SVC,S1,0\n"
    "S,SVC,S2,0\n"
    "S,OTHER,S3,0\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
    "F1,07:00:00,07:00:00,A,1\n"
    "F1,07:05:00,07:05:00,C,2\n"
    "S1,08:00:00,08:00:00,B,1\n"
    "S1,,,C,2\n"
    "S1,08:20:00,08:20:00,D,3\n"
    "S2,25:10:00,25:10:00,B,1\n"
    "S2,25:30:00,25:30:00,D,2\n"
    "S3,09:00:00,09:00:00,B,1\n"
    "S3,09:20:00,09:20:00,D,2\n",
    "frequencies.txt": "trip_id,start_time,end_time,headway_secs\n"
    "F1,07:00:00,09:00:00,600\n"
    "F1,09:00:00,10:00:00,1200\n",
    "calendar_dates.txt": "service_id,date,exception_type\n"
    "SVC,20260104,1\n"
    "OTHER,20260105,1\n",
}


@pytest.fixture()
def edge_feed_zip(tmp_path: Path) -> Path:
    path = tmp_path / "edge.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for name, text in EDGE_FILES.items():
            archive.writestr(f"feed/{name}", text)
    return path


@pytest.fixture()
def write_feed(tmp_path: Path):
    """Write a feed directory from ``{filename: text}`` overrides of EDGE_FILES."""

    def _write(overrides: dict[str, str | None]) -> Path:
        folder = tmp_path / "feed_dir"
        folder.mkdir(exist_ok=True)
        files = {**EDGE_FILES, **overrides}
        for name, text in files.items():
            if text is not None:
                (folder / name).write_text(text, encoding="utf-8")
        return folder

    return _write
