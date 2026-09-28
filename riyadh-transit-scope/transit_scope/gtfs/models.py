"""Pydantic schemas for GTFS input validation, analysis config and report output."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from transit_scope.utils.timeutil import format_seconds, parse_hhmm

Mode = Literal["metro", "rail", "tram", "bus", "ferry", "cable", "other"]

#: Modes treated as rapid transit (grade-separated / heavy rail).
RAPID_MODES: frozenset[str] = frozenset({"metro", "rail"})


def mode_from_route_type(route_type: int) -> Mode:
    """Map a GTFS ``route_type`` (basic or extended HVT codes) to a coarse mode."""
    basic: dict[int, Mode] = {
        0: "tram", 1: "metro", 2: "rail", 3: "bus", 4: "ferry",
        5: "cable", 6: "cable", 7: "cable", 11: "bus", 12: "metro",
    }
    if route_type in basic:
        return basic[route_type]
    families: list[tuple[range, Mode]] = [
        (range(100, 200), "rail"),
        (range(200, 300), "bus"),
        (range(400, 500), "metro"),
        (range(700, 900), "bus"),
        (range(900, 1000), "tram"),
        (range(1000, 1300), "ferry"),
        (range(1300, 1500), "cable"),
    ]
    for codes, mode in families:
        if route_type in codes:
            return mode
    return "other"


# --------------------------------------------------------------------------- #
# Input validation records
# --------------------------------------------------------------------------- #


class StopRecord(BaseModel):
    """A single row of ``stops.txt`` (only the fields the engine relies on)."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    stop_id: str = Field(min_length=1)
    stop_name: str = ""
    stop_lat: float = Field(ge=-90, le=90)
    stop_lon: float = Field(ge=-180, le=180)
    location_type: int = Field(default=0, ge=0, le=4)
    parent_station: str | None = None

    @field_validator("parent_station", mode="before")
    @classmethod
    def _blank_to_none(cls, value: object) -> object:
        if value is None or (isinstance(value, float) and value != value):  # NaN
            return None
        return value or None

    @model_validator(mode="after")
    def _null_island(self) -> StopRecord:
        if self.stop_lat == 0 and self.stop_lon == 0:
            raise ValueError("coordinates are (0, 0) — likely a missing location")
        return self


