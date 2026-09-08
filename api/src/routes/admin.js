import { Router } from "express";
import { db, FieldValue } from "../firebase.js";
import { verifyUser, requireAdmin } from "../middleware/auth.js";
import {
  isValidAmount,
  isValidPeriod,
  isValidUid,
  buildLedgerEntry,
  computeFreeReserve,
} from "../helpers/economy.js";

const router = Router();
router.use(verifyUser, requireAdmin); // everything below is admin-only

// A Firestore transaction caps at 500 writes. A reward costs 2 writes per
// recipient (balance + ledger entry) plus 2 for the stats and central bank
// docs, so 200 recipients leaves comfortable headroom at 402.
const MAX_REWARD_RECIPIENTS = 200;

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
    if (!isValidAmount(amount)) {
      return response.status(400).json({ error: "invalid_amount" });
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
    if (!isValidAmount(amount)) {
      return response.status(400).json({ error: "invalid_amount" });
    }

    const statsRef = db.collection("stats").doc("totals");
    const centralBankRef = db.collection("stats").doc("centralBank");
    const ledgerRef = db.collection("ledger").doc();

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

      // Burning is spending from the reserve, so it answers to the same
      // floor as distribute/reward. The raw reserve balance includes every
      // open bond's principal (owed back to a student) plus promised
      // interest — burning into that makes bond collection fail later and
      // students permanently lose money they deposited.
      if (freeReserve < amount) {
        throw new Error("reserve_would_be_insufficient");
      }

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
    if (err.message === "reserve_would_be_insufficient") {
      return response
        .status(409)
        .json({ error: "reserve_would_be_insufficient" });
    }
    next(err);
  }
});

// --- give coins from the reserve to one student ---
router.post("/central-bank/distribute", async (request, response, next) => {
  try {
    const uid = request.body?.uid;
    const amount = Number(request.body?.amount);

    // Must be validated before reaching .doc(): a non-string or a value
    // containing "/" makes Firestore throw, surfacing as a 500 rather than
    // a 400.
    if (!isValidUid(uid)) {
      return response.status(400).json({ error: "invalid_uid" });
    }
    if (!isValidAmount(amount)) {
      return response.status(400).json({ error: "invalid_amount" });
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

    if (!isValidPeriod(period)) {
      return response.status(400).json({ error: "invalid_period" });
    }
    if (!isValidAmount(amount)) {
      return response.status(400).json({ error: "invalid_amount" });
    }

    const statsRef = db.collection("stats").doc("totals");
    const centralBankRef = db.collection("stats").doc("centralBank");

    // Single-field query (role only) — filtering by period happens in
    // memory below, so this never needs a Firestore composite index.
    const studentsQuery = db.collection("users").where("role", "==", "student");

    const { rewarded, totalDistributed } = await db.runTransaction(
      async (tx) => {
        // The roster is read *inside* the transaction so the set of
        // recipients and the reserve check are decided against the same
        // consistent snapshot. Reading it outside meant a student joining,
        // changing period, or being deleted between the read and the commit
        // could pay the wrong group, or abort the whole reward on a
        // now-missing doc. Firestore requires all reads before any write.
        const [studentsSnap, statsSnap, centralBankSnap] = await Promise.all([
          tx.get(studentsQuery),
          tx.get(statsRef),
          tx.get(centralBankRef),
        ]);

        const students = studentsSnap.docs
          // uid is forced from the document id: buildLedgerEntry reads
          // student.uid, and Firestore rejects an undefined field value, so
          // a user doc missing its own uid would abort the transaction.
          .map((doc) => ({ ...doc.data(), id: doc.id, uid: doc.id }))
          .filter((student) => student.period === period);

        if (students.length === 0) throw new Error("no_students_in_period");

        // Each recipient costs 2 writes (balance + ledger) and the stats and
        // central bank docs cost 1 each. Fail with a clear error rather than
        // an opaque Firestore rejection at the 500-write transaction cap.
        if (students.length > MAX_REWARD_RECIPIENTS) {
          throw new Error("too_many_recipients");
        }

        const totalNeeded = amount * students.length;

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

        return { rewarded: students.length, totalDistributed: totalNeeded };
      },
    );

    response.json({ rewarded, amountEach: amount, totalDistributed });
  } catch (err) {
    if (err.message === "no_students_in_period") {
      return response.status(400).json({ error: "no_students_in_period" });
    }
    if (err.message === "too_many_recipients") {
      return response.status(409).json({ error: "too_many_recipients" });
    }
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
      if (!isValidUid(uid)) {
        return response.status(400).json({ error: "invalid_uid" });
      }

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
