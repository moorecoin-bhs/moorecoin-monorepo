export async function init(userData) {
  renderStats(userData);
  renderBonds(userData);
}

export async function onShow(userData) {
  renderStats(userData);
  renderBonds(userData);
}

function renderStats(userData) {
  console.log(userData);
  const user = userData?.user ?? {};

  const liquid = user.moorecoins ?? 0;

  const bonded = sumBondAmounts(user.bonds);
  const pending = user.pendingRedemption ?? 0;
  const total = liquid + bonded + pending;

  setStatValue("stat-liquid", liquid);
  setStatValue("stat-bonded", bonded);
  setStatValue("stat-pending", pending);
  setStatValue("stat-total", total);
}

function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value.toLocaleString();
}

function sumBondAmounts(bonds) {
  if (!Array.isArray(bonds)) return 0;
  return bonds.reduce((sum, bond) => sum + (bond.principal ?? 0), 0);
}

function renderBonds(userData) {
  const bondsList = document.getElementById("bonds-list");
  if (!bondsList) return;

  const bonds = userData?.user?.bonds;

  if (!Array.isArray(bonds) || bonds.length === 0) {
    bondsList.innerHTML = `<li class="bonds-empty">No active bonds yet.</li>`;
    return;
  }

  bondsList.innerHTML = bonds
    .map(
      (bond) => `
        <li class="bond-item">
          <span>${bond.label ?? "Bond"}</span>
          <span class="bond-item-amount">${(bond.principal ?? 0).toLocaleString()} coins</span>
        </li>
      `,
    )
    .join("");
}
