const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");

dotenv.config();

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

const PORT = process.env.PORT || 10000; // Render yana son 10000 ko kuma ya ba shi dama ya zaɓa
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});

const allowedOrigins = [
  "https://www.ayaxdata.online",
  "https://ayaxdata.online",
  "https://ayax-data-xpress-server.vercel.app",
  "https://ayax-api-v2.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.some((domain) =>
        origin.startsWith(domain),
      );
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy violation"), false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

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

// Gyara: Tabbatar da sunan fayil din superAdminRoutes.js a folder dinka
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
//app.use("/api/v1/supervisors", supervisorRoutes);
app.use("/api/v1/admin", adminRoutes);

/**
 * GYARA: An canza daga /superAdmin zuwa /superadmin
 * domin ya yi daidai da kiran da kake yi a Frontend (UserManagement.js)
 */
app.use("/api/v1/superadmin", superAdminRoutes);

app.get("/", (req, res) => {
  res.status(200).send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #2ecc71;">Ayax API v2 is ONLINE</h1>
            <p style="color: #666;">Server is running in Safe Mode (Auth & Support Only).</p>
            <div style="display: inline-block; padding: 10px 20px; background: #eee; border-radius: 5px;">
                Status: Debugging Active
            </div>
        </div>
    `);
});

app.use("*", (req, res) => {
  res.status(404).json({ success: false, message: "API Route not found" });
});

app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]:", err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

module.exports = app;
