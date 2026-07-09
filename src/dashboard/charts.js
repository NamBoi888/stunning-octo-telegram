// charts.js — tiny hand-rolled SVG chart helpers for the analytics panel.
// No charting library: two chart types (donut, horizontal bars) covers every
// analytics need here, so a dependency would outweigh the code it replaces.

export function donutSvg(segments, totalArea) {
  const size = 140;
  const r = 52;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter((s) => s.area > 0)
    .map((s) => {
      const frac = s.area / totalArea;
      const dash = frac * circumference;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="18"
        stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += dash;
      return el;
    })
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">${arcs}</svg>`;
}

export function legendRows(segments, totalArea, lang) {
  return segments
    .map((s) => {
      const pct = totalArea > 0 ? ((s.area / totalArea) * 100).toFixed(1) : '0.0';
      const label = lang === 'ar' ? s.label_ar : s.label_en;
      const hectares = (s.area / 10_000).toFixed(1);
      return `<div class="chart-legend-row">
        <span class="swatch" style="background:${s.color}"></span>
        <span class="chart-legend-label">${label}</span>
        <span class="chart-legend-value">${pct}% · ${hectares} ha</span>
      </div>`;
    })
    .join('');
}

export function scoreBars(items, lang) {
  return items
    .map((it) => {
      const name = lang === 'ar' && it.name_ar ? it.name_ar : it.name_en;
      return `<div class="score-row">
        <span class="score-name">${name}</span>
        <div class="score-track"><div class="score-fill" style="width:${it.score}%"></div></div>
        <span class="score-value">${it.score}</span>
      </div>`;
    })
    .join('');
}
