require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

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
      callback(null, true);
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
    "x-api-key",
  ],
  optionsSuccessStatus: 200,
};

// 1. Apply CORS & Preflight Handlers
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
const transactionRoutes = require("./routes/transaction.routes");

// Additional Service Routes (Utility, Bills, Notifications)
let utilityRoutes;
try {
  utilityRoutes = require("./routes/utilityRoutes");
} catch (e) {
  utilityRoutes = null;
}

let notificationRoutes;
try {
  notificationRoutes = require("./routes/notificationRoutes");
} catch (e) {
  notificationRoutes = null;
}

// --- USER MODEL ---
const User = require("./models/User");

// --- ROUTES REGISTRATION ---
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/auth", require("./routes/authRoutes"));
app.use("/api/v1/validation", validationRoutes);
app.use("/api/v1/support", supportRoutes);
app.use("/api/v1/nimc", nimcRoutes);
app.use("/api/v1/bvn", bvnRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/transactions", transactionRoutes);
app.use("/api/v1/virtual-account", virtualAccountRoutes);

// VTU, Data & Airtime Routing
app.use("/api/v1/vtu", vtuRoutes);
app.use("/api/v1/data", dataRoutes);
app.use("/api/v1/airtime", vtuRoutes);

// Electricity & Cable TV Bills Routing
if (utilityRoutes) {
  app.use("/api/v1/bills", utilityRoutes);
  app.use("/api/v1/utility", utilityRoutes);
  app.use("/api/v1/electricity", utilityRoutes);
  app.use("/api/v1/cable", utilityRoutes);
} else {
  app.use("/api/v1/bills", vtuRoutes);
}

// Notifications Routing
if (notificationRoutes) {
  app.use("/api/v1/notifications", notificationRoutes);
}

// Hierarchy & Role Routes
app.use("/api/v1/agent", agentRoutes);
app.use("/api/v1/leader", leaderRoutes);
app.use("/api/v1/supervisors", supervisorRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/superadmin", superAdminRoutes);
app.use("/api/v1/super-leader", require("./routes/superLeaderRoutes"));

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
      const user = await User.findById(decoded.id || decoded._id).select(
        "-password -pin"
      );

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
    return res.status(500).json({ success: false, message: error.message });
  }
});

// --- SUPERADMIN GENERATOR ENDPOINT ---
app.get("/api/v1/auth/create-live-superadmin", async (req, res) => {
  try {
    const email = "mohammed.ayas@ayaxdata.online".toLowerCase().trim();
    const phone = "09033738409";
    const plainPassword = "Password123@";

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    await usersCollection.deleteMany({
      $or: [{ email: email }, { phone: phone }],
    });

    const result = await usersCollection.insertOne({
      firstName: "Mohammed",
      surname: "Ayas",
      name: "Mohammed Ayas",
      email: email,
      phone: phone,
      password: hashedPassword,
      role: "superadmin",
      walletBalance: 1000000,
      balance: 1000000,
      pin: "1997",
      transactionPin: "1997",
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "SuperAdmin created successfully!",
      insertedId: result.insertedId,
      credentials: {
        email: email,
        phone: phone,
        password: plainPassword,
        role: "superadmin",
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
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
    console.log(" MongoDB Connected Successfully");
    console.log(" Connected to database:", mongoose.connection.name);

    app.listen(PORT, "0.0.0.0", () => {
      console.log(` Server fully optimized and running on port ${PORT}`);
    });
  } catch (err) {
    console.error(" MongoDB Connection Failed:", err.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;