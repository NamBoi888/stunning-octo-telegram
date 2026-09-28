"""GIS → SVG vector map renderer."""

from __future__ import annotations

from transit_scope.gis_svg.geojson_io import GeoJSONLayers, load_geojson
from transit_scope.gis_svg.renderer import MapLayers, RenderOptions, SvgMapRenderer, render_svg
from transit_scope.gis_svg.themes import THEMES, Theme, get_theme


def layers_from_analysis(result, geojson: GeoJSONLayers | None = None) -> MapLayers:
    """Build :class:`MapLayers` from a GTFS :class:`~transit_scope.gtfs.AnalysisResult`
    (routes + station nodes) optionally overlaid on GeoJSON layers."""
    layers = MapLayers.from_geojson(geojson) if geojson is not None else MapLayers()
    if result is not None:
        layers.routes = result.route_lines_wgs84()
        layers.stations = result.nodes_wgs84()
    return layers


__all__ = [
    "THEMES",
    "GeoJSONLayers",
    "MapLayers",
    "RenderOptions",
    "SvgMapRenderer",
    "Theme",
    "get_theme",
    "layers_from_analysis",
    "load_geojson",
    "render_svg",
]
