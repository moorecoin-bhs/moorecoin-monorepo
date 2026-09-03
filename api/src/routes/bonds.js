import { Router } from "express";
import { db, FieldValue } from "../firebase.js";
import { verifyUser, requireAdmin } from "../middleware/auth.js";
import {
  BOND_TERM_MS,
  calculateInterestRate,
  requirePositiveInt,
} from "../helpers/economy.js";

const router = Router();

const CREATE_ERROR_STATUS = {
  user_not_found: 404,
  insufficient_balance: 400,
  reserve_would_be_insufficient: 409,
};

const COLLECT_ERROR_STATUS = {
  user_not_found: 404,
  bond_not_found: 404,
  bond_not_owned: 403,
  bond_already_collected: 400,
  bond_not_matured: 400,
  reserve_insufficient: 409,
};

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
    const centralBankRef = db.collection("stats").doc("centralBank");
    const bondRef = db.collection("bonds").doc();
    const ledgerRef = db.collection("ledger").doc();

    const bond = await db.runTransaction(async (tx) => {
      const [userSnap, statsSnap, centralBankSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(statsRef),
        tx.get(centralBankRef),
      ]);

      if (!userSnap.exists) throw new Error("user_not_found");
      const user = userSnap.data();

      if ((user.moorecoins ?? 0) < amount)
        throw new Error("insufficient_balance");

      const circulating = statsSnap.data()?.moorecoinsCirculating ?? 0;
      const interestRate = calculateInterestRate(circulating);
      const interestAmount = Math.round(amount * interestRate);

      const reserve = centralBankSnap.data()?.reserve ?? 0;
      const outstandingLiability =
        centralBankSnap.data()?.outstandingInterestLiability ?? 0;

      if (reserve - outstandingLiability < interestAmount) {
        throw new Error("reserve_would_be_insufficient");
      }

      const now = Date.now();
      const newBond = {
        uid,
        publicUid: user.publicUid,
        principal: amount,
        interestRate,
        interestAmount,
        createdAt: now,
        maturesAt: now + BOND_TERM_MS,
        collected: false,
        collectedAt: null,
      };

      tx.set(bondRef, newBond);
      tx.update(userRef, { moorecoins: FieldValue.increment(-amount) });

      tx.set(
        statsRef,
        {
          moorecoinsCirculating: FieldValue.increment(-amount),
          moorecoinsBonded: FieldValue.increment(amount),
        },
        { merge: true },
      );

      tx.set(
        centralBankRef,
        { outstandingInterestLiability: FieldValue.increment(interestAmount) },
        { merge: true },
      );

      tx.set(ledgerRef, {
        type: "bond_created",
        fromPublicId: user.publicUid,
        toPublicId: "centralBank",
        amount,
        timestamp: FieldValue.serverTimestamp(),
        metadata: {
          bondId: bondRef.id,
          interestRate,
          interestAmount,
          maturesAt: newBond.maturesAt,
        },
      });

      return { id: bondRef.id, ...newBond };
    });

    response.json({ bond });
  } catch (err) {
    const status = CREATE_ERROR_STATUS[err.message];
    if (status) return response.status(status).json({ error: err.message });
    next(err);
  }
});

router.post("/collect", verifyUser, async (request, response, next) => {
  try {
    const uid = request.uid;
    const bondId = request.body?.bondId;

    if (!bondId)
      return response.status(400).json({ error: "bondId is required" });

    const userRef = db.collection("users").doc(uid);
    const statsRef = db.collection("stats").doc("totals");
    const centralBankRef = db.collection("stats").doc("centralBank");
    const bondRef = db.collection("bonds").doc(bondId);
    const ledgerRef = db.collection("ledger").doc();

    const payout = await db.runTransaction(async (tx) => {
      const [userSnap, bondSnap, centralBankSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(bondRef),
        tx.get(centralBankRef),
      ]);

      if (!userSnap.exists) throw new Error("user_not_found");
      if (!bondSnap.exists) throw new Error("bond_not_found");

      const user = userSnap.data();
      const bond = bondSnap.data();

      if (bond.uid !== uid) throw new Error("bond_not_owned");
      if (bond.collected) throw new Error("bond_already_collected");
      if (Date.now() < bond.maturesAt) throw new Error("bond_not_matured");

      const reserve = centralBankSnap.data()?.reserve ?? 0;
      if (reserve < bond.interestAmount)
        throw new Error("reserve_insufficient");

      const payoutAmount = bond.principal + bond.interestAmount;

      tx.update(bondRef, { collected: true, collectedAt: Date.now() });
      tx.update(userRef, { moorecoins: FieldValue.increment(payoutAmount) });

      tx.set(
        statsRef,
        {
          moorecoinsBonded: FieldValue.increment(-bond.principal),
          moorecoinsCirculating: FieldValue.increment(payoutAmount),
        },
        { merge: true },
      );

      tx.set(
        centralBankRef,
        {
          reserve: FieldValue.increment(-bond.interestAmount),
          outstandingInterestLiability: FieldValue.increment(
            -bond.interestAmount,
          ),
        },
        { merge: true },
      );

      tx.set(ledgerRef, {
        type: "bond_collected",
        fromPublicId: "centralBank",
        toPublicId: user.publicUid,
        amount: payoutAmount,
        timestamp: FieldValue.serverTimestamp(),
        metadata: { bondId, interestAmount: bond.interestAmount },
      });

      return payoutAmount;
    });

    response.json({ payout });
  } catch (err) {
    const status = COLLECT_ERROR_STATUS[err.message];
    if (status) return response.status(status).json({ error: err.message });
    next(err);
  }
});

router.get("/mine", verifyUser, async (request, response, next) => {
  try {
    const snapshot = await db
      .collection("bonds")
      .where("uid", "==", request.uid)
      .get();
    const bonds = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    response.json({ bonds });
  } catch (err) {
    next(err);
  }
});

router.get("/all", verifyUser, requireAdmin, async (_, response, next) => {
  try {
    const snapshot = await db.collection("bonds").get();
    const bonds = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    response.json({ bonds });
  } catch (err) {
    next(err);
  }
});

export default router;
