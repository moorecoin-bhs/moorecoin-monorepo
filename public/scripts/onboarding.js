import { app, apiBase } from "./app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const auth = getAuth(app);

let currentUserData = null;
let selectedPeriod = null;
let idToken = null;

const steps = ["step-1", "step-2", "step-3", "step-4"];

onAuthStateChanged(auth, async (user) => {
  if (!user?.uid) {
    window.location.href = "./index.html";
    return;
  }

  try {
    idToken = await user.getIdToken();
    currentUserData = await fetchSession(idToken);

    if (currentUserData.user.finishedOnboarding) {
      window.location.href = "./dashboard.html";
      return;
    }

    wireSteps();
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

function wireSteps() {
  // Step 1: period select
  const periodSelect = document.getElementById("period-select");
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
    const response = await fetch(`${apiBase}/user/finish-onboarding`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ period: selectedPeriod }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "<no body>");
      throw new Error(
        `API /user/finish-onboarding failed (${response.status}): ${body}`,
      );
    }

    window.location.href = "./dashboard.html";
  } catch (err) {
    console.error("Failed to finish onboarding", err);
    finishButton.disabled = false;
  }
}
