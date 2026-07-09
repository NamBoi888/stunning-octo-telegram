// share.js — shareable view-state via URL hash (camera + basemap + language,
// so a copied link reopens to the same view) and a one-click PNG screenshot
// of the current canvas.

export function encodeViewState(map, { basemap, lang }) {
  const c = map.getCenter();
  const params = new URLSearchParams({
    lng: c.lng.toFixed(6),
    lat: c.lat.toFixed(6),
    z: map.getZoom().toFixed(2),
    b: map.getBearing().toFixed(1),
    p: map.getPitch().toFixed(1),
    bm: basemap,
    lang,
  });
  return params.toString();
}

export function decodeViewState(hash) {
  if (!hash) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('lng')) return null;
  return {
    center: [parseFloat(params.get('lng')), parseFloat(params.get('lat'))],
    zoom: parseFloat(params.get('z')),
    bearing: parseFloat(params.get('b') || '0'),
    pitch: parseFloat(params.get('p') || '0'),
    basemap: params.get('bm') || 'light',
    lang: params.get('lang') || 'en',
  };
}

export async function copyShareLink(map, opts) {
  const hash = encodeViewState(map, opts);
  const url = `${location.origin}${location.pathname}#${hash}`;
  history.replaceState(null, '', `#${hash}`);
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function downloadScreenshot(map, filename = 'diriyah-dashboard.png') {
  map.getCanvas().toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}
