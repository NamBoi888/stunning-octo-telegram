"""GTFS feed ingestion and structural validation.

Accepts either a ``.zip`` archive (files may be nested in a sub-folder, as
many agencies publish them) or an extracted directory.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
from pydantic import TypeAdapter, ValidationError

from transit_scope.errors import GTFSValidationError, InputFileError
from transit_scope.gtfs.models import RouteRecord, StopRecord
from transit_scope.utils.timeutil import gtfs_time_series_to_seconds

REQUIRED_TABLES: dict[str, list[str]] = {
    "stops": ["stop_id", "stop_lat", "stop_lon"],
    "routes": ["route_id", "route_type"],
    "trips": ["route_id", "service_id", "trip_id"],
    "stop_times": ["trip_id", "stop_id", "stop_sequence"],
}
OPTIONAL_TABLES: list[str] = [
    "agency", "shapes", "calendar", "calendar_dates", "frequencies", "feed_info",
]

_MAX_REPORTED_ERRORS = 5


@dataclass
class GTFSFeed:
    """In-memory, validated GTFS tables (pandas DataFrames)."""

    source: Path
    stops: pd.DataFrame
    routes: pd.DataFrame
    trips: pd.DataFrame
    stop_times: pd.DataFrame
    agency: pd.DataFrame | None = None
    shapes: pd.DataFrame | None = None
    calendar: pd.DataFrame | None = None
    calendar_dates: pd.DataFrame | None = None
    frequencies: pd.DataFrame | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def agency_name(self) -> str:
        if self.agency is not None and "agency_name" in self.agency and len(self.agency):
            return " / ".join(self.agency["agency_name"].dropna().astype(str).unique())
        return "Unknown agency"


# --------------------------------------------------------------------------- #
# Raw file access
# --------------------------------------------------------------------------- #


def _read_csv(buffer: io.BytesIO | Path, name: str) -> pd.DataFrame:
    try:
        return pd.read_csv(
            buffer, dtype=str, keep_default_na=False, na_values=[""], encoding="utf-8-sig"
        )
    except pd.errors.EmptyDataError:
        return pd.DataFrame()
    except (pd.errors.ParserError, UnicodeDecodeError) as exc:
        raise GTFSValidationError(f"{name}.txt could not be parsed: {exc}") from exc


def _read_raw_tables(path: Path) -> dict[str, pd.DataFrame]:
    wanted = set(REQUIRED_TABLES) | set(OPTIONAL_TABLES)
    tables: dict[str, pd.DataFrame] = {}
    if path.is_dir():
        for name in wanted:
            file = path / f"{name}.txt"
            if file.exists():
                tables[name] = _read_csv(file, name)
        return tables

    if not zipfile.is_zipfile(path):
        raise InputFileError(f"{path} is not a GTFS .zip archive or directory.")
    with zipfile.ZipFile(path) as archive:
        for member in archive.namelist():
            stem = Path(member).name
            if not stem.endswith(".txt") or stem.startswith("."):
                continue
            name = stem[:-4]
            if name in wanted and name not in tables:
                tables[name] = _read_csv(io.BytesIO(archive.read(member)), name)
    return tables


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def _check_required(tables: dict[str, pd.DataFrame]) -> None:
    missing = [f"{t}.txt" for t in REQUIRED_TABLES if t not in tables or tables[t].empty]
    if missing:
        raise GTFSValidationError(f"Feed is missing required tables: {', '.join(missing)}")
    for table, columns in REQUIRED_TABLES.items():
        absent = [c for c in columns if c not in tables[table].columns]
        if absent:
            raise GTFSValidationError(f"{table}.txt is missing columns: {', '.join(absent)}")


def _format_errors(table: str, exc: ValidationError) -> str:
    lines = []
    for err in exc.errors()[:_MAX_REPORTED_ERRORS]:
        loc = err["loc"]
        row = loc[0] if loc else "?"
        col = loc[1] if len(loc) > 1 else ""
        lines.append(f"  row {row} {col}: {err['msg']}")
    extra = exc.error_count() - _MAX_REPORTED_ERRORS
    if extra > 0:
        lines.append(f"  … and {extra} more")
    return f"{table}.txt failed validation:\n" + "\n".join(lines)


def _validate_stops(stops: pd.DataFrame, warnings: list[str]) -> pd.DataFrame:
    stops = stops.copy()
    stops["stop_name"] = (
        stops["stop_name"].fillna("") if "stop_name" in stops else stops["stop_id"]
    )
    if "location_type" in stops:
        stops["location_type"] = pd.to_numeric(stops["location_type"], errors="coerce").fillna(0)
    # Generic nodes / boarding areas (location_type 3/4) may legitimately lack
    # coordinates; they are not needed for network analysis.
    lacking = stops["stop_lat"].isna() | stops["stop_lon"].isna()
    if lacking.any():
        warnings.append(f"Dropped {int(lacking.sum())} stops without coordinates.")
        stops = stops[~lacking]

    adapter = TypeAdapter(list[StopRecord])
    try:
        records = adapter.validate_python(stops.to_dict(orient="records"))
    except ValidationError as exc:
        raise GTFSValidationError(_format_errors("stops", exc)) from exc

    validated = pd.DataFrame([r.model_dump() for r in records])
    extra_cols = [c for c in stops.columns if c not in validated.columns]
    validated = pd.concat(
        [validated, stops[extra_cols].reset_index(drop=True)], axis=1
    )
    if validated["stop_id"].duplicated().any():
        raise GTFSValidationError("stops.txt contains duplicate stop_id values.")
    return validated


def _validate_routes(routes: pd.DataFrame) -> pd.DataFrame:
    routes = routes.copy()
    for col in ("route_short_name", "route_long_name"):
        routes[col] = routes[col].fillna("") if col in routes else ""
    adapter = TypeAdapter(list[RouteRecord])
    try:
        records = adapter.validate_python(routes.to_dict(orient="records"))
    except ValidationError as exc:
        raise GTFSValidationError(_format_errors("routes", exc)) from exc
    frame = pd.DataFrame([r.model_dump() for r in records])
    frame["mode"] = [r.mode for r in records]
    frame["display_name"] = [r.display_name for r in records]
    if frame["route_id"].duplicated().any():
        raise GTFSValidationError("routes.txt contains duplicate route_id values.")
    return frame


def _prepare_trips(trips: pd.DataFrame, routes: pd.DataFrame, warnings: list[str]) -> pd.DataFrame:
    trips = trips.copy()
    if trips["trip_id"].duplicated().any():
        raise GTFSValidationError("trips.txt contains duplicate trip_id values.")
    unknown = ~trips["route_id"].isin(routes["route_id"])
    if unknown.any():
        warnings.append(f"Ignored {int(unknown.sum())} trips referencing unknown routes.")
        trips = trips[~unknown]
    if "direction_id" not in trips:
        trips["direction_id"] = "0"
    trips["direction_id"] = trips["direction_id"].fillna("0").astype(str)
    if "shape_id" not in trips:
        trips["shape_id"] = pd.NA
    return trips.reset_index(drop=True)


def _prepare_stop_times(
    stop_times: pd.DataFrame, trips: pd.DataFrame, stops: pd.DataFrame, warnings: list[str]
) -> pd.DataFrame:
    st = stop_times.copy()
    st["stop_sequence"] = pd.to_numeric(st["stop_sequence"], errors="coerce")
    if st["stop_sequence"].isna().any():
        raise GTFSValidationError("stop_times.txt has non-numeric stop_sequence values.")

    arr = st["arrival_time"] if "arrival_time" in st else pd.Series(pd.NA, index=st.index)
    dep = st["departure_time"] if "departure_time" in st else pd.Series(pd.NA, index=st.index)
    arr_s = gtfs_time_series_to_seconds(arr)
    dep_s = gtfs_time_series_to_seconds(dep)
    st["arr_s"] = arr_s.fillna(dep_s)
    st["dep_s"] = dep_s.fillna(arr_s)

    orphan = ~st["trip_id"].isin(trips["trip_id"]) | ~st["stop_id"].isin(stops["stop_id"])
    if orphan.any():
        warnings.append(
            f"Ignored {int(orphan.sum())} stop_times rows referencing unknown trips/stops."
        )
        st = st[~orphan]

    st = st.sort_values(["trip_id", "stop_sequence"], kind="stable").reset_index(drop=True)
    # Non-timepoint stops may lack times; carry the last known time forward
    # within each trip (adequate for window-based frequency counting).
    missing = st["dep_s"].isna()
    if missing.any():
        grouped = st.groupby("trip_id", sort=False)
        st["dep_s"] = grouped["dep_s"].ffill()
        st["arr_s"] = grouped["arr_s"].ffill()
        still_missing = st["dep_s"].isna()
        if still_missing.any():
            bad = st.loc[still_missing, "trip_id"].nunique()
            warnings.append(f"Dropped {bad} trips whose first stop has no time.")
            bad_trips = st.loc[still_missing, "trip_id"].unique()
            st = st[~st["trip_id"].isin(bad_trips)].reset_index(drop=True)
    if st.empty:
        raise GTFSValidationError("stop_times.txt contains no usable rows.")
    return st[["trip_id", "stop_id", "stop_sequence", "arr_s", "dep_s"]]


def _prepare_shapes(shapes: pd.DataFrame | None, warnings: list[str]) -> pd.DataFrame | None:
    if shapes is None or shapes.empty:
        return None
    needed = {"shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"}
    if not needed.issubset(shapes.columns):
        warnings.append("shapes.txt is missing columns; falling back to stop geometry.")
        return None
    shapes = shapes.copy()
    for col in ("shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"):
        shapes[col] = pd.to_numeric(shapes[col], errors="coerce")
    bad = shapes[["shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]].isna().any(axis=1)
    if bad.any():
        warnings.append(f"Dropped {int(bad.sum())} malformed shape points.")
        shapes = shapes[~bad]
    return shapes.sort_values(["shape_id", "shape_pt_sequence"]).reset_index(drop=True)


def _prepare_frequencies(freq: pd.DataFrame | None) -> pd.DataFrame | None:
    if freq is None or freq.empty:
        return None
    needed = {"trip_id", "start_time", "end_time", "headway_secs"}
    if not needed.issubset(freq.columns):
        raise GTFSValidationError(f"frequencies.txt must contain {sorted(needed)}")
    freq = freq.copy()
    freq["start_s"] = gtfs_time_series_to_seconds(freq["start_time"])
    freq["end_s"] = gtfs_time_series_to_seconds(freq["end_time"])
    freq["headway_secs"] = pd.to_numeric(freq["headway_secs"], errors="coerce")
    freq = freq.dropna(subset=["start_s", "end_s", "headway_secs"])
    return freq[freq["headway_secs"] > 0]


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def load_feed(path: str | Path) -> GTFSFeed:
    """Load and validate a GTFS feed from a ``.zip`` or directory.

    Raises:
        InputFileError: the path does not exist or is not a GTFS container.
        GTFSValidationError: required tables/columns are missing or invalid.
    """
    path = Path(path).expanduser()
    if not path.exists():
        raise InputFileError(f"GTFS feed not found: {path}")

    tables = _read_raw_tables(path)
    _check_required(tables)
    warnings: list[str] = []

    stops = _validate_stops(tables["stops"], warnings)
    routes = _validate_routes(tables["routes"])
    trips = _prepare_trips(tables["trips"], routes, warnings)
    stop_times = _prepare_stop_times(tables["stop_times"], trips, stops, warnings)

    return GTFSFeed(
        source=path,
        stops=stops,
        routes=routes,
        trips=trips,
        stop_times=stop_times,
        agency=tables.get("agency"),
        shapes=_prepare_shapes(tables.get("shapes"), warnings),
        calendar=tables.get("calendar"),
        calendar_dates=tables.get("calendar_dates"),
        frequencies=_prepare_frequencies(tables.get("frequencies")),
        warnings=warnings,
    )
