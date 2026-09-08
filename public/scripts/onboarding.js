import { app, apiBase } from "./app.js";
import { getEconomyConfig, populatePeriodSelect } from "./config.js";
import { messageForError } from "./errors.js";
import { showApiErrorBanner } from "./banner.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const auth = getAuth(app);

let currentUserData = null;
let selectedPeriod = null;
let economyConfig = null;

const steps = ["step-1", "step-2", "step-3", "step-4"];

onAuthStateChanged(auth, async (user) => {
  if (!user?.uid) {
    window.location.href = "./index.html";
    return;
  }

  try {
    currentUserData = await fetchSession(await user.getIdToken());

    if (currentUserData.user.finishedOnboarding) {
      window.location.href = "./dashboard.html";
      return;
    }

    await wireSteps();
  } catch (err) {
    console.error("Failed to load onboarding", err);
  }
});

async function fetchSession(token) {
  const response = await fetch(`${apiBase}/auth/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "<no body>");
    throw new Error(`API /auth/session failed (${response.status}): ${body}`);
  }

  return response.json();
}

function goToStep(index) {
  steps.forEach((id, i) => {
    document.getElementById(id).classList.toggle("active", i === index);
  });

  document.querySelectorAll(".step-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === index);
  });
}

async function wireSteps() {
  // Step 1: period select — options come from the server's period range so
  // a student can never pick one the API will reject.
  const periodSelect = document.getElementById("period-select");
  economyConfig = await getEconomyConfig();
  populatePeriodSelect(periodSelect, economyConfig);
  const step1Continue = document.getElementById("step-1-continue");

  periodSelect.addEventListener("change", () => {
    step1Continue.disabled = !periodSelect.value;
  });

  step1Continue.addEventListener("click", () => {
    selectedPeriod = Number(periodSelect.value);
    document.getElementById("confirm-period-text").textContent =
      `Period ${selectedPeriod}`;
    goToStep(1);
  });

  // Step 2: confirm
  document.getElementById("step-2-back").addEventListener("click", () => {
    goToStep(0);
  });

  document.getElementById("step-2-confirm").addEventListener("click", () => {
    populateCard();
    goToStep(2);
  });

  // Step 3: card + continue
  wireTiltCard();
  document.getElementById("step-3-continue").addEventListener("click", () => {
    goToStep(3);
  });

  // Step 4: finish
  document
    .getElementById("step-4-finish")
    .addEventListener("click", handleFinish);
}

function populateCard() {
  const user = currentUserData?.user ?? {};
  document.getElementById("card-public-id").textContent = user.publicUid || "—";
  document.getElementById("card-name").textContent = user.name || "—";
  document.getElementById("card-email").textContent = user.email || "—";
  document.getElementById("card-period").textContent = selectedPeriod
    ? `Period ${selectedPeriod}`
    : "—";
}

function wireTiltCard() {
  const card = document.getElementById("tilt-card");
  if (!card) return;

  card.addEventListener("mousemove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const rotateY = (x / rect.width - 0.5) * 18;
    const rotateX = (y / rect.height - 0.5) * -18;

    card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    card.style.setProperty("--shine-x", `${(x / rect.width) * 100}%`);
    card.style.setProperty("--shine-y", `${(y / rect.height) * 100}%`);
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "rotateX(0deg) rotateY(0deg)";
  });
}

async function handleFinish() {
  const finishButton = document.getElementById("step-4-finish");
  finishButton.disabled = true;

  try {
    // Fetched fresh rather than reused from page load: Firebase ID tokens
    // expire after an hour, and a student can easily leave this tab open
    // longer than that. getIdToken() refreshes automatically when needed —
    // a stored token would simply 401 at the final step.
    const user = auth.currentUser;
    if (!user) {
      window.location.href = "./index.html";
      return;
    }
    const token = await user.getIdToken();

    const response = await fetch(`${apiBase}/user/finish-onboarding`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ period: selectedPeriod }),
    });

    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      // This is the last step of onboarding; failing with nothing but a
      // console message leaves the student stuck with no idea why.
      showApiErrorBanner(messageForError(error, { config: economyConfig }));
      finishButton.disabled = false;
      return;
    }

    window.location.href = "./dashboard.html";
  } catch (err) {
    console.error("Failed to finish onboarding", err);
    showApiErrorBanner("Couldn't finish setting up your account. Try again.");
    finishButton.disabled = false;
  }
}
