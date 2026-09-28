"""Lat/lon → metric CRS → normalised SVG viewport coordinates.

Geometries are first projected to a metric CRS (UTM, auto-selected — EPSG:32638
for Riyadh) so that the map has correct proportions and the scale bar and
catchment radii are true distances. They are then affinely fitted into the
map frame of a ``W × H`` canvas, preserving aspect ratio and flipping the
y-axis (SVG y grows downwards).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry.base import BaseGeometry


@dataclass(frozen=True)
class Frame:
    """Pixel rectangle into which the map is fitted."""

    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class ViewportTransform:
    """Affine mapping from projected metres to SVG pixels."""

    scale: float  # pixels per metre
    offset_x: float
    offset_y: float
    min_x: float
    max_y: float

    @classmethod
    def fit(
        cls, bounds: tuple[float, float, float, float], frame: Frame, padding: float = 0.04
    ) -> ViewportTransform:
        """Fit metric ``bounds`` (minx, miny, maxx, maxy) centred in ``frame``."""
        minx, miny, maxx, maxy = bounds
        dx, dy = max(maxx - minx, 1.0), max(maxy - miny, 1.0)
        pad_x, pad_y = dx * padding, dy * padding
        minx, maxx, miny, maxy = minx - pad_x, maxx + pad_x, miny - pad_y, maxy + pad_y
        dx, dy = maxx - minx, maxy - miny
        scale = min(frame.width / dx, frame.height / dy)
        offset_x = frame.x + (frame.width - dx * scale) / 2
        offset_y = frame.y + (frame.height - dy * scale) / 2
        return cls(scale=scale, offset_x=offset_x, offset_y=offset_y, min_x=minx, max_y=maxy)

    def point(self, x: float, y: float) -> tuple[float, float]:
        return (
            self.offset_x + (x - self.min_x) * self.scale,
            self.offset_y + (self.max_y - y) * self.scale,
        )

    def length(self, metres: float) -> float:
        return metres * self.scale


def _ring(coords, tf: ViewportTransform, close: bool) -> str:
    pts = [tf.point(x, y) for x, y, *_ in coords]
    if len(pts) < 2:
        return ""
    body = "M" + " L".join(f"{px:.2f},{py:.2f}" for px, py in pts)
    return body + ("Z" if close else "")


def geometry_to_path(geom: BaseGeometry, tf: ViewportTransform) -> str:
    """Convert a (multi)polygon / (multi)linestring to SVG path data."""
    if geom is None or geom.is_empty:
        return ""
    kind = geom.geom_type
    if kind == "Polygon":
        rings = [geom.exterior, *geom.interiors]
        return " ".join(_ring(r.coords, tf, True) for r in rings)
    if kind == "LineString":
        return _ring(geom.coords, tf, False)
    if kind == "LinearRing":
        return _ring(geom.coords, tf, True)
    if kind in ("MultiPolygon", "MultiLineString", "GeometryCollection"):
        return " ".join(filter(None, (geometry_to_path(g, tf) for g in geom.geoms)))
    return ""


def nice_distance(target_m: float) -> float:
    """Round a distance down to 1/2/2.5/5 × 10ⁿ for scale bars."""
    if target_m <= 0:
        return 1.0
    exp = 10 ** math.floor(math.log10(target_m))
    for mult in (5, 2.5, 2, 1):
        if mult * exp <= target_m:
            return mult * exp
    return exp
