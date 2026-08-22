const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const transactionController = require("../controllers/transactionController");
const User = require("../models/User");

// ==========================================
// BUILT-IN AUTH & ADMIN MIDDLEWARE
// ==========================================
const verifyToken = async (req, res, next) => {
  try {
    let token = null;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Ba ka da izinin shiga. Tabbatar ka saka Token.",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "default_jwt_secret_key"
    );

    const user = await User.findById(decoded.id || decoded._id || decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Asusun mai amfani ba ya aiki ko an goge shi.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token ba daidai ba ne ko ya dade.",
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
    message: "Admin kawai ke da ikon yin wannan aikin.",
  });
};

// ==========================================
// 1. USER ROUTES (Tarihin User)
// ==========================================
router.get("/my-history", verifyToken, transactionController.getUserTransactions);

// ==========================================
// 2. ADMIN ROUTES (Dashboard & Refund)
// ==========================================
router.get("/all", verifyToken, verifyAdmin, transactionController.getAllTransactions);
router.get("/stats", verifyToken, verifyAdmin, transactionController.getTransactionStats);
router.post("/refund", verifyToken, verifyAdmin, transactionController.refundTransaction);
router.get("/:identifier", verifyToken, transactionController.getTransactionDetails);

module.exports = router;