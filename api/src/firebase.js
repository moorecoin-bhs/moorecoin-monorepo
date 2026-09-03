import "dotenv/config";
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

export const db = getFirestore();
export const auth = getAuth();
export { FieldValue };
