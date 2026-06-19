// Bundles the whole game into a single self-contained HTML file that runs by
// double-clicking (no server). Strategy:
//   - Three.js + OrbitControls are embedded as base64 `data:` ES-module URLs
//     in an import map, so the browser resolves `import ... from "three"` with
//     zero network/file fetches (works from the file:// protocol).
//   - The five src/*.js modules are concatenated into one inline module:
//     inter-file imports and `export` keywords are stripped; the two real
//     `three` imports are hoisted to the top once.
//
// Run:  node build-standalone.mjs   ->   mbti-house.html

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("./", import.meta.url);
const read = p => readFileSync(new URL(p, root), "utf8");

// 1) embed three + addons as data-url modules
const threeSrc = read("vendor/three/three.module.js");
const orbitSrc = read("vendor/three/addons/controls/OrbitControls.js");
const dataUrl = src => "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
const importmap = {
  imports: {
    "three": dataUrl(threeSrc),
    "three/addons/controls/OrbitControls.js": dataUrl(orbitSrc)
  }
};

// 2) concatenate game modules (dependency order)
const order = ["characters.js", "world.js", "sim.js", "ui.js", "main.js"];
const stripImports = s => s.replace(/^\s*import\s.*?;\s*$/gm, "");   // remove every import line
const stripExports = s => s.replace(/^\s*export\s+/gm, "");          // remove export keyword

let body = "";
for (const f of order) {
  body += `\n// ===== src/${f} =====\n` + stripExports(stripImports(read("src/" + f))) + "\n";
}

const combined =
  `import * as THREE from "three";\n` +
  `import { OrbitControls } from "three/addons/controls/OrbitControls.js";\n` +
  body;

// 3) splice into the HTML, replacing the importmap + external module script
let html = read("index.html");
html = html.replace(
  /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="\.\/src\/main\.js"><\/script>/,
  `<script type="importmap">\n${JSON.stringify(importmap)}\n</script>\n<script type="module">\n${combined}\n</script>`
);

writeFileSync(new URL("mbti-house.html", root), html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`wrote mbti-house.html (${kb} KB)`);
