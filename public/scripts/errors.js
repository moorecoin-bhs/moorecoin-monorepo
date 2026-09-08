// One place mapping server error codes to user-facing text.
//
// Every route returns { error: "<code>" } with a specific status, so the UI
// only has to look codes up here. Previously each screen kept its own
// partial map and any code it didn't know fell through to "Something went
// wrong. Try again." — including four distinct bond-collection failures that
// each need a different explanation.

// Codes whose wording depends on the runtime config (see config.js).
function dynamicMessages(config) {
  const min = config?.minAmount ?? 1;

  return {
    invalid_amount: config
      ? `Enter a whole number between ${min.toLocaleString()} and ${config.maxAmount.toLocaleString()}.`
      : `Enter a whole number of ${min.toLocaleString()} or more.`,
    invalid_period: config
      ? `Choose a period between ${config.periodMin} and ${config.periodMax}.`
      : "Choose a valid period.",
  };
}

const STATIC_MESSAGES = {
  // auth / session
  missing_token: "You're signed out. Refresh the page and sign in again.",
  invalid_token: "Your session expired. Refresh the page and sign in again.",
  email_not_allowed:
    "This Google account can't use Moorecoin. Sign in with your school account.",
  email_not_verified:
    "This Google account's email address hasn't been verified.",
  forbidden: "You don't have permission to do that.",

  // request shape
  invalid_json: "Something went wrong sending that. Try again.",
  payload_too_large: "That request was too large.",
  invalid_uid: "That account couldn't be identified. Refresh and try again.",
  invalid_bond_id: "That bond couldn't be identified. Refresh and try again.",

  // economy
  insufficient_balance: "You don't have enough Moorecoins for that.",
  reserve_insufficient: "The reserve doesn't have enough coins for that.",
  reserve_would_be_insufficient:
    "That would leave the reserve unable to cover bonded principal and outstanding interest.",
  no_students_in_period: "No students are in that period yet.",
  too_many_recipients:
    "That period has too many students to reward in one go. Contact support.",
  user_not_found: "That account couldn't be found.",

  // bond collection — four distinct reasons that previously all showed
  // nothing at all, leaving the button to silently revert.
  bond_not_found: "That bond no longer exists. Refresh to see your bonds.",
  bond_not_owned: "That bond isn't yours.",
  bond_already_collected: "That bond has already been collected.",
  bond_not_matured: "That bond hasn't matured yet.",

  internal_error: "Something went wrong on our end. Try again.",
};

export const FALLBACK_MESSAGE = "Something went wrong. Try again.";

// `overrides` lets a screen reword a shared code where its context differs,
// e.g. the admin panel saying "student" instead of "account".
export function messageForError(code, { config = null, overrides = {} } = {}) {
  const messages = {
    ...STATIC_MESSAGES,
    ...dynamicMessages(config),
    ...overrides,
  };
  // Same reason as routes.js: a plain lookup on "__proto__" returns
  // Object.prototype rather than falling through to the fallback.
  return Object.hasOwn(messages, code) ? messages[code] : FALLBACK_MESSAGE;
}
