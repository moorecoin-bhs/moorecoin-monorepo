import { auth, db } from "../firebase.js";

export async function verifyUser(request, response, next) {
  const authHeader = request.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return response.status(401).json({ error: "Missing token" });

  try {
    const decoded = await auth.verifyIdToken(token);
    request.uid = decoded.uid;
    request.decodedToken = decoded;
    next();
  } catch (err) {
    return response.status(401).json({ error: "Invalid or expired token" });
  }
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
