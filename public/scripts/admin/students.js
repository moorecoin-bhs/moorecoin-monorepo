import { apiBase } from "../app.js";
import { escapeHtml, formatCoins, formatCredit, toNumber } from "../format.js";
import {
  getEconomyConfig,
  populatePeriodSelect,
  validateAmount,
} from "../config.js";
import { EVENTS, track, trackFailure } from "../analytics.js";
import { messageForError } from "../errors.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { app } from "../app.js";

const auth = getAuth(app);

let studentsCache = [];
// Per-student amount typed into the adjust input, keyed by uid, so it
// survives the full re-render that follows every action.
const adjustAmounts = new Map();
let economyConfig = null;

export async function init() {
  economyConfig = await getEconomyConfig();
  populatePeriodSelect(
    document.getElementById("filter-period"),
    economyConfig,
    { allLabel: "All periods" },
  );
  wireControls();
  await loadStudents();
}

export async function onShow() {
  await loadStudents();
}

async function authedFetch(path, options = {}) {
  const token = await auth.currentUser.getIdToken();
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

function wireControls() {
  document
    .getElementById("filter-period")
    ?.addEventListener("change", renderStudents);
  document
    .getElementById("sort-students")
    ?.addEventListener("change", renderStudents);
  document
    .getElementById("students-refresh-button")
    ?.addEventListener("click", loadStudents);
  document
    .getElementById("search-students")
    ?.addEventListener("input", renderStudents);
}

async function loadStudents() {
  const body = document.getElementById("student-table-body");
  try {
    const response = await authedFetch("/admin/users");
    if (!response.ok)
      throw new Error(`Failed to fetch students (${response.status})`);

    const data = await response.json();
    studentsCache = data.users ?? [];
    renderStudents();
  } catch (err) {
    console.error("Failed to load students", err);
    if (body)
      body.innerHTML = `<p class="bonds-empty">Couldn't load students.</p>`;
  }
}

function renderStudents() {
  const body = document.getElementById("student-table-body");
  if (!body) return;

  const periodFilter = document.getElementById("filter-period")?.value;
  const sortMode =
    document.getElementById("sort-students")?.value ?? "lastName";
  const searchTerm =
    document.getElementById("search-students")?.value.trim().toLowerCase() ??
    "";

  let list = [...studentsCache];

  if (periodFilter) {
    list = list.filter((s) => String(s.period) === periodFilter);
  }

  if (searchTerm) {
    list = list.filter((s) =>
      (s.name ?? "").toLowerCase().includes(searchTerm),
    );
  }

  list.sort((a, b) => {
    if (sortMode === "coinsDesc")
      return (b.moorecoins ?? 0) - (a.moorecoins ?? 0);
    if (sortMode === "coinsAsc")
      return (a.moorecoins ?? 0) - (b.moorecoins ?? 0);
    if (sortMode === "pendingDesc")
      return (b.pendingExtraCredit ?? 0) - (a.pendingExtraCredit ?? 0);
    return lastNameOf(a.name).localeCompare(lastNameOf(b.name));
  });

  if (list.length === 0) {
    body.innerHTML = `<p class="bonds-empty">No students match this filter.</p>`;
    return;
  }

  body.innerHTML = list
    .map((student) => {
      // name and email are user-controlled (Google profile) and land in both
      // text and attribute positions here, so every one is escaped. Coerce
      // pending to a number first: a non-numeric value would pass the
      // `> 0` test and then throw on .toFixed(), killing the whole table.
      const pending = toNumber(student.pendingExtraCredit);
      const uid = escapeHtml(student.uid);
      const pendingLabel = formatCredit(pending);
      const coins = toNumber(student.moorecoins);
      const amount = adjustAmounts.get(student.uid) ?? 1;

      return `
        <div class="student-table-row" data-uid="${uid}">
          <a class="student-name-link" href="mailto:${escapeHtml(student.email ?? "")}">${escapeHtml(student.name ?? "Unnamed")}</a>
          <span class="student-public-id">${escapeHtml(student.publicUid ?? "—")}</span>
          <span>${student.period ? `P${escapeHtml(student.period)}` : "—"}</span>
          <span class="student-coins">${formatCoins(student.moorecoins ?? 0)}</span>
          <span class="student-pending-cell">
            <span class="student-pending-value">${pendingLabel}</span>
            ${pending > 0 ? `<button class="student-action-button copy-pending" data-value="${pendingLabel}">Copy</button>` : ""}
          </span>
          <span class="student-row-actions">
            <span class="student-adjust" data-uid="${uid}">
              <button class="student-adjust-button take" title="Take coins" aria-label="Take coins" ${coins < amount ? "disabled" : ""}>&minus;</button>
              <input class="student-adjust-input" type="number" min="1" step="1" value="${escapeHtml(amount)}" aria-label="Amount" />
              <button class="student-adjust-button give" title="Give coins" aria-label="Give coins">+</button>
            </span>
            ${pending > 0 ? `<button class="student-action-button mark-submitted" data-uid="${uid}">Mark submitted</button>` : ""}
          </span>
        </div>
      `;
    })
    .join("");

  body.querySelectorAll(".copy-pending").forEach((button) => {
    button.addEventListener("click", () => handleCopy(button));
  });

  body.querySelectorAll(".mark-submitted").forEach((button) => {
    button.addEventListener("click", () =>
      handleMarkSubmitted(button.dataset.uid, button),
    );
  });

  body.querySelectorAll(".student-adjust").forEach((control) => {
    const uid = control.dataset.uid;
    const input = control.querySelector(".student-adjust-input");
    const take = control.querySelector(".take");
    const give = control.querySelector(".give");
    const balance = toNumber(
      studentsCache.find((s) => s.uid === uid)?.moorecoins,
    );

    input.addEventListener("input", () => {
      const amount = Number(input.value);
      const valid = isValidAmount(amount);
      if (valid) adjustAmounts.set(uid, amount);
      input.classList.toggle("invalid", !valid);
      give.disabled = !valid;
      take.disabled = !valid || balance < amount;
    });

    // Enter gives, matching the "+" being the common case.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !give.disabled) give.click();
    });

    give.addEventListener("click", () =>
      handleAdjust(uid, Number(input.value), control),
    );
    take.addEventListener("click", () =>
      handleAdjust(uid, -Number(input.value), control),
    );
  });
}

