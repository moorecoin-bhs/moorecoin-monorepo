// One-off: copy every /bonds doc to users/{uid}/bonds/{bondId}.
//
// GET /bonds/mine reads only the per-user copy, which is written for bonds
// created after that change. Bonds that already existed have no copy and
// would vanish from their owner's dashboard until this runs.
//
// Safe to re-run: each copy is overwritten from /bonds, the source of truth.
//
// Run from api/ so dotenv finds .env:  npm run backfill:user-bonds

import { db } from "../src/firebase.js";

// Firestore caps a batch at 500 writes.
const BATCH_SIZE = 500;

const snapshot = await db.collection("bonds").get();

let batch = db.batch();
let pending = 0;
let copied = 0;
let skipped = 0;

for (const doc of snapshot.docs) {
  const bond = doc.data();
  if (typeof bond.uid !== "string" || bond.uid.length === 0) {
    console.warn(`skipping bond ${doc.id}: no uid`);
    skipped++;
    continue;
  }

  batch.set(
    db.collection("users").doc(bond.uid).collection("bonds").doc(doc.id),
    bond,
  );
  pending++;
  copied++;

  if (pending === BATCH_SIZE) {
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }
}

if (pending > 0) await batch.commit();

console.log(`copied ${copied} bond(s), skipped ${skipped}`);
