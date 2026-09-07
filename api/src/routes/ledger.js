import { Router } from "express";
import { db } from "../firebase.js";
import { verifyUser, requireAdmin } from "../middleware/auth.js";
import { toPublicLedgerEntry } from "../helpers/economy.js";

const router = Router();

router.get("/public", async (request, response, next) => {
  try {
    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const snapshot = await db
      .collection("ledger")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    const entries = snapshot.docs.map((doc) =>
      toPublicLedgerEntry({ id: doc.id, ...doc.data() }),
    );

    response.json({ entries });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/all",
  verifyUser,
  requireAdmin,
  async (request, response, next) => {
    try {
      const limit = Math.min(Number(request.query.limit) || 50, 200);
      const snapshot = await db
        .collection("ledger")
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();

      const entries = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      response.json({ entries });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/mine", verifyUser, async (request, response, next) => {
  try {
    const uid = request.uid;

    const [fromSnap, toSnap] = await Promise.all([
      db.collection("ledger").where("fromUid", "==", uid).get(),
      db.collection("ledger").where("toUid", "==", uid).get(),
    ]);

    const seen = new Map();
    [...fromSnap.docs, ...toSnap.docs].forEach((doc) => {
      seen.set(doc.id, { id: doc.id, ...doc.data() });
    });

    const entries = [...seen.values()]
      .map((entry) => toPublicLedgerEntryWithDirection(entry, uid))
      .sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));

    response.json({ entries });
  } catch (err) {
    next(err);
  }
});

function toPublicLedgerEntryWithDirection(entry, uid) {
  const direction =
    entry.toUid === uid ? "in" : entry.fromUid === uid ? "out" : null;
  return { ...toPublicLedgerEntry(entry), direction };
}

function toMillis(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp === "object" && "_seconds" in timestamp)
    return timestamp._seconds * 1000;
  return new Date(timestamp).getTime();
}

export default router;
