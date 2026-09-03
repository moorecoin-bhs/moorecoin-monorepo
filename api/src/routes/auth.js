import { Router } from "express";
import { db, FieldValue } from "../firebase.js";
import { verifyUser } from "../middleware/auth.js";
import { generatePublicUid } from "../helpers/economy.js";

const router = Router();

router.post("/session", verifyUser, async (request, response, next) => {
  try {
    const uid = request.uid;
    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();

    let user;
    let isNewUser = false;

    const name = request.decodedToken.name;
    const email = request.decodedToken.email;

    if (!userSnapshot.exists) {
      user = {
        uid,
        publicUid: generatePublicUid(name, email),
        name,
        email,
        role: "student",
        createdAt: new Date(),
        moorecoins: 1,
        finishedOnboarding: false,
      };

      const batch = db.batch();
      batch.set(userRef, user);

      const statsRef = db.collection("stats").doc("totals");
      batch.set(
        statsRef,
        {
          users: FieldValue.increment(1),
          moorecoinsIssued: FieldValue.increment(1),
          moorecoinsCirculating: FieldValue.increment(1),
        },
        { merge: true },
      );

      await batch.commit();
      isNewUser = true;
    } else {
      user = userSnapshot.data();
    }

    response.json({ user, isNewUser });
  } catch (err) {
    next(err);
  }
});

export default router;
