"""GeoJSON ingestion, split into district / point / line layers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import pandas as pd

from transit_scope.errors import InputFileError

WGS84 = "EPSG:4326"


@dataclass
class GeoJSONLayers:
    """Features from one GeoJSON file grouped by geometry family (WGS84)."""

    polygons: gpd.GeoDataFrame
    points: gpd.GeoDataFrame
    lines: gpd.GeoDataFrame

    @property
    def empty(self) -> bool:
        return self.polygons.empty and self.points.empty and self.lines.empty


def empty_layer() -> gpd.GeoDataFrame:
    """An empty WGS84 layer with a ``name`` column."""
    return gpd.GeoDataFrame({"name": []}, geometry=[], crs=WGS84)


def load_geojson(path: str | Path) -> GeoJSONLayers:
    """Read a GeoJSON Feature/FeatureCollection into typed layers.

    Features lacking a ``name`` property get one from common alternatives
    (``NAME``, ``name_en``, ``district``, ``label``), else an empty label.
    """
    path = Path(path).expanduser()
    if not path.exists():
        raise InputFileError(f"GeoJSON file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InputFileError(f"{path} is not valid GeoJSON: {exc}") from exc

    if data.get("type") == "Feature":
        features = [data]
    elif data.get("type") == "FeatureCollection":
        features = data.get("features") or []
    else:
        raise InputFileError(f"{path}: expected a GeoJSON Feature or FeatureCollection")
    features = [f for f in features if isinstance(f, dict) and f.get("geometry")]
    if not features:
        raise InputFileError(f"{path} contains no features with geometry.")

    try:
        gdf = gpd.GeoDataFrame.from_features(features, crs=WGS84)
    except Exception as exc:  # shapely raises various errors for bad coordinates
        raise InputFileError(f"{path}: could not parse geometries ({exc})") from exc

    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    # Coalesce per feature: mixed files may use different keys on different features.
    name = pd.Series(pd.NA, index=gdf.index, dtype="string")
    for candidate in ("name", "NAME", "name_en", "district", "label", "title"):
        if candidate in gdf:
            values = gdf[candidate].astype("string").replace("", pd.NA)
            name = name.fillna(values)
    gdf["name"] = name.fillna("")

    kind = gdf.geom_type
    return GeoJSONLayers(
        polygons=gdf[kind.isin(["Polygon", "MultiPolygon"])].reset_index(drop=True),
        points=gdf[kind.isin(["Point", "MultiPoint"])].reset_index(drop=True),
        lines=gdf[kind.isin(["LineString", "MultiLineString"])].reset_index(drop=True),
    )


__all__ = ["GeoJSONLayers", "empty_layer", "load_geojson"]
