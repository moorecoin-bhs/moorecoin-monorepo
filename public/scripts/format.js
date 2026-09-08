// Shared rendering helpers.
//
// The list renderers build markup with template literals and assign it to
// innerHTML. That is fine for structure, but every interpolated *value*
// must pass through escapeHtml first — several of them (student names,
// email addresses) are strings the user controls via their Google profile,
// and an unescaped one executes in the teacher's admin session.
//
// The number formatters exist because `value.toLocaleString()` throws on a
// null or undefined amount, and a throw inside a .map() aborts the whole
// list — one malformed document would leave the page stuck on "Loading...".
// These are total: they always return a string.

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Safe in both text and quoted-attribute positions. Attributes must be
// quoted in the template — escaping cannot rescue an unquoted attribute.
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

// null when the value can't be read as a finite number, so callers can
// show a placeholder instead of "0" or "NaN" for genuinely missing data.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number === 0 ? 0 : number; // collapse -0, which renders as "-0"
}

export function toNumber(value, fallback = 0) {
  return toFiniteNumber(value) ?? fallback;
}

export function formatCoins(value) {
  const number = toFiniteNumber(value);
  return number === null ? "—" : number.toLocaleString();
}

export function formatCredit(value) {
  const number = toFiniteNumber(value);
  return number === null ? "—" : number.toFixed(2);
}
