import { apiBase } from "../app.js";
import { escapeHtml, formatCoins, formatCredit, toNumber } from "../format.js";
import { getEconomyConfig, populatePeriodSelect } from "../config.js";
import { EVENTS, track, trackFailure } from "../analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { app } from "../app.js";

const auth = getAuth(app);

let studentsCache = [];

export async function init() {
  populatePeriodSelect(
    document.getElementById("filter-period"),
    await getEconomyConfig(),
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
            <button class="student-action-button give-one" data-uid="${uid}">+1 Coin</button>
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

  body.querySelectorAll(".give-one").forEach((button) => {
    button.addEventListener("click", () =>
      handleGiveOne(button.dataset.uid, button),
    );
  });
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

async function handleGiveOne(uid, button) {
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "...";

  try {
    const response = await authedFetch("/admin/central-bank/distribute", {
      method: "POST",
      body: JSON.stringify({ uid, amount: 1 }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "failed");
    }

    // Tracked as its own action rather than a distribute of 1: this is the
    // one-click button in the student table, and the amount is never the
    // interesting part of it.
    track(EVENTS.ADMIN_ACTION, { action: "give_one" });

    const student = studentsCache.find((s) => s.uid === uid);
    if (student) student.moorecoins = (student.moorecoins ?? 0) + 1;

    renderStudents();
  } catch (err) {
    console.error("Failed to give coin", err);
    trackFailure("give_one", err?.message ?? "network");
    button.textContent = "Failed";
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
    return;
  }

  button.textContent = originalText;
  button.disabled = false;
}
