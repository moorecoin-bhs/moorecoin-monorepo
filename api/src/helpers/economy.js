export const BOND_TERM_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export const calculateExchangeRate = (t) =>
  Math.max(0.005, 1.2 * Math.exp(-0.000521 * t));

export const calculateInterestRate = (t) =>
  0.1 + 0.65 * Math.exp(-0.000486 * t);

export function requirePositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

export function generatePublicUid(name, email) {
  const stripEmailRegex = /@.+$/;
  const studentId = email.replace(stripEmailRegex, "");
  const shortStudentId = studentId.slice(-3);

  const safeName = name?.trim() || "Unknown User";
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
