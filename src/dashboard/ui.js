// ui.js — small DOM helpers for the drawer, toasts, and legend/layer panel.
// No framework: this dashboard is deliberately dependency-light (see README),
// so the UI chrome is plain DOM built once and mutated in place.

import { t } from './i18n.js';
import { LAYER_DEFS, GROUP_ORDER } from './layers.js';

export function $(id) {
  return document.getElementById(id);
}

export function openDrawer(innerHtml) {
  const drawer = $('drawer');
  $('drawerContent').innerHTML = innerHtml;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

export function closeDrawer() {
  const drawer = $('drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}

let toastTimer = null;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const GROUP_LABEL_KEY = {
  heritage: 'layerHeritage',
  environment: 'layerEnvironment',
  urban: 'layerUrban',
  transport: 'layerTransport',
  hospitality: 'layerHospitality',
  amenity: 'layerAmenity',
  boundary: 'layerBoundary',
};

// Renders the accordion-style layer panel (checkbox + swatch per layer,
// grouped by category) and wires toggle callbacks.
export function renderLayerPanel(container, { onToggle }) {
  container.innerHTML = '';
  const byGroup = new Map();
  for (const def of LAYER_DEFS) {
    if (!byGroup.has(def.group)) byGroup.set(def.group, []);
    byGroup.get(def.group).push(def);
  }
  for (const group of GROUP_ORDER) {
    const defs = byGroup.get(group);
    if (!defs) continue;
    const section = document.createElement('div');
    section.className = 'layer-group';
    const heading = document.createElement('h3');
    heading.textContent = t(GROUP_LABEL_KEY[group]);
    section.appendChild(heading);
    for (const def of defs) {
      const row = document.createElement('label');
      row.className = 'layer-row';
      row.innerHTML = `
        <input type="checkbox" ${def.defaultVisible !== false ? 'checked' : ''} data-layer-id="${def.id}" />
        <span class="swatch" style="background:${def.legend.swatch}"></span>
        <span class="layer-name">${labelForLayer(def)}</span>
      `;
      row.querySelector('input').addEventListener('change', (e) => onToggle(def.id, e.target.checked));
      section.appendChild(row);
    }
    container.appendChild(section);
  }
}

function labelForLayer(def) {
  const names = {
    'lyr-boundary': t('layerBoundary'),
    'lyr-green': 'Wadi palm groves',
    'lyr-water': 'Wadi Hanifah channel & pools',
    'lyr-buildings': 'Building footprints',
    'lyr-roads': 'Roads & paths',
    'lyr-landmarks': 'Heritage landmarks',
    'lyr-poi-hospitality': 'Hospitality & tourism',
    'lyr-poi-amenity': 'Public amenities',
  };
  return names[def.id] || def.id;
}

export function refreshLayerPanelLabels(container) {
  const heads = container.querySelectorAll('.layer-group h3');
  const groups = GROUP_ORDER.filter((g) => LAYER_DEFS.some((d) => d.group === g));
  heads.forEach((h, i) => (h.textContent = t(GROUP_LABEL_KEY[groups[i]])));
}
