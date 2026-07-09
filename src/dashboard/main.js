// main.js — wires every module into the page. Kept intentionally as plain
// glue code: each module (layers, interactions, measure, radius, compare,
// story, analytics, share) is independently usable/testable; this file just
// hooks DOM events to their public methods.

import { loadAllLayers, buildSearchIndex, studyAreaCenter } from './data.js';
import { createMap, setBasemap } from './map-init.js';
import { addAllLayers, setLayerVisible } from './layers.js';
import { wireInteractions, drawerHtml } from './interactions.js';
import { wireSearch } from './search.js';
import { MeasureTool } from './measure.js';
import { RadiusTool } from './radius.js';
import { CompareView } from './compare.js';
import { StoryTour } from './story.js';
import { ensureAnalyticsLayers, toggleHeatmap, toggleBuffers, computeLandUse, computeGreenBuiltRatio, computeWalkability } from './analytics.js';
import { copyShareLink, downloadScreenshot, decodeViewState } from './share.js';
import { renderLayerPanel, refreshLayerPanelLabels, openDrawer, closeDrawer, toast, $ } from './ui.js';
import { t, setLang, getLang, onLangChange } from './i18n.js';
import { donutSvg, legendRows, scoreBars } from './charts.js';

const data = await loadAllLayers();
const searchIndex = buildSearchIndex(data);
const initialShare = decodeViewState(location.hash);

let currentBasemap = initialShare?.basemap || 'light';
applyTheme(currentBasemap);
if (initialShare?.lang) setLang(initialShare.lang);

window.__diriyahMap = null; // exposed for debugging / browser console inspection
const map = createMap('map', {
  center: initialShare?.center || studyAreaCenter(data.boundary),
  zoom: initialShare?.zoom ?? 15.6,
  bearing: initialShare?.bearing ?? 0,
  pitch: initialShare?.pitch ?? 0,
  basemap: currentBasemap,
});
window.__diriyahMap = map;

const measureTool = new MeasureTool(map, onMeasureResult);
const radiusTool = new RadiusTool(map, data, onRadiusResult);
let compareView;
let storyTour;
let initialLoadDone = false;

function addEverything() {
  addAllLayers(map, data);
  ensureAnalyticsLayers(map, data);
  measureTool.ensureLayers();
  radiusTool.ensureLayers();
}

map.on('load', () => {
  initialLoadDone = true;
  addEverything();
  wireInteractions(map);
  map.addControl(new window.maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  storyTour = new StoryTour(map, data.landmarks, { onStep: renderStoryStep, onExit: exitStory });
  compareView = new CompareView({ mainMap: map, containerId: 'compareContainer', dividerId: 'compareDivider', data });

  renderAnalytics();
});

// Re-add every custom source/layer after a basemap swap (setStyle wipes them).
// Skip any `styledata` firing before the very first `load`: MapLibre can emit
// several premature styledata events while the initial style is still being
// assembled, and layers added during those never make it into the working
// render tree. The first `load` above is the one reliable "style is actually
// ready" signal; every firing after that is a real setStyle() swap.
map.on('styledata', () => {
  if (!initialLoadDone) return;
  addEverything();
});

// ---- layer panel -----------------------------------------------------
renderLayerPanel($('layersPanel'), {
  onToggle: (layerId, visible) => setLayerVisible(map, layerId, visible),
});

// ---- top bar -----------------------------------------------------------
$('basemapSelect').value = currentBasemap;
$('basemapSelect').addEventListener('change', (e) => {
  currentBasemap = e.target.value;
  setBasemap(map, currentBasemap);
  applyTheme(currentBasemap);
});

$('langToggleBtn').addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'ar' : 'en');
});

onLangChange(() => {
  applyStaticStrings();
  refreshLayerPanelLabels($('layersPanel'));
  renderAnalytics();
  if (storyTour?.playing) storyTour.refresh();
});

applyStaticStrings();

$('sidePanelToggle').addEventListener('click', () => $('sidePanel').classList.toggle('open'));
$('drawerClose').addEventListener('click', closeDrawer);

// ---- panel tabs ----------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
  });
});

// ---- search --------------------------------------------------------------
wireSearch($('searchInput'), $('searchResults'), searchIndex, map, {
  onSelect: (item) => {
    const feature = { properties: item.properties, geometry: { coordinates: item.coordinates } };
    openDrawer(drawerHtml(feature));
  },
});

// ---- measurement tools -----------------------------------------------
wireToolToggle('toolMeasureDistance', () => {
  measureTool.start('distance');
  toast(t('measureDistanceHint'));
});
wireToolToggle('toolMeasureArea', () => {
  measureTool.start('area');
  toast(t('measureAreaHint'));
});

function onMeasureResult(result) {
  const el = $('measureResult');
  if (!result) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  if (result.mode === 'distance') {
    el.textContent = result.meters >= 1000 ? `${(result.meters / 1000).toFixed(2)} km` : `${result.meters.toFixed(0)} m`;
  } else {
    el.textContent = result.sqMeters >= 10_000 ? `${(result.sqMeters / 10_000).toFixed(2)} ha` : `${result.sqMeters.toFixed(0)} m²`;
  }
}

