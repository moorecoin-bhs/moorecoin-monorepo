import { auth, db } from "../firebase.js";
import { isAllowedEmail } from "../config.js";

export async function verifyUser(request, response, next) {
  const authHeader = request.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return response.status(401).json({ error: "missing_token" });

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch (err) {
    return response.status(401).json({ error: "invalid_token" });
  }

  // A valid token only proves the account exists in this Firebase project —
  // by default that is every Google account on earth. Membership is decided
  // here, not by the sign-in provider.
  if (decoded.email_verified === false) {
    return response.status(403).json({ error: "email_not_verified" });
  }

  if (!isAllowedEmail(decoded.email)) {
    return response.status(403).json({ error: "email_not_allowed" });
  }

  request.uid = decoded.uid;
  request.decodedToken = decoded;
  next();
}

export async function requireAdmin(request, response, next) {
  try {
    const userSnapshot = await db.collection("users").doc(request.uid).get();
    if (!userSnapshot.exists || userSnapshot.data().role !== "admin") {
      return response.status(403).json({ error: "forbidden" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
