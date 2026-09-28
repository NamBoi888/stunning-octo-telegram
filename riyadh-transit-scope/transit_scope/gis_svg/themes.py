"""Colour themes for SVG map output."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Theme(BaseModel):
    """All colours and typography used by the renderer."""

    name: str
    background: str
    land: str
    district_fill: str
    district_stroke: str
    district_label: str
    text: str
    text_muted: str
    accent: str
    route_casing: str
    station_fill: str
    interchange_fill: str
    interchange_stroke: str
    catchment: str
    catchment_fill_opacity: float = Field(ge=0, le=1)
    catchment_stroke_opacity: float = Field(ge=0, le=1)
    legend_background: str
    legend_opacity: float = Field(ge=0, le=1)
    bus_fallback: str
    feature_color: str
    font_family: str = "'Inter', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif"


DARK = Theme(
    name="dark",
    background="#0B0F14",
    land="#111720",
    district_fill="#151C26",
    district_stroke="#2A3544",
    district_label="#56657A",
    text="#E8EDF3",
    text_muted="#8B98A9",
    accent="#4FC3F7",
    route_casing="#0B0F14",
    station_fill="#0B0F14",
    interchange_fill="#FFFFFF",
    interchange_stroke="#0B0F14",
    catchment="#4FC3F7",
    catchment_fill_opacity=0.08,
    catchment_stroke_opacity=0.35,
    legend_background="#0B0F14",
    legend_opacity=0.88,
    bus_fallback="#8C9BAB",
    feature_color="#F48FB1",
)

LIGHT = Theme(
    name="light",
    background="#F6F4EF",
    land="#FBFAF7",
    district_fill="#EFEBE3",
    district_stroke="#C8C0B2",
    district_label="#9C9384",
    text="#1D2127",
    text_muted="#5E6570",
    accent="#0072CE",
    route_casing="#FFFFFF",
    station_fill="#FFFFFF",
    interchange_fill="#FFFFFF",
    interchange_stroke="#1D2127",
    catchment="#0072CE",
    catchment_fill_opacity=0.07,
    catchment_stroke_opacity=0.30,
    legend_background="#FFFFFF",
    legend_opacity=0.92,
    bus_fallback="#7A8591",
    feature_color="#C2185B",
)

THEMES: dict[str, Theme] = {"dark": DARK, "light": LIGHT}


def get_theme(name: str) -> Theme:
    try:
        return THEMES[name.lower()]
    except KeyError as exc:
        raise ValueError(f"Unknown theme {name!r}; choose from {', '.join(THEMES)}") from exc
