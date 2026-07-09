// interactions.js — hover tooltips and click-to-expand info drawer for every
// layer. Landmark clicks pull the curated bilingual story straight from
// src/diriyah/culture.js so the dashboard and the 3D game share one source of
// narrative truth.

import { HOVERABLE_LAYER_IDS } from './layers.js';
import { openDrawer } from './ui.js';
import { t, getLang } from './i18n.js';
import { LANDMARKS } from '../diriyah/culture.js';

const maplibregl = window.maplibregl;

export function wireInteractions(map) {
  const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '260px' });

  map.on('mousemove', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: existingLayers(map) });
    if (!features.length) {
      map.getCanvas().style.cursor = '';
      hoverPopup.remove();
      return;
    }
    map.getCanvas().style.cursor = 'pointer';
    hoverPopup.setLngLat(e.lngLat).setHTML(tooltipHtml(features[0])).addTo(map);
  });

  // Plain DOM listener, not map.on('mouseleave', ...): that form is MapLibre's
  // layer-scoped delegate and expects a layer id (or array of ids) as the
  // second argument, not a container element.
  map.getContainer().addEventListener('mouseleave', () => hoverPopup.remove());

  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: existingLayers(map) });
    if (!features.length) return;
    openDrawer(drawerHtml(features[0]));
  });

  function existingLayers(m) {
    return HOVERABLE_LAYER_IDS.filter((id) => m.getLayer(id));
  }
}

function tooltipHtml(feature) {
  const p = feature.properties;
  const lang = getLang();
  const name = lang === 'ar' && p.name_ar ? p.name_ar : p.name_en || p.category || 'Feature';
  const lines = [`<strong>${escapeHtml(name)}</strong>`];
  if (p.tag) lines.push(`<span class="muted">${escapeHtml(p.tag)}</span>`);
  if (p.height_m != null) lines.push(`${t('height')}: ${p.height_m} m`);
  if (p.width_m != null) lines.push(`${t('width')}: ${p.width_m} m`);
  return `<div class="tooltip">${lines.join('<br/>')}</div>`;
}

export function drawerHtml(feature) {
  const p = feature.properties;
  const lang = getLang();
  if (p.category === 'heritage' && LANDMARKS[p.id]) {
    const c = LANDMARKS[p.id];
    return `
      <div class="drawer-card">
        <div class="drawer-icon">${c.icon}</div>
        <h2>${lang === 'ar' ? c.ar : c.en}</h2>
        <p class="tag">${escapeHtml(c.tag)}</p>
        <p class="body">${escapeHtml(c.body)}</p>
        <p class="fact"><strong>${lang === 'ar' ? 'هل تعلم؟' : 'Did you know?'}</strong> ${escapeHtml(c.fact)}</p>
        <p class="source">${t('sourceOsm')}</p>
      </div>`;
  }
  const name = lang === 'ar' && p.name_ar ? p.name_ar : p.name_en;
  const rows = [];
  if (p.tag) rows.push(`<p class="tag">${escapeHtml(p.tag)}</p>`);
  if (p.category) rows.push(`<p>${t('category')}: ${escapeHtml(String(p.category))}</p>`);
  if (p.height_m != null) rows.push(`<p>${t('height')}: ${p.height_m} m</p>`);
  if (p.width_m != null) rows.push(`<p>${t('width')}: ${p.width_m} m</p>`);
  if (p.data_quality === 'approximate') rows.push(`<p class="warn">${t('dataQualityApprox')}</p>`);
  return `
    <div class="drawer-card">
      <h2>${escapeHtml(name || t('layerUrban'))}</h2>
      ${rows.join('')}
      <p class="source">${t('sourceOsm')}</p>
    </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
