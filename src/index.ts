
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes";
import storeRoutes from "./routes/storeRoutes";
import retailerRoutes from "./routes/retailerRoutes";
import wholesalerRoutes from "./routes/wholesalerRoutes";
import employeeRoutes from "./routes/employeeRoutes";
import adminRoutes from "./routes/adminRoutes";
import nfcRoutes from "./routes/nfcRoutes";
import walletRoutes from "./routes/walletRoutes";
import rewardsRoutes from "./routes/rewardsRoutes";
import debugRoutes, { setAppInstance } from "./routes/debugRoutes";
import trainingRoutes from "./routes/trainingRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import ipDebugRoutes from "./routes/ipDebugRoutes";
import gasMeterRechargeRoutes from "./routes/gasMeterRechargeRoutes";

dotenv.config();

console.log("🚀 --- Server Starting ---");

const app = express();
const PORT = process.env.PORT || 8080;

/* -------------------- CORS CONFIG -------------------- */

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3062",
  "http://localhost:3063",
  "http://localhost:5173",
  "https://big-company-frontend.vercel.app",
  "https://big-pos.netlify.app",
  "https://bigpos.kiaantechnology.com"
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("⚠️ Blocked CORS request from:", origin);
      return callback(null, true); // allow but log
    },
    credentials: true
  })
);

/* -------------------- BODY PARSER -------------------- */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

/* -------------------- REQUEST LOGGER -------------------- */

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

/* -------------------- HEALTH CHECK -------------------- */

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Server is healthy",
    timestamp: new Date()
  });
});

/* -------------------- ROUTES -------------------- */

app.use("/store/auth", authRoutes);
app.use("/retailer/auth", authRoutes);
app.use("/wholesaler/auth", authRoutes);
app.use("/admin/auth", authRoutes);
app.use("/employee/auth", authRoutes);

app.use("/employee", employeeRoutes);
app.use("/employee", trainingRoutes);

app.use("/store", storeRoutes);
app.use("/retailer", retailerRoutes);
app.use("/wholesaler", wholesalerRoutes);
app.use("/admin", adminRoutes);

app.use("/nfc", nfcRoutes);
app.use("/wallet", walletRoutes);
app.use("/rewards", rewardsRoutes);

app.use("/api/webhooks", webhookRoutes);
app.use("/api/debug", ipDebugRoutes);
app.use("/debug", debugRoutes);

app.use("/gas-recharge", gasMeterRechargeRoutes);

setAppInstance(app);

/* -------------------- ROOT ROUTE -------------------- */

app.get("/", (req, res) => {
  res.send("✅ Big Company API is running");
});

/* -------------------- 404 HANDLER -------------------- */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.path
  });
});

/* -------------------- ERROR HANDLER -------------------- */

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("🔥 SERVER ERROR:", err);

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

/* -------------------- START SERVER -------------------- */

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});

/* -------------------- GLOBAL ERROR EVENTS -------------------- */

process.on("uncaughtException", (err) => {
  console.error("🔥 CRITICAL UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("🔥 CRITICAL UNHANDLED REJECTION:", reason);
});
