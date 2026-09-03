import { Router } from "express";
import { db, FieldValue } from "../firebase.js";
import { verifyUser } from "../middleware/auth.js";
import {
  calculateExchangeRate,
  requirePositiveInt,
} from "../helpers/economy.js";

const router = Router();

router.post("/create", verifyUser, async (request, response, next) => {
  try {
    const uid = request.uid;
    const amount = Number(request.body?.amount);

    if (!requirePositiveInt(amount)) {
      return response
        .status(400)
        .json({ error: "amount must be a positive integer" });
    }

    const userRef = db.collection("users").doc(uid);
    const statsRef = db.collection("stats").doc("totals");
    const ledgerRef = db.collection("ledger").doc();

    const extraCreditValue = await db.runTransaction(async (tx) => {
      const [userSnap, statsSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(statsRef),
      ]);

      if (!userSnap.exists) throw new Error("user_not_found");
      const user = userSnap.data();

      if ((user.moorecoins ?? 0) < amount)
        throw new Error("insufficient_balance");

      const circulating = statsSnap.data()?.moorecoinsCirculating ?? 0;
      const exchangeRate = calculateExchangeRate(circulating);
      const creditValue = Number((amount * exchangeRate).toFixed(2));

      tx.update(userRef, { moorecoins: FieldValue.increment(-amount) });

      tx.set(
        statsRef,
        {
          moorecoinsCirculating: FieldValue.increment(-amount),
          moorecoinsRedeemed: FieldValue.increment(amount),
        },
        { merge: true },
      );

      tx.set(ledgerRef, {
        type: "redemption",
        fromPublicId: user.publicUid,
        toPublicId: "centralBank",
        amount,
        timestamp: FieldValue.serverTimestamp(),
        metadata: { exchangeRate, extraCreditValue: creditValue },
      });

      return creditValue;
    });

    response.json({ extraCreditValue });
  } catch (err) {
    if (err.message === "user_not_found")
      return response.status(404).json({ error: "user_not_found" });
    if (err.message === "insufficient_balance")
      return response.status(400).json({ error: "insufficient_balance" });
    next(err);
  }
});

export default router;
