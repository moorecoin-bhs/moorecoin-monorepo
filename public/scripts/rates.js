// The two economy rates, shared by the student dashboard and the admin
// overview so both read the same numbers from the same endpoint.
//
// GET /economy/rates is public and derives both rates from the circulating
// supply, so nothing here recomputes them — the curves live in
// api/src/helpers/economy.js and must stay in exactly one place.

import { apiBase } from "./app.js";

// null when the fetch fails, so callers can leave the placeholder in place
// rather than render "NaN".
export async function fetchRates() {
  try {
    const response = await fetch(`${apiBase}/economy/rates`);
    if (!response.ok)
      throw new Error(`Failed to fetch rates (${response.status})`);
    return await response.json();
  } catch (err) {
    console.error("Failed to load economy rates", err);
    return null;
  }
}

// Two decimals, matching the redeem preview's own .toFixed(2), so the
// headline number and the per-amount estimate can't appear to disagree.
export function formatExchangeRate(rate) {
  return Number.isFinite(rate) ? rate.toFixed(2) : "—";
}

export function formatInterestRate(rate) {
  return Number.isFinite(rate) ? `${(rate * 100).toFixed(1)}%` : "—";
}

// Fills the rate band markup shared by dashboard.html and admin.html.
// Both arguments may be null — the placeholders stay put.
export function renderRateBand(rates, config) {
  setText("rate-exchange", formatExchangeRate(rates?.exchangeRate));
  setText("rate-interest", formatInterestRate(rates?.interestRate));

  const termDays = config?.bondTermDays;
  if (termDays) {
    setText("rate-interest-unit", `Paid per ${termDays}-day bond`);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
