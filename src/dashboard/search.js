// search.js — client-side search over landmarks and POIs (roads in this
// dataset are unnamed OSM ways, so they are not part of the searchable index;
// see README for how to extend this with named streets from a live Overpass
// export).

import { searchFeatures } from './data.js';
import { getLang, t } from './i18n.js';

export function wireSearch(input, resultsEl, index, map, { onSelect }) {
  input.placeholder = t('searchPlaceholder');

  input.addEventListener('input', () => {
    const matches = searchFeatures(index, input.value, getLang());
    renderResults(matches);
  });

  input.addEventListener('focus', () => {
    if (input.value) renderResults(searchFeatures(index, input.value, getLang()));
  });

  document.addEventListener('click', (e) => {
    if (!resultsEl.contains(e.target) && e.target !== input) resultsEl.classList.remove('open');
  });

  function renderResults(matches) {
    resultsEl.innerHTML = '';
    if (!input.value.trim()) {
      resultsEl.classList.remove('open');
      return;
    }
    if (!matches.length) {
      resultsEl.innerHTML = `<div class="search-empty">${t('noResults')}</div>`;
      resultsEl.classList.add('open');
      return;
    }
    for (const m of matches) {
      const row = document.createElement('div');
      row.className = 'search-result';
      const name = getLang() === 'ar' && m.name_ar ? m.name_ar : m.name_en;
      row.innerHTML = `<span class="icon">${m.icon}</span><span>${name}</span>`;
      row.addEventListener('click', () => {
        map.flyTo({ center: m.coordinates, zoom: 18, essential: true });
        onSelect(m);
        resultsEl.classList.remove('open');
        input.value = name;
      });
      resultsEl.appendChild(row);
    }
    resultsEl.classList.add('open');
  }
}
