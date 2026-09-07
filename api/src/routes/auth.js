import { Router } from "express";
import { db, FieldValue } from "../firebase.js";
import { verifyUser } from "../middleware/auth.js";
import { generatePublicUid, buildLedgerEntry } from "../helpers/economy.js";

const router = Router();

const SIGNUP_BONUS = 1;

router.post("/session", verifyUser, async (request, response, next) => {
  try {
    const uid = request.uid;
    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();

    if (userSnapshot.exists) {
      return response.json({ user: userSnapshot.data(), isNewUser: false });
    }

    const name = request.decodedToken.name;
    const email = request.decodedToken.email;
    const statsRef = db.collection("stats").doc("totals");
    const centralBankRef = db.collection("stats").doc("centralBank");
    const ledgerRef = db.collection("ledger").doc();

    const user = await db.runTransaction(async (tx) => {
      const centralBankSnap = await tx.get(centralBankRef);
      const reserve = centralBankSnap.data()?.reserve ?? 0;

      // If the reserve can't cover the welcome bonus, the account is
      // still created (login must never fail), just without the bonus.
      // This can happen before the teacher funds the reserve for the
      // first time.
      const bonus = reserve >= SIGNUP_BONUS ? SIGNUP_BONUS : 0;

      const newUser = {
        uid,
        publicUid: generatePublicUid(name, email),
        name,
        email,
        role: "student",
        createdAt: new Date(),
        moorecoins: bonus,
        finishedOnboarding: false,
      };

      tx.set(userRef, newUser);

      tx.set(statsRef, { users: FieldValue.increment(1) }, { merge: true });

      if (bonus > 0) {
        tx.set(
          statsRef,
          {
            moorecoinsIssued: FieldValue.increment(bonus),
            moorecoinsCirculating: FieldValue.increment(bonus),
          },
          { merge: true },
        );

        tx.set(
          centralBankRef,
          { reserve: FieldValue.increment(-bonus) },
          { merge: true },
        );

        tx.set(ledgerRef, {
          ...buildLedgerEntry({
            type: "signup",
            from: "centralBank",
            to: newUser,
            amount: bonus,
          }),
          timestamp: FieldValue.serverTimestamp(),
        });
      }

      return newUser;
    });

    response.json({ user, isNewUser: true });
  } catch (err) {
    next(err);
  }
});

export default router;
