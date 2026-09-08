import { apiBase } from "./app.js";

// The validation rules the server enforces, fetched at runtime from
// GET /economy/config.
//
// Deliberately no hardcoded fallback values: a local copy of maxAmount or
// the period range is exactly the drift this endpoint exists to prevent.
// When the fetch fails, getEconomyConfig() resolves to null and callers
// degrade to a looser check — the server is authoritative either way and
// rejects anything out of range with a coded error the UI can render.

let cached = null;
let inflight = null;

export async function getEconomyConfig() {
  if (cached) return cached;

  // Share one request between concurrent callers rather than firing several
  // on page load.
  if (!inflight) {
    inflight = fetch(`${apiBase}/economy/config`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        cached = data;
        inflight = null;
        return data;
      })
      .catch(() => {
        inflight = null;
        return null;
      });
  }

  return inflight;
}

// Returns null when the amount is acceptable, or a message explaining why
// it isn't. config may be null — the shape check still applies.
export function validateAmount(value, config) {
  const min = config?.minAmount ?? 1;

  if (!Number.isInteger(value) || value < min) {
    return `Enter a whole number of ${min.toLocaleString()} or more.`;
  }

  if (config && value > config.maxAmount) {
    return `Enter a whole number between ${min.toLocaleString()} and ${config.maxAmount.toLocaleString()}.`;
  }

  return null;
}

// Fills a <select> with one option per period, keeping any existing
// placeholder option. Used by onboarding, the reward form and the student
// filter so the range lives in exactly one place.
export function populatePeriodSelect(select, config, { allLabel } = {}) {
  if (!select) return;

  const min = config?.periodMin ?? 1;
  const max = config?.periodMax ?? 6;

  const placeholder = select.querySelector("option[value='']");
  select.textContent = "";

  if (placeholder) {
    select.appendChild(placeholder);
  } else if (allLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = allLabel;
    select.appendChild(option);
  }

  for (let period = min; period <= max; period += 1) {
    const option = document.createElement("option");
    option.value = String(period);
    option.textContent = `Period ${period}`;
    select.appendChild(option);
  }

  // Rebuilding the option list resets selectedIndex, which would leave the
  // first real period showing while the "Continue" button still waits for a
  // change event. Pin the placeholder back explicitly.
  select.value = "";
}

// Mirrors the server bound onto a number input so the browser's own
// validation matches, and screen readers announce the real range.
export function applyAmountBounds(input, config) {
  if (!input) return;
  input.min = String(config?.minAmount ?? 1);
  if (config) input.max = String(config.maxAmount);
}
