// --- shared validation rules -------------------------------------------
//
// These are the single source of truth for every rule the client and server
// both enforce. The browser cannot import this file, so it reads the same
// values at runtime from GET /economy/config (see routes/economy.js) rather
// than hardcoding its own copies. Change a value here and both sides follow.

export const BOND_TERM_DAYS = 14;
export const BOND_TERM_MS = BOND_TERM_DAYS * 24 * 60 * 60 * 1000;

export const MIN_AMOUNT = 1;

// Upper bound on any single coin amount (mint, burn, distribute, reward,
// bond, redemption).
//
// Number.isInteger alone is not a bound: Number.isInteger(1e21) is true, so
// the previous positive-integer check accepted 1e21 and would have written a
// reserve with lost integer precision.
//
// Sized against the real economy (reserve starts around 1,500) so that it
// also catches an admin typo — an extra zero on a realistic mint is rejected
// rather than silently applied. Raise it here if the economy outgrows it;
// nothing else needs changing.
export const MAX_AMOUNT = 10_000;

export const PERIOD_MIN = 1;
export const PERIOD_MAX = 6;

// Every Moorecoin that exists: liquid balances in student accounts plus
// everything held by the central bank.
//
// Bonded principal needs no term of its own — creating a bond moves the
// coins out of `moorecoinsCirculating` and deposits them into `reserve`,
// so they are counted exactly once, on the reserve side, for the length of
// the term. `moorecoinsBonded` is a memo of how much of the reserve is
// spoken for, not a separate pile of coins; adding it here would
// double-count every open bond.
//
// The identity this preserves: supply == totalMinted - burned - redeemed.
// Handing coins out (signup bonus, distribute, reward), locking them in a
// bond and collecting one all move coins between the two terms without
// changing the sum — only minting, burning and redemption move it.
export function computeTotalSupply(circulating, reserve) {
  return circulating + reserve;
}

// Both curves take the total supply above, not just the circulating slice:
// a coin sitting in the reserve has already been created, and the rates
// exist to price how many coins exist.
export const calculateExchangeRate = (supply) =>
  Math.max(0.005, 1.2 * Math.exp(-0.000521 * supply));

export const calculateInterestRate = (supply) =>
  0.1 + 0.65 * Math.exp(-0.000486 * supply);

// Replaces the former requirePositiveInt, which had no upper bound.
export function isValidAmount(value) {
  return (
    Number.isInteger(value) && value >= MIN_AMOUNT && value <= MAX_AMOUNT
  );
}

export function isValidPeriod(value) {
  return (
    Number.isInteger(value) && value >= PERIOD_MIN && value <= PERIOD_MAX
  );
}

// Firebase Auth UIDs are non-empty strings of at most 128 characters. The
// extra checks reject values that are not legal Firestore document IDs —
// passing one of those to .doc() throws, which surfaces as a 500 instead of
// a 400. Callers must validate before building a DocumentReference.
export function isValidUid(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 128) return false;
  if (value.includes("/")) return false; // would split into extra path segments
  if (value === "." || value === "..") return false;
  if (/^__.*__$/.test(value)) return false; // reserved by Firestore
  return true;
}

// Coins physically sitting in the reserve that are not already promised to
// someone: the raw balance minus every open bond's principal (owed back to a
// student) and the interest promised on those bonds. This is the floor every
// spend path must respect — see the burn/distribute/reward routes.
export function computeFreeReserve(reserve, bonded, liability) {
  return reserve - bonded - liability;
}

// Both claims are optional on a Firebase ID token, so neither may throw
// here: this runs inside the signup transaction, and a TypeError would
// surface as a 500 on /auth/session and lock the user out of signing up at
// all. verifyUser currently guarantees a well-formed email before this is
// reached, but the helper must not depend on a caller's invariant.
export function generatePublicUid(name, email) {
  const stripEmailRegex = /@.+$/;
  const safeEmail = typeof email === "string" ? email : "";
  const studentId = safeEmail.replace(stripEmailRegex, "");
  // Padded so a missing or unusually short local part still yields the
  // normal 2-letter + 3-character shape rather than a stub like "JD".
  const shortStudentId = studentId.slice(-3).padStart(3, "0");

  const safeName = (typeof name === "string" ? name.trim() : "") || "Unknown User";
  const nameParts = safeName.split(" ").filter(Boolean);
  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];

  return `${firstName[0]}${lastName[0]}${shortStudentId}`.toUpperCase();
}

// Represents either a real user or a system actor (centralBank/teacher)
// in a from/to slot on a ledger entry.
export function ledgerParty(userOrLabel) {
  if (typeof userOrLabel === "string") {
    return { uid: null, publicId: userOrLabel, name: null, email: null };
  }
  return {
    uid: userOrLabel.uid,
    publicId: userOrLabel.publicUid,
    name: userOrLabel.name,
    email: userOrLabel.email,
  };
}

export function buildLedgerEntry({ type, from, to, amount, metadata = {} }) {
  const fromParty = ledgerParty(from);
  const toParty = ledgerParty(to);

  return {
    type,
    fromUid: fromParty.uid,
    fromPublicId: fromParty.publicId,
    fromName: fromParty.name,
    fromEmail: fromParty.email,
    toUid: toParty.uid,
    toPublicId: toParty.publicId,
    toName: toParty.name,
    toEmail: toParty.email,
    amount,
    metadata,
  };
}

// Strips identity fields — used for any endpoint the public/students hit.
export function toPublicLedgerEntry(entry) {
  const { fromUid, fromName, fromEmail, toUid, toName, toEmail, ...rest } =
    entry;
  return rest;
}

export function toPublicBond(bond) {
  const { uid, name, email, ...rest } = bond;
  return rest;
}
