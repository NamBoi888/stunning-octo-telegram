"""Network KPI computation for a validated :class:`GTFSFeed`.

Pipeline
--------
1. :func:`prepare_network` — filter to one service day, expand frequency
   trips, attach route/mode info and project stops to a metric CRS
   (UTM 38N / EPSG:32638 for Riyadh, auto-detected elsewhere).
2. Route geometry — representative alignment per route/direction from
   ``shapes.txt`` (most-used shape) or, failing that, the most common stop
   pattern.
3. Route KPIs — route-km, vehicle-km, trips, peak / off-peak headway (mean
   gap between consecutive departures, attributed to the window the earlier
   departure falls in), span and average speed.
4. Station nodes — stops (and their parent stations) are clustered with a
   non-chaining leader algorithm within ``transfer_cluster_radius_m`` so a
   metro platform and the adjacent bus stop form one interchange node.
5. Transfer friction index and walk catchments (500 m / 1000 m buffers).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import geopandas as gpd
import numpy as np
import pandas as pd
from pyproj import CRS
from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from transit_scope.errors import GTFSValidationError
from transit_scope.gtfs.loader import GTFSFeed
from transit_scope.gtfs.models import (
    RAPID_MODES,
    AnalysisConfig,
    CatchmentKPI,
    NetworkReport,
    NetworkSummary,
    RouteKPI,
    StationKPI,
    TimeWindow,
    TransferNode,
)
from transit_scope.gtfs.service import expand_frequencies, select_service
from transit_scope.utils.geo import resolve_metric_crs
from transit_scope.utils.timeutil import format_seconds

WGS84 = "EPSG:4326"

#: Consecutive departures further apart than this are treated as a service
#: break (e.g. overnight) rather than a headway.
MAX_HEADWAY_GAP_S = 2 * 3600

#: Fallback colours when ``routes.txt`` has no ``route_color``.
MODE_COLORS: dict[str, str] = {
    "metro": "#0072CE",
    "rail": "#6D2077",
    "tram": "#78BE20",
    "bus": "#F2A900",
    "ferry": "#00A3AD",
    "cable": "#A05EB5",
    "other": "#8A8D8F",
}


@dataclass
class PreparedNetwork:
    """Service-day subset of a feed, ready for KPI computation."""

    feed: GTFSFeed
    crs: CRS
    service_label: str
    trips: pd.DataFrame
    stop_times: pd.DataFrame
    stops: gpd.GeoDataFrame  # served stops, projected
    warnings: list[str] = field(default_factory=list)


@dataclass
class AnalysisResult:
    """Report plus the geometries needed for GeoJSON/SVG export."""

    report: NetworkReport
    crs: CRS
    route_lines: gpd.GeoDataFrame  # one representative line per route (metric CRS)
    nodes: gpd.GeoDataFrame  # station nodes (metric CRS)
    catchment_polygons: dict[float, object]  # radius -> shapely geometry (metric CRS)

    def route_lines_wgs84(self) -> gpd.GeoDataFrame:
        return self.route_lines.to_crs(WGS84)

    def nodes_wgs84(self) -> gpd.GeoDataFrame:
        return self.nodes.to_crs(WGS84)

    def catchments_geojson(self) -> str:
        """Catchment polygons as a WGS84 GeoJSON FeatureCollection string."""
        radii = sorted(self.catchment_polygons)
        gdf = gpd.GeoDataFrame(
            {
                "radius_m": radii,
                "area_km2": [self.catchment_polygons[r].area / 1e6 for r in radii],
            },
            geometry=[self.catchment_polygons[r] for r in radii],
            crs=self.crs,
        ).to_crs(WGS84)
        return gdf.to_json(drop_id=True)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _in_windows(seconds: pd.Series, windows: list[TimeWindow]) -> pd.Series:
    mask = pd.Series(False, index=seconds.index)
    for w in windows:
        mask |= (seconds >= w.start_s) & (seconds < w.end_s)
    return mask


def _headway_stats(
    events: pd.DataFrame, keys: list[str], windows: list[TimeWindow]
) -> pd.DataFrame:
    """Mean peak / off-peak headway (minutes) per group of departure events.

    ``events`` must contain the ``keys`` columns and ``t`` (seconds). Each gap
    to the next departure in the group is attributed to the earlier one.
    """
    ev = events.sort_values([*keys, "t"])
    nxt = ev.groupby(keys, sort=False)["t"].shift(-1)
    ev = ev.assign(gap=nxt - ev["t"], peak=_in_windows(ev["t"], windows))
    ev = ev[(ev["gap"] > 0) & (ev["gap"] <= MAX_HEADWAY_GAP_S)]
    out = (
        ev.groupby([*keys, "peak"])["gap"].mean().div(60.0).unstack("peak")
        .rename(columns={True: "peak_hw", False: "offpeak_hw"})
    )
    for col in ("peak_hw", "offpeak_hw"):
        if col not in out:
            out[col] = np.nan
    return out[["peak_hw", "offpeak_hw"]]


def natural_key(text: str) -> list[object]:
    """Sort key ordering "2" < "10" < "150" and "M2" < "M10"."""
    return [int(tok) if tok.isdigit() else tok.lower() for tok in re.split(r"(\d+)", text)]


def _opt(value: float) -> float | None:
    return None if value is None or pd.isna(value) else round(float(value), 2)


# --------------------------------------------------------------------------- #
# Step 1 — preparation
# --------------------------------------------------------------------------- #


def prepare_network(feed: GTFSFeed, config: AnalysisConfig) -> PreparedNetwork:
    """Filter the feed to the analysis day and project served stops."""
    warnings = list(feed.warnings)
    services, label = select_service(feed, config.service_date)
    trips = feed.trips[feed.trips["service_id"].isin(services)]
    if trips.empty:
        raise GTFSValidationError(f"No trips run on the selected service day ({label}).")
    trips = trips.merge(
        feed.routes[["route_id", "mode", "route_color", "display_name"]], on="route_id"
    )

    st = feed.stop_times[feed.stop_times["trip_id"].isin(trips["trip_id"])]
    st = expand_frequencies(st, feed.frequencies)
    st = st.merge(
        trips[["trip_id", "route_id", "direction_id", "shape_id", "mode"]].rename(
            columns={"trip_id": "base_trip_id"}
        ),
        on="base_trip_id",
    )
    if st.empty:
        raise GTFSValidationError("Selected trips have no stop_times.")

    served = feed.stops[feed.stops["stop_id"].isin(st["stop_id"].unique())]
    stops = gpd.GeoDataFrame(
        served,
        geometry=gpd.points_from_xy(served["stop_lon"], served["stop_lat"]),
        crs=WGS84,
    )
    lon, lat = stops["stop_lon"].mean(), stops["stop_lat"].mean()
    try:
        crs = resolve_metric_crs(config.metric_crs, lon, lat)
    except Exception as exc:  # pyproj raises several types for bad input
        raise GTFSValidationError(f"Invalid metric CRS {config.metric_crs!r}: {exc}") from exc
    return PreparedNetwork(
        feed=feed,
        crs=crs,
        service_label=label,
        trips=trips,
        stop_times=st,
        stops=stops.to_crs(crs),
        warnings=warnings,
    )


# --------------------------------------------------------------------------- #
# Step 2 — geometry
# --------------------------------------------------------------------------- #


def _trip_geometry_keys(net: PreparedNetwork) -> tuple[pd.Series, dict[str, LineString]]:
    """Map each base trip to a geometry key and build the metric geometries."""
    st = net.stop_times
    base = st.drop_duplicates("base_trip_id")[["base_trip_id", "shape_id"]].set_index(
        "base_trip_id"
    )["shape_id"]
    shapes = net.feed.shapes
    geoms: dict[str, LineString] = {}
    keys = pd.Series(index=base.index, dtype="object")

    if shapes is not None:
        used = set(base.dropna()) & set(shapes["shape_id"])
        pts = shapes[shapes["shape_id"].isin(used)]
        if not pts.empty:
            proj = gpd.GeoSeries(
                gpd.points_from_xy(pts["shape_pt_lon"], pts["shape_pt_lat"]), crs=WGS84
            ).to_crs(net.crs)
            pts = pts.assign(x=proj.x.to_numpy(), y=proj.y.to_numpy())
            for shape_id, grp in pts.groupby("shape_id", sort=False):
                if len(grp) >= 2:
                    geoms[f"shape:{shape_id}"] = LineString(grp[["x", "y"]].to_numpy())
        has_shape = base.map(lambda s: isinstance(s, str) and f"shape:{s}" in geoms)
        keys[has_shape] = "shape:" + base[has_shape].astype(str)

    missing = keys.isna()
    if missing.any():
        sub = st[st["base_trip_id"].isin(keys.index[missing])].drop_duplicates(
            ["base_trip_id", "stop_sequence"]
        )
        patterns = sub.groupby("base_trip_id", sort=False)["stop_id"].agg("|".join)
        keys[patterns.index] = "pattern:" + patterns
        xy = dict(
            zip(
                net.stops["stop_id"],
                zip(net.stops.geometry.x, net.stops.geometry.y, strict=True),
                strict=True,
            )
        )
        for pattern in patterns.unique():
            coords = [xy[s] for s in pattern.split("|")]
            if len(coords) >= 2:
                geoms[f"pattern:{pattern}"] = LineString(coords)
    return keys, geoms


def route_geometries(
    net: PreparedNetwork,
) -> tuple[gpd.GeoDataFrame, pd.Series]:
    """Representative line per route/direction, plus per-trip length (metres)."""
    keys, geoms = _trip_geometry_keys(net)
    trip_len = keys.map(lambda k: geoms[k].length if k in geoms else np.nan)

    trips = net.trips.set_index("trip_id")
    frame = pd.DataFrame({"key": keys, "length_m": trip_len}).join(
        trips[["route_id", "direction_id"]]
    )
    frame = frame.dropna(subset=["key"])
    rep = (
        frame.groupby(["route_id", "direction_id"])["key"]
        .agg(lambda s: s.value_counts().index[0])
        .reset_index()
    )
    rep = rep[rep["key"].isin(geoms)]
    lines = gpd.GeoDataFrame(
        rep.assign(length_m=[geoms[k].length for k in rep["key"]]),
        geometry=[geoms[k] for k in rep["key"]],
        crs=net.crs,
    )
    return lines, trip_len


# --------------------------------------------------------------------------- #
# Step 3 — route KPIs
# --------------------------------------------------------------------------- #


def compute_route_kpis(
    net: PreparedNetwork,
    lines: gpd.GeoDataFrame,
    trip_len: pd.Series,
    config: AnalysisConfig,
) -> list[RouteKPI]:
    st = net.stop_times
    grouped = st.groupby("trip_id", sort=False)
    trips = pd.DataFrame(
        {
            "base_trip_id": grouped["base_trip_id"].first(),
            "route_id": grouped["route_id"].first(),
            "direction_id": grouped["direction_id"].first(),
            "t": grouped["dep_s"].min(),
            "end": grouped["arr_s"].max(),
        }
    )
    trips["length_m"] = trips["base_trip_id"].map(trip_len)
    trips["duration_h"] = (trips["end"] - trips["t"]) / 3600.0

    hw = _headway_stats(trips, ["route_id", "direction_id"], config.peak_windows)
    hw_route = hw.groupby("route_id").mean()

    peak_hours = sum(w.minutes for w in config.peak_windows) / 60.0
    trips["is_peak"] = _in_windows(trips["t"], config.peak_windows)
    stops_per_route = st.groupby("route_id")["stop_id"].nunique()

    out: list[RouteKPI] = []
    routes = net.feed.routes.set_index("route_id")
    for route_id, grp in trips.groupby("route_id"):
        info = routes.loc[route_id]
        rlines = lines[lines["route_id"] == route_id]
        directions = int(grp["direction_id"].nunique())
        peak_tph = grp["is_peak"].sum() / peak_hours / max(directions, 1) if peak_hours else 0.0
        valid = grp[(grp["duration_h"] > 0) & grp["length_m"].notna()]
        speed = (
            (valid["length_m"] / 1000 / valid["duration_h"]).median() if len(valid) else None
        )
        out.append(
            RouteKPI(
                route_id=str(route_id),
                name=str(info["display_name"]),
                long_name=str(info["route_long_name"] or ""),
                mode=info["mode"],
                color=info["route_color"] or MODE_COLORS[info["mode"]],
                directions=directions,
                stops=int(stops_per_route.get(route_id, 0)),
                length_km=round(float(rlines["length_m"].mean() / 1000), 3)
                if len(rlines)
                else 0.0,
                trips_per_day=int(len(grp)),
                vehicle_km_per_day=round(float(grp["length_m"].sum() / 1000), 1),
                peak_trips_per_hour=round(float(peak_tph), 2),
                peak_headway_min=_opt(hw_route["peak_hw"].get(route_id)),
                offpeak_headway_min=_opt(hw_route["offpeak_hw"].get(route_id)),
                first_departure=format_seconds(grp["t"].min()),
                last_departure=format_seconds(grp["t"].max()),
                avg_speed_kmh=_opt(speed),
            )
        )
    return sorted(out, key=lambda r: (r.mode not in RAPID_MODES, r.mode, natural_key(r.name)))


# --------------------------------------------------------------------------- #
# Step 4 — station nodes
# --------------------------------------------------------------------------- #


def build_station_nodes(net: PreparedNetwork, config: AnalysisConfig) -> gpd.GeoDataFrame:
    """Cluster served stops into station nodes.

    Stops sharing a ``parent_station`` are grouped first; the resulting points
    are then clustered with a leader algorithm (busiest / rapid-transit stops
    lead), which bounds node size to ``2 × radius`` and avoids the chaining
    problem of union-of-buffers clustering on dense bus corridors.
    """
    st = net.stop_times
    stops = net.stops.copy()
    departures = st.groupby("stop_id").size()
    modes = st[["stop_id", "mode"]].drop_duplicates().groupby("stop_id")["mode"].agg(sorted)
    stops["departures"] = stops["stop_id"].map(departures).fillna(0).astype(int)
    stops["modes"] = stops["stop_id"].map(modes)
    stops["rapid"] = stops["modes"].map(lambda m: bool(set(m) & RAPID_MODES))

    parent = stops.get("parent_station")
    stops["group"] = (
        parent.where(parent.notna() & parent.isin(net.feed.stops["stop_id"]), stops["stop_id"])
        if parent is not None
        else stops["stop_id"]
    )

    # Order leaders: rapid transit first, then by departures.
    order = stops.sort_values(["rapid", "departures"], ascending=False).index.to_list()
    geoms = stops.geometry
    tree = STRtree(geoms.to_numpy())
    radius = config.transfer_cluster_radius_m
    assignment: dict[int, int] = {}
    group_to_node: dict[str, int] = {}
    positions = {idx: pos for pos, idx in enumerate(stops.index)}
    index_list = stops.index.to_list()
    siblings = stops.groupby("group").groups

    for idx in order:
        if idx in assignment:
            continue
        group = stops.at[idx, "group"]
        node = group_to_node.setdefault(group, idx)
        assignment[idx] = node
        near = tree.query(geoms.iloc[positions[idx]], predicate="dwithin", distance=radius)
        for pos in near:
            other = index_list[pos]
            if other not in assignment:
                assignment[other] = node
                group_to_node.setdefault(stops.at[other, "group"], node)
        # Siblings sharing a parent station join regardless of distance.
        for other in siblings[group]:
            assignment.setdefault(other, node)

    stops["node"] = stops.index.map(assignment)
    # Plain arrays: a per-node pandas loop is far too slow for city-scale feeds.
    xs_all, ys_all = stops.geometry.x.to_numpy(), stops.geometry.y.to_numpy()
    ids_all = stops["stop_id"].to_numpy()
    names_all = stops["stop_name"].to_numpy()
    modes_all = stops["modes"].to_numpy()
    pos_of = {idx: pos for pos, idx in enumerate(stops.index)}
    records = []
    for leader, member_idx in stops.groupby("node").indices.items():
        lead = pos_of[leader]
        xs, ys = xs_all[member_idx], ys_all[member_idx]
        spread = 0.0
        if len(member_idx) > 1:
            dx = xs[:, None] - xs[None, :]
            dy = ys[:, None] - ys[None, :]
            spread = float(np.sqrt(dx**2 + dy**2).max())
        lead_id = ids_all[lead]
        records.append(
            {
                "node_id": lead_id if len(member_idx) == 1 else f"node:{lead_id}",
                "name": str(names_all[lead] or lead_id),
                "stop_ids": sorted(ids_all[member_idx]),
                "modes": sorted({m for i in member_idx for m in modes_all[i]}),
                "spread_m": round(spread, 1),
                "geometry": Point(xs.mean(), ys.mean()),
            }
        )
    return gpd.GeoDataFrame(records, geometry="geometry", crs=net.crs)


def compute_station_kpis(
    net: PreparedNetwork, nodes: gpd.GeoDataFrame, config: AnalysisConfig
) -> tuple[list[StationKPI], pd.DataFrame]:
    """Departures and combined headway per node; returns KPIs and the node route map."""
    st = net.stop_times
    stop_to_node = {
        s: n for n, ids in zip(nodes["node_id"], nodes["stop_ids"], strict=True) for s in ids
    }
    last_seq = st.groupby("trip_id")["stop_sequence"].transform("max")
    dep = st[st["stop_sequence"] < last_seq].assign(node_id=st["stop_id"].map(stop_to_node))
    dep = dep.rename(columns={"dep_s": "t"})
    dep["is_peak"] = _in_windows(dep["t"], config.peak_windows)

    per_node = dep.groupby("node_id").agg(
        departures=("t", "size"), peak_departures=("is_peak", "sum")
    )
    route_map = (
        st[["stop_id", "route_id"]]
        .drop_duplicates()
        .assign(node_id=lambda d: d["stop_id"].map(stop_to_node))[["node_id", "route_id"]]
        .drop_duplicates()
        .groupby("node_id")["route_id"]
        .agg(sorted)
    )
    hw = _headway_stats(dep[["node_id", "t"]], ["node_id"], config.peak_windows)

    wgs = nodes.to_crs(WGS84)
    route_names = net.feed.routes.set_index("route_id")["display_name"]
    kpis = []
    for row, geo in zip(nodes.itertuples(index=False), wgs.geometry, strict=True):
        stats = per_node.loc[row.node_id] if row.node_id in per_node.index else None
        routes = route_map.get(row.node_id, [])
        kpis.append(
            StationKPI(
                node_id=row.node_id,
                name=row.name,
                lat=round(geo.y, 6),
                lon=round(geo.x, 6),
                stop_ids=list(row.stop_ids),
                modes=list(row.modes),
                routes=sorted((str(route_names.get(r, r)) for r in routes), key=natural_key),
                departures_per_day=int(stats["departures"]) if stats is not None else 0,
                peak_departures=int(stats["peak_departures"]) if stats is not None else 0,
                peak_headway_min=_opt(hw["peak_hw"].get(row.node_id))
                if row.node_id in hw.index
                else None,
            )
        )
    kpis.sort(key=lambda k: k.departures_per_day, reverse=True)
    return kpis, route_map.rename("route_ids").to_frame()


# --------------------------------------------------------------------------- #
# Step 5 — transfer friction & catchments
# --------------------------------------------------------------------------- #


def compute_transfer_nodes(
    stations: list[StationKPI],
    route_map: pd.DataFrame,
    routes: list[RouteKPI],
    nodes: gpd.GeoDataFrame,
) -> list[TransferNode]:
    """Transfer Friction Index (TFI) for nodes served by 2+ routes.

    ``TFI = transfer_pairs × expected_wait × walk_penalty × mode_penalty`` where

    * ``transfer_pairs = n(n−1)/2`` possible route-to-route transfers;
    * ``expected_wait`` = mean of half the peak headway of the routes served
      (random-arrival assumption; off-peak headway if no peak service);
    * ``walk_penalty = 1 + spread_m / 200`` for the walk between member stops;
    * ``mode_penalty = 1 + 0.25 × (modes − 1)`` for level/mode changes.

    The *hub score* (0–100) ranks node importance independent of friction:
    ``routes × √(peak departures)`` normalised to the busiest node.
    """
    headway = {
        r.route_id: (r.peak_headway_min or r.offpeak_headway_min or 60.0) for r in routes
    }
    spread = dict(zip(nodes["node_id"], nodes["spread_m"], strict=True))
    raw = []
    for s in stations:
        ids = route_map["route_ids"].get(s.node_id, [])
        n = len(ids)
        if n < 2:
            continue
        pairs = n * (n - 1) // 2
        wait = float(np.mean([headway.get(r, 60.0) / 2 for r in ids]))
        walk = 1 + spread.get(s.node_id, 0.0) / 200.0
        mode_pen = 1 + 0.25 * (len(s.modes) - 1)
        tfi = pairs * wait * walk * mode_pen
        importance = n * math.sqrt(max(s.peak_departures, 0))
        raw.append((s, n, pairs, wait, tfi, importance))

    top = max((r[5] for r in raw), default=1.0) or 1.0
    result = [
        TransferNode(
            node_id=s.node_id,
            name=s.name,
            routes_served=n,
            modes=s.modes,
            transfer_pairs=pairs,
            expected_transfer_wait_min=round(wait, 2),
            intra_node_spread_m=spread.get(s.node_id, 0.0),
            transfer_friction_index=round(tfi, 2),
            hub_score=round(100 * imp / top, 1),
        )
        for s, n, pairs, wait, tfi, imp in raw
    ]
    return sorted(result, key=lambda t: t.hub_score, reverse=True)


def compute_catchments(
    nodes: gpd.GeoDataFrame, config: AnalysisConfig
) -> tuple[list[CatchmentKPI], dict[float, object]]:
    """Dissolved walk-catchment buffers around station nodes (metric CRS)."""
    rapid = nodes[nodes["modes"].map(lambda m: bool(set(m) & RAPID_MODES))]
    kpis, polys = [], {}
    for radius in config.catchment_radii_m:
        union = unary_union(nodes.geometry.buffer(radius, quad_segs=16).to_numpy())
        rapid_area = (
            unary_union(rapid.geometry.buffer(radius, quad_segs=16).to_numpy()).area
            if len(rapid)
            else 0.0
        )
        polys[radius] = union
        kpis.append(
            CatchmentKPI(
                radius_m=radius,
                area_km2=round(union.area / 1e6, 3),
                rapid_transit_area_km2=round(rapid_area / 1e6, 3),
                nodes=len(nodes),
            )
        )
    return kpis, polys


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def analyze_feed(feed: GTFSFeed, config: AnalysisConfig | None = None) -> AnalysisResult:
    """Run the full KPI pipeline and return the report plus export geometries."""
    config = config or AnalysisConfig()
    net = prepare_network(feed, config)
    lines, trip_len = route_geometries(net)
    routes = compute_route_kpis(net, lines, trip_len, config)
    nodes = build_station_nodes(net, config)
    stations, route_map = compute_station_kpis(net, nodes, config)
    transfers = compute_transfer_nodes(stations, route_map, routes, nodes)
    catchments, polys = compute_catchments(nodes, config)

    by_mode_count: dict[str, int] = {}
    by_mode_km: dict[str, float] = {}
    for r in routes:
        by_mode_count[r.mode] = by_mode_count.get(r.mode, 0) + 1
        by_mode_km[r.mode] = round(by_mode_km.get(r.mode, 0.0) + r.length_km, 2)
    peak = [r.peak_headway_min for r in routes if r.peak_headway_min]
    off = [r.offpeak_headway_min for r in routes if r.offpeak_headway_min]
    bounds = net.stops.to_crs(WGS84).total_bounds

    summary = NetworkSummary(
        agency=feed.agency_name,
        service_day=net.service_label,
        metric_crs=net.crs.to_string(),
        routes=len(routes),
        routes_by_mode=by_mode_count,
        stops=len(net.stops),
        station_nodes=len(nodes),
        trips_per_day=sum(r.trips_per_day for r in routes),
        route_km_total=round(sum(r.length_km for r in routes), 2),
        route_km_by_mode=by_mode_km,
        vehicle_km_per_day=round(sum(r.vehicle_km_per_day for r in routes), 1),
        mean_peak_headway_min=round(float(np.mean(peak)), 2) if peak else None,
        mean_offpeak_headway_min=round(float(np.mean(off)), 2) if off else None,
        transfer_nodes=len(transfers),
        bbox_wgs84=tuple(round(float(v), 6) for v in bounds),
    )
    report = NetworkReport(
        source=str(feed.source),
        config=config,
        summary=summary,
        routes=routes,
        stations=stations,
        transfer_nodes=transfers,
        catchments=catchments,
        warnings=net.warnings,
    )

    # One representative line per route (direction "0" preferred) for mapping.
    lines = lines.sort_values(["route_id", "direction_id"]).drop_duplicates("route_id")
    route_attr = {r.route_id: r for r in routes}
    lines = lines.assign(
        name=lines["route_id"].map(lambda r: route_attr[r].name),
        long_name=lines["route_id"].map(lambda r: route_attr[r].long_name),
        mode=lines["route_id"].map(lambda r: route_attr[r].mode),
        color=lines["route_id"].map(lambda r: route_attr[r].color),
    )
    node_routes = route_map["route_ids"]
    nodes = nodes.assign(
        route_ids=nodes["node_id"].map(lambda n: list(node_routes.get(n, []))),
        n_routes=nodes["node_id"].map(lambda n: len(node_routes.get(n, []))),
        is_interchange=nodes["node_id"].map(lambda n: len(node_routes.get(n, [])) >= 2),
    )
    return AnalysisResult(
        report=report, crs=net.crs, route_lines=lines, nodes=nodes, catchment_polygons=polys
    )


__all__ = [
    "AnalysisResult",
    "MODE_COLORS",
    "PreparedNetwork",
    "analyze_feed",
    "build_station_nodes",
    "compute_catchments",
    "prepare_network",
    "route_geometries",
]
