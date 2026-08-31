const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const transactionController = require("../controllers/transactionController");
const User = require("../models/User");

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "d5a8161f29822be327aedda003ae85cfbefd1506d280761cd0b068108d678c7d24554eecd936e61855947d34b0947402b9fedd098c8b1bd2247928449eb6b8e6";

// Safe Route Handler Wrapper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `Transaction controller handler '${name}' is not implemented yet.`,
    });
  };
};

// ==========================================
// AUTHENTICATION & ACCESS CONTROL MIDDLEWARE
// ==========================================
const verifyToken = async (req, res, next) => {
  try {
    let token = null;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.headers.token) {
      token = req.headers.token;
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "Authorization token is missing. Please provide a valid Bearer token.",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id || decoded._id || decoded.userId;

    const user = await User.findById(userId).select("-password -pin -transactionPin");

    if (!user) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "User account no longer exists or has been deactivated.",
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        status: "failed",
        message: "Your account is currently suspended. Please contact executive support.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      status: "failed",
      message: "Invalid or expired authorization session.",
      error: error.message,
    });
  }
};

const verifyAdmin = (req, res, next) => {
  const role = String(req.user?.role || "").toLowerCase().trim();
  if (role === "admin" || role === "superadmin") {
    return next();
  }

  return res.status(403).json({
    success: false,
    status: "failed",
    message: "Access forbidden. Administrative privileges required.",
  });
};

// ==========================================
// 1. USER TRANSACTION HISTORY ROUTES
// ==========================================
// Base root handler for general fetching
router.get(
  "/",
  verifyToken,
  safe(transactionController.getUserTransactions, "getUserTransactions")
);

router.get(
  "/my-history",
  verifyToken,
  safe(transactionController.getUserTransactions, "getUserTransactions")
);

router.get(
  "/my-transactions",
  verifyToken,
  safe(transactionController.getUserTransactions, "getUserTransactions")
);

router.get(
  "/history",
  verifyToken,
  safe(transactionController.getUserTransactions, "getUserTransactions")
);

// ==========================================
// 2. ADMIN DASHBOARD & AUDIT ROUTES
// ==========================================
router.get(
  "/all",
  verifyToken,
  verifyAdmin,
  safe(transactionController.getAllTransactions, "getAllTransactions")
);

router.get(
  "/admin/all",
  verifyToken,
  verifyAdmin,
  safe(transactionController.getAllTransactions, "getAllTransactions")
);

router.get(
  "/stats",
  verifyToken,
  verifyAdmin,
  safe(transactionController.getTransactionStats, "getTransactionStats")
);

router.get(
  "/admin/stats",
  verifyToken,
  verifyAdmin,
  safe(transactionController.getTransactionStats, "getTransactionStats")
);

// Manual Admin Reversal / Refund (Directly to target beneficiary)
router.post(
  "/refund",
  verifyToken,
  verifyAdmin,
  safe(transactionController.refundTransaction, "refundTransaction")
);

// Specific Transaction Lookup by ID / Reference (Must be at the bottom)
router.get(
  "/:identifier",
  verifyToken,
  safe(transactionController.getTransactionDetails, "getTransactionDetails")
);

module.exports = router;