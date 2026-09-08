import { Router } from "express";
import { db } from "../firebase.js";
import {
  calculateInterestRate,
  calculateExchangeRate,
  MIN_AMOUNT,
  MAX_AMOUNT,
  PERIOD_MIN,
  PERIOD_MAX,
  BOND_TERM_DAYS,
} from "../helpers/economy.js";

const router = Router();

// Public — just exposes current reference rates, no user data.
router.get("/rates", async (_, response, next) => {
  try {
    const statsSnap = await db.collection("stats").doc("totals").get();
    const circulating = statsSnap.data()?.moorecoinsCirculating ?? 0;

    response.json({
      circulating,
      interestRate: calculateInterestRate(circulating),
      exchangeRate: calculateExchangeRate(circulating),
    });
  } catch (err) {
    next(err);
  }
});

// Public — the validation rules the browser needs so it can check input
// before submitting without keeping its own copy of the numbers. These are
// the same constants the routes validate against, so the two cannot drift.
// Static, so it is safe to cache for a while.
router.get("/config", (_, response) => {
  response.set("Cache-Control", "public, max-age=300");
  response.json({
    minAmount: MIN_AMOUNT,
    maxAmount: MAX_AMOUNT,
    periodMin: PERIOD_MIN,
    periodMax: PERIOD_MAX,
    bondTermDays: BOND_TERM_DAYS,
  });
});

export default router;
