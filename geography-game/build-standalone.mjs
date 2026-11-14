#!/usr/bin/env node
// Packs the game into one self-contained file, meridian.html, that runs by
// double-clicking it: no server, no install, no network needed (the basemap
// imagery is the only thing fetched, and the game works without it).
//
//   node build-standalone.mjs
//
// It needs nothing but Node. What it does:
//   - inlines the stylesheets, with the font files as data URIs;
//   - inlines Leaflet and the TopoJSON decoder;
//   - bundles the ES modules under src/ and data/ into one script;
//   - embeds the country data, the boundaries and every flag in the page,
//     where src/assets.js looks for them before falling back to fetch().

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(fileURLToPath(import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const OUTPUT = "meridian.html";

// Text placed inside <script> or <style> must not contain a closing tag.
const safeForScript = text => text.replace(/<\/(script)/gi, "<\\/$1");
const jsonForHtml = value => JSON.stringify(value).replace(/</g, "\\u003c");

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

function inlineStyles(path) {
  const folder = posix.dirname(path);
  return read(path).replace(/url\((["']?)([^"')]+)\1\)/g, (match, quote, target) => {
    if (/^(data:|#|https?:)/.test(target)) return match;
    const file = posix.join(folder, target);
    if (file.endsWith(".woff2")) {
      const data = readFileSync(join(root, file)).toString("base64");
      return `url("data:font/woff2;base64,${data}")`;
    }
    // Leaflet's stylesheet points at marker and layer-switcher images the game never shows.
    return "none";
  });
}

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

// A small bundler for the subset of module syntax this project uses: named
// imports and exports only. Each module becomes a function that returns its
// exports, so names in different files can never collide.
const IMPORT = /^import\s+(?:\{([^}]*)\}\s+from\s+)?["']([^"']+)["'];?[ \t]*$/gm;
const EXPORT_DECLARATION = /^export\s+(?=(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*))/gm;

function bundleModules(entry) {
  const ordered = [];
  const seen = new Set();

  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const source = read(path);
    const exported = [];

    let body = source.replace(IMPORT, (match, names, target) => {
      const dependency = posix.join(posix.dirname(path), target);
      visit(dependency);
      if (!names) return "";
      const bindings = names
        .split(",")
        .map(name => name.trim())
        .filter(Boolean)
        .map(name => name.replace(/\s+as\s+/, ": "));
      return `const { ${bindings.join(", ")} } = __modules[${JSON.stringify(dependency)}];`;
    });

    body = body.replace(EXPORT_DECLARATION, (match, name) => {
      exported.push(name);
      return "";
    });

    if (/^\s*(import|export)\b/m.test(body)) {
      const line = body.split("\n").find(text => /^\s*(import|export)\b/.test(text));
      throw new Error(`${path}: unsupported module syntax: ${line.trim()}`);
    }

    ordered.push(
      `// ---- ${path} ----\n` +
      `__modules[${JSON.stringify(path)}] = (function () {\n${body}\nreturn { ${exported.join(", ")} };\n})();\n`
    );
  }

  visit(entry);
  const bundle = `(function () {\n"use strict";\nconst __modules = {};\n${ordered.join("\n")}})();\n`;
  new vm.Script(bundle, { filename: "bundle.js" });   // throws on a syntax error
  return { bundle, count: ordered.length };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

let html = read("index.html");

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (match, href) =>
  `<style>\n${inlineStyles(href)}\n</style>`);

html = html.replace(/<script src="([^"]+)"><\/script>/g, (match, src) =>
  `<script>\n${safeForScript(read(src))}\n</script>`);

const countries = JSON.parse(read("data/countries.json"));
const flags = {};
for (const country of countries) {
  if (country.flags?.svg) flags[country.flags.svg] = read(country.flags.svg);
}
const embedded = [
  ["data/countries.json", countries],
  ["data/world.topo.json", JSON.parse(read("data/world.topo.json"))],
  ["flags", flags]
]
  .map(([path, value]) => `<script type="application/json" data-path="${path}">${jsonForHtml(value)}</script>`)
  .join("\n");

const { bundle, count } = bundleModules("src/main.js");
const moduleTag = /<script type="module" src="src\/main\.js"><\/script>/;
if (!moduleTag.test(html)) throw new Error("index.html no longer loads src/main.js as a module");
html = html.replace(moduleTag, () => `${embedded}\n<script>\n${safeForScript(bundle)}</script>`);

if (/<link rel="stylesheet"|<script[^>]*\ssrc=/.test(html)) {
  throw new Error("The page still references an external stylesheet or script");
}

writeFileSync(join(root, OUTPUT), html);
const megabytes = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
console.log(`${OUTPUT}: ${megabytes} MB, ${count} modules, ${Object.keys(flags).length} flags`);
