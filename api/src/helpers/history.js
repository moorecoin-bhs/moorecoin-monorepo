import {
  calculateExchangeRate,
  calculateInterestRate,
  computeTotalSupply,
} from "./economy.js";

// Nothing in Firestore stores the economy's past — stats/totals and
// stats/centralBank only hold the present. But every change to those docs
// writes a timestamped ledger entry in the same transaction, so the history
// can be rebuilt by replaying the ledger.
//
// The replay runs *backward* from the current stats rather than forward from
// zero. Older entries predate some of today's bookkeeping (see the backfill
// scripts), so a forward replay would drift and end on a number that
// disagrees with the admin overview. Anchoring on the present means the
// newest point is always exactly right, and any drift lands in the distant
// past where it matters least.

const TRACKED = ["circulating", "reserve", "bonded", "redeemed", "users"];

// How one ledger entry moved each tracked balance. Mirrors the increments in
// the routes that write each entry type — change one, change the other.
export function ledgerDelta(entry) {
  const amount = Number(entry.amount) || 0;

  switch (entry.type) {
    case "signup":
    case "reward":
      return { circulating: amount, reserve: -amount };
    case "mint":
      // Distribute is also written as type "mint", but it moves coins from
      // the reserve to a student instead of creating them. Only it has a
      // student on the receiving end.
      if (entry.metadata?.action === "distribute" || entry.toUid) {
        return { circulating: amount, reserve: -amount };
      }
      return { reserve: amount };
    case "burn":
      return { reserve: -amount };
    case "revoke":
      return { circulating: -amount, reserve: amount };
    case "bond_created":
      return { circulating: -amount, reserve: amount, bonded: amount };
    case "bond_collected": {
      // amount is the full payout; only the principal was ever bonded.
      const interest = Number(entry.metadata?.interestAmount) || 0;
      return {
        circulating: amount,
        reserve: -amount,
        bonded: -(amount - interest),
      };
    }
    case "redemption":
      return { circulating: -amount, redeemed: amount };
    default:
      return {};
  }
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function snapshot(state, t) {
  const supply = computeTotalSupply(state.circulating, state.reserve);
  return {
    t,
    ...state,
    supply,
    exchangeRate: round(calculateExchangeRate(supply), 6),
    interestRate: round(calculateInterestRate(supply), 6),
  };
}

// events: [{ t, delta, volume }] in any order. current: today's balances.
//
// Returns the state just before the first event (`start`) and the state
// after each distinct timestamp (`points`). Events sharing a timestamp are
// one transaction — a period reward writes one entry per student — so they
// collapse into a single point rather than inventing intermediate states
// that never existed.
export function buildHistory(events, current) {
  const sorted = [...events].sort((a, b) => a.t - b.t);

  const groups = [];
  for (const event of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.t === event.t) {
      last.events.push(event);
    } else {
      groups.push({ t: event.t, events: [event] });
    }
  }

  const state = Object.fromEntries(
    TRACKED.map((key) => [key, current[key] ?? 0]),
  );

  const points = new Array(groups.length);
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    let volume = 0;
    let transactions = 0;

    for (const event of group.events) {
      volume += event.volume;
      transactions += event.volume > 0 ? 1 : 0;
    }

    points[i] = { ...snapshot(state, group.t), volume, transactions };

    for (const event of group.events) {
      for (const [key, change] of Object.entries(event.delta)) {
        state[key] -= change;
      }
    }
  }

  return {
    start: snapshot(state, groups[0]?.t ?? Date.now()),
    points,
  };
}
