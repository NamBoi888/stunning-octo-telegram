"""Heat-penalised first/last-mile corridor walkability model.

This is a transparent, screening-level model intended for comparing corridor
design scenarios (e.g. "what shade coverage keeps a station's 800 m
catchment usable in August?"). It is **not** a substitute for a full
biometeorological simulation (UTCI/PET with ENVI-met, SOLWEIG, etc.).

Model chain for each corridor segment type (shaded / unshaded)
---------------------------------------------------------------
1. **Mean radiant temperature** ::

       ΔTmrt_sun   = k_rad × G/1000                       (k_rad = 26 °C)
       ΔTmrt_shade = ΔTmrt_sun × (1 − 0.85 × q_shade)
       Ta_shade    = Ta − evap_cooling(shade type)

2. **Corridor Thermal Index (CTI, °C)** — a UTCI-like "feels-like" proxy ::

       CTI = Ta + 0.30 × ΔTmrt + 0.04 × max(0, RH − 40) − wind_relief

   Wind relief falls to a small residual above 35 °C, where air is hotter
   than skin and convection stops cooling.

3. **Walking speed** — pedestrians slow down under heat stress ::

       f_speed = clamp(1 − 0.008 × max(0, CTI − 32), 0.60, 1.00)

4. **Perceived-distance penalty** (applies only when Ta > 40 °C) ::

       unshaded: p_u = 1 + (Ta − 40) × (β × G/1000 + γ × D_u/1000)
       shaded:   p_s = 1 + 0.03 × (Ta − 40)

   (β = 0.12 /°C, γ = 0.04 /°C/km). The γ term captures cumulative
   exposure: long unbroken sunny stretches feel disproportionately worse.
   Both penalties are continuous at the 40 °C threshold.

Outputs
-------
* nominal walk time      ``t0 = D / v0``
* heat-adjusted time     ``Σ D_i / (v0 × f_i)``  (physical slowdown only)
* perceived time         ``Σ D_i × p_i / (v0 × f_i)``
* **EWCS** (Effective Walkable Catchment Score) ``= 100 × t0 / t_perceived``
* effective catchment radius ``r_eff = D × t0 / t_perceived`` and the
  resulting catchment area loss ``1 − (r_eff / D)²``
* heat exposure dose ``Σ max(0, CTI_i − 32) × t_i`` (°C·min)
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class ShadeType(StrEnum):
    """Shade provision type; affects radiant load and evaporative cooling."""

    mixed = "mixed"
    trees = "trees"
    arcade = "arcade"
    sail = "sail"


#: (radiation blocking quality q, evaporative air cooling °C)
SHADE_PROPERTIES: dict[ShadeType, tuple[float, float]] = {
    ShadeType.trees: (1.00, 1.0),
    ShadeType.arcade: (0.95, 0.3),
    ShadeType.mixed: (0.90, 0.5),
    ShadeType.sail: (0.80, 0.0),
}


class ModelParameters(BaseModel):
    """Calibration constants (exposed so researchers can run sensitivity tests)."""

    radiant_gain_c_per_kw: float = Field(default=26.0, gt=0)
    radiant_weight: float = Field(default=0.30, ge=0, le=1)
    comfort_threshold_c: float = Field(default=32.0)
    speed_decay_per_c: float = Field(default=0.008, ge=0)
    min_speed_factor: float = Field(default=0.60, gt=0, le=1)
    penalty_threshold_c: float = Field(default=40.0)
    unshaded_penalty_per_c: float = Field(default=0.12, ge=0)
    shaded_penalty_per_c: float = Field(default=0.03, ge=0)
    exposure_amplification_per_c_km: float = Field(default=0.04, ge=0)


class CorridorInput(BaseModel):
    """Validated scenario inputs for one access corridor."""

    distance_m: float = Field(gt=0, le=5000, description="Corridor length (m).")
    shade_pct: float = Field(ge=0, le=100, description="Shaded share of the corridor (%).")
    temp_c: float = Field(ge=-10, le=60, description="Ambient air temperature (°C).")
    solar_wm2: float = Field(default=950, ge=0, le=1400, description="Global irradiance W/m².")
    humidity_pct: float = Field(default=15, ge=0, le=100)
    wind_ms: float = Field(default=1.5, ge=0, le=20)
    walk_speed_ms: float = Field(default=1.34, gt=0.3, le=2.5)
    shade_type: ShadeType = ShadeType.mixed

    @property
    def solar_index(self) -> float:
        """Normalised solar radiation index (1.0 ≈ 1000 W/m², clear midday sun)."""
        return self.solar_wm2 / 1000.0


class SegmentResult(BaseModel):
    kind: str
    distance_m: float
    mrt_c: float = Field(description="Mean radiant temperature (°C).")
    thermal_index_c: float = Field(description="Corridor Thermal Index (°C).")
    stress_category: str
    speed_factor: float
    distance_penalty: float
    walk_time_min: float
    perceived_time_min: float


class CorridorResult(BaseModel):
    inputs: CorridorInput
    segments: list[SegmentResult]
    nominal_walk_time_min: float
    heat_adjusted_walk_time_min: float
    perceived_walk_time_min: float
    extra_time_min: float
    perceived_distance_m: float
    ewcs: float = Field(ge=0, le=100, description="Effective Walkable Catchment Score.")
    rating: str
    comfort_loss_pct: float
    effective_catchment_radius_m: float
    catchment_area_loss_pct: float
    heat_exposure_dose: float = Field(description="°C·min above the comfort threshold.")
    penalty_active: bool
    shade_needed_for_target_pct: float | None = None
    target_ewcs: float | None = None


# --------------------------------------------------------------------------- #


def stress_category(cti: float) -> str:
    """UTCI-style heat stress band for a Corridor Thermal Index value."""
    bands = [
        (46, "extreme heat stress"),
        (38, "very strong heat stress"),
        (32, "strong heat stress"),
        (26, "moderate heat stress"),
        (9, "no thermal stress"),
    ]
    for threshold, label in bands:
        if cti > threshold:
            return label
    return "cold stress"


def rating_for(ewcs: float) -> str:
    """Letter grade for an EWCS score."""
    for threshold, grade in ((90, "A"), (80, "B"), (70, "C"), (60, "D"), (50, "E")):
        if ewcs >= threshold:
            return grade
    return "F"


def _segment(
    kind: str, distance: float, inp: CorridorInput, params: ModelParameters, unshaded_m: float
) -> SegmentResult:
    q, evap = SHADE_PROPERTIES[inp.shade_type]
    d_mrt_sun = params.radiant_gain_c_per_kw * inp.solar_index
    if kind == "unshaded":
        ta, d_mrt = inp.temp_c, d_mrt_sun
    else:
        ta, d_mrt = inp.temp_c - evap, d_mrt_sun * (1 - 0.85 * q)

    wind = max(0.0, min(inp.wind_ms, 6.0) - 0.5)
    wind_relief = 0.6 * wind if inp.temp_c < 35 else 0.2 * wind
    humidity = 0.04 * max(0.0, inp.humidity_pct - 40)
    cti = ta + params.radiant_weight * d_mrt + humidity - wind_relief

    speed = 1 - params.speed_decay_per_c * max(0.0, cti - params.comfort_threshold_c)
    speed = min(1.0, max(params.min_speed_factor, speed))

    excess = max(0.0, inp.temp_c - params.penalty_threshold_c)
    if kind == "unshaded":
        penalty = 1 + excess * (
            params.unshaded_penalty_per_c * inp.solar_index
            + params.exposure_amplification_per_c_km * unshaded_m / 1000
        )
    else:
        penalty = 1 + params.shaded_penalty_per_c * excess

    walk_min = distance / (inp.walk_speed_ms * speed) / 60
    return SegmentResult(
        kind=kind,
        distance_m=round(distance, 1),
        mrt_c=round(ta + d_mrt, 1),
        thermal_index_c=round(cti, 1),
        stress_category=stress_category(cti),
        speed_factor=round(speed, 3),
        distance_penalty=round(penalty, 3),
        walk_time_min=round(walk_min, 2),
        perceived_time_min=round(walk_min * penalty, 2),
    )


def _core(inp: CorridorInput, params: ModelParameters) -> tuple[list[SegmentResult], float]:
    shaded = inp.distance_m * inp.shade_pct / 100
    unshaded = inp.distance_m - shaded
    segments = [
        _segment(kind, dist, inp, params, unshaded)
        for kind, dist in (("shaded", shaded), ("unshaded", unshaded))
        if dist > 0
    ]
    t0 = inp.distance_m / inp.walk_speed_ms / 60
    perceived = sum(s.perceived_time_min for s in segments)
    return segments, 100 * t0 / perceived if perceived else 100.0


def shade_needed(
    inp: CorridorInput, target_ewcs: float, params: ModelParameters | None = None
) -> float | None:
    """Minimum shade coverage (%) reaching ``target_ewcs``; ``None`` if unreachable."""
    params = params or ModelParameters()
    if _core(inp.model_copy(update={"shade_pct": 100.0}), params)[1] < target_ewcs:
        return None
    lo, hi = 0.0, 100.0
    if _core(inp.model_copy(update={"shade_pct": 0.0}), params)[1] >= target_ewcs:
        return 0.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if _core(inp.model_copy(update={"shade_pct": mid}), params)[1] >= target_ewcs:
            hi = mid
        else:
            lo = mid
    return round(hi, 1)


def simulate_corridor(
    inp: CorridorInput,
    params: ModelParameters | None = None,
    target_ewcs: float | None = 70.0,
) -> CorridorResult:
    """Run the heat-penalised walkability model for one corridor scenario."""
    params = params or ModelParameters()
    segments, ewcs = _core(inp, params)
    t0 = inp.distance_m / inp.walk_speed_ms / 60
    heat_time = sum(s.walk_time_min for s in segments)
    perceived = sum(s.perceived_time_min for s in segments)
    ewcs = max(0.0, min(100.0, ewcs))
    r_eff = inp.distance_m * ewcs / 100
    dose = sum(
        max(0.0, s.thermal_index_c - params.comfort_threshold_c) * s.walk_time_min
        for s in segments
    )
    return CorridorResult(
        inputs=inp,
        segments=segments,
        nominal_walk_time_min=round(t0, 2),
        heat_adjusted_walk_time_min=round(heat_time, 2),
        perceived_walk_time_min=round(perceived, 2),
        extra_time_min=round(perceived - t0, 2),
        perceived_distance_m=round(sum(s.distance_m * s.distance_penalty for s in segments), 1),
        ewcs=round(ewcs, 1),
        rating=rating_for(ewcs),
        comfort_loss_pct=round(100 - ewcs, 1),
        effective_catchment_radius_m=round(r_eff, 1),
        catchment_area_loss_pct=round(100 * (1 - (r_eff / inp.distance_m) ** 2), 1),
        heat_exposure_dose=round(dose, 1),
        penalty_active=inp.temp_c > params.penalty_threshold_c,
        shade_needed_for_target_pct=shade_needed(inp, target_ewcs, params)
        if target_ewcs is not None
        else None,
        target_ewcs=target_ewcs,
    )


def sensitivity_grid(
    inp: CorridorInput,
    shades: list[float] | None = None,
    temps: list[float] | None = None,
    params: ModelParameters | None = None,
) -> dict[float, dict[float, float]]:
    """EWCS for a grid of ``temps × shades`` holding other inputs constant."""
    params = params or ModelParameters()
    shades = shades if shades is not None else [0, 20, 40, 60, 80, 100]
    temps = temps if temps is not None else [36, 40, 42, 44, 46, 48]
    return {
        t: {
            s: round(
                min(100.0, _core(inp.model_copy(update={"temp_c": t, "shade_pct": s}), params)[1]),
                1,
            )
            for s in shades
        }
        for t in temps
    }