function isValidAmount(amount) {
  return validateAmount(amount, economyConfig) === null;
}

function lastNameOf(name) {
  if (!name) return "";
  const parts = name.trim().split(" ");
  return parts[parts.length - 1] ?? "";
}

async function handleCopy(button) {
  const value = button.dataset.value;
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied!";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("copied");
    }, 1500);
  } catch (err) {
    console.error("Failed to copy", err);
  }
}

async function handleMarkSubmitted(uid, button) {
  button.disabled = true;
  try {
    const response = await authedFetch(
      // Path segment, not markup — needs URL encoding rather than escaping.
      `/admin/users/${encodeURIComponent(uid)}/mark-extra-credit-submitted`,
      {
        method: "POST",
      },
    );
    if (!response.ok)
      throw new Error(`Failed to mark submitted (${response.status})`);

    track(EVENTS.ADMIN_ACTION, { action: "mark_extra_credit_submitted" });

    const student = studentsCache.find((s) => s.uid === uid);
    if (student) student.pendingExtraCredit = 0;

    renderStudents();
  } catch (err) {
    console.error("Failed to mark extra credit submitted", err);
    trackFailure("mark_extra_credit_submitted", "network");
    button.disabled = false;
  }
}

// Short wording for the narrow coins cell; the full message goes in the
// cell's tooltip.
const ADJUST_ERROR_OVERRIDES = {
  insufficient_balance: "Not enough coins",
  reserve_would_be_insufficient: "Reserve too low",
  invalid_amount: "Invalid amount",
};

// delta > 0 gives coins from the reserve, delta < 0 takes them back.
async function handleAdjust(uid, delta, control) {
  const amount = Math.abs(delta);
  if (!isValidAmount(amount)) return;

  const buttons = control.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));

  const giving = delta > 0;
  const action = giving ? "distribute" : "revoke";

  try {
    const response = await authedFetch(`/admin/central-bank/${action}`, {
      method: "POST",
      body: JSON.stringify({ uid, amount }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "failed");
    }

    track(EVENTS.ADMIN_ACTION, {
      action: giving ? "give_coins" : "take_coins",
    });

    const student = studentsCache.find((s) => s.uid === uid);
    if (student) student.moorecoins = toNumber(student.moorecoins) + delta;

    renderStudents();
  } catch (err) {
    console.error(`Failed to ${giving ? "give" : "take"} coins`, err);
    trackFailure(
      giving ? "give_coins" : "take_coins",
      err?.message ?? "network",
    );
    const code = err?.message;
    showAdjustError(
      control,
      messageForError(code, {
        config: economyConfig,
        overrides: ADJUST_ERROR_OVERRIDES,
      }),
      messageForError(code, { config: economyConfig }),
    );
  }
}

function showAdjustError(control, message, detail) {
  const row = control.closest(".student-table-row");
  const coinsCell = row?.querySelector(".student-coins");
  if (!coinsCell) return renderStudents();

  coinsCell.textContent = message;
  coinsCell.title = detail;
  coinsCell.classList.add("error");
  setTimeout(renderStudents, 2500);
}
