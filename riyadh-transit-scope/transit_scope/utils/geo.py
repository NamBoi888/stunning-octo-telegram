"""Geodesy helpers: metric CRS selection and great-circle distances."""

from __future__ import annotations

import math

from pyproj import CRS
from pyproj.aoi import AreaOfInterest
from pyproj.database import query_utm_crs_info

EARTH_RADIUS_M = 6_371_008.8

#: UTM Zone 38N — the canonical metric projection for Riyadh.
RIYADH_UTM = "EPSG:32638"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS84 points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def utm_crs_for(lon: float, lat: float) -> CRS:
    """Return the WGS84 UTM CRS covering a lon/lat point.

    Riyadh (≈46.7°E, 24.7°N) resolves to EPSG:32638 (UTM 38N).
    """
    infos = query_utm_crs_info(
        datum_name="WGS 84",
        area_of_interest=AreaOfInterest(lon, lat, lon, lat),
    )
    if not infos:  # pragma: no cover - only for points outside UTM coverage (poles)
        return CRS.from_user_input("EPSG:3857")
    return CRS.from_epsg(int(infos[0].code))


def resolve_metric_crs(user_crs: str | None, lon: float, lat: float) -> CRS:
    """Use the user-supplied CRS if given, otherwise auto-select UTM.

    Raises ``ValueError`` if the user CRS is geographic (degrees), since
    buffers and lengths must be computed in metres.
    """
    if user_crs:
        crs = CRS.from_user_input(user_crs)
        if crs.is_geographic:
            raise ValueError(
                f"CRS {user_crs} is geographic (degrees); a projected metric CRS is required."
            )
        return crs
    return utm_crs_for(lon, lat)
