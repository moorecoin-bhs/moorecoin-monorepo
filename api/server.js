import "dotenv/config";
import express from "express";
import cors from "cors";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch {
  console.error("FIREBASE_SERVICE_ACCOUNT is missing or not valid JSON");
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const corsOptions = {
  origin: ["http://localhost:8080", "https://mooreco.in"],
}

const app = express();
app.use(cors(corsOptions), express.json());

const port = process.env.PORT || 5050;

// helpers
const calculateExchangeRate = (t) =>
  Math.max(0.005, 1.2 * Math.exp(-0.000521 * t));
const calculateInterestRate = (t) => 0.1 + 0.65 * Math.exp(-0.000486 * t);

async function verifyUser(request, response, next) {
  const authHeader = request.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return response.status(401).json({ error: "Missing token" });

  try {
    const decoded = await getAuth().verifyIdToken(token);
    request.uid = decoded.uid; // passed google's checks. if something was wrong, it would have thrown an error, caught below
    request.decodedToken = decoded;
    next();
  } catch (err) {
    return response.status(401).json({ error: "Invalid or expired token" });
  }
}

// api routes
app.get("/", (_, response) => {
  response.send("Hello, Moorecoin API!");
});

app.post("/auth/session", verifyUser, async (request, response, next) => {
  try {
    const uid = request.uid;
    const userRef = db.collection("users").doc(uid);
    const snapshot = await userRef.get();

    let user;
    let isNewUser = false;

    if (!snapshot.exists) {
      user = {
        uid,
        email: request.decodedToken.email,
        role: "student",
        createdAt: new Date(),
        moorecoins: 1,
      };

      await userRef.set(user);
      isNewUser = true;
    } else {
      user = snapshot.data();
    }

    response.json({ user, isNewUser });
  } catch (err) {
    next(err);
  }
});

app.use((error, _, response, __) => {
  console.error(error);
  response.status(500).json({ error: "internal_error" });
});

app.listen(port, () => console.log(`Listening on ${port}`));
