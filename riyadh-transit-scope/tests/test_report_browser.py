"""End-to-end interaction checks for the HTML report's map (needs Playwright + Chromium).

Skipped automatically when Playwright or a Chromium build is unavailable.
Run with ``pip install playwright`` and either ``playwright install chromium`` or
``TRANSIT_CHROMIUM=/path/to/chromium``.
"""

from __future__ import annotations

import os
import shutil

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

from transit_scope.html_report import ReportInputs, build_html_report  # noqa: E402

CHROMIUM = os.environ.get("TRANSIT_CHROMIUM") or next(
    (p for p in ("/opt/pw-browsers/chromium", shutil.which("chromium") or "")
     if p and os.path.exists(p)), None)


@pytest.fixture(scope="module")
def page_url(tmp_path_factory):
    path = tmp_path_factory.mktemp("report") / "report.html"
    path.write_text(build_html_report(ReportInputs()), encoding="utf-8")
    return path.as_uri()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch(executable_path=CHROMIUM) if CHROMIUM else (
                p.chromium.launch())
        except Exception as exc:  # pragma: no cover - environment dependent
            pytest.skip(f"Chromium unavailable: {exc}")
        yield b
        b.close()


ON_SCREEN_STATION = """() => {
  const sv = document.getElementById('map-svg').getBoundingClientRect();
  const cs = [...document.querySelectorAll("#g-stations circle.mk")]
    .map(c => c.getBoundingClientRect())
    .filter(r => r.x > sv.x + 60 && r.right < sv.right - 60 && r.y > Math.max(sv.y, 0) + 60
            && r.bottom < Math.min(sv.bottom, innerHeight) - 60);
  const r = cs[Math.floor(cs.length / 2)]; return [r.x + r.width / 2, r.y + r.height / 2]; }"""


@pytest.mark.parametrize("viewport", [(1400, 1000), (390, 844)], ids=["desktop", "phone"])
def test_map_interactions(browser, page_url, viewport):
    phone = viewport[0] < 500
    page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]},
                            has_touch=phone)
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(page_url)
    page.wait_for_timeout(600)
    assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    assert page.locator("#g-lines .ln").count() == 6
    assert page.locator("#g-stations circle.mk").count() == 83

    page.evaluate("document.getElementById('map-svg')"
                  ".scrollIntoView({block: 'center', behavior: 'instant'})")
    page.wait_for_timeout(300)
    before = page.get_attribute("#world", "transform")
    x, y = page.evaluate(ON_SCREEN_STATION)
    (page.touchscreen.tap if phone else page.mouse.click)(x, y)
    page.wait_for_timeout(700)
    assert page.locator("#map-panel .eyebrow").first.inner_text().lower() == "station"
    assert page.get_attribute("#world", "transform") != before  # flew to the station

    page.fill("#map-search", "Qasr Al Hokm")
    page.press("#map-search", "Enter")
    page.wait_for_timeout(600)
    assert page.locator("#map-panel h3").inner_text() == "Qasr Al Hokm"
    assert page.locator("#map-panel .ar").inner_text() == "قصر الحكم"
    page.locator("#map-panel [data-act=line]").first.click()
    page.wait_for_timeout(600)
    assert page.locator("#map-panel h3").inner_text() == "Blue Line"
    assert page.locator("#map-panel .order li").count() == 25

    page.fill("#map-search", "Al Olaya District")
    page.press("#map-search", "Enter")
    page.wait_for_timeout(600)
    assert page.locator("#map-panel .eyebrow").first.inner_text().lower() == "neighbourhood"

    chip = page.locator(".line-chip").nth(3)
    chip.click()
    assert chip.get_attribute("aria-pressed") == "false"
    assert page.evaluate(
        "getComputedStyle(document.querySelectorAll('#g-lines .ln')[3]).display") == "none"
    chip.click()

    page.check("#lyr-heat")
    r_before = float(page.get_attribute("#g-catch circle >> nth=0", "r"))
    page.locator("#in-temp").fill("48")
    page.dispatch_event("#in-temp", "input")
    assert float(page.get_attribute("#g-catch circle >> nth=0", "r")) < r_before
    page.check("#lyr-coverage")
    assert page.is_visible("#legend-cov")

    t = page.get_attribute("#world", "transform")
    page.click("#z-in")
    assert page.get_attribute("#world", "transform") != t
    if not phone:
        box = page.locator("#map-svg").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        t = page.get_attribute("#world", "transform")
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 100, cy + 40, steps=4)
        page.mouse.up()
        assert page.get_attribute("#world", "transform") != t
        page.focus("#map-svg")
        page.keyboard.press("Escape")
        assert page.locator("#map-panel .panel-empty").count() == 1
    assert errors == []
    page.close()
