// build-offline.mjs — bundles the whole game into one self-contained HTML file
// (Diriyah-Game.html) that runs by double-clicking, with no server and no
// install. Run from the repo root:  node scripts/build-offline.mjs
//
// It strips the ES-module syntax, inlines src/diriyah/map-data.json, and embeds
// a browser-global (UMD) build of three.js r147 + classic OrbitControls so the
// page works straight off the file:// protocol (ES modules and fetch() do not).

import fs from 'fs';

const root = process.cwd();
const read = (p) => fs.readFileSync(p, 'utf8');

async function getLib(url, cacheName) {
  const cache = root + '/vendor/three-umd/' + cacheName;
  if (fs.existsSync(cache)) return read(cache);
  const txt = await fetch(url).then((r) => r.text());
  fs.mkdirSync(root + '/vendor/three-umd', { recursive: true });
  fs.writeFileSync(cache, txt);
  return txt;
}

// strip ES module syntax so the files run as one classic script
const strip = (src) =>
  src.split('\n').filter((l) => !/^\s*import\s/.test(l)).join('\n').replace(/^export\s+/gm, '');

let culture = strip(read(root + '/src/diriyah/culture.js'));
let player = strip(read(root + '/src/diriyah/player.js'));
let map = strip(read(root + '/src/diriyah/map.js'));
let game = strip(read(root + '/src/diriyah/game.js'));

// three r147 (the last UMD build) uses legacy lighting, brighter than the
// vendored r165 (physically-correct). Dial the lights + exposure down to match.
game = game
  .replace('new THREE.HemisphereLight(0xfff1d4, 0xb08a5a, 0.85)', 'new THREE.HemisphereLight(0xfff1d4, 0xb08a5a, 0.3)')
  .replace('new THREE.DirectionalLight(0xfff0d0, 1.5)', 'new THREE.DirectionalLight(0xfff0d0, 1.05)')
  .replace('renderer.toneMappingExposure = 1.15;', 'renderer.toneMappingExposure = 1.0;');

// inline the map data instead of fetch()
map = map.replace(/const data = await fetch\([^;]*;/, 'const data = window.__MAP_DATA__;');

const mapData = read(root + '/src/diriyah/map-data.json').trim();
const three = await getLib('https://unpkg.com/three@0.147.0/build/three.min.js', 'three.min.js');
const orbit = await getLib('https://unpkg.com/three@0.147.0/examples/js/controls/OrbitControls.js', 'OrbitControls.js');

// reuse the real index.html markup/CSS; swap only the module <script> tail
const html = read(root + '/index.html');
const head = html.slice(0, html.indexOf('<script type="importmap">'));

const out = `${head}<script>
${three}
</script>
<script>
${orbit}
</script>
<script>
window.__MAP_DATA__ = ${mapData};
(function () {
  "use strict";
  const OrbitControls = THREE.OrbitControls;
${culture}
${player}
${map}
${game}
})();
</script>
</body>
</html>
`;

fs.writeFileSync(root + '/Diriyah-Game.html', out);
console.log('Wrote Diriyah-Game.html (' + Math.round(out.length / 1024) + ' KB)');
