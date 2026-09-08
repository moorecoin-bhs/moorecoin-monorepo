// Where each role's home page lives.
//
// Kept in one place so the sign-in flow and the end of onboarding can't
// disagree about where a user belongs. They previously did: sign-in routed
// by role, but onboarding sent everyone to the student dashboard, so a new
// admin finished setup on the wrong page.

const ROLE_HOME = {
  student: "./dashboard.html",
  admin: "./admin.html",
};

// Falls back to the student dashboard rather than doing nothing, so an
// unrecognised or missing role still lands somewhere usable instead of
// leaving the user stranded on the sign-in page with no feedback.
export const DEFAULT_HOME = ROLE_HOME.student;

export function homeForRole(role) {
  // Object.hasOwn, not a plain lookup: ROLE_HOME["__proto__"] would return
  // Object.prototype, which is truthy, so `?? DEFAULT_HOME` would not catch
  // it and the browser would be sent to "[object Object]".
  return Object.hasOwn(ROLE_HOME, role) ? ROLE_HOME[role] : DEFAULT_HOME;
}
