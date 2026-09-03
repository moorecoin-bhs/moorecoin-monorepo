import express from "express";
import cors from "cors";
import authRoutes from "./src/routes/auth.js";
import userRoutes from "./src/routes/user.js";
import bondsRoutes from "./src/routes/bonds.js";
import redemptionRoutes from "./src/routes/redemption.js";

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

app.use((error, _, response, __) => {
  console.error(error);
  response.status(500).json({ error: "internal_error" });
});

app.listen(port, () => console.log(`Listening on ${port}`));