class RouteRecord(BaseModel):
    """A single row of ``routes.txt``."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    route_id: str = Field(min_length=1)
    route_short_name: str = ""
    route_long_name: str = ""
    route_type: int = Field(ge=0)
    route_color: str | None = None

    @field_validator("route_color", mode="before")
    @classmethod
    def _normalise_color(cls, value: object) -> str | None:
        if not isinstance(value, str) or not value.strip():
            return None
        value = value.strip().lstrip("#")
        if len(value) != 6 or any(c not in "0123456789abcdefABCDEF" for c in value):
            return None  # invalid colours fall back to the mode palette
        return f"#{value.upper()}"

    @property
    def mode(self) -> Mode:
        return mode_from_route_type(self.route_type)

    @property
    def display_name(self) -> str:
        return self.route_short_name or self.route_long_name or self.route_id


# --------------------------------------------------------------------------- #
# Analysis configuration
# --------------------------------------------------------------------------- #


class TimeWindow(BaseModel):
    """A service-day time window in seconds after midnight."""

    label: str
    start_s: int = Field(ge=0)
    end_s: int = Field(gt=0)

    @model_validator(mode="after")
    def _ordered(self) -> TimeWindow:
        if self.end_s <= self.start_s:
            raise ValueError(f"window {self.label!r} must end after it starts")
        return self

    @property
    def minutes(self) -> float:
        return (self.end_s - self.start_s) / 60.0

    @classmethod
    def parse(cls, text: str, label: str | None = None) -> TimeWindow:
        """Parse ``"07:00-09:00"``."""
        try:
            start, end = (part.strip() for part in text.split("-", 1))
        except ValueError as exc:
            raise ValueError(f"Invalid window {text!r}; expected HH:MM-HH:MM") from exc
        return cls(label=label or text, start_s=parse_hhmm(start), end_s=parse_hhmm(end))

    def __str__(self) -> str:
        return f"{format_seconds(self.start_s)}–{format_seconds(self.end_s)}"


def _default_peaks() -> list[TimeWindow]:
    return [
        TimeWindow(label="AM peak", start_s=7 * 3600, end_s=9 * 3600),
        TimeWindow(label="PM peak", start_s=16 * 3600, end_s=19 * 3600),
    ]


class AnalysisConfig(BaseModel):
    """Tunable parameters for :func:`transit_scope.gtfs.kpis.analyze_feed`."""

    peak_windows: list[TimeWindow] = Field(default_factory=_default_peaks)
    catchment_radii_m: list[float] = Field(default_factory=lambda: [500.0, 1000.0])
    metric_crs: str | None = Field(
        default=None, description="Projected CRS; auto-selects UTM (EPSG:32638 for Riyadh)."
    )
    transfer_cluster_radius_m: float = Field(default=150.0, gt=0, le=1000)
    service_date: str | None = Field(default=None, pattern=r"^\d{8}$")
    top_n: int = Field(default=10, ge=1)

    @field_validator("catchment_radii_m")
    @classmethod
    def _positive_radii(cls, radii: list[float]) -> list[float]:
        if not radii or any(r <= 0 or r > 5000 for r in radii):
            raise ValueError("catchment radii must be in (0, 5000] metres")
        return sorted(set(radii))

    @model_validator(mode="after")
    def _non_overlapping_peaks(self) -> AnalysisConfig:
        windows = sorted(self.peak_windows, key=lambda w: w.start_s)
        for a, b in zip(windows, windows[1:], strict=False):
            if b.start_s < a.end_s:
                raise ValueError(f"peak windows {a} and {b} overlap")
        self.peak_windows = windows
        return self


# --------------------------------------------------------------------------- #
# Report output
# --------------------------------------------------------------------------- #


class RouteKPI(BaseModel):
    route_id: str
    name: str
    long_name: str
    mode: Mode
    color: str
    directions: int
    stops: int
    length_km: float = Field(description="Mean one-way representative alignment length.")
    trips_per_day: int
    vehicle_km_per_day: float
    peak_trips_per_hour: float
    peak_headway_min: float | None
    offpeak_headway_min: float | None
    first_departure: str
    last_departure: str
    avg_speed_kmh: float | None


class StationKPI(BaseModel):
    node_id: str
    name: str
    lat: float
    lon: float
    stop_ids: list[str]
    modes: list[Mode]
    routes: list[str]
    departures_per_day: int
    peak_departures: int
    peak_headway_min: float | None


class TransferNode(BaseModel):
    node_id: str
    name: str
    routes_served: int
    modes: list[Mode]
    transfer_pairs: int
    expected_transfer_wait_min: float
    intra_node_spread_m: float
    transfer_friction_index: float = Field(
        description="pairs × expected wait × walk penalty; higher = more transfer burden."
    )
    hub_score: float = Field(ge=0, le=100, description="Normalised 0–100 relative hub importance.")


class CatchmentKPI(BaseModel):
    radius_m: float
    area_km2: float
    rapid_transit_area_km2: float
    nodes: int


class NetworkSummary(BaseModel):
    agency: str
    service_day: str
    metric_crs: str
    routes: int
    routes_by_mode: dict[str, int]
    stops: int
    station_nodes: int
    trips_per_day: int
    route_km_total: float
    route_km_by_mode: dict[str, float]
    vehicle_km_per_day: float
    mean_peak_headway_min: float | None
    mean_offpeak_headway_min: float | None
    transfer_nodes: int
    bbox_wgs84: tuple[float, float, float, float]


class NetworkReport(BaseModel):
    generated_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(timespec="seconds")
    )
    source: str
    config: AnalysisConfig
    summary: NetworkSummary
    routes: list[RouteKPI]
    stations: list[StationKPI]
    transfer_nodes: list[TransferNode]
    catchments: list[CatchmentKPI]
    warnings: list[str] = Field(default_factory=list)
