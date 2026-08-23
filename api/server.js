import "dotenv/config";
import express from "express";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// --- Firebase setup ---
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch {
  console.error("FIREBASE_SERVICE_ACCOUNT is missing or not valid JSON");
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// --- Express setup ---
const app = express();
app.use(express.json());

const port = process.env.PORT || 5000;

// --- Rate formulas ---
const calculateExchangeRate = (t) =>
  Math.max(0.005, 1.2 * Math.exp(-0.000521 * t));
const calculateInterestRate = (t) => 0.1 + 0.65 * Math.exp(-0.000486 * t);

// --- Routes ---
app.post("/convert", async (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "invalid_request" });
  }

  const userRef = db.doc(`users/${userId}`);
  const totalsRef = db.doc("system/totals");

  try {
    const result = await db.runTransaction(async (tx) => {
      const [userSnap, totalsSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(totalsRef),
      ]);

      if (!userSnap.exists) throw new Error("user_not_found");

      const balance = userSnap.data().balance;
      const t = totalsSnap.exists ? totalsSnap.data().t : 0;

      if (amount > balance) throw new Error("insufficient_balance");

      const rate = calculateExchangeRate(t);
      const converted = amount * rate;
      const newBalance = balance - amount;

      tx.update(userRef, { balance: newBalance });

      return { converted, newBalance, rateUsed: rate };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/accrue-interest", async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "invalid_request" });
  }

  const userRef = db.doc(`users/${userId}`);
  const totalsRef = db.doc("system/totals");

  try {
    const result = await db.runTransaction(async (tx) => {
      const [userSnap, totalsSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(totalsRef),
      ]);

      if (!userSnap.exists) throw new Error("user_not_found");

      const balance = userSnap.data().balance;
      const t = totalsSnap.exists ? totalsSnap.data().t : 0;

      const rate = calculateInterestRate(t);
      const newBalance = balance + balance * rate;

      tx.update(userRef, { balance: newBalance });

      return { newBalance, rateUsed: rate };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Error handler (catches anything thrown/rejected in routes above) ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(port, () => console.log(`Listening on ${port}`));
