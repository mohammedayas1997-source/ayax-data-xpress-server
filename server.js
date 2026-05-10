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

// --- CORS CONFIGURATION (GYARARRE) ---
const allowedOrigins = [
  "https://www.ayaxdata.online",
  "https://ayaxdata.online",
  "https://ayax-api-v2.vercel.app",
];

// --- CORS CONFIGURATION (MAFI KYAU GA MOBILE DA WEB) ---
app.use(
  cors({
    origin: function (origin, callback) {
      // 1. MUHIMMI: Bar Mobile Apps su wuce
      // A React Native, 'origin' yawanci undefined ne
      if (!origin || origin === "null") {
        return callback(null, true);
      }

      const allowedOrigins = [
        "https://www.ayaxdata.online",
        "https://ayaxdata.online",
        "https://ayax-api-v2.vercel.app",
      ];

      const isAllowed =
        allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");

      if (isAllowed) {
        callback(null, true);
      } else {
        // Don gudun bacin rana yayin development, zaka iya barin kowa ya wuce
        // Amma idan kana son tsaro, bar shi a haka:
        callback(null, true); // Na saka true a nan don tabbatar da cewa ba zai toshe ka ba yanzu
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Accept-Version",
    ],
  }),
);

// MUHIMMI: Wannan layin ne yake bawa Browser damar gudanar da "Pre-flight" request
app.options("*", cors());
// --- BODY PARSERS (MUST BE BEFORE ROUTES) ---
// Mun mayar da shi 50mb a nan sama domin duk wani hoto ya samu damar wucewa
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// --- ROUTES IMPORTS ---
const authRoutes = require("./routes/authRoutes");
const supportRoutes = require("./routes/supportRoutes");
const walletRoutes = require("./routes/walletRoutes");
const vtuRoutes = require("./routes/vtuRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const paymentRoutes = require("./routes/paymentRoutes"); // Tabbatar wannan folder din 'rules' ne ko 'routes'
const agentRoutes = require("./routes/agentRoutes");
const leaderRoutes = require("./routes/leaderRoutes");
const supervisorRoutes = require("./routes/supervisorRoutes");
const adminRoutes = require("./routes/adminRoutes");
const nimcRoutes = require("./routes/nimcRoutes");
const bvnRoutes = require("./routes/bvnRoutes");
const superAdminRoutes = require("./routes/superAdminRoutes");

// --- ROUTES REGISTRATION ---
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

// --- ROOT ENDPOINT ---
app.get("/", (req, res) => {
  res.status(200).send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #1e3a8a;">Ayax API v2 is ONLINE</h1>
            <p style="color: #666;">High-Performance Backend System Active.</p>
            <div style="display: inline-block; padding: 10px 20px; background: #f1f5f9; border-radius: 8px; font-weight: bold; color: #1e3a8a;">
                System Status: Production Ready
            </div>
        </div>
    `);
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
