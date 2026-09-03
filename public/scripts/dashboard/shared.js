import { app, apiBase } from "../app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const auth = getAuth(app);

const sections = {
  "#dashboard": () => import("./dashboard.js"),
  "#account": () => import("./account.js"),
  "#ledger": () => import("./ledger.js"),
  "#settings": () => import("./settings.js"),
};

const loadedSections = new Set();
let cachedUserData = null;

export function initSidebar() {
  onAuthStateChanged(auth, async (user) => {
    if (!user?.uid) {
      window.location.href = "./index.html";
      return;
    }

    try {
      cachedUserData = await populateUserInfo(user);
      if (!cachedUserData.user.finishedOnboarding) {
        window.location.href = "./onboarding.html";
        return;
      }
    } catch (err) {
      console.error("Failed to populate dashboard UI", err);
    }

    await showActiveView();
  });

  setActiveNavItem();
  wireSidebarToggle();
  wireSignOut();

  window.addEventListener("hashchange", () => {
    setActiveNavItem();
    showActiveView();
  });
}

async function showActiveView() {
  const hash = location.hash || "#dashboard";
  console.log("showActiveView called with hash:", hash); // temp debug

  const targetId = `view-${hash.slice(1)}`;

  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === targetId);
  });

  const loadSection = sections[hash];
  if (!loadSection) return;

  try {
    const module = await loadSection();

    if (!loadedSections.has(hash)) {
      console.log("Loaded " + hash);
      await module.init?.(cachedUserData);
      loadedSections.add(hash);
    } else {
      console.log("Switched to " + hash);
      await module.onShow?.(cachedUserData);
    }
  } catch (err) {
    console.error(`Failed to load section for ${hash}`, err);
  }
}

function setActiveNavItem() {
  const hash = location.hash || "#dashboard";
  const items = document.querySelectorAll(".sidebar li");
  const indicator = document.querySelector(".nav-indicator");

  let activeLi = null;

  items.forEach((li) => {
    const link = li.querySelector("a");
    const isActive = link?.getAttribute("href") === hash;

    li.classList.toggle("active", isActive);

    if (isActive) activeLi = li;
  });

  if (activeLi && indicator) {
    const sidebar = document.querySelector(".sidebar");
    const liRect = activeLi.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    const offsetTop = liRect.top - sidebarRect.top + sidebar.scrollTop;
    const centeredTop =
      offsetTop + liRect.height / 2 - indicator.offsetHeight / 2;
    indicator.style.top = `${centeredTop}px`;
  }
}

function wireSidebarToggle() {
  const toggle = document.querySelector(".sidebar-toggle");
  const sidebar = document.querySelector(".sidebar");
  toggle?.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });
}

function wireSignOut() {
  const signOutButton = document.getElementById("sign-out");
  signOutButton?.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign out failed", err);
    }
  });
}

async function populateUserInfo(user) {
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
  const nameEl = document.querySelector(".user-info-name");
  const emailEl = document.querySelector(".user-info-email");
  if (nameEl) nameEl.textContent = data.user.name || "Unknown name";
  if (emailEl) emailEl.textContent = data.user.email || "Unknown email";

  return data;
}
