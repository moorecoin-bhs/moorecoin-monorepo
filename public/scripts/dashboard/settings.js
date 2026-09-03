export async function init(userData) {
  wireSupportLink(userData);
  wireDeletionLink(userData);
}

export async function onShow(userData) {
  wireSupportLink(userData);
  wireDeletionLink(userData);
}

const SUPPORT_EMAIL = "20029686@brightonk12.com";

function wireSupportLink(userData) {
  const link = document.getElementById("support-email-link");
  if (!link) return;

  const user = userData?.user ?? {};
  const subject = encodeURIComponent("Moorecoin support request");
  const body = encodeURIComponent(
    `Moorecoin ID: ${user.publicUid ?? "unknown"}\n\nDescribe your issue below:\n`,
  );

  link.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

function wireDeletionLink(userData) {
  const link = document.getElementById("delete-request-link");
  if (!link) return;

  const user = userData?.user ?? {};
  const subject = encodeURIComponent("Moorecoin account deletion request");
  const body = encodeURIComponent(
    `I would like my Moorecoin account removed.\n\nMoorecoin ID: ${
      user.publicUid ?? "unknown"
    }\nEmail: ${user.email ?? "unknown"}\n`,
  );

  link.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
