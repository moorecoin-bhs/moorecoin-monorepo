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

export default router;
