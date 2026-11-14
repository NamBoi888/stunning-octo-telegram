// Tiny DOM helpers.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// h("button", { class: "button", onClick: fn }, "Label")
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter(child => child != null && child !== false));
  return el;
}

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Counts a number up or down to a new value over a short moment.
export function animateNumber(el, to, format = String) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = to;
  if (from === to || prefersReducedMotion()) {
    el.textContent = format(to);
    return;
  }
  const started = performance.now();
  const duration = 600;
  const step = now => {
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1 && Number(el.dataset.value) === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Restarts a CSS animation on an element by toggling its class.
export function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}
