import "dotenv/config";

function parseList(value) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

// Which Google accounts are allowed to use Moorecoin at all.
//
// ALLOWED_EMAIL_DOMAINS is the normal control (e.g. "brightonk12.com").
// ALLOWED_EMAILS is an escape hatch for individual addresses outside those
// domains — most importantly a bootstrap admin account that isn't on the
// school domain. Without it, tightening the domain list could lock the
// teacher out of their own admin panel.
export const ALLOWED_EMAIL_DOMAINS = parseList(
  process.env.ALLOWED_EMAIL_DOMAINS,
);
export const ALLOWED_EMAILS = parseList(process.env.ALLOWED_EMAILS);

// Accounts that are always admins, reconciled on every sign-in.
//
// This is a floor, not the full admin list: admins promoted later (through
// Firestore or a future admin-management endpoint) keep their role even
// though they aren't listed here. Nobody is ever demoted from this list's
// absence — see reconcileAdminRole in routes/auth.js.
//
// Its purpose is to make admin access recoverable by config alone. Without
// it, a bad Firestore edit can leave the deployment with no admin at all
// and no in-app way back in.
export const ADMIN_EMAILS = parseList(process.env.ADMIN_EMAILS);

// Fail closed at startup rather than silently admitting everyone, matching
// how firebase.js treats a missing service account. An empty allowlist is
// almost certainly a misconfiguration, not an intent to run open.
if (ALLOWED_EMAIL_DOMAINS.length === 0 && ALLOWED_EMAILS.length === 0) {
  console.error(
    "Set ALLOWED_EMAIL_DOMAINS (and/or ALLOWED_EMAILS) — refusing to start " +
      "with an empty sign-in allowlist.",
  );
  process.exit(1);
}

function normalizeEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  if (ALLOWED_EMAILS.includes(normalized)) return true;

  // Exact domain match only. endsWith() would let "notbrightonk12.com"
  // through on a "brightonk12.com" allowlist.
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

export function isBootstrapAdmin(email) {
  const normalized = normalizeEmail(email);
  return normalized !== null && ADMIN_EMAILS.includes(normalized);
}

// An admin who can't get past verifyUser is not an admin. Catch that
// contradiction at boot instead of at the moment they try to sign in.
const unreachableAdmins = ADMIN_EMAILS.filter((email) => !isAllowedEmail(email));
if (unreachableAdmins.length > 0) {
  console.error(
    `ADMIN_EMAILS contains addresses the sign-in allowlist rejects: ` +
      `${unreachableAdmins.join(", ")}. Add their domain to ` +
      `ALLOWED_EMAIL_DOMAINS or the addresses to ALLOWED_EMAILS.`,
  );
  process.exit(1);
}
