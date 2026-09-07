import { Router } from "express";
import { db } from "../firebase.js";
import {
  calculateInterestRate,
  calculateExchangeRate,
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

export default router;
