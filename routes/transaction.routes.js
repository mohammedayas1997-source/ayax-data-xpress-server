const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const transactionController = require("../controllers/transactionController");
const User = require("../models/User");

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

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "default_jwt_secret_key"
    );

    const user = await User.findById(decoded.id || decoded._id || decoded.userId).select("-password -pin");

    if (!user) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "User account no longer exists or has been deactivated.",
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
  if (
    req.user &&
    (String(req.user.role).toLowerCase() === "admin" ||
      String(req.user.role).toLowerCase() === "superadmin")
  ) {
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
// Supports multiple path aliases matching mobile/web frontends
router.get("/my-history", verifyToken, transactionController.getUserTransactions);
router.get("/my-transactions", verifyToken, transactionController.getUserTransactions);
router.get("/history", verifyToken, transactionController.getUserTransactions);

// ==========================================
// 2. ADMIN DASHBOARD & AUDIT ROUTES
// ==========================================
router.get("/all", verifyToken, verifyAdmin, transactionController.getAllTransactions);
router.get("/admin/all", verifyToken, verifyAdmin, transactionController.getAllTransactions);
router.get("/stats", verifyToken, verifyAdmin, transactionController.getTransactionStats);
router.get("/admin/stats", verifyToken, verifyAdmin, transactionController.getTransactionStats);

// Manual Admin Reversal / Refund
router.post("/refund", verifyToken, verifyAdmin, transactionController.refundTransaction);

// Specific Transaction Lookup by ID / Reference
router.get("/:identifier", verifyToken, transactionController.getTransactionDetails);

module.exports = router;