// Firebase Analytics (GA4), wired as a fire-and-forget side channel.
//
// Three rules shape everything below, in order of importance:
//
// 1. Analytics must never break the app. The SDK is a third-party bundle
//    fetched from gstatic and it injects a gtag script of its own — both are
//    routinely blocked by extensions. A static `import` of a blocked module
//    throws before the importing module's first statement runs, which on this
//    site would take sign-in down with it. So the SDK is pulled in with a
//    dynamic import inside try/catch, and every exported function returns
//    void and swallows its own failures. A dead analytics pipe degrades to
//    silence, never to a broken page.
//
// 2. No personal data leaves the browser. Google's measurement terms forbid
//    sending PII to GA4, and this app holds real students' names and school
//    email addresses. Identity travels only as the Firebase uid via
//    setUserId(); everything else is an aggregate (role, period, amounts).
//    scrubParams() enforces this at the edge so a future call site can't
//    quietly pass `{ name }` through.
//
// 3. One name per thing that happens. Call sites pass an event from the list
//    in this file rather than inventing strings inline, because GA4 has no
//    rename and a typo becomes a permanent second column in the dashboard.

import { app } from "./app.js";

const SDK_URL =
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js";

// Local development shares the production measurement ID, so left ungated it
// would mix dev clicks into real usage. Set the "moorecoin:analytics" key in
// localStorage to "on" to check the wiring from localhost, or to "off" to
// silence a deployed page.
const OVERRIDE_KEY = "moorecoin:analytics";
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", ""]);

function collectionEnabled() {
  try {
    const override = localStorage.getItem(OVERRIDE_KEY);
    if (override === "on") return true;
    if (override === "off") return false;
  } catch {
    // Storage access throws outright in some privacy modes; fall through to
    // the host check rather than losing analytics on every locked-down browser.
  }

  return !DEV_HOSTS.has(location.hostname);
}

// Resolves to the analytics instance, or null when analytics is disabled,
// unsupported or blocked. Never rejects.
let ready = null;
let sdk = null;

function ensureAnalytics() {
  if (!ready) ready = load();
  return ready;
}

async function load() {
  if (!collectionEnabled()) return null;

  try {
    const module = await import(SDK_URL);

    // False in environments where measurement can't work at all — no
    // cookies, no indexedDB, some in-app webviews. getAnalytics() throws
    // there rather than no-opping.
    if (!(await module.isSupported())) return null;

    sdk = module;
    return module.getAnalytics(app);
  } catch (err) {
    // Info, not error: a blocked analytics bundle is an expected state, and
    // logging it as an error trains people to ignore the console.
    console.info("Analytics unavailable", err);
    return null;
  }
}

// --- payload hygiene ---

// Keys whose values are, or could become, personal data. Dropped rather than
// hashed: a hashed school email is still a stable identifier for one student.
const BLOCKED_KEY = /name|e?mail|phone|address|token|password/i;

// GA4 rejects params over 100 characters and silently drops values that
// aren't a string, number or boolean.
const MAX_VALUE_LENGTH = 100;

function scrubParams(params) {
  const clean = {};

  for (const [key, value] of Object.entries(params)) {
    if (BLOCKED_KEY.test(key)) {
      console.warn(`Analytics: dropped disallowed param "${key}"`);
      continue;
    }

    if (value === null || value === undefined) continue;

    if (typeof value === "number") {
      if (Number.isFinite(value)) clean[key] = value;
      continue;
    }

    if (typeof value === "boolean") {
      clean[key] = value;
      continue;
    }

    clean[key] = String(value).slice(0, MAX_VALUE_LENGTH);
  }

  return clean;
}

// --- the event vocabulary ---

// Every event this app can emit. Call sites reference EVENTS.x so a rename
// is a single edit and a typo is a TypeError here instead of a phantom
// metric in the GA4 console.
export const EVENTS = {
  // auth — `login` and `sign_up` are GA4 reserved names with built-in
  // reporting, so they keep Google's spelling rather than a local one.
  LOGIN: "login",
  LOGIN_FAILED: "login_failed",
  SIGN_UP: "sign_up",
  ACCESS_DENIED: "access_denied",
  LOGOUT: "logout",

  // navigation — the dashboards are hash-routed, and the web SDK's automatic
  // page_view does not fire on a hash change. This is logged in its place.
  SECTION_VIEW: "section_view",

  // onboarding
  ONBOARDING_STEP: "onboarding_step",

  // student economy
  BOND_CREATE: "bond_create",
  BOND_COLLECT: "bond_collect",
  REDEEM: "redeem_coins",
  LEDGER_REFRESH: "ledger_refresh",

  // admin
  ADMIN_ACTION: "admin_action",

  // failures — one event with a `reason` rather than an event per code, so
  // the codes stay comparable in a single report.
  ACTION_FAILED: "action_failed",
  APP_ERROR: "app_error",
};

// --- public API ---

// Fire-and-forget. Calls made before the SDK finishes loading are delivered
// in order once it does: they queue as .then callbacks on the same promise.
export function track(event, params = {}) {
  ensureAnalytics()
    .then((analytics) => {
      if (!analytics) return;
      sdk.logEvent(analytics, event, scrubParams(params));
    })
    .catch(() => {});
}

// Attaches the signed-in user to subsequent events.
//
// `user` is the object from POST /auth/session. Only role and period are
// forwarded — both are low-cardinality attributes shared by many students,
// which is what makes them safe to store and useful to segment by. Name,
// email and publicUid are deliberately not sent.
export function identify(uid, user = {}) {
  ensureAnalytics()
    .then((analytics) => {
      if (!analytics) return;

      sdk.setUserId(analytics, uid ?? null);
      sdk.setUserProperties(
        analytics,
        scrubParams({
          role: user.role,
          period: user.period,
          onboarded: Boolean(user.finishedOnboarding),
        }),
      );
    })
    .catch(() => {});
}

// Clears the identity on sign-out so a second sign-in on a shared computer —
// the normal case in a classroom — isn't attributed to the first student.
export function clearIdentity() {
  ensureAnalytics()
    .then((analytics) => {
      if (!analytics) return;
      sdk.setUserId(analytics, null);
    })
    .catch(() => {});
}

// --- shorthands for the repeated shapes ---

export function trackSectionView(area, hash) {
  track(EVENTS.SECTION_VIEW, {
    area,
    section: (hash || "").replace(/^#/, "") || "default",
  });
}

// `reason` is a server error code from errors.js, or "network" when the
// request never completed. Both are bounded sets, so they group cleanly.
export function trackFailure(action, reason) {
  track(EVENTS.ACTION_FAILED, { action, reason: reason ?? "unknown" });
}

// Kick the SDK off at import time so each page logs its automatic page_view
// without waiting for the first user action. Nothing awaits this.
ensureAnalytics();
