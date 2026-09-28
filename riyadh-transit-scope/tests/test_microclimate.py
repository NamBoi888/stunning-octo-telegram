from __future__ import annotations

import pytest
from pydantic import ValidationError

from transit_scope.microclimate import (
    CorridorInput,
    ShadeType,
    sensitivity_grid,
    shade_needed,
    simulate_corridor,
)
from transit_scope.microclimate.model import rating_for, stress_category


def run(**kw):
    base = {"distance_m": 800, "shade_pct": 35, "temp_c": 44}
    return simulate_corridor(CorridorInput(**{**base, **kw}))


def test_reference_scenario():
    r = run()
    assert r.penalty_active
    assert r.nominal_walk_time_min == pytest.approx(800 / 1.34 / 60, abs=0.01)
    assert r.nominal_walk_time_min < r.heat_adjusted_walk_time_min < r.perceived_walk_time_min
    assert 50 < r.ewcs < 75
    assert r.effective_catchment_radius_m == pytest.approx(800 * r.ewcs / 100, abs=0.5)
    assert r.catchment_area_loss_pct == pytest.approx(
        100 * (1 - (r.ewcs / 100) ** 2), abs=0.2
    )


def test_no_distance_penalty_at_or_below_40c():
    r = run(temp_c=40)
    assert not r.penalty_active
    assert all(s.distance_penalty == 1.0 for s in r.segments)
    # Only physical slowdown remains, so perceived == heat-adjusted time.
    assert r.perceived_walk_time_min == pytest.approx(r.heat_adjusted_walk_time_min, abs=0.02)


def test_penalty_continuous_at_threshold():
    below = run(temp_c=40.0).ewcs
    above = run(temp_c=40.01).ewcs
    assert abs(below - above) < 0.5


def test_monotonic_in_shade_and_temperature():
    shades = [run(shade_pct=s).ewcs for s in (0, 25, 50, 75, 100)]
    assert shades == sorted(shades)
    temps = [run(temp_c=t).ewcs for t in (38, 41, 44, 47, 50)]
    assert temps == sorted(temps, reverse=True)


def test_trees_outperform_sails():
    assert run(shade_type=ShadeType.trees).ewcs > run(shade_type=ShadeType.sail).ewcs


def test_shade_needed_solver():
    inp = CorridorInput(distance_m=800, shade_pct=0, temp_c=44)
    needed = shade_needed(inp, 70)
    assert needed is not None and 0 < needed < 100
    at = simulate_corridor(inp.model_copy(update={"shade_pct": needed}), target_ewcs=None)
    assert at.ewcs >= 69.9
    assert shade_needed(CorridorInput(distance_m=800, shade_pct=0, temp_c=55), 95) is None
    assert shade_needed(CorridorInput(distance_m=800, shade_pct=0, temp_c=30), 50) == 0.0


def test_full_shade_no_sun_segment():
    r = run(shade_pct=100)
    assert [s.kind for s in r.segments] == ["shaded"]


def test_sensitivity_grid_shape():
    grid = sensitivity_grid(CorridorInput(distance_m=500, shade_pct=0, temp_c=44),
                            shades=[0, 50, 100], temps=[40, 45])
    assert list(grid) == [40, 45]
    assert list(grid[45]) == [0, 50, 100]
    assert grid[45][100] > grid[45][0]


@pytest.mark.parametrize("kw", [{"temp_c": 70}, {"shade_pct": 120}, {"distance_m": 0},
                                {"solar_wm2": -1}])
def test_validation(kw):
    with pytest.raises(ValidationError):
        CorridorInput(**{"distance_m": 800, "shade_pct": 35, "temp_c": 44, **kw})


def test_bands_and_grades():
    assert stress_category(50) == "extreme heat stress"
    assert stress_category(20) == "no thermal stress"
    assert rating_for(95) == "A" and rating_for(10) == "F"
