import { app, apiBase } from "./app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { showApiErrorBanner } from "./banner.js";
import { homeForRole } from "./routes.js";

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Thrown when the account is valid but not permitted, as opposed to the
// API being unreachable. The two need different messages: one is the user's
// problem to fix, the other is ours.
class AccessDeniedError extends Error {}

const ACCESS_DENIED_MESSAGES = {
  email_not_allowed:
    "This Google account can't use Moorecoin. Sign in with your school account.",
  email_not_verified:
    "This Google account's email address hasn't been verified.",
};

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

  if (sessionResponse.status === 403) {
    const { error } = await sessionResponse.json().catch(() => ({}));

    // Sign out, or local persistence keeps the rejected account and every
    // reload retries it — leaving the user stuck with no way to switch.
    await signOut(auth).catch(() => {});

    throw new AccessDeniedError(
      ACCESS_DENIED_MESSAGES[error] ?? "This account can't use Moorecoin.",
    );
  }

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

  window.location.href = homeForRole(data.user.role);
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
    if (user) {
      routeByRole(user).catch((err) => {
        if (err instanceof AccessDeniedError) {
          showApiErrorBanner(err.message);
          return;
        }
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
