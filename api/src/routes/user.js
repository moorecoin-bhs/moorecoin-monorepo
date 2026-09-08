import { Router } from "express";
import { db } from "../firebase.js";
import { verifyUser } from "../middleware/auth.js";
import { isValidPeriod } from "../helpers/economy.js";

const router = Router();

router.post(
  "/finish-onboarding",
  verifyUser,
  async (request, response, next) => {
    try {
      const uid = request.uid;
      const period = Number(request.body?.period);

      if (!isValidPeriod(period)) {
        return response.status(400).json({ error: "invalid_period" });
      }

      const userRef = db.collection("users").doc(uid);
      const userSnapshot = await userRef.get();

      if (!userSnapshot.exists) {
        return response.status(404).json({ error: "user_not_found" });
      }

      await userRef.set({ period, finishedOnboarding: true }, { merge: true });

      return response.json({ period, finishedOnboarding: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
