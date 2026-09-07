import { Router } from "express";
import { db, FieldValue } from "../firebase.js";
import { verifyUser, requireAdmin } from "../middleware/auth.js";
import { requirePositiveInt, buildLedgerEntry } from "../helpers/economy.js";

const router = Router();
router.use(verifyUser, requireAdmin); // everything below is admin-only

function computeFreeReserve(reserve, bonded, liability) {
  return reserve - bonded - liability;
}

// --- overview ---
router.get("/overview", async (_, response, next) => {
  try {
    const [statsSnap, centralBankSnap] = await Promise.all([
      db.collection("stats").doc("totals").get(),
      db.collection("stats").doc("centralBank").get(),
    ]);

    const totals = statsSnap.data() ?? {};
    const centralBank = centralBankSnap.data() ?? {};
    const freeReserve = computeFreeReserve(
      centralBank.reserve ?? 0,
      totals.moorecoinsBonded ?? 0,
      centralBank.outstandingInterestLiability ?? 0,
    );

    response.json({ totals, centralBank, freeReserve });
  } catch (err) {
    next(err);
  }
});

// --- mint new coins into the reserve ---
router.post("/central-bank/mint", async (request, response, next) => {
  try {
    const amount = Number(request.body?.amount);
    if (!requirePositiveInt(amount)) {
      return response
        .status(400)
        .json({ error: "amount must be a positive integer" });
    }

    const centralBankRef = db.collection("stats").doc("centralBank");
    const ledgerRef = db.collection("ledger").doc();

    await db.runTransaction(async (tx) => {
      tx.set(
        centralBankRef,
        {
          reserve: FieldValue.increment(amount),
          totalMinted: FieldValue.increment(amount),
        },
        { merge: true },
      );

      tx.set(ledgerRef, {
        ...buildLedgerEntry({
          type: "mint",
          from: "centralBank",
          to: "centralBank",
          amount,
          metadata: { action: "mint" },
        }),
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    response.json({ minted: amount });
  } catch (err) {
    next(err);
  }
});

// --- burn coins out of the reserve permanently ---
router.post("/central-bank/burn", async (request, response, next) => {
  try {
    const amount = Number(request.body?.amount);
    if (!requirePositiveInt(amount)) {
      return response
        .status(400)
        .json({ error: "amount must be a positive integer" });
    }

    const centralBankRef = db.collection("stats").doc("centralBank");
    const ledgerRef = db.collection("ledger").doc();

    await db.runTransaction(async (tx) => {
      const centralBankSnap = await tx.get(centralBankRef);
      const reserve = centralBankSnap.data()?.reserve ?? 0;

      if (reserve < amount) throw new Error("reserve_insufficient");

      tx.set(
        centralBankRef,
        { reserve: FieldValue.increment(-amount) },
        { merge: true },
      );

      tx.set(ledgerRef, {
        ...buildLedgerEntry({
          type: "burn",
          from: "centralBank",
          to: "centralBank",
          amount,
          metadata: { action: "burn" },
        }),
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    response.json({ burned: amount });
  } catch (err) {
    if (err.message === "reserve_insufficient") {
      return response.status(400).json({ error: "reserve_insufficient" });
    }
    next(err);
  }
});

// --- give coins from the reserve to one student ---
router.post("/central-bank/distribute", async (request, response, next) => {
  try {
    const uid = request.body?.uid;
    const amount = Number(request.body?.amount);

    if (!uid) return response.status(400).json({ error: "uid is required" });
    if (!requirePositiveInt(amount)) {
      return response
        .status(400)
        .json({ error: "amount must be a positive integer" });
    }

    const userRef = db.collection("users").doc(uid);
    const statsRef = db.collection("stats").doc("totals");
    const centralBankRef = db.collection("stats").doc("centralBank");
    const ledgerRef = db.collection("ledger").doc();

    await db.runTransaction(async (tx) => {
      const [userSnap, statsSnap, centralBankSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(statsRef),
        tx.get(centralBankRef),
      ]);

      if (!userSnap.exists) throw new Error("user_not_found");
      const user = userSnap.data();

      const reserve = centralBankSnap.data()?.reserve ?? 0;
      const bonded = statsSnap.data()?.moorecoinsBonded ?? 0;
      const liability =
        centralBankSnap.data()?.outstandingInterestLiability ?? 0;
      const freeReserve = computeFreeReserve(reserve, bonded, liability);

      if (freeReserve < amount)
        throw new Error("reserve_would_be_insufficient");

      tx.update(userRef, { moorecoins: FieldValue.increment(amount) });

      tx.set(
        statsRef,
        {
          moorecoinsCirculating: FieldValue.increment(amount),
          moorecoinsIssued: FieldValue.increment(amount),
        },
        { merge: true },
      );

      tx.set(
        centralBankRef,
        { reserve: FieldValue.increment(-amount) },
        { merge: true },
      );

      tx.set(ledgerRef, {
        ...buildLedgerEntry({
          type: "mint",
          from: "centralBank",
          to: user,
          amount,
          metadata: { action: "distribute" },
        }),
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    response.json({ distributed: amount });
  } catch (err) {
    if (err.message === "user_not_found")
      return response.status(404).json({ error: "user_not_found" });
    if (err.message === "reserve_would_be_insufficient") {
      return response
        .status(409)
        .json({ error: "reserve_would_be_insufficient" });
    }
    next(err);
  }
});

// --- reward every student in a period the same amount ---
router.post("/central-bank/reward", async (request, response, next) => {
  try {
    const period = Number(request.body?.period);
    const amount = Number(request.body?.amount);

    if (!Number.isInteger(period) || period < 1 || period > 6) {
      return response
        .status(400)
        .json({ error: "period must be an integer between 1 and 6" });
    }
    if (!requirePositiveInt(amount)) {
      return response
        .status(400)
        .json({ error: "amount must be a positive integer" });
    }

    // Single-field query (role only) — filtering by period happens in
    // memory below, so this never needs a Firestore composite index.
    const usersSnap = await db
      .collection("users")
      .where("role", "==", "student")
      .get();
    const students = usersSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((u) => u.period === period);

    if (students.length === 0) {
      return response.status(400).json({ error: "no_students_in_period" });
    }

    const totalNeeded = amount * students.length;
    const statsRef = db.collection("stats").doc("totals");
    const centralBankRef = db.collection("stats").doc("centralBank");

    await db.runTransaction(async (tx) => {
      const [statsSnap, centralBankSnap] = await Promise.all([
        tx.get(statsRef),
        tx.get(centralBankRef),
      ]);

      const reserve = centralBankSnap.data()?.reserve ?? 0;
      const bonded = statsSnap.data()?.moorecoinsBonded ?? 0;
      const liability =
        centralBankSnap.data()?.outstandingInterestLiability ?? 0;
      const freeReserve = computeFreeReserve(reserve, bonded, liability);

      if (freeReserve < totalNeeded)
        throw new Error("reserve_would_be_insufficient");

      students.forEach((student) => {
        const userRef = db.collection("users").doc(student.id);
        tx.update(userRef, { moorecoins: FieldValue.increment(amount) });

        const ledgerRef = db.collection("ledger").doc();
        tx.set(ledgerRef, {
          ...buildLedgerEntry({
            type: "reward",
            from: "centralBank",
            to: student,
            amount,
            metadata: { period },
          }),
          timestamp: FieldValue.serverTimestamp(),
        });
      });

      tx.set(
        statsRef,
        {
          moorecoinsCirculating: FieldValue.increment(totalNeeded),
          moorecoinsIssued: FieldValue.increment(totalNeeded),
        },
        { merge: true },
      );

      tx.set(
        centralBankRef,
        { reserve: FieldValue.increment(-totalNeeded) },
        { merge: true },
      );
    });

    response.json({
      rewarded: students.length,
      amountEach: amount,
      totalDistributed: totalNeeded,
    });
  } catch (err) {
    if (err.message === "reserve_would_be_insufficient") {
      return response
        .status(409)
        .json({ error: "reserve_would_be_insufficient" });
    }
    next(err);
  }
});

// --- student roster ---
router.get("/users", async (_, response, next) => {
  try {
    const snapshot = await db
      .collection("users")
      .where("role", "==", "student")
      .get();
    const users = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        publicUid: data.publicUid ?? null,
        name: data.name ?? null,
        email: data.email ?? null,
        period: data.period ?? null,
        moorecoins: data.moorecoins ?? 0,
        pendingExtraCredit: data.pendingExtraCredit ?? 0,
      };
    });

    response.json({ users });
  } catch (err) {
    next(err);
  }
});

// --- clear a student's outstanding extra credit once it's been applied ---
router.post(
  "/users/:uid/mark-extra-credit-submitted",
  async (request, response, next) => {
    try {
      const uid = request.params.uid;
      const userRef = db.collection("users").doc(uid);

      const cleared = await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error("user_not_found");

        const amount = userSnap.data().pendingExtraCredit ?? 0;
        tx.update(userRef, { pendingExtraCredit: 0 });
        return amount;
      });

      response.json({ cleared });
    } catch (err) {
      if (err.message === "user_not_found")
        return response.status(404).json({ error: "user_not_found" });
      next(err);
    }
  },
);

export default router;
