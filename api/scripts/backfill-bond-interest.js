// One-off: give every bond that was created with 0 interest the minimum.
//
// Before MIN_BOND_INTEREST existed, small bonds rounded their interest down
// to 0 (1 coin at 41% = 0.41 → 0). This brings each of them up to the floor:
//
//   - Not yet collected: raise interestAmount and book the extra promised
//     interest as liability, exactly as /bonds/create would have. The
//     student receives it through the normal collect flow.
//   - Already collected: the student was paid principal only, so pay the
//     missing interest now, booked like the interest half of /bonds/collect,
//     with a bond_collected ledger entry flagged `backfill: true`.
//
// Each bond is its own transaction and re-checks interestAmount inside it,
// so re-running (or a student collecting mid-run) never pays twice. A bond is
// skipped, not forced, if the free reserve can't cover it — mint and re-run.
//
// Dry run by default. Run from api/ so dotenv finds .env:
//   npm run backfill:bond-interest             # report only
//   npm run backfill:bond-interest -- --commit # apply

import { db, FieldValue } from "../src/firebase.js";
import {
  MIN_BOND_INTEREST,
  buildLedgerEntry,
  computeFreeReserve,
} from "../src/helpers/economy.js";

const commit = process.argv.includes("--commit");

const statsRef = db.collection("stats").doc("totals");
const centralBankRef = db.collection("stats").doc("centralBank");

const snapshot = await db
  .collection("bonds")
  .where("interestAmount", "<", MIN_BOND_INTEREST)
  .get();

console.log(
  `${snapshot.size} bond(s) below ${MIN_BOND_INTEREST} interest` +
    (commit ? "" : " — dry run, pass --commit to apply"),
);

const results = { raised: 0, paid: 0, skipped: 0 };

for (const doc of snapshot.docs) {
  const bondRef = doc.ref;

  try {
    const outcome = await db.runTransaction(async (tx) => {
      const bondSnap = await tx.get(bondRef);
      const bond = bondSnap.data();
      if (!bond || bond.interestAmount >= MIN_BOND_INTEREST) {
        return "already fixed";
      }

      const userRef = db.collection("users").doc(bond.uid);
      const [userSnap, statsSnap, centralBankSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(statsRef),
        tx.get(centralBankRef),
      ]);
      if (!userSnap.exists) return "skip: user not found";

      const topUp = MIN_BOND_INTEREST - bond.interestAmount;
      const freeReserve = computeFreeReserve(
        centralBankSnap.data()?.reserve ?? 0,
        statsSnap.data()?.moorecoinsBonded ?? 0,
        centralBankSnap.data()?.outstandingInterestLiability ?? 0,
      );
      if (freeReserve < topUp) return "skip: free reserve too low";

      if (!commit) return bond.collected ? "would pay" : "would raise";

      const updated = { ...bond, interestAmount: MIN_BOND_INTEREST };
      tx.update(bondRef, { interestAmount: MIN_BOND_INTEREST });
      tx.set(userRef.collection("bonds").doc(doc.id), updated);

      if (!bond.collected) {
        tx.set(
          centralBankRef,
          { outstandingInterestLiability: FieldValue.increment(topUp) },
          { merge: true },
        );
        return "raised";
      }

      const user = userSnap.data();
      tx.update(userRef, { moorecoins: FieldValue.increment(topUp) });
      tx.set(
        statsRef,
        {
          moorecoinsCirculating: FieldValue.increment(topUp),
          moorecoinsIssued: FieldValue.increment(topUp),
        },
        { merge: true },
      );
      tx.set(
        centralBankRef,
        { reserve: FieldValue.increment(-topUp) },
        { merge: true },
      );
      tx.set(db.collection("ledger").doc(), {
        ...buildLedgerEntry({
          type: "bond_collected",
          from: "centralBank",
          to: user,
          amount: topUp,
          metadata: {
            bondId: doc.id,
            interestAmount: MIN_BOND_INTEREST,
            backfill: true,
          },
        }),
        timestamp: FieldValue.serverTimestamp(),
      });
      return "paid";
    });

    if (outcome === "raised" || outcome === "would raise") results.raised++;
    else if (outcome === "paid" || outcome === "would pay") results.paid++;
    else if (outcome.startsWith("skip")) results.skipped++;

    const { uid, principal, collected } = doc.data();
    console.log(
      `  ${doc.id}  uid=${uid} principal=${principal} ` +
        `${collected ? "collected" : "open"}  → ${outcome}`,
    );
  } catch (err) {
    results.skipped++;
    console.error(`  ${doc.id}  → error: ${err.message}`);
  }
}

console.log(
  `${commit ? "" : "[dry run] "}open bonds raised: ${results.raised}, ` +
    `collected bonds paid: ${results.paid}, skipped: ${results.skipped}`,
);
