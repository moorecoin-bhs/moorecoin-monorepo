import "dotenv/config";
import express from "express";
import cors from "cors";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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
};

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

function generatePublicUid(name, email) {
  const stripEmailRegex = /@.+$/;
  const studentId = email.replace(stripEmailRegex, "");
  const shortStudentId = studentId.slice(-3);

  const safeName = name?.trim() || "Unknown User";
  const nameParts = safeName.split(" ").filter(Boolean);
  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];

  return `${firstName[0]}${lastName[0]}${shortStudentId}`.toUpperCase();
}

// api routes
app.get("/", (_, response) => {
  response.send("Hello, Moorecoin API!");
});

app.post("/auth/session", verifyUser, async (request, response, next) => {
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

app.use((error, _, response, __) => {
  console.error(error);
  response.status(500).json({ error: "internal_error" });
});

app.listen(port, () => console.log(`Listening on ${port}`));
