from __future__ import annotations

import json
import xml.etree.ElementTree as ET

import pytest
from shapely.geometry import LineString, Polygon

from transit_scope.errors import InputFileError, RenderError
from transit_scope.gis_svg import (
    MapLayers,
    RenderOptions,
    layers_from_analysis,
    load_geojson,
    render_svg,
)
from transit_scope.gis_svg.projection import (
    Frame,
    ViewportTransform,
    geometry_to_path,
    nice_distance,
)

SVG_NS = "{http://www.w3.org/2000/svg}"


def _ids(svg: str) -> set[str]:
    root = ET.fromstring(svg.split("?>", 1)[1])
    return {el.get("id") for el in root.iter() if el.get("id")}


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_full_map_is_valid_svg(sample_result, sample_districts, theme):
    layers = layers_from_analysis(sample_result, load_geojson(sample_districts))
    svg = render_svg(layers, RenderOptions(theme=theme, catchment_radii_m=[500, 1000]))
    ids = _ids(svg)
    for group in ("background", "districts", "district-labels", "catchment-500m",
                  "catchment-1000m", "routes-rapid", "routes-surface", "stations",
                  "station-labels", "legend", "scale-bar", "north-arrow", "title-block"):
        assert group in ids, group
    assert 'viewBox="0 0 1600 1200"' in svg
    assert "Riyadh Transit Network" in svg
    assert "#0072CE" in svg  # Blue line colour from routes.txt
    assert "EPSG:32638" in svg


def test_geojson_only_map(sample_districts):
    svg = render_svg(MapLayers.from_geojson(load_geojson(sample_districts)),
                     RenderOptions(title="Districts"))
    ids = _ids(svg)
    assert "districts" in ids and "routes" not in ids and "stations" not in ids


def test_geojson_points_and_lines(tmp_path):
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"NAME": "Poly"},
         "geometry": {"type": "Polygon",
                      "coordinates": [[[46.6, 24.6], [46.8, 24.6], [46.8, 24.8], [46.6, 24.6]]]}},
        {"type": "Feature", "properties": {"name": "Stop"},
         "geometry": {"type": "Point", "coordinates": [46.7, 24.7]}},
        {"type": "Feature", "properties": {"name": "Road", "color": "#123456"},
         "geometry": {"type": "LineString", "coordinates": [[46.6, 24.7], [46.8, 24.7]]}},
    ]}
    path = tmp_path / "mixed.geojson"
    path.write_text(json.dumps(fc))
    layers = load_geojson(path)
    assert len(layers.polygons) == len(layers.points) == len(layers.lines) == 1
    assert layers.polygons.iloc[0]["name"] == "Poly"
    svg = render_svg(MapLayers.from_geojson(layers))
    assert {"geojson-points", "geojson-lines"} <= _ids(svg)
    assert "#123456" in svg


def test_geojson_errors(tmp_path):
    with pytest.raises(InputFileError):
        load_geojson(tmp_path / "missing.geojson")
    bad = tmp_path / "bad.geojson"
    bad.write_text("{not json")
    with pytest.raises(InputFileError):
        load_geojson(bad)
    empty = tmp_path / "empty.geojson"
    empty.write_text('{"type": "FeatureCollection", "features": []}')
    with pytest.raises(InputFileError):
        load_geojson(empty)


def test_empty_layers_raise():
    with pytest.raises(RenderError):
        render_svg(MapLayers())


def test_viewport_preserves_aspect_and_flips_y():
    tf = ViewportTransform.fit((0, 0, 1000, 500), Frame(0, 0, 400, 400), padding=0)
    x0, y0 = tf.point(0, 0)
    x1, y1 = tf.point(1000, 500)
    assert tf.scale == pytest.approx(0.4)
    assert x1 - x0 == pytest.approx(400)
    assert y0 > y1  # north is up
    assert (y0 - y1) == pytest.approx(200)  # 2:1 aspect kept, centred vertically


def test_geometry_to_path():
    tf = ViewportTransform.fit((0, 0, 10, 10), Frame(0, 0, 100, 100), padding=0)
    square = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)], holes=[[(2, 2), (4, 2), (4, 4)]])
    d = geometry_to_path(square, tf)
    assert d.count("M") == 2 and d.count("Z") == 2
    assert geometry_to_path(LineString([(0, 0), (10, 10)]), tf) == "M0.00,100.00 L100.00,0.00"


@pytest.mark.parametrize(("target", "nice"), [(3700, 2500), (9999, 5000), (180, 100), (21, 20)])
def test_nice_distance(target, nice):
    assert nice_distance(target) == nice


def test_invalid_options():
    with pytest.raises(ValueError):
        RenderOptions(station_labels="some")
