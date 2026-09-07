import { apiBase } from "../app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { app } from "../app.js";

const auth = getAuth(app);

let currentUserData = null;
let bondsCache = [];
let currentRates = null;
let countdownInterval = null;
let balanceChart = null;

export async function init(userData) {
  currentUserData = userData;
  wireBondForm();
  wireRedeemForm();
  await fetchRates();
  await refreshBonds();
  await renderBalanceChart();
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
  const pending = currentUserData?.user?.pendingExtraCredit ?? 0;
  const total = liquid + bonded;

  setStatValue("stat-liquid", liquid);
  setStatValue("stat-bonded", bonded);
  setDollarStatValue("stat-pending", pending);
  setStatValue("stat-total", total);
}

function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value.toLocaleString();
}

function setDollarStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

// --- rates + preview (bonds + redeem) ---

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

function updateRedeemPreview() {
  const input = document.getElementById("redeem-amount-input");
  const previewEl = document.getElementById("redeem-preview");
  if (!input || !previewEl) return;

  const amount = Number(input.value);

  if (!currentRates || !Number.isInteger(amount) || amount <= 0) {
    previewEl.innerHTML = "";
    return;
  }

  const creditValue = (amount * currentRates.exchangeRate).toFixed(2);
  previewEl.innerHTML = `Worth approximately <strong>${creditValue}</strong> extra credit points at the current rate.`;
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

  tickCountdowns();
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
    if (!countdownEl) return;

    const msLeft = maturesAt - now;

    if (msLeft <= 0) {
      anyJustMatured = true;
      return;
    }

    countdownEl.textContent = formatCountdown(msLeft);
  });

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
    await fetchRates();
    await refreshBonds();
    await renderBalanceChart();
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
    await renderBalanceChart();
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

// --- redeem for extra credit ---

function wireRedeemForm() {
  const form = document.getElementById("redeem-form");
  const input = document.getElementById("redeem-amount-input");
  if (!form || !input) return;

  input.addEventListener("input", updateRedeemPreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleRedeem();
  });
}

async function handleRedeem() {
  const input = document.getElementById("redeem-amount-input");
  const button = document.getElementById("redeem-button");
  const errorEl = document.getElementById("redeem-error");
  const previewEl = document.getElementById("redeem-preview");

  const amount = Number(input.value);
  errorEl.textContent = "";

  if (!Number.isInteger(amount) || amount <= 0) {
    errorEl.textContent = "Enter a whole number greater than 0.";
    return;
  }

  button.disabled = true;

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${apiBase}/redemption/create`, {
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
    currentUserData.user.pendingExtraCredit =
      (currentUserData.user.pendingExtraCredit ?? 0) + data.extraCreditValue;
    await fetchRates();
    renderStats();
    await renderBalanceChart();
  } catch (err) {
    console.error("Failed to redeem", err);
    errorEl.textContent = "Something went wrong. Try again.";
  } finally {
    button.disabled = false;
  }
}

// --- balance over time ---

const TYPE_LABELS = {
  signup: "Signup",
  bond_created: "Bond created",
  bond_collected: "Bond collected",
  redemption: "Redeemed",
  reward: "Reward",
  mint: "Mint",
};

async function renderBalanceChart() {
  const canvas = document.getElementById("balance-chart");
  if (!canvas) return;

  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;

    const response = await fetch(`${apiBase}/ledger/mine`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok)
      throw new Error(`Failed to fetch ledger (${response.status})`);

    const data = await response.json();
    const points = buildBalanceSeries(data.entries ?? []);

    drawBalanceChart(canvas, points);
  } catch (err) {
    console.error("Failed to load balance history", err);
  }
}

function buildBalanceSeries(entries) {
  let running = 0;
  const points = [
    {
      x: entries[0] ? toMillis(entries[0].timestamp) : Date.now(),
      y: 0,
      label: null,
    },
  ];

  entries.forEach((entry) => {
    running += entry.direction === "in" ? entry.amount : -entry.amount;
    points.push({
      x: toMillis(entry.timestamp),
      y: running,
      label: TYPE_LABELS[entry.type] ?? entry.type,
    });
  });

  if (points.length > 0) {
    points.push({ x: Date.now(), y: points[points.length - 1].y, label: null });
  }

  return points;
}

function toMillis(timestamp) {
  if (!timestamp) return Date.now();
  if (typeof timestamp === "object" && "_seconds" in timestamp)
    return timestamp._seconds * 1000;
  return new Date(timestamp).getTime();
}

function expandHex(hex) {
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const [, r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex;
}

let pluginRegistered = false;

function registerEventLabelPlugin() {
  if (pluginRegistered) return;
  pluginRegistered = true;

  Chart.register({
    id: "eventLabels",
    afterDatasetsDraw(chart) {
      const { ctx, data, scales, chartArea } = chart;
      const points = data.datasets[0].data;
      if (!points?.length) return;

      ctx.save();
      ctx.font = "10px var(--main-font), sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--foreground-color")
        .trim();

      let lastLabelX = -Infinity;
      const minSpacing = 48;
      const labelOffset = 20;
      const minLabelY = chartArea.top + 10; // never draw above the chart's own top edge

      points.forEach((point) => {
        if (!point.label) return;

        const x = scales.x.getPixelForValue(point.x);
        const pointY = scales.y.getPixelForValue(point.y);
        const labelY = Math.max(pointY - labelOffset, minLabelY);

        // no spacing check — every event gets a label, even if some overlap when clustered

        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.moveTo(x, pointY - 6);
        ctx.lineTo(x, labelY + 6);
        ctx.stroke();

        ctx.fillText(point.label, x, labelY);
      });

      ctx.restore();
    },
  });
}

function drawBalanceChart(canvas, points) {
  registerEventLabelPlugin();

  if (balanceChart) {
    balanceChart.data.datasets[0].data = points;
    balanceChart.update();
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const accentColor = expandHex(
    styles.getPropertyValue("--accent-color").trim(),
  );
  const foregroundColor = styles.getPropertyValue("--foreground-color").trim();

  balanceChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Balance",
          data: points,
          borderColor: accentColor,
          backgroundColor: (context) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return null;
            const gradient = ctx.createLinearGradient(
              0,
              chartArea.top,
              0,
              chartArea.bottom,
            );
            gradient.addColorStop(0, `${accentColor}33`);
            gradient.addColorStop(1, `${accentColor}00`);
            return gradient;
          },
          fill: true,
          stepped: "after",
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: accentColor,
          pointHoverBorderColor: "#000",
          pointHoverBorderWidth: 2,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false, axis: "x" },
      layout: {
        padding: { top: 32 },
      },
      scales: {
        x: {
          type: "time",
          time: { tooltipFormat: "MMM d, h:mm a" },
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: foregroundColor,
            maxRotation: 0,
            autoSkipPadding: 24,
          },
        },
        y: {
          beginAtZero: true,
          position: "right",
          border: { display: false },
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: foregroundColor, precision: 0, padding: 8 },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#181818",
          titleColor: foregroundColor,
          bodyColor: accentColor,
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (context) => `${context.parsed.y.toLocaleString()} coins`,
          },
        },
      },
    },
  });
}
