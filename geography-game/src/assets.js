// Loads the files the game ships with. In the multi-file version they are
// fetched from the server; in the single-file build (meridian.html) they are
// embedded in the page, so nothing here touches the network.

import { REST_COUNTRIES_URL, LIVE_DATA_TIMEOUT_MS } from "./config.js";
import { isCountryList } from "./countries.js";

const embedded = path => document.querySelector(`script[type="application/json"][data-path="${path}"]`);

export async function loadJSON(path) {
  const inline = embedded(path);
  if (inline) return JSON.parse(inline.textContent);
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
  return response.json();
}

let embeddedFlags;
const flagUrls = new Map();

// Turns a flag path from the country data into something an <img> can load.
// Remote URLs and ordinary relative paths pass straight through; embedded
// flags become blob URLs.
export function flagUrl(path) {
  if (embeddedFlags === undefined) {
    const inline = embedded("flags");
    embeddedFlags = inline ? JSON.parse(inline.textContent) : null;
  }
  const svg = embeddedFlags?.[path];
  if (!svg) return path;
  if (!flagUrls.has(path)) {
    flagUrls.set(path, URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
  }
  return flagUrls.get(path);
}

// Points an <img> at a country's flag. If the first source fails (a remote
// flag while offline, say) it switches to the bundled copy.
export function showFlag(img, country) {
  const { src, fallback } = country.flag;
  img.onerror = fallback
    ? () => {
        img.onerror = null;
        img.src = flagUrl(fallback);
      }
    : null;
  img.src = flagUrl(src);
}

// Asks REST Countries for fresh metadata. Resolves to { data } with a valid
// country list, or { data: null, reason } explaining why there is none. Never
// throws: the caller simply carries on with the bundled copy.
export async function fetchLiveCountries() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_DATA_TIMEOUT_MS);
  try {
    const response = await fetch(REST_COUNTRIES_URL, { signal: controller.signal });
    if (!response.ok) return { data: null, reason: `REST Countries answered with an error (HTTP ${response.status}).` };
    const data = await response.json();
    if (isCountryList(data)) return { data };
    const message = typeof data?.errors?.[0]?.message === "string" ? data.errors[0].message : "";
    return {
      data: null,
      reason: /deprecated/i.test(message)
        ? "REST Countries has retired this version of its API."
        : "REST Countries did not send a country list."
    };
  } catch (error) {
    return {
      data: null,
      reason: error.name === "AbortError"
        ? "REST Countries took too long to answer."
        : "REST Countries could not be reached from this page."
    };
  } finally {
    clearTimeout(timer);
  }
}
