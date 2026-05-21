require("dotenv").config();
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");

dotenv.config();

// --- DATABASE CONNECTION ---
const startDB = async () => {
  try {
    await connectDB();
    console.log("MongoDB Connected Successfully");
  } catch (err) {
    console.error("MongoDB Connection Failed:", err.message);
  }
};
startDB();

const app = express();

// --- CORS CONFIGURATION (PROFESSIONAL & SECURE) ---
const allowedOrigins = [
  "https://www.ayaxdata.online",
  "https://ayaxdata.online",
  "https://ayax-api-v2.vercel.app",
  "http://localhost:19006",
  "http://localhost:3000",
];

// 1. Manual Header Injection (Wannan shi ne babban maganin CORS a Vercel)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin) || origin?.endsWith(".vercel.app")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Accept-Version",
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // MUHIMMI: Browser tana bukatar 200 OK don Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).json({});
  }
  next();
});

// 2. Standard CORS Middleware as Backup
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  }),
);
app.options("*", cors());

// --- BODY PARSERS ---
app.use(express.json({ limit: "50mb" }));
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

// --- INJECTING MIDDLEWARE & USER MODEL FOR THE DIRECT ROUTE ---
const { protect } = require("./middleware/authMiddleware");
const User = require("./models/User");

// --- ROUTES REGISTRATION ---
app.use("/api/v1/validation", validationRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/support", supportRoutes);
app.use("/api/v1/nimc", nimcRoutes);
app.use("/api/v1/bvn", bvnRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/vtu", vtuRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/agent", agentRoutes);
app.use("/api/v1/leader", leaderRoutes);
app.use("/api/v1/supervisors", supervisorRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/superadmin", superAdminRoutes);

// --- Nemo wannan bangaren a server.js ka sauya shi zuwa haka ---
app.get("/api/v1/user/profile", protect, async (req, res) => {
  try {
    // req.user yana samuwa ne idan protect middleware ya wuce lafiya
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user attached to request",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      status: "success",
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
// --- 404 HANDLER ---
app.use("*", (req, res) => {
  res.status(404).json({ success: false, message: "API Route not found" });
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]:", err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server fully optimized and running on port ${PORT}`);
});

module.exports = app;
