"""Pydantic schemas for city benchmark profiles and derived metrics."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ModeStats(BaseModel):
    """Supply statistics for one mode family in a city."""

    model_config = ConfigDict(extra="forbid")

    route_km: float = Field(ge=0, description="One-way route kilometres.")
    lines: int = Field(ge=0)
    fleet_vehicles: int = Field(ge=0, description="Revenue vehicles (rail cars / buses).")
    peak_headway_min: float = Field(gt=0, le=120)


class CityProfile(BaseModel):
    """Raw, pre-configured comparative inputs for one city."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=r"^[a-z0-9_-]+$")
    name: str
    country: str
    aliases: list[str] = Field(default_factory=list)
    data_year: int = Field(ge=1990, le=2100)
    population_m: float = Field(gt=0)
    urban_extent_km2: float = Field(gt=0)
    network_coverage_km2: float = Field(ge=0)
    coverage_definition: str = ""
    rapid_transit: ModeStats
    light_rail: ModeStats | None = None
    bus: ModeStats
    transit_modal_split_pct: float = Field(ge=0, le=100)
    currency: str = Field(min_length=3, max_length=3)
    monthly_pass_local: float = Field(ge=0)
    monthly_pass_usd: float = Field(ge=0)
    median_monthly_household_income_usd: float = Field(gt=0)
    sources: list[str] = Field(default_factory=list)
    notes: str = ""

    @model_validator(mode="after")
    def _coverage_within_extent(self) -> CityProfile:
        if self.network_coverage_km2 > self.urban_extent_km2 * 1.5:
            raise ValueError(
                f"{self.name}: network coverage ({self.network_coverage_km2} km²) is implausibly "
                f"larger than the urban extent ({self.urban_extent_km2} km²)"
            )
        return self

    def modes(self) -> list[tuple[str, ModeStats]]:
        out = [("rapid_transit", self.rapid_transit)]
        if self.light_rail:
            out.append(("light_rail", self.light_rail))
        out.append(("bus", self.bus))
        return out


class BenchmarkDataset(BaseModel):
    schema_version: int = 1
    disclaimer: str = ""
    cities: list[CityProfile]

    @model_validator(mode="after")
    def _unique_keys(self) -> BenchmarkDataset:
        keys = [c.key for c in self.cities]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate city keys in benchmark dataset")
        return self


class CityMetrics(BaseModel):
    """Derived, directly comparable indicators."""

    key: str
    name: str
    data_year: int
    urban_extent_km2: float
    network_coverage_km2: float
    coverage_ratio_pct: float = Field(description="Coverage area ÷ urban extent × 100.")
    total_route_km: float
    route_density_km_per_km2: float = Field(description="Total route-km ÷ urban extent.")
    rapid_route_km: float
    rapid_share_of_route_km_pct: float
    mean_peak_headway_min: float = Field(description="Route-km-weighted across modes.")
    rapid_to_bus_fleet_ratio: float
    transit_modal_split_pct: float
    fare_burden_pct: float = Field(description="Monthly pass ÷ median monthly household income.")
    fare_accessibility_index: float = Field(
        ge=0, le=100, description="100 × (1 − burden / 10%), clamped to 0–100."
    )
    route_km_per_100k_pop: float
