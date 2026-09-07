import { apiBase } from "../app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { app } from "../app.js";

const auth = getAuth(app);

let currentUserData = null;
let bondsCache = [];
let currentRates = null;
let countdownInterval = null;

export async function init(userData) {
  currentUserData = userData;
  wireBondForm();
  await fetchRates();
  await refreshBonds();
  startCountdownLoop();
}

export async function onShow(userData) {
  currentUserData = userData;
  await refreshBonds();
}

// --- stats ---

function renderStats() {
  const liquid = currentUserData?.user?.moorecoins ?? 0;
  const bonded = bondsCache
    .filter((b) => !b.collected)
    .reduce((sum, b) => sum + (b.principal ?? 0), 0);
  const pending = 0;
  const total = liquid + bonded + pending;

  setStatValue("stat-liquid", liquid);
  setStatValue("stat-bonded", bonded);
  setStatValue("stat-pending", pending);
  setStatValue("stat-total", total);
}

function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value.toLocaleString();
}

// --- rates + preview ---

async function fetchRates() {
  try {
    const response = await fetch(`${apiBase}/economy/rates`);
    if (!response.ok)
      throw new Error(`Failed to fetch rates (${response.status})`);
    currentRates = await response.json();
  } catch (err) {
    console.error("Failed to load economy rates", err);
    currentRates = null;
  }
}

function updateBondPreview() {
  const input = document.getElementById("bond-amount-input");
  const previewEl = document.getElementById("bond-form-preview");
  if (!input || !previewEl) return;

  const amount = Number(input.value);

  if (!currentRates || !Number.isInteger(amount) || amount <= 0) {
    previewEl.innerHTML = "";
    return;
  }

  const interestAmount = Math.round(amount * currentRates.interestRate);
  const payout = amount + interestAmount;

  previewEl.innerHTML =
    `Matures in 14 days for approximately <strong>${payout.toLocaleString()} coins</strong> ` +
    `(+${interestAmount.toLocaleString()} interest at current rate)`;
}

// --- bonds fetch + render ---

async function refreshBonds() {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;

    const response = await fetch(`${apiBase}/bonds/mine`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok)
      throw new Error(`Failed to fetch bonds (${response.status})`);

    const data = await response.json();
    bondsCache = data.bonds ?? [];

    renderStats();
    renderBondsList();
  } catch (err) {
    console.error("Failed to load bonds", err);
  }
}

function renderBondsList() {
  const bondsList = document.getElementById("bonds-list");
  const summary = document.getElementById("bonds-summary");
  if (!bondsList) return;

  const active = bondsCache.filter((b) => !b.collected);
  if (summary)
    summary.textContent = active.length ? `${active.length} active` : "";

  if (bondsCache.length === 0) {
    bondsList.innerHTML = `<li class="bonds-empty">No active bonds yet.</li>`;
    return;
  }

  const sorted = [...bondsCache].sort((a, b) => b.createdAt - a.createdAt);

  bondsList.innerHTML = sorted
    .map((bond) => {
      const status = getBondStatus(bond);
      const statusLabel = { collected: "Collected" }[status];

      return `
        <li class="bond-item" data-bond-id="${bond.id}" data-matures-at="${bond.maturesAt}">
          <div class="bond-item-info">
            <span class="bond-item-amount">${bond.principal.toLocaleString()} coins</span>
            <span class="bond-item-meta">
              +${bond.interestAmount.toLocaleString()} interest &middot;
              ${
                status === "pending"
                  ? `<span class="bond-item-countdown">calculating...</span>`
                  : status === "matured"
                    ? "matured"
                    : formatDate(bond.maturesAt)
              }
            </span>
          </div>
          ${
            status === "matured"
              ? `<button class="bond-collect-button" data-bond-id="${bond.id}">Collect</button>`
              : `<span class="bond-item-status ${status}">${statusLabel ?? "Maturing"}</span>`
          }
        </li>
      `;
    })
    .join("");

  bondsList.querySelectorAll(".bond-collect-button").forEach((button) => {
    button.addEventListener("click", () =>
      handleCollect(button.dataset.bondId, button),
    );
  });

  tickCountdowns(); // paint immediately instead of waiting for the first interval tick
}

function getBondStatus(bond) {
  if (bond.collected) return "collected";
  return Date.now() >= bond.maturesAt ? "matured" : "pending";
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// --- live countdown ---

function startCountdownLoop() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(tickCountdowns, 1000);
}

function tickCountdowns() {
  const now = Date.now();
  let anyJustMatured = false;

  document.querySelectorAll(".bond-item[data-matures-at]").forEach((item) => {
    const maturesAt = Number(item.dataset.maturesAt);
    const countdownEl = item.querySelector(".bond-item-countdown");
    if (!countdownEl) return; // already matured/collected, nothing to tick

    const msLeft = maturesAt - now;

    if (msLeft <= 0) {
      anyJustMatured = true;
      return;
    }

    countdownEl.textContent = formatCountdown(msLeft);
  });

  // A bond crossed into "matured" while we were sitting on this page —
  // re-render so its Collect button appears instead of waiting for a
  // manual refresh.
  if (anyJustMatured) renderBondsList();
}

function formatCountdown(msLeft) {
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// --- create bond ---

function wireBondForm() {
  const form = document.getElementById("bond-create-form");
  const input = document.getElementById("bond-amount-input");
  if (!form || !input) return;

  input.addEventListener("input", updateBondPreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleCreate();
  });
}

async function handleCreate() {
  const input = document.getElementById("bond-amount-input");
  const button = document.getElementById("bond-create-button");
  const errorEl = document.getElementById("bond-form-error");
  const previewEl = document.getElementById("bond-form-preview");

  const amount = Number(input.value);
  errorEl.textContent = "";

  if (!Number.isInteger(amount) || amount <= 0) {
    errorEl.textContent = "Enter a whole number greater than 0.";
    return;
  }

  button.disabled = true;

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${apiBase}/bonds/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount }),
    });

    const data = await response.json();

    if (!response.ok) {
      errorEl.textContent = errorMessageFor(data.error);
      return;
    }

    input.value = "";
    previewEl.innerHTML = "";
    currentUserData.user.moorecoins -= amount;
    await fetchRates(); // circulating supply just changed, refresh the reference rate
    await refreshBonds();
  } catch (err) {
    console.error("Failed to create bond", err);
    errorEl.textContent = "Something went wrong. Try again.";
  } finally {
    button.disabled = false;
  }
}

// --- collect bond ---

async function handleCollect(bondId, button) {
  button.disabled = true;
  button.textContent = "Collecting...";

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${apiBase}/bonds/collect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bondId }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Failed to collect bond", data.error);
      button.disabled = false;
      button.textContent = "Collect";
      return;
    }

    currentUserData.user.moorecoins += data.payout;
    await refreshBonds();
  } catch (err) {
    console.error("Failed to collect bond", err);
    button.disabled = false;
    button.textContent = "Collect";
  }
}

function errorMessageFor(code) {
  const messages = {
    insufficient_balance: "You don't have enough Moorecoins for that.",
    reserve_would_be_insufficient:
      "The central bank reserve can't cover this bond's interest right now.",
  };
  return messages[code] || "Something went wrong. Try again.";
}
