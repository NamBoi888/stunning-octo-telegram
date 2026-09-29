"""Official / published reference figures for the Riyadh network (validated schema)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field, model_validator

from transit_scope.errors import InputFileError
from transit_scope.paths import DATA_DIR

REFERENCE_PATH = DATA_DIR / "riyadh_reference.json"


class Source(BaseModel):
    title: str
    url: str


class LineReference(BaseModel):
    ref: str
    name: str
    name_ar: str
    osm_relations: list[int] = Field(min_length=1)
    termini: tuple[str, str]
    length_km: float = Field(gt=0)
    measured_km_urbanrail: float | None = None
    stations: int = Field(gt=1)
    opened: str
    station_list: list[str]

    @model_validator(mode="after")
    def _consistent(self) -> LineReference:
        if len(self.station_list) != self.stations:
            raise ValueError(
                f"Line {self.ref}: station_list has {len(self.station_list)} entries, "
                f"official count is {self.stations}"
            )
        if (self.station_list[0], self.station_list[-1]) != tuple(self.termini):
            raise ValueError(f"Line {self.ref}: station_list ends do not match termini")
        return self


class Headway(BaseModel):
    peak: float = Field(gt=0)
    offpeak: float = Field(gt=0)


class CalendarPlan(BaseModel):
    days: list[str]
    start: str
    end: str


class ServicePlan(BaseModel):
    assumption: bool
    note: str
    calendars: dict[str, CalendarPlan]
    peak_windows: list[str]
    headways_min: dict[str, Headway]
    friday_headway_min: float
    running_speed_kmh: float = Field(gt=10, lt=120)
    dwell_s: float = Field(ge=0, le=120)


class SystemReference(BaseModel):
    total_length_km: float
    stations: int
    headway_min_range: tuple[float, float]
    fleet_cars: int
    source: str


class BusReference(BaseModel):
    routes: int
    stops: int
    buses: int
    source: str


class RiyadhReference(BaseModel):
    schema_version: int
    accessed: str
    sources: dict[str, Source]
    system: SystemReference
    bus: BusReference
    lines: list[LineReference] = Field(min_length=1)
    interchanges: dict[str, list[str]]
    service_plan: ServicePlan

    @model_validator(mode="after")
    def _cross_checks(self) -> RiyadhReference:
        refs = {line.ref for line in self.lines}
        for name, lines in self.interchanges.items():
            if not set(lines) <= refs:
                raise ValueError(f"interchange {name} references unknown lines {lines}")
            for ref in lines:
                line = self.line(ref)
                if name not in line.station_list:
                    raise ValueError(f"interchange {name} not in line {ref} station list")
        if set(self.service_plan.headways_min) != refs:
            raise ValueError("service plan must define headways for every line")
        return self

    def line(self, ref: str) -> LineReference:
        for line in self.lines:
            if line.ref == ref:
                return line
        raise KeyError(ref)


@lru_cache(maxsize=4)
def load_reference(path: str | None = None) -> RiyadhReference:
    file = Path(path) if path else REFERENCE_PATH
    if not file.exists():
        raise InputFileError(f"Reference file missing: {file}")
    return RiyadhReference.model_validate(json.loads(file.read_text(encoding="utf-8")))
