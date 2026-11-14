// Small shared helpers with no dependencies on the DOM or on game state.

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickRandom(items, random = Math.random) {
  return items[Math.floor(random() * items.length)];
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Lower-cases, strips accents and punctuation, and irons out the spellings
// people actually type ("St. Lucia", "Cote d'Ivoire", "The Gambia").
export function normalizeText(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/\bst\b/g, "saint");
}

const SMALL_NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

// 3 -> "three"; larger numbers stay as digits.
export function numberWord(n) {
  return SMALL_NUMBERS[n] ?? String(n);
}

export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ["a", "b", "c"] -> "a, b and c"
export function formatList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

const numberFormat = new Intl.NumberFormat("en-GB");

export function formatNumber(n) {
  return numberFormat.format(n);
}

// Rounds a distance so it reads naturally: 183 -> 180, 4,236 -> 4,200.
export function roundDistance(km) {
  const step = km < 100 ? 5 : km < 1000 ? 10 : 100;
  return Math.max(step, Math.round(km / step) * step);
}

const NEEDS_ARTICLE = /^(United |Republic |Isle |British |Central African |Dominican |DR )|( Islands| Emirates|^Netherlands|^Philippines|^Bahamas|^Gambia|^Maldives|^Seychelles|^Comoros)$/;

// "Netherlands" -> "the Netherlands"; "France" stays "France".
export function withArticle(name, capital = false) {
  if (!NEEDS_ARTICLE.test(name)) return name;
  return (capital ? "The " : "the ") + name;
}

// "France" -> "France’s"; "Solomon Islands" -> "Solomon Islands’".
export function possessive(name) {
  return name.endsWith("s") ? name + "’" : name + "’s";
}