// ---- radius filter ---------------------------------------------------
$('toolRadius').addEventListener('click', () => {
  const active = $('toolRadius').classList.toggle('active');
  $('radiusControls').classList.toggle('hidden', !active);
  if (active) {
    deactivateMeasureButtons();
    radiusTool.start();
    toast(t('radiusHint'));
  } else {
    radiusTool.stop();
  }
});
$('radiusSlider').addEventListener('input', (e) => {
  $('radiusValue').textContent = e.target.value;
  radiusTool.setRadius(Number(e.target.value));
});

function onRadiusResult(result) {
  const el = $('radiusResult');
  if (!result) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const lang = getLang();
  const names = result.features.map((f) => (lang === 'ar' && f.properties.name_ar ? f.properties.name_ar : f.properties.name_en));
  el.innerHTML = `${result.features.length} ${lang === 'ar' ? 'موقع ضمن النطاق' : 'places within radius'}<br/><span class="chart-stat">${names.join(', ') || '—'}</span>`;
}

// ---- compare mode ------------------------------------------------------
$('toolCompare').addEventListener('click', () => {
  const active = $('toolCompare').classList.toggle('active');
  $('compareControls').classList.toggle('hidden', !active);
  if (active) compareView.enable($('comparePreset').value);
  else compareView.disable();
});
$('comparePreset').addEventListener('change', (e) => {
  if (compareView.active) compareView.setBasemap(e.target.value);
});

// ---- guided tour ---------------------------------------------------------
$('toolStory').addEventListener('click', () => {
  $('storyOverlay').classList.remove('hidden');
  storyTour.start();
});
$('storyNext').addEventListener('click', () => storyTour.next());
$('storyPrev').addEventListener('click', () => storyTour.prev());
$('storyExit').addEventListener('click', () => storyTour.exit());

function renderStoryStep(step) {
  $('storyIcon').textContent = step.icon || '';
  $('storyProgress').textContent = `${t('storyStep')} ${step.index + 1} / ${step.total}`;
  $('storyTitle').textContent = step.title || '';
  $('storyTag').textContent = step.tag || '';
  $('storyBody').textContent = step.body || '';
  $('storyFact').textContent = step.fact ? `${getLang() === 'ar' ? 'هل تعلم؟' : 'Did you know?'} ${step.fact}` : '';
}
function exitStory() {
  $('storyOverlay').classList.add('hidden');
}

// ---- share / screenshot / clear ------------------------------------------
$('toolShare').addEventListener('click', async () => {
  const ok = await copyShareLink(map, { basemap: currentBasemap, lang: getLang() });
  toast(ok ? t('shareCopied') : location.href);
});
$('toolScreenshot').addEventListener('click', () => {
  downloadScreenshot(map);
  toast(t('screenshotSaved'));
});
$('toolClear').addEventListener('click', () => {
  deactivateMeasureButtons();
  measureTool.clear();
  deactivateRadiusButton();
  radiusTool.clear();
});

function wireToolToggle(id, onActivate) {
  $(id).addEventListener('click', () => {
    const btn = $(id);
    const willActivate = !btn.classList.contains('active');
    deactivateMeasureButtons();
    if (willActivate) {
      btn.classList.add('active');
      deactivateRadiusButton();
      onActivate();
    } else {
      measureTool.stop();
    }
  });
}

function deactivateMeasureButtons() {
  document.querySelectorAll('#toolMeasureDistance, #toolMeasureArea').forEach((b) => b.classList.remove('active'));
  measureTool.stop();
}

function deactivateRadiusButton() {
  $('toolRadius').classList.remove('active');
  $('radiusControls').classList.add('hidden');
  radiusTool.stop();
}

// ---- analytics panel -------------------------------------------------
$('toggleHeatmap').addEventListener('change', (e) => toggleHeatmap(map, e.target.checked));
$('toggleBuffers').addEventListener('change', (e) => toggleBuffers(map, e.target.checked));

function renderAnalytics() {
  const lang = getLang();
  const landUse = computeLandUse(data);
  const ratio = computeGreenBuiltRatio(landUse);
  $('landUseChart').innerHTML = `
    ${donutSvg(landUse.segments, landUse.boundaryArea)}
    ${legendRows(landUse.segments, landUse.boundaryArea, lang)}
    <div class="chart-stat">${lang === 'ar' ? 'نسبة الأخضر إلى المبنى' : 'Green : built-up ratio'} — ${ratio.toFixed(2)} : 1</div>
  `;

  const walk = computeWalkability(data);
  $('walkabilityChart').innerHTML = `
    ${scoreBars(walk.perLandmark, lang)}
    <div class="chart-stat">${lang === 'ar' ? 'المتوسط' : 'Average score'}: ${walk.avgScore} / 100</div>
  `;
}

// ---- theme + static strings ----------------------------------------------
function applyTheme(basemap) {
  document.documentElement.setAttribute('data-theme', basemap === 'light' ? 'light' : 'dark');
}

function applyStaticStrings() {
  document.documentElement.lang = getLang();
  $('appTitle').textContent = t('appTitle');
  $('appSubtitle').textContent = t('appSubtitle');
  $('searchInput').placeholder = t('searchPlaceholder');
  $('langToggleBtn').textContent = t('langToggle');
  document.querySelectorAll('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t);
  });
}
