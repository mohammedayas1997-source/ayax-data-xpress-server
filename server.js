require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = express();

// --- PERMISSIVE & SECURE CORS CONFIGURATION ---
const allowedOrigins = [
  "https://www.ayaxdata.online",
  "https://ayaxdata.online",
  "https://ayax-api-v2.vercel.app",
  "https://ayax-data-xpress.com",
  "http://localhost:19006",
  "http://localhost:3000",
  "http://localhost:5173",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app") ||
      origin.endsWith(".ayaxdata.online")
    ) {
      callback(null, true);
    } else {
      callback(null, true); // Fallback
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "Accept-Version",
    "token",
    "x-api-key", // An kara don Marketplace & External API headers
  ],
  optionsSuccessStatus: 200,
};

// 1. Aiwatar da CORS da Preflight OPTIONS
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// --- BODY PARSER WITH RAW BODY FOR WEBHOOKS ---
app.use(
  express.json({
    limit: "50mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// --- ROUTES IMPORTS ---
const authRoutes = require("./routes/authRoutes");
const supportRoutes = require("./routes/supportRoutes");
const walletRoutes = require("./routes/walletRoutes");
const vtuRoutes = require("./routes/vtuRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const agentRoutes = require("./routes/agentRoutes");
const leaderRoutes = require("./routes/leaderRoutes");
const supervisorRoutes = require("./routes/supervisorRoutes");
const adminRoutes = require("./routes/adminRoutes");
const nimcRoutes = require("./routes/nimcRoutes");
const bvnRoutes = require("./routes/bvnRoutes");
const superAdminRoutes = require("./routes/superAdminRoutes");
const validationRoutes = require("./routes/ninRoutes");
const virtualAccountRoutes = require("./routes/virtualAccountRoutes");
const dataRoutes = require("./routes/data.routes");
const vtuRoutes = require("./routes/vtu.routes");

// --- INJECTING MIDDLEWARE & USER MODEL ---
const User = require("./models/User");

// --- ROUTES REGISTRATION ---
app.use("/api/v1/validation", validationRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/support", supportRoutes);
app.use("/api/v1/nimc", nimcRoutes);
app.use("/api/v1/bvn", bvnRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/wallet", walletRoutes);

// VTU & Purchase Route Aliases
app.use("/api/v1/vtu", vtuRoutes);
app.use("/api/v1/data", dataRoutes);
app.use("/api/v1/airtime", vtuRoutes);
app.use("/api/v1/bills", vtuRoutes);

app.use("/api/v1/agent", agentRoutes);
app.use("/api/v1/leader", leaderRoutes);
app.use("/api/v1/supervisors", supervisorRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/superadmin", superAdminRoutes);
app.use("/api/v1/virtual-account", virtualAccountRoutes);

// --- SECURE USER PROFILE ROUTE ---
app.get("/api/v1/user/profile", async (req, res) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.headers.token) {
      token = req.headers.token;
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id || decoded._id).select("-password -pin");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.status(200).json({
        status: "success",
        success: true,
        data: user,
        user,
      });
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session token",
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- 404 HANDLER ---
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `API Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]:", err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// --- DATABASE CONNECTION & SERVER STARTUP ---
const PORT = process.env.PORT || 10000;

const startServer = async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB Connected Successfully");
    console.log("🔍 Connected to database:", mongoose.connection.name);

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server fully optimized and running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;