import { Router } from "express";
import { db, FieldValue } from "../firebase.js";
import { verifyUser } from "../middleware/auth.js";
import {
  generatePublicUid,
  buildLedgerEntry,
  computeFreeReserve,
} from "../helpers/economy.js";
import { isBootstrapAdmin } from "../config.js";

const router = Router();

const SIGNUP_BONUS = 1;

// ADMIN_EMAILS is a floor: it can promote, never demote. Admins granted
// some other way keep their role, so this can't silently strip access from
// someone who isn't in the env list.
async function reconcileAdminRole(userRef, user) {
  if (user.role === "admin" || !isBootstrapAdmin(user.email)) return user;

  await userRef.set({ role: "admin" }, { merge: true });
  return { ...user, role: "admin" };
}

router.post("/session", verifyUser, async (request, response, next) => {
  try {
    const uid = request.uid;
    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();

    if (userSnapshot.exists) {
      const user = await reconcileAdminRole(userRef, userSnapshot.data());
      return response.json({ user, isNewUser: false });
    }

    const name = request.decodedToken.name;
    const email = request.decodedToken.email;
    const statsRef = db.collection("stats").doc("totals");
    const centralBankRef = db.collection("stats").doc("centralBank");
    const ledgerRef = db.collection("ledger").doc();

    const user = await db.runTransaction(async (tx) => {
      const [statsSnap, centralBankSnap] = await Promise.all([
        tx.get(statsRef),
        tx.get(centralBankRef),
      ]);

      const reserve = centralBankSnap.data()?.reserve ?? 0;
      const bonded = statsSnap.data()?.moorecoinsBonded ?? 0;
      const liability =
        centralBankSnap.data()?.outstandingInterestLiability ?? 0;
      const freeReserve = computeFreeReserve(reserve, bonded, liability);

      // The bonus is spending from the reserve, so it answers to the same
      // free-reserve floor as every other spend path. Checking the raw
      // balance meant a run of signups could quietly eat bonded principal
      // that is owed back to students.
      //
      // If the free reserve can't cover the welcome bonus, the account is
      // still created (login must never fail), just without the bonus.
      // This can happen before the teacher funds the reserve for the
      // first time.
      const bonus = freeReserve >= SIGNUP_BONUS ? SIGNUP_BONUS : 0;

      const newUser = {
        uid,
        publicUid: generatePublicUid(name, email),
        name,
        email,
        role: isBootstrapAdmin(email) ? "admin" : "student",
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
