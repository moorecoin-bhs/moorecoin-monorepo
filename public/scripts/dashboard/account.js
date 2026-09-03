export async function init(userData) {
  renderCard(userData);
  wireTiltCard();
}

export async function onShow(userData) {
  renderCard(userData);
}

function renderCard(userData) {
  const user = userData?.user ?? {};

  setText("account-card-public-id", user.publicUid);
  setText("account-card-name", user.name);
  setText("account-card-email", user.email);
  setText("account-card-period", user.period ? `${user.period}` : null);
  setText(
    "account-card-coins",
    typeof user.moorecoins === "number"
      ? `${user.moorecoins.toLocaleString()}`
      : null,
  );
  setText("account-card-since", formatMemberSince(user.createdAt));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "—";
}

function formatMemberSince(createdAt) {
  const date = toDate(createdAt);
  if (!date) return null;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function toDate(createdAt) {
  if (!createdAt) return null;

  if (typeof createdAt === "object" && "_seconds" in createdAt) {
    return new Date(createdAt._seconds * 1000);
  }

  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

let tiltWired = false;

function wireTiltCard() {
  if (tiltWired) return; // don't double-bind if init somehow runs twice
  tiltWired = true;

  const card = document.getElementById("account-tilt-card");
  if (!card) return;

  card.addEventListener("mousemove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const rotateY = (x / rect.width - 0.5) * 18;
    const rotateX = (y / rect.height - 0.5) * -18;

    card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    card.style.setProperty("--shine-x", `${(x / rect.width) * 100}%`);
    card.style.setProperty("--shine-y", `${(y / rect.height) * 100}%`);
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "rotateX(0deg) rotateY(0deg)";
  });
}
