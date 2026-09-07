import { apiBase } from "../app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { app } from "../app.js";

const auth = getAuth(app);

export async function init() {
  wireForms();
  await refreshOverview();
  await loadStudentOptions();
}

export async function onShow() {
  await refreshOverview();
  await loadStudentOptions();
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

async function refreshOverview() {
  try {
    const response = await authedFetch("/admin/overview");
    if (!response.ok)
      throw new Error(`Failed to fetch overview (${response.status})`);

    const data = await response.json();
    const { totals, centralBank, freeReserve } = data;

    setValue("stat-reserve", centralBank.reserve ?? 0);
    setValue("stat-free-reserve", freeReserve ?? 0);
    setValue("stat-total-minted", centralBank.totalMinted ?? 0);
    setValue("stat-liability", centralBank.outstandingInterestLiability ?? 0);
    setValue("stat-circulating", totals.moorecoinsCirculating ?? 0);
    setValue("stat-bonded-total", totals.moorecoinsBonded ?? 0);
    setValue("stat-redeemed", totals.moorecoinsRedeemed ?? 0);
    setValue("stat-user-count", totals.users ?? 0);
  } catch (err) {
    console.error("Failed to load admin overview", err);
  }
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number(value).toLocaleString();
}

async function loadStudentOptions() {
  try {
    const response = await authedFetch("/admin/users");
    if (!response.ok)
      throw new Error(`Failed to fetch students (${response.status})`);

    const data = await response.json();
    const students = data.users ?? [];

    const select = document.getElementById("distribute-student-select");
    if (!select) return;

    const previousValue = select.value;
    select.innerHTML =
      `<option value="" disabled ${previousValue ? "" : "selected"}>Select a student</option>` +
      students
        .map(
          (s) =>
            `<option value="${s.uid}">${s.name ?? "Unnamed"} (${s.publicUid ?? "?"})</option>`,
        )
        .join("");

    if (previousValue) select.value = previousValue;
  } catch (err) {
    console.error("Failed to load students for distribute form", err);
  }
}

function wireForms() {
  wireSimpleForm(
    "mint-form",
    "mint-amount-input",
    "mint-button",
    "mint-error",
    (amount) =>
      authedFetch("/admin/central-bank/mint", {
        method: "POST",
        body: JSON.stringify({ amount }),
      }),
  );

  wireSimpleForm(
    "burn-form",
    "burn-amount-input",
    "burn-button",
    "burn-error",
    (amount) =>
      authedFetch("/admin/central-bank/burn", {
        method: "POST",
        body: JSON.stringify({ amount }),
      }),
  );

  const distributeForm = document.getElementById("distribute-form");
  distributeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const select = document.getElementById("distribute-student-select");
    const input = document.getElementById("distribute-amount-input");
    const button = document.getElementById("distribute-button");
    const errorEl = document.getElementById("distribute-error");

    const uid = select.value;
    const amount = Number(input.value);
    errorEl.textContent = "";

    if (!uid) {
      errorEl.textContent = "Select a student.";
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      errorEl.textContent = "Enter a whole number greater than 0.";
      return;
    }

    button.disabled = true;
    try {
      const response = await authedFetch("/admin/central-bank/distribute", {
        method: "POST",
        body: JSON.stringify({ uid, amount }),
      });
      const data = await response.json();
      if (!response.ok) {
        errorEl.textContent = adminErrorMessage(data.error);
        return;
      }
      input.value = "";
      await refreshOverview();
    } catch (err) {
      console.error("Failed to distribute", err);
      errorEl.textContent = "Something went wrong. Try again.";
    } finally {
      button.disabled = false;
    }
  });

  const rewardForm = document.getElementById("reward-form");
  rewardForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const periodSelect = document.getElementById("reward-period-select");
    const input = document.getElementById("reward-amount-input");
    const button = document.getElementById("reward-button");
    const errorEl = document.getElementById("reward-error");

    const period = Number(periodSelect.value);
    const amount = Number(input.value);
    errorEl.textContent = "";

    if (!period) {
      errorEl.textContent = "Select a period.";
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      errorEl.textContent = "Enter a whole number greater than 0.";
      return;
    }

    button.disabled = true;
    try {
      const response = await authedFetch("/admin/central-bank/reward", {
        method: "POST",
        body: JSON.stringify({ period, amount }),
      });
      const data = await response.json();
      if (!response.ok) {
        errorEl.textContent = adminErrorMessage(data.error);
        return;
      }
      input.value = "";
      await refreshOverview();
    } catch (err) {
      console.error("Failed to reward period", err);
      errorEl.textContent = "Something went wrong. Try again.";
    } finally {
      button.disabled = false;
    }
  });
}

function wireSimpleForm(formId, inputId, buttonId, errorId, submitFn) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    const errorEl = document.getElementById(errorId);

    const amount = Number(input.value);
    errorEl.textContent = "";

    if (!Number.isInteger(amount) || amount <= 0) {
      errorEl.textContent = "Enter a whole number greater than 0.";
      return;
    }

    button.disabled = true;
    try {
      const response = await submitFn(amount);
      const data = await response.json();
      if (!response.ok) {
        errorEl.textContent = adminErrorMessage(data.error);
        return;
      }
      input.value = "";
      await refreshOverview();
    } catch (err) {
      console.error(`Failed to submit ${formId}`, err);
      errorEl.textContent = "Something went wrong. Try again.";
    } finally {
      button.disabled = false;
    }
  });
}

function adminErrorMessage(code) {
  const messages = {
    reserve_insufficient: "The reserve doesn't have enough coins for that.",
    reserve_would_be_insufficient:
      "That would leave the reserve unable to cover bonded principal and outstanding interest.",
    no_students_in_period: "No students are in that period yet.",
    user_not_found: "That student couldn't be found.",
  };
  return messages[code] || "Something went wrong. Try again.";
}
