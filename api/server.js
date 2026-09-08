import express from "express";
import cors from "cors";
import authRoutes from "./src/routes/auth.js";
import userRoutes from "./src/routes/user.js";
import bondsRoutes from "./src/routes/bonds.js";
import redemptionRoutes from "./src/routes/redemption.js";
import economyRoutes from "./src/routes/economy.js";
import ledgerRoutes from "./src/routes/ledger.js";
import adminRoutes from "./src/routes/admin.js";

const corsOptions = {
  origin: [
    "http://localhost:8080",
    "https://mooreco.in",
    "https://moorecoin.web.app",
  ],
};

const app = express();
app.use(cors(corsOptions), express.json());

const port = process.env.PORT || 5050;

app.get("/", (_, response) => {
  response.send("Hello, Moorecoin API!");
});

app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/bonds", bondsRoutes);
app.use("/redemption", redemptionRoutes);
app.use("/economy", economyRoutes);
app.use("/ledger", ledgerRoutes);
app.use("/admin", adminRoutes);

app.use((error, _, response, next) => {
  // express.json() rejects a malformed body by throwing before any route
  // runs. Without this it fell through to the handler below and surfaced as
  // a 500 internal_error, which is both the wrong status and misleading —
  // the request is bad, not the server.
  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({ error: "invalid_json" });
  }

  // Body larger than express.json()'s default 100kb limit.
  if (error?.type === "entity.too.large") {
    return response.status(413).json({ error: "payload_too_large" });
  }

  if (response.headersSent) return next(error);

  console.error(error);
  response.status(500).json({ error: "internal_error" });
});

app.listen(port, () => console.log(`Listening on ${port}`));
