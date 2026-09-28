"""Publication-ready standalone SVG map renderer.

Layers are emitted as named ``<g id="…">`` groups (background, districts,
catchments, routes, stations, labels, legend, scale bar, title) so the file
opens cleanly for touch-up in Inkscape or Illustrator.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from xml.sax.saxutils import escape, quoteattr

import geopandas as gpd
from pydantic import BaseModel, Field
from shapely.geometry import box

from transit_scope import __version__
from transit_scope.errors import RenderError
from transit_scope.gis_svg.geojson_io import GeoJSONLayers, empty_layer
from transit_scope.gis_svg.projection import (
    Frame,
    ViewportTransform,
    geometry_to_path,
    nice_distance,
)
from transit_scope.gis_svg.themes import Theme, get_theme
from transit_scope.gtfs.models import RAPID_MODES
from transit_scope.utils.geo import resolve_metric_crs

TITLE_BLOCK_H = 118
MARGIN = 36


class RenderOptions(BaseModel):
    """User-facing map options."""

    width: int = Field(default=1600, ge=400, le=10000)
    height: int = Field(default=1200, ge=300, le=10000)
    theme: str = "dark"
    title: str = "Riyadh Transit Network"
    subtitle: str | None = None
    catchment_radii_m: list[float] = Field(default_factory=lambda: [500.0])
    catchment_rapid_only: bool = True
    station_labels: str = Field(default="interchanges", pattern="^(all|interchanges|none)$")
    district_labels: bool = True
    show_bus_stops: bool = False
    metric_crs: str | None = None
    source_note: str | None = None


@dataclass
class MapLayers:
    """Input layers in WGS84. Any may be empty."""

    districts: gpd.GeoDataFrame = field(default_factory=empty_layer)
    routes: gpd.GeoDataFrame = field(default_factory=empty_layer)  # name, mode, color
    stations: gpd.GeoDataFrame = field(default_factory=empty_layer)  # name, modes, n_routes
    extra_points: gpd.GeoDataFrame = field(default_factory=empty_layer)
    extra_lines: gpd.GeoDataFrame = field(default_factory=empty_layer)

    @classmethod
    def from_geojson(cls, layers: GeoJSONLayers) -> MapLayers:
        return cls(
            districts=layers.polygons, extra_points=layers.points, extra_lines=layers.lines
        )


# --------------------------------------------------------------------------- #
# Tiny SVG builder
# --------------------------------------------------------------------------- #


def _attrs(**kwargs: object) -> str:
    parts = []
    for key, value in kwargs.items():
        if value is None:
            continue
        name = key.rstrip("_").replace("_", "-")
        if isinstance(value, float):
            value = f"{value:.2f}".rstrip("0").rstrip(".")
        parts.append(f"{name}={quoteattr(str(value))}")
    return " ".join(parts)


def _tag(tag: str, text: str | None = None, **kwargs: object) -> str:
    attrs = _attrs(**kwargs)
    head = f"<{tag} {attrs}" if attrs else f"<{tag}"
    return f"{head}/>" if text is None else f"{head}>{escape(text)}</{tag}>"


def _group(group_id: str, children: list[str], **kwargs: object) -> str:
    if not children:
        return ""
    return f'<g {_attrs(id=group_id, **kwargs)}>\n' + "\n".join(children) + "\n</g>"


# --------------------------------------------------------------------------- #
# Renderer
# --------------------------------------------------------------------------- #


@dataclass
class _Label:
    x0: float
    y0: float
    x1: float
    y1: float

    def overlaps(self, other: _Label) -> bool:
        return not (
            self.x1 < other.x0 or other.x1 < self.x0 or self.y1 < other.y0 or other.y1 < self.y0
        )


class SvgMapRenderer:
    """Render :class:`MapLayers` into a standalone SVG document string."""

    def __init__(self, layers: MapLayers, options: RenderOptions | None = None) -> None:
        self.options = options or RenderOptions()
        self.theme: Theme = get_theme(self.options.theme)
        self.layers = layers
        self._placed: list[_Label] = []
        self._prepare()

    # -- setup -------------------------------------------------------------- #

    def _prepare(self) -> None:
        frames = [
            g for g in (
                self.layers.districts, self.layers.routes, self.layers.stations,
                self.layers.extra_points, self.layers.extra_lines,
            ) if g is not None and not g.empty
        ]
        if not frames:
            raise RenderError("Nothing to draw: all input layers are empty.")
        combined = gpd.GeoSeries(
            [geom for g in frames for geom in g.geometry], crs=frames[0].crs or "EPSG:4326"
        )
        centroid = box(*combined.total_bounds).centroid
        try:
            self.crs = resolve_metric_crs(self.options.metric_crs, centroid.x, centroid.y)
        except Exception as exc:
            raise RenderError(f"Invalid metric CRS: {exc}") from exc

        def proj(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
            if gdf is None or gdf.empty:
                return empty_layer().to_crs(self.crs)
            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:4326")
            return gdf.to_crs(self.crs)

        self.districts = proj(self.layers.districts)
        self.routes = proj(self.layers.routes)
        self.stations = proj(self.layers.stations)
        self.extra_points = proj(self.layers.extra_points)
        self.extra_lines = proj(self.layers.extra_lines)

        W, H = self.options.width, self.options.height
        top = TITLE_BLOCK_H + 8
        self.frame = Frame(MARGIN, top, W - 2 * MARGIN, H - top - MARGIN)
        bounds = gpd.GeoSeries(
            [g for gdf in (self.districts, self.routes, self.stations, self.extra_points,
                           self.extra_lines) for g in gdf.geometry],
            crs=self.crs,
        ).total_bounds
        self.tf = ViewportTransform.fit(tuple(bounds), self.frame)

    # -- helpers ------------------------------------------------------------ #

    def _route_color(self, row) -> str:
        color = getattr(row, "color", None)
        if isinstance(color, str) and color.startswith("#"):
            return color
        return self.theme.bus_fallback

    def _station_color(self, route_ids: list[str]) -> str:
        if not len(self.routes) or "route_id" not in self.routes:
            return self.theme.text
        colors = self.routes.set_index("route_id")
        for rid in route_ids or []:
            if rid in colors.index and colors.at[rid, "mode"] in RAPID_MODES:
                return str(colors.at[rid, "color"])
        return self.theme.text

    def _reserve(self, x0: float, y0: float, w: float, h: float) -> None:
        """Mark a rectangle (legend, scale bar…) as off-limits for labels."""
        self._placed.append(_Label(x0, y0, x0 + w, y0 + h))

    def _place_label(
        self, x: float, y: float, text: str, size: float, centred: bool = False
    ) -> tuple[float, float, str] | None:
        """Greedy collision avoidance: try right, left, above, below (or centred only)."""
        w, h = len(text) * size * 0.56, size * 1.1
        candidates = (
            [(x, y + size * 0.35, "middle")]
            if centred
            else [
                (x + 8, y + size * 0.35, "start"),
                (x - 8, y + size * 0.35, "end"),
                (x, y - 10, "middle"),
                (x, y + size + 8, "middle"),
                (x + 7, y - 8, "start"),
                (x + 7, y + size + 5, "start"),
                (x - 7, y - 8, "end"),
                (x - 7, y + size + 5, "end"),
            ]
        )
        for cx, cy, anchor in candidates:
            x0 = cx if anchor == "start" else cx - w if anchor == "end" else cx - w / 2
            rect = _Label(x0, cy - h * 0.8, x0 + w, cy + h * 0.2)
            inside = (
                rect.x0 >= self.frame.x and rect.x1 <= self.frame.x + self.frame.width
                and rect.y0 >= self.frame.y and rect.y1 <= self.frame.y + self.frame.height
            )
            if inside and not any(rect.overlaps(p) for p in self._placed):
                self._placed.append(rect)
                return cx, cy, anchor
        return None

    # -- layers ------------------------------------------------------------- #

    def _background(self) -> str:
        t, W, H = self.theme, self.options.width, self.options.height
        return _group("background", [
            _tag("rect", x=0, y=0, width=W, height=H, fill=t.background),
            _tag("rect", x=self.frame.x, y=self.frame.y, width=self.frame.width,
                 height=self.frame.height, fill=t.land, rx=6),
        ])

    def _districts(self) -> str:
        t = self.theme
        shapes = []
        for row in self.districts.itertuples():
            d = geometry_to_path(row.geometry, self.tf)
            if d:
                shapes.append(_tag("path", d=d, fill=t.district_fill, stroke=t.district_stroke,
                                   stroke_width=0.9, fill_rule="evenodd",
                                   stroke_linejoin="round"))
        return _group("districts", shapes)

    def _district_labels(self) -> str:
        """District names, placed last so they yield to stations and their labels."""
        t = self.theme
        if not self.options.district_labels:
            return ""
        labels = []
        for row in self.districts.itertuples():
            if not row.name:
                continue
            p = row.geometry.representative_point()
            x, y = self.tf.point(p.x, p.y)
            text = str(row.name).upper()
            # Letter-spacing widens caps; size the collision box accordingly.
            spot = self._place_label(x, y, text + " " * (len(text) // 5), 9.5, centred=True)
            if spot is None:
                continue
            labels.append(_tag("text", text, x=round(x, 1), y=round(spot[1], 1),
                               text_anchor="middle"))
        return _group("district-labels", labels, font_family=t.font_family, font_weight=500,
                      font_size=9.5, letter_spacing=0.8, fill=t.district_label)

    def _catchments(self) -> str:
        t = self.theme
        if self.stations.empty or not self.options.catchment_radii_m:
            return ""
        stations = self.stations
        if self.options.catchment_rapid_only and "modes" in stations:
            rapid = stations[stations["modes"].map(lambda m: bool(set(m) & RAPID_MODES))]
            stations = rapid if len(rapid) else stations
        out = []
        radii = sorted(self.options.catchment_radii_m, reverse=True)
        for i, radius in enumerate(radii):
            r_px = self.tf.length(radius)
            fill_op = t.catchment_fill_opacity * (1 + i * 0.6)
            circles = [
                _tag("circle", cx=round(x, 2), cy=round(y, 2), r=round(r_px, 2))
                for x, y in (self.tf.point(p.x, p.y) for p in stations.geometry)
            ]
            dash = "4 3" if i == 0 and len(radii) > 1 else None
            out.append(_group(
                f"catchment-{int(radius)}m", circles, fill=t.catchment,
                fill_opacity=round(min(fill_op, 0.5), 3), stroke=t.catchment,
                stroke_opacity=t.catchment_stroke_opacity, stroke_width=0.8,
                stroke_dasharray=dash,
            ))
        return _group("catchments", out)

    def _routes(self) -> str:
        t = self.theme
        if self.routes.empty:
            return ""
        is_rapid = self.routes["mode"].isin(RAPID_MODES) if "mode" in self.routes else False
        bus, rapid = self.routes[~is_rapid], self.routes[is_rapid]
        out = []
        bus_paths = [
            _tag("path", d=geometry_to_path(r.geometry, self.tf), stroke=self._route_color(r))
            for r in bus.itertuples()
        ]
        out.append(_group("routes-surface", bus_paths, fill="none", stroke_width=1.8,
                          stroke_opacity=0.85, stroke_linecap="round", stroke_linejoin="round",
                          stroke_dasharray="6 3"))
        casing = [_tag("path", d=geometry_to_path(r.geometry, self.tf)) for r in rapid.itertuples()]
        out.append(_group("routes-rapid-casing", casing, fill="none", stroke=t.route_casing,
                          stroke_width=7.5, stroke_linecap="round", stroke_linejoin="round"))
        lines = [
            _tag("path", d=geometry_to_path(r.geometry, self.tf), stroke=self._route_color(r),
                 **{"data-route": getattr(r, "name", "")})
            for r in rapid.itertuples()
        ]
        out.append(_group("routes-rapid", lines, fill="none", stroke_width=4.5,
                          stroke_linecap="round", stroke_linejoin="round"))
        return _group("routes", out)

    def _extra_features(self) -> str:
        t = self.theme
        out = []
        if not self.extra_lines.empty:
            out.append(_group("geojson-lines", [
                _tag("path", d=geometry_to_path(r.geometry, self.tf),
                     stroke=getattr(r, "color", None) or getattr(r, "stroke", None)
                     or t.feature_color)
                for r in self.extra_lines.itertuples()
            ], fill="none", stroke_width=2.2, stroke_linecap="round"))
        if not self.extra_points.empty:
            pts = []
            for geom in self.extra_points.geometry:
                for p in getattr(geom, "geoms", [geom]):
                    x, y = self.tf.point(p.x, p.y)
                    pts.append(_tag("rect", x=round(x - 3.5, 2), y=round(y - 3.5, 2),
                                    width=7, height=7, transform=f"rotate(45 {x:.2f} {y:.2f})"))
            out.append(_group("geojson-points", pts, fill=t.feature_color, stroke=t.background,
                              stroke_width=1))
        return _group("geojson-features", out)

    def _stations(self) -> tuple[str, list[tuple[float, float, str, bool]]]:
        t = self.theme
        if self.stations.empty:
            return "", []
        regular, interchange, bus_stops = [], [], []
        label_queue = []
        for row in self.stations.itertuples():
            x, y = self.tf.point(row.geometry.x, row.geometry.y)
            modes = set(getattr(row, "modes", []) or [])
            is_rapid = bool(modes & RAPID_MODES) or not modes
            is_x = bool(getattr(row, "is_interchange", False))
            if is_x:
                interchange.append(_tag("circle", cx=round(x, 2), cy=round(y, 2), r=6.5))
            elif is_rapid:
                regular.append(_tag("circle", cx=round(x, 2), cy=round(y, 2), r=4.2,
                                    stroke=self._station_color(getattr(row, "route_ids", []))))
            elif self.options.show_bus_stops:
                bus_stops.append(_tag("circle", cx=round(x, 2), cy=round(y, 2), r=2.2))
            else:
                continue
            marker = 7.0 if is_x else 5.0
            self._reserve(x - marker, y - marker, 2 * marker, 2 * marker)
            label_queue.append((x, y, str(row.name), is_x))
        groups = [
            _group("bus-stops", bus_stops, fill=t.bus_fallback, stroke=t.background,
                   stroke_width=0.8),
            _group("stations-regular", regular, fill=t.station_fill, stroke_width=2.2),
            _group("stations-interchange", interchange, fill=t.interchange_fill,
                   stroke=t.interchange_stroke, stroke_width=2.6),
        ]
        return _group("stations", [g for g in groups if g]), label_queue

    def _station_labels(self, queue: list[tuple[float, float, str, bool]]) -> str:
        t, mode = self.theme, self.options.station_labels
        if mode == "none":
            return ""
        out = []
        # Interchanges first so they win collisions.
        for x, y, name, is_x in sorted(queue, key=lambda q: not q[3]):
            if mode == "interchanges" and not is_x:
                continue
            size = 12.0 if is_x else 10.0
            spot = self._place_label(x, y, name, size)
            if spot is None:
                continue
            lx, ly, anchor = spot
            out.append(_tag("text", name, x=round(lx, 1), y=round(ly, 1), text_anchor=anchor,
                            font_size=size, font_weight=600 if is_x else 400))
        return _group("station-labels", out, font_family=t.font_family, fill=t.text,
                      stroke=t.background, stroke_width=3.2, stroke_linejoin="round",
                      paint_order="stroke")

    def _legend(self) -> str:
        t = self.theme
        rows: list[tuple[str, str]] = []  # (symbol svg, label)
        sw = 28

        def line_sym(color: str, width: float, dash: str | None = None) -> str:
            return _tag("line", x1=0, y1=0, x2=sw, y2=0, stroke=color, stroke_width=width,
                        stroke_linecap="round", stroke_dasharray=dash)

        if not self.routes.empty:
            is_rapid = self.routes["mode"].isin(RAPID_MODES)
            for r in self.routes[is_rapid].sort_values("name").itertuples():
                label = f"Line {r.name}"
                long_name = getattr(r, "long_name", "")
                if long_name:
                    label += f" · {str(long_name).split(':')[0]}"
                rows.append((line_sym(self._route_color(r), 4.5), label))
            bus = self.routes[~is_rapid]
            if 0 < len(bus) <= 5:
                for r in bus.sort_values("name").itertuples():
                    rows.append((line_sym(self._route_color(r), 1.8, "6 3"), f"Bus {r.name}"))
            elif len(bus):
                label = f"Bus network ({len(bus)} routes)"
                rows.append((line_sym(t.bus_fallback, 1.8, "6 3"), label))
        if not self.stations.empty:
            rows.append((_tag("circle", cx=sw / 2, cy=0, r=4.2, fill=t.station_fill,
                              stroke=t.text, stroke_width=2.2), "Station"))
            rows.append((_tag("circle", cx=sw / 2, cy=0, r=6.5, fill=t.interchange_fill,
                              stroke=t.interchange_stroke, stroke_width=2.6), "Interchange"))
            for radius in sorted(self.options.catchment_radii_m):
                rows.append((_tag("circle", cx=sw / 2, cy=0, r=7, fill=t.catchment,
                                  fill_opacity=0.25, stroke=t.catchment, stroke_opacity=0.6),
                             f"{radius:,.0f} m walk catchment"))
        if not self.extra_points.empty:
            rows.append((_tag("rect", x=sw / 2 - 3.5, y=-3.5, width=7, height=7,
                              fill=t.feature_color,
                              transform=f"rotate(45 {sw / 2} 0)"), "GeoJSON point feature"))
        if not self.extra_lines.empty:
            rows.append((line_sym(t.feature_color, 2.2), "GeoJSON line feature"))
        if not self.districts.empty:
            rows.append((_tag("rect", x=2, y=-6, width=sw - 4, height=12, fill=t.district_fill,
                              stroke=t.district_stroke), "District boundary"))
        if not rows:
            return ""

        row_h, pad = 21, 14
        width = min(330, self.frame.width * 0.4)
        height = pad * 2 + 20 + row_h * len(rows)
        x0 = self.frame.x + 16
        y0 = self.frame.y + self.frame.height - height - 16
        self._reserve(x0, y0, width, height)
        items = [
            _tag("rect", x=0, y=0, width=round(width, 1), height=height, rx=6,
                 fill=t.legend_background, fill_opacity=t.legend_opacity,
                 stroke=t.district_stroke, stroke_width=0.8),
            _tag("text", "LEGEND", x=pad, y=pad + 10, font_size=10.5, font_weight=700,
                 letter_spacing=1.4, fill=t.text_muted),
        ]
        for i, (symbol, label) in enumerate(rows):
            cy = pad + 20 + row_h * i + row_h / 2
            items.append(f'<g transform="translate({pad},{cy:.1f})">{symbol}</g>')
            items.append(_tag("text", label, x=pad + sw + 10, y=round(cy + 4, 1),
                              font_size=11.5, fill=t.text))
        return _group("legend", items, transform=f"translate({x0:.1f},{y0:.1f})",
                      font_family=t.font_family)

    def _scale_bar(self) -> str:
        t = self.theme
        metres = nice_distance(self.frame.width * 0.18 / self.tf.scale)
        px = self.tf.length(metres)
        x0 = self.frame.x + self.frame.width - px - 28
        y0 = self.frame.y + self.frame.height - 30
        unit, div = ("km", 1000) if metres >= 1000 else ("m", 1)
        self._reserve(x0 - 20, y0 - 20, px + 44, 30)
        items = []
        for i in range(4):
            items.append(_tag("rect", x=round(i * px / 4, 2), y=0, width=round(px / 4, 2),
                              height=6, fill=t.text if i % 2 == 0 else t.land,
                              stroke=t.text, stroke_width=0.8))
        for i, frac in enumerate((0, 0.5, 1)):
            value = metres * frac / div
            text = f"{value:g}" + (f" {unit}" if i == 2 else "")
            items.append(_tag("text", text, x=round(px * frac, 2), y=-5, text_anchor="middle",
                              font_size=10.5, fill=t.text))
        return _group("scale-bar", items, transform=f"translate({x0:.1f},{y0:.1f})",
                      font_family=t.font_family)

    def _north_arrow(self) -> str:
        t = self.theme
        x = self.frame.x + self.frame.width - 34
        y = self.frame.y + 26
        self._reserve(x - 12, y - 18, 24, 46)
        return _group("north-arrow", [
            _tag("path", d="M0,-16 L8,8 L0,3 L-8,8 Z", fill=t.text),
            _tag("text", "N", x=0, y=24, text_anchor="middle", font_size=11,
                 font_weight=700, fill=t.text),
        ], transform=f"translate({x:.1f},{y:.1f})", font_family=t.font_family)

    def _title_block(self) -> str:
        t, o = self.theme, self.options
        n_routes = len(self.routes)
        n_stations = len(self.stations)
        subtitle = o.subtitle or (
            f"{n_routes} routes · {n_stations} stations · "
            + (f"{', '.join(f'{r:,.0f} m' for r in o.catchment_radii_m)} catchments · "
               if o.catchment_radii_m and n_stations else "")
            + f"{self.crs.to_string()}"
        )
        credit = f"riyadh-transit-scope {__version__} · {date.today().isoformat()}"
        if o.source_note:
            credit = f"{o.source_note} · {credit}"
        W = o.width
        return _group("title-block", [
            _tag("rect", x=MARGIN, y=MARGIN - 6, width=4, height=58, fill=t.accent, rx=2),
            _tag("text", o.title, x=MARGIN + 18, y=MARGIN + 22, font_size=30, font_weight=700,
                 fill=t.text, letter_spacing=-0.3),
            _tag("text", subtitle, x=MARGIN + 18, y=MARGIN + 48, font_size=14,
                 fill=t.text_muted),
            _tag("text", credit, x=W - MARGIN, y=MARGIN + 48, font_size=11,
                 fill=t.text_muted, text_anchor="end"),
        ], font_family=t.font_family)

    # -- public ------------------------------------------------------------- #

    def render(self) -> str:
        """Return the complete SVG document."""
        o = self.options
        self._placed = []
        districts = self._districts()
        # Placement priority: station markers → map furniture → station labels
        # → district labels. Each step reserves space the next must avoid.
        stations, label_queue = self._stations()
        legend, scale_bar, north = self._legend(), self._scale_bar(), self._north_arrow()
        labels = self._station_labels(label_queue)
        district_labels = self._district_labels()

        f = self.frame
        clip_rect = _tag("rect", x=f.x, y=f.y, width=f.width, height=f.height, rx=6)
        clip = f'<clipPath id="map-frame">{clip_rect}</clipPath>'
        map_body = "\n".join(filter(None, [
            districts, district_labels, self._catchments(), self._routes(),
            self._extra_features(), stations,
        ]))
        parts = [
            '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{o.width}" height="{o.height}" '
            f'viewBox="0 0 {o.width} {o.height}">',
            _tag("title", o.title),
            _tag("desc", f"Transit map rendered by riyadh-transit-scope in {self.crs.to_string()}"),
            f"<defs>{clip}</defs>",
            self._background(),
            f'<g id="map" clip-path="url(#map-frame)">\n{map_body}\n</g>',
            labels,
            legend,
            scale_bar,
            north,
            self._title_block(),
            "</svg>",
        ]
        return "\n".join(p for p in parts if p) + "\n"


def render_svg(layers: MapLayers, options: RenderOptions | None = None) -> str:
    """Convenience wrapper around :class:`SvgMapRenderer`."""
    return SvgMapRenderer(layers, options).render()
