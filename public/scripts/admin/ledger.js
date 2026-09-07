import { apiBase } from "../app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { app } from "../app.js";

const auth = getAuth(app);

const TYPE_LABELS = {
  signup: "Signup bonus",
  bond_created: "Bond created",
  bond_collected: "Bond collected",
  reward: "Reward",
  redemption: "Redeemed",
  mint: "Central bank mint",
  burn: "Central bank burn",
  stock_buy: "Stock purchase",
  stock_sell: "Stock sale",
};

const POSITIVE_TYPES = new Set(["signup", "bond_collected", "reward", "mint"]);
const NEGATIVE_TYPES = new Set(["bond_created", "redemption", "burn"]);

let initialized = false;

export async function init() {
  wireRefreshButton();
  await loadLedger();
}

export async function onShow() {
  if (!initialized) return;
  await loadLedger();
}

function wireRefreshButton() {
  document
    .getElementById("admin-ledger-refresh-button")
    ?.addEventListener("click", () => loadLedger());
}

async function loadLedger() {
  const list = document.getElementById("admin-ledger-list");
  const button = document.getElementById("admin-ledger-refresh-button");
  if (!list) return;

  if (button) button.disabled = true;

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${apiBase}/ledger/all?limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok)
      throw new Error(`Failed to fetch ledger (${response.status})`);

    const data = await response.json();
    renderLedger(data.entries ?? []);
    initialized = true;
  } catch (err) {
    console.error("Failed to load admin ledger", err);
    list.innerHTML = `<li class="ledger-empty">Couldn't load the ledger.</li>`;
  } finally {
    if (button) button.disabled = false;
  }
}

function renderLedger(entries) {
  const list = document.getElementById("admin-ledger-list");
  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = `<li class="ledger-empty">No activity yet.</li>`;
    return;
  }

  list.innerHTML = entries
    .map((entry) => {
      const label = TYPE_LABELS[entry.type] ?? entry.type;
      const direction = POSITIVE_TYPES.has(entry.type)
        ? "positive"
        : NEGATIVE_TYPES.has(entry.type)
          ? "negative"
          : "";
      const sign =
        direction === "positive"
          ? "+"
          : direction === "negative"
            ? "\u2212"
            : "";
      const coinWord = entry.amount === 1 ? "coin" : "coins";

      const from = partyLabel(entry.fromName, entry.fromPublicId);
      const to = partyLabel(entry.toName, entry.toPublicId);

      return `
        <li class="ledger-item">
          <div class="ledger-item-main">
            <span class="ledger-item-type">${label}</span>
            <span class="ledger-item-parties">${from} &rarr; ${to}</span>
          </div>
          <div class="ledger-item-right">
            <span class="ledger-item-amount ${direction}">${sign}${entry.amount.toLocaleString()} ${coinWord}</span>
            <span class="ledger-item-time">${formatTimestamp(entry.timestamp)}</span>
          </div>
        </li>
      `;
    })
    .join("");
}

function partyLabel(name, publicId) {
  if (name && publicId) return `${name} (${publicId})`;
  return publicId ?? "—";
}

function formatTimestamp(timestamp) {
  const date = toDate(timestamp);
  if (!date) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDate(timestamp) {
  if (!timestamp) return null;
  if (typeof timestamp === "object" && "_seconds" in timestamp)
    return new Date(timestamp._seconds * 1000);
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}
