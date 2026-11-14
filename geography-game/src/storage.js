// Small JSON wrappers around Web Storage. Storage can be missing or blocked
// (private windows, sandboxed frames), so every call falls back to memory and
// the game keeps working either way.

function createStore(getArea) {
  const memory = new Map();
  let area = null;
  try {
    area = getArea();
    const probe = "meridian.probe";
    area.setItem(probe, "1");
    area.removeItem(probe);
  } catch {
    area = null;
  }

  return {
    get(key, fallback) {
      try {
        const raw = area ? area.getItem(key) : memory.get(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      memory.set(key, raw);
      try {
        if (area) area.setItem(key, raw);
      } catch {
        // Quota or access error: the in-memory copy still serves this page.
        area = null;
      }
    }
  };
}

// Lasts for the browser tab: which facts and countries have already come up.
export const sessionStore = createStore(() => globalThis.sessionStorage);

// Lasts between visits: settings and best scores.
export const localStore = createStore(() => globalThis.localStorage);

// A store that only lives in memory, for tests.
export function memoryStore() {
  return createStore(() => {
    throw new Error("no storage");
  });
}
