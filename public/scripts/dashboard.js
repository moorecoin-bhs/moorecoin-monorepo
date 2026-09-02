import { app } from "./app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const auth = getAuth(app);

onAuthStateChanged(auth, async (user) => {
  if (!user?.uid) {
    window.location.href = "./index.html";
    return;
  }
});

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

async function handleSignOut() {
  try {
    await auth.signOut();
  } catch (err) {
    console.error("Sign out failed", err);
  }
}

const signOutButton = document.getElementById("sign-out");

window.addEventListener("hashchange", setActiveNavItem);
document.addEventListener("DOMContentLoaded", setActiveNavItem);
document.addEventListener("DOMContentLoaded", wireSidebarToggle);
signOutButton.addEventListener("click", handleSignOut);
