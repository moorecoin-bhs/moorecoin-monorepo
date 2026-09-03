import { app, apiBase } from "./app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { showApiErrorBanner } from "./banner.js";

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const routes = {
  student: "./dashboard.html",
  admin: "./admin.html",
};

function navigateTo(key) {
  const url = routes[key];
  if (url) {
    window.location.href = url;
  }
}

async function ensurePersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (err) {
    console.error("Failed to set auth persistence", err);
  }
}

async function routeByRole(user) {
  const token = await user.getIdToken();
  const sessionResponse = await fetch(`${apiBase}/auth/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!sessionResponse.ok) {
    const body = await sessionResponse.text().catch(() => "<no body>");
    throw new Error(
      `API /auth/session failed (${sessionResponse.status}): ${body}`,
    );
  }

  const data = await sessionResponse.json();

  if (!data.user.finishedOnboarding) {
    window.location.href = "./onboarding.html";
    return;
  }

  navigateTo(data.user.role);
}

async function handleSignIn() {
  const button = document.getElementById("sign-in");

  button.disabled = true;

  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("Sign in failed", err);
  } finally {
    button.disabled = false;
  }
}

function wireUi() {
  const button = document.getElementById("sign-in");

  if (!button) return;

  button.addEventListener("click", handleSignIn);
}

function observeAuth() {
  onAuthStateChanged(auth, (user) => {
    console.log(user ? "Signed in" : "Not signed in", user || "");
    if (user) {
      routeByRole(user).catch((err) => {
        console.error("Failed to route user by role", err);
        showApiErrorBanner();
      });
    }
  });
}

async function main() {
  await ensurePersistence();
  wireUi();
  observeAuth();
}

main();
