import { Router } from "express";
import { db } from "../firebase.js";
import { verifyUser } from "../middleware/auth.js";

const router = Router();

router.post(
  "/finish-onboarding",
  verifyUser,
  async (request, response, next) => {
    try {
      const uid = request.uid;
      const period = Number(request.body?.period);

      if (!Number.isInteger(period) || period < 1 || period > 6) {
        return response
          .status(400)
          .json({ error: "period must be an integer between 1 and 6" });
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
