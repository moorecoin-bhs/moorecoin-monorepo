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
